// TRX_TOKEN_DET 집계 (Tokens 탭). 커넥션은 agentId 로 고른다. docs/screens/tokens.md

import { getAgentDbConfig } from "./config";
import { logger } from "./logger";
import {
  TokenBucket,
  TokenDimStat,
  TokenFilter,
  TokenQuestion,
  TokenRow,
  TokenStatsResponse,
  TopItem,
} from "./types";
import {
  Granularity,
  enumerateBucketStarts,
  floorToBucket,
  isoNoTz,
  parseTs,
  pickGranularity,
} from "./timeBuckets";
import { SQL_ERR_PRED, SQL_OK_PRED } from "./tokenStatus";

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

const QUESTION_LIMIT = 500; // "질문별 토큰" 표에 로드할 질문 수 (마지막 호출 시각 desc — 최신 질문 우선)
const CALL_LIMIT = 200;     // 단일 질문(traceId) 펼침 시 호출 행 수
const TOP_USER_LIMIT = 8;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (v == null ? null : String(v));
const dedupeCsv = (csv: string | null): string[] => {
  if (!csv) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of csv.split(",")) {
    const v = part.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
};

function bucketExpr(g: Granularity): string {
  if (g === "1d") return `TRUNC(CALL_TM)`;
  if (g === "1h") return `TRUNC(CALL_TM, 'HH24')`;
  return `TRUNC(CALL_TM, 'HH24') + FLOOR(TO_NUMBER(TO_CHAR(CALL_TM, 'MI')) / 5) * 5 / 1440`;
}

export function buildWhere(filter: TokenFilter): { where: string; binds: Record<string, unknown> } {
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
  if (filter.userId) {
    where.push(`USER_ID = :userId`);
    binds.userId = filter.userId;
  }
  if (filter.nodeNm) {
    where.push(`NODE_NM = :nodeNm`);
    binds.nodeNm = filter.nodeNm;
  }
  if (filter.modelNm) {
    where.push(`MODEL_NM = :modelNm`);
    binds.modelNm = filter.modelNm;
  }
  if (filter.traceId) {
    where.push(`TRACE_ID = :traceId`);
    binds.traceId = filter.traceId;
  }
  return { where: where.length ? " WHERE " + where.join(" AND ") : "", binds };
}

function emptyBucket(ts: string): TokenBucket {
  return { ts, inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0, avgLatencyMs: null };
}

function emptyStats(filter: TokenFilter, g: Granularity, buckets: TokenBucket[]): TokenStatsResponse {
  return {
    range: { from: filter.dateFrom ?? null, to: filter.dateTo ?? null },
    totals: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    avgTotalPerCall: null,
    avgLatencyMs: null,
    granularity: g,
    buckets,
    byNode: [],
    byModel: [],
    topUsers: [],
    questions: [],
    calls: [],
  };
}

export async function fetchTokenStats(filter: TokenFilter): Promise<TokenStatsResponse> {
  const now = Date.now();
  const fromMs = filter.dateFrom ? Date.parse(filter.dateFrom) : now - 24 * 3_600_000;
  const toMs = filter.dateTo ? Date.parse(filter.dateTo) : now;
  const g = pickGranularity(fromMs, toMs);
  const emptyBuckets: TokenBucket[] = enumerateBucketStarts(fromMs, toMs, g).map((k) =>
    emptyBucket(isoNoTz(k))
  );

  const cfg = getAgentDbConfig(filter.agentId);
  if (!cfg) return emptyStats(filter, g, emptyBuckets);
  const oracle = await getOracle();
  if (!oracle) return emptyStats(filter, g, emptyBuckets);

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    conn = await oracle.getConnection(cfg);
    const opts = { outFormat: oracle.OBJECT } as const;
    const rowsOf = (r: { rows?: unknown }) => (r.rows ?? []) as Array<Record<string, unknown>>;

    let hasStatus = true;
    try {
      await conn.execute("SELECT STAT_CD, ERR_CTN FROM TRX_TOKEN_DET WHERE 1 = 0", {}, opts);
    } catch (e) {
      hasStatus = false;
      logger.warn("fetchTokenStats: STAT_CD/ERR_CTN 미존재 — 실패 호출 집계 생략", { err: String(e) });
    }

    const { where, binds } = buildWhere(filter);

    const run = async (
      name: string,
      sql: string,
      b: Record<string, unknown> = binds
    ): Promise<Array<Record<string, unknown>>> => {
      try {
        return rowsOf(await conn!.execute(sql, b, opts));
      } catch (e) {
        logger.error(`fetchTokenStats [${name}] query failed`, { err: String(e), sql });
        return [];
      }
    };

    const latExpr = hasStatus ? `CASE WHEN ${SQL_OK_PRED} THEN LATENCY_MS END` : "LATENCY_MS";
    const statCols = hasStatus ? ", STAT_CD, ERR_CTN" : "";
    const errNodeExpr = hasStatus
      ? `LISTAGG(CASE WHEN ${SQL_ERR_PRED} THEN NODE_NM END, ',' ON OVERFLOW TRUNCATE) WITHIN GROUP (ORDER BY CALL_TM)`
      : "NULL";

    const bucketSql =
      `SELECT TO_CHAR(${bucketExpr(g)}, 'YYYY-MM-DD"T"HH24:MI:SS') AS BKT,` +
      ` SUM(INPUT_TOKENS) AS P, SUM(OUTPUT_TOKENS) AS C, SUM(TOTAL_TOKENS) AS T, COUNT(*) AS N,` +
      ` SUM(${latExpr}) AS LSUM, COUNT(${latExpr}) AS LCNT` +
      ` FROM TRX_TOKEN_DET${where} GROUP BY ${bucketExpr(g)} ORDER BY 1`;
    const bucketMap = new Map<number, TokenBucket>();
    let latSum = 0;
    let latCnt = 0;
    for (const r of await run("buckets", bucketSql)) {
      const ms = parseTs(str(r.BKT ?? r.bkt));
      if (ms === null) continue;
      const key = floorToBucket(ms, g);
      const lsum = num(r.LSUM ?? r.lsum);
      const lcnt = num(r.LCNT ?? r.lcnt);
      latSum += lsum;
      latCnt += lcnt;
      bucketMap.set(key, {
        ts: isoNoTz(key),
        inputTokens: num(r.P ?? r.p),
        outputTokens: num(r.C ?? r.c),
        totalTokens: num(r.T ?? r.t),
        calls: num(r.N ?? r.n),
        avgLatencyMs: lcnt > 0 ? lsum / lcnt : null,
      });
    }
    const buckets = enumerateBucketStarts(fromMs, toMs, g).map(
      (k) => bucketMap.get(k) ?? emptyBucket(isoNoTz(k))
    );
    const totals = buckets.reduce(
      (acc, b) => {
        acc.calls += b.calls;
        acc.inputTokens += b.inputTokens;
        acc.outputTokens += b.outputTokens;
        acc.totalTokens += b.totalTokens;
        return acc;
      },
      { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    );

    const dimSql = (col: string) =>
      `SELECT NVL(${col}, '(none)') AS K, COUNT(*) AS N,` +
      ` SUM(INPUT_TOKENS) AS P, SUM(OUTPUT_TOKENS) AS C, SUM(TOTAL_TOKENS) AS T,` +
      ` AVG(${latExpr}) AS L` +
      ` FROM TRX_TOKEN_DET${where} GROUP BY NVL(${col}, '(none)') ORDER BY T DESC`;
    const dimFrom = (rows: Array<Record<string, unknown>>): TokenDimStat[] =>
      rows.map((r) => {
        const l = r.L ?? r.l;
        return {
          key: String(r.K ?? r.k ?? "(none)"),
          calls: num(r.N ?? r.n),
          inputTokens: num(r.P ?? r.p),
          outputTokens: num(r.C ?? r.c),
          totalTokens: num(r.T ?? r.t),
          avgLatencyMs: l == null ? null : num(l),
          sub: [],
        };
      });
    const byNode = dimFrom(await run("byNode", dimSql("NODE_NM")));
    const byModel = dimFrom(await run("byModel", dimSql("MODEL_NM")));

    const crossSql =
      `SELECT NVL(NODE_NM, '(none)') AS NK, NVL(MODEL_NM, '(none)') AS MK,` +
      ` COUNT(*) AS N, SUM(TOTAL_TOKENS) AS T` +
      ` FROM TRX_TOKEN_DET${where}` +
      ` GROUP BY NVL(NODE_NM, '(none)'), NVL(MODEL_NM, '(none)') ORDER BY T DESC`;
    const nodeIdx = new Map(byNode.map((d) => [d.key, d]));
    const modelIdx = new Map(byModel.map((d) => [d.key, d]));
    for (const r of await run("nodeModelCross", crossSql)) {
      const nk = String(r.NK ?? r.nk ?? "(none)");
      const mk = String(r.MK ?? r.mk ?? "(none)");
      const calls = num(r.N ?? r.n);
      const totalTokens = num(r.T ?? r.t);
      nodeIdx.get(nk)?.sub.push({ key: mk, calls, totalTokens });
      modelIdx.get(mk)?.sub.push({ key: nk, calls, totalTokens });
    }

    const skipQ = filter.skipQuestions === true;
    const userSql =
      `SELECT USER_ID AS K, SUM(TOTAL_TOKENS) AS T FROM TRX_TOKEN_DET${where}` +
      `${where ? " AND" : " WHERE"} USER_ID IS NOT NULL` +
      ` GROUP BY USER_ID ORDER BY T DESC FETCH FIRST ${TOP_USER_LIMIT} ROWS ONLY`;
    const topUsers: TopItem[] = skipQ
      ? []
      : (await run("topUsers", userSql)).map((r) => ({
          key: String(r.K ?? r.k ?? ""),
          count: num(r.T ?? r.t),
        }));

    const grpWhere = (nullCond: string) => `${where}${where ? " AND" : " WHERE"} ${nullCond}`;
    const agg = (col: string) =>
      `LISTAGG(${col}, ',' ON OVERFLOW TRUNCATE) WITHIN GROUP (ORDER BY CALL_TM)`;
    const questionsSql =
      `SELECT QKEY, TRACE_ID, NODES, MODELS, ERRNODES, QCTN, USR, CALLS, P, C, T, LAST_TM FROM (` +
        `SELECT TRACE_ID AS QKEY, TRACE_ID,` +
        ` ${agg("NODE_NM")} AS NODES, ${agg("MODEL_NM")} AS MODELS, ${errNodeExpr} AS ERRNODES,` +
        ` MIN(QUERY_CTN) KEEP (DENSE_RANK FIRST ORDER BY NVL2(QUERY_CTN, 0, 1), CALL_TM) AS QCTN,` +
        ` MAX(USER_ID) AS USR, COUNT(*) AS CALLS,` +
        ` SUM(INPUT_TOKENS) AS P, SUM(OUTPUT_TOKENS) AS C, SUM(TOTAL_TOKENS) AS T,` +
        ` TO_CHAR(MAX(CALL_TM), 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_TM` +
        ` FROM TRX_TOKEN_DET${grpWhere("TRACE_ID IS NOT NULL")} GROUP BY TRACE_ID` +
        ` UNION ALL ` +
        `SELECT 'token:' || TOKEN_ID AS QKEY, NULL AS TRACE_ID, NODE_NM AS NODES, MODEL_NM AS MODELS,` +
        ` ${hasStatus ? `CASE WHEN ${SQL_ERR_PRED} THEN NODE_NM END` : "NULL"} AS ERRNODES,` +
        ` QUERY_CTN AS QCTN,` +
        ` USER_ID AS USR, 1 AS CALLS,` +
        ` INPUT_TOKENS AS P, OUTPUT_TOKENS AS C, TOTAL_TOKENS AS T,` +
        ` TO_CHAR(CALL_TM, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_TM` +
        ` FROM TRX_TOKEN_DET${grpWhere("TRACE_ID IS NULL")}` +
      `) ORDER BY LAST_TM DESC FETCH FIRST ${QUESTION_LIMIT} ROWS ONLY`;
    const questions: TokenQuestion[] = skipQ ? [] : (await run("questions", questionsSql)).map((r) => ({
      qKey: String(r.QKEY ?? r.qkey ?? ""),
      traceId: str(r.TRACE_ID ?? r.trace_id),
      nodes: dedupeCsv(str(r.NODES ?? r.nodes)),
      models: dedupeCsv(str(r.MODELS ?? r.models)),
      errorNodes: dedupeCsv(str(r.ERRNODES ?? r.errnodes)),
      queryCtn: str(r.QCTN ?? r.qctn),
      userId: str(r.USR ?? r.usr),
      calls: num(r.CALLS ?? r.calls),
      inputTokens: num(r.P ?? r.p),
      outputTokens: num(r.C ?? r.c),
      totalTokens: num(r.T ?? r.t),
      lastTm: str(r.LAST_TM ?? r.last_tm),
    }));

    const rowFrom = (r: Record<string, unknown>): TokenRow => {
      const lat = r.LATENCY_MS ?? r.latency_ms;
      return {
        tokenId: String(r.TOKEN_ID ?? r.token_id ?? ""),
        traceId: str(r.TRACE_ID ?? r.trace_id),
        nodeNm: str(r.NODE_NM ?? r.node_nm),
        modelNm: str(r.MODEL_NM ?? r.model_nm),
        userId: str(r.USER_ID ?? r.user_id),
        inputTokens: num(r.INPUT_TOKENS ?? r.input_tokens),
        outputTokens: num(r.OUTPUT_TOKENS ?? r.output_tokens),
        totalTokens: num(r.TOTAL_TOKENS ?? r.total_tokens),
        latencyMs: lat == null ? null : num(lat),
        queryCtn: str(r.QUERY_CTN ?? r.query_ctn),
        statCd: str(r.STAT_CD ?? r.stat_cd),
        errCtn: str(r.ERR_CTN ?? r.err_ctn),
        callTm: str(r.CALL_TM ?? r.call_tm),
      };
    };

    let calls: TokenRow[] = [];
    if (filter.traceId && !skipQ) {
      const callsSql =
        `SELECT TOKEN_ID, TRACE_ID, NODE_NM, MODEL_NM, USER_ID,` +
        ` INPUT_TOKENS, OUTPUT_TOKENS, TOTAL_TOKENS, LATENCY_MS, QUERY_CTN${statCols},` +
        ` TO_CHAR(CALL_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS CALL_TM` +
        ` FROM TRX_TOKEN_DET WHERE TRACE_ID = :traceId` +
        ` ORDER BY CALL_TM DESC FETCH FIRST ${CALL_LIMIT} ROWS ONLY`;
      calls = (await run("calls", callsSql, { traceId: filter.traceId })).map(rowFrom);
    }

    logger.info("fetchTokenStats ok", {
      calls: totals.calls,
      questions: questions.length,
      ms: Date.now() - t0,
    });

    return {
      range: { from: filter.dateFrom ?? null, to: filter.dateTo ?? null },
      totals,
      avgTotalPerCall: totals.calls > 0 ? totals.totalTokens / totals.calls : null,
      avgLatencyMs: latCnt > 0 ? latSum / latCnt : null,
      granularity: g,
      buckets,
      byNode,
      byModel,
      topUsers,
      questions,
      calls,
    };
  } catch (e) {
    logger.error("fetchTokenStats failed", { ms: Date.now() - t0, err: String(e) });
    return emptyStats(filter, g, emptyBuckets);
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
      }
    }
  }
}
