// ─────────────────────────────────────────────────────────────────────────────
// 세션 토큰 (서명 쿠키).
//
// 형식:  base64url(JSON payload) + "." + base64url(HMAC-SHA256)
// payload = { sub: 사번, name, role, agentId?(결속 에이전트), exp(초) }
//
// ⚠️ Edge 미들웨어와 Node 라우트 핸들러 양쪽에서 쓰므로 Web Crypto(globalThis.crypto
//    .subtle)만 사용한다. Node 전용 'crypto' 모듈이나 Buffer 를 import 하지 말 것.
//    (HMAC-SHA256 은 구현이 달라도 같은 바이트를 내므로 서명/검증 런타임이 달라도 OK)
//
// 비밀키: 환경변수 AUTH_SECRET. 없으면 개발용 폴백을 쓰되 경고한다 —
//    운영 배포 시 반드시 AUTH_SECRET 을 설정할 것.
// ─────────────────────────────────────────────────────────────────────────────

import { Role, isRole, ScopeKind } from "../roles";

export const AUTH_COOKIE = "trx_session";
/**
 * 세션 유효기간 (초). 기본 7일.
 *
 * 슬라이딩 갱신은 없다 — **로그인 시각 기준 고정 만료**라 사용 중이어도 7일이 지나면 끊긴다.
 * (활동 기준으로 연장하려면 미들웨어에서 매 요청 재서명해야 한다.)
 */
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

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
  /**
   * 소속 에이전트 id (TRX_USER_MAS.AGENT_ID). 없으면 미배정.
   *
   * ⚠️ **이 값만 보고 범위를 판정하지 말 것** — 판정은 `scope` 와 묶어서
   *    roles.ts 의 resolveScope()/canViewAgent() 로만 한다. 예전 규칙("없음 = 전 에이전트")과
   *    지금 규칙("없음 = 잠금")이 정반대라, 직접 비교하면 조용히 뒤집힌다.
   */
  agentId?: string;
  /**
   * 스코프 종류 — "global"(전 에이전트) / "agent"(agentId 하나) / "locked"(미배정).
   *
   * ⚠️ optional 인 이유는 **이 필드가 생기기 전에 발급된 쿠키**에 키가 없기 때문이다.
   *    없으면 resolveScope() 가 옛 규칙(agentId 없음 = 전 에이전트)으로 읽어 살아 있는
   *    로그인을 끊지 않는다. 새로 발급되는 토큰은 항상 싣는다.
   */
  scope?: ScopeKind;
  /**
   * BIZ_AIACTIONTXN_HIS 기반 화면(Traces/Dashboard/Report/Improvement/Agent)에 들어갈 수 있는가
   * = 전역이거나 기본 에이전트 소속.
   *
   * ⚠️ 미들웨어(Edge)는 config.yml 을 읽을 수 없어(fs) 기본 에이전트 id 를 모른다. 그래서
   *    로그인 시점(Node)에 계산해 클레임으로 싣는다. **권위 있는 판정은 API 라우트**가
   *    실제 defaultAgentId() 로 다시 하며, 이 클레임은 화면 리다이렉트(UX)용이다.
   *    role 과 마찬가지로 로그인 시점에 고정되므로, 소속 변경은 다음 로그인부터 반영된다.
   */
  bizAllowed?: boolean;
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

function isScopeKind(v: unknown): v is ScopeKind {
  return v === "global" || v === "agent" || v === "locked";
}

/** payload 를 서명해 세션 토큰 문자열을 만든다. */
export async function signSession(input: Omit<SessionPayload, "exp"> & { exp?: number }): Promise<string> {
  const exp = input.exp ?? Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  // 값이 없는 키는 JSON.stringify 가 통째로 빼므로 토큰이 불필요하게 커지지 않는다.
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
    // ⚠️ agentId 는 **없어도 정상**이다 (결속 없는 계정 · 이 필드 이전에 발급된 쿠키).
    //    필수로 다루면 배포 직후 기존 세션이 전부 로그아웃된다.
    const agentId = typeof parsed.agentId === "string" && parsed.agentId ? parsed.agentId : undefined;
    // ⚠️ scope/bizAllowed 도 **없어도 정상**이다 (이 필드들 이전에 발급된 쿠키).
    //    resolveScope() 가 없을 때의 옛 규칙을 안다 — 여기서 기본값을 넣지 말 것.
    const scope = isScopeKind(parsed.scope) ? parsed.scope : undefined;
    const bizAllowed = typeof parsed.bizAllowed === "boolean" ? parsed.bizAllowed : undefined;
    if (!sub || !isRole(role)) return null;
    if (exp < Math.floor(Date.now() / 1000)) return null; // 만료
    return { sub, name, role, agentId, scope, bizAllowed, exp };
  } catch {
    return null;
  }
}
