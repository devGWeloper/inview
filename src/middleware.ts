
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifySession } from "@/lib/auth/session";
import { canAccessPath, homePathFor, isBizPath, resolveScope, isLockedScope } from "@/lib/roles";

function isPublic(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/")) return true; // 로그인/로그아웃/me 는 자체 처리
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const session = await verifySession(token);

  if (!session) {
    if (isApi) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname + (req.nextUrl.search || ""));
    return NextResponse.redirect(url);
  }

  const scope = resolveScope(session);
  if (!canAccessPath(session.role, pathname)) {
    if (isApi) {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.search = "";
    const home = homePathFor(session.role);
    url.pathname = home !== pathname ? home : "/403";
    return NextResponse.redirect(url);
  }

  if (isBizPath(pathname)) {
    const allowed = session.bizAllowed ?? true;
    if (!allowed || isLockedScope(scope)) {
      if (isApi) {
        return NextResponse.json({ error: "이 화면은 기본 에이전트 전용입니다." }, { status: 403 });
      }
      const url = req.nextUrl.clone();
      url.search = "";
      const fallback = "/tokens";
      url.pathname =
        isLockedScope(scope) || !canAccessPath(session.role, fallback) ? "/403" : fallback;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)"],
};
