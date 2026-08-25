import { NextRequest, NextResponse } from "next/server";
import { defaultAgentId, publicAgents } from "@/lib/config";
import { AgentsResponse } from "@/lib/types";
import { getSession } from "@/lib/auth/current";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

// 에이전트 목록. Tokens/Timeout 화면의 셀렉터가 마운트 시 1회 읽는다.
// ⚠️ 접속정보는 내려가지 않는다 (publicAgents 가 dbConfigured 로만 알린다).
//
// 계정이 특정 에이전트에 묶여 있으면(TRX_USER_MAS.AGENT_ID → 세션 payload) 그 하나만 내린다.
// 결속 없음(NULL = 운영자·기존 계정)이면 전체다.
// ⚠️ 이건 **표시용 필터**일 뿐이다 — 실제 차단은 조회 3라우트
//    (/api/tokens · /api/tokens/tick · /api/timeouts)의 403 이 한다.
export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  const session = await getSession();
  const all = publicAgents();
  const scoped = session?.agentId ? all.filter((a) => a.id === session.agentId) : all;
  // 결속 계정에는 그 에이전트가 곧 기본이다.
  // ⚠️ 결속 id 가 config 에 없으면 목록이 빈다 — 화면(AgentScopeProvider)이
  //    "설정에 없는 에이전트" 안내를 띄운다. 여기서 전체로 되돌리면 결속이 무의미해진다.
  const body: AgentsResponse = {
    agents: scoped,
    defaultId: scoped.some((a) => a.isDefault) ? defaultAgentId() : (scoped[0]?.id ?? defaultAgentId()),
  };
  logger.info("GET /api/agents", { ...ctx, count: body.agents.length, boundTo: session?.agentId ?? null });
  return NextResponse.json(body);
}
