import { NextRequest, NextResponse } from "next/server";
import { fetchAllRows } from "@/lib/db";
import {
  DimensionStats,
  LAYER_ORDER,
  LayerKey,
  StatsResponse,
  TimeBucket,
  TopItem,
  TraceFilter,
  TraceRow,
  TraceStatus,
} from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { classifyPendingByCubeResp } from "@/lib/tempStatus"; // TEMP: ONEOIS 미연결 대응

export const dynamic = "force-dynamic";

// /api/traces 의 classify 와 동일한 규칙 (ERR_CD 컨벤션). 작아서 인라인 유지.
function classify(rows: TraceRow[], allComplete: boolean): TraceStatus {
  const errs = rows.filter((r) => !!r.errCd);
  // TEMP(ONEOIS 미연결): pending 대신 CUBE RESP 로 ok/fail 판정 — tempStatus.ts 참고
  if (errs.length === 0) return allComplete ? "ok" : classifyPendingByCubeResp(rows);
  let sawError = false;
  for (const r of errs) {
    const code = r.errCd!;
    if (code.startsWith("FAIL_")) continue;
    sawError = true;
  }
  return sawError ? "error" : "fail";
}

type Granularity = "5m" | "1h" | "1d";

function pickGranularity(fromMs: number, toMs: number): Granularity {
  const hours = (toMs - fromMs) / 3_600_000;
  if (hours <= 2) return "5m";
  if (hours <= 48) return "1h";
  return "1d";
}

function bucketMs(g: Granularity): number {
  return g === "5m" ? 5 * 60_000 : g === "1h" ? 3_600_000 : 86_400_000;
}

function floorToBucket(ms: number, g: Granularity): number {
  const step = bucketMs(g);
  if (g === "1d") {
    // 로컬 자정 기준 floor
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return Math.floor(ms / step) * step;
}

function isoNoTz(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseTs(ts: string | null): number | null {
  if (!ts) return null;
  // 'YYYY-MM-DDTHH:MM:SS.fff' → 로컬 파싱 (TZ 제거된 형태이므로 그대로 Date 생성)
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

function topN(map: Map<string, number>, n: number): TopItem[] {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const ctx = reqContext(req);
  const sp = req.nextUrl.searchParams;

  const now = Date.now();
  const dateFrom = sp.get("dateFrom") || undefined;
  const dateTo = sp.get("dateTo") || undefined;
  const userId = sp.get("userId") || undefined;
  const channelId = sp.get("channelId") || undefined;
  const actionTyp = sp.get("actionTyp") || undefined;

  // 기본: 최근 24시간
  const effectiveFromMs = dateFrom ? Date.parse(dateFrom) : now - 24 * 3_600_000;
  const effectiveToMs = dateTo ? Date.parse(dateTo) : now;

  const filter: TraceFilter = {
    userId,
    channelId,
    actionTyp,
    dateFrom: dateFrom ?? isoNoTz(effectiveFromMs),
    dateTo: dateTo ?? isoNoTz(effectiveToMs),
    limit: 500,
  };

  logger.info("GET /api/stats", { ...ctx, filter });

  try {
    const rows = await fetchAllRows(filter);

    // ── 트레이스 단위 그룹핑
    const byTrace = new Map<string, TraceRow[]>();
    for (const r of rows) {
      if (!byTrace.has(r.traceId)) byTrace.set(r.traceId, []);
      byTrace.get(r.traceId)!.push(r);
    }

    const totals = { total: 0, ok: 0, fail: 0, error: 0, pending: 0 };
    const userCount = new Map<string, number>();
    const errCount = new Map<string, number>();
    const channelAcc = new Map<string, DimensionStats>();
    const actionAcc = new Map<string, DimensionStats>();
    const NONE = "(none)";
    const dimBump = (acc: Map<string, DimensionStats>, key: string, status: TraceStatus) => {
      let s = acc.get(key);
      if (!s) {
        s = { key, total: 0, ok: 0, fail: 0, error: 0, pending: 0 };
        acc.set(key, s);
      }
      s.total += 1;
      s[status] += 1;
    };

    const g = pickGranularity(effectiveFromMs, effectiveToMs);
    const buckets = new Map<number, TimeBucket>();

    let latencySum = 0;
    let latencyN = 0;

    for (const [, list] of byTrace) {
      totals.total += 1;
      const layerSet = new Set(list.map((r) => r.layer));
      const allComplete =
        layerSet.size === LAYER_ORDER.length && list.every((r) => r.sendCompltYn === "Y");
      const status = classify(list, allComplete);
      totals[status] += 1;

      // user
      const u = list.find((r) => r.userId)?.userId;
      if (u) userCount.set(u, (userCount.get(u) ?? 0) + 1);

      // channel / action: 트레이스 내 첫 번째 비어있지 않은 값을 채택 (상위 레이어가 INSERT 시 기록)
      const ch = list.find((r) => r.channelId)?.channelId ?? NONE;
      const at = list.find((r) => r.actionTyp)?.actionTyp ?? NONE;
      dimBump(channelAcc, ch, status);
      dimBump(actionAcc, at, status);

      // top errors (FAIL/ERROR 모두 포함, 단 에러 코드 기준)
      for (const r of list) {
        if (!r.errCd) continue;
        errCount.set(r.errCd, (errCount.get(r.errCd) ?? 0) + 1);
      }

      // 트레이스 시작 시각 → 버킷
      const recvTimes = list
        .map((r) => parseTs(r.recvTm))
        .filter((v): v is number => v !== null);
      const respTimes = list
        .flatMap((r) => [parseTs(r.respTm), parseTs(r.sendTm)])
        .filter((v): v is number => v !== null);

      if (recvTimes.length > 0) {
        const start = Math.min(...recvTimes);
        const key = floorToBucket(start, g);
        let b = buckets.get(key);
        if (!b) {
          b = { ts: isoNoTz(key), ok: 0, fail: 0, error: 0, pending: 0 };
          buckets.set(key, b);
        }
        b[status] += 1;

        // 트레이스 latency: 첫 recv → 마지막 resp/send
        if (respTimes.length > 0) {
          const end = Math.max(...respTimes);
          const dur = end - start;
          if (dur >= 0 && dur < 24 * 3_600_000) {
            latencySum += dur;
            latencyN += 1;
          }
        }
      }
    }

    // 빈 버킷 채우기 (시계열 차트가 균일하게 보이도록)
    const bucketArr: TimeBucket[] = [];
    const step = bucketMs(g);
    const startBucket = floorToBucket(effectiveFromMs, g);
    const endBucket = floorToBucket(effectiveToMs, g);
    if (g === "1d") {
      const d = new Date(startBucket);
      const endD = new Date(endBucket);
      while (d.getTime() <= endD.getTime()) {
        const k = d.getTime();
        bucketArr.push(buckets.get(k) ?? { ts: isoNoTz(k), ok: 0, fail: 0, error: 0, pending: 0 });
        d.setDate(d.getDate() + 1);
      }
    } else {
      for (let k = startBucket; k <= endBucket; k += step) {
        bucketArr.push(buckets.get(k) ?? { ts: isoNoTz(k), ok: 0, fail: 0, error: 0, pending: 0 });
      }
    }

    // ── 레이어별 행 단위 집계
    const layerAcc = new Map<LayerKey, { total: number; err: number; fail: number; ok: number; rt: number[] }>();
    for (const l of LAYER_ORDER) layerAcc.set(l, { total: 0, err: 0, fail: 0, ok: 0, rt: [] });
    for (const r of rows) {
      const a = layerAcc.get(r.layer);
      if (!a) continue;
      a.total += 1;
      if (r.errCd) {
        if (r.errCd.startsWith("FAIL_")) a.fail += 1;
        else a.err += 1;
      }
      if (r.sendCompltYn === "Y" && !r.errCd) a.ok += 1;
      const s = parseTs(r.sendTm);
      const e = parseTs(r.respTm);
      if (s !== null && e !== null) {
        const d = e - s;
        if (d >= 0 && d < 60 * 60_000) a.rt.push(d);
      }
    }
    const layers = LAYER_ORDER.map((l) => {
      const a = layerAcc.get(l)!;
      const avg = a.rt.length > 0 ? a.rt.reduce((x, y) => x + y, 0) / a.rt.length : null;
      return {
        layer: l,
        total: a.total,
        errCount: a.err,
        failCount: a.fail,
        okRows: a.ok,
        avgRespMs: avg,
      };
    });

    const resp: StatsResponse = {
      range: { from: filter.dateFrom ?? null, to: filter.dateTo ?? null },
      totals,
      avgLatencyMs: latencyN > 0 ? latencySum / latencyN : null,
      granularity: g,
      buckets: bucketArr,
      layers,
      topUsers: topN(userCount, 8),
      topErrors: topN(errCount, 8),
      byChannel: Array.from(channelAcc.values()).sort((a, b) => b.total - a.total),
      byAction: Array.from(actionAcc.values()).sort((a, b) => b.total - a.total),
      rowCount: rows.length,
    };

    logger.info("GET /api/stats done", {
      ...ctx,
      rows: rows.length,
      traces: totals.total,
      ms: Date.now() - t0,
      status: 200,
    });

    return NextResponse.json(resp);
  } catch (e) {
    logger.error("GET /api/stats failed", { ...ctx, status: 500, ms: Date.now() - t0, err: String(e) });
    throw e;
  }
}
