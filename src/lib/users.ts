// ─────────────────────────────────────────────────────────────────────────────
// 사용자 계정(TRX_USER_MAS) 데이터 접근 계층 — 인증/인가의 저장소.
//
// 앱 자체 DB(= GAIA, getAppDbConfig)에 있는 TRX_USER_MAS 를 읽고 쓴다.
// oracledb 는 next.config 의 serverComponentsExternalPackages 로 빠져 있어 lazy import.
// 드라이버/설정/테이블이 없으면 available=false + reason 으로 내려 화면이 안내한다.
//
// ⚠️ 서버 전용 (Node 런타임). 미들웨어(Edge)/클라이언트에서 import 금지.
// ─────────────────────────────────────────────────────────────────────────────

import { getAppDbConfig, APP_DB_LAYER } from "./config";
import { Role, isRole } from "./roles";
import { hashPassword, verifyPassword } from "./auth/password";
import { logger } from "./logger";

let oracledbCached: typeof import("oracledb") | null = null;
async function getOracle(): Promise<typeof import("oracledb") | null> {
  if (oracledbCached) return oracledbCached;
  try {
    const mod = await import("oracledb");
    oracledbCached = mod;
    return mod;
  } catch {
    return null;
  }
}

// 최초 관리자 시드 (테이블이 비어 있을 때 1회 생성)
const SEED_ADMIN = {
  userId: "admin",
  name: "운영자",
  work: "시스템 관리자",
  role: "ADMIN" as Role,
  password: "admin1234",
};

// ─────────────────────────────────────────────────────────────────────────────
// 로컬 디버깅용 더미 관리자 (⚠️ DB 없을 때만 · 운영 빌드에서는 절대 동작 안 함)
//
// 로컬에서 Oracle 이 없으면 로그인 자체가 불가해 UI 를 볼 수 없다. 그래서
// "개발 모드(NODE_ENV!==production) + 계정 DB 미연결" 일 때만 admin/admin 으로
// 통과시켜 화면을 디버깅할 수 있게 한다. 조건이 둘 다여서:
//   - `npm run start`(운영) 이나 `npm run build` 산출물에서는 NODE_ENV=production → 비활성
//   - DB 가 붙은 사내 환경에서는 dbUsable()=true → 비활성 (실제 계정만 유효)
// 강제로 끄려면 DEV_AUTH_BYPASS=off.
// ─────────────────────────────────────────────────────────────────────────────
const DEV_ADMIN = {
  userId: "admin",
  password: "admin",
  name: "로컬 관리자 (DEV)",
  work: "로컬 디버깅용 더미 계정",
  role: "ADMIN" as Role,
};

function devBypassAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS !== "off";
}

/** 계정 DB 를 실제로 쓸 수 있는가 (설정 + 드라이버 모두 존재). */
async function dbUsable(): Promise<boolean> {
  return getAppDbConfig() != null && (await getOracle()) != null;
}

function devAdminAccount(): UserAccount {
  return {
    userId: DEV_ADMIN.userId,
    name: DEV_ADMIN.name,
    work: DEV_ADMIN.work,
    role: DEV_ADMIN.role,
    useYn: "Y",
    mustChangePw: false,
    lastLoginDt: null,
    regDt: null,
    updDt: null,
  };
}

/** 쓰기 작업 진입 시 로컬 더미 모드면 명확한 메시지로 막는다(무해). */
async function guardDevWrite(): Promise<void> {
  if (!(await dbUsable()) && devBypassAllowed()) {
    throw new Error("로컬 디버깅 모드(DB 미연결)에서는 계정 저장/변경이 지원되지 않습니다.");
  }
}

export interface UserAccount {
  userId: string;
  name: string;
  work: string | null;
  role: Role;
  useYn: "Y" | "N";
  mustChangePw: boolean;
  lastLoginDt: string | null;
  regDt: string | null;
  updDt: string | null;
}

export interface UserListResult {
  available: boolean;
  reason?: string;
  users: UserAccount[];
}

const s = (r: Record<string, unknown>, k: string): string | null =>
  (r[k] ?? r[k.toLowerCase()] ?? null) as string | null;

function rowToAccount(r: Record<string, unknown>): UserAccount {
  const roleRaw = (s(r, "ROLE_CD") ?? "DEV").trim();
  return {
    userId: String(s(r, "USER_ID") ?? ""),
    name: String(s(r, "USER_NM") ?? ""),
    work: s(r, "WORK_CTN"),
    role: isRole(roleRaw) ? roleRaw : "DEV",
    useYn: s(r, "USE_YN") === "N" ? "N" : "Y",
    mustChangePw: s(r, "MUST_CHG_YN") === "Y",
    lastLoginDt: s(r, "LAST_LOGIN_DT"),
    regDt: s(r, "REG_DT"),
    updDt: s(r, "UPD_DT"),
  };
}

const SELECT_COLS = `USER_ID, USER_NM, WORK_CTN, ROLE_CD, USE_YN, MUST_CHG_YN,
       TO_CHAR(LAST_LOGIN_DT, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_LOGIN_DT,
       TO_CHAR(REG_DT, 'YYYY-MM-DD"T"HH24:MI:SS') AS REG_DT,
       TO_CHAR(UPD_DT, 'YYYY-MM-DD"T"HH24:MI:SS') AS UPD_DT`;

type Conn = Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof getOracle>>>["getConnection"]>>;

async function withConn<T>(
  fn: (conn: Conn, oracle: NonNullable<Awaited<ReturnType<typeof getOracle>>>) => Promise<T>
): Promise<T> {
  const cfg = getAppDbConfig();
  if (!cfg) throw new Error(`${APP_DB_LAYER} DB 미구성 — config.yml 의 layers.${APP_DB_LAYER} 를 확인하세요.`);
  const oracle = await getOracle();
  if (!oracle) throw new Error("oracledb 드라이버를 사용할 수 없습니다.");
  let conn: Conn | undefined;
  try {
    conn = await oracle.getConnection(cfg);
    return await fn(conn, oracle);
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * 테이블이 비어 있으면 기본 운영자 계정을 시드한다 (best-effort).
 * 테이블 미생성(ORA-00942) 등은 조용히 무시 — 상위에서 available=false 로 처리.
 */
async function ensureSeedAdmin(conn: Conn, oracle: NonNullable<Awaited<ReturnType<typeof getOracle>>>): Promise<void> {
  try {
    const cnt = await conn.execute(
      `SELECT COUNT(*) AS N FROM TRX_USER_MAS`,
      {},
      { outFormat: oracle.OBJECT }
    );
    const n = Number((cnt.rows?.[0] as Record<string, unknown> | undefined)?.["N"] ?? 0);
    if (n > 0) return;
    const { hash, salt } = hashPassword(SEED_ADMIN.password);
    await conn.execute(
      `INSERT INTO TRX_USER_MAS
         (USER_ID, USER_NM, WORK_CTN, ROLE_CD, PWD_HASH, PWD_SALT, USE_YN, MUST_CHG_YN, REG_DT, UPD_DT)
       VALUES (:userId, :name, :work, :role, :hash, :salt, 'Y', 'Y', SYSTIMESTAMP, SYSTIMESTAMP)`,
      { userId: SEED_ADMIN.userId, name: SEED_ADMIN.name, work: SEED_ADMIN.work, role: SEED_ADMIN.role, hash, salt },
      { autoCommit: true }
    );
    logger.warn("TRX_USER_MAS seeded default admin", { userId: SEED_ADMIN.userId });
  } catch (e) {
    logger.warn("ensureSeedAdmin skipped", { err: String(e) });
  }
}

/** 계정 목록 조회 (관리자 화면). DB 불가 시 available=false + reason. */
export async function listUsers(): Promise<UserListResult> {
  // 로컬 디버깅 모드: DB 없이도 더미 관리자 1건을 보여줘 화면을 확인할 수 있게 한다.
  if (!(await dbUsable()) && devBypassAllowed()) {
    return { available: true, users: [devAdminAccount()] };
  }
  try {
    return await withConn(async (conn, oracle) => {
      await ensureSeedAdmin(conn, oracle);
      const res = await conn.execute(
        `SELECT ${SELECT_COLS} FROM TRX_USER_MAS ORDER BY REG_DT`,
        {},
        { outFormat: oracle.OBJECT }
      );
      const users = ((res.rows ?? []) as Record<string, unknown>[]).map(rowToAccount);
      return { available: true, users };
    });
  } catch (e) {
    logger.error("listUsers failed", { err: String(e) });
    return { available: false, reason: String(e), users: [] };
  }
}

export async function getUser(userId: string): Promise<UserAccount | null> {
  const id = (userId ?? "").trim();
  if (!id) return null;
  try {
    return await withConn(async (conn, oracle) => {
      const res = await conn.execute(
        `SELECT ${SELECT_COLS} FROM TRX_USER_MAS WHERE USER_ID = :id`,
        { id },
        { outFormat: oracle.OBJECT }
      );
      const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined;
      return row ? rowToAccount(row) : null;
    });
  } catch (e) {
    logger.error("getUser failed", { userId: id, err: String(e) });
    return null;
  }
}

export interface CreateUserInput {
  userId: string;
  name: string;
  work?: string | null;
  role: Role;
  password: string;
  useYn?: "Y" | "N";
  mustChangePw?: boolean;
}

/** 계정 생성. 사번 중복 시 throw. */
export async function createUser(input: CreateUserInput): Promise<UserAccount> {
  const userId = (input.userId ?? "").trim();
  const name = (input.name ?? "").trim();
  if (!userId) throw new Error("사번(USER_ID)은 필수입니다.");
  if (!name) throw new Error("이름은 필수입니다.");
  if (!isRole(input.role)) throw new Error("권한 값이 올바르지 않습니다.");
  await guardDevWrite();
  const { hash, salt } = hashPassword(input.password);
  return withConn(async (conn, oracle) => {
    try {
      await conn.execute(
        `INSERT INTO TRX_USER_MAS
           (USER_ID, USER_NM, WORK_CTN, ROLE_CD, PWD_HASH, PWD_SALT, USE_YN, MUST_CHG_YN, REG_DT, UPD_DT)
         VALUES (:userId, :name, :work, :role, :hash, :salt, :useYn, :mustChg, SYSTIMESTAMP, SYSTIMESTAMP)`,
        {
          userId,
          name,
          work: (input.work ?? "").trim() || null,
          role: input.role,
          hash,
          salt,
          useYn: input.useYn === "N" ? "N" : "Y",
          mustChg: input.mustChangePw === false ? "N" : "Y",
        },
        { autoCommit: true }
      );
    } catch (e) {
      // ORA-00001: unique constraint (사번 중복)
      if (String(e).includes("ORA-00001")) throw new Error(`이미 존재하는 사번입니다: ${userId}`);
      throw e;
    }
    const created = await conn.execute(
      `SELECT ${SELECT_COLS} FROM TRX_USER_MAS WHERE USER_ID = :userId`,
      { userId },
      { outFormat: oracle.OBJECT }
    );
    return rowToAccount((created.rows ?? [])[0] as Record<string, unknown>);
  });
}

export interface UpdateUserInput {
  name?: string;
  work?: string | null;
  role?: Role;
  useYn?: "Y" | "N";
}

/** 계정 정보 수정 (비밀번호 제외). */
export async function updateUser(userId: string, input: UpdateUserInput): Promise<UserAccount> {
  const id = (userId ?? "").trim();
  if (!id) throw new Error("사번(USER_ID)이 비어 있습니다.");
  await guardDevWrite();
  const sets: string[] = [];
  const binds: Record<string, unknown> = { id };
  if (input.name !== undefined) {
    const nm = input.name.trim();
    if (!nm) throw new Error("이름은 비울 수 없습니다.");
    sets.push("USER_NM = :name");
    binds.name = nm;
  }
  if (input.work !== undefined) {
    sets.push("WORK_CTN = :work");
    binds.work = (input.work ?? "").trim() || null;
  }
  if (input.role !== undefined) {
    if (!isRole(input.role)) throw new Error("권한 값이 올바르지 않습니다.");
    sets.push("ROLE_CD = :role");
    binds.role = input.role;
  }
  if (input.useYn !== undefined) {
    sets.push("USE_YN = :useYn");
    binds.useYn = input.useYn === "N" ? "N" : "Y";
  }
  if (sets.length === 0) {
    const cur = await getUser(id);
    if (!cur) throw new Error("존재하지 않는 계정입니다.");
    return cur;
  }
  sets.push("UPD_DT = SYSTIMESTAMP");
  return withConn(async (conn, oracle) => {
    const res = await conn.execute(
      `UPDATE TRX_USER_MAS SET ${sets.join(", ")} WHERE USER_ID = :id`,
      binds,
      { autoCommit: true }
    );
    if (!res.rowsAffected) throw new Error("존재하지 않는 계정입니다.");
    const back = await conn.execute(
      `SELECT ${SELECT_COLS} FROM TRX_USER_MAS WHERE USER_ID = :id`,
      { id },
      { outFormat: oracle.OBJECT }
    );
    return rowToAccount((back.rows ?? [])[0] as Record<string, unknown>);
  });
}

/** 관리자에 의한 비밀번호 초기화. mustChangePw 를 켜 다음 로그인에서 변경 유도. */
export async function resetPassword(userId: string, newPassword: string): Promise<void> {
  const id = (userId ?? "").trim();
  if (!id) throw new Error("사번(USER_ID)이 비어 있습니다.");
  await guardDevWrite();
  const { hash, salt } = hashPassword(newPassword);
  await withConn(async (conn) => {
    const res = await conn.execute(
      `UPDATE TRX_USER_MAS
          SET PWD_HASH = :hash, PWD_SALT = :salt, MUST_CHG_YN = 'Y', UPD_DT = SYSTIMESTAMP
        WHERE USER_ID = :id`,
      { hash, salt, id },
      { autoCommit: true }
    );
    if (!res.rowsAffected) throw new Error("존재하지 않는 계정입니다.");
  });
}

/** 본인 비밀번호 변경 (현재 비밀번호 확인 후). mustChangePw 해제. */
export async function changeOwnPassword(userId: string, currentPw: string, newPw: string): Promise<void> {
  const id = (userId ?? "").trim();
  if (!id) throw new Error("사번(USER_ID)이 비어 있습니다.");
  await guardDevWrite();
  await withConn(async (conn, oracle) => {
    const res = await conn.execute(
      `SELECT PWD_HASH, PWD_SALT FROM TRX_USER_MAS WHERE USER_ID = :id AND USE_YN = 'Y'`,
      { id },
      { outFormat: oracle.OBJECT }
    );
    const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("존재하지 않는 계정입니다.");
    const ok = verifyPassword(currentPw, String(s(row, "PWD_HASH") ?? ""), String(s(row, "PWD_SALT") ?? ""));
    if (!ok) throw new Error("현재 비밀번호가 올바르지 않습니다.");
    const { hash, salt } = hashPassword(newPw);
    await conn.execute(
      `UPDATE TRX_USER_MAS
          SET PWD_HASH = :hash, PWD_SALT = :salt, MUST_CHG_YN = 'N', UPD_DT = SYSTIMESTAMP
        WHERE USER_ID = :id`,
      { hash, salt, id },
      { autoCommit: true }
    );
  });
}

/** 계정 삭제. */
export async function deleteUser(userId: string): Promise<void> {
  const id = (userId ?? "").trim();
  if (!id) throw new Error("사번(USER_ID)이 비어 있습니다.");
  await guardDevWrite();
  await withConn(async (conn) => {
    const res = await conn.execute(`DELETE FROM TRX_USER_MAS WHERE USER_ID = :id`, { id }, { autoCommit: true });
    if (!res.rowsAffected) throw new Error("존재하지 않는 계정입니다.");
  });
}

export type LoginResult =
  | { ok: true; user: UserAccount }
  | { ok: false; reason: string };

/**
 * 로그인 검증. 사번+비밀번호를 확인하고 성공 시 계정 정보를 돌려준다.
 * 최초 로그인 시드(테이블 비어 있을 때) 도 여기서 보장한다.
 */
export async function verifyLogin(userId: string, password: string): Promise<LoginResult> {
  const id = (userId ?? "").trim();
  if (!id || !password) return { ok: false, reason: "사번과 비밀번호를 입력하세요." };

  // 로컬 디버깅: DB 미연결 + 개발 모드면 더미 관리자(admin/admin)로 통과.
  if (!(await dbUsable()) && devBypassAllowed()) {
    if (id === DEV_ADMIN.userId && password === DEV_ADMIN.password) {
      logger.warn("DEV auth bypass login (no DB) — admin/admin", { userId: id });
      return { ok: true, user: devAdminAccount() };
    }
    return { ok: false, reason: "로컬(DB 미연결) 모드입니다. admin / admin 으로 로그인하세요." };
  }

  try {
    return await withConn(async (conn, oracle) => {
      await ensureSeedAdmin(conn, oracle);
      const res = await conn.execute(
        `SELECT ${SELECT_COLS}, PWD_HASH, PWD_SALT FROM TRX_USER_MAS WHERE USER_ID = :id`,
        { id },
        { outFormat: oracle.OBJECT }
      );
      const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined;
      if (!row) return { ok: false, reason: "사번 또는 비밀번호가 올바르지 않습니다." };
      if (s(row, "USE_YN") === "N") return { ok: false, reason: "비활성화된 계정입니다. 관리자에게 문의하세요." };
      const ok = verifyPassword(password, String(s(row, "PWD_HASH") ?? ""), String(s(row, "PWD_SALT") ?? ""));
      if (!ok) return { ok: false, reason: "사번 또는 비밀번호가 올바르지 않습니다." };
      // 최근 로그인 갱신 (실패해도 로그인은 성공)
      try {
        await conn.execute(
          `UPDATE TRX_USER_MAS SET LAST_LOGIN_DT = SYSTIMESTAMP WHERE USER_ID = :id`,
          { id },
          { autoCommit: true }
        );
      } catch { /* ignore */ }
      return { ok: true, user: rowToAccount(row) };
    });
  } catch (e) {
    logger.error("verifyLogin failed", { userId: id, err: String(e) });
    return { ok: false, reason: "로그인 처리 중 오류가 발생했습니다. 관리자에게 문의하세요." };
  }
}
