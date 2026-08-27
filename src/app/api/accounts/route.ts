import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/current";
import { listUsers, createUser, validateAgentId } from "@/lib/users";
import { isRole, roleAtLeast, resolveScope, canActOnAccount, isLockedScope } from "@/lib/roles";
import { defaultAgentId } from "@/lib/config";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 계정 목록 (BR 이상).
 * ⚠️ 자기 범위 밖 계정은 **아예 내리지 않는다** — 에이전트 운영자에게 다른 팀 명단이
 *    보이면 안 되고, 어차피 수정/삭제도 403 이라 목록에만 남기면 혼란만 준다.
 */
export async function GET(_req: NextRequest) {
  const guard = await requireRole("BR");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const scope = resolveScope(guard.session);
  const result = await listUsers();
  return NextResponse.json({
    ...result,
    users: result.users.filter((u) => canActOnAccount(scope, u)),
    // 화면이 "전역 토글/에이전트 선택" 을 보여줄지 정하는 데 쓴다.
    canGrantGlobal: scope.global && roleAtLeast(guard.session.role, "ADMIN"),
    actorAgentId: scope.agentId,
    actorGlobal: scope.global,
  });
}

/**
 * 계정 생성 (BR 이상).
 * - 초기 비밀번호 = 사번(USER_ID). ⚠️ TEMP: 최초 로그인 강제 변경은 임시로 뺐다(CLAUDE.md TEMP 절).
 * - 권한 상향 방지: ADMIN 계정은 ADMIN 만 생성할 수 있다(BR 은 BR/DEV 만).
 * - 범위 상향 방지: 에이전트 운영자는 **자기 에이전트 소속으로만** 만들 수 있고,
 *   전역 계정은 전역 운영자만 만든다.
 */
export async function POST(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireRole("BR");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const scope = resolveScope(guard.session);
  const actorIsAdmin = roleAtLeast(guard.session.role, "ADMIN");

  // 미배정 계정은 관리할 대상 자체가 없다.
  if (isLockedScope(scope)) {
    return NextResponse.json({ error: "에이전트가 배정되지 않은 계정은 계정을 생성할 수 없습니다." }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const role = body.role;
    if (!isRole(role)) return NextResponse.json({ error: "권한 값이 올바르지 않습니다." }, { status: 400 });
    if (role === "ADMIN" && !actorIsAdmin) {
      return NextResponse.json({ error: "운영자(ADMIN) 계정은 운영자만 생성할 수 있습니다." }, { status: 403 });
    }
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";

    // ── 범위(전역 / 소속 에이전트) 결정 ────────────────────────────────────
    // ⚠️ 키가 없으면 users.ts 에도 넘기지 않는다 — 넘기면 "그 컬럼을 쓰겠다" 는 의사표시가
    //    되어 ALTER 전에는 범위와 무관한 계정 생성까지 실패한다.
    const scopePatch: { agentId?: string | null; global?: boolean } = {};

    if (body.global !== undefined) {
      // 전역 부여는 전역 운영자만. (전역 = 최대 범위라 명백한 상향)
      if (!scope.global || !actorIsAdmin) {
        return NextResponse.json({ error: "전역 권한은 전역 운영자만 부여할 수 있습니다." }, { status: 403 });
      }
      // ⚠️ **참일 때만** 키를 넘긴다. 거짓은 컬럼 DEFAULT 'N' 과 같은 결과인데,
      //    키를 넘기면 "GLOBAL_YN 을 쓰겠다" 는 의사표시가 되어 ALTER 전 환경에서
      //    평범한 계정 생성까지 실패한다.
      if (body.global === true) scopePatch.global = true;
    }

    if (scope.global) {
      // 전역 운영자만 소속을 자유롭게 지정한다.
      if (body.agentId !== undefined) {
        if (!actorIsAdmin) {
          return NextResponse.json({ error: "에이전트 배정은 운영자만 지정할 수 있습니다." }, { status: 403 });
        }
        const checked = validateAgentId(body.agentId);
        if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
        scopePatch.agentId = checked.value;
      } else if (scopePatch.global !== true) {
        // ⚠️ 범위를 아무것도 지정하지 않은 생성 요청은 **기본 에이전트 소속**으로 만든다.
        //    그대로 두면 AGENT_ID NULL + GLOBAL_YN 'N' = 잠금 계정이 되어, 만든 사람도
        //    받는 사람도 왜 아무것도 안 보이는지 모르는 상태가 된다.
        scopePatch.agentId = defaultAgentId();
      }
    } else {
      // 에이전트 운영자/BR: 소속은 **항상 자기 에이전트**로 고정한다.
      // ⚠️ 요청 값을 무시하지 않고, 다른 값이면 명시적으로 거절한다 — 조용히 바꿔치기하면
      //    화면에서는 지정한 대로 저장된 줄 안다.
      if (body.agentId !== undefined && (body.agentId ?? null) !== scope.agentId) {
        return NextResponse.json({ error: "다른 에이전트 소속으로는 만들 수 없습니다." }, { status: 403 });
      }
      scopePatch.agentId = scope.agentId;
      // global 은 넘기지 않는다 — 컬럼 DEFAULT 가 'N' 이라 결과가 같고,
      // 키를 넘기면 ALTER 전 환경에서 생성이 통째로 실패한다.
    }

    const user = await createUser({
      userId,
      name: typeof body.name === "string" ? body.name : "",
      work: typeof body.work === "string" ? body.work : null,
      role,
      password: userId, // 초기 비밀번호 = 사번
      useYn: body.useYn === "N" ? "N" : "Y",
      ...scopePatch,
    });
    logger.info("account created", {
      ...ctx, by: guard.session.sub, userId: user.userId, role: user.role,
      agentId: user.agentId, global: user.global,
    });
    return NextResponse.json({ user });
  } catch (e) {
    logger.warn("account create failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e).replace(/^Error:\s*/, "") }, { status: 400 });
  }
}
