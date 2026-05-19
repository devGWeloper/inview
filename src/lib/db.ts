import net from "node:net";
import dns from "node:dns/promises";
import { LAYER_ORDER, LayerKey, TraceFilter, TraceRow } from "./types";
import { logger } from "./logger";
import { AppEnv, LayerDbConfig, loadConfig } from "./config";

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
    logger.info("oracledb driver loaded", {
      versionString: (mod as { versionString?: string }).versionString ?? null,
      thinMode: (mod as { thin?: boolean }).thin ?? null,
      TNS_ADMIN: process.env.TNS_ADMIN ?? null,
      NODE_ORACLEDB_DRIVER_MODE: process.env.NODE_ORACLEDB_DRIVER_MODE ?? null,
      PACKET_DUMPS: process.env.NODE_ORACLEDB_DEBUG_PACKET_DUMPS ?? null,
      cwd: process.cwd(),
    });
    return mod;
  } catch (e) {
    logger.error("oracledb driver load failed", { err: String(e) });
    return null;
  }
}

function parseHostPort(cs: string): { host: string | null; port: number } {
  const tnsHost = cs.match(/HOST\s*=\s*([^)\s]+)/i);
  const tnsPort = cs.match(/PORT\s*=\s*(\d+)/i);
  if (tnsHost) {
    return { host: tnsHost[1], port: tnsPort ? Number(tnsPort[1]) : 1521 };
  }
  const ez = cs.replace(/^\/\//, "").match(/^([^:/\s]+)(?::(\d+))?/);
  if (ez) {
    return { host: ez[1], port: ez[2] ? Number(ez[2]) : 1521 };
  }
  return { host: null, port: 1521 };
}

const diagnosedLayers = new Set<LayerKey>();

async function diagnoseLayer(layer: LayerKey, cfg: LayerDbConfig): Promise<void> {
  if (diagnosedLayers.has(layer)) return;
  diagnosedLayers.add(layer);

  const cs = cfg.connectString;
  const { host, port } = parseHostPort(cs);
  logger.info("oracle diag config", {
    layer,
    user: cfg.user,
    connectString: cs,
    csLen: cs.length,
    csHex: Buffer.from(cs, "utf8").toString("hex"),
    parsedHost: host,
    parsedPort: port,
  });
  if (!host) return;

  try {
    const addrs = await dns.lookup(host, { all: true });
    logger.info("oracle diag dns", { layer, host, addrs });
  } catch (e) {
    logger.warn("oracle diag dns failed", {
      layer,
      host,
      err: String(e),
      code: (e as NodeJS.ErrnoException).code,
    });
  }

  await new Promise<void>((resolve) => {
    const t0 = Date.now();
    const s = net.connect({ host, port });
    s.setTimeout(5000);
    s.once("connect", () => {
      logger.info("oracle diag tcp ok", {
        layer,
        target: `${host}:${port}`,
        peerAddress: s.remoteAddress,
        peerPort: s.remotePort,
        localAddress: s.localAddress,
        localPort: s.localPort,
        ms: Date.now() - t0,
      });
      s.end();
      resolve();
    });
    s.once("timeout", () => {
      logger.warn("oracle diag tcp timeout", {
        layer,
        target: `${host}:${port}`,
        ms: Date.now() - t0,
      });
      s.destroy();
      resolve();
    });
    s.once("error", (e) => {
      logger.warn("oracle diag tcp error", {
        layer,
        target: `${host}:${port}`,
        err: String(e),
        code: (e as NodeJS.ErrnoException).code,
        ms: Date.now() - t0,
      });
      resolve();
    });
  });
}

function readConfig(layer: LayerKey): LayerDbConfig | null {
  return loadConfig().layers[layer] ?? null;
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

  await diagnoseLayer(layer, cfg);

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    const tConn = Date.now();
    conn = await oracle.getConnection(cfg);
    logger.info("db connect ok", { layer, ms: Date.now() - tConn });
    const result = await conn.execute(sql, binds, { outFormat: oracle.OBJECT });
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const mapped = rows.map((r) => rowFrom(layer, r));
    logger.info("db query ok", { layer, rows: mapped.length, ms: Date.now() - t0 });
    return mapped;
  } catch (e) {
    const err = e as { message?: string; errorNum?: number; offset?: number; code?: string };
    logger.error("db query failed", {
      layer,
      ms: Date.now() - t0,
      stage: conn ? "execute" : "connect",
      err: String(e),
      message: err.message ?? null,
      errorNum: err.errorNum ?? null,
      offset: err.offset ?? null,
      code: err.code ?? null,
    });
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

export async function fetchByTraceId(traceId: string): Promise<TraceRow[]> {
  const rows = await fetchAllRows({ traceId });
  return rows.sort((a, b) => {
    const ai = LAYER_ORDER.indexOf(a.layer);
    const bi = LAYER_ORDER.indexOf(b.layer);
    if (ai !== bi) return ai - bi;
    return (a.recvTm ?? a.timekey).localeCompare(b.recvTm ?? b.timekey);
  });
}
