import { NextRequest, NextResponse } from "next/server";
import { verifyLogin } from "@/lib/users";
import { signSession, AUTH_COOKIE, SESSION_TTL_SEC, sessionCookieOptions } from "@/lib/auth/session";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = reqContext(req);
  try {
    const body = await req.json().catch(() => ({}));
    const userId = typeof body.userId === "string" ? body.userId : "";
    const password = typeof body.password === "string" ? body.password : "";

    const result = await verifyLogin(userId, password);
    if (!result.ok) {
      logger.warn("login failed", { ...ctx, userId, reason: result.reason });
      return NextResponse.json({ error: result.reason }, { status: 401 });
    }

    // 계정의 에이전트 결속을 세션에 싣는다 (null = 결속 없음 → 필드 자체를 넣지 않는다).
    const token = await signSession({
      sub: result.user.userId,
      name: result.user.name,
      role: result.user.role,
      agentId: result.user.agentId ?? undefined,
    });

    logger.info("login ok", { ...ctx, userId: result.user.userId, role: result.user.role });
    const res = NextResponse.json({
      user: {
        userId: result.user.userId,
        name: result.user.name,
        role: result.user.role,
      },
    });
    res.cookies.set(AUTH_COOKIE, token, sessionCookieOptions(SESSION_TTL_SEC));
    return res;
  } catch (e) {
    logger.error("POST /api/auth/login failed", { ...ctx, err: String(e) });
    return NextResponse.json({ error: "로그인 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
