import { getAppDbConfig } from "./config";
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

// GAIA LLM 호출별 토큰 사용량(TRX_TOKEN_DET) 집계.
// 앱 자체 DB(= GAIA, config.ts APP_DB_LAYER)에서만 조회한다(BIZ 테이블처럼 fan-out 안 함).
// 행이 많을 수 있어 JS 전수 집계 대신 SQL GROUP BY 로 집계한다.

// oracledb 는 next.config 의 serverComponentsExternalPackages 로 빠져 있어 lazy import.
// 드라이버/설정 없으면 에러를 삼키고 빈 통계(0)를 반환 → 앱은 정상 동작.
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

const QUESTION_LIMIT = 200; // "질문별 토큰" 표에 노출할 질문 수 (총 토큰 desc 상위)
const CALL_LIMIT = 200;     // 단일 질문(traceId) 펼침 시 호출 행 수
const TOP_USER_LIMIT = 8;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (v == null ? null : String(v));
/** LISTAGG 결과(csv)를 첫 등장 순서 유지하며 중복 제거한 배열로 */
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

/** CALL_TM 을 granularity 버킷 시작 시각(ISO 문자열)으로 만드는 Oracle 표현식 */
function bucketExpr(g: Granularity): string {
  if (g === "1d") return `TRUNC(CALL_TM)`;
  if (g === "1h") return `TRUNC(CALL_TM, 'HH24')`;
  // 5분: 시각 floor 후 5분 단위 분을 일(day) 분수로 더함
  return `TRUNC(CALL_TM, 'HH24') + FLOOR(TO_NUMBER(TO_CHAR(CALL_TM, 'MI')) / 5) * 5 / 1440`;
}

/** TokenFilter → WHERE 절 + 바인드. 시간 컬럼은 CALL_TM 기준. */
function buildWhere(filter: TokenFilter): { where: string; binds: Record<string, unknown> } {
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
  // 빈 버킷(시계열 차트가 균일하게 보이도록) — 데이터 없거나 미구성이어도 그대로 노출
  const emptyBuckets: TokenBucket[] = enumerateBucketStarts(fromMs, toMs, g).map((k) => ({
    ts: isoNoTz(k),
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    calls: 0,
    avgLatencyMs: null,
  }));

  const cfg = getAppDbConfig();
  if (!cfg) return emptyStats(filter, g, emptyBuckets);
  const oracle = await getOracle();
  if (!oracle) return emptyStats(filter, g, emptyBuckets);

  const { where, binds } = buildWhere(filter);

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    conn = await oracle.getConnection(cfg);
    const opts = { outFormat: oracle.OBJECT } as const;
    const rowsOf = (r: { rows?: unknown }) => (r.rows ?? []) as Array<Record<string, unknown>>;

    // 1) 시계열 버킷 (+ totals 는 버킷 합으로 도출)
    //   LATENCY_MS 는 NULL 가능 → SUM/COUNT(LATENCY_MS) 로 NULL 제외 평균을 도출하고,
    //   전체 평균(latSum/latCnt)도 같은 행들에서 누적한다.
    const bucketSql =
      `SELECT TO_CHAR(${bucketExpr(g)}, 'YYYY-MM-DD"T"HH24:MI:SS') AS BKT,` +
      ` SUM(INPUT_TOKENS) AS P, SUM(OUTPUT_TOKENS) AS C, SUM(TOTAL_TOKENS) AS T, COUNT(*) AS N,` +
      ` SUM(LATENCY_MS) AS LSUM, COUNT(LATENCY_MS) AS LCNT` +
      ` FROM TRX_TOKEN_DET${where} GROUP BY ${bucketExpr(g)} ORDER BY 1`;
    const bucketRes = await conn.execute(bucketSql, binds, opts);
    const bucketMap = new Map<number, TokenBucket>();
    let latSum = 0;
    let latCnt = 0;
    for (const r of rowsOf(bucketRes)) {
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
      (k) =>
        bucketMap.get(k) ?? {
          ts: isoNoTz(k),
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          calls: 0,
          avgLatencyMs: null,
        }
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

    // 2) byNode / 3) byModel — 동일 패턴 (차원 컬럼만 다름)
    //   AVG(LATENCY_MS) 는 NULL 을 자동 제외하므로, 측정값이 하나도 없으면 NULL 을 돌려준다.
    const dimSql = (col: string) =>
      `SELECT NVL(${col}, '(none)') AS K, COUNT(*) AS N,` +
      ` SUM(INPUT_TOKENS) AS P, SUM(OUTPUT_TOKENS) AS C, SUM(TOTAL_TOKENS) AS T,` +
      ` AVG(LATENCY_MS) AS L` +
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
    const byNode = dimFrom(rowsOf(await conn.execute(dimSql("NODE_NM"), binds, opts)));
    const byModel = dimFrom(rowsOf(await conn.execute(dimSql("MODEL_NM"), binds, opts)));

    // 2.5) 노드×모델 교차 — 각 노드가 어떤 모델을 얼마나 썼는지(그 역방향도).
    //   한 노드가 모델 하나만 쓴다고 오해하지 않도록 리더보드 행에 구성으로 노출한다.
    const crossSql =
      `SELECT NVL(NODE_NM, '(none)') AS NK, NVL(MODEL_NM, '(none)') AS MK,` +
      ` COUNT(*) AS N, SUM(TOTAL_TOKENS) AS T` +
      ` FROM TRX_TOKEN_DET${where}` +
      ` GROUP BY NVL(NODE_NM, '(none)'), NVL(MODEL_NM, '(none)') ORDER BY T DESC`;
    const nodeIdx = new Map(byNode.map((d) => [d.key, d]));
    const modelIdx = new Map(byModel.map((d) => [d.key, d]));
    for (const r of rowsOf(await conn.execute(crossSql, binds, opts))) {
      const nk = String(r.NK ?? r.nk ?? "(none)");
      const mk = String(r.MK ?? r.mk ?? "(none)");
      const calls = num(r.N ?? r.n);
      const totalTokens = num(r.T ?? r.t);
      nodeIdx.get(nk)?.sub.push({ key: mk, calls, totalTokens });
      modelIdx.get(mk)?.sub.push({ key: nk, calls, totalTokens });
    }

    // 4) topUsers — TOTAL_TOKENS 기준 (count = totalTokens)
    const userSql =
      `SELECT USER_ID AS K, SUM(TOTAL_TOKENS) AS T FROM TRX_TOKEN_DET${where}` +
      `${where ? " AND" : " WHERE"} USER_ID IS NOT NULL` +
      ` GROUP BY USER_ID ORDER BY T DESC FETCH FIRST ${TOP_USER_LIMIT} ROWS ONLY`;
    const topUsers: TopItem[] = rowsOf(await conn.execute(userSql, binds, opts)).map((r) => ({
      key: String(r.K ?? r.k ?? ""),
      count: num(r.T ?? r.t),
    }));

    // 5) questions — 질문(TRACE_ID) 단위 묶음 (총 토큰 desc 상위).
    //    TRACE_ID 있는 호출은 그룹핑, 없는(액션 무관) 호출은 1건=1질문으로 개별 노출.
    //    노드/모델은 MAX 대표값이 아니라 거쳐간 전부를 LISTAGG 로 내린다(중복 제거는 JS).
    //    한 질문의 호출 수는 작아 4000자 한도는 사실상 안 넘지만 ON OVERFLOW TRUNCATE 로 방어.
    //    QCTN(원본 질의) = 가장 이른 호출의 QUERY_CTN — non-null 우선(NVL2 정렬) 후 CALL_TM 순.
    //    호출들이 같은 QUERY_CTN 을 공유하는 게 보통이라 질문 단위 대표 정보로 내린다.
    const grpWhere = (nullCond: string) => `${where}${where ? " AND" : " WHERE"} ${nullCond}`;
    const agg = (col: string) =>
      `LISTAGG(${col}, ',' ON OVERFLOW TRUNCATE) WITHIN GROUP (ORDER BY CALL_TM)`;
    const questionsSql =
      `SELECT QKEY, TRACE_ID, NODES, MODELS, QCTN, USR, CALLS, P, C, T, LAST_TM FROM (` +
        `SELECT TRACE_ID AS QKEY, TRACE_ID,` +
        ` ${agg("NODE_NM")} AS NODES, ${agg("MODEL_NM")} AS MODELS,` +
        ` MIN(QUERY_CTN) KEEP (DENSE_RANK FIRST ORDER BY NVL2(QUERY_CTN, 0, 1), CALL_TM) AS QCTN,` +
        ` MAX(USER_ID) AS USR, COUNT(*) AS CALLS,` +
        ` SUM(INPUT_TOKENS) AS P, SUM(OUTPUT_TOKENS) AS C, SUM(TOTAL_TOKENS) AS T,` +
        ` TO_CHAR(MAX(CALL_TM), 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_TM` +
        ` FROM TRX_TOKEN_DET${grpWhere("TRACE_ID IS NOT NULL")} GROUP BY TRACE_ID` +
        ` UNION ALL ` +
        `SELECT 'token:' || TOKEN_ID AS QKEY, NULL AS TRACE_ID, NODE_NM AS NODES, MODEL_NM AS MODELS,` +
        ` QUERY_CTN AS QCTN,` +
        ` USER_ID AS USR, 1 AS CALLS,` +
        ` INPUT_TOKENS AS P, OUTPUT_TOKENS AS C, TOTAL_TOKENS AS T,` +
        ` TO_CHAR(CALL_TM, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_TM` +
        ` FROM TRX_TOKEN_DET${grpWhere("TRACE_ID IS NULL")}` +
      `) ORDER BY T DESC FETCH FIRST ${QUESTION_LIMIT} ROWS ONLY`;
    const questions: TokenQuestion[] = rowsOf(await conn.execute(questionsSql, binds, opts)).map((r) => ({
      qKey: String(r.QKEY ?? r.qkey ?? ""),
      traceId: str(r.TRACE_ID ?? r.trace_id),
      nodes: dedupeCsv(str(r.NODES ?? r.nodes)),
      models: dedupeCsv(str(r.MODELS ?? r.models)),
      queryCtn: str(r.QCTN ?? r.qctn),
      userId: str(r.USR ?? r.usr),
      calls: num(r.CALLS ?? r.calls),
      inputTokens: num(r.P ?? r.p),
      outputTokens: num(r.C ?? r.c),
      totalTokens: num(r.T ?? r.t),
      lastTm: str(r.LAST_TM ?? r.last_tm),
    }));

    // 6) calls — 특정 질문(traceId) 으로 좁혔을 때만 호출별 행 채움 (행 펼침용)
    let calls: TokenRow[] = [];
    if (filter.traceId) {
      const callsSql =
        `SELECT TOKEN_ID, TRACE_ID, NODE_NM, MODEL_NM, USER_ID,` +
        ` INPUT_TOKENS, OUTPUT_TOKENS, TOTAL_TOKENS, LATENCY_MS, QUERY_CTN,` +
        ` TO_CHAR(CALL_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS CALL_TM` +
        ` FROM TRX_TOKEN_DET${where} ORDER BY CALL_TM DESC FETCH FIRST ${CALL_LIMIT} ROWS ONLY`;
      calls = rowsOf(await conn.execute(callsSql, binds, opts)).map((r) => {
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
          callTm: str(r.CALL_TM ?? r.call_tm),
        };
      });
    }

    logger.info("fetchTokenStats ok", { calls: totals.calls, questions: questions.length, ms: Date.now() - t0 });

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
        /* ignore */
      }
    }
  }
}
