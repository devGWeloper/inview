import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/current";
import { resetPassword, getUser } from "@/lib/users";
import { roleAtLeast, resolveScope, canActOnAccount } from "@/lib/roles";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 비밀번호 초기화 (ADMIN). newPassword 없으면 사번으로. TEMP(강제 변경 비활성). */
export async function POST(req: NextRequest, { params }: { params: { userId: string } }) {
  const ctx = reqContext(req);
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const targetId = decodeURIComponent(params.userId);
  try {
    const target = await getUser(targetId);
    if (!target) return NextResponse.json({ error: "존재하지 않는 계정입니다." }, { status: 404 });
    if (!canActOnAccount(resolveScope(guard.session), target)) {
      return NextResponse.json({ error: "존재하지 않는 계정입니다." }, { status: 404 });
    }
    if (target.role === "ADMIN" && !roleAtLeast(guard.session.role, "ADMIN")) {
      return NextResponse.json({ error: "운영자 계정은 운영자만 초기화할 수 있습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const provided = typeof body.newPassword === "string" && body.newPassword.trim() ? body.newPassword.trim() : "";
    const newPw = provided || targetId;

    await resetPassword(targetId, newPw);
    logger.info("password reset", { ...ctx, by: guard.session.sub, userId: targetId, toSabun: !provided });
    return NextResponse.json({ ok: true, tempPassword: newPw });
  } catch (e) {
    logger.warn("password reset failed", { ...ctx, userId: targetId, err: String(e) });
    return NextResponse.json({ error: String(e).replace(/^Error:\s*/, "") }, { status: 400 });
  }
}
