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
import { classifyPendingByCubeResp, matchedActionFailCodes } from "@/lib/tempStatus"; // TEMP: ONEOIS 미연결 대응
import {
  enumerateBucketStarts,
  floorToBucket,
  isoNoTz,
  parseTs,
  pickGranularity,
} from "@/lib/timeBuckets";

export const dynamic = "force-dynamic";

// 대시보드 집계는 ERROR/FAIL 구분 없이 fail 로 통합한다 (트레이스 목록 쪽 classify 와 의도적으로 다름).
type DashStatus = "ok" | "fail" | "pending";

function classify(rows: TraceRow[], allComplete: boolean): DashStatus {
  const hasErr = rows.some((r) => !!r.errCd);
  // TEMP(ONEOIS 미연결): pending 대신 CUBE RESP 로 ok/fail 판정 — tempStatus.ts 참고
  if (!hasErr) {
    if (allComplete) return "ok";
    const t = classifyPendingByCubeResp(rows);
    return t === "ok" ? "ok" : "fail";
  }
  return "fail";
}

/**
 * 트레이스의 대표 사용자 — 진입 레이어(CUBE) 우선으로 첫 non-null USER_ID 를 고른다.
 * USER_ID 는 전 레이어가 INSERT 시 기록하므로 행 순서에 따라 하위 레이어 값(시스템 계정 등)이
 * 잡히면 사용자 수가 부풀 수 있다. 공백/빈 문자열도 정규화해 같은 사용자가 두 번 세어지지 않게 한다.
 * (uniqueUsers = 이 대표 사용자의 distinct 수 — 한 사용자가 100번 요청해도 1명)
 */
function traceUserId(list: TraceRow[]): string | null {
  for (const layer of LAYER_ORDER) {
    for (const r of list) {
      if (r.layer !== layer) continue;
      const u = r.userId?.trim();
      if (u) return u;
    }
  }
  return null;
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
  const actionTyp = sp.get("actionTyp") || undefined;

  // 집계 제외 에러 코드 (CSV). 해당 코드를 가진 trace 는 모든 집계에서 통째로 빠진다.
  const excludeErrCds = (sp.get("excludeErrCds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const excludeSet = new Set(excludeErrCds);

  // 기본: 최근 24시간
  const effectiveFromMs = dateFrom ? Date.parse(dateFrom) : now - 24 * 3_600_000;
  const effectiveToMs = dateTo ? Date.parse(dateTo) : now;

  // ⚠️ 집계용 필터: 날짜 범위만 SQL 로 내린다.
  //  - limit 없음 → db.ts 가 FETCH FIRST 를 안 붙여 기간 내 전체 행을 가져온다(집계는 다 봐야 함).
  //  - userId/actionTyp 는 일부 레이어에만 기록되는 컬럼이라 행 단위(per-layer) SQL 필터로 걸면
  //    해당 컬럼이 빈 다른 레이어 행이 통째로 빠져 트레이스가 깨진다. → 아래에서 트레이스 단위로 필터링한다.
  const filter: TraceFilter = {
    dateFrom: dateFrom ?? isoNoTz(effectiveFromMs),
    dateTo: dateTo ?? isoNoTz(effectiveToMs),
  };

  logger.info("GET /api/stats", { ...ctx, filter, userId, actionTyp, excludeErrCds });

  try {
    const rows = await fetchAllRows(filter);

    // ── 트레이스 단위 그룹핑
    const byTrace = new Map<string, TraceRow[]>();
    for (const r of rows) {
      if (!byTrace.has(r.traceId)) byTrace.set(r.traceId, []);
      byTrace.get(r.traceId)!.push(r);
    }

    // ── 트레이스 단위 필터 (userId/actionTyp)
    //   ACTION_TYP/USER_ID 는 일부 레이어 행에만 채워지므로, "트레이스 내 어느 한 행이라도 일치"하면
    //   그 트레이스의 전체 레이어 행을 유지한다. (행 단위로 거르면 다른 레이어 행이 사라져 FAC/AREA·
    //   레이어바·액션 실패(시즈닝/AutoQual 취소) 판정이 모두 깨진다.)
    if (userId || actionTyp) {
      for (const [traceId, list] of byTrace) {
        const matchUser = !userId || list.some((r) => r.userId === userId);
        const matchAction = !actionTyp || list.some((r) => r.actionTyp === actionTyp);
        if (!matchUser || !matchAction) byTrace.delete(traceId);
      }
    }

    // 제외 trace 집합: 제외 코드 셋과 매칭되는 errCd 를 가진 trace + (가상)액션 실패(시즈닝/AutoQual 취소) trace
    const excludedTraces = new Set<string>();
    if (excludeSet.size > 0) {
      for (const [traceId, list] of byTrace) {
        const hitErr = list.some((r) => r.errCd && excludeSet.has(r.errCd));
        const hitAction = matchedActionFailCodes(list).some((code) => excludeSet.has(code));
        if (hitErr || hitAction) excludedTraces.add(traceId);
      }
    }

    const totals = { total: 0, ok: 0, fail: 0, pending: 0 };
    const userCount = new Map<string, number>();
    const errCount = new Map<string, number>();
    const actionAcc = new Map<string, DimensionStats>();
    const facAcc = new Map<string, DimensionStats>();
    const areaAcc = new Map<string, DimensionStats>();
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

    // Action 전체 응답 지연: CUBE(진입 레이어) send→resp 를 버킷별 집계 — 대시보드 "평균 응답 지연" 차트용.
    // Tokens 탭의 LLM 호출 지연(1콜 단위, LATENCY_MS)과는 별개의 정규 지표(전 구간 왕복시간).
    const cubeLat = new Map<number, { sum: number; n: number }>();
    let cubeLatSum = 0;
    let cubeLatN = 0;

    for (const [traceId, list] of byTrace) {
      if (excludedTraces.has(traceId)) continue;

      totals.total += 1;
      const layerSet = new Set(list.map((r) => r.layer));
      const allComplete =
        layerSet.size === LAYER_ORDER.length && list.every((r) => r.sendCompltYn === "Y");
      const status = classify(list, allComplete);
      totals[status] += 1;

      // user — CUBE(진입 레이어) 우선 대표 사용자 (traceUserId 참고)
      const u = traceUserId(list);
      if (u) userCount.set(u, (userCount.get(u) ?? 0) + 1);

      // action: 트레이스 내 첫 번째 비어있지 않은 값을 채택 (상위 레이어가 INSERT 시 기록)
      const at = list.find((r) => r.actionTyp)?.actionTyp ?? NONE;
      dimBump(actionAcc, at, status);

      // FAC / AREA: MCP send update 에서만 기록되므로 트레이스 내 첫 non-null 값 채택. MCP 미도달 트레이스는 (none)
      const fac = list.find((r) => r.facId)?.facId ?? NONE;
      dimBump(facAcc, fac, status);
      const area = list.find((r) => r.areaId)?.areaId ?? NONE;
      dimBump(areaAcc, area, status);

      // top errors (FAIL/ERROR 모두 포함, 단 에러 코드 기준)
      for (const r of list) {
        if (!r.errCd) continue;
        errCount.set(r.errCd, (errCount.get(r.errCd) ?? 0) + 1);
      }
      // TEMP(ONEOIS 미연결): 액션 실패(시즈닝/AutoQual 취소)는 실제 errCd 가 없으므로 가상 코드로 topErrors 에 반영
      for (const code of matchedActionFailCodes(list)) {
        errCount.set(code, (errCount.get(code) ?? 0) + 1);
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

        // CUBE 가 하위로 요청 보낸 시각(send)→응답 받은 시각(resp) 지연 = Action end-to-end 응답시간
        const cubeSends = list
          .filter((r) => r.layer === "CUBE")
          .map((r) => parseTs(r.sendTm))
          .filter((v): v is number => v !== null);
        const cubeResps = list
          .filter((r) => r.layer === "CUBE")
          .map((r) => parseTs(r.respTm))
          .filter((v): v is number => v !== null);
        if (cubeSends.length > 0 && cubeResps.length > 0) {
          const d = Math.max(...cubeResps) - Math.min(...cubeSends);
          if (d >= 0 && d < 24 * 3_600_000) {
            let cl = cubeLat.get(key);
            if (!cl) {
              cl = { sum: 0, n: 0 };
              cubeLat.set(key, cl);
            }
            cl.sum += d;
            cl.n += 1;
            cubeLatSum += d;
            cubeLatN += 1;
          }
        }
      }
    }

    // 빈 버킷 채우기 (시계열 차트가 균일하게 보이도록)
    const bucketArr: TimeBucket[] = enumerateBucketStarts(effectiveFromMs, effectiveToMs, g).map(
      (k) => {
        const b = buckets.get(k) ?? { ts: isoNoTz(k), ok: 0, fail: 0, pending: 0 };
        // 버킷별 CUBE send→resp 평균 지연(=Action 응답 지연) 부착
        const cl = cubeLat.get(k);
        b.avgCubeLatencyMs = cl ? cl.sum / cl.n : null;
        b.cubeLatencyTraces = cl?.n ?? 0;
        return b;
      }
    );

    // ── 레이어별 행 단위 집계 (ERROR/FAIL 구분 없이 fail 로 통합) — 제외 trace 의 행은 빠짐
    const layerAcc = new Map<LayerKey, { total: number; fail: number; ok: number; rt: number[] }>();
    for (const l of LAYER_ORDER) layerAcc.set(l, { total: 0, fail: 0, ok: 0, rt: [] });
    let includedRowCount = 0;
    for (const r of rows) {
      // 트레이스 단위 필터(byTrace 에서 제거)된 행과 제외 trace 행은 모두 건너뛴다.
      if (!byTrace.has(r.traceId) || excludedTraces.has(r.traceId)) continue;
      includedRowCount += 1;
      const a = layerAcc.get(r.layer);
      if (!a) continue;
      a.total += 1;
      if (r.errCd) a.fail += 1;
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
        failCount: a.fail,
        okRows: a.ok,
        avgRespMs: avg,
      };
    });

    const resp: StatsResponse = {
      range: { from: filter.dateFrom ?? null, to: filter.dateTo ?? null },
      totals,
      avgLatencyMs: latencyN > 0 ? latencySum / latencyN : null,
      // Action 전체 응답 지연 평균 (CUBE send→resp)
      cubeAvgLatencyMs: cubeLatN > 0 ? cubeLatSum / cubeLatN : null,
      granularity: g,
      buckets: bucketArr,
      layers,
      topUsers: topN(userCount, 8),
      uniqueUsers: userCount.size,
      topErrors: topN(errCount, 8),
      byAction: Array.from(actionAcc.values()).sort((a, b) => b.total - a.total),
      byFac: Array.from(facAcc.values()).sort((a, b) => b.total - a.total),
      byArea: Array.from(areaAcc.values()).sort((a, b) => b.total - a.total),
      rowCount: includedRowCount,
      excludeErrCds: excludeErrCds,
      excludedTraceCount: excludedTraces.size,
    };

    logger.info("GET /api/stats done", {
      ...ctx,
      rows: rows.length,
      includedRows: includedRowCount,
      traces: totals.total,
      excludedTraces: excludedTraces.size,
      ms: Date.now() - t0,
      status: 200,
    });

    return NextResponse.json(resp);
  } catch (e) {
    logger.error("GET /api/stats failed", { ...ctx, status: 500, ms: Date.now() - t0, err: String(e) });
    throw e;
  }
}
