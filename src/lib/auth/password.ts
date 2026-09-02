
// scrypt 해시. Node 내장 crypto 만 쓴다(배포가 src 복사라 native dep 회피).

import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

const KEYLEN = 64; // 파생 키 길이 (bytes)

export interface PasswordHash {
  hash: string; // hex
  salt: string; // hex
}

export function hashPassword(plain: string): PasswordHash {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, KEYLEN).toString("hex");
  return { hash, salt };
}

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

export function validatePasswordPolicy(plain: string): string | null {
  if (typeof plain !== "string" || plain.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (plain.length > 200) return "비밀번호가 너무 깁니다.";
  return null;
}
