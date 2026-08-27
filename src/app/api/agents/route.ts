import { NextRequest, NextResponse } from "next/server";
import { defaultAgentId, publicAgents } from "@/lib/config";
import { AgentsResponse } from "@/lib/types";
import { getScope } from "@/lib/auth/current";
import { readProfile } from "@/lib/profile";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 에이전트 목록. Tokens/Timeout 화면의 셀렉터가 마운트 시 1회 읽는다.
// ⚠️ 접속정보는 내려가지 않는다 (publicAgents 가 dbConfigured 로만 알린다).
//
// 계정 범위(전역 / 에이전트 / 미배정)에 따라 목록을 좁힌다.
// ⚠️ 이건 **표시용 필터**일 뿐이다 — 실제 차단은 조회 3라우트
//    (/api/tokens · /api/tokens/tick · /api/timeouts)의 requireAgent 403 이 한다.
export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  const scope = await getScope();
  const all = publicAgents();
  // 전역이면 전체, 소속이 있으면 그 하나, 미배정이면 빈 목록.
  // ⚠️ 미배정에 전체를 내려주면 안 된다 — 목록이 곧 셀렉터라 그대로 조회로 이어진다.
  // ⚠️ 소속 id 가 config 에 없으면 목록이 빈다 — 화면(AgentScopeProvider)이
  //    "설정에 없는 에이전트" 안내를 띄운다. 여기서 전체로 되돌리면 결속이 무의미해진다.
  const scoped = !scope ? [] : scope.global ? all : all.filter((a) => a.id === scope.agentId);

  // 이름/아바타/한도는 화면(/admin)에서 편집한 프로필이 config.yml 값을 이긴다.
  // ⚠️ 프로필 파일이 없거나 깨져도 readProfile 이 기본값을 돌려주므로 여기서 분기하지 않는다.
  const merged = scoped.map((a) => {
    const p = readProfile(a.id);
    return {
      ...a,
      name: p.name?.trim() || a.name,
      avatar: p.avatar?.trim() || a.avatar,
      tpmLimit: p.tpmLimit > 0 ? p.tpmLimit : a.tpmLimit,
      rpmLimit: p.rpmLimit > 0 ? p.rpmLimit : a.rpmLimit,
    };
  });

  const body: AgentsResponse = {
    agents: merged,
    defaultId: merged.some((a) => a.isDefault) ? defaultAgentId() : (merged[0]?.id ?? defaultAgentId()),
  };
  logger.info("GET /api/agents", {
    ...ctx, count: body.agents.length, global: scope?.global ?? null, agentId: scope?.agentId ?? null,
  });
  return NextResponse.json(body);
}
