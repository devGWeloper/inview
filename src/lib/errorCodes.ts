// 에러코드 → 의미 마스터 (5분 캐시). 없으면 빈 맵 — 화면은 코드만 보인다.

import { getAppDbConfig } from "./config";
import { logger } from "./logger";

export type ErrorCodeMap = Record<string, string>;

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

const TTL_MS = 5 * 60_000;
let cache: { at: number; map: ErrorCodeMap } | null = null;

export async function loadErrorCodeMap(): Promise<ErrorCodeMap> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;

  const cfg = getAppDbConfig();
  if (!cfg) return cache?.map ?? {};

  const oracle = await getOracle();
  if (!oracle) return cache?.map ?? {};

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  try {
    conn = await oracle.getConnection(cfg);
    const result = await conn.execute(
      `SELECT ERR_CD, ERR_MSG_CTN FROM TRX_ERRMSG_COD WHERE USE_YN = 'Y'`,
      {},
      { outFormat: oracle.OBJECT }
    );
    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    const map: ErrorCodeMap = {};
    for (const r of rows) {
      const code = (r["ERR_CD"] ?? r["err_cd"]) as string | null;
      const msg = (r["ERR_MSG_CTN"] ?? r["err_msg_ctn"]) as string | null;
      if (code && msg) map[code] = msg;
    }
    cache = { at: Date.now(), map };
    return map;
  } catch (e) {
    logger.error("loadErrorCodeMap failed", { err: String(e) });
    return cache?.map ?? {};
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}
