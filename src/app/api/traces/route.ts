import { NextRequest, NextResponse } from "next/server";
import { fetchAllRows, fetchTraceIdsBy, connectedLayerCount, getAppEnv } from "@/lib/db";
import { LAYER_ORDER, LayerKey, TraceFilter, TraceStatus, TraceSummary, TraceRow } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { classifyPendingByCubeResp } from "@/lib/tempStatus"; // TEMP: ONEOIS 미연결 대응

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
    const connectedLayers = connectedLayerCount();
    const appEnv = getAppEnv();

    logger.info("GET /api/traces done", {
      ...ctx,
      appEnv,
      rows: rows.length,
      total: summaries.length,
      connectedLayers,
      status: 200,
      ms: Date.now() - t0,
    });

    return NextResponse.json({ summaries, total: summaries.length, connectedLayers, appEnv });
  } catch (e) {
    logger.error("GET /api/traces failed", { ...ctx, status: 500, ms: Date.now() - t0, err: String(e) });
    throw e;
  }
}
