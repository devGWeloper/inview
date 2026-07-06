import { LAYER_ORDER, LayerKey, TraceFilter, TraceRow } from "./types";
import { logger } from "./logger";
import { AppEnv, LayerDbConfig, loadConfig } from "./config";
import { SEASONING_FAIL_PHRASE } from "./tempStatus"; // TEMP(ONEOIS 미연결): 시즈닝 성공 판정에 사용

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

export function connectedLayerCount(): number {
  return LAYER_ORDER.filter((l) => readConfig(l) !== null).length;
}

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

  const sql =
    `SELECT ${SELECT_COLUMNS} FROM BIZ_AIACTIONTXN_HIS` +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY RECV_TM DESC" +
    (filter.limit ? ` FETCH FIRST ${Math.max(1, Math.min(filter.limit, 500))} ROWS ONLY` : "");

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
  column: "FAC_ID" | "ACTION_TYP",
  value: string,
  filter: Pick<TraceFilter, "dateFrom" | "dateTo" | "limit">
): Promise<string[]> {
  const cfg = readConfig(layer);
  if (!cfg) return [];
  const oracle = await getOracle();
  if (!oracle) return [];

  const where: string[] = [`${column} = :val`];
  const binds: Record<string, unknown> = { val: value };
  if (filter.dateFrom) {
    where.push("RECV_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
    binds.dateFrom = filter.dateFrom;
  }
  if (filter.dateTo) {
    where.push("RECV_TM <= TO_TIMESTAMP(:dateTo, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
    binds.dateTo = filter.dateTo;
  }
  const limit = Math.max(1, Math.min(filter.limit ?? 200, 500));

  const sql = `
    SELECT TRACE_ID FROM (
      SELECT TRACE_ID, MAX(RECV_TM) AS LAST_RECV
        FROM BIZ_AIACTIONTXN_HIS
       WHERE ${where.join(" AND ")}
       GROUP BY TRACE_ID
       ORDER BY LAST_RECV DESC
    )
    FETCH FIRST ${limit} ROWS ONLY`;

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

// FTE 산정용: 월별 'SEA 성공' 트레이스 수.
//   성공 = 트레이스의 어떤 행에도 ERR_CD 가 없고, CUBE 응답에 'Seasoning 실패' 문구가
//   없는 트레이스 (대시보드 ok 정의와 일치). 시즈닝은 CUBE 레이어에서 판정되므로
//   CUBE DB 한 곳에서 집계한다. CUBE 미연결/드라이버 없음이면 null 반환(수동 fte 폴백).
const SEA_LAYER: LayerKey = "CUBE";

export async function monthlySeaSuccess(
  fromIso: string,
  toIso: string
): Promise<{ ym: string; count: number }[] | null> {
  const cfg = readConfig(SEA_LAYER);
  if (!cfg) return null;
  const oracle = await getOracle();
  if (!oracle) return null;

  const sql = `
    SELECT YM, COUNT(*) AS CNT FROM (
      SELECT TRACE_ID, TO_CHAR(MIN(RECV_TM), 'YYYY-MM') AS YM
        FROM BIZ_AIACTIONTXN_HIS
       WHERE RECV_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD"T"HH24:MI:SS')
         AND RECV_TM <= TO_TIMESTAMP(:dateTo,   'YYYY-MM-DD"T"HH24:MI:SS')
       GROUP BY TRACE_ID
      HAVING SUM(CASE WHEN ERR_CD IS NOT NULL THEN 1 ELSE 0 END) = 0
         AND SUM(CASE WHEN RESP_MSG_CTN LIKE :failPhrase THEN 1 ELSE 0 END) = 0
    )
    GROUP BY YM
    ORDER BY YM`;

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    conn = await oracle.getConnection(cfg);
    const result = await conn.execute(
      sql,
      { dateFrom: fromIso, dateTo: toIso, failPhrase: `%${SEASONING_FAIL_PHRASE}%` },
      { outFormat: oracle.OBJECT }
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const out = rows.map((r) => ({
      ym: String(r["YM"] ?? r["ym"] ?? ""),
      count: Number(r["CNT"] ?? r["cnt"] ?? 0),
    }));
    logger.info("monthlySeaSuccess ok", { months: out.length, ms: Date.now() - t0 });
    return out;
  } catch (e) {
    logger.error("monthlySeaSuccess failed", { ms: Date.now() - t0, err: String(e) });
    return null;
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
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
