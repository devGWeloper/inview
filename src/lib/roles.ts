// ─────────────────────────────────────────────────────────────────────────────
// 권한(Role) 단일 소스.
//
//   ADMIN(운영자) > BR(상위 권한자) > DEV(개발자/일반 READ)
//
// 이 파일은 클라이언트 컴포넌트 · Edge 미들웨어 · 서버 라우트 모두에서 import 하므로
// Node 전용/서버 전용 모듈(fs, crypto, oracledb 등)을 절대 import 하지 않는다.
// 화면↔경로↔권한 매핑의 유일한 출처 — 접근 범위가 바뀌면 ROUTE_RULES 만 고친다.
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "ADMIN" | "BR" | "DEV";

export const ROLES: Role[] = ["ADMIN", "BR", "DEV"];

/** 화면 표기용 한글 라벨 */
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "운영자",
  BR: "BR",
  DEV: "개발자",
};

/** 권한 선택 UI 등에서 쓰는 짧은 설명 */
export const ROLE_DESC: Record<Role, string> = {
  ADMIN: "전체 관리 · 계정/프로필 편집",
  BR: "리포트 · 개선센터 · 이벤트-FAB 열람/편집",
  DEV: "Traces · Dashboard · Tokens · Agent 조회",
};

/** 권한 서열 (클수록 상위). 비교의 유일한 근거. */
const RANK: Record<Role, number> = { ADMIN: 3, BR: 2, DEV: 1 };

export function isRole(v: unknown): v is Role {
  return v === "ADMIN" || v === "BR" || v === "DEV";
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
  // 운영자 전용
  { prefix: "/admin", min: "ADMIN" }, // 프로필 편집
  // public/ 정적 파일이지만 middleware matcher 가 .html 을 제외하지 않아 여기 규칙이 걸린다.
  { prefix: "/design-preview.html", min: "ADMIN" }, // 레이아웃 개편 시안 뷰어 (검토용)
  // 타임아웃 추적 — 노드 귀속이 추정값이라 오해 소지가 있어 운영자만 본다
  { prefix: "/timeouts", min: "ADMIN" },
  { prefix: "/api/timeouts", min: "ADMIN" },
  // BR 이상
  { prefix: "/accounts", min: "BR" }, // 계정 관리 화면 (등록 권한 ADMIN/BR)
  { prefix: "/api/accounts", min: "BR" }, // 계정 CRUD API
  { prefix: "/report", min: "BR" }, // 실적 리포트
  { prefix: "/improvement", min: "BR" }, // Improvement Center
  { prefix: "/event-fabs", min: "BR" }, // 이벤트-FAB 매핑
];

/** 해당 경로에 필요한 최소 권한. 규칙에 없으면 null(= 인증만 되면 접근 가능). */
export function requiredRoleForPath(pathname: string): Role | null {
  for (const r of ROUTE_RULES) {
    if (pathname === r.prefix || pathname.startsWith(r.prefix + "/")) return r.min;
  }
  return null;
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
