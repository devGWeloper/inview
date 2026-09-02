// 틱(롤링 60초) 집계. rollupTick() 은 LLM 소스와 BIZ 소스가 공유하는 순수 함수다 —
// 정의가 갈리면 같은 사건에서 다른 수치가 나온다. docs/screens/tick.md

import { getAgentDbConfig } from "./config";
import { logger } from "./logger";
import { buildWhere } from "./tokens";
import {
  TICK_WINDOW_SEC,
  TickCall,
  TickFilter,
  TickMinute,
  TickPeak,
  TickStatsResponse,
} from "./types";
import { SQL_ERR_PRED, SQL_TIMEOUT_PRED } from "./tokenStatus";
import { isoNoTz, parseTs } from "./timeBuckets";

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

export const TICK_CALL_LIMIT = 3000;
export const TICK_MAX_MINUTES = 24 * 60;

const MIN_MS = 60_000;
const WIN_MS = TICK_WINDOW_SEC * 1000;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (v == null ? null : String(v));

export interface TickSecond {
  ms: number;
  a: number;
  b: number;
}

const floorMinute = (ms: number): number => Math.floor(ms / MIN_MS) * MIN_MS;

export function rollupTick(
  seconds: TickSecond[],
  fromMs: number,
  toMs: number
): { minutes: TickMinute[]; peakA: TickPeak; peakB: TickPeak } {
  const fixed = new Map<number, { a: number; b: number }>();
  for (const s of seconds) {
    const k = floorMinute(s.ms);
    const cur = fixed.get(k) ?? { a: 0, b: 0 };
    cur.a += s.a;
    cur.b += s.b;
    fixed.set(k, cur);
  }

  type RollCell = { a: number; aAt: number | null; b: number; bAt: number | null };
  const roll = new Map<number, RollCell>();
  let peakAVal = 0;
  let peakAAt: number | null = null;
  let peakBVal = 0;
  let peakBAt: number | null = null;

  let j = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < seconds.length; i++) {
    const start = seconds[i].ms;
    while (j < seconds.length && seconds[j].ms < start + WIN_MS) {
      sumA += seconds[j].a;
      sumB += seconds[j].b;
      j++;
    }

    const k = floorMinute(start);
    const cell = roll.get(k) ?? { a: 0, aAt: null, b: 0, bAt: null };
    if (sumA > cell.a) {
      cell.a = sumA;
      cell.aAt = start;
    }
    if (sumB > cell.b) {
      cell.b = sumB;
      cell.bAt = start;
    }
    roll.set(k, cell);

    if (sumA > peakAVal) {
      peakAVal = sumA;
      peakAAt = start;
    }
    if (sumB > peakBVal) {
      peakBVal = sumB;
      peakBAt = start;
    }

    sumA -= seconds[i].a;
    sumB -= seconds[i].b;
  }

  const minutes: TickMinute[] = [];
  const startK = floorMinute(fromMs);
  const endK = floorMinute(toMs);
  for (let k = startK; k <= endK; k += MIN_MS) {
    const f = fixed.get(k);
    const r = roll.get(k);
    minutes.push({
      ts: isoNoTz(k),
      fixedA: f?.a ?? 0,
      fixedB: f?.b ?? 0,
      rollA: r?.a ?? 0,
      rollAAt: r?.aAt != null ? isoNoTz(r.aAt) : null,
      rollB: r?.b ?? 0,
      rollBAt: r?.bAt != null ? isoNoTz(r.bAt) : null,
    });
  }

  return {
    minutes,
    peakA: { value: peakAVal, at: peakAAt != null ? isoNoTz(peakAAt) : null },
    peakB: { value: peakBVal, at: peakBAt != null ? isoNoTz(peakBAt) : null },
  };
}

function emptyStats(fromMs: number, toMs: number, statusAvailable = true): TickStatsResponse {
  const { minutes, peakA, peakB } = rollupTick([], fromMs, toMs);
  return {
    kind: "llm",
    range: { from: isoNoTz(fromMs), to: isoNoTz(toMs) },
    minutes,
    peakA,
    peakB,
    totals: { a: 0, b: 0, rows: 0 },
    calls: [],
    traces: [],
    truncated: false,
    statusAvailable,
  };
}

export async function fetchTickStats(filter: TickFilter): Promise<TickStatsResponse> {
  const view = filter.view ?? "usage";
  const now = Date.now();
  const toMs = filter.dateTo ? Date.parse(filter.dateTo) : now;
  let fromMs = filter.dateFrom ? Date.parse(filter.dateFrom) : toMs - 60 * MIN_MS;
  if ((toMs - fromMs) / MIN_MS > TICK_MAX_MINUTES) fromMs = toMs - TICK_MAX_MINUTES * MIN_MS;

  const cfg = getAgentDbConfig(filter.agentId);
  if (!cfg) return emptyStats(fromMs, toMs);
  const oracle = await getOracle();
  if (!oracle) return emptyStats(fromMs, toMs);

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    conn = await oracle.getConnection(cfg);
    const opts = { outFormat: oracle.OBJECT } as const;
    const rowsOf = (r: { rows?: unknown }) => (r.rows ?? []) as Array<Record<string, unknown>>;

    let hasStatus = true;
    try {
      await conn.execute("SELECT STAT_CD, ERR_CTN FROM TRX_TOKEN_DET WHERE 1 = 0", {}, opts);
    } catch {
      hasStatus = false;
    }

    if (view === "failure" && !hasStatus) return emptyStats(fromMs, toMs, false);

    const eff: TickFilter = { ...filter, dateFrom: isoNoTz(fromMs), dateTo: isoNoTz(toMs) };
    const { where, binds } = buildWhere(eff);

    const run = async (name: string, sql: string): Promise<Array<Record<string, unknown>>> => {
      try {
        return rowsOf(await conn!.execute(sql, binds, opts));
      } catch (e) {
        logger.error(`fetchTickStats [${name}] query failed`, { err: String(e), sql });
        return [];
      }
    };

    const [exprA, exprB] =
      view === "failure"
        ? [
            `SUM(CASE WHEN ${SQL_ERR_PRED} AND ${SQL_TIMEOUT_PRED} THEN 1 ELSE 0 END)`,
            `SUM(CASE WHEN ${SQL_ERR_PRED} THEN 1 ELSE 0 END)`,
          ]
        : ["SUM(TOTAL_TOKENS)", "COUNT(*)"];

    const secExpr = `TO_CHAR(CALL_TM, 'YYYY-MM-DD"T"HH24:MI:SS')`;
    const secSql =
      `SELECT ${secExpr} AS S, ${exprA} AS A, ${exprB} AS B, COUNT(*) AS N` +
      ` FROM TRX_TOKEN_DET${where} GROUP BY ${secExpr} ORDER BY 1`;
    const seconds: TickSecond[] = [];
    let rows = 0;
    for (const r of await run("seconds", secSql)) {
      const ms = parseTs(str(r.S ?? r.s));
      if (ms === null) continue;
      rows += num(r.N ?? r.n);
      seconds.push({ ms, a: num(r.A ?? r.a), b: num(r.B ?? r.b) });
    }
    seconds.sort((a, b) => a.ms - b.ms);

    const { minutes, peakA, peakB } = rollupTick(seconds, fromMs, toMs);
    const totals = seconds.reduce(
      (acc, sec) => {
        acc.a += sec.a;
        acc.b += sec.b;
        return acc;
      },
      { a: 0, b: 0, rows }
    );

    const statCols = hasStatus ? ", STAT_CD, ERR_CTN" : "";
    const callWhere = view === "failure" ? `${where} AND ${SQL_ERR_PRED}` : where;
    const callSql =
      `SELECT * FROM (` +
      `SELECT TO_CHAR(CALL_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS CTM, TRACE_ID, NODE_NM, MODEL_NM,` +
      ` USER_ID, INPUT_TOKENS, OUTPUT_TOKENS, TOTAL_TOKENS, LATENCY_MS${statCols}` +
      ` FROM TRX_TOKEN_DET${callWhere} ORDER BY CALL_TM DESC NULLS LAST` +
      `) WHERE ROWNUM <= ${TICK_CALL_LIMIT + 1}`;
    const rawCalls = await run("calls", callSql);
    const truncated = rawCalls.length > TICK_CALL_LIMIT;
    const calls: TickCall[] = rawCalls.slice(0, TICK_CALL_LIMIT).map((r) => ({
      callTm: str(r.CTM ?? r.ctm),
      traceId: str(r.TRACE_ID ?? r.trace_id),
      nodeNm: str(r.NODE_NM ?? r.node_nm),
      modelNm: str(r.MODEL_NM ?? r.model_nm),
      userId: str(r.USER_ID ?? r.user_id),
      inputTokens: num(r.INPUT_TOKENS ?? r.input_tokens),
      outputTokens: num(r.OUTPUT_TOKENS ?? r.output_tokens),
      totalTokens: num(r.TOTAL_TOKENS ?? r.total_tokens),
      latencyMs: (r.LATENCY_MS ?? r.latency_ms) == null ? null : num(r.LATENCY_MS ?? r.latency_ms),
      statCd: hasStatus ? str(r.STAT_CD ?? r.stat_cd) : null,
      errCtn: hasStatus ? str(r.ERR_CTN ?? r.err_ctn) : null,
    }));
    calls.reverse();

    logger.info("fetchTickStats done", {
      view,
      seconds: seconds.length,
      minutes: minutes.length,
      calls: calls.length,
      truncated,
      ms: Date.now() - t0,
    });

    return {
      kind: "llm",
      range: { from: eff.dateFrom ?? null, to: eff.dateTo ?? null },
      minutes,
      peakA,
      peakB,
      totals,
      calls,
      traces: [],
      truncated,
      statusAvailable: view === "failure" ? hasStatus : undefined,
    };
  } catch (e) {
    logger.error("fetchTickStats failed", { err: String(e), ms: Date.now() - t0 });
    return emptyStats(fromMs, toMs);
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
      }
    }
  }
}
