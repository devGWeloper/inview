import { NextRequest, NextResponse } from "next/server";
import { logger, reqContext } from "@/lib/logger";
import { requireBiz } from "@/lib/auth/current";
import { computeStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

/**
 * 대시보드/리포트 집계.
 *
 * ⚠️ 계산은 lib/stats.ts 의 computeStats() 한 곳이다 — 일반 사용자 실적 화면(/api/insights)이
 *    같은 집계를 다른 필드 구성으로 내려보내기 때문. 여기서는 조건 파싱과 인가만 한다.
 *
 * ⚠️ 이 응답에는 사용자 ID(topUsers)·에러 코드(topErrors)·레이어 내부 지표가 들어간다.
 *    개발/운영용이며 일반 사용자(FIELD)에게 열지 않는다 — requireBiz 의 기본 min 이 DEV 라
 *    일반 사용자 세션은 여기서 403 이다.
 */
export async function GET(req: NextRequest) {
  // ⚠️ BIZ_AIACTIONTXN_HIS 는 기본 에이전트 전용이다. 다른 팀 에이전트 소속 계정은
  //    URL 을 직접 쳐도 여기서 끊는다 (미들웨어 리다이렉트는 UX, 권위는 이 판정).
  const bizGuard = await requireBiz();
  if (!bizGuard.ok) return NextResponse.json({ error: bizGuard.error }, { status: bizGuard.status });

  const t0 = Date.now();
  const ctx = reqContext(req);
  const sp = req.nextUrl.searchParams;

  // 집계 제외 에러 코드 (CSV). 해당 코드를 가진 trace 는 모든 집계에서 통째로 빠진다.
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
