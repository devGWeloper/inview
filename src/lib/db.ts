import { LAYER_ORDER, LayerKey, TraceFilter, TraceRow } from "./types";
import { mockAllRows, mockRowsForLayer } from "./mock";

type DbConfig = {
  user: string;
  password: string;
  connectString: string;
};

let oracledbCached: typeof import("oracledb") | null = null;

async function getOracle(): Promise<typeof import("oracledb") | null> {
  if (oracledbCached) return oracledbCached;
  try {
    const mod = await import("oracledb");
    mod.outFormat = mod.OBJECT;
    oracledbCached = mod;
    return mod;
  } catch {
    return null;
  }
}

function readConfig(layer: LayerKey): DbConfig | null {
  const user = process.env[`${layer}_DB_USER`];
  const password = process.env[`${layer}_DB_PASSWORD`];
  const connectString = process.env[`${layer}_DB_CONNECT_STRING`];
  if (!user || !password || !connectString) return null;
  return { user, password, connectString };
}

export function isMockMode(): boolean {
  if (process.env.USE_MOCK === "true") return true;
  return LAYER_ORDER.every((l) => readConfig(l) === null);
}

export function connectedLayerCount(): number {
  return LAYER_ORDER.filter((l) => readConfig(l) !== null).length;
}

const SELECT_COLUMNS = `
  TRACE_ID, TIMEKEY, USER_ID, SYS_ID,
  RECV_SYS_ID, RECV_MSG_CTN,
  TO_CHAR(RECV_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RECV_TM,
  SEND_SYS_ID, SEND_MSG_CTN,
  TO_CHAR(SEND_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS SEND_TM,
  SEND_COMPLT_YN,
  RESP_MSG_CTN,
  TO_CHAR(RESP_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RESP_TM,
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
    recvSysId: read("RECV_SYS_ID"),
    recvMsgCtn: read("RECV_MSG_CTN"),
    recvTm: read("RECV_TM"),
    sendSysId: read("SEND_SYS_ID"),
    sendMsgCtn: read("SEND_MSG_CTN"),
    sendTm: read("SEND_TM"),
    sendCompltYn: compl === "Y" || compl === "N" ? compl : null,
    respMsgCtn: read("RESP_MSG_CTN"),
    respTm: read("RESP_TM"),
    errCd: read("ERR_CD"),
    errDescCtn: read("ERR_DESC_CTN")
  };
}

async function queryLayer(layer: LayerKey, filter: TraceFilter): Promise<TraceRow[]> {
  if (isMockMode()) return filterRows(mockRowsForLayer(layer), filter);

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
  try {
    conn = await oracle.getConnection(cfg);
    const result = await conn.execute(sql, binds, { outFormat: oracle.OBJECT });
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return rows.map((r) => rowFrom(layer, r));
  } catch (e) {
    console.error(`[db] layer=${layer} error`, e);
    return [];
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

function filterRows(rows: TraceRow[], f: TraceFilter): TraceRow[] {
  return rows.filter((r) => {
    if (f.traceId && r.traceId !== f.traceId) return false;
    if (f.userId && r.userId !== f.userId) return false;
    if (f.onlyError && !r.errCd) return false;
    if (f.dateFrom && r.recvTm && r.recvTm < f.dateFrom) return false;
    if (f.dateTo && r.recvTm && r.recvTm > f.dateTo) return false;
    return true;
  });
}

export async function fetchAllRows(filter: TraceFilter): Promise<TraceRow[]> {
  if (isMockMode()) return filterRows(mockAllRows(), filter);
  const arrs = await Promise.all(LAYER_ORDER.map((l) => queryLayer(l, filter)));
  return arrs.flat();
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
