import { NextRequest, NextResponse } from "next/server";
import { logger, reqContext } from "@/lib/logger";
import { requireBiz } from "@/lib/auth/current";
import { computeStats } from "@/lib/stats";
import { parseGranularityParam } from "@/lib/timeBuckets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bizGuard = await requireBiz();
  if (!bizGuard.ok) return NextResponse.json({ error: bizGuard.error }, { status: bizGuard.status });

  const t0 = Date.now();
  const ctx = reqContext(req);
  const sp = req.nextUrl.searchParams;

  const excludeErrCds = (sp.get("excludeErrCds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const query = {
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
    userId: sp.get("userId") || undefined,
    actionTyp: sp.get("actionTyp") || undefined,
    excludeErrCds,
    gran: parseGranularityParam(sp.get("g")),
  };

  logger.info("GET /api/stats", { ...ctx, ...query });

  try {
    const { stats, rawRowCount } = await computeStats(query);
    logger.info("GET /api/stats done", {
      ...ctx,
      rows: rawRowCount,
      includedRows: stats.rowCount,
      traces: stats.totals.total,
      excludedTraces: stats.excludedTraceCount,
      ms: Date.now() - t0,
      status: 200,
    });
    return NextResponse.json(stats);
  } catch (e) {
    logger.error("GET /api/stats failed", { ...ctx, status: 500, ms: Date.now() - t0, err: String(e) });
    throw e;
  }
}
