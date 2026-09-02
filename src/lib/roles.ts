
// 권한 · 경로 인가의 단일 소스. 클라이언트 / Edge 미들웨어 / 서버가 모두 import 하므로
// Node 전용 모듈(fs·crypto·oracledb) import 금지.
// 경로 판정은 canAccessPath() 하나로만 한다 (미들웨어 차단과 탭 노출이 같은 함수를 써야
// "메뉴엔 보이는데 누르면 403" 이 안 생긴다). 규칙: docs/architecture/auth.md

export type Role = "ADMIN" | "BR" | "DEV" | "FIELD";

export const ROLES: Role[] = ["ADMIN", "BR", "DEV", "FIELD"];

export const LOWEST_ROLE: Role = "FIELD";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "운영자",
  BR: "BR",
  DEV: "개발자",
  FIELD: "일반 사용자",
};

export const ROLE_DESC: Record<Role, string> = {
  ADMIN: "전체 관리 · 계정/프로필 편집",
  BR: "전 화면 열람 (데이터 수정 불가)",
  DEV: "Traces · Dashboard · Tokens · Timeout · 개선센터 조회",
  FIELD: "실적 요약만 열람 (메시지 원문 · 타 사용자 정보 비노출)",
};

const RANK: Record<Role, number> = { ADMIN: 3, BR: 2, DEV: 1, FIELD: 0 };

export function isRole(v: unknown): v is Role {
  return v === "ADMIN" || v === "BR" || v === "DEV" || v === "FIELD";
}

export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export interface RouteRule {
  prefix: string;
  min: Role;
}

export const ROUTE_RULES: RouteRule[] = [
  { prefix: "/admin", min: "ADMIN" }, // 프로필 편집 (편집 전용 화면)
  { prefix: "/wip", min: "ADMIN" },
  { prefix: "/design-preview.html", min: "ADMIN" }, // 레이아웃 개편 시안 뷰어 (검토용)
  { prefix: "/accounts", min: "ADMIN" }, // 계정 관리 (등록/수정/삭제/비번초기화)
  { prefix: "/api/accounts", min: "ADMIN" }, // 계정 CRUD API
  { prefix: "/event-fabs", min: "BR" }, // 이벤트-FAB 매핑 — 저장 PUT 은 ADMIN
  { prefix: "/timeouts", min: "DEV" }, // 타임아웃 추적 (조회 전용) — LLM 타임아웃은 개발자가 본다
  { prefix: "/api/timeouts", min: "DEV" },
  { prefix: "/improvement", min: "DEV" }, // Improvement Center — 조치 저장 PUT 은 ADMIN
];

export function requiredRoleForPath(pathname: string): Role | null {
  for (const r of ROUTE_RULES) {
    if (pathname === r.prefix || pathname.startsWith(r.prefix + "/")) return r.min;
  }
  return null;
}

export const FIELD_ALLOW_PREFIXES: string[] = [
  "/insights",
  "/api/insights",
  "/agent",
  "/api/profile",
  "/api/agents",
  "/roadmap",
  "/api/roadmap",
  "/403",
];

export function isFieldAllowedPath(pathname: string): boolean {
  return FIELD_ALLOW_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

const INSIGHTS_PREFIXES = ["/insights", "/api/insights"];

export function isInsightsPath(pathname: string): boolean {
  return INSIGHTS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function canViewInsights(role: Role): boolean {
  if (role === "FIELD") return true;        // 이 화면의 주인
  return roleAtLeast(role, "BR");           // BR · ADMIN 은 함께 본다 (DEV 제외)
}

export function canAccessPath(role: Role, pathname: string): boolean {
  if (isInsightsPath(pathname)) return canViewInsights(role);
  if (role === "FIELD") return isFieldAllowedPath(pathname); // allow-list (fail-closed)
  const min = requiredRoleForPath(pathname);
  return !min || roleAtLeast(role, min);
}

export function homePathFor(role: Role): string {
  return role === "FIELD" ? "/insights" : "/";
}

export interface AgentScope {
  global: boolean;
  agentId: string | null;
}

export type ScopeKind = "global" | "agent" | "locked";

export function scopeKindOf(scope: AgentScope): ScopeKind {
  if (scope.global) return "global";
  return scope.agentId ? "agent" : "locked";
}

export function resolveScope(claim: { agentId?: string | null; scope?: string | null }): AgentScope {
  const agentId = typeof claim.agentId === "string" && claim.agentId.trim() ? claim.agentId.trim() : null;
  switch (claim.scope) {
    case "global": return { global: true, agentId };
    case "agent": return { global: false, agentId };
    case "locked": return { global: false, agentId: null };
    default: return { global: !agentId, agentId }; // legacy 쿠키
  }
}

export function isLockedScope(scope: AgentScope): boolean {
  return !scope.global && !scope.agentId;
}

export function canViewAgent(scope: AgentScope, agentId: string): boolean {
  if (scope.global) return true;
  return !!scope.agentId && scope.agentId === agentId;
}

export function canManageAgent(scope: AgentScope, role: Role, agentId: string): boolean {
  return roleAtLeast(role, "ADMIN") && canViewAgent(scope, agentId);
}

const BIZ_PREFIXES = [
  "/dashboard",
  "/insights",   // 일반 사용자 실적 화면 — 집계 대상이 BIZ_AIACTIONTXN_HIS 라 기본 에이전트 전용
  "/api/insights",
  "/improvement",
  "/event-fabs",
  "/api/traces",
  "/api/stats",
  "/api/facs",
  "/api/action-types",
  "/api/request-failures",
  "/api/event-fabs",
];

export function isBizPath(pathname: string): boolean {
  if (pathname === "/") return true; // 트레이스 목록
  return BIZ_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function scopeErrorForRole(
  role: Role,
  scope: { global: boolean; agentId: string | null },
  defaultAgent: string
): string | null {
  if (role !== "FIELD") return null;
  if (scope.global) {
    return "일반 사용자 계정은 전역으로 만들 수 없습니다. 기본 에이전트 소속만 가능합니다.";
  }
  if (scope.agentId !== defaultAgent) {
    return "일반 사용자 계정은 기본 에이전트 소속만 가능합니다.";
  }
  return null;
}

export function canActOnAccount(
  actor: AgentScope,
  target: { agentId: string | null; global: boolean }
): boolean {
  if (actor.global) return true;
  if (target.global) return false;
  return !!actor.agentId && !!target.agentId && actor.agentId === target.agentId;
}
