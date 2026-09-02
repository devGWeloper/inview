# 인증 · 인가

전 화면 로그인 필수. 사번(`USER_ID`)으로 로그인하고 **두 축**으로 접근을 가른다.

- **권한**: ADMIN(운영자) > BR(상위) > DEV(개발자) > FIELD(일반 사용자)
- **에이전트 범위**: 전역 / 에이전트 하나 / 미배정

두 축은 직교한다. 전역 ADMIN 은 모든 에이전트를 오가며 관리하고, 에이전트 ADMIN 은 자기 에이전트
안에서만 ADMIN 이다.

## 권한이 뜻하는 것

| 권한 | 범위 |
|---|---|
| ADMIN | 전체 관리 · 계정/프로필 편집 |
| BR | **전 화면 열람 · 데이터 수정 불가** |
| DEV | 개발자의 진단 화면 일체 — Traces · Dashboard · Tokens · Timeout · Improvement Center |
| FIELD | 실적(`/insights`) 하나만. 메시지 원문 · 타 사용자 정보 · 에러 코드 비노출 |

- BR 이 못 가는 곳은 **쓰기 전용 화면**뿐이다: `/admin`, `/accounts`
- BR 만 보고 DEV 는 못 보는 화면: `/insights`, `/event-fabs`
- **읽기·쓰기가 한 화면에 섞이면 화면(`ROUTE_RULES`)은 BR 로 열고 그 화면의 PUT 만 ADMIN 으로 올린다.**
  쓰기 경로를 `ROUTE_RULES` 에 BR 로 두지 말 것

## 단일 소스 — `src/lib/roles.ts`

클라이언트 · Edge 미들웨어 · 서버 라우트가 모두 import 하므로 **Node 전용 모듈(fs/crypto/oracledb)
import 금지**.

- `Role` · `ROLE_LABEL` · `roleAtLeast(role, min)`
- `ROUTE_RULES` — 경로 prefix → 최소 권한. `requiredRoleForPath()`
- **`canAccessPath(role, pathname)` 이 경로 인가의 유일한 진입점**.
  미들웨어의 실제 차단과 `TabNav` 의 탭 노출이 같은 함수를 쓴다. 탭별 `minRole` 목록을 따로 두면
  `ROUTE_RULES` 와 두 벌이 되어 "메뉴엔 보이는데 누르면 403" 이 생긴다
- `resolveScope()` / `canViewAgent()` / `canManageAgent()` / `canActOnAccount()` / `isLockedScope()`
- `isBizPath()` — 기본 에이전트 전용 화면 목록
- `scopeErrorForRole(role, scope, defaultAgent)` — FIELD 계정 소속 검증

### FIELD 는 서열이 아니라 허용 목록

`ROUTE_RULES` 는 "규칙에 없으면 통과"(fail-open)다. 서열만 낮춰 두면 앞으로 추가되는 화면이
자동으로 일반 사용자에게 열린다. FIELD 는 반대로 **명시적으로 연 경로만** 들어갈 수 있어야 한다.

→ `FIELD_ALLOW_PREFIXES` 에 한 줄 추가해야 열린다.
현재: `/insights` · `/api/insights` · `/agent` · `/api/profile` · `/api/agents` · `/roadmap` ·
`/api/roadmap` · `/403`

### `/insights` 는 위쪽도 좁힌다

`canViewInsights(role)` — **FIELD + BR 이상. DEV 만 못 본다**(개발자는 Dashboard 로 더 자세히 보고,
BR·ADMIN 은 "일반 사용자에게 무엇이 보이는가" 를 같은 화면으로 확인해야 한다).
이 판정은 fail-open 인 `ROUTE_RULES` 에 실을 수 없으므로 `canAccessPath()` 가 다른 규칙보다 **먼저** 쓴다.

## 서버 가드 — `src/lib/auth/current.ts`

| 가드 | 용도 |
|---|---|
| `requireRole(min)` | 권한만 |
| `requireAgent(agentId, min)` | 대상 에이전트 열람 |
| `requireAgentAdmin(agentId)` | 대상 에이전트 관리 |
| `requireBiz(min)` | 기본 에이전트 전용(BIZ) 화면 |
| `requireGlobalAdmin()` | 앱 공용 문서 쓰기(로드맵) |

**기본 min 은 `DEV`.** 그래서 기존 API 는 FIELD 에게 자동으로 닫혀 있고, 일반 사용자에게 열 API 만
`LOWEST_ROLE` 을 명시한다. 기본값을 낮추면 fail-open 이 된다.

판정 순서는 **400(없는 에이전트) → 403(내 범위 아님) → DB 조회**. 권한 밖 요청은 커넥션을 열기 전에 끊는다.

## 계정 저장소 — `TRX_USER_MAS` (앱 자체 DB = GAIA)

`sql/create_trx_user_mas.sql`. `src/lib/users.ts` 가 CRUD·로그인검증·시드 담당
(lazy-oracledb-swallow, DB 불가 시 `available=false`).

컬럼: `USER_ID`(PK) · `USER_NM` · `WORK_CTN` · `ROLE_CD` · `PWD_HASH`/`PWD_SALT` · `USE_YN` ·
`MUST_CHG_YN` · `AGENT_ID` · `GLOBAL_YN` · `LAST_LOGIN_DT` · 감사일시

### 에이전트 범위 = `GLOBAL_YN` + `AGENT_ID`

| GLOBAL_YN | AGENT_ID | 범위 |
|---|---|---|
| `Y` | (무시) | 전역 |
| `N` | `leeoksu` | 그 에이전트 하나 |
| `N` | NULL | **잠금**(미배정) — 아무것도 못 본다 |

**NULL = 잠금이다.** 판정은 반드시 `roles.ts` 를 거칠 것 — 호출부에서 `session.agentId` 를 직접
비교하면 규칙이 조용히 뒤집힌다.

- 세션 클레임은 `scope`("global"/"agent"/"locked")를 **반드시 함께** 싣는다. `agentId` 만으로는
  전역과 미배정을 구분할 수 없다. `scope` 키가 없는 토큰은 옛 쿠키라 `resolveScope` 가 관대하게 읽는다
- **범위 변경은 다음 로그인부터 적용된다** — 세션 클레임이고 쿠키는 고정 7일 만료(갱신 없음).
  `ROLE_CD` 도 같다(`/api/auth/me` 는 계정을 되읽지 않는다)

### 계정 관리도 범위 안에서만

모두 `canActOnAccount()` 를 지난다. 에이전트 운영자에게 다른 팀 계정은 목록에 안 뜨고, 직접 URL 로
쳐도 **404**(존재를 알리지 않는다).

- **전역 계정과 미배정 계정은 전역 운영자만** 손댈 수 있다 — 전역 계정 비번을 초기화할 수 있으면
  그 계정으로 범위를 벗어난다
- 새 계정 소속: 에이전트 운영자면 자기 에이전트로 고정(다른 값 → 403), 전역 운영자가 미지정이면
  **기본 에이전트**(그대로 두면 잠긴 계정이 된다)
- `GLOBAL_YN` 부여/회수와 소속 이동은 전역 ADMIN 전용. 본인 계정의 범위는 스스로 못 바꾼다
- `validateAgentId()` 가 config 의 실제 id 인지 검증. 설정에서 사라진 경우는
  `AgentScopeProvider.scopeWarning` → `AgentScopeWarning` 띠가 화면에 밝힌다
- `users.ts` 가 두 컬럼 존재를 각각 탐지 → ALTER 전에도 범위 무관 저장은 동작.
  단 **범위를 쓰려는 요청은 조용히 무시하지 않고 실패**한다(마이그레이션 파일명을 담아 throw).
  그래서 호출부는 범위를 바꿀 때만 키를 보내고 `global: false` 는 아예 보내지 않는다
- 최초 시드: 테이블이 비면 `ensureSeedAdmin` 이 `admin`/`admin1234`/ADMIN 을 1회 생성

## 비밀번호 · 세션

- 평문 저장 금지. `src/lib/auth/password.ts` — Node 내장 `crypto` scrypt(외부 의존성 없음)
- 세션: `src/lib/auth/session.ts` 서명 쿠키 `trx_session`(httpOnly, 7일 `SESSION_TTL_SEC`, 슬라이딩 없음).
  형식 `base64url(payload).HMAC-SHA256`, **Web Crypto(`crypto.subtle`)만** 사용해 Edge·Node 공용
- 비밀키 `AUTH_SECRET` — 미설정 시 개발용 폴백. **운영 배포 시 반드시 환경변수 설정**
- 쿠키 `secure` 기본 off(사내 HTTP 배포). HTTPS 면 `AUTH_COOKIE_SECURE=true`. `sessionCookieOptions()` 한 곳
- **초기 비밀번호 = 사번.** 등록 폼에 비번 입력이 없다. 관리자 초기화도 미지정 시 사번으로.
  결과 비번은 화면에 1회 노출

## 미들웨어 — `src/middleware.ts` (Edge)

비로그인: 페이지 → `/login?next=`, API → 401. 권한 부족: 페이지 → `/403`, API → 403.
정적 자산 · `/login` · `/api/auth/*` 통과.

BIZ 경로에 범위 밖 계정이 오면 페이지는 `/tokens`(미배정이면 `/403`)로 보낸다.
Edge 는 `config.yml` 을 못 읽으므로(fs) 로그인 시 계산한 `bizAllowed` 클레임을 쓴다.
**이건 UX 리다이렉트일 뿐 권위가 아니다** — 실제 차단은 각 API 의 `requireBiz()` 가 매 요청 현재
config 로 다시 한다. 클레임 없는 옛 쿠키는 통과시킨다.

## 로그인 착지

FIELD 의 홈은 `/` 가 아니라 `/insights`(`homePathFor`). 로그인 페이지가 `next` 를 `canAccessPath` 로
검사해 갈 수 없는 곳이면 홈으로 바꾼다.

## API

- `POST /api/auth/login` · `logout`, `GET /api/auth/me`(비로그인 200 + `{user:null}`),
  `POST /api/auth/change-password`(본인)
- 계정관리(ADMIN): `GET/POST /api/accounts`, `PUT/DELETE /api/accounts/[userId]`,
  `POST /api/accounts/[userId]/reset-password`

## 클라이언트

`AuthProvider`(`useAuth()`) → `AppChrome`(상단바/푸터 셸, `/login` 은 셸 없이) → `UserMenu`.
mutation fetch 는 세션 쿠키 자동 전송에 의존한다.
