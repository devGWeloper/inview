import { LAYER_ORDER, BizTickFilter, TickStatsResponse, TickTrace } from "./types";
import { logger } from "./logger";
import { loadConfig } from "./config";
import { isoNoTz, parseTs } from "./timeBuckets";
import { TICK_CALL_LIMIT, TICK_MAX_MINUTES, TickSecond, rollupTick } from "./tickStats";
import { ACTION_FAIL_PHRASES } from "./tempStatus"; // TEMP(ONEOIS 미연결): 실패 판정이 CUBE RESP 문구를 본다

// ─────────────────────────────────────────────────────────────────────────────
// 1TICK — BIZ 소스(BIZ_AIACTIONTXN_HIS) 의 롤링 60초 집계. Dashboard 의 "실시간" 뷰.
//
// A = 분당 요청 수, B = 분당 실패 수. 롤업(rollupTick)은 LLM 소스와 **같은 순수 함수**를
// 쓴다 — 슬라이딩 60초 정의가 화면마다 갈리면 같은 데이터에서 다른 수치가 나온다.
//
// ⚠️ 진입 레이어(LAYER_ORDER[0] = CUBE) **하나만** 읽는다. 사용자 요청 1건 = 진입 레이어
//    수신 1건이므로 "분당 몇 건 들어오는가" 는 이 레이어에서만 정의된다. 하위 레이어를
//    같이 세면 멀티콜(GAIA→MCP 2회) 때문에 요청 수가 부풀어 오른다.
//
// ⚠️ 실패 판정은 화면 나머지와 같은 규칙이다 — ERR_CD 가 있거나, TEMP(ONEOIS 미연결)
//    규칙의 액션 실패 문구가 CUBE RESP 에 있는 경우. 여기만 ERR_CD 로 좁히면
//    대시보드 KPI 의 실패 수와 실시간 뷰의 실패 수가 갈린다.
//    (ONEOIS 연결 후 원복할 때 tempStatus.ts 의존을 같이 정리할 것 — CLAUDE.md 참고)
//
// 다른 모듈과 같은 lazy-oracledb-swallow 패턴 — 드라이버/설정이 없으면 빈 격자를
// 돌려주고 화면은 정상 동작한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 요청 수를 세는 레이어 = 진입 레이어. LAYERS 배열이 바뀌면 자동으로 따라간다. */
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
  // 임의로 넓은 범위가 와도 분 격자가 폭발하지 않도록 클램프 (뒤쪽 = 최신 유지)
  if ((toMs - fromMs) / MIN_MS > TICK_MAX_MINUTES) fromMs = toMs - TICK_MAX_MINUTES * MIN_MS;

  const cfg = loadConfig().layers[ENTRY_LAYER] ?? null;
  if (!cfg) return emptyStats(fromMs, toMs);
  const oracle = await getOracle();
  if (!oracle) return emptyStats(fromMs, toMs);

  // 실패 판정식 — ERR_CD 또는 TEMP 액션 실패 문구.
  // ⚠️ 문구는 반드시 바인드로 넘긴다(문자열 보간 금지 — SQL 인젝션·따옴표 파손).
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

    // 쿼리별 격리 실행 — 한 쿼리가 죽어도 나머지 섹션은 살린다 (tickStats.ts 와 동일 패턴)
    const run = async (name: string, sql: string): Promise<Array<Record<string, unknown>>> => {
      try {
        return rowsOf(await conn!.execute(sql, binds, opts));
      } catch (e) {
        logger.error(`fetchBizTickStats [${name}] query failed`, { err: String(e), sql });
        return [];
      }
    };

    // ① 초 단위 집계. 요청이 있던 초만 행이 나오므로 24시간이어도 행 수가 제한적이다.
    //    ⚠️ COUNT(*) 가 아니라 COUNT(DISTINCT TRACE_ID) — 진입 레이어라도 재시도 등으로
    //       한 트레이스에 행이 둘 생기면 요청 수가 부풀기 때문이다.
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

    // ② 드릴다운용 요청 목록 — 피크 60초 안을 들여다보는 용도. 상한을 넘으면 최신 쪽을 남긴다.
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
    // 화면은 시간 오름차순으로 읽는다 (DESC 로 잘라온 뒤 되돌린다)
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
        /* noop */
      }
    }
  }
}
