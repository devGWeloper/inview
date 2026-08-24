import { NextRequest, NextResponse } from "next/server";
import { fetchTickStats } from "@/lib/tickStats";
import { TickFilter } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

// 1TICK — 분당 TPM/RPM 모니터. Tokens 탭의 "1TICK" 프리셋이 호출한다.
// 집계 대상은 /api/tokens 와 같은 TRX_TOKEN_DET 이지만, 격자가 초/분 단위이고
// 슬라이딩 60초 최대까지 내려주므로 응답 형태가 달라 라우트를 분리했다.
// 실패/미구성 시에도 fetchTickStats 가 빈 격자를 돌려주므로 항상 200.

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
  // 기본: 최근 60분 (화면 기본 창과 동일)
  const filter: TickFilter = {
    dateFrom: sp.get("dateFrom") || isoNoTz(now - 60 * 60_000),
    dateTo: sp.get("dateTo") || isoNoTz(now),
    userId: sp.get("userId") || undefined,
    nodeNm: sp.get("nodeNm") || undefined,
    modelNm: sp.get("modelNm") || undefined,
  };

  logger.info("GET /api/tokens/tick", { ...ctx, filter });

  try {
    const stats = await fetchTickStats(filter);
    logger.info("GET /api/tokens/tick done", {
      ...ctx,
      minutes: stats.minutes.length,
      peakTpm: stats.peakTpm.value,
      peakRpm: stats.peakRpm.value,
      ms: Date.now() - t0,
      status: 200,
    });
    return NextResponse.json(stats);
  } catch (e) {
    logger.error("GET /api/tokens/tick failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    throw e;
  }
}
