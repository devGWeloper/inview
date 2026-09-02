
// 대시보드 집계. /api/stats 와 /api/insights 가 공용으로 쓴다 — 규칙을 두 벌로 만들면
// 같은 기간인데 두 화면의 숫자가 갈린다. docs/architecture/metrics.md

import { fetchAllRows } from "./db";
import {
  DailyStat,
  DimensionStats,
  LAYER_ORDER,
  LayerKey,
  ROUTING_FAIL_LABEL,
  StatsResponse,
  TimeBucket,
  TopItem,
  TraceFilter,
  TraceRow,
} from "./types";
import { classifyPendingByCubeResp, matchedActionFailCodes } from "./tempStatus"; // TEMP: ONEOIS 미연결 대응
import {
  Granularity,
  enumerateBucketStarts,
  floorToBucket,
  isoNoTz,
  parseTs,
  resolveGranularity,
} from "./timeBuckets";

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

function sortActions<T extends { key: string; total: number }>(arr: T[]): T[] {
  return arr.sort((a, b) => {
    const ar = a.key === ROUTING_FAIL_LABEL ? 1 : 0;
    const br = b.key === ROUTING_FAIL_LABEL ? 1 : 0;
    if (ar !== br) return ar - br;
    return b.total - a.total;
  });
}

export interface StatsQuery {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  actionTyp?: string;
  excludeErrCds?: string[];
  gran?: Granularity;
}

export interface StatsResult {
  stats: StatsResponse;
  rawRowCount: number;
}

export async function computeStats(q: StatsQuery): Promise<StatsResult> {
  const now = Date.now();
  const excludeErrCds = q.excludeErrCds ?? [];
  const excludeSet = new Set(excludeErrCds);

  const effectiveFromMs = q.dateFrom ? Date.parse(q.dateFrom) : now - 24 * 3_600_000;
  const effectiveToMs = q.dateTo ? Date.parse(q.dateTo) : now;
  const userId = q.userId;
  const actionTyp = q.actionTyp;

  const filter: TraceFilter = {
    dateFrom: q.dateFrom ?? isoNoTz(effectiveFromMs),
    dateTo: q.dateTo ?? isoNoTz(effectiveToMs),
  };

  const rows = await fetchAllRows(filter);

  const byTrace = new Map<string, TraceRow[]>();
  for (const r of rows) {
    if (!byTrace.has(r.traceId)) byTrace.set(r.traceId, []);
    byTrace.get(r.traceId)!.push(r);
  }

  if (userId || actionTyp) {
    for (const [traceId, list] of byTrace) {
      const matchUser = !userId || list.some((r) => r.userId === userId);
      const matchAction = !actionTyp || list.some((r) => r.actionTyp === actionTyp);
      if (!matchUser || !matchAction) byTrace.delete(traceId);
    }
  }

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

  const g = resolveGranularity(q.gran, effectiveFromMs, effectiveToMs);
  const buckets = new Map<number, TimeBucket>();

  let latencySum = 0;
  let latencyN = 0;

  const cubeLat = new Map<number, { sum: number; n: number }>();
  let cubeLatSum = 0;
  let cubeLatN = 0;

  const selfMs = new Map<LayerKey, number>();
  for (const l of LAYER_ORDER) selfMs.set(l, 0);
  let selfTimeTraces = 0;
  const failOrigin = new Map<LayerKey, number>();
  for (const l of LAYER_ORDER) failOrigin.set(l, 0);

  const dailyAcc = new Map<
    number,
    {
      total: number;
      ok: number;
      fail: number;
      pending: number;
      users: Set<string>;
      latSum: number;
      latN: number;
      actions: Map<string, { total: number; ok: number; fail: number }>;
    }
  >();

  for (const [traceId, list] of byTrace) {
    if (excludedTraces.has(traceId)) continue;

    totals.total += 1;
    const layerSet = new Set(list.map((r) => r.layer));
    const allComplete =
      layerSet.size === LAYER_ORDER.length && list.every((r) => r.sendCompltYn === "Y");
    const status = classify(list, allComplete);
    totals[status] += 1;

    const u = traceUserId(list);
    if (u) userCount.set(u, (userCount.get(u) ?? 0) + 1);

    const at = list.find((r) => r.actionTyp)?.actionTyp ?? ROUTING_FAIL_LABEL;
    dimBump(actionAcc, at, status);

    const fac = list.find((r) => r.facId)?.facId ?? NONE;
    dimBump(facAcc, fac, status);
    const area = list.find((r) => r.areaId)?.areaId ?? NONE;
    dimBump(areaAcc, area, status);

    for (const r of list) {
      if (!r.errCd) continue;
      errCount.set(r.errCd, (errCount.get(r.errCd) ?? 0) + 1);
    }
    // TEMP(ONEOIS 미연결): 액션 실패(시즈닝/AutoQual 취소·실행)는 실제 errCd 가 없으므로 가상 코드로 topErrors 에 반영
    for (const code of matchedActionFailCodes(list)) {
      errCount.set(code, (errCount.get(code) ?? 0) + 1);
    }

    let deepestErr = -1;
    for (const r of list) {
      if (!r.errCd) continue;
      const li = LAYER_ORDER.indexOf(r.layer);
      if (li > deepestErr) deepestErr = li;
    }
    if (deepestErr >= 0) {
      const l = LAYER_ORDER[deepestErr];
      failOrigin.set(l, (failOrigin.get(l) ?? 0) + 1);
    }

    const entryRows = list.filter((r) => r.layer === LAYER_ORDER[0]);
    const entryRecv = entryRows.map((r) => parseTs(r.recvTm)).filter((v): v is number => v !== null);
    const entryResp = entryRows.map((r) => parseTs(r.respTm)).filter((v): v is number => v !== null);
    if (entryRecv.length > 0 && entryResp.length > 0) {
      const outer0 = Math.max(...entryResp) - Math.min(...entryRecv);
      if (outer0 >= 0 && outer0 < 24 * 3_600_000) {
        const waitOf = (l: LayerKey) => {
          let sum = 0;
          for (const r of list) {
            if (r.layer !== l) continue;
            const s = parseTs(r.sendTm);
            const e = parseTs(r.respTm);
            if (s !== null && e !== null && e >= s) sum += e - s;
          }
          return sum;
        };
        const present = LAYER_ORDER.filter((l) => list.some((r) => r.layer === l));
        let outer = outer0;
        present.forEach((l, k) => {
          const w = waitOf(l);
          const self = k === present.length - 1 ? outer : Math.max(0, outer - w);
          selfMs.set(l, (selfMs.get(l) ?? 0) + self);
          outer = w;
        });
        selfTimeTraces += 1;
      }
    }

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

      const dayKey = floorToBucket(start, "1d");
      let day = dailyAcc.get(dayKey);
      if (!day) {
        day = { total: 0, ok: 0, fail: 0, pending: 0, users: new Set(), latSum: 0, latN: 0, actions: new Map() };
        dailyAcc.set(dayKey, day);
      }
      day.total += 1;
      day[status] += 1;
      if (u) day.users.add(u);

      let da = day.actions.get(at);
      if (!da) {
        da = { total: 0, ok: 0, fail: 0 };
        day.actions.set(at, da);
      }
      da.total += 1;
      if (status === "ok") da.ok += 1;
      else if (status === "fail") da.fail += 1;

      if (respTimes.length > 0) {
        const end = Math.max(...respTimes);
        const dur = end - start;
        if (dur >= 0 && dur < 24 * 3_600_000) {
          latencySum += dur;
          latencyN += 1;
        }
      }

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
          day.latSum += d;
          day.latN += 1;
        }
      }
    }
  }

  const lastBucketMs = Math.max(effectiveFromMs, effectiveToMs - 1);
  const bucketArr: TimeBucket[] = enumerateBucketStarts(effectiveFromMs, lastBucketMs, g).map(
    (k) => {
      const b = buckets.get(k) ?? { ts: isoNoTz(k), ok: 0, fail: 0, pending: 0 };
      const cl = cubeLat.get(k);
      b.avgCubeLatencyMs = cl ? cl.sum / cl.n : null;
      b.cubeLatencyTraces = cl?.n ?? 0;
      return b;
    }
  );

  const daily: DailyStat[] = enumerateBucketStarts(
    effectiveFromMs,
    Math.max(effectiveFromMs, effectiveToMs - 1),
    "1d"
  ).map((k) => {
    const d = dailyAcc.get(k);
    return {
      date: isoNoTz(k).slice(0, 10),
      total: d?.total ?? 0,
      ok: d?.ok ?? 0,
      fail: d?.fail ?? 0,
      pending: d?.pending ?? 0,
      users: d?.users.size ?? 0,
      avgCubeLatencyMs: d && d.latN > 0 ? d.latSum / d.latN : null,
      byAction: d
        ? sortActions(Array.from(d.actions.entries()).map(([key, v]) => ({ key, ...v })))
        : [],
    };
  });

  const layerAcc = new Map<LayerKey, { total: number; fail: number; ok: number; rt: number[] }>();
  for (const l of LAYER_ORDER) layerAcc.set(l, { total: 0, fail: 0, ok: 0, rt: [] });
  let includedRowCount = 0;
  for (const r of rows) {
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
    const st = selfMs.get(l) ?? 0;
    return {
      layer: l,
      total: a.total,
      failCount: a.fail,
      okRows: a.ok,
      avgRespMs: avg,
      avgSelfMs: selfTimeTraces > 0 ? st / selfTimeTraces : null,
      selfMsTotal: st,
      failOriginTraces: failOrigin.get(l) ?? 0,
    };
  });

  const resp: StatsResponse = {
    range: { from: filter.dateFrom ?? null, to: filter.dateTo ?? null },
    totals,
    avgLatencyMs: latencyN > 0 ? latencySum / latencyN : null,
    cubeAvgLatencyMs: cubeLatN > 0 ? cubeLatSum / cubeLatN : null,
    granularity: g,
    buckets: bucketArr,
    layers,
    selfTimeTraces,
    topUsers: topN(userCount, 8),
    uniqueUsers: userCount.size,
    daily,
    topErrors: topN(errCount, 8),
    byAction: sortActions(Array.from(actionAcc.values())),
    byFac: Array.from(facAcc.values()).sort((a, b) => b.total - a.total),
    byArea: Array.from(areaAcc.values()).sort((a, b) => b.total - a.total),
    rowCount: includedRowCount,
    excludeErrCds: excludeErrCds,
    excludedTraceCount: excludedTraces.size,
  };

  return { stats: resp, rawRowCount: rows.length };
}
