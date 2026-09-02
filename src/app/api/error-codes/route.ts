import { NextRequest, NextResponse } from "next/server";
import { loadErrorCodeMap } from "@/lib/errorCodes";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const ctx = reqContext(req);
  try {
    const codes = await loadErrorCodeMap();
    logger.info("GET /api/error-codes ok", { ...ctx, count: Object.keys(codes).length, ms: Date.now() - t0 });
    return NextResponse.json({ codes });
  } catch (e) {
    logger.error("GET /api/error-codes failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    return NextResponse.json({ codes: {} }, { status: 200 });
  }
}
