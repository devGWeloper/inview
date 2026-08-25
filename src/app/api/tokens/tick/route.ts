import { NextRequest, NextResponse } from "next/server";
import { fetchTickStats } from "@/lib/tickStats";
import { TickFilter } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { defaultAgentId, getAgent } from "@/lib/config";
import { getSession } from "@/lib/auth/current";

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

  // ⚠️ 알 수 없는 id 는 400 이다. 조용히 기본 에이전트로 폴백하면
  //    다른 에이전트의 수치를 자기 것으로 오독하게 된다.
  // ⚠️ trim 필수 — "?agent=%20"(공백)이 그대로 들어오면 getAgent() 는 trim 후 빈 문자열이라
  //    기본 에이전트로 취급해 통과시키지만, agentId 는 공백 그대로 남아 echo 비교(클라이언트의
  //    응답 폐기 판정)를 무력화한다. 여기서 미리 걸러 공백만 있는 값은 "없음"으로 취급한다.
  const rawAgent = sp.get("agent")?.trim() || undefined;
  if (rawAgent && !getAgent(rawAgent)) {
    logger.warn("GET /api/tokens/tick unknown agent", { ...ctx, agent: rawAgent });
    return NextResponse.json({ error: `알 수 없는 에이전트: ${rawAgent}` }, { status: 400 });
  }
  const agentId = rawAgent ?? defaultAgentId();

  // ⚠️ 계정이 특정 에이전트에 묶여 있으면(TRX_USER_MAS.AGENT_ID → 세션) 그 밖은 403.
  //    400(알 수 없는 id) 판정 **뒤**, DB 조회 **앞**에 둔다 —
  //    "그런 에이전트는 없다" 와 "네 것이 아니다" 는 다른 답이고,
  //    권한 밖 요청은 커넥션을 열기 전에 끊는다.
  const session = await getSession();
  if (session?.agentId && agentId !== session.agentId) {
    logger.warn("GET /api/tokens/tick agent scope violation", { ...ctx, want: agentId, allowed: session.agentId });
    return NextResponse.json({ error: "이 에이전트에 접근할 권한이 없습니다." }, { status: 403 });
  }

  const now = Date.now();
  // 기본: 최근 60분 (화면 기본 창과 동일)
  const filter: TickFilter = {
    dateFrom: sp.get("dateFrom") || isoNoTz(now - 60 * 60_000),
    dateTo: sp.get("dateTo") || isoNoTz(now),
    userId: sp.get("userId") || undefined,
    nodeNm: sp.get("nodeNm") || undefined,
    modelNm: sp.get("modelNm") || undefined,
    agentId,
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
    return NextResponse.json({ ...stats, agentId });
  } catch (e) {
    logger.error("GET /api/tokens/tick failed", { ...ctx, err: String(e), ms: Date.now() - t0 });
    throw e;
  }
}
