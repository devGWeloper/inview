import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/current";
import { updateUser, deleteUser, getUser, UpdateUserInput, validateAgentId } from "@/lib/users";
import { isRole, roleAtLeast, resolveScope, canActOnAccount } from "@/lib/roles";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 계정 수정 (ADMIN).
 * - ADMIN 대상·ADMIN 승격은 ADMIN 만 (권한 상향 방지)
 * - 대상이 자기 에이전트 범위 밖이면 404 취급(존재를 알리지 않는다)
 * - 소속 에이전트/전역 변경은 전역 운영자만 (범위 상향 방지)
 */
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
    // ⚠️ 범위 밖 계정은 목록에도 없다 — 404 로 답해 존재 자체를 알리지 않는다.
    if (!canActOnAccount(scope, target)) {
      return NextResponse.json({ error: "존재하지 않는 계정입니다." }, { status: 404 });
    }
    // 잔여 방어: ADMIN 미만은 운영자(ADMIN) 계정을 건드릴 수 없다.
    if (target.role === "ADMIN" && !actorIsAdmin) {
      return NextResponse.json({ error: "운영자 계정은 운영자만 수정할 수 있습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const input: UpdateUserInput = {};
    if (typeof body.name === "string") input.name = body.name;
    if (typeof body.work === "string" || body.work === null) input.work = body.work;
    if (body.role !== undefined) {
      if (!isRole(body.role)) return NextResponse.json({ error: "권한 값이 올바르지 않습니다." }, { status: 400 });
      // 잔여 방어: ADMIN 미만은 ADMIN 으로 승격시킬 수 없다.
      if (body.role === "ADMIN" && !actorIsAdmin) {
        return NextResponse.json({ error: "운영자(ADMIN) 권한은 운영자만 부여할 수 있습니다." }, { status: 403 });
      }
      input.role = body.role;
    }
    if (body.useYn !== undefined) input.useYn = body.useYn === "N" ? "N" : "Y";
    if (body.agentId !== undefined) {
      // 소속 에이전트 변경은 **전역 운영자만**. 에이전트 운영자가 대상을 다른 에이전트로
      // 옮길 수 있으면 자기 범위 밖에 계정을 심을 수 있고, 미배정(NULL)으로 만드는 것도
      // "어느 팀 것도 아닌 계정" 을 남기는 행위라 똑같이 막는다.
      if (!actorIsAdmin || !scope.global) {
        return NextResponse.json({ error: "에이전트 배정은 전역 운영자만 변경할 수 있습니다." }, { status: 403 });
      }
      // config.yml 에 없는 id 를 저장하면 그 계정은 아무것도 조회하지 못한다 — 여기서 막는다.
      const checked = validateAgentId(body.agentId);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      input.agentId = checked.value;
    }
    if (body.global !== undefined) {
      // 전역 부여/회수도 전역 운영자만.
      if (!actorIsAdmin || !scope.global) {
        return NextResponse.json({ error: "전역 권한은 전역 운영자만 변경할 수 있습니다." }, { status: 403 });
      }
      input.global = body.global === true;
    }

    // 본인 계정을 스스로 강등/비활성화하는 실수 방지
    if (targetId === guard.session.sub) {
      if (input.role && input.role !== guard.session.role) {
        return NextResponse.json({ error: "본인 계정의 권한은 스스로 바꿀 수 없습니다." }, { status: 400 });
      }
      if (input.useYn === "N") {
        return NextResponse.json({ error: "본인 계정은 비활성화할 수 없습니다." }, { status: 400 });
      }
      // 스스로 전역을 내려놓거나 소속을 옮기면 그 즉시 관리 범위를 잃는다(잠금 위험).
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

/** 계정 삭제 (ADMIN). */
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
