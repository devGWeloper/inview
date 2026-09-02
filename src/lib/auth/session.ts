
// 서명 세션 쿠키. Edge 미들웨어와 Node 라우트가 같이 쓰므로 Web Crypto 만 사용한다.
// 만료는 로그인 시각 기준 고정(슬라이딩 갱신 없음) → 권한·범위 변경은 다음 로그인부터 적용된다.

import { Role, isRole, ScopeKind } from "../roles";

export const AUTH_COOKIE = "trx_session";
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge,
  };
}

export interface SessionPayload {
  sub: string; // 사번
  name: string;
  role: Role;
  agentId?: string;
  scope?: ScopeKind;
  bizAllowed?: boolean;
  exp: number; // 만료 시각 (Unix epoch 초)
}

const DEV_FALLBACK_SECRET = "trx-inview-dev-secret-change-me";

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.trim()) return s;
  return DEV_FALLBACK_SECRET;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function strToB64url(s: string): string {
  return bytesToB64url(new TextEncoder().encode(s));
}

function b64urlToStr(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

async function importKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function isScopeKind(v: unknown): v is ScopeKind {
  return v === "global" || v === "agent" || v === "locked";
}

export async function signSession(input: Omit<SessionPayload, "exp"> & { exp?: number }): Promise<string> {
  const exp = input.exp ?? Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload: SessionPayload = {
    sub: input.sub,
    name: input.name,
    role: input.role,
    agentId: input.agentId || undefined,
    scope: input.scope,
    bizAllowed: input.bizAllowed,
    exp,
  };
  const body = strToB64url(JSON.stringify(payload));
  const key = await importKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${bytesToB64url(new Uint8Array(sig))}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  try {
    const key = await importKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(sigPart),
      new TextEncoder().encode(body)
    );
    if (!ok) return null;
    const parsed = JSON.parse(b64urlToStr(body)) as Record<string, unknown>;
    const sub = typeof parsed.sub === "string" ? parsed.sub : "";
    const name = typeof parsed.name === "string" ? parsed.name : "";
    const role = parsed.role;
    const exp = typeof parsed.exp === "number" ? parsed.exp : 0;
    const agentId = typeof parsed.agentId === "string" && parsed.agentId ? parsed.agentId : undefined;
    const scope = isScopeKind(parsed.scope) ? parsed.scope : undefined;
    const bizAllowed = typeof parsed.bizAllowed === "boolean" ? parsed.bizAllowed : undefined;
    if (!sub || !isRole(role)) return null;
    if (exp < Math.floor(Date.now() / 1000)) return null; // 만료
    return { sub, name, role, agentId, scope, bizAllowed, exp };
  } catch {
    return null;
  }
}
