# 계정 관리 — `/accounts` · 로그인 — `/login` · `/403`

**파일**
- 화면: `src/app/accounts/page.tsx` · `src/app/login/page.tsx` · `src/app/403/page.tsx`
- 컴포넌트: `src/features/accounts/` — `types` `AccountEditor` `ResetPasswordModal` `DeleteModal`
- 공용: `src/components/auth/` — `AuthProvider` `UserMenu` `ChangePasswordModal` `SessionExpiredDialog`
- API: `src/app/api/accounts/**` · `src/app/api/auth/**`
- 저장: `src/lib/users.ts` · 세션 `src/lib/auth/session.ts` · 해시 `src/lib/auth/password.ts` ·
  가드 `src/lib/auth/current.ts`
- 스타일: `src/styles/auth.css`
- 권한: **ADMIN 전용**(목록도 BR 에게 안 보인다)

규칙 전부는 [auth.md](../architecture/auth.md) 에 있다. 화면 쪽만 적는다.

## `/accounts`

계정 목록 · 생성/수정/비번초기화/삭제. 권한은 카드형 선택.

- 권한을 **일반 사용자(FIELD)로 고르면 에이전트 셀렉트를 기본 에이전트로 고정·잠근다.**
  그건 UX 이고 권위는 `/api/accounts` 의 `scopeErrorForRole()` 400 이다
- 에이전트 운영자에게는 다른 팀 계정이 목록에 안 뜬다
- 초기 비밀번호 = 사번. 등록 폼에 비번 입력이 없다. 초기화 결과 비번은 화면에 1회 노출

`/api/accounts` 의 권한 상향 방지 가드(`actorIsAdmin` 분기)는 min 이 ADMIN 이라 항상 참이지만,
min 을 다시 낮출 때를 위한 **잔여 방어**로 남겨 뒀다.

## `/login`

브랜드 히어로 + 폼 스플릿. 셸(`AppChrome`) 없이 전체화면.
`next` 파라미터를 `canAccessPath` 로 검사해 갈 수 없는 곳이면 홈(`homePathFor`)으로 바꾼다
(화면이 한 번 튀는 것 방지).
