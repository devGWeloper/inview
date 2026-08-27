import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { resolveScope } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 현재 로그인 사용자. 비로그인이면 { user: null } (200) — 클라이언트 셸이 조용히 처리. */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });

  // ⚠️ 범위는 반드시 resolveScope 로 푼다 — 옛 쿠키(scope 키 없음)까지 여기서 흡수한다.
  const scope = resolveScope(session);
  return NextResponse.json({
    user: {
      userId: session.sub,
      name: session.name,
      role: session.role,
      // agentId = 소속 에이전트(없으면 null), global = 전 에이전트 접근.
      // 화면은 이 둘로 셀렉터/탭/안내를 정한다(AgentScopeProvider).
      agentId: scope.agentId,
      global: scope.global,
    },
  });
}
