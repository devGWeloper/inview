import { getAppDbConfig } from "./config";
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
import { isoNoTz, parseTs } from "./timeBuckets";

// ─────────────────────────────────────────────────────────────────────────────
// 1TICK — 분당 TPM/RPM 모니터 집계 (Tokens 탭 "1TICK" 프리셋).
//
// ⚠️ 왜 별도 모듈인가: tokens.ts 의 시계열은 5분/1시간/1일 격자라 TPM/RPM 제약을
//    판정할 수 없다. 그리고 **정각 분 버킷도 판정 기준이 못 된다** — 제약은
//    "임의의 연속 60초" 기준이라 12:01:13~12:02:12 버스트는 정각 격자에선 두 칸으로
//    쪼개져 어느 칸도 한도를 안 넘는 것처럼 보인다(실제로는 초과).
//
//    그래서 여기서는 **초 단위로 SQL 집계**한 뒤(호출이 있던 초만 행이 나오므로
//    1시간이어도 최대 3600행) JS 에서 **슬라이딩 60초 윈도우의 최대값**을 구한다.
//    윈도우 시작을 "호출이 있던 초" 로만 잡아도 실수 t 전체에 대한 최대와 같다
//    (요지: 합은 구간별 상수이고, 어떤 시작점의 윈도우든 그 안 첫 호출 시각에서
//     시작하는 윈도우가 같은 호출을 모두 포함한다). 즉 근사가 아니라 **정확한 최대**다.
//
// 앱 자체 DB(= GAIA, config.ts APP_DB_LAYER)의 TRX_TOKEN_DET 만 본다. 다른 모듈과 같은
// lazy-oracledb-swallow 패턴 — 드라이버/설정이 없으면 빈 격자를 돌려주고 화면은 정상 동작.
// ─────────────────────────────────────────────────────────────────────────────

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

/** 드릴다운용 호출 행 상한. 넘으면 최신 쪽을 남기고 truncated=true 로 알린다. */
export const TICK_CALL_LIMIT = 3000;
/** 분 격자 상한 (24시간). 화면은 15/60/180분만 제공하지만 임의 범위 요청을 방어한다. */
export const TICK_MAX_MINUTES = 24 * 60;

const MIN_MS = 60_000;
const WIN_MS = TICK_WINDOW_SEC * 1000;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (v == null ? null : String(v));

/** 초 단위 집계 1행 — rollupTick 의 입력 */
export interface TickSecond {
  /** 그 초의 시작 시각(ms) */
  ms: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

const floorMinute = (ms: number): number => Math.floor(ms / MIN_MS) * MIN_MS;

/**
 * 초 단위 집계 → 분 격자 + 롤링 60초 피크.
 *
 * 순수 함수(DB 무관) — 경계 조건 검증이 여기 하나로 끝나도록 분리했다.
 * @param seconds ms 오름차순 정렬된 초 단위 집계 (호출이 있던 초만)
 */
export function rollupTick(
  seconds: TickSecond[],
  fromMs: number,
  toMs: number
): { minutes: TickMinute[]; peakTpm: TickPeak; peakRpm: TickPeak } {
  // ① 정각 분 합계 (참고용 막대)
  const fixed = new Map<number, { t: number; p: number; c: number; n: number }>();
  for (const s of seconds) {
    const k = floorMinute(s.ms);
    const cur = fixed.get(k) ?? { t: 0, p: 0, c: 0, n: 0 };
    cur.t += s.tokens;
    cur.p += s.inputTokens;
    cur.c += s.outputTokens;
    cur.n += s.calls;
    fixed.set(k, cur);
  }

  // ② 슬라이딩 60초 — 윈도우 시작을 각 이벤트 초로 잡고 two-pointer 로 훑는다.
  //    분별 최대(그 분에 시작하는 윈도우 중 최대)와 전체 피크를 함께 모은다.
  type RollCell = { tok: number; tokAt: number | null; call: number; callAt: number | null };
  const roll = new Map<number, RollCell>();
  let peakTok = 0;
  let peakTokAt: number | null = null;
  let peakCall = 0;
  let peakCallAt: number | null = null;

  let j = 0;
  let sumTok = 0;
  let sumCalls = 0;
  for (let i = 0; i < seconds.length; i++) {
    const start = seconds[i].ms;
    while (j < seconds.length && seconds[j].ms < start + WIN_MS) {
      sumTok += seconds[j].tokens;
      sumCalls += seconds[j].calls;
      j++;
    }

    const k = floorMinute(start);
    const cell = roll.get(k) ?? { tok: 0, tokAt: null, call: 0, callAt: null };
    if (sumTok > cell.tok) {
      cell.tok = sumTok;
      cell.tokAt = start;
    }
    if (sumCalls > cell.call) {
      cell.call = sumCalls;
      cell.callAt = start;
    }
    roll.set(k, cell);

    if (sumTok > peakTok) {
      peakTok = sumTok;
      peakTokAt = start;
    }
    if (sumCalls > peakCall) {
      peakCall = sumCalls;
      peakCallAt = start;
    }

    // 다음 시작점으로 넘어가기 전에 좌측 끝(i) 을 뺀다
    sumTok -= seconds[i].tokens;
    sumCalls -= seconds[i].calls;
  }

  // ③ 빈 분도 0 으로 채운 격자 (차트가 끊기지 않도록)
  const minutes: TickMinute[] = [];
  const startK = floorMinute(fromMs);
  const endK = floorMinute(toMs);
  for (let k = startK; k <= endK; k += MIN_MS) {
    const f = fixed.get(k);
    const r = roll.get(k);
    minutes.push({
      ts: isoNoTz(k),
      fixedTokens: f?.t ?? 0,
      fixedCalls: f?.n ?? 0,
      fixedInputTokens: f?.p ?? 0,
      fixedOutputTokens: f?.c ?? 0,
      rollTokens: r?.tok ?? 0,
      rollTokensAt: r?.tokAt != null ? isoNoTz(r.tokAt) : null,
      rollCalls: r?.call ?? 0,
      rollCallsAt: r?.callAt != null ? isoNoTz(r.callAt) : null,
    });
  }

  return {
    minutes,
    peakTpm: { value: peakTok, at: peakTokAt != null ? isoNoTz(peakTokAt) : null },
    peakRpm: { value: peakCall, at: peakCallAt != null ? isoNoTz(peakCallAt) : null },
  };
}

function emptyStats(filter: TickFilter, fromMs: number, toMs: number): TickStatsResponse {
  const { minutes, peakTpm, peakRpm } = rollupTick([], fromMs, toMs);
  return {
    range: { from: isoNoTz(fromMs), to: isoNoTz(toMs) },
    minutes,
    peakTpm,
    peakRpm,
    totals: { calls: 0, totalTokens: 0 },
    calls: [],
    truncated: false,
  };
}

export async function fetchTickStats(filter: TickFilter): Promise<TickStatsResponse> {
  const now = Date.now();
  const toMs = filter.dateTo ? Date.parse(filter.dateTo) : now;
  let fromMs = filter.dateFrom ? Date.parse(filter.dateFrom) : toMs - 60 * MIN_MS;
  // 임의로 넓은 범위가 와도 분 격자가 폭발하지 않도록 클램프 (뒤쪽 = 최신 유지)
  if ((toMs - fromMs) / MIN_MS > TICK_MAX_MINUTES) fromMs = toMs - TICK_MAX_MINUTES * MIN_MS;

  const cfg = getAppDbConfig();
  if (!cfg) return emptyStats(filter, fromMs, toMs);
  const oracle = await getOracle();
  if (!oracle) return emptyStats(filter, fromMs, toMs);

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    conn = await oracle.getConnection(cfg);
    const opts = { outFormat: oracle.OBJECT } as const;
    const rowsOf = (r: { rows?: unknown }) => (r.rows ?? []) as Array<Record<string, unknown>>;

    // STAT_CD/ERR_CTN 컬럼 존재 확인 (GAIA ALTER 전에도 죽지 않도록 — tokens.ts 와 동일)
    let hasStatus = true;
    try {
      await conn.execute("SELECT STAT_CD, ERR_CTN FROM TRX_TOKEN_DET WHERE 1 = 0", {}, opts);
    } catch {
      hasStatus = false;
    }

    // 클램프된 범위를 그대로 WHERE 에 반영 (요청 필터와 실제 집계 범위가 어긋나지 않게)
    const eff: TickFilter = { ...filter, dateFrom: isoNoTz(fromMs), dateTo: isoNoTz(toMs) };
    const { where, binds } = buildWhere(eff);

    // 쿼리별 격리 실행 — 한 쿼리가 죽어도 나머지 섹션은 살린다 (tokens.ts 와 동일 패턴)
    const run = async (name: string, sql: string): Promise<Array<Record<string, unknown>>> => {
      try {
        return rowsOf(await conn!.execute(sql, binds, opts));
      } catch (e) {
        logger.error(`fetchTickStats [${name}] query failed`, { err: String(e), sql });
        return [];
      }
    };

    // ① 초 단위 집계 — 호출이 있던 초만 행이 나오므로 범위가 1시간이어도 ≤3600행.
    const secExpr = `TO_CHAR(CALL_TM, 'YYYY-MM-DD"T"HH24:MI:SS')`;
    const secSql =
      `SELECT ${secExpr} AS S, SUM(TOTAL_TOKENS) AS T, SUM(INPUT_TOKENS) AS P,` +
      ` SUM(OUTPUT_TOKENS) AS C, COUNT(*) AS N` +
      ` FROM TRX_TOKEN_DET${where} GROUP BY ${secExpr} ORDER BY 1`;
    const seconds: TickSecond[] = [];
    for (const r of await run("seconds", secSql)) {
      const ms = parseTs(str(r.S ?? r.s));
      if (ms === null) continue;
      seconds.push({
        ms,
        tokens: num(r.T ?? r.t),
        inputTokens: num(r.P ?? r.p),
        outputTokens: num(r.C ?? r.c),
        calls: num(r.N ?? r.n),
      });
    }
    // ORDER BY 는 ISO 문자열 사전순 = 시간순이지만, 파싱 실패 행을 건너뛴 뒤에도
    // 오름차순이 보장되도록 한 번 더 정렬한다(rollupTick 의 전제).
    seconds.sort((a, b) => a.ms - b.ms);

    const { minutes, peakTpm, peakRpm } = rollupTick(seconds, fromMs, toMs);
    const totals = seconds.reduce(
      (acc, s) => {
        acc.calls += s.calls;
        acc.totalTokens += s.tokens;
        return acc;
      },
      { calls: 0, totalTokens: 0 }
    );

    // ② 드릴다운용 호출 목록 — 초과 윈도우 안을 들여다보는 용도.
    //   상한을 넘으면 **최신 쪽**을 남긴다(모니터는 방금 난 초과를 먼저 본다).
    //   화면은 truncated 배지로 "조회 범위를 좁히라" 고 알린다.
    const statCols = hasStatus ? ", STAT_CD, ERR_CTN" : "";
    const callSql =
      `SELECT * FROM (` +
      `SELECT TO_CHAR(CALL_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS CTM, TRACE_ID, NODE_NM, MODEL_NM,` +
      ` USER_ID, INPUT_TOKENS, OUTPUT_TOKENS, TOTAL_TOKENS, LATENCY_MS${statCols}` +
      ` FROM TRX_TOKEN_DET${where} ORDER BY CALL_TM DESC NULLS LAST` +
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
    // 화면은 시간 오름차순으로 읽는다 (DESC 로 잘라온 뒤 되돌린다)
    calls.reverse();

    logger.info("fetchTickStats done", {
      seconds: seconds.length,
      minutes: minutes.length,
      calls: calls.length,
      truncated,
      ms: Date.now() - t0,
    });

    return {
      range: { from: eff.dateFrom ?? null, to: eff.dateTo ?? null },
      minutes,
      peakTpm,
      peakRpm,
      totals,
      calls,
      truncated,
    };
  } catch (e) {
    logger.error("fetchTickStats failed", { err: String(e), ms: Date.now() - t0 });
    return emptyStats(filter, fromMs, toMs);
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
