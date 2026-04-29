import { NextRequest, NextResponse } from "next/server";
import { fetchByTraceId } from "@/lib/db";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { traceId: string } }
) {
  const t0 = Date.now();
  const ctx = reqContext(req);
  const traceId = decodeURIComponent(params.traceId);

  logger.info("GET /api/traces/[traceId]", { ...ctx, traceId });

  try {
    const rows = await fetchByTraceId(traceId);

    logger.info("GET /api/traces/[traceId] done", {
      ...ctx,
      traceId,
      rows: rows.length,
      status: 200,
      ms: Date.now() - t0,
    });

    return NextResponse.json({ traceId, rows });
  } catch (e) {
    logger.error("GET /api/traces/[traceId] failed", {
      ...ctx,
      traceId,
      status: 500,
      ms: Date.now() - t0,
      err: String(e),
    });
    throw e;
  }
}
