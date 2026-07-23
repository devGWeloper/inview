import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/current";
import { resetPassword, getUser } from "@/lib/users";
import { roleAtLeast } from "@/lib/roles";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 비밀번호 초기화 (BR 이상). 본문에 newPassword 가 있으면 그 값으로,
 * 없으면 **사번(USER_ID)** 으로 초기화하고 MUST_CHG_YN='Y' 를 세워
 * 대상자가 다음 로그인에서 변경하도록 유도한다.
 * ADMIN 대상 계정은 ADMIN 만 초기화할 수 있다.
 */
export async function POST(req: NextRequest, { params }: { params: { userId: string } }) {
  const ctx = reqContext(req);
  const guard = await requireRole("BR");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const targetId = decodeURIComponent(params.userId);
  try {
    const target = await getUser(targetId);
    if (!target) return NextResponse.json({ error: "존재하지 않는 계정입니다." }, { status: 404 });
    if (target.role === "ADMIN" && !roleAtLeast(guard.session.role, "ADMIN")) {
      return NextResponse.json({ error: "운영자 계정은 운영자만 초기화할 수 있습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const provided = typeof body.newPassword === "string" && body.newPassword.trim() ? body.newPassword.trim() : "";
    // 미지정이면 초기 비밀번호는 사번과 동일 (계정 최초 생성 규칙과 동일).
    const newPw = provided || targetId;

    await resetPassword(targetId, newPw);
    logger.info("password reset", { ...ctx, by: guard.session.sub, userId: targetId, toSabun: !provided });
    // 초기화된 비밀번호를 관리자에게 되돌려줘 전달할 수 있게 한다.
    return NextResponse.json({ ok: true, tempPassword: newPw });
  } catch (e) {
    logger.warn("password reset failed", { ...ctx, userId: targetId, err: String(e) });
    return NextResponse.json({ error: String(e).replace(/^Error:\s*/, "") }, { status: 400 });
  }
}
