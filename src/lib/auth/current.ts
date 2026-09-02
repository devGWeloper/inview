
// 서버 인가 가드. 기본 min 은 DEV 다 — 일반 사용자에게 열 API 만 LOWEST_ROLE 을 명시할 것
// (기본값을 낮추면 fail-open). docs/architecture/auth.md

import { cookies } from "next/headers";
import { AUTH_COOKIE, verifySession, SessionPayload } from "./session";
import {
  Role, roleAtLeast, AgentScope, resolveScope, canViewAgent, canManageAgent, isLockedScope,
} from "../roles";

export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(AUTH_COOKIE)?.value;
  return verifySession(token);
}

export type Guard =
  | { ok: true; session: SessionPayload }
  | { ok: false; status: 401 | 403; error: string };

export type ScopeGuard =
  | { ok: true; session: SessionPayload; scope: AgentScope }
  | { ok: false; status: 401 | 403; error: string };

export async function requireRole(min: Role): Promise<Guard> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401, error: "로그인이 필요합니다." };
  if (!roleAtLeast(session.role, min)) return { ok: false, status: 403, error: "접근 권한이 없습니다." };
  return { ok: true, session };
}

export async function getScope(): Promise<AgentScope | null> {
  const session = await getSession();
  return session ? resolveScope(session) : null;
}

export async function requireAgent(agentId: string, min: Role = "DEV"): Promise<ScopeGuard> {
  const guard = await requireRole(min);
  if (!guard.ok) return guard;
  const scope = resolveScope(guard.session);
  if (isLockedScope(scope)) {
    return { ok: false, status: 403, error: "이 계정은 아직 에이전트가 배정되지 않았습니다. 운영자에게 문의하세요." };
  }
  if (!canViewAgent(scope, agentId)) {
    return { ok: false, status: 403, error: "이 에이전트에 접근할 권한이 없습니다." };
  }
  return { ok: true, session: guard.session, scope };
}

export async function requireAgentAdmin(agentId: string): Promise<ScopeGuard> {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard;
  const scope = resolveScope(guard.session);
  if (!canManageAgent(scope, guard.session.role, agentId)) {
    return { ok: false, status: 403, error: "이 에이전트를 관리할 권한이 없습니다." };
  }
  return { ok: true, session: guard.session, scope };
}

export async function requireGlobalAdmin(): Promise<ScopeGuard> {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard;
  const scope = resolveScope(guard.session);
  if (!scope.global) {
    return { ok: false, status: 403, error: "전역 운영자만 수정할 수 있습니다." };
  }
  return { ok: true, session: guard.session, scope };
}

export async function requireBiz(min: Role = "DEV"): Promise<ScopeGuard> {
  const { defaultAgentId } = await import("../config");
  return requireAgent(defaultAgentId(), min);
}
