import { NextRequest, NextResponse } from "next/server";
import { fetchAllRows, fetchRecentTraceIds, fetchTraceIdsBy, fetchWorkGroupRows, connectedLayerCount, getAppEnv } from "@/lib/db";
import { LAYER_ORDER, LayerKey, TraceFilter, TraceStatus, TraceSummary, TraceRow, WorkSummary } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { isoNoTz } from "@/lib/timeBuckets";
import { classifyPendingByCubeResp } from "@/lib/tempStatus"; // TEMP: ONEOIS 미연결 대응
import { TraceWorkInfo, WORK_WINDOW_HOURS, groupTracesIntoWorks, rollupStatus, shiftLocalIso } from "@/lib/workGroup"; // TEMP(WORK_GROUP)
import { requireBiz } from "@/lib/auth/current";

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

/**
 * 에러 조건(errCd / onlyError)은 **트레이스 단위**로 판정한다.
 * 행 단위 SQL WHERE 로 걸면 에러가 없는 다른 레이어 행이 통째로 빠져,
 * 실제로는 전 레이어를 거친 트레이스인데 LAYERS 점이 하나만 켜진 것처럼 보인다.
 * (stats route 가 userId/actionTyp 를 트레이스 단위로 거르는 것과 같은 원칙)
 */
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

/** 형제 TRACE 를 채우려고 추가 조회하는 최대 건수 (Oracle IN 목록 상한 여유) */
const MAX_SIBLING_TRACES = 500;

/** 목록 기본 상한 (TRACE 건수). db.ts 가 최대 500 으로 clamp 한다 */
const DEFAULT_LIMIT = 500;

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
async function buildWorks(
  matched: TraceSummary[],
  /** 이미 만들어 둔 TRACE→묶음 매핑 (묶음만 조회 경로가 넘긴다). 없으면 여기서 GAIA 를 읽는다 */
  preInfo?: Map<string, TraceWorkInfo>
): Promise<WorkSummary[]> {
  if (matched.length === 0) return [];

  // 묶음 경계가 정확해지려면 화면에 걸린 TRACE 의 시간 범위보다 앞뒤로 윈도우만큼 더 읽어야 한다.
  // 앞: 어제 22시 전값 + 오늘 2시 후값이 갈라지는 걸 막는다.
  // 뒤: 걸린 TRACE 가 흐름의 앞단(전값)일 때 뒤따라온 후값/ERMAP 을 같이 집는다.
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

/**
 * [TEMP][WORK_GROUP] "묶음만" 조회를 위해 순서를 뒤집는다.
 *
 * 목록 상한(limit)은 트레이스 단위라, 묶음이 드문 기간에는 최근 N 트레이스 안에
 * 묶음이 한 건도 안 걸릴 수 있다 — 실제로는 있는데 화면은 계속 빈다. 그래서 이 경로는
 * GAIA 소스로 **묶음을 먼저 산출**하고, TRACE 2건 이상인 묶음만 최신순으로 골라
 * 그 묶음에 든 TRACE 를 (묶음 단위로 통째로) limit 만큼 가져온다.
 *
 * 소스 조회는 `fetchWorkGroupRows`(GAIA 4개 컬럼, 최근 5000행 상한)라 기간을 넓게 잡아도 가볍다.
 */
const GROUPED_SCAN_HOURS = 24 * 365; // 기간 '전체'일 때 훑는 범위 (행 상한이 실질 경계)

async function resolveGroupedTraceIds(
  filter: TraceFilter,
  limit: number
): Promise<{ traceIds: string[]; info: Map<string, TraceWorkInfo> }> {
  const nowIso = isoNoTz(Date.now());
  // 묶음이 기간 경계에 걸려 갈라지지 않게 앞뒤로 윈도우만큼 넓혀 읽는다 (buildWorks 와 같은 이유)
  const to = shiftLocalIso(filter.dateTo ?? nowIso, WORK_WINDOW_HOURS);
  const from = filter.dateFrom
    ? shiftLocalIso(filter.dateFrom, -WORK_WINDOW_HOURS)
    : shiftLocalIso(nowIso, -GROUPED_SCAN_HOURS);

  const sourceRows = await fetchWorkGroupRows(from, to);
  const info = groupTracesIntoWorks(sourceRows, WORK_WINDOW_HOURS);

  // 묶음별 TRACE 목록 + 마지막 시각 (최신 묶음부터 담기 위해)
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

  // TRACE 2건 이상 = 묶음. 최신 묶음부터 통째로 담되 상한을 넘기면 멈춘다(묶음을 쪼개지 않는다).
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
  // ⚠️ BIZ_AIACTIONTXN_HIS 는 기본 에이전트 전용이다. 다른 팀 에이전트 소속 계정은
  //    URL 을 직접 쳐도 여기서 끊는다 (미들웨어 리다이렉트는 UX, 권위는 이 판정).
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
    // 목록 상한 = TRACE(묶음이면 그 안의 TRACE) 건수. 2단계 조회가 TRACE_ID IN (...) 이라
    // Oracle IN 목록 상한(1000)에 여유를 두고 db.ts 가 500 으로 clamp 한다.
    limit: sp.get("limit") ? Number(sp.get("limit")) : DEFAULT_LIMIT
  };
  // 묶음(TRACE 2건 이상)만 보기 — 조회 순서가 아예 달라진다(resolveGroupedTraceIds 참고)
  const groupedOnly = sp.get("groupedOnly") === "true";

  logger.info("GET /api/traces", { ...ctx, query: sp.toString(), filter });

  try {
    // FAC(FAB)/ACTION_TYP 필터: 일부 레이어만 기록하는 컬럼이라 2단계로 조회한다 —
    // 1) 기록 레이어 DB 에서 조건에 맞는 최근 TRACE_ID 확정(드롭다운 옵션 출처와 동일 DB:
    //    FAC_ID=MCP(/api/facs), ACTION_TYP=GAIA(/api/action-types))
    // 2) 그 ID 들의 전 레이어 행을 traceIds IN 으로 조회 (두 필터 동시 사용 시 교집합)
    const idFilters: Array<[LayerKey, "FAC_ID" | "ACTION_TYP" | "USER_ID", string]> = [];
    if (filter.facId) idFilters.push(["MCP", "FAC_ID", filter.facId]);
    if (filter.actionTyp) idFilters.push(["GAIA", "ACTION_TYP", filter.actionTyp]);
    // USER_ID 는 레이어마다 값이 다를 수 있어(하위 레이어는 시스템 계정) 행 단위 WHERE 로 걸면
    // 트레이스가 깨진다. 진입 레이어(CUBE) USER_ID 로 TRACE_ID 를 먼저 확정하는 2단계로 처리한다.
    if (filter.userId) idFilters.push([LAYER_ORDER[0], "USER_ID", filter.userId]);

    // 조건에 걸린 TRACE_ID 를 확정하는 보조 조회 (묶음만 경로에서는 묶음을 좁히는 데 쓴다)
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

    // 1단계 — 보여줄 TRACE_ID 확정. 상한(limit)은 반드시 여기서 트레이스 단위로 건다.
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

    // 2단계 — 그 TRACE 들의 전 레이어 행을 통째로 읽는다. 여기서는 행 단위 필터를 걸지 않는다:
    // 무엇을 찾을지는 1단계가 이미 정했고, 찾은 트레이스는 있는 그대로 보여줘야
    // LAYERS 점이 실제 도달한 레이어와 일치한다. (lean = 목록에 안 쓰는 본문 컬럼 제외)
    let rows: TraceRow[] = traceIds.length > 0 ? await fetchAllRows({ traceIds, lean: true }) : [];
    if (!groupedOnly) rows = keepErrorMatchingTraces(rows, filter);

    const summaries = summarize(rows);
    let works = await buildWorks(summaries, groupInfo);

    if (groupedOnly) {
      // 묶음만 — 나머지 조건은 "그 조건에 걸린 TRACE 를 가진 묶음" 으로 본다(묶음을 쪼개지 않는다)
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
