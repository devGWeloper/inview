import { NextRequest, NextResponse } from "next/server";
import { fetchAllRows, connectedLayerCount, getAppEnv } from "@/lib/db";
import { TraceFilter, TraceSummary, TraceRow } from "@/lib/types";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

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
    summaries.push({
      traceId,
      userId: list.find((r) => r.userId)?.userId ?? null,
      firstRecvTm: recvTimes[0] ?? null,
      lastSendTm: sendTimes.length ? sendTimes[sendTimes.length - 1] : null,
      layerCount: layerSet.size,
      hasError: list.some((r) => !!r.errCd),
      allComplete: layerSet.size === 5 && list.every((r) => r.sendCompltYn === "Y")
    });
  }

  summaries.sort((a, b) => (b.firstRecvTm ?? "").localeCompare(a.firstRecvTm ?? ""));
  return summaries;
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const sp = req.nextUrl.searchParams;
  const filter: TraceFilter = {
    traceId: sp.get("traceId") || undefined,
    userId: sp.get("userId") || undefined,
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
    onlyError: sp.get("onlyError") === "true" ? true : undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 200
  };

  logger.info("GET /api/traces", { filter });

  const rows = await fetchAllRows(filter);
  const summaries = summarize(rows);
  const connectedLayers = connectedLayerCount();
  const appEnv = getAppEnv();

  logger.info("GET /api/traces done", { appEnv, total: summaries.length, connectedLayers, ms: Date.now() - t0 });

  return NextResponse.json({ summaries, total: summaries.length, connectedLayers, appEnv });
}
