import { getAppDbConfig } from "./config";
import { logger } from "./logger";

// 에러 코드 → 의미 매핑. 앱 자체 DB(= GAIA, config.ts APP_DB_LAYER 참고)의
// TRX_ERRMSG_COD 마스터 테이블에서 로드한다. 대시보드 "주요 에러" 카드의 호버 툴팁에 노출.
export type ErrorCodeMap = Record<string, string>;

// oracledb 는 next.config 의 serverComponentsExternalPackages 로 빠져 있어 lazy import.
// 네이티브 드라이버가 없으면 에러를 삼키고 null → 빈 맵 반환(앱은 정상 동작).
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

// 마스터 데이터라 자주 안 바뀌므로 짧게 캐시. 실패 시 직전 캐시로 폴백.
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
