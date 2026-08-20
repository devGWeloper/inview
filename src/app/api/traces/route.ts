import { NextRequest, NextResponse } from "next/server";
import { fetchAllRows, fetchTraceIdsBy, fetchWorkGroupRows, connectedLayerCount, getAppEnv } from "@/lib/db";
import { LAYER_ORDER, LayerKey, TraceFilter, TraceStatus, TraceSummary, TraceRow, WorkSummary } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { classifyPendingByCubeResp } from "@/lib/tempStatus"; // TEMP: ONEOIS 미연결 대응
import { WORK_WINDOW_HOURS, groupTracesIntoWorks, rollupStatus, shiftLocalIso } from "@/lib/workGroup"; // TEMP(WORK_GROUP)

export const dynamic = "force-dynamic";

// ERR_CD 컨벤션: FAIL_* = 비즈니스 validation 실패, ERROR_* = 인프라/통신 에러.
// 둘 다 아닌 코드는 안전하게 error 로 처리하고 컨벤션 위반을 warn 으로 남긴다.
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

/** 형제 TRACE 를 채우려고 추가 조회하는 최대 건수 (Oracle IN 목록 상한 여유) */
const MAX_SIBLING_TRACES = 500;

/**
 * [TEMP][WORK_GROUP] 필터에 걸린 TRACE 들을 "현장 작업" 단위로 묶는다.
 *
 * 필터링 자체는 위 파이프라인이 이미 끝냈다. 여기서 하는 일은 두 가지뿐:
 *   1) 묶음 산출 — GAIA 를 앞뒤로 넓게 읽어 TRACE → 묶음 매핑을 만든다
 *   2) 형제 채우기 — 걸린 TRACE 가 속한 묶음의 나머지 TRACE 를 마저 가져온다
 *      (필터는 '어떤 묶음을 찾을지'만 정하고, 찾은 묶음은 통째로 보여준다)
 *
 * GAIA 미연결이나 조회 실패면 매핑이 비어 모든 TRACE 가 1건짜리 묶음이 된다 = 기존 화면.
 */
async function buildWorks(matched: TraceSummary[]): Promise<WorkSummary[]> {
  if (matched.length === 0) return [];

  // 묶음 경계가 정확해지려면 화면에 걸린 TRACE 의 시간 범위보다 앞뒤로 윈도우만큼 더 읽어야 한다.
  // 앞: 어제 22시 전값 + 오늘 2시 후값이 갈라지는 걸 막는다.
  // 뒤: 걸린 TRACE 가 흐름의 앞단(전값)일 때 뒤따라온 후값/ERMAP 을 같이 집는다.
  const times = matched
    .flatMap((s) => [s.firstRecvTm, s.lastSendTm])
    .filter((v): v is string => !!v)
    .sort();
  if (times.length === 0) {
    return matched.map((s) => soloWork(s));
  }
  const from = shiftLocalIso(times[0], -WORK_WINDOW_HOURS);
  const to = shiftLocalIso(times[times.length - 1], WORK_WINDOW_HOURS);

  const sourceRows = await fetchWorkGroupRows(from, to);
  const infoByTrace = groupTracesIntoWorks(sourceRows, WORK_WINDOW_HOURS);

  // 걸린 TRACE 가 속한 묶음들 → 그 묶음에 든 TRACE 전부
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
    siblings = summarize(await fetchAllRows({ traceIds: capped }));
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

/** 묶음 산출을 못 한 TRACE 는 1건짜리 묶음으로 (= 지금까지의 목록 행과 같은 모양) */
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

export async function GET(req: NextRequest) {
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
    limit: sp.get("limit") ? Number(sp.get("limit")) : 200
  };

  logger.info("GET /api/traces", { ...ctx, query: sp.toString(), filter });

  try {
    // FAC(FAB)/ACTION_TYP 필터: 일부 레이어만 기록하는 컬럼이라 2단계로 조회한다 —
    // 1) 기록 레이어 DB 에서 조건에 맞는 최근 TRACE_ID 확정(드롭다운 옵션 출처와 동일 DB:
    //    FAC_ID=MCP(/api/facs), ACTION_TYP=GAIA(/api/action-types))
    // 2) 그 ID 들의 전 레이어 행을 traceIds IN 으로 조회 (두 필터 동시 사용 시 교집합)
    let rows: TraceRow[];
    const idFilters: Array<[LayerKey, "FAC_ID" | "ACTION_TYP" | "USER_ID", string]> = [];
    if (filter.facId) idFilters.push(["MCP", "FAC_ID", filter.facId]);
    if (filter.actionTyp) idFilters.push(["GAIA", "ACTION_TYP", filter.actionTyp]);
    // USER_ID 는 레이어마다 값이 다를 수 있어(하위 레이어는 시스템 계정) 행 단위 WHERE 로 걸면
    // 트레이스가 깨진다. 진입 레이어(CUBE) USER_ID 로 TRACE_ID 를 먼저 확정하는 2단계로 처리한다.
    if (filter.userId) idFilters.push([LAYER_ORDER[0], "USER_ID", filter.userId]);

    if (idFilters.length > 0) {
      const idSets = await Promise.all(
        idFilters.map(([layer, column, value]) => fetchTraceIdsBy(layer, column, value, filter))
      );
      const traceIds = idSets.reduce((acc, set) => {
        const s = new Set(set);
        return acc.filter((id) => s.has(id));
      });
      rows = traceIds.length > 0
        ? await fetchAllRows({ ...filter, facId: undefined, actionTyp: undefined, userId: undefined, traceIds, limit: undefined })
        : [];
    } else {
      rows = await fetchAllRows(filter);
    }

    const summaries = summarize(rows);
    const works = await buildWorks(summaries);
    const connectedLayers = connectedLayerCount();
    const appEnv = getAppEnv();

    logger.info("GET /api/traces done", {
      ...ctx,
      appEnv,
      rows: rows.length,
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
