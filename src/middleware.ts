// ─────────────────────────────────────────────────────────────────────────────
// 인증/인가 미들웨어 (Edge).
//
//  1) 비로그인 → 페이지 요청은 /login 으로 리다이렉트(원래 목적지는 ?next=),
//     API 요청은 401 JSON.
//  2) 로그인했지만 권한 부족 → 페이지는 /403, API 는 403 JSON.
//
// 경로↔최소권한 매핑은 src/lib/roles.ts(ROUTE_RULES) 단일 소스. 세션 검증은
// Web Crypto 기반(session.ts)이라 Edge 에서도 동작한다.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifySession } from "@/lib/auth/session";
import { requiredRoleForPath, roleAtLeast } from "@/lib/roles";

// 로그인 없이 접근 가능한 경로(정확 일치 또는 하위).
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

  // 1) 인증
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

  // 2) 인가 (경로별 최소 권한)
  const min = requiredRoleForPath(pathname);
  if (min && !roleAtLeast(session.role, min)) {
    if (isApi) {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/403";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // 정적 자산/이미지/파비콘 제외 전부에 적용. (public/ 이미지는 확장자로 걸러짐)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)"],
};
