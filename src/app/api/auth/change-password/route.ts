import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current";
import { changeOwnPassword } from "@/lib/users";
import { validatePasswordPolicy } from "@/lib/auth/password";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 본인 비밀번호 변경. 현재 비밀번호 확인 후 새 비밀번호로 교체. */
export async function POST(req: NextRequest) {
  const ctx = reqContext(req);
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const currentPw = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPw = typeof body.newPassword === "string" ? body.newPassword : "";

    const policy = validatePasswordPolicy(newPw);
    if (policy) return NextResponse.json({ error: policy }, { status: 400 });
    if (newPw === currentPw) {
      return NextResponse.json({ error: "새 비밀번호가 현재 비밀번호와 같습니다." }, { status: 400 });
    }

    await changeOwnPassword(session.sub, currentPw, newPw);
    logger.info("change-password ok", { ...ctx, userId: session.sub });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.warn("change-password failed", { ...ctx, userId: session.sub, err: String(e) });
    return NextResponse.json({ error: String(e).replace(/^Error:\s*/, "") }, { status: 400 });
  }
}
