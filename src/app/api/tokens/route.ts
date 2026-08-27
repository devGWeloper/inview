import { NextRequest, NextResponse } from "next/server";
import { fetchTokenStats } from "@/lib/tokens";
import { TokenFilter } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { defaultAgentId, getAgent } from "@/lib/config";
import { requireAgent } from "@/lib/auth/current";

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

  // ⚠️ 알 수 없는 id 는 400 이다. 조용히 기본 에이전트로 폴백하면
  //    다른 에이전트의 수치를 자기 것으로 오독하게 된다.
  // ⚠️ trim 필수 — "?agent=%20"(공백)이 그대로 들어오면 getAgent() 는 trim 후 빈 문자열이라
  //    기본 에이전트로 취급해 통과시키지만, agentId 는 공백 그대로 남아 echo 비교(클라이언트의
  //    응답 폐기 판정)를 무력화한다. 여기서 미리 걸러 공백만 있는 값은 "없음"으로 취급한다.
  const rawAgent = sp.get("agent")?.trim() || undefined;
  if (rawAgent && !getAgent(rawAgent)) {
    logger.warn("GET /api/tokens unknown agent", { ...ctx, agent: rawAgent });
    return NextResponse.json({ error: `알 수 없는 에이전트: ${rawAgent}` }, { status: 400 });
  }
  const agentId = rawAgent ?? defaultAgentId();

  // ⚠️ 계정 범위 밖이면 403 (전역이 아니고 소속 에이전트도 다른 경우 · 미배정 계정 포함).
  //    400(알 수 없는 id) 판정 **뒤**, DB 조회 **앞**에 둔다 —
  //    "그런 에이전트는 없다" 와 "네 것이 아니다" 는 다른 답이고,
  //    권한 밖 요청은 커넥션을 열기 전에 끊는다.
  const guard = await requireAgent(agentId);
  if (!guard.ok) {
    logger.warn("GET /api/tokens agent scope denied", { ...ctx, want: agentId, status: guard.status });
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // 기본: 최근 24시간 (stats 라우트와 동일 규칙)
  const filter: TokenFilter = {
    dateFrom: dateFrom ?? isoNoTz(now - 24 * 3_600_000),
    dateTo: dateTo ?? isoNoTz(now),
    userId: sp.get("userId") || undefined,
    nodeNm: sp.get("nodeNm") || undefined,
    modelNm: sp.get("modelNm") || undefined,
    traceId: sp.get("traceId") || undefined,
    agentId,
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
    return NextResponse.json({ ...stats, agentId });
  } catch (e) {
    logger.error("GET /api/tokens failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    throw e;
  }
}
