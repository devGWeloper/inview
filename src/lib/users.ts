// ─────────────────────────────────────────────────────────────────────────────
// 사용자 계정(TRX_USER_MAS) 데이터 접근 계층 — 인증/인가의 저장소.
//
// 앱 자체 DB(= GAIA, getAppDbConfig)에 있는 TRX_USER_MAS 를 읽고 쓴다.
// oracledb 는 next.config 의 serverComponentsExternalPackages 로 빠져 있어 lazy import.
// 드라이버/설정/테이블이 없으면 available=false + reason 으로 내려 화면이 안내한다.
//
// ⚠️ 서버 전용 (Node 런타임). 미들웨어(Edge)/클라이언트에서 import 금지.
// ─────────────────────────────────────────────────────────────────────────────

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
    agentId: null, // 더미 관리자는 결속 없음(전 에이전트)
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
  /** 접근 가능 에이전트 id (null = 전 에이전트). ⚠️ AGENT_ID 컬럼이 없으면 항상 null. */
  agentId: string | null;
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

/** 에이전트 결속 값 정규화 — 빈 문자열/공백은 "결속 없음"(NULL) 과 같게 본다. */
function normAgentId(v: string | null | undefined): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * AGENT_ID 컬럼이 없는데 결속을 **쓰려 한** 경우의 오류.
 *
 * ⚠️ 읽기와 달리 쓰기는 조용히 넘어가면 안 된다 — 관리자가 결속을 지정하고 저장했는데
 *    아무 일도 일어나지 않고 화면은 "전체" 로 남으면, 묶었다고 믿은 채로 끝난다.
 *    (읽기 내성은 그대로다: 컬럼이 없으면 전원 NULL 로 읽히고, 결속을 건드리지 않는
 *     계정 수정은 ALTER 전에도 정상 저장된다.)
 */
const AGENT_COL_MISSING =
  "에이전트 결속을 저장할 수 없습니다 — TRX_USER_MAS.AGENT_ID 컬럼이 아직 없습니다. " +
  "앱 자체 DB(GAIA)에서 sql/migrations/2026-08-24_add_user_agent_id.sql 을 실행한 뒤 다시 시도하세요.";

export type AgentIdCheck =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * 계정 저장 요청으로 들어온 에이전트 결속 값을 검증한다 (계정 API 의 쓰기 경로에서 사용).
 *
 * 없는 id 를 그대로 저장하면 그 계정은 로그인 후 /api/agents 목록이 비고 조회는 403 만
 * 돌려받는데, 화면에는 아무 단서도 남지 않는다. 그래서 **저장 시점에** 막는다.
 *
 * ⚠️ `getAgent("")` 는 **기본 에이전트**를 돌려준다 — 빈 값을 truthy 검사 없이 넘기면
 *    "제한 없음" 이 조용히 "기본 에이전트 결속" 으로 바뀐다. 빈 값은 먼저 null 로 떨군다.
 */
export function validateAgentId(v: unknown): AgentIdCheck {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: "에이전트 값이 올바르지 않습니다." };
  const id = normAgentId(v);
  if (!id) return { ok: true, value: null }; // "" / 공백 = 결속 없음(전 에이전트)
  if (!getAgent(id)) return { ok: false, error: `알 수 없는 에이전트: ${id}` };
  return { ok: true, value: id };
}

function rowToAccount(r: Record<string, unknown>): UserAccount {
  const roleRaw = (s(r, "ROLE_CD") ?? "DEV").trim();
  return {
    userId: String(s(r, "USER_ID") ?? ""),
    name: String(s(r, "USER_NM") ?? ""),
    work: s(r, "WORK_CTN"),
    role: isRole(roleRaw) ? roleRaw : "DEV",
    useYn: s(r, "USE_YN") === "N" ? "N" : "Y",
    // 컬럼이 없는 SELECT 는 selectCols() 가 상수 NULL 로 채워 주므로 여기 분기는 없다.
    agentId: normAgentId(s(r, "AGENT_ID")),
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

// ─────────────────────────────────────────────────────────────────────────────
// AGENT_ID 컬럼 존재 탐지 — ALTER 전에도 앱이 그대로 동작해야 한다.
//
// 사내 배포는 src 복붙 + 수동 ALTER 라 배포와 DDL 의 순서가 자유로워야 한다.
// tokens.ts 의 hasStatus 와 같은 패턴: WHERE 1=0 이라 행은 읽지 않고 파싱만 태운다.
//
// ⚠️ 캐시는 **true 만** 기억한다. false 까지 캐시하면 ALTER 를 한 뒤에도 프로세스를
//    재시작하기 전까지 컬럼을 계속 무시하게 된다(전원 NULL = 결속 해제). 이렇게 두면
//    컬럼이 생긴 다음 호출부터 바로 잡히고, 한 번 잡힌 뒤로는 탐지 쿼리가 사라진다.
// ─────────────────────────────────────────────────────────────────────────────
let agentColFound = false;

async function hasAgentCol(conn: Conn): Promise<boolean> {
  if (agentColFound) return true;
  try {
    await conn.execute(`SELECT AGENT_ID FROM TRX_USER_MAS WHERE 1 = 0`);
    agentColFound = true;
  } catch (e) {
    // ORA-00904(컬럼 미존재)는 ALTER 전의 정상 경로라 조용히 넘긴다.
    // ⚠️ 그 외(세션 끊김/ORA-01017 등)는 남긴다 — 결과가 "컬럼 없음" 과 구분되지 않는데
    //    실제로는 그 호출 동안 계정 결속이 통째로 풀린 것(전원 제한 없음)이라 흔적이 필요하다.
    if (!String(e).includes("ORA-00904")) {
      logger.warn("hasAgentCol: AGENT_ID 탐지 실패 — 이번 조회는 결속 없음으로 처리", { err: String(e) });
    }
  }
  return agentColFound;
}

/** SELECT 목록. 컬럼이 없으면 상수 NULL 로 대체해 호출부가 분기하지 않게 한다. */
function selectCols(hasAgent: boolean): string {
  return `${SELECT_COLS},
       ${hasAgent ? "AGENT_ID" : "CAST(NULL AS VARCHAR2(50)) AS AGENT_ID"}`;
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
       VALUES (:userId, :name, :work, :role, :hash, :salt, 'Y', 'N', SYSTIMESTAMP, SYSTIMESTAMP)`,
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
        `SELECT ${selectCols(await hasAgentCol(conn))} FROM TRX_USER_MAS ORDER BY REG_DT`,
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
        `SELECT ${selectCols(await hasAgentCol(conn))} FROM TRX_USER_MAS WHERE USER_ID = :id`,
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
  /**
   * 접근 가능 에이전트 id (null = 전 에이전트).
   * ⚠️ **키를 넣는 것 자체가 "결속을 쓰겠다" 는 의사표시**다 — 컬럼이 없으면 throw 한다.
   *    결속을 다루지 않는 호출은 키를 아예 넘기지 말 것(그래야 ALTER 전에도 생성이 된다).
   */
  agentId?: string | null;
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
    // ⚠️ 컬럼이 없으면 AGENT_ID 와 :agentId 를 통째로 뺀다 (미사용 바인드도 넘기지 않는다).
    const hasAgent = await hasAgentCol(conn);
    // 결속을 명시했는데 컬럼이 없으면 **조용히 무시하지 않고** 실패시킨다.
    if (input.agentId !== undefined && !hasAgent) throw new Error(AGENT_COL_MISSING);
    try {
      await conn.execute(
        `INSERT INTO TRX_USER_MAS
           (USER_ID, USER_NM, WORK_CTN, ROLE_CD, PWD_HASH, PWD_SALT, USE_YN, MUST_CHG_YN${hasAgent ? ", AGENT_ID" : ""}, REG_DT, UPD_DT)
         VALUES (:userId, :name, :work, :role, :hash, :salt, :useYn, 'N'${hasAgent ? ", :agentId" : ""}, SYSTIMESTAMP, SYSTIMESTAMP)`,
        {
          userId,
          name,
          work: (input.work ?? "").trim() || null,
          role: input.role,
          hash,
          salt,
          useYn: input.useYn === "N" ? "N" : "Y",
          ...(hasAgent ? { agentId: normAgentId(input.agentId) } : {}),
        },
        { autoCommit: true }
      );
    } catch (e) {
      // ORA-00001: unique constraint (사번 중복)
      if (String(e).includes("ORA-00001")) throw new Error(`이미 존재하는 사번입니다: ${userId}`);
      throw e;
    }
    const created = await conn.execute(
      `SELECT ${selectCols(hasAgent)} FROM TRX_USER_MAS WHERE USER_ID = :userId`,
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
  /**
   * 접근 가능 에이전트 id (null = 전 에이전트).
   * ⚠️ **키를 넣는 것 자체가 "결속을 바꾸겠다" 는 의사표시**다 — 컬럼이 없으면 throw 한다.
   *    결속을 바꾸지 않는 수정은 키를 아예 넘기지 말 것(그래야 ALTER 전에도 수정이 된다).
   */
  agentId?: string | null;
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
  // AGENT_ID 는 컬럼 존재 확인이 필요해 커넥션을 연 뒤에 붙인다 (아래 withConn).
  const wantAgent = input.agentId !== undefined;
  if (sets.length === 0 && !wantAgent) {
    const cur = await getUser(id);
    if (!cur) throw new Error("존재하지 않는 계정입니다.");
    return cur;
  }
  return withConn(async (conn, oracle) => {
    const hasAgent = await hasAgentCol(conn);
    // ⚠️ 컬럼이 없는데 결속을 바꾸라고 하면 실패시킨다 — 저장했다고 믿게 두지 않는다.
    //    (결속을 건드리지 않는 수정은 여기 오지 않으므로 ALTER 전에도 그대로 저장된다.)
    if (wantAgent && !hasAgent) throw new Error(AGENT_COL_MISSING);
    if (wantAgent) {
      sets.push("AGENT_ID = :agentId");
      binds.agentId = normAgentId(input.agentId);
    }
    const readBack = async (): Promise<UserAccount> => {
      const back = await conn.execute(
        `SELECT ${selectCols(hasAgent)} FROM TRX_USER_MAS WHERE USER_ID = :id`,
        { id },
        { outFormat: oracle.OBJECT }
      );
      const row = (back.rows ?? [])[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error("존재하지 않는 계정입니다.");
      return rowToAccount(row);
    };
    // 여기 오면 sets 는 반드시 하나 이상이다 (빈 입력은 위에서 조기 반환했고,
    // AGENT_ID 만 온 경우는 바로 위에서 set 을 넣거나 throw 했다).
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
 * ⚠️ TEMP(강제 변경 비활성): MUST_CHG_YN 을 'N' 으로 둔다 — 대상자는 초기화된 값 그대로
 *    로그인하고, 원할 때 직접 변경한다. 되살리려면 'Y' 로 (CLAUDE.md TEMP 절 참고).
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

/** 본인 비밀번호 변경 (현재 비밀번호 확인 후). */
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
        `SELECT ${selectCols(await hasAgentCol(conn))}, PWD_HASH, PWD_SALT FROM TRX_USER_MAS WHERE USER_ID = :id`,
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
