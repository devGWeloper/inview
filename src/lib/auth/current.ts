// ─────────────────────────────────────────────────────────────────────────────
// 서버(라우트 핸들러 / 서버 컴포넌트)에서 현재 세션을 읽는 헬퍼.
// next/headers 의 cookies() 를 쓰므로 Node 런타임에서만 동작한다.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from "next/headers";
import { AUTH_COOKIE, verifySession, SessionPayload } from "./session";
import { Role, roleAtLeast } from "../roles";

/** 현재 요청의 세션. 없거나 무효/만료면 null. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(AUTH_COOKIE)?.value;
  return verifySession(token);
}

export type Guard =
  | { ok: true; session: SessionPayload }
  | { ok: false; status: 401 | 403; error: string };

/** 최소 권한을 요구한다. 라우트 핸들러 앞단에서 방어적으로 사용. */
export async function requireRole(min: Role): Promise<Guard> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401, error: "로그인이 필요합니다." };
  if (!roleAtLeast(session.role, min)) return { ok: false, status: 403, error: "접근 권한이 없습니다." };
  return { ok: true, session };
}
