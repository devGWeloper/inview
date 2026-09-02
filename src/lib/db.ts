// BIZ_AIACTIONTXN_HIS 조회 — 레이어별 DB 를 병렬로 읽는다.
// 목록은 2단계(트레이스 ID 확정 → 행 통째로)여야 한다. docs/architecture/data-flow.md

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

function clampLimit(v: unknown, dflt: number, max = 500): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(1, Math.min(Math.floor(n), max));
}

export function connectedLayerCount(): number {
  return LAYER_ORDER.filter((l) => readConfig(l) !== null).length;
}

/**
 * 목록(요약)용 컬럼 — 본문(RECV/SEND_MSG_CTN)을 뺀다(행당 수 KB).
 * RESP_MSG_CTN 은 남긴다 — TEMP(ONEOIS) 상태 판정이 CUBE 응답 문구를 본다.
 * ⚠️ lean 행의 recvMsgCtn/sendMsgCtn 은 항상 null 이다 — 상세는 lean 을 켜지 않는다.
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
 * [TEMP][WORK_GROUP] 묶음 산출은 GAIA 로만 할 수 있다 — 챔버 값은 SEND_MSG_CTN 에만 있고
 * CUBE 는 자연어뿐, MCP/ONEOIS 는 ACTION_TYP 을 기록하지 않는다.
 */
const WORK_GROUP_LAYER: LayerKey = "GAIA";

const WORK_GROUP_MAX_ROWS = 5000;

/**
 * [TEMP][WORK_GROUP] 묶음 산출용 GAIA 행만 가볍게 읽는다.
 * 호출부는 화면 기간을 앞뒤로 윈도우만큼 넓혀 넘겨야 경계에 걸친 묶음이 안 갈라진다.
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
    logger.error("fetchWorkGroupRows failed", { ms: Date.now() - t0, err: String(e) });
    return [];
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

const ACTION_SUCCESS_LAYER: LayerKey = "CUBE";
const ACTION_TYP_LAYER: LayerKey = "GAIA";

export interface MonthlyActionSuccess {
  ym: string;
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
