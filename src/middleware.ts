// ─────────────────────────────────────────────────────────────────────────────
// 인증/인가 미들웨어 (Edge).
//
//  1) 비로그인 → 페이지 요청은 /login 으로 리다이렉트(원래 목적지는 ?next=),
//     API 요청은 401 JSON.
//  2) 로그인했지만 권한 부족 → 페이지는 홈(일반 사용자는 /insights, 그 외 /403), API 는 403 JSON.
//     판정은 roles.ts 의 canAccessPath() 한 곳 — 서열(ROUTE_RULES)과 일반 사용자 허용 목록을 모두 본다.
//  3) BIZ(기본 에이전트 전용) 경로에 다른 팀 에이전트 소속이 들어오면 /tokens 로 보낸다.
//     ⚠️ 여기 판정은 세션 클레임(bizAllowed) 기반의 **UX 리다이렉트**다. 권위 있는 차단은
//        각 API 라우트의 requireBiz() 가 현재 config 로 다시 한다 (Edge 는 config 를 못 읽는다).
//
// 경로↔최소권한 매핑은 src/lib/roles.ts(ROUTE_RULES) 단일 소스. 세션 검증은
// Web Crypto 기반(session.ts)이라 Edge 에서도 동작한다.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifySession } from "@/lib/auth/session";
import { canAccessPath, homePathFor, isBizPath, resolveScope, isLockedScope } from "@/lib/roles";

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

  // 2) 인가 (경로별 권한 — 서열 + 일반 사용자 허용 목록 + 실적 화면 전역 운영자 제한)
  //    ⚠️ scope 는 아래 3) 보다 먼저 필요하다 — /insights 판정이 전역 여부를 본다.
  const scope = resolveScope(session);
  if (!canAccessPath(session.role, pathname, scope.global)) {
    if (isApi) {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.search = "";
    // 일반 사용자는 갈 수 있는 화면이 하나뿐이라 403 페이지보다 자기 홈으로 보내는 편이 낫다.
    // (이미 홈에 있는데도 막혔다면 루프를 피해 /403 으로 — 허용 목록이 잘못된 경우다)
    const home = homePathFor(session.role);
    url.pathname = home !== pathname ? home : "/403";
    return NextResponse.redirect(url);
  }

  // 3) 에이전트 범위 — 미배정 계정과 다른 팀 에이전트 소속을 BIZ 화면에서 돌려보낸다.
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
      // ⚠️ 그 화면조차 권한 밖이면(예: 일반 사용자는 /tokens 를 못 본다) /403 으로 — 안 그러면
      //    "여기는 안 됨 → 저기로" 가 서로를 가리켜 리다이렉트 루프가 된다.
      const fallback = "/tokens";
      url.pathname =
        isLockedScope(scope) || !canAccessPath(session.role, fallback, scope.global) ? "/403" : fallback;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // 정적 자산/이미지/파비콘 제외 전부에 적용. (public/ 이미지는 확장자로 걸러짐)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)"],
};
