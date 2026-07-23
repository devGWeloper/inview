// ─────────────────────────────────────────────────────────────────────────────
// 비밀번호 해싱 — Node 내장 crypto scrypt. 외부 의존성(bcrypt 등) 없음.
//
// ⚠️ 서버 전용 (Node 런타임). 미들웨어(Edge)나 클라이언트에서 import 금지.
//    저장 형태: PWD_HASH(hex) + PWD_SALT(hex) 를 계정별로 나눠 보관.
// ─────────────────────────────────────────────────────────────────────────────

import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

const KEYLEN = 64; // 파생 키 길이 (bytes)

export interface PasswordHash {
  hash: string; // hex
  salt: string; // hex
}

/** 평문 비밀번호 → { hash, salt } (계정별 난수 솔트). */
export function hashPassword(plain: string): PasswordHash {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, KEYLEN).toString("hex");
  return { hash, salt };
}

/** 평문이 저장된 hash/salt 와 일치하는지 (타이밍 안전 비교). */
export function verifyPassword(plain: string, hash: string, salt: string): boolean {
  if (!hash || !salt) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hash, "hex");
  } catch {
    return false;
  }
  const actual = scryptSync(plain, salt, KEYLEN);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** 비밀번호 정책(최소 길이 등) 검증. 통과하면 null, 아니면 사유 문자열. */
export function validatePasswordPolicy(plain: string): string | null {
  if (typeof plain !== "string" || plain.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (plain.length > 200) return "비밀번호가 너무 깁니다.";
  return null;
}
