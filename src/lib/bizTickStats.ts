// BIZ 틱 집계. 진입 레이어(LAYER_ORDER[0]) 하나만 읽는다 — 하위를 같이 세면 멀티콜 때문에
// 요청 수가 부풀어 오른다. docs/screens/tick.md

import { LAYER_ORDER, BizTickFilter, TickStatsResponse, TickTrace } from "./types";
import { logger } from "./logger";
import { loadConfig } from "./config";
import { isoNoTz, parseTs } from "./timeBuckets";
import { TICK_CALL_LIMIT, TICK_MAX_MINUTES, TickSecond, rollupTick } from "./tickStats";
import { ACTION_FAIL_PHRASES } from "./tempStatus"; // TEMP(ONEOIS 미연결): 실패 판정이 CUBE RESP 문구를 본다

// ⚠️ 실패 판정은 화면 나머지와 같은 규칙이다 — ERR_CD 가 있거나, TEMP(ONEOIS 미연결)

const ENTRY_LAYER = LAYER_ORDER[0];

const MIN_MS = 60_000;

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

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (v == null ? null : String(v));

function emptyStats(fromMs: number, toMs: number): TickStatsResponse {
  const { minutes, peakA, peakB } = rollupTick([], fromMs, toMs);
  return {
    kind: "biz",
    range: { from: isoNoTz(fromMs), to: isoNoTz(toMs) },
    minutes,
    peakA,
    peakB,
    totals: { a: 0, b: 0, rows: 0 },
    calls: [],
    traces: [],
    truncated: false,
  };
}

export async function fetchBizTickStats(filter: BizTickFilter): Promise<TickStatsResponse> {
  const now = Date.now();
  const toMs = filter.dateTo ? Date.parse(filter.dateTo) : now;
  let fromMs = filter.dateFrom ? Date.parse(filter.dateFrom) : toMs - 60 * MIN_MS;
  if ((toMs - fromMs) / MIN_MS > TICK_MAX_MINUTES) fromMs = toMs - TICK_MAX_MINUTES * MIN_MS;

  const cfg = loadConfig().layers[ENTRY_LAYER] ?? null;
  if (!cfg) return emptyStats(fromMs, toMs);
  const oracle = await getOracle();
  if (!oracle) return emptyStats(fromMs, toMs);

  // 실패 판정식 — ERR_CD 또는 TEMP 액션 실패 문구.
  const failParts = ["ERR_CD IS NOT NULL"].concat(
    ACTION_FAIL_PHRASES.map((_, i) => `RESP_MSG_CTN LIKE :failPhrase${i}`)
  );
  const failPred = `(${failParts.join(" OR ")})`;

  const binds: Record<string, unknown> = {
    dateFrom: isoNoTz(fromMs),
    dateTo: isoNoTz(toMs),
    ...Object.fromEntries(ACTION_FAIL_PHRASES.map((p, i) => [`failPhrase${i}`, `%${p}%`])),
  };

  const where: string[] = [
    `RECV_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD"T"HH24:MI:SS')`,
    `RECV_TM <= TO_TIMESTAMP(:dateTo, 'YYYY-MM-DD"T"HH24:MI:SS')`,
  ];
  if (filter.userId) {
    where.push(`UPPER(TRIM(USER_ID)) LIKE '%' || UPPER(:userId) || '%'`);
    binds.userId = filter.userId;
  }
  const whereSql = ` WHERE ${where.join(" AND ")}`;

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    conn = await oracle.getConnection(cfg);
    const opts = { outFormat: oracle.OBJECT } as const;
    const rowsOf = (r: { rows?: unknown }) => (r.rows ?? []) as Array<Record<string, unknown>>;

    const run = async (name: string, sql: string): Promise<Array<Record<string, unknown>>> => {
      try {
        return rowsOf(await conn!.execute(sql, binds, opts));
      } catch (e) {
        logger.error(`fetchBizTickStats [${name}] query failed`, { err: String(e), sql });
        return [];
      }
    };

    const secExpr = `TO_CHAR(RECV_TM, 'YYYY-MM-DD"T"HH24:MI:SS')`;
    const secSql =
      `SELECT ${secExpr} AS S, COUNT(DISTINCT TRACE_ID) AS A,` +
      ` COUNT(DISTINCT CASE WHEN ${failPred} THEN TRACE_ID END) AS B, COUNT(*) AS N` +
      ` FROM BIZ_AIACTIONTXN_HIS${whereSql} GROUP BY ${secExpr} ORDER BY 1`;

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

    const traceSql =
      `SELECT * FROM (` +
      `SELECT TO_CHAR(MIN(RECV_TM), 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RTM, TRACE_ID,` +
      ` MAX(USER_ID) AS USER_ID, MAX(ERR_CD) AS ERR_CD,` +
      ` MAX(CASE WHEN ${failPred} THEN 1 ELSE 0 END) AS FAILED` +
      ` FROM BIZ_AIACTIONTXN_HIS${whereSql}` +
      ` GROUP BY TRACE_ID ORDER BY MIN(RECV_TM) DESC NULLS LAST` +
      `) WHERE ROWNUM <= ${TICK_CALL_LIMIT + 1}`;
    const raw = await run("traces", traceSql);
    const truncated = raw.length > TICK_CALL_LIMIT;
    const traces: TickTrace[] = raw.slice(0, TICK_CALL_LIMIT).map((r) => ({
      recvTm: str(r.RTM ?? r.rtm),
      traceId: str(r.TRACE_ID ?? r.trace_id),
      userId: str(r.USER_ID ?? r.user_id),
      errCd: str(r.ERR_CD ?? r.err_cd),
      failed: num(r.FAILED ?? r.failed) > 0,
    }));
    traces.reverse();

    logger.info("fetchBizTickStats done", {
      layer: ENTRY_LAYER,
      seconds: seconds.length,
      minutes: minutes.length,
      traces: traces.length,
      truncated,
      ms: Date.now() - t0,
    });

    return {
      kind: "biz",
      range: { from: isoNoTz(fromMs), to: isoNoTz(toMs) },
      minutes,
      peakA,
      peakB,
      totals,
      calls: [],
      traces,
      truncated,
    };
  } catch (e) {
    logger.error("fetchBizTickStats failed", { err: String(e), ms: Date.now() - t0 });
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
