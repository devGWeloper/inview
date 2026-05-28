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
} from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { classifyPendingByCubeResp, hasSeasoningFailure, SEASONING_FAIL_CODE } from "@/lib/tempStatus"; // TEMP: ONEOIS 미연결 대응

export const dynamic = "force-dynamic";

// 대시보드 집계는 ERROR/FAIL 구분 없이 fail 로 통합한다 (트레이스 목록 쪽 classify 와 의도적으로 다름).
type DashStatus = "ok" | "fail" | "pending";

/**
 * 에러 필터 적용 여부를 판단하는 predicate 를 만든다.
 *   include 모드: codes 에 포함된 코드만 카운트 (그 외는 ignored)
 *   exclude 모드: codes 에 포함된 코드는 ignored
 *   그 외 (mode=null, codes 비어있음): 아무것도 ignored 가 아님
 *
 * ignored 처리 정책: 에러가 없는 것처럼 취급 (A안) — 트레이스 단위 집계에서 OK 로 카운트되고,
 * topErrors / 레이어 failCount 에서도 빠진다.
 */
function makeErrFilter(mode: "include" | "exclude" | null, codes: string[]) {
  const active = mode !== null && codes.length > 0;
  const set = new Set(codes);
  return (code: string | null | undefined): boolean => {
    if (!active || !code) return false;
    const inSet = set.has(code);
    return mode === "include" ? !inSet : inSet;
  };
}

function classify(
  rows: TraceRow[],
  allComplete: boolean,
  isIgnored: (code: string | null) => boolean,
): DashStatus {
  const hasRealErr = rows.some((r) => r.errCd && !isIgnored(r.errCd));
  if (hasRealErr) return "fail";
  // TEMP(ONEOIS 미연결): pending 대신 CUBE RESP 로 ok/fail 판정 — tempStatus.ts 참고
  if (allComplete) return "ok";
  // Seasoning 도 필터에서 ignored 라면 ok 로 간주
  if (isIgnored(SEASONING_FAIL_CODE)) return "ok";
  const t = classifyPendingByCubeResp(rows);
  return t === "ok" ? "ok" : "fail";
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

  // 에러 필터 파라미터: errMode=(include|exclude), errCds=CSV
  const rawMode = sp.get("errMode");
  const errMode: "include" | "exclude" | null =
    rawMode === "include" || rawMode === "exclude" ? rawMode : null;
  const errCds = (sp.get("errCds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const effectiveMode = errCds.length > 0 ? errMode : null;
  const isIgnored = makeErrFilter(effectiveMode, errCds);

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

    const totals = { total: 0, ok: 0, fail: 0, pending: 0 };
    const userCount = new Map<string, number>();
    const errCount = new Map<string, number>();
    const channelAcc = new Map<string, DimensionStats>();
    const actionAcc = new Map<string, DimensionStats>();
    const NONE = "(none)";
    const dimBump = (acc: Map<string, DimensionStats>, key: string, status: DashStatus) => {
      let s = acc.get(key);
      if (!s) {
        s = { key, total: 0, ok: 0, fail: 0, pending: 0 };
        acc.set(key, s);
      }
      s.total += 1;
      s[status] += 1;
    };

    const g = pickGranularity(effectiveFromMs, effectiveToMs);
    const buckets = new Map<number, TimeBucket>();

    let latencySum = 0;
    let latencyN = 0;

    // 필터 적용 전, 데이터에 존재하는 모든 에러 코드를 수집해서 UI 의 옵션 소스로 노출.
    // 가상 코드(FAIL_SEASONING)는 실제 데이터에 Seasoning 실패가 있을 때만 포함.
    const allErrCdSet = new Set<string>();

    for (const [, list] of byTrace) {
      totals.total += 1;
      const layerSet = new Set(list.map((r) => r.layer));
      const allComplete =
        layerSet.size === LAYER_ORDER.length && list.every((r) => r.sendCompltYn === "Y");
      const status = classify(list, allComplete, isIgnored);
      totals[status] += 1;

      // user
      const u = list.find((r) => r.userId)?.userId;
      if (u) userCount.set(u, (userCount.get(u) ?? 0) + 1);

      // channel / action: 트레이스 내 첫 번째 비어있지 않은 값을 채택 (상위 레이어가 INSERT 시 기록)
      const ch = list.find((r) => r.channelId)?.channelId ?? NONE;
      const at = list.find((r) => r.actionTyp)?.actionTyp ?? NONE;
      dimBump(channelAcc, ch, status);
      dimBump(actionAcc, at, status);

      // top errors (FAIL/ERROR 모두 포함, 단 에러 코드 기준).
      // ignored 코드는 카운트 제외 + allErrCds 에는 필터 적용 전 코드 모두 수집.
      for (const r of list) {
        if (!r.errCd) continue;
        allErrCdSet.add(r.errCd);
        if (isIgnored(r.errCd)) continue;
        errCount.set(r.errCd, (errCount.get(r.errCd) ?? 0) + 1);
      }
      // TEMP(ONEOIS 미연결): Seasoning 실패는 실제 errCd 가 없으므로 가상 코드로 topErrors 에 반영
      if (hasSeasoningFailure(list)) {
        allErrCdSet.add(SEASONING_FAIL_CODE);
        if (!isIgnored(SEASONING_FAIL_CODE)) {
          errCount.set(SEASONING_FAIL_CODE, (errCount.get(SEASONING_FAIL_CODE) ?? 0) + 1);
        }
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
          b = { ts: isoNoTz(key), ok: 0, fail: 0, pending: 0 };
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
        bucketArr.push(buckets.get(k) ?? { ts: isoNoTz(k), ok: 0, fail: 0, pending: 0 });
        d.setDate(d.getDate() + 1);
      }
    } else {
      for (let k = startBucket; k <= endBucket; k += step) {
        bucketArr.push(buckets.get(k) ?? { ts: isoNoTz(k), ok: 0, fail: 0, pending: 0 });
      }
    }

    // ── 레이어별 행 단위 집계 (ERROR/FAIL 구분 없이 fail 로 통합)
    const layerAcc = new Map<LayerKey, { total: number; fail: number; ok: number; rt: number[] }>();
    for (const l of LAYER_ORDER) layerAcc.set(l, { total: 0, fail: 0, ok: 0, rt: [] });
    for (const r of rows) {
      const a = layerAcc.get(r.layer);
      if (!a) continue;
      a.total += 1;
      const errCounts = !!r.errCd && !isIgnored(r.errCd);
      if (errCounts) a.fail += 1;
      if (r.sendCompltYn === "Y" && !errCounts) a.ok += 1;
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
      allErrCds: Array.from(allErrCdSet).sort((a, b) => a.localeCompare(b)),
      errFilter: { mode: effectiveMode, codes: effectiveMode ? errCds : [] },
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
