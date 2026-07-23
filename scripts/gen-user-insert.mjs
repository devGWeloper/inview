// TRX_USER_MAS 계정 1건 INSERT 문 생성기.
//
// 비밀번호는 앱과 동일한 scrypt(솔트 hex, keylen 64)로 해시한다
// (src/lib/auth/password.ts hashPassword 와 동일 파라미터) — 그래야 로그인 검증이 통과한다.
//
// 사용:
//   node scripts/gen-user-insert.mjs <사번> <이름> <비밀번호> [권한=ADMIN] [업무]
// 예:
//   node scripts/gen-user-insert.mjs I0103083 김기웅 "MyPass1234!" ADMIN "시스템 관리자"

import { scryptSync, randomBytes } from "crypto";

const [, , userId, name, password, role = "ADMIN", work = ""] = process.argv;

if (!userId || !name || !password) {
  console.error("사용법: node scripts/gen-user-insert.mjs <사번> <이름> <비밀번호> [권한=ADMIN] [업무]");
  process.exit(1);
}
if (!["ADMIN", "BR", "DEV"].includes(role)) {
  console.error(`권한은 ADMIN/BR/DEV 중 하나여야 합니다 (입력: ${role})`);
  process.exit(1);
}
if (password.length < 8) {
  console.error("비밀번호는 8자 이상이어야 합니다.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
const q = (s) => `'${String(s).replace(/'/g, "''")}'`; // 작은따옴표 이스케이프

const sql = `INSERT INTO TRX_USER_MAS
  (USER_ID, USER_NM, WORK_CTN, ROLE_CD, PWD_HASH, PWD_SALT, USE_YN, MUST_CHG_YN, REG_DT, UPD_DT)
VALUES (${q(userId)}, ${q(name)}, ${work ? q(work) : "NULL"}, ${q(role)},
        ${q(hash)}, ${q(salt)}, 'Y', 'N', SYSTIMESTAMP, SYSTIMESTAMP);
COMMIT;`;

console.log("\n-- 앱 자체 DB(GAIA)에서 실행하세요. 비밀번호는 위 인자로 준 값입니다.");
console.log(sql + "\n");
