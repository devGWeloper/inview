import { NextRequest, NextResponse } from "next/server";
import { fetchAllRows, fetchRecentTraceIds, fetchTraceIdsBy, fetchWorkGroupRows, connectedLayerCount, getAppEnv } from "@/lib/db";
import { LAYER_ORDER, LayerKey, TraceFilter, TraceStatus, TraceSummary, TraceRow, WorkSummary } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { isoNoTz } from "@/lib/timeBuckets";
import { classifyPendingByCubeResp } from "@/lib/tempStatus"; // TEMP: ONEOIS 미연결 대응
import { TraceWorkInfo, WORK_WINDOW_HOURS, groupTracesIntoWorks, rollupStatus, shiftLocalIso } from "@/lib/workGroup"; // TEMP(WORK_GROUP)
import { requireBiz } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

function classify(rows: TraceRow[], allComplete: boolean): TraceStatus {
  const errs = rows.filter((r) => !!r.errCd);
  // TEMP(ONEOIS 미연결): pending 대신 CUBE RESP 로 ok/fail 판정 — tempStatus.ts 참고
  if (errs.length === 0) return allComplete ? "ok" : classifyPendingByCubeResp(rows);

  let sawError = false;
  for (const r of errs) {
    const code = r.errCd!;
    if (code.startsWith("FAIL_")) continue;
    if (code.startsWith("ERROR_")) {
      sawError = true;
      continue;
    }
    logger.warn("unknown err_cd prefix", { traceId: r.traceId, layer: r.layer, errCd: code });
    sawError = true;
  }
  return sawError ? "error" : "fail";
}

function keepErrorMatchingTraces(rows: TraceRow[], filter: TraceFilter): TraceRow[] {
  if (!filter.errCd && !filter.onlyError) return rows;
  const needle = filter.errCd ? filter.errCd.toUpperCase() : null;
  const hit = new Set<string>();
  for (const r of rows) {
    if (!r.errCd) continue;
    if (needle === null || r.errCd.toUpperCase().includes(needle)) hit.add(r.traceId);
  }
  return rows.filter((r) => hit.has(r.traceId));
}

function summarize(rows: TraceRow[]): TraceSummary[] {
  const byTrace = new Map<string, TraceRow[]>();
  for (const r of rows) {
    if (!byTrace.has(r.traceId)) byTrace.set(r.traceId, []);
    byTrace.get(r.traceId)!.push(r);
  }

  const summaries: TraceSummary[] = [];
  for (const [traceId, list] of byTrace) {
    const recvTimes = list.map((r) => r.recvTm).filter((v): v is string => !!v).sort();
    const sendTimes = list.flatMap((r) => [r.sendTm, r.respTm]).filter((v): v is string => !!v).sort();
    const layerSet = new Set(list.map((r) => r.layer));
    const allComplete = layerSet.size === LAYER_ORDER.length && list.every((r) => r.sendCompltYn === "Y");
    summaries.push({
      traceId,
      userId: list.find((r) => r.userId)?.userId ?? null,
      firstRecvTm: recvTimes[0] ?? null,
      lastSendTm: sendTimes.length ? sendTimes[sendTimes.length - 1] : null,
      layerCount: layerSet.size,
      layers: LAYER_ORDER.filter((l) => layerSet.has(l)),
      status: classify(list, allComplete),
      allComplete
    });
  }

  summaries.sort((a, b) => (b.firstRecvTm ?? "").localeCompare(a.firstRecvTm ?? ""));
  return summaries;
}

const MAX_SIBLING_TRACES = 500;

const DEFAULT_LIMIT = 500;

/**
 * [TEMP][WORK_GROUP] 걸린 TRACE 를 묶음으로 해석하고 형제 TRACE 를 채운다.
 * 필터는 '어떤 묶음을 찾을지'만 정하고, 찾은 묶음은 통째로 보여준다.
 * GAIA 미연결/조회 실패면 매핑이 비어 모든 TRACE 가 1건짜리 묶음이 된다.
 */
async function buildWorks(
  matched: TraceSummary[],
  preInfo?: Map<string, TraceWorkInfo>
): Promise<WorkSummary[]> {
  if (matched.length === 0) return [];

  const times = matched
    .flatMap((s) => [s.firstRecvTm, s.lastSendTm])
    .filter((v): v is string => !!v)
    .sort();
  if (times.length === 0 && !preInfo) {
    return matched.map((s) => soloWork(s));
  }

  let infoByTrace: Map<string, TraceWorkInfo>;
  if (preInfo) {
    infoByTrace = preInfo;
  } else {
    const from = shiftLocalIso(times[0], -WORK_WINDOW_HOURS);
    const to = shiftLocalIso(times[times.length - 1], WORK_WINDOW_HOURS);
    const sourceRows = await fetchWorkGroupRows(from, to);
    infoByTrace = groupTracesIntoWorks(sourceRows, WORK_WINDOW_HOURS);
  }

  const matchedWorkIds = new Set(matched.map((s) => infoByTrace.get(s.traceId)?.workId ?? s.traceId));
  const have = new Set(matched.map((s) => s.traceId));
  const missing: string[] = [];
  for (const [traceId, info] of infoByTrace) {
    if (matchedWorkIds.has(info.workId) && !have.has(traceId)) missing.push(traceId);
  }

  let siblings: TraceSummary[] = [];
  if (missing.length > 0) {
    const capped = missing.slice(0, MAX_SIBLING_TRACES);
    if (capped.length < missing.length) {
      logger.warn("buildWorks: 형제 TRACE 상한 초과 — 일부 생략", {
        wanted: missing.length,
        fetched: capped.length,
      });
    }
    siblings = summarize(await fetchAllRows({ traceIds: capped, lean: true }));
  }

  const byWork = new Map<string, WorkSummary>();
  for (const s of [...matched, ...siblings]) {
    const info = infoByTrace.get(s.traceId);
    const workId = info?.workId ?? s.traceId;
    let w = byWork.get(workId);
    if (!w) {
      w = {
        workId,
        chamberId: info?.chamberId ?? null,
        firstRecvTm: null,
        lastRecvTm: null,
        status: "ok",
        traces: [],
      };
      byWork.set(workId, w);
    }
    w.traces.push({ ...s, actionLabel: info?.actionLabel ?? null });
  }

  const works = Array.from(byWork.values());
  for (const w of works) {
    w.traces.sort((a, b) => (a.firstRecvTm ?? "").localeCompare(b.firstRecvTm ?? ""));
    const recvs = w.traces.map((t) => t.firstRecvTm).filter((v): v is string => !!v);
    w.firstRecvTm = recvs[0] ?? null;
    w.lastRecvTm = recvs[recvs.length - 1] ?? null;
    w.status = rollupStatus(w.traces.map((t) => t.status));
  }
  works.sort((a, b) => (b.firstRecvTm ?? "").localeCompare(a.firstRecvTm ?? ""));
  return works;
}

function soloWork(s: TraceSummary): WorkSummary {
  return {
    workId: s.traceId,
    chamberId: null,
    firstRecvTm: s.firstRecvTm,
    lastRecvTm: s.firstRecvTm,
    status: s.status,
    traces: [{ ...s, actionLabel: null }],
  };
}

/**
 * [TEMP][WORK_GROUP] "묶음만" 조회 — 순서가 반대다.
 * 목록 상한이 트레이스 단위라 묶음이 드문 기간엔 최근 N 안에 하나도 안 걸린다.
 * 그래서 GAIA 소스로 묶음을 먼저 산출하고 2건 이상인 묶음만 통째로 가져온다.
 */
const GROUPED_SCAN_HOURS = 24 * 365; // 기간 '전체'일 때 훑는 범위 (행 상한이 실질 경계)

async function resolveGroupedTraceIds(
  filter: TraceFilter,
  limit: number
): Promise<{ traceIds: string[]; info: Map<string, TraceWorkInfo> }> {
  const nowIso = isoNoTz(Date.now());
  const to = shiftLocalIso(filter.dateTo ?? nowIso, WORK_WINDOW_HOURS);
  const from = filter.dateFrom
    ? shiftLocalIso(filter.dateFrom, -WORK_WINDOW_HOURS)
    : shiftLocalIso(nowIso, -GROUPED_SCAN_HOURS);

  const sourceRows = await fetchWorkGroupRows(from, to);
  const info = groupTracesIntoWorks(sourceRows, WORK_WINDOW_HOURS);

  const lastByTrace = new Map<string, string>();
  for (const r of sourceRows) {
    if (!r.traceId || !r.recvTm) continue;
    const prev = lastByTrace.get(r.traceId);
    if (prev === undefined || prev.localeCompare(r.recvTm) < 0) lastByTrace.set(r.traceId, r.recvTm);
  }
  const byWork = new Map<string, { traceIds: string[]; last: string }>();
  for (const [traceId, i] of info) {
    let w = byWork.get(i.workId);
    if (!w) { w = { traceIds: [], last: "" }; byWork.set(i.workId, w); }
    w.traceIds.push(traceId);
    const last = lastByTrace.get(traceId) ?? "";
    if (w.last.localeCompare(last) < 0) w.last = last;
  }

  const groups = Array.from(byWork.values())
    .filter((w) => w.traceIds.length > 1)
    .sort((a, b) => b.last.localeCompare(a.last));

  const traceIds: string[] = [];
  for (const g of groups) {
    if (traceIds.length > 0 && traceIds.length + g.traceIds.length > limit) break;
    traceIds.push(...g.traceIds);
    if (traceIds.length >= limit) break;
  }
  logger.info("resolveGroupedTraceIds", {
    from, to, sourceRows: sourceRows.length, groups: groups.length, traces: traceIds.length,
  });
  return { traceIds, info };
}

export async function GET(req: NextRequest) {
  const bizGuard = await requireBiz();
  if (!bizGuard.ok) return NextResponse.json({ error: bizGuard.error }, { status: bizGuard.status });

  const t0 = Date.now();
  const ctx = reqContext(req);
  const sp = req.nextUrl.searchParams;
  const filter: TraceFilter = {
    traceId: sp.get("traceId") || undefined,
    userId: sp.get("userId") || undefined,
    errCd: sp.get("errCd") || undefined,
    facId: sp.get("facId") || undefined,
    actionTyp: sp.get("actionTyp") || undefined,
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
    onlyError: sp.get("onlyError") === "true" ? true : undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : DEFAULT_LIMIT
  };
  const groupedOnly = sp.get("groupedOnly") === "true";

  logger.info("GET /api/traces", { ...ctx, query: sp.toString(), filter });

  try {
    const idFilters: Array<[LayerKey, "FAC_ID" | "ACTION_TYP" | "USER_ID", string]> = [];
    if (filter.facId) idFilters.push(["MCP", "FAC_ID", filter.facId]);
    if (filter.actionTyp) idFilters.push(["GAIA", "ACTION_TYP", filter.actionTyp]);
    if (filter.userId) idFilters.push([LAYER_ORDER[0], "USER_ID", filter.userId]);

    const matchedByDimension = async (): Promise<Set<string> | null> => {
      if (idFilters.length === 0) return null;
      const idSets = await Promise.all(
        idFilters.map(([layer, column, value]) => fetchTraceIdsBy(layer, column, value, filter))
      );
      return new Set(
        idSets.reduce((acc, set) => {
          const s = new Set(set);
          return acc.filter((id) => s.has(id));
        })
      );
    };

    const limit = Math.max(1, Math.min(Number.isFinite(filter.limit) ? filter.limit! : DEFAULT_LIMIT, 500));
    let traceIds: string[];
    let groupInfo: Map<string, TraceWorkInfo> | undefined;
    if (groupedOnly) {
      const g = await resolveGroupedTraceIds(filter, limit);
      traceIds = g.traceIds;
      groupInfo = g.info;
    } else if (filter.traceId) {
      traceIds = [filter.traceId];
    } else if (idFilters.length > 0) {
      traceIds = Array.from((await matchedByDimension()) ?? []);
    } else {
      traceIds = await fetchRecentTraceIds(filter);
    }

    let rows: TraceRow[] = traceIds.length > 0 ? await fetchAllRows({ traceIds, lean: true }) : [];
    if (!groupedOnly) rows = keepErrorMatchingTraces(rows, filter);

    const summaries = summarize(rows);
    let works = await buildWorks(summaries, groupInfo);

    if (groupedOnly) {
      works = works.filter((w) => w.traces.length > 1);
      const allowed = await matchedByDimension();
      if (allowed) works = works.filter((w) => w.traces.some((t) => allowed.has(t.traceId)));
      if (filter.errCd || filter.onlyError) {
        const hit = new Set(keepErrorMatchingTraces(rows, filter).map((r) => r.traceId));
        works = works.filter((w) => w.traces.some((t) => hit.has(t.traceId)));
      }
    }
    const connectedLayers = connectedLayerCount();
    const appEnv = getAppEnv();

    logger.info("GET /api/traces done", {
      ...ctx,
      appEnv,
      rows: rows.length,
      groupedOnly,
      matchedTraces: summaries.length,
      total: works.length,
      groupedWorks: works.filter((w) => w.traces.length > 1).length,
      connectedLayers,
      status: 200,
      ms: Date.now() - t0,
    });

    return NextResponse.json({ works, total: works.length, connectedLayers, appEnv });
  } catch (e) {
    logger.error("GET /api/traces failed", { ...ctx, status: 500, ms: Date.now() - t0, err: String(e) });
    throw e;
  }
}
