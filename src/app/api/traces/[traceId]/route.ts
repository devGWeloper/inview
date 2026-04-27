import { NextRequest, NextResponse } from "next/server";
import { fetchByTraceId } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { traceId: string } }
) {
  const t0 = Date.now();
  const traceId = decodeURIComponent(params.traceId);

  logger.info("GET /api/traces/[traceId]", { traceId });

  const rows = await fetchByTraceId(traceId);

  logger.info("GET /api/traces/[traceId] done", { traceId, rows: rows.length, ms: Date.now() - t0 });

  return NextResponse.json({ traceId, rows });
}
