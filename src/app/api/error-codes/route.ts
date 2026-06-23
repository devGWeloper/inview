import { NextRequest, NextResponse } from "next/server";
import { loadErrorCodeMap } from "@/lib/errorCodes";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

// 에러 코드 → 의미 매핑 반환. 앱 자체 DB(GAIA)의 TRX_ERRMSG_COD 에서 로드.
// 실패/미구성 시에도 200 + 빈 맵으로 응답해 대시보드가 깨지지 않게 한다.
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
