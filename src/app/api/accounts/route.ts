import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/current";
import { listUsers, createUser } from "@/lib/users";
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
 * - 초기 비밀번호 = 사번(USER_ID). MUST_CHG_YN='Y' 로 최초 로그인 시 변경 강제.
 * - 권한 상향 방지: ADMIN 계정은 ADMIN 만 생성할 수 있다(BR 은 BR/DEV 만).
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

    const user = await createUser({
      userId,
      name: typeof body.name === "string" ? body.name : "",
      work: typeof body.work === "string" ? body.work : null,
      role,
      password: userId, // 초기 비밀번호 = 사번
      useYn: body.useYn === "N" ? "N" : "Y",
      mustChangePw: true, // 최초 로그인 시 변경 강제
    });
    logger.info("account created", { ...ctx, by: guard.session.sub, userId: user.userId, role: user.role });
    return NextResponse.json({ user });
  } catch (e) {
    logger.warn("account create failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: String(e).replace(/^Error:\s*/, "") }, { status: 400 });
  }
}
