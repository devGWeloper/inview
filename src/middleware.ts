// ─────────────────────────────────────────────────────────────────────────────
// 인증/인가 미들웨어 (Edge).
//
//  1) 비로그인 → 페이지 요청은 /login 으로 리다이렉트(원래 목적지는 ?next=),
//     API 요청은 401 JSON.
//  2) 로그인했지만 권한 부족 → 페이지는 /403, API 는 403 JSON.
//  3) BIZ(기본 에이전트 전용) 경로에 다른 팀 에이전트 소속이 들어오면 /tokens 로 보낸다.
//     ⚠️ 여기 판정은 세션 클레임(bizAllowed) 기반의 **UX 리다이렉트**다. 권위 있는 차단은
//        각 API 라우트의 requireBiz() 가 현재 config 로 다시 한다 (Edge 는 config 를 못 읽는다).
//
// 경로↔최소권한 매핑은 src/lib/roles.ts(ROUTE_RULES) 단일 소스. 세션 검증은
// Web Crypto 기반(session.ts)이라 Edge 에서도 동작한다.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifySession } from "@/lib/auth/session";
import { requiredRoleForPath, roleAtLeast, isBizPath, resolveScope, isLockedScope } from "@/lib/roles";

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

  // 3) 에이전트 범위 — 미배정 계정과 다른 팀 에이전트 소속을 BIZ 화면에서 돌려보낸다.
  const scope = resolveScope(session);
  if (isBizPath(pathname)) {
    // bizAllowed 키가 없는 옛 쿠키는 통과시킨다(다음 로그인부터 판정) — 배포 직후 기존
    // 세션이 전부 튕기지 않게. API 는 어차피 requireBiz 가 다시 본다.
    const allowed = session.bizAllowed ?? true;
    if (!allowed || isLockedScope(scope)) {
      if (isApi) {
        return NextResponse.json({ error: "이 화면은 기본 에이전트 전용입니다." }, { status: 403 });
      }
      const url = req.nextUrl.clone();
      url.search = "";
      // 미배정 계정은 갈 곳이 없어 안내가 필요하고, 소속이 있으면 자기 화면으로 보낸다.
      url.pathname = isLockedScope(scope) ? "/403" : "/tokens";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // 정적 자산/이미지/파비콘 제외 전부에 적용. (public/ 이미지는 확장자로 걸러짐)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)"],
};
