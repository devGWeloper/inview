// TRX_TOKEN_DET 의 실패 호출 집계 (Timeout 탭). docs/screens/timeouts.md

import { getAgentDbConfig } from "./config";
import { logger } from "./logger";
import { SQL_ERR_PRED, SQL_TIMEOUT_PRED } from "./tokenStatus";
import {
  TimeoutBucket,
  TimeoutDimStat,
  TimeoutItem,
  TimeoutModelCell,
  TimeoutModelSeries,
  TimeoutReason,
  TimeoutStatsResponse,
} from "./types";
import {
  Granularity,
  enumerateBucketStarts,
  floorToBucket,
  isoNoTz,
  parseTs,
  pickGranularity,
} from "./timeBuckets";

const ITEM_LIMIT = 200; // 목록에 내릴 최근 실패 호출 수
const DIM_LIMIT = 10;   // 노드/모델/사용자 분포 상위 N
const MODEL_TREND_LIMIT = 8; // 히트맵에 노출할 모델 수 (호출 많은 순)
const REASON_LIMIT = 8; // 오류 사유 top N
const REASON_KEYLEN = 100; // ERR_CTN 앞 N자를 클러스터 키로

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

export interface TimeoutFilter {
  dateFrom?: string;
  dateTo?: string;
  nodeNm?: string;
  modelNm?: string;
  agentId?: string;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (v == null ? null : String(v));

function bucketExpr(g: Granularity): string {
  if (g === "1d") return `TRUNC(CALL_TM)`;
  if (g === "1h") return `TRUNC(CALL_TM, 'HH24')`;
  return `TRUNC(CALL_TM, 'HH24') + FLOOR(TO_NUMBER(TO_CHAR(CALL_TM, 'MI')) / 5) * 5 / 1440`;
}

function buildWhere(filter: TimeoutFilter): { where: string; binds: Record<string, unknown> } {
  const where: string[] = [];
  const binds: Record<string, unknown> = {};
  if (filter.dateFrom) {
    where.push(`CALL_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD"T"HH24:MI:SS')`);
    binds.dateFrom = filter.dateFrom;
  }
  if (filter.dateTo) {
    where.push(`CALL_TM <= TO_TIMESTAMP(:dateTo, 'YYYY-MM-DD"T"HH24:MI:SS')`);
    binds.dateTo = filter.dateTo;
  }
  if (filter.nodeNm) {
    where.push(`NODE_NM = :nodeNm`);
    binds.nodeNm = filter.nodeNm;
  }
  if (filter.modelNm) {
    where.push(`MODEL_NM = :modelNm`);
    binds.modelNm = filter.modelNm;
  }
  return { where: where.length ? " WHERE " + where.join(" AND ") : "", binds };
}

function emptyStats(
  filter: TimeoutFilter,
  g: Granularity,
  buckets: TimeoutBucket[],
  available: boolean
): TimeoutStatsResponse {
  return {
    range: { from: filter.dateFrom ?? null, to: filter.dateTo ?? null },
    granularity: g,
    available,
    totalCalls: 0,
    failedCalls: 0,
    timeoutCalls: 0,
    affectedUsers: 0,
    affectedTraces: 0,
    lastAt: null,
    buckets,
    byNode: [],
    byModel: [],
    byUser: [],
    items: [],
    modelTrend: [],
    topReasons: [],
  };
}

export async function fetchTimeoutStats(filter: TimeoutFilter): Promise<TimeoutStatsResponse> {
  const t0 = Date.now();
  const now = Date.now();
  const fromMs = filter.dateFrom ? Date.parse(filter.dateFrom) : now - 24 * 3_600_000;
  const toMs = filter.dateTo ? Date.parse(filter.dateTo) : now;
  const g: Granularity = pickGranularity(fromMs, toMs);
  const emptyBuckets: TimeoutBucket[] = enumerateBucketStarts(fromMs, toMs, g).map((k) => ({
    ts: isoNoTz(k),
    failed: 0,
    timeout: 0,
  }));

  const cfg = getAgentDbConfig(filter.agentId);
  if (!cfg) return emptyStats(filter, g, emptyBuckets, false);
  const oracle = await getOracle();
  if (!oracle) return emptyStats(filter, g, emptyBuckets, false);

  const { where, binds } = buildWhere(filter);
  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  try {
    conn = await oracle.getConnection(cfg);
    const opts = { outFormat: oracle.OBJECT } as const;

    try {
      await conn.execute("SELECT STAT_CD, ERR_CTN FROM TRX_TOKEN_DET WHERE 1 = 0", {}, opts);
    } catch (e) {
      logger.warn("fetchTimeoutStats: STAT_CD/ERR_CTN 미존재 — 적재 전", { err: String(e) });
      return emptyStats(filter, g, emptyBuckets, false);
    }

    const rowsOf = (r: { rows?: unknown }) => (r.rows ?? []) as Array<Record<string, unknown>>;
    const run = async (name: string, sql: string): Promise<Array<Record<string, unknown>>> => {
      try {
        return rowsOf(await conn!.execute(sql, binds, opts));
      } catch (e) {
        logger.error(`fetchTimeoutStats [${name}] query failed`, { err: String(e), sql });
        return [];
      }
    };

    const FAILED = `SUM(CASE WHEN ${SQL_ERR_PRED} THEN 1 ELSE 0 END)`;
    const TIMEOUT = `SUM(CASE WHEN ${SQL_ERR_PRED} AND ${SQL_TIMEOUT_PRED} THEN 1 ELSE 0 END)`;

    const totalSql =
      `SELECT COUNT(*) AS N, ${FAILED} AS F, ${TIMEOUT} AS T,` +
      ` COUNT(DISTINCT CASE WHEN ${SQL_ERR_PRED} THEN USER_ID END) AS U,` +
      ` COUNT(DISTINCT CASE WHEN ${SQL_ERR_PRED} THEN TRACE_ID END) AS Q,` +
      ` TO_CHAR(MAX(CASE WHEN ${SQL_ERR_PRED} THEN CALL_TM END), 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_TM` +
      ` FROM TRX_TOKEN_DET${where}`;
    const totalRow = (await run("totals", totalSql))[0] ?? {};

    const bucketSql =
      `SELECT TO_CHAR(${bucketExpr(g)}, 'YYYY-MM-DD"T"HH24:MI:SS') AS BKT,` +
      ` ${FAILED} AS F, ${TIMEOUT} AS T` +
      ` FROM TRX_TOKEN_DET${where} GROUP BY ${bucketExpr(g)} ORDER BY 1`;
    const bucketMap = new Map<number, TimeoutBucket>();
    for (const r of await run("buckets", bucketSql)) {
      const ms = parseTs(str(r.BKT ?? r.bkt));
      if (ms === null) continue;
      const key = floorToBucket(ms, g);
      bucketMap.set(key, {
        ts: isoNoTz(key),
        failed: num(r.F ?? r.f),
        timeout: num(r.T ?? r.t),
      });
    }
    const buckets = enumerateBucketStarts(fromMs, toMs, g).map(
      (k) => bucketMap.get(k) ?? { ts: isoNoTz(k), failed: 0, timeout: 0 }
    );

    const dimSql = (col: string) =>
      `SELECT NVL(${col}, '(없음)') AS K, COUNT(*) AS N, ${FAILED} AS F, ${TIMEOUT} AS T` +
      ` FROM TRX_TOKEN_DET${where} GROUP BY NVL(${col}, '(없음)')` +
      ` HAVING ${FAILED} > 0 ORDER BY F DESC`;
    const dimFrom = (rows: Array<Record<string, unknown>>): TimeoutDimStat[] =>
      rows.slice(0, DIM_LIMIT).map((r) => ({
        key: String(r.K ?? r.k ?? "(없음)"),
        calls: num(r.N ?? r.n),
        failed: num(r.F ?? r.f),
        timeout: num(r.T ?? r.t),
      }));
    const byNode = dimFrom(await run("byNode", dimSql("NODE_NM")));
    const byModel = dimFrom(await run("byModel", dimSql("MODEL_NM")));
    const byUser = dimFrom(await run("byUser", dimSql("USER_ID")));

    const modelTrendSql =
      `SELECT NVL(MODEL_NM, '(없음)') AS M,` +
      ` TO_CHAR(${bucketExpr(g)}, 'YYYY-MM-DD"T"HH24:MI:SS') AS BKT,` +
      ` COUNT(*) AS N, ${FAILED} AS F, ${TIMEOUT} AS T` +
      ` FROM TRX_TOKEN_DET${where}` +
      ` GROUP BY NVL(MODEL_NM, '(없음)'), ${bucketExpr(g)}`;
    const modelAgg = new Map<
      string,
      { totalCalls: number; totalFailed: number; totalTimeout: number; cells: Map<number, TimeoutModelCell> }
    >();
    for (const r of await run("modelTrend", modelTrendSql)) {
      const m = String(r.M ?? r.m ?? "(없음)");
      const ms = parseTs(str(r.BKT ?? r.bkt));
      if (ms === null) continue;
      const key = floorToBucket(ms, g);
      const calls = num(r.N ?? r.n);
      const failed = num(r.F ?? r.f);
      const timeout = num(r.T ?? r.t);
      let entry = modelAgg.get(m);
      if (!entry) {
        entry = { totalCalls: 0, totalFailed: 0, totalTimeout: 0, cells: new Map() };
        modelAgg.set(m, entry);
      }
      entry.totalCalls += calls;
      entry.totalFailed += failed;
      entry.totalTimeout += timeout;
      entry.cells.set(key, { ts: isoNoTz(key), calls, failed, timeout });
    }
    const bucketKeys = enumerateBucketStarts(fromMs, toMs, g);
    const modelTrend: TimeoutModelSeries[] = [...modelAgg.entries()]
      .sort((a, b) => b[1].totalCalls - a[1].totalCalls)
      .slice(0, MODEL_TREND_LIMIT)
      .map(([model, v]) => ({
        model,
        totalCalls: v.totalCalls,
        totalFailed: v.totalFailed,
        totalTimeout: v.totalTimeout,
        cells: bucketKeys.map(
          (k) => v.cells.get(k) ?? { ts: isoNoTz(k), calls: 0, failed: 0, timeout: 0 }
        ),
      }));

    const reasonSql =
      `SELECT SUBSTR(TRIM(ERR_CTN), 1, ${REASON_KEYLEN}) AS R,` +
      ` COUNT(*) AS N,` +
      ` SUM(CASE WHEN ${SQL_TIMEOUT_PRED} THEN 1 ELSE 0 END) AS T,` +
      ` TO_CHAR(MAX(CALL_TM), 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_TM` +
      ` FROM TRX_TOKEN_DET${where}${where ? " AND" : " WHERE"} ${SQL_ERR_PRED}` +
      ` AND ERR_CTN IS NOT NULL` +
      ` GROUP BY SUBSTR(TRIM(ERR_CTN), 1, ${REASON_KEYLEN})` +
      ` ORDER BY N DESC FETCH FIRST ${REASON_LIMIT} ROWS ONLY`;
    const topReasons: TimeoutReason[] = (await run("topReasons", reasonSql)).map((r) => ({
      reason: String(r.R ?? r.r ?? "").trim() || "(사유 미기록)",
      failed: num(r.N ?? r.n),
      timeout: num(r.T ?? r.t),
      lastAt: str(r.LAST_TM ?? r.last_tm),
    }));

    const itemSql =
      `SELECT TOKEN_ID, TRACE_ID, NODE_NM, MODEL_NM, USER_ID, QUERY_CTN, LATENCY_MS, STAT_CD, ERR_CTN,` +
      ` TO_CHAR(CALL_TM, 'YYYY-MM-DD"T"HH24:MI:SS') AS CALL_TM` +
      ` FROM TRX_TOKEN_DET${where}${where ? " AND" : " WHERE"} ${SQL_ERR_PRED}` +
      ` ORDER BY CALL_TM DESC FETCH FIRST ${ITEM_LIMIT} ROWS ONLY`;
    const items: TimeoutItem[] = (await run("items", itemSql)).map((r) => {
      const lat = r.LATENCY_MS ?? r.latency_ms;
      return {
        tokenId: String(r.TOKEN_ID ?? r.token_id ?? ""),
        callTm: str(r.CALL_TM ?? r.call_tm),
        traceId: str(r.TRACE_ID ?? r.trace_id),
        nodeNm: str(r.NODE_NM ?? r.node_nm),
        modelNm: str(r.MODEL_NM ?? r.model_nm),
        userId: str(r.USER_ID ?? r.user_id),
        queryCtn: str(r.QUERY_CTN ?? r.query_ctn),
        latencyMs: lat == null ? null : num(lat),
        statCd: str(r.STAT_CD ?? r.stat_cd),
        errCtn: str(r.ERR_CTN ?? r.err_ctn),
      };
    });

    const res: TimeoutStatsResponse = {
      range: { from: filter.dateFrom ?? null, to: filter.dateTo ?? null },
      granularity: g,
      available: true,
      totalCalls: num(totalRow.N ?? totalRow.n),
      failedCalls: num(totalRow.F ?? totalRow.f),
      timeoutCalls: num(totalRow.T ?? totalRow.t),
      affectedUsers: num(totalRow.U ?? totalRow.u),
      affectedTraces: num(totalRow.Q ?? totalRow.q),
      lastAt: str(totalRow.LAST_TM ?? totalRow.last_tm),
      buckets,
      byNode,
      byModel,
      byUser,
      items,
      modelTrend,
      topReasons,
    };

    logger.info("fetchTimeoutStats ok", {
      calls: res.totalCalls,
      failed: res.failedCalls,
      timeout: res.timeoutCalls,
      ms: Date.now() - t0,
    });
    return res;
  } catch (e) {
    logger.error("fetchTimeoutStats failed", { err: String(e), ms: Date.now() - t0 });
    return emptyStats(filter, g, emptyBuckets, false);
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
      }
    }
  }
}
