import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/current";
import { listUsers, createUser, validateAgentId } from "@/lib/users";
import { isRole, roleAtLeast } from "@/lib/roles";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 계정 목록 (BR 이상). 미들웨어에서도 막지만 방어적으로 재확인. */
export async function GET(_req: NextRequest) {
  const guard = await requireRole("BR");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const result = await listUsers();
  return NextResponse.json(result);
}

/**
 * 계정 생성 (BR 이상).
 * - 초기 비밀번호 = 사번(USER_ID). ⚠️ TEMP: 최초 로그인 강제 변경은 임시로 뺐다(CLAUDE.md TEMP 절).
 * - 권한 상향 방지: ADMIN 계정은 ADMIN 만 생성할 수 있다(BR 은 BR/DEV 만).
 * - 에이전트 결속(agentId)도 ADMIN 만 지정할 수 있다 — BR 이 조회 범위를 넓히지 못하게.
 */
export async function POST(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireRole("BR");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const body = await req.json().catch(() => ({}));
    const role = body.role;
    if (!isRole(role)) return NextResponse.json({ error: "권한 값이 올바르지 않습니다." }, { status: 400 });
    if (role === "ADMIN" && !roleAtLeast(guard.session.role, "ADMIN")) {
      return NextResponse.json({ error: "운영자(ADMIN) 계정은 운영자만 생성할 수 있습니다." }, { status: 403 });
    }
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";

    // 에이전트 결속은 ADMIN 만 손댈 수 있다 (권한 상향 방지 — ROLE 과 같은 패턴).
    // ⚠️ NULL = 전 에이전트라, 결속을 지우는 것도 범위를 넓히는 행위다.
    // ⚠️ 키가 없으면 createUser 에도 넘기지 않는다 — 넘기면 "결속을 쓰겠다" 는 의사표시가 되어
    //    ALTER 전(AGENT_ID 컬럼 없음)에는 결속과 무관한 계정 생성까지 실패한다.
    const agentPatch: { agentId?: string | null } = {};
    if (body.agentId !== undefined) {
      if (!roleAtLeast(guard.session.role, "ADMIN")) {
        return NextResponse.json({ error: "에이전트 결속은 운영자만 지정할 수 있습니다." }, { status: 403 });
      }
      // config.yml 에 없는 id 를 저장하면 그 계정은 아무것도 조회하지 못한다 — 여기서 막는다.
      const checked = validateAgentId(body.agentId);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      agentPatch.agentId = checked.value;
    }

    const user = await createUser({
      userId,
      name: typeof body.name === "string" ? body.name : "",
      work: typeof body.work === "string" ? body.work : null,
      role,
      password: userId, // 초기 비밀번호 = 사번
      useYn: body.useYn === "N" ? "N" : "Y",
      ...agentPatch,
    });
    logger.info("account created", {
      ...ctx, by: guard.session.sub, userId: user.userId, role: user.role, agentId: user.agentId,
    });
    return NextResponse.json({ user });
  } catch (e) {
    logger.warn("account create failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e).replace(/^Error:\s*/, "") }, { status: 400 });
  }
}
