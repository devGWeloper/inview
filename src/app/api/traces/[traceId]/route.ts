import { NextRequest, NextResponse } from "next/server";
import { fetchByTraceId } from "@/lib/db";
import { logger, reqContext } from "@/lib/logger";
import { requireBiz } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { traceId: string } }
) {
  const t0 = Date.now();
  const ctx = reqContext(req);
  const traceId = decodeURIComponent(params.traceId);

  // ⚠️ BIZ_AIACTIONTXN_HIS 는 기본 에이전트 전용 — 다른 팀 에이전트 소속 계정은 여기서 끊는다.
  const bizGuard = await requireBiz();
  if (!bizGuard.ok) return NextResponse.json({ error: bizGuard.error }, { status: bizGuard.status });


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
