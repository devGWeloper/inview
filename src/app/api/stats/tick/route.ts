import { NextRequest, NextResponse } from "next/server";
import { fetchBizTickStats } from "@/lib/bizTickStats";
import { BizTickFilter } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { requireBiz } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

// 1TICK(BIZ) — 진입 레이어 기준 분당 요청/실패. Dashboard 의 "틱" 뷰가 호출한다.
//
// ⚠️ 경로가 /api/stats/tick 이 아닌 이유: 그쪽엔 [traceId] 동적 세그먼트가 있어
//    "tick" 이라는 이름의 트레이스와 경로가 겹친다. 대시보드 데이터 라우트(/api/stats)의
//    형제로 두는 편이 소속도 맞다.
//
// ⚠️ BIZ_AIACTIONTXN_HIS 기반이라 **기본 에이전트 전용**이다 (requireBiz, 기본 min=DEV).
//    LLM 소스의 /api/tokens/tick 과 달리 ?agent 를 받지 않는다 — 에이전트가 갈리는 건
//    TRX_TOKEN_DET 뿐이고 BIZ 는 앱 전체에 한 벌이다.
// 실패/미구성 시에도 fetchBizTickStats 가 빈 격자를 돌려주므로 항상 200.

function isoNoTz(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const ctx = reqContext(req);

  const guard = await requireBiz();
  if (!guard.ok) {
    logger.warn("GET /api/stats/tick denied", { ...ctx, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const sp = req.nextUrl.searchParams;
  const now = Date.now();
  // 기본: 최근 60분 (화면 기본 창과 동일)
  const filter: BizTickFilter = {
    dateFrom: sp.get("dateFrom") || isoNoTz(now - 60 * 60_000),
    dateTo: sp.get("dateTo") || isoNoTz(now),
    userId: sp.get("userId") || undefined,
  };

  logger.info("GET /api/stats/tick", { ...ctx, filter });

  try {
    const stats = await fetchBizTickStats(filter);
    logger.info("GET /api/stats/tick done", {
      ...ctx,
      minutes: stats.minutes.length,
      peakA: stats.peakA.value,
      peakB: stats.peakB.value,
      ms: Date.now() - t0,
      status: 200,
    });
    return NextResponse.json(stats);
  } catch (e) {
    logger.error("GET /api/stats/tick failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    throw e;
  }
}
