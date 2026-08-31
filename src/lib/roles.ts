// ─────────────────────────────────────────────────────────────────────────────
// 권한(Role) 단일 소스.
//
//   ADMIN(운영자) > BR(상위 권한자) > DEV(개발자/일반 READ) > FIELD(일반 사용자)
//
// **BR = 전 화면 열람 · 데이터 수정 불가.** 실적(/insights)·Timeout 을 포함해 모든 조회 화면을
// 볼 수 있지만 쓰기(프로필 편집 · 계정 관리 · 이벤트-FAB 저장 · 조치정보 저장)는 전부 ADMIN 이다.
// ⚠️ 그래서 **쓰기 경로를 ROUTE_RULES 에 BR 로 두지 말 것** — 쓰기는 API 의 requireRole("ADMIN")
//    / requireBiz("ADMIN") / requireAgentAdmin() 이 막고, ROUTE_RULES 는 '화면을 볼 수 있나' 만 정한다.
//    (읽기·쓰기가 한 화면에 섞이면 화면은 BR 로 열고 그 화면의 PUT 만 ADMIN 으로 올린다)
//
// FIELD(일반 사용자)는 **개발자가 아닌 실사용/실적 열람자**다. 원문 메시지(JSON envelope), 다른
// 사용자의 요청/질의, 에러 코드 같은 내부 정보를 보면 안 되고 집계된 실적만 본다.
//
// ⚠️ FIELD 만은 서열(ROUTE_RULES)이 아니라 **허용 목록(FIELD_ALLOW_PREFIXES)** 으로 판정한다.
//    ROUTE_RULES 는 "규칙에 없으면 통과"(fail-open)라, 서열만 낮춰 두면 새로 추가되는 화면이
//    자동으로 일반 사용자에게 열린다. 일반 사용자는 반대로 **명시적으로 연 경로만** 들어갈 수 있어야 한다.
//    두 규칙의 합류 지점은 canAccessPath() 하나다 — 미들웨어/탭 노출 모두 이걸 쓴다.
//
// 이 파일은 클라이언트 컴포넌트 · Edge 미들웨어 · 서버 라우트 모두에서 import 하므로
// Node 전용/서버 전용 모듈(fs, crypto, oracledb 등)을 절대 import 하지 않는다.
// 화면↔경로↔권한 매핑의 유일한 출처 — 접근 범위가 바뀌면 ROUTE_RULES 만 고친다.
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "ADMIN" | "BR" | "DEV" | "FIELD";

export const ROLES: Role[] = ["ADMIN", "BR", "DEV", "FIELD"];

/**
 * 가장 낮은 권한 = "인증만 되면 된다" 를 뜻하는 min 값.
 * ⚠️ 서버 가드의 기본 min 은 여전히 "DEV" 다 — 일반 사용자에게 열 API 는 min 을 이 값으로
 *    **명시**해야 한다. 기본값을 낮추면 기존 API 가 전부 일반 사용자에게 열린다(fail-open).
 */
export const LOWEST_ROLE: Role = "FIELD";

/** 화면 표기용 한글 라벨 */
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "운영자",
  BR: "BR",
  DEV: "개발자",
  FIELD: "일반 사용자",
};

/** 권한 선택 UI 등에서 쓰는 짧은 설명 */
export const ROLE_DESC: Record<Role, string> = {
  ADMIN: "전체 관리 · 계정/프로필 편집",
  BR: "전 화면 열람 (데이터 수정 불가)",
  DEV: "Traces · Dashboard · Tokens · Agent 조회",
  FIELD: "실적 요약만 열람 (메시지 원문 · 타 사용자 정보 비노출)",
};

/** 권한 서열 (클수록 상위). 비교의 유일한 근거. */
const RANK: Record<Role, number> = { ADMIN: 3, BR: 2, DEV: 1, FIELD: 0 };

export function isRole(v: unknown): v is Role {
  return v === "ADMIN" || v === "BR" || v === "DEV" || v === "FIELD";
}

/** role 이 min 이상의 권한인가 (ADMIN>=BR>=DEV). */
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

// ── 경로 → 최소 권한 매핑 ────────────────────────────────────────────────
// prefix 와 정확히 같거나 그 하위 경로면 min 권한을 요구한다.
// 여기 없는(로그인만 되면 되는) 경로는 DEV 로 취급 = 인증된 사용자 누구나.
export interface RouteRule {
  prefix: string;
  min: Role;
}

export const ROUTE_RULES: RouteRule[] = [
  // 운영자 전용 — **쓰기가 목적인 화면/API**. 조회만 하는 화면을 여기 두지 말 것.
  { prefix: "/admin", min: "ADMIN" }, // 프로필 편집 (편집 전용 화면)
  // public/ 정적 파일이지만 middleware matcher 가 .html 을 제외하지 않아 여기 규칙이 걸린다.
  { prefix: "/design-preview.html", min: "ADMIN" }, // 레이아웃 개편 시안 뷰어 (검토용)
  { prefix: "/accounts", min: "ADMIN" }, // 계정 관리 (등록/수정/삭제/비번초기화)
  { prefix: "/api/accounts", min: "ADMIN" }, // 계정 CRUD API
  // BR 이상 — **열람용**. 이 화면들의 쓰기(PUT)는 라우트가 따로 ADMIN 을 요구한다.
  { prefix: "/timeouts", min: "BR" }, // 타임아웃 추적 (조회 전용)
  { prefix: "/api/timeouts", min: "BR" },
  { prefix: "/report", min: "BR" }, // 실적 리포트 (조회 전용)
  { prefix: "/improvement", min: "BR" }, // Improvement Center — 조치 저장 PUT 은 ADMIN
  { prefix: "/event-fabs", min: "BR" }, // 이벤트-FAB 매핑 — 저장 PUT 은 ADMIN
];

/** 해당 경로에 필요한 최소 권한. 규칙에 없으면 null(= 인증만 되면 접근 가능). */
export function requiredRoleForPath(pathname: string): Role | null {
  for (const r of ROUTE_RULES) {
    if (pathname === r.prefix || pathname.startsWith(r.prefix + "/")) return r.min;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 일반 사용자(FIELD) 허용 목록 — **allow-list**. 여기 없는 경로는 전부 막힌다.
//
// ⚠️ ROUTE_RULES 와 방향이 반대다. 그쪽은 "규칙에 없으면 통과", 이쪽은 "목록에 없으면 차단".
//    일반 사용자에게 새 화면을 열려면 반드시 여기에 한 줄 추가해야 한다 — 화면이 늘어날 때
//    실수로 원문/타 사용자 정보가 딸려 나가는 것을 구조적으로 막는 장치다.
//
// 열려 있는 것:
//   /insights      집계 실적 화면 (원문 · 사용자 ID · 에러 코드 없음)
//                  ⚠️ 이 둘은 아래 canViewInsights() 가 한 번 더 좁힌다 — 일반 사용자와
//                     BR 이상만 열 수 있다(DEV 는 못 본다 — Dashboard 로 같은 수치를 더 자세히 본다).
//   /api/insights  그 화면의 유일한 데이터 소스 (서버가 필드를 화이트리스트로 추림)
//   /agent         에이전트 소개 카드 + FTE (공개용 프로필)
//   /api/profile   위 카드의 데이터 (GET 만 — PUT 은 requireAgentAdmin 이 따로 막는다)
//   /api/agents    상단바 에이전트 셀렉터가 마운트 시 읽는 목록 (비밀 없음)
//   /403           권한 안내 화면 (여기까지 막으면 리다이렉트 루프가 된다)
// ─────────────────────────────────────────────────────────────────────────────

export const FIELD_ALLOW_PREFIXES: string[] = [
  "/insights",
  "/api/insights",
  "/agent",
  "/api/profile",
  "/api/agents",
  "/403",
];

/** 일반 사용자(FIELD)에게 열린 경로인가. */
export function isFieldAllowedPath(pathname: string): boolean {
  return FIELD_ALLOW_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// ─────────────────────────────────────────────────────────────────────────────
// 실적 화면(/insights) — 일반 사용자 본인 + **BR 이상**.
//
// 일반 사용자에게 보여주는 화면이지만, 관리자·상위 권한자는 "일반 사용자에게 무엇이 보이는가"
// 를 같은 화면으로 확인할 수 있어야 한다(별도 미리보기를 만들면 두 화면이 어긋난다).
//
// ⚠️ DEV 만 못 본다 — 개발자는 Dashboard 로 같은 수치를 더 자세히 본다. 그래서 이 판정은
//    ROUTE_RULES(서열, fail-open)에 못 싣는다: 규칙에 없으면 통과라 DEV 까지 열리기 때문이다.
//    여기서 role 을 직접 보고, canAccessPath() 가 다른 규칙보다 **먼저** 이 판정을 쓴다.
//
// ⚠️ 예전에는 "일반 사용자 + 전역 ADMIN" 이라 전역 여부까지 봤다. BR 이 전 화면 열람이 되면서
//    그 조건은 사라졌다 — /insights 는 BIZ 경로라 비기본 에이전트 소속은 requireBiz 가 막는다.
// ─────────────────────────────────────────────────────────────────────────────

const INSIGHTS_PREFIXES = ["/insights", "/api/insights"];

export function isInsightsPath(pathname: string): boolean {
  return INSIGHTS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** 실적 화면을 볼 수 있는가. 일반 사용자(주인) + BR 이상. */
export function canViewInsights(role: Role): boolean {
  if (role === "FIELD") return true;        // 이 화면의 주인
  return roleAtLeast(role, "BR");           // BR · ADMIN 은 함께 본다 (DEV 제외)
}

/**
 * 이 권한으로 이 경로에 들어갈 수 있는가 — 경로 인가의 **단일 판정 지점**.
 * 미들웨어(실제 차단)와 TabNav(메뉴 노출)가 같은 답을 쓰도록 한 곳으로 모은다.
 *
 * 판정 순서: 실적 화면(role 직접 판정) → 일반 사용자 허용 목록(fail-closed) → 서열(ROUTE_RULES).
 */
export function canAccessPath(role: Role, pathname: string): boolean {
  if (isInsightsPath(pathname)) return canViewInsights(role);
  if (role === "FIELD") return isFieldAllowedPath(pathname); // allow-list (fail-closed)
  const min = requiredRoleForPath(pathname);
  return !min || roleAtLeast(role, min);
}

/**
 * 로그인 직후/권한 부족 시 되돌려 보낼 홈 경로.
 * 일반 사용자의 홈은 트레이스 목록(/)이 아니라 실적 화면이다.
 */
export function homePathFor(role: Role): string {
  return role === "FIELD" ? "/insights" : "/";
}

// ─────────────────────────────────────────────────────────────────────────────
// 에이전트 스코프 — role(무엇을 할 수 있나) 과 직교하는 두 번째 축(어느 에이전트에 대해).
//
//   global=true            → 모든 에이전트 (전역 운영자)
//   global=false, agentId  → 그 에이전트 하나
//   global=false, null     → **잠금** (미배정 — 아무 에이전트도 못 본다)
//
// ⚠️ 예전 규칙은 "agentId 없음 = 전 에이전트" 였다. 의미가 뒤집혔으므로 판정은
//    반드시 이 파일의 함수를 거친다 — 호출부에서 `session.agentId` 를 직접 보지 말 것.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentScope {
  /** 모든 에이전트 접근 가능 */
  global: boolean;
  /** 소속 에이전트 id (null = 미배정) */
  agentId: string | null;
}

/** 세션에 실리는 스코프 종류. 구 쿠키에는 이 키가 없다(→ 아래 resolveScope 의 legacy 분기). */
export type ScopeKind = "global" | "agent" | "locked";

export function scopeKindOf(scope: AgentScope): ScopeKind {
  if (scope.global) return "global";
  return scope.agentId ? "agent" : "locked";
}

/**
 * 세션 클레임 → 스코프.
 *
 * ⚠️ `scope` 키가 없는 토큰은 **이 기능 이전에 발급된 쿠키**다. 그때 규칙(agentId 없음 =
 *    전 에이전트)으로 읽어야 살아 있는 로그인이 끊기지 않는다. 새로 발급되는 토큰은
 *    항상 scope 를 싣는다.
 */
export function resolveScope(claim: { agentId?: string | null; scope?: string | null }): AgentScope {
  const agentId = typeof claim.agentId === "string" && claim.agentId.trim() ? claim.agentId.trim() : null;
  switch (claim.scope) {
    case "global": return { global: true, agentId };
    case "agent": return { global: false, agentId };
    case "locked": return { global: false, agentId: null };
    default: return { global: !agentId, agentId }; // legacy 쿠키
  }
}

/** 미배정(어떤 에이전트도 볼 수 없음) 인가. */
export function isLockedScope(scope: AgentScope): boolean {
  return !scope.global && !scope.agentId;
}

/** 이 스코프로 대상 에이전트를 **열람**할 수 있는가. */
export function canViewAgent(scope: AgentScope, agentId: string): boolean {
  if (scope.global) return true;
  return !!scope.agentId && scope.agentId === agentId;
}

/**
 * 이 스코프+권한으로 대상 에이전트를 **관리**(프로필/한도/계정 편집)할 수 있는가.
 * 관리는 ADMIN 부터다 — 에이전트 ADMIN 은 자기 에이전트 안에서만 ADMIN 이다.
 */
export function canManageAgent(scope: AgentScope, role: Role, agentId: string): boolean {
  return roleAtLeast(role, "ADMIN") && canViewAgent(scope, agentId);
}

// ─────────────────────────────────────────────────────────────────────────────
// BIZ 전용 경로 — BIZ_AIACTIONTXN_HIS(기본 에이전트) 를 보는 화면/API.
//
// 다른 팀 에이전트 소속 계정은 여기에 들어올 이유가 없다. 예전에는 클라이언트
// 스냅백(AgentScopeProvider)만 있어 **URL 을 직접 치면 그대로 열렸다** — 서버에서 막는다.
// 판정은 "전역이거나 기본 에이전트 소속" 이며, 기본 에이전트 id 는 config(Node 전용)라
// 미들웨어에서는 세션의 bizAllowed 클레임으로, API 에서는 실제 id 로 다시 확인한다.
// ─────────────────────────────────────────────────────────────────────────────

const BIZ_PREFIXES = [
  "/dashboard",
  "/insights",   // 일반 사용자 실적 화면 — 집계 대상이 BIZ_AIACTIONTXN_HIS 라 기본 에이전트 전용
  "/api/insights",
  "/report",
  "/improvement",
  "/event-fabs",
  "/api/traces",
  "/api/stats",
  "/api/facs",
  "/api/action-types",
  "/api/request-failures",
  "/api/event-fabs",
];

/** BIZ_AIACTIONTXN_HIS 기반 경로인가 (기본 에이전트 전용). */
export function isBizPath(pathname: string): boolean {
  if (pathname === "/") return true; // 트레이스 목록
  return BIZ_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * 계정 관리 대상이 행위자의 범위 안인가 (목록 노출 · 수정 · 삭제 · 비번 초기화 공통).
 *
 *   전역 행위자        → 전부
 *   에이전트 행위자 X  → X 소속 계정만. **전역 계정과 미배정 계정은 손대지 못한다** —
 *                        전역 계정을 건드릴 수 있으면 그 계정으로 범위를 벗어날 수 있고,
 *                        미배정 계정은 아직 어느 에이전트의 것도 아니다.
 */
export function canActOnAccount(
  actor: AgentScope,
  target: { agentId: string | null; global: boolean }
): boolean {
  if (actor.global) return true;
  if (target.global) return false;
  return !!actor.agentId && !!target.agentId && actor.agentId === target.agentId;
}
