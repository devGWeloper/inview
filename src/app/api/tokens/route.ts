import { NextRequest, NextResponse } from "next/server";
import { fetchTokenStats } from "@/lib/tokens";
import { TokenFilter } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GAIA LLM 호출별 토큰 사용량 집계 반환. 앱 자체 DB(GAIA)의 TRX_TOKEN_DET 에서 집계.
// 실패/미구성 시에도 fetchTokenStats 가 빈 통계(0)를 돌려주므로 항상 200.
function isoNoTz(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const ctx = reqContext(req);
  const sp = req.nextUrl.searchParams;

  const now = Date.now();
  const dateFrom = sp.get("dateFrom") || undefined;
  const dateTo = sp.get("dateTo") || undefined;

  // 기본: 최근 24시간 (stats 라우트와 동일 규칙)
  const filter: TokenFilter = {
    dateFrom: dateFrom ?? isoNoTz(now - 24 * 3_600_000),
    dateTo: dateTo ?? isoNoTz(now),
    userId: sp.get("userId") || undefined,
    nodeNm: sp.get("nodeNm") || undefined,
    modelNm: sp.get("modelNm") || undefined,
    traceId: sp.get("traceId") || undefined,
  };

  logger.info("GET /api/tokens", { ...ctx, filter });

  try {
    const stats = await fetchTokenStats(filter);
    logger.info("GET /api/tokens done", {
      ...ctx,
      calls: stats.totals.calls,
      ms: Date.now() - t0,
      status: 200,
    });
    return NextResponse.json(stats);
  } catch (e) {
    logger.error("GET /api/tokens failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    throw e;
  }
}
