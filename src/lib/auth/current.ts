// ─────────────────────────────────────────────────────────────────────────────
// 서버(라우트 핸들러 / 서버 컴포넌트)에서 현재 세션을 읽는 헬퍼.
// next/headers 의 cookies() 를 쓰므로 Node 런타임에서만 동작한다.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from "next/headers";
import { AUTH_COOKIE, verifySession, SessionPayload } from "./session";
import {
  Role, roleAtLeast, AgentScope, resolveScope, canViewAgent, canManageAgent, isLockedScope,
} from "../roles";

/** 현재 요청의 세션. 없거나 무효/만료면 null. */
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

/** 최소 권한을 요구한다. 라우트 핸들러 앞단에서 방어적으로 사용. */
export async function requireRole(min: Role): Promise<Guard> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401, error: "로그인이 필요합니다." };
  if (!roleAtLeast(session.role, min)) return { ok: false, status: 403, error: "접근 권한이 없습니다." };
  return { ok: true, session };
}

/** 현재 세션의 에이전트 범위. 세션이 없으면 null. */
export async function getScope(): Promise<AgentScope | null> {
  const session = await getSession();
  return session ? resolveScope(session) : null;
}

/**
 * 대상 에이전트를 **열람**할 권한을 요구한다.
 *
 * ⚠️ 호출 순서가 중요하다 — 라우트에서 "알 수 없는 에이전트(400)" 판정을 **먼저** 하고
 *    이 가드를 부른다. "그런 에이전트는 없다" 와 "네 것이 아니다" 는 다른 답이다.
 */
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

/**
 * 대상 에이전트를 **관리**(프로필/한도/계정 편집)할 권한을 요구한다.
 * = ADMIN 이면서 그 에이전트를 볼 수 있어야 한다(전역 ADMIN 또는 그 에이전트의 ADMIN).
 */
export async function requireAgentAdmin(agentId: string): Promise<ScopeGuard> {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard;
  const scope = resolveScope(guard.session);
  if (!canManageAgent(scope, guard.session.role, agentId)) {
    return { ok: false, status: 403, error: "이 에이전트를 관리할 권한이 없습니다." };
  }
  return { ok: true, session: guard.session, scope };
}

/**
 * **전역 ADMIN** 을 요구한다 — 에이전트에 매이지 않은 앱 전체 자산의 쓰기 권한.
 *
 * ⚠️ requireAgentAdmin 과 다르다. 그쪽은 "그 에이전트의 ADMIN" 도 통과시키므로
 *    에이전트 하나에 속한 운영자가 **앱 전체**가 공유하는 문서를 고칠 수 있게 된다.
 *    로드맵(data/roadmap.json)처럼 에이전트 구분 없이 1벌뿐인 자원의 쓰기는 이 가드를 쓴다.
 */
export async function requireGlobalAdmin(): Promise<ScopeGuard> {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard;
  const scope = resolveScope(guard.session);
  if (!scope.global) {
    return { ok: false, status: 403, error: "전역 운영자만 수정할 수 있습니다." };
  }
  return { ok: true, session: guard.session, scope };
}

/**
 * BIZ_AIACTIONTXN_HIS 기반 화면/API 접근 권한을 요구한다 (기본 에이전트 전용).
 *
 * ⚠️ 미들웨어의 bizAllowed 클레임은 로그인 시점에 고정된 캐시라 **권위가 없다**.
 *    실제 판정은 여기서 매 요청 현재 config 의 기본 에이전트 id 로 다시 한다.
 *    (config 를 읽어야 하므로 Node 런타임 전용 — Edge 미들웨어에서 부르지 말 것)
 */
export async function requireBiz(min: Role = "DEV"): Promise<ScopeGuard> {
  const { defaultAgentId } = await import("../config");
  return requireAgent(defaultAgentId(), min);
}
