import { NextRequest, NextResponse } from "next/server";
import { fetchAllRows, connectedLayerCount, getAppEnv } from "@/lib/db";
import { LAYER_ORDER, TraceFilter, TraceStatus, TraceSummary, TraceRow } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ERR_CD 컨벤션: FAIL_* = 비즈니스 validation 실패, ERROR_* = 인프라/통신 에러.
// 둘 다 아닌 코드는 안전하게 error 로 처리하고 컨벤션 위반을 warn 으로 남긴다.
function classify(rows: TraceRow[], allComplete: boolean): TraceStatus {
  const errs = rows.filter((r) => !!r.errCd);
  if (errs.length === 0) return allComplete ? "ok" : "pending";

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
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
    onlyError: sp.get("onlyError") === "true" ? true : undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 200
  };

  logger.info("GET /api/traces", { ...ctx, query: sp.toString(), filter });

  try {
    const rows = await fetchAllRows(filter);
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
