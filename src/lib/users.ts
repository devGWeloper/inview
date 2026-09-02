
// 계정 CRUD · 로그인 검증. AGENT_ID / GLOBAL_YN 컬럼은 각각 존재를 탐지해 ALTER 전에도 돌지만,
// 범위를 쓰려는 요청은 조용히 무시하지 않고 throw 한다. docs/architecture/auth.md

import { getAppDbConfig, APP_DB_LAYER, getAgent } from "./config";
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

const SEED_ADMIN = {
  userId: "admin",
  name: "운영자",
  work: "시스템 관리자",
  role: "ADMIN" as Role,
  password: "admin1234",
};

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
    agentId: null,
    global: true, // 더미 관리자는 전역
    lastLoginDt: null,
    regDt: null,
    updDt: null,
  };
}

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
  agentId: string | null;
  global: boolean;
  lastLoginDt: string | null;
  regDt: string | null;
  updDt: string | null;
}

export interface UserListResult {
  available: boolean;
  reason?: string;
  users: UserAccount[];
  agentColumn?: boolean;
  globalColumn?: boolean;
}

const s = (r: Record<string, unknown>, k: string): string | null =>
  (r[k] ?? r[k.toLowerCase()] ?? null) as string | null;

function normAgentId(v: string | null | undefined): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const AGENT_COL_MISSING =
  "에이전트 결속을 저장할 수 없습니다 — TRX_USER_MAS.AGENT_ID 컬럼이 아직 없습니다. " +
  "앱 자체 DB(GAIA)에서 sql/migrations/2026-08-24_add_user_agent_id.sql 을 실행한 뒤 다시 시도하세요.";

const GLOBAL_COL_MISSING =
  "전역 권한을 저장할 수 없습니다 — TRX_USER_MAS.GLOBAL_YN 컬럼이 아직 없습니다. " +
  "앱 자체 DB(GAIA)에서 sql/migrations/2026-08-27_add_user_global_yn.sql 을 실행한 뒤 다시 시도하세요.";

export type AgentIdCheck =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function validateAgentId(v: unknown): AgentIdCheck {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: "에이전트 값이 올바르지 않습니다." };
  const id = normAgentId(v);
  if (!id) return { ok: true, value: null }; // "" / 공백 = 결속 없음(전 에이전트)
  if (!getAgent(id)) return { ok: false, error: `알 수 없는 에이전트: ${id}` };
  return { ok: true, value: id };
}

function rowToAccount(r: Record<string, unknown>, hasGlobal: boolean): UserAccount {
  const roleRaw = (s(r, "ROLE_CD") ?? "DEV").trim();
  const agentId = normAgentId(s(r, "AGENT_ID"));
  return {
    userId: String(s(r, "USER_ID") ?? ""),
    name: String(s(r, "USER_NM") ?? ""),
    work: s(r, "WORK_CTN"),
    role: isRole(roleRaw) ? roleRaw : "DEV",
    useYn: s(r, "USE_YN") === "N" ? "N" : "Y",
    agentId,
    global: hasGlobal ? s(r, "GLOBAL_YN") === "Y" : !agentId,
    lastLoginDt: s(r, "LAST_LOGIN_DT"),
    regDt: s(r, "REG_DT"),
    updDt: s(r, "UPD_DT"),
  };
}

const SELECT_COLS = `USER_ID, USER_NM, WORK_CTN, ROLE_CD, USE_YN,
       TO_CHAR(LAST_LOGIN_DT, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_LOGIN_DT,
       TO_CHAR(REG_DT, 'YYYY-MM-DD"T"HH24:MI:SS') AS REG_DT,
       TO_CHAR(UPD_DT, 'YYYY-MM-DD"T"HH24:MI:SS') AS UPD_DT`;

type Conn = Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof getOracle>>>["getConnection"]>>;

let agentColFound = false;
let globalColFound = false;

async function hasCol(conn: Conn, col: string, found: boolean, label: string): Promise<boolean> {
  if (found) return true;
  try {
    await conn.execute(`SELECT ${col} FROM TRX_USER_MAS WHERE 1 = 0`);
    return true;
  } catch (e) {
    if (!String(e).includes("ORA-00904")) {
      logger.warn(`${label}: ${col} 탐지 실패 — 이번 조회는 컬럼 없음으로 처리`, { err: String(e) });
    }
    return false;
  }
}

async function hasAgentCol(conn: Conn): Promise<boolean> {
  agentColFound = await hasCol(conn, "AGENT_ID", agentColFound, "hasAgentCol");
  return agentColFound;
}

async function hasGlobalCol(conn: Conn): Promise<boolean> {
  globalColFound = await hasCol(conn, "GLOBAL_YN", globalColFound, "hasGlobalCol");
  return globalColFound;
}

async function cols(conn: Conn): Promise<{ agent: boolean; global: boolean }> {
  return { agent: await hasAgentCol(conn), global: await hasGlobalCol(conn) };
}

function selectCols(c: { agent: boolean; global: boolean }): string {
  return `${SELECT_COLS},
       ${c.agent ? "AGENT_ID" : "CAST(NULL AS VARCHAR2(50)) AS AGENT_ID"},
       ${c.global ? "GLOBAL_YN" : "CAST(NULL AS CHAR(1)) AS GLOBAL_YN"}`;
}

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
    const seedGlobal = await hasGlobalCol(conn);
    await conn.execute(
      `INSERT INTO TRX_USER_MAS
         (USER_ID, USER_NM, WORK_CTN, ROLE_CD, PWD_HASH, PWD_SALT, USE_YN, MUST_CHG_YN${seedGlobal ? ", GLOBAL_YN" : ""}, REG_DT, UPD_DT)
       VALUES (:userId, :name, :work, :role, :hash, :salt, 'Y', 'N'${seedGlobal ? ", 'Y'" : ""}, SYSTIMESTAMP, SYSTIMESTAMP)`,
      { userId: SEED_ADMIN.userId, name: SEED_ADMIN.name, work: SEED_ADMIN.work, role: SEED_ADMIN.role, hash, salt },
      { autoCommit: true }
    );
    logger.warn("TRX_USER_MAS seeded default admin", { userId: SEED_ADMIN.userId });
  } catch (e) {
    logger.warn("ensureSeedAdmin skipped", { err: String(e) });
  }
}

export async function listUsers(): Promise<UserListResult> {
  if (!(await dbUsable()) && devBypassAllowed()) {
    return { available: true, users: [devAdminAccount()] };
  }
  try {
    return await withConn(async (conn, oracle) => {
      await ensureSeedAdmin(conn, oracle);
      const c = await cols(conn);
      const res = await conn.execute(
        `SELECT ${selectCols(c)} FROM TRX_USER_MAS ORDER BY REG_DT`,
        {},
        { outFormat: oracle.OBJECT }
      );
      const users = ((res.rows ?? []) as Record<string, unknown>[]).map((r) => rowToAccount(r, c.global));
      return { available: true, users, agentColumn: c.agent, globalColumn: c.global };
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
      const c = await cols(conn);
      const res = await conn.execute(
        `SELECT ${selectCols(c)} FROM TRX_USER_MAS WHERE USER_ID = :id`,
        { id },
        { outFormat: oracle.OBJECT }
      );
      const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined;
      return row ? rowToAccount(row, c.global) : null;
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
  agentId?: string | null;
  global?: boolean;
}

export async function createUser(input: CreateUserInput): Promise<UserAccount> {
  const userId = (input.userId ?? "").trim();
  const name = (input.name ?? "").trim();
  if (!userId) throw new Error("사번(USER_ID)은 필수입니다.");
  if (!name) throw new Error("이름은 필수입니다.");
  if (!isRole(input.role)) throw new Error("권한 값이 올바르지 않습니다.");
  await guardDevWrite();
  const { hash, salt } = hashPassword(input.password);
  return withConn(async (conn, oracle) => {
    const c = await cols(conn);
    if (input.agentId !== undefined && !c.agent) throw new Error(AGENT_COL_MISSING);
    if (input.global !== undefined && !c.global) throw new Error(GLOBAL_COL_MISSING);
    try {
      await conn.execute(
        `INSERT INTO TRX_USER_MAS
           (USER_ID, USER_NM, WORK_CTN, ROLE_CD, PWD_HASH, PWD_SALT, USE_YN, MUST_CHG_YN${c.agent ? ", AGENT_ID" : ""}${c.global ? ", GLOBAL_YN" : ""}, REG_DT, UPD_DT)
         VALUES (:userId, :name, :work, :role, :hash, :salt, :useYn, 'N'${c.agent ? ", :agentId" : ""}${c.global ? ", :globalYn" : ""}, SYSTIMESTAMP, SYSTIMESTAMP)`,
        {
          userId,
          name,
          work: (input.work ?? "").trim() || null,
          role: input.role,
          hash,
          salt,
          useYn: input.useYn === "N" ? "N" : "Y",
          ...(c.agent ? { agentId: normAgentId(input.agentId) } : {}),
          ...(c.global ? { globalYn: input.global ? "Y" : "N" } : {}),
        },
        { autoCommit: true }
      );
    } catch (e) {
      if (String(e).includes("ORA-00001")) throw new Error(`이미 존재하는 사번입니다: ${userId}`);
      throw e;
    }
    const created = await conn.execute(
      `SELECT ${selectCols(c)} FROM TRX_USER_MAS WHERE USER_ID = :userId`,
      { userId },
      { outFormat: oracle.OBJECT }
    );
    return rowToAccount((created.rows ?? [])[0] as Record<string, unknown>, c.global);
  });
}

export interface UpdateUserInput {
  name?: string;
  work?: string | null;
  role?: Role;
  useYn?: "Y" | "N";
  agentId?: string | null;
  global?: boolean;
}

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
  const wantAgent = input.agentId !== undefined;
  const wantGlobal = input.global !== undefined;
  if (sets.length === 0 && !wantAgent && !wantGlobal) {
    const cur = await getUser(id);
    if (!cur) throw new Error("존재하지 않는 계정입니다.");
    return cur;
  }
  return withConn(async (conn, oracle) => {
    const c = await cols(conn);
    if (wantAgent && !c.agent) throw new Error(AGENT_COL_MISSING);
    if (wantGlobal && !c.global) throw new Error(GLOBAL_COL_MISSING);
    if (wantAgent) {
      sets.push("AGENT_ID = :agentId");
      binds.agentId = normAgentId(input.agentId);
    }
    if (wantGlobal) {
      sets.push("GLOBAL_YN = :globalYn");
      binds.globalYn = input.global ? "Y" : "N";
    }
    const readBack = async (): Promise<UserAccount> => {
      const back = await conn.execute(
        `SELECT ${selectCols(c)} FROM TRX_USER_MAS WHERE USER_ID = :id`,
        { id },
        { outFormat: oracle.OBJECT }
      );
      const row = (back.rows ?? [])[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error("존재하지 않는 계정입니다.");
      return rowToAccount(row, c.global);
    };
    sets.push("UPD_DT = SYSTIMESTAMP");
    const res = await conn.execute(
      `UPDATE TRX_USER_MAS SET ${sets.join(", ")} WHERE USER_ID = :id`,
      binds,
      { autoCommit: true }
    );
    if (!res.rowsAffected) throw new Error("존재하지 않는 계정입니다.");
    return readBack();
  });
}

/**
 * 관리자에 의한 비밀번호 초기화.
 * TEMP(강제 변경 비활성): MUST_CHG_YN 을 'N' 으로 둔다. 되살리려면 'Y'.
 */
export async function resetPassword(userId: string, newPassword: string): Promise<void> {
  const id = (userId ?? "").trim();
  if (!id) throw new Error("사번(USER_ID)이 비어 있습니다.");
  await guardDevWrite();
  const { hash, salt } = hashPassword(newPassword);
  await withConn(async (conn) => {
    const res = await conn.execute(
      `UPDATE TRX_USER_MAS
          SET PWD_HASH = :hash, PWD_SALT = :salt, MUST_CHG_YN = 'N', UPD_DT = SYSTIMESTAMP
        WHERE USER_ID = :id`,
      { hash, salt, id },
      { autoCommit: true }
    );
    if (!res.rowsAffected) throw new Error("존재하지 않는 계정입니다.");
  });
}

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

export async function verifyLogin(userId: string, password: string): Promise<LoginResult> {
  const id = (userId ?? "").trim();
  if (!id || !password) return { ok: false, reason: "사번과 비밀번호를 입력하세요." };

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
      const c = await cols(conn);
      const res = await conn.execute(
        `SELECT ${selectCols(c)}, PWD_HASH, PWD_SALT FROM TRX_USER_MAS WHERE USER_ID = :id`,
        { id },
        { outFormat: oracle.OBJECT }
      );
      const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined;
      if (!row) return { ok: false, reason: "사번 또는 비밀번호가 올바르지 않습니다." };
      if (s(row, "USE_YN") === "N") return { ok: false, reason: "비활성화된 계정입니다. 관리자에게 문의하세요." };
      const ok = verifyPassword(password, String(s(row, "PWD_HASH") ?? ""), String(s(row, "PWD_SALT") ?? ""));
      if (!ok) return { ok: false, reason: "사번 또는 비밀번호가 올바르지 않습니다." };
      try {
        await conn.execute(
          `UPDATE TRX_USER_MAS SET LAST_LOGIN_DT = SYSTIMESTAMP WHERE USER_ID = :id`,
          { id },
          { autoCommit: true }
        );
      } catch { /* ignore */ }
      return { ok: true, user: rowToAccount(row, c.global) };
    });
  } catch (e) {
    logger.error("verifyLogin failed", { userId: id, err: String(e) });
    return { ok: false, reason: "로그인 처리 중 오류가 발생했습니다. 관리자에게 문의하세요." };
  }
}
