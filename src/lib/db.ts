import { LAYER_ORDER, LayerKey, TraceFilter, TraceRow } from "./types";
import { logger } from "./logger";
import { AppEnv, LayerDbConfig, loadConfig } from "./config";
import { ACTION_FAIL_PHRASES } from "./tempStatus"; // TEMP(ONEOIS 미연결): 액션(시즈닝/AutoQual 취소·실행) 성공 판정에 사용
import { WorkSourceRow } from "./workGroup"; // TEMP(WORK_GROUP): 묶음 산출용 행 형태

export type { AppEnv } from "./config";

export function getAppEnv(): AppEnv {
  return loadConfig().appEnv;
}

let oracledbCached: typeof import("oracledb") | null = null;

async function getOracle(): Promise<typeof import("oracledb") | null> {
  if (oracledbCached) return oracledbCached;
  try {
    const mod = await import("oracledb");
    oracledbCached = mod;
    logger.info("oracledb driver loaded");
    return mod;
  } catch (e) {
    logger.error("oracledb driver load failed", { err: String(e) });
    return null;
  }
}

function readConfig(layer: LayerKey): LayerDbConfig | null {
  return loadConfig().layers[layer] ?? null;
}

/** SQL 로 내려보내는 행수 상한을 유한한 정수로 고정 (Number("abc")=NaN 유입 방지) */
function clampLimit(v: unknown, dflt: number, max = 500): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(1, Math.min(Math.floor(n), max));
}

export function connectedLayerCount(): number {
  return LAYER_ORDER.filter((l) => readConfig(l) !== null).length;
}

/**
 * 목록(요약) 조회용 컬럼 — 요청/전달 본문(RECV_MSG_CTN / SEND_MSG_CTN)을 뺀다.
 * 목록은 트레이스 요약만 만들면 되고, 본문은 행당 수 KB 라 500건 × 레이어수 만큼
 * 끌어오면 그대로 응답 지연이 된다. RESP_MSG_CTN 은 남긴다 —
 * TEMP(ONEOIS 미연결) 상태 판정이 CUBE 응답 문구를 본다(tempStatus.ts).
 * ⚠️ 이 모드로 읽은 행의 recvMsgCtn/sendMsgCtn 은 항상 null 이다. 본문이 필요한
 * 화면(상세 타임라인)은 lean 을 켜지 않는다.
 */
const SUMMARY_COLUMNS = `
  TRACE_ID, TIMEKEY, USER_ID, SYS_ID,
  CHANNEL_ID, ACTION_TYP, FAC_ID, AREA_ID,
  RECV_SYS_ID,
  TO_CHAR(RECV_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RECV_TM,
  SEND_SYS_ID,
  TO_CHAR(SEND_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS SEND_TM,
  SEND_COMPLT_YN,
  RESP_MSG_CTN,
  TO_CHAR(RESP_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RESP_TM,
  HTTP_STS_CD,
  ERR_CD, ERR_DESC_CTN
`;

const SELECT_COLUMNS = `
  TRACE_ID, TIMEKEY, USER_ID, SYS_ID,
  CHANNEL_ID, ACTION_TYP, FAC_ID, AREA_ID,
  RECV_SYS_ID, RECV_MSG_CTN,
  TO_CHAR(RECV_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RECV_TM,
  SEND_SYS_ID, SEND_MSG_CTN,
  TO_CHAR(SEND_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS SEND_TM,
  SEND_COMPLT_YN,
  RESP_MSG_CTN,
  TO_CHAR(RESP_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RESP_TM,
  HTTP_STS_CD,
  ERR_CD, ERR_DESC_CTN
`;

function rowFrom(layer: LayerKey, r: Record<string, unknown>): TraceRow {
  const read = (k: string) => (r[k] ?? r[k.toLowerCase()] ?? null) as string | null;
  const compl = read("SEND_COMPLT_YN");
  return {
    layer,
    traceId: String(read("TRACE_ID") ?? ""),
    timekey: String(read("TIMEKEY") ?? ""),
    userId: read("USER_ID"),
    sysId: read("SYS_ID"),
    channelId: read("CHANNEL_ID"),
    actionTyp: read("ACTION_TYP"),
    facId: read("FAC_ID"),
    areaId: read("AREA_ID"),
    recvSysId: read("RECV_SYS_ID"),
    recvMsgCtn: read("RECV_MSG_CTN"),
    recvTm: read("RECV_TM"),
    sendSysId: read("SEND_SYS_ID"),
    sendMsgCtn: read("SEND_MSG_CTN"),
    sendTm: read("SEND_TM"),
    sendCompltYn: compl === "Y" || compl === "N" ? compl : null,
    respMsgCtn: read("RESP_MSG_CTN"),
    respTm: read("RESP_TM"),
    httpStsCd: read("HTTP_STS_CD"),
    errCd: read("ERR_CD"),
    errDescCtn: read("ERR_DESC_CTN")
  };
}

async function queryLayer(layer: LayerKey, filter: TraceFilter): Promise<TraceRow[]> {
  const cfg = readConfig(layer);
  if (!cfg) return [];

  const oracle = await getOracle();
  if (!oracle) return [];

  const where: string[] = [];
  const binds: Record<string, unknown> = {};

  if (filter.traceId) {
    where.push("TRACE_ID = :traceId");
    binds.traceId = filter.traceId;
  }
  if (filter.userId) {
    where.push("USER_ID = :userId");
    binds.userId = filter.userId;
  }
  // ACTION_TYP / FAC_ID 는 일부 레이어만 기록하는 컬럼이라 행 단위 WHERE 로 걸면
  // 값이 빈 다른 레이어 행이 통째로 빠져 트레이스가 깨진다. 두 필터는
  // fetchTraceIdsBy()로 TRACE_ID 를 먼저 확정한 뒤 traceIds 로 조회한다.
  if (filter.traceIds && filter.traceIds.length > 0) {
    const names = filter.traceIds.map((id, i) => {
      binds[`tid${i}`] = id;
      return `:tid${i}`;
    });
    where.push(`TRACE_ID IN (${names.join(", ")})`);
  }
  if (filter.errCd) {
    where.push("UPPER(ERR_CD) LIKE '%' || UPPER(:errCd) || '%'");
    binds.errCd = filter.errCd;
  }
  if (filter.dateFrom) {
    where.push("RECV_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
    binds.dateFrom = filter.dateFrom;
  }
  if (filter.dateTo) {
    where.push("RECV_TM <= TO_TIMESTAMP(:dateTo, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
    binds.dateTo = filter.dateTo;
  }
  if (filter.onlyError) {
    where.push("ERR_CD IS NOT NULL");
  }

  // ⚠️ 여기의 limit 은 "행" 상한이라 트레이스 단위로는 잘리는 지점이 레이어마다 다르다.
  // 목록 조회는 fetchRecentTraceIds()로 TRACE_ID 를 먼저 확정한 뒤 traceIds 로 부르는 게 원칙.
  // (RECV_TM DESC 는 Oracle 기본이 NULLS FIRST 라, 멀티콜 2번째 행처럼 RECV_TM 이 빈 행이
  //  한도를 먼저 먹는다 — NULLS LAST 로 최신 행부터 남긴다)
  const rowLimit = filter.limit === undefined ? null : clampLimit(filter.limit, 200);
  if (rowLimit !== null) binds.rowLimit = rowLimit;
  const sql =
    `SELECT ${filter.lean ? SUMMARY_COLUMNS : SELECT_COLUMNS} FROM BIZ_AIACTIONTXN_HIS` +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY RECV_TM DESC NULLS LAST" +
    (rowLimit !== null ? " FETCH FIRST :rowLimit ROWS ONLY" : "");

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    conn = await oracle.getConnection(cfg);
    const result = await conn.execute(sql, binds, { outFormat: oracle.OBJECT });
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const mapped = rows.map((r) => rowFrom(layer, r));
    logger.info("db query ok", { layer, rows: mapped.length, ms: Date.now() - t0 });
    return mapped;
  } catch (e) {
    logger.error("db query failed", { layer, ms: Date.now() - t0, err: String(e) });
    return [];
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

export async function fetchAllRows(filter: TraceFilter): Promise<TraceRow[]> {
  const arrs = await Promise.all(LAYER_ORDER.map((l) => queryLayer(l, filter)));
  return arrs.flat();
}

/**
 * 일부 레이어만 기록하는 컬럼(FAC_ID=MCP, ACTION_TYP 등) 필터의 1단계:
 * 그 컬럼을 기록하는 레이어의 DB 에서 조건에 맞는 최근 TRACE_ID 목록을 확정한다.
 * (전 레이어 최근 N행을 가져온 뒤 후처리로 거르면 해당 행이 창 밖일 때 0건이 되고,
 *  행 단위 SQL 필터로 걸면 다른 레이어 행이 빠져 트레이스가 깨지는 문제를 피한다.)
 * 2단계는 반환된 ID 들을 TraceFilter.traceIds 로 넘겨 전 레이어 행을 조회한다.
 * 드롭다운 옵션을 뽑는 DB(/api/facs=MCP, /api/action-types=GAIA)와 같은 레이어를
 * 지정해야 옵션에 보이는 값이 조회에서도 반드시 잡힌다.
 */
export async function fetchTraceIdsBy(
  layer: LayerKey,
  column: "FAC_ID" | "ACTION_TYP" | "USER_ID",
  value: string,
  filter: Pick<TraceFilter, "dateFrom" | "dateTo" | "limit">
): Promise<string[]> {
  const cfg = readConfig(layer);
  if (!cfg) return [];
  const oracle = await getOracle();
  if (!oracle) return [];

  // USER_ID 는 사용자가 검색창에 입력하는 값이라 부분 일치(대소문자 무시)로 찾는다.
  // 진입 레이어(CUBE)의 USER_ID 로만 확정하므로 하위 레이어의 시스템 계정 값에 영향받지 않고,
  // traceUserId()가 뽑는 "대표 사용자"와 같은 기준이 된다. FAC_ID/ACTION_TYP 는 옵션에서 고른
  // 정확한 값이라 기존대로 완전 일치.
  const where: string[] =
    column === "USER_ID"
      ? ["UPPER(TRIM(USER_ID)) LIKE '%' || UPPER(:val) || '%'"]
      : [`${column} = :val`];
  const binds: Record<string, unknown> = { val: value };
  if (filter.dateFrom) {
    where.push("RECV_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
    binds.dateFrom = filter.dateFrom;
  }
  if (filter.dateTo) {
    where.push("RECV_TM <= TO_TIMESTAMP(:dateTo, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
    binds.dateTo = filter.dateTo;
  }
  const limit = clampLimit(filter.limit, 200);
  binds.rowLimit = limit;

  const sql = `
    SELECT TRACE_ID FROM (
      SELECT TRACE_ID, MAX(RECV_TM) AS LAST_RECV
        FROM BIZ_AIACTIONTXN_HIS
       WHERE ${where.join(" AND ")}
       GROUP BY TRACE_ID
       ORDER BY LAST_RECV DESC NULLS LAST
    )
    FETCH FIRST :rowLimit ROWS ONLY`;

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    conn = await oracle.getConnection(cfg);
    const result = await conn.execute(sql, binds, { outFormat: oracle.OBJECT });
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const ids = rows
      .map((r) => (r["TRACE_ID"] ?? r["trace_id"]) as string | null)
      .filter((v): v is string => !!v);
    logger.info("fetchTraceIdsBy ok", { layer, column, value, ids: ids.length, ms: Date.now() - t0 });
    return ids;
  } catch (e) {
    logger.error("fetchTraceIdsBy failed", { layer, column, ms: Date.now() - t0, err: String(e) });
    return [];
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * 목록 조회 1단계: 조건에 맞는 "최근 TRACE_ID" 를 확정한다.
 *
 * ⚠️ 레이어별로 행수 상한(FETCH FIRST)을 따로 걸고 합치면 안 된다. 같은 200행이라도
 * 레이어마다 커버하는 시간대가 달라서(라우팅 실패는 MCP 까지 못 가 MCP 행이 적고,
 * GAIA 는 멀티콜로 행이 많다) 목록 아래쪽에는 "한 레이어 행만 들어온 트레이스"가 깔린다.
 * 그러면 LAYERS 점이 그 레이어 하나만 켜져 실제로는 전 레이어에 데이터가 있는데도
 * 빠진 것처럼 보인다. 그래서 자르는 단위를 행이 아니라 **트레이스**로 바꾼다.
 *
 * 각 레이어에서 조건에 맞는 최근 트레이스 목록을 뽑아 **합집합**으로 모으고(에러는 어느
 * 레이어에서 나든 그 트레이스가 대상이다) 최근순 상위 limit 건만 남긴다. 2단계에서
 * 이 ID 들의 전 레이어 행을 통째로(행 필터 없이) 읽으면 모든 행의 레이어 점이 채워진다.
 *
 * 정렬 키는 레이어별 MAX(RECV_TM). 어떤 레이어에서 RECV_TM 이 전부 비어도 다른 레이어
 * 값으로 순서가 잡히고, 전 레이어가 다 비면(사실상 없음) 순서를 못 매겨 제외된다.
 */
export async function fetchRecentTraceIds(
  filter: Pick<TraceFilter, "dateFrom" | "dateTo" | "errCd" | "onlyError" | "limit">
): Promise<string[]> {
  const limit = clampLimit(filter.limit, 200);

  const perLayer = await Promise.all(
    LAYER_ORDER.map(async (layer): Promise<Array<[string, string]>> => {
      const cfg = readConfig(layer);
      if (!cfg) return [];
      const oracle = await getOracle();
      if (!oracle) return [];

      const where: string[] = [];
      const binds: Record<string, unknown> = { rowLimit: limit };
      if (filter.errCd) {
        where.push("UPPER(ERR_CD) LIKE '%' || UPPER(:errCd) || '%'");
        binds.errCd = filter.errCd;
      }
      if (filter.onlyError) where.push("ERR_CD IS NOT NULL");
      if (filter.dateFrom) {
        where.push("RECV_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
        binds.dateFrom = filter.dateFrom;
      }
      if (filter.dateTo) {
        where.push("RECV_TM <= TO_TIMESTAMP(:dateTo, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
        binds.dateTo = filter.dateTo;
      }

      const sql = `
        SELECT TRACE_ID,
               TO_CHAR(MAX(RECV_TM), 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS LAST_RECV
          FROM BIZ_AIACTIONTXN_HIS
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         GROUP BY TRACE_ID
         ORDER BY MAX(RECV_TM) DESC NULLS LAST
         FETCH FIRST :rowLimit ROWS ONLY`;

      let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
      const t0 = Date.now();
      try {
        conn = await oracle.getConnection(cfg);
        const result = await conn.execute(sql, binds, { outFormat: oracle.OBJECT });
        const rows = (result.rows ?? []) as Record<string, unknown>[];
        const out = rows
          .map((r) => {
            const read = (k: string) => (r[k] ?? r[k.toLowerCase()] ?? null) as string | null;
            return [read("TRACE_ID"), read("LAST_RECV")] as [string | null, string | null];
          })
          .filter((p): p is [string, string] => !!p[0] && !!p[1]);
        logger.info("fetchRecentTraceIds ok", { layer, ids: out.length, ms: Date.now() - t0 });
        return out;
      } catch (e) {
        logger.error("fetchRecentTraceIds failed", { layer, ms: Date.now() - t0, err: String(e) });
        return [];
      } finally {
        if (conn) {
          try { await conn.close(); } catch { /* ignore */ }
        }
      }
    })
  );

  // 합집합 — 같은 트레이스가 여러 레이어에서 잡히면 가장 늦은 시각으로 정렬한다
  const lastByTrace = new Map<string, string>();
  for (const pairs of perLayer) {
    for (const [traceId, lastRecv] of pairs) {
      const prev = lastByTrace.get(traceId);
      if (prev === undefined || prev.localeCompare(lastRecv) < 0) lastByTrace.set(traceId, lastRecv);
    }
  }
  return Array.from(lastByTrace.entries())
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, limit)
    .map(([traceId]) => traceId);
}

/**
 * [TEMP][WORK_GROUP] 묶음 산출은 GAIA 로만 할 수 있다.
 * 챔버 값이 담긴 건 MCP 로 인계한 파라미터(SEND_MSG_CTN)뿐인데, CUBE 는 자연어만
 * 갖고 있고 MCP/ONEOIS 는 액션 구분(ACTION_TYP)을 기록하지 않는다.
 */
const WORK_GROUP_LAYER: LayerKey = "GAIA";

/**
 * 한 번에 읽는 묶음 산출용 행 상한. 최신 쪽이 남도록 RECV_TM DESC 로 자르므로,
 * 상한에 걸리면 창의 가장 오래된 묶음이 앞부분을 잃을 수 있다 (기간 경계와 같은 성격).
 */
const WORK_GROUP_MAX_ROWS = 5000;

/**
 * [TEMP][WORK_GROUP] 묶음 산출에 필요한 GAIA 행만 가볍게 읽는다.
 * 호출부가 화면 기간보다 앞뒤로 윈도우(기본 8시간)만큼 넓힌 범위를 넘겨야
 * 경계에 걸친 묶음이 갈라지지 않는다 (route.ts 참고).
 */
export async function fetchWorkGroupRows(
  fromIso: string,
  toIso: string
): Promise<WorkSourceRow[]> {
  const cfg = readConfig(WORK_GROUP_LAYER);
  if (!cfg) return [];
  const oracle = await getOracle();
  if (!oracle) return [];

  const sql = `
    SELECT TRACE_ID, ACTION_TYP,
           TO_CHAR(RECV_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RECV_TM,
           SEND_MSG_CTN
      FROM BIZ_AIACTIONTXN_HIS
     WHERE RECV_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD"T"HH24:MI:SS')
       AND RECV_TM <= TO_TIMESTAMP(:dateTo,   'YYYY-MM-DD"T"HH24:MI:SS')
     ORDER BY RECV_TM DESC
     FETCH FIRST ${WORK_GROUP_MAX_ROWS} ROWS ONLY`;

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    conn = await oracle.getConnection(cfg);
    const result = await conn.execute(
      sql,
      { dateFrom: fromIso, dateTo: toIso },
      { outFormat: oracle.OBJECT }
    );
    const rows = ((result.rows ?? []) as Record<string, unknown>[]).map((r) => {
      const read = (k: string) => (r[k] ?? r[k.toLowerCase()] ?? null) as string | null;
      return {
        traceId: String(read("TRACE_ID") ?? ""),
        actionTyp: read("ACTION_TYP"),
        recvTm: read("RECV_TM"),
        sendMsgCtn: read("SEND_MSG_CTN"),
      };
    });
    logger.info("fetchWorkGroupRows ok", { rows: rows.length, ms: Date.now() - t0 });
    return rows;
  } catch (e) {
    // 실패해도 목록은 떠야 한다 — 빈 배열이면 모든 TRACE 가 1건짜리 묶음으로 보인다(= 기존 화면).
    logger.error("fetchWorkGroupRows failed", { ms: Date.now() - t0, err: String(e) });
    return [];
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

// FTE 산정용: 월별·액션별 '액션 성공' 트레이스 수.
//   성공 = 트레이스의 어떤 행에도 ERR_CD 가 없고, CUBE 응답에 액션 실패 문구
//   (ACTION_FAIL_PHRASES: 'Seasoning 실패'/'AutoQual 취소 실패'/'AutoQual 실행 실패')가 없는 트레이스
//   (대시보드 ok 정의와 일치).
//   성공 판정·월 귀속(첫 recv)은 CUBE DB 에서, 액션 구분은 ACTION_TYP 을 기록하는
//   GAIA DB(/api/action-types 와 동일 레이어)에서 조회해 TRACE_ID 로 JS 조인한다.
//   (액션별 환산 분이 다를 수 있어 액션 단위 분해가 필요 — fte.ts 참고.)
//   GAIA 미연결/조회 실패 시 action=null 로 집계돼 기본 분으로 계산된다(무해).
//   CUBE 미연결/드라이버 없음이면 null 반환(카드는 '—' 표시).
const ACTION_SUCCESS_LAYER: LayerKey = "CUBE";
const ACTION_TYP_LAYER: LayerKey = "GAIA";

export interface MonthlyActionSuccess {
  /** "YYYY-MM" */
  ym: string;
  /** GAIA 의 ACTION_TYP 값 (예: "NEST_Seasoning"/"AutoQual_Abort"/"AutoQual_JobCreate"). 미기록/GAIA 미연결이면 null */
  action: string | null;
  count: number;
}

export async function monthlyActionSuccess(
  fromIso: string,
  toIso: string
): Promise<MonthlyActionSuccess[] | null> {
  const cfg = readConfig(ACTION_SUCCESS_LAYER);
  if (!cfg) return null;
  const oracle = await getOracle();
  if (!oracle) return null;

  const dateBinds = { dateFrom: fromIso, dateTo: toIso };
  const failConds = ACTION_FAIL_PHRASES.map(
    (_, i) => `AND SUM(CASE WHEN RESP_MSG_CTN LIKE :failPhrase${i} THEN 1 ELSE 0 END) = 0`
  );
  const failBinds = Object.fromEntries(
    ACTION_FAIL_PHRASES.map((p, i) => [`failPhrase${i}`, `%${p}%`])
  );

  // 1) CUBE: 성공 트레이스별 귀속 월 (FTE 창 전체라 트레이스당 1행 — TRACE_ID+YM 만 가져와 전송량을 줄인다)
  const successSql = `
    SELECT TRACE_ID, TO_CHAR(MIN(RECV_TM), 'YYYY-MM') AS YM
      FROM BIZ_AIACTIONTXN_HIS
     WHERE RECV_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD"T"HH24:MI:SS')
       AND RECV_TM <= TO_TIMESTAMP(:dateTo,   'YYYY-MM-DD"T"HH24:MI:SS')
     GROUP BY TRACE_ID
    HAVING SUM(CASE WHEN ERR_CD IS NOT NULL THEN 1 ELSE 0 END) = 0
       ${failConds.join("\n       ")}`;

  const t0 = Date.now();
  let successes: { traceId: string; ym: string }[];
  {
    let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
    try {
      conn = await oracle.getConnection(cfg);
      const result = await conn.execute(successSql, { ...dateBinds, ...failBinds }, { outFormat: oracle.OBJECT });
      const rows = (result.rows ?? []) as Record<string, unknown>[];
      successes = rows.map((r) => ({
        traceId: String(r["TRACE_ID"] ?? r["trace_id"] ?? ""),
        ym: String(r["YM"] ?? r["ym"] ?? ""),
      }));
    } catch (e) {
      logger.error("monthlyActionSuccess failed (CUBE)", { ms: Date.now() - t0, err: String(e) });
      return null;
    } finally {
      if (conn) {
        try { await conn.close(); } catch { /* ignore */ }
      }
    }
  }

  // 2) GAIA: TRACE_ID → ACTION_TYP (실패해도 액션 미상(null)으로 계속 진행)
  const actionByTrace = new Map<string, string>();
  const gaiaCfg = readConfig(ACTION_TYP_LAYER);
  if (gaiaCfg && successes.length > 0) {
    let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
    try {
      conn = await oracle.getConnection(gaiaCfg);
      const result = await conn.execute(
        `SELECT TRACE_ID, MAX(ACTION_TYP) AS ACTION_TYP
           FROM BIZ_AIACTIONTXN_HIS
          WHERE RECV_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD"T"HH24:MI:SS')
            AND RECV_TM <= TO_TIMESTAMP(:dateTo,   'YYYY-MM-DD"T"HH24:MI:SS')
            AND ACTION_TYP IS NOT NULL
          GROUP BY TRACE_ID`,
        dateBinds,
        { outFormat: oracle.OBJECT }
      );
      for (const r of (result.rows ?? []) as Record<string, unknown>[]) {
        const id = (r["TRACE_ID"] ?? r["trace_id"]) as string | null;
        const action = (r["ACTION_TYP"] ?? r["action_typ"]) as string | null;
        if (id && action) actionByTrace.set(id, action);
      }
    } catch (e) {
      logger.warn("monthlyActionSuccess: ACTION_TYP lookup failed — 전부 기본 분으로 계산", { err: String(e) });
    } finally {
      if (conn) {
        try { await conn.close(); } catch { /* ignore */ }
      }
    }
  }

  // 3) JS 조인: (월, 액션)별 성공 수 집계
  const acc = new Map<string, MonthlyActionSuccess>();
  for (const s of successes) {
    const action = actionByTrace.get(s.traceId) ?? null;
    const key = `${s.ym}|${action ?? ""}`;
    let m = acc.get(key);
    if (!m) {
      m = { ym: s.ym, action, count: 0 };
      acc.set(key, m);
    }
    m.count += 1;
  }
  const out = Array.from(acc.values()).sort((a, b) => a.ym.localeCompare(b.ym));
  logger.info("monthlyActionSuccess ok", {
    traces: successes.length,
    actionMatched: actionByTrace.size,
    groups: out.length,
    ms: Date.now() - t0,
  });
  return out;
}

export async function fetchByTraceId(traceId: string): Promise<TraceRow[]> {
  const rows = await fetchAllRows({ traceId });
  return rows.sort((a, b) => {
    const ai = LAYER_ORDER.indexOf(a.layer);
    const bi = LAYER_ORDER.indexOf(b.layer);
    if (ai !== bi) return ai - bi;
    return (a.recvTm ?? a.timekey).localeCompare(b.recvTm ?? b.timekey);
  });
}
