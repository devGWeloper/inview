import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/current";
import { updateUser, deleteUser, getUser, UpdateUserInput, validateAgentId } from "@/lib/users";
import { isRole, roleAtLeast, resolveScope, canActOnAccount, scopeErrorForRole } from "@/lib/roles";
import { defaultAgentId } from "@/lib/config";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: { params: { userId: string } }) {
  const ctx = reqContext(req);
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const actorIsAdmin = roleAtLeast(guard.session.role, "ADMIN");
  const scope = resolveScope(guard.session);

  const targetId = decodeURIComponent(params.userId);
  try {
    const target = await getUser(targetId);
    if (!target) return NextResponse.json({ error: "존재하지 않는 계정입니다." }, { status: 404 });
    if (!canActOnAccount(scope, target)) {
      return NextResponse.json({ error: "존재하지 않는 계정입니다." }, { status: 404 });
    }
    if (target.role === "ADMIN" && !actorIsAdmin) {
      return NextResponse.json({ error: "운영자 계정은 운영자만 수정할 수 있습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const input: UpdateUserInput = {};
    if (typeof body.name === "string") input.name = body.name;
    if (typeof body.work === "string" || body.work === null) input.work = body.work;
    if (body.role !== undefined) {
      if (!isRole(body.role)) return NextResponse.json({ error: "권한 값이 올바르지 않습니다." }, { status: 400 });
      if (body.role === "ADMIN" && !actorIsAdmin) {
        return NextResponse.json({ error: "운영자(ADMIN) 권한은 운영자만 부여할 수 있습니다." }, { status: 403 });
      }
      input.role = body.role;
    }
    if (body.useYn !== undefined) input.useYn = body.useYn === "N" ? "N" : "Y";
    if (body.agentId !== undefined) {
      if (!actorIsAdmin || !scope.global) {
        return NextResponse.json({ error: "에이전트 배정은 전역 운영자만 변경할 수 있습니다." }, { status: 403 });
      }
      const checked = validateAgentId(body.agentId);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      input.agentId = checked.value;
    }
    if (body.global !== undefined) {
      if (!actorIsAdmin || !scope.global) {
        return NextResponse.json({ error: "전역 권한은 전역 운영자만 변경할 수 있습니다." }, { status: 403 });
      }
      input.global = body.global === true;
    }

    const scopeErr = scopeErrorForRole(
      input.role ?? target.role,
      {
        global: input.global !== undefined ? input.global : target.global,
        agentId: input.agentId !== undefined ? input.agentId : target.agentId,
      },
      defaultAgentId()
    );
    if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 400 });

    if (targetId === guard.session.sub) {
      if (input.role && input.role !== guard.session.role) {
        return NextResponse.json({ error: "본인 계정의 권한은 스스로 바꿀 수 없습니다." }, { status: 400 });
      }
      if (input.useYn === "N") {
        return NextResponse.json({ error: "본인 계정은 비활성화할 수 없습니다." }, { status: 400 });
      }
      if (input.global === false || input.agentId !== undefined) {
        return NextResponse.json({ error: "본인 계정의 에이전트 범위는 스스로 바꿀 수 없습니다." }, { status: 400 });
      }
    }

    const user = await updateUser(targetId, input);
    logger.info("account updated", { ...ctx, by: guard.session.sub, userId: targetId });
    return NextResponse.json({ user });
  } catch (e) {
    logger.warn("account update failed", { ...ctx, userId: targetId, err: String(e) });
    return NextResponse.json({ error: String(e).replace(/^Error:\s*/, "") }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { userId: string } }) {
  const ctx = reqContext(req);
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const actorIsAdmin = roleAtLeast(guard.session.role, "ADMIN");
  const scope = resolveScope(guard.session);

  const targetId = decodeURIComponent(params.userId);
  if (targetId === guard.session.sub) {
    return NextResponse.json({ error: "본인 계정은 삭제할 수 없습니다." }, { status: 400 });
  }
  try {
    const target = await getUser(targetId);
    if (!target) return NextResponse.json({ error: "존재하지 않는 계정입니다." }, { status: 404 });
    if (!canActOnAccount(scope, target)) {
      return NextResponse.json({ error: "존재하지 않는 계정입니다." }, { status: 404 });
    }
    if (target.role === "ADMIN" && !actorIsAdmin) {
      return NextResponse.json({ error: "운영자 계정은 운영자만 삭제할 수 있습니다." }, { status: 403 });
    }
    await deleteUser(targetId);
    logger.info("account deleted", { ...ctx, by: guard.session.sub, userId: targetId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.warn("account delete failed", { ...ctx, userId: targetId, err: String(e) });
    return NextResponse.json({ error: String(e).replace(/^Error:\s*/, "") }, { status: 400 });
  }
}
