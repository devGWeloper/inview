// ─────────────────────────────────────────────────────────────────────────────
// 세션 토큰 (서명 쿠키).
//
// 형식:  base64url(JSON payload) + "." + base64url(HMAC-SHA256)
// payload = { sub: 사번, name, role, exp(초) }
//
// ⚠️ Edge 미들웨어와 Node 라우트 핸들러 양쪽에서 쓰므로 Web Crypto(globalThis.crypto
//    .subtle)만 사용한다. Node 전용 'crypto' 모듈이나 Buffer 를 import 하지 말 것.
//    (HMAC-SHA256 은 구현이 달라도 같은 바이트를 내므로 서명/검증 런타임이 달라도 OK)
//
// 비밀키: 환경변수 AUTH_SECRET. 없으면 개발용 폴백을 쓰되 경고한다 —
//    운영 배포 시 반드시 AUTH_SECRET 을 설정할 것.
// ─────────────────────────────────────────────────────────────────────────────

import { Role, isRole } from "../roles";

export const AUTH_COOKIE = "trx_session";
/** 세션 유효기간 (초). 기본 12시간. */
export const SESSION_TTL_SEC = 12 * 60 * 60;

/**
 * 세션 쿠키 옵션. `secure` 는 기본 false 다 — 사내 배포가 HTTP 일 수 있어
 * 프로덕션에서 무조건 secure 를 켜면 로그인이 막히기 때문. HTTPS 배포라면
 * 환경변수 `AUTH_COOKIE_SECURE=true` 로 켠다.
 */
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
  exp: number; // 만료 시각 (Unix epoch 초)
}

const DEV_FALLBACK_SECRET = "trx-inview-dev-secret-change-me";

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.trim()) return s;
  return DEV_FALLBACK_SECRET;
}

// ── base64url ↔ bytes (Buffer 없이, Edge/Node 공용) ───────────────────────
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

/** payload 를 서명해 세션 토큰 문자열을 만든다. */
export async function signSession(input: Omit<SessionPayload, "exp"> & { exp?: number }): Promise<string> {
  const exp = input.exp ?? Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload: SessionPayload = { sub: input.sub, name: input.name, role: input.role, exp };
  const body = strToB64url(JSON.stringify(payload));
  const key = await importKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${bytesToB64url(new Uint8Array(sig))}`;
}

/** 세션 토큰을 검증하고 만료를 확인한다. 유효하지 않으면 null. */
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
    if (!sub || !isRole(role)) return null;
    if (exp < Math.floor(Date.now() / 1000)) return null; // 만료
    return { sub, name, role, exp };
  } catch {
    return null;
  }
}
