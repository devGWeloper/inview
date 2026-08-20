import { NextRequest, NextResponse } from "next/server";
import { fetchTimeoutStats } from "@/lib/timeouts";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

// 타임아웃 추적 집계. TRX_TOKEN_DET 의 실패 적재(STAT_CD/ERR_CTN)만 본다.
// 컬럼이 없으면 available=false 로 내려가고 화면이 "적재 전" 안내를 띄운다.
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

  const filter = {
    dateFrom: sp.get("dateFrom") || isoNoTz(now - 24 * 3_600_000),
    dateTo: sp.get("dateTo") || isoNoTz(now),
    nodeNm: sp.get("nodeNm") || undefined,
    modelNm: sp.get("modelNm") || undefined,
  };

  logger.info("GET /api/timeouts", { ...ctx, filter });
  try {
    const stats = await fetchTimeoutStats(filter);
    logger.info("GET /api/timeouts done", {
      ...ctx,
      timeouts: stats.timeoutCalls,
      ms: Date.now() - t0,
      status: 200,
    });
    return NextResponse.json(stats);
  } catch (e) {
    logger.error("GET /api/timeouts failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    throw e;
  }
}
