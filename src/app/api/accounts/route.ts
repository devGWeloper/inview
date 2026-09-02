import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/current";
import { listUsers, createUser, validateAgentId } from "@/lib/users";
import { isRole, roleAtLeast, resolveScope, canActOnAccount, isLockedScope, scopeErrorForRole } from "@/lib/roles";
import { defaultAgentId } from "@/lib/config";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const scope = resolveScope(guard.session);
  const result = await listUsers();
  return NextResponse.json({
    ...result,
    users: result.users.filter((u) => canActOnAccount(scope, u)),
    canGrantGlobal: scope.global && roleAtLeast(guard.session.role, "ADMIN"),
    actorAgentId: scope.agentId,
    actorGlobal: scope.global,
  });
}

/**
 * 계정 생성 (ADMIN). 초기 비밀번호 = 사번 — TEMP(강제 변경 비활성).
 * 권한·범위 상향 방지: ADMIN 계정과 전역 계정은 각각 ADMIN·전역 운영자만 만든다.
 */
export async function POST(req: NextRequest) {
  const ctx = reqContext(req);
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const scope = resolveScope(guard.session);
  const actorIsAdmin = roleAtLeast(guard.session.role, "ADMIN");

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

    const scopePatch: { agentId?: string | null; global?: boolean } = {};

    if (body.global !== undefined) {
      if (!scope.global || !actorIsAdmin) {
        return NextResponse.json({ error: "전역 권한은 전역 운영자만 부여할 수 있습니다." }, { status: 403 });
      }
      if (body.global === true) scopePatch.global = true;
    }

    if (scope.global) {
      if (body.agentId !== undefined) {
        if (!actorIsAdmin) {
          return NextResponse.json({ error: "에이전트 배정은 운영자만 지정할 수 있습니다." }, { status: 403 });
        }
        const checked = validateAgentId(body.agentId);
        if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
        scopePatch.agentId = checked.value;
      } else if (scopePatch.global !== true) {
        scopePatch.agentId = defaultAgentId();
      }
    } else {
      if (body.agentId !== undefined && (body.agentId ?? null) !== scope.agentId) {
        return NextResponse.json({ error: "다른 에이전트 소속으로는 만들 수 없습니다." }, { status: 403 });
      }
      scopePatch.agentId = scope.agentId;
    }

    const scopeErr = scopeErrorForRole(
      role,
      { global: scopePatch.global === true, agentId: scopePatch.agentId ?? null },
      defaultAgentId()
    );
    if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 400 });

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
