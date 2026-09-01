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

// ─────────────────────────────────────────────────────────────────────────────
// 1TICK — LLM 소스(TRX_TOKEN_DET)의 롤링 60초 집계.
//
// ⚠️ A/B 두 슬롯만 채운다. "A 가 무엇인가" 는 화면이 정한다(types.ts 참고).
//      view="usage"   A=토큰 합,     B=호출 수   → Tokens 탭 TPM/RPM
//      view="failure" A=타임아웃 수, B=실패 수   → Timeout 탭
//    한 함수로 묶은 이유는 테이블·필터·롤업이 전부 같고 SELECT 의 두 식만 다르기 때문이다.
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
// filter.agentId 에이전트의 TRX_TOKEN_DET 만 본다. 다른 모듈과 같은
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
/** 분 격자 상한 (24시간). 화면은 1~180분 프리셋만 제공하지만 임의 범위 요청을 방어한다. */
export const TICK_MAX_MINUTES = 24 * 60;

const MIN_MS = 60_000;
const WIN_MS = TICK_WINDOW_SEC * 1000;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (v == null ? null : String(v));

/**
 * 초 단위 집계 1행 — rollupTick 의 입력.
 * ⚠️ a/b 가 무엇인지 여기서는 모른다 (호출부가 정한다) — 그래서 이 롤업이 LLM/BIZ
 *    양쪽 소스에 그대로 재사용된다.
 */
export interface TickSecond {
  /** 그 초의 시작 시각(ms) */
  ms: number;
  a: number;
  b: number;
}

const floorMinute = (ms: number): number => Math.floor(ms / MIN_MS) * MIN_MS;

/**
 * 초 단위 집계 → 분 격자 + 롤링 60초 피크.
 *
 * 순수 함수(DB 무관) — 경계 조건 검증이 여기 하나로 끝나도록 분리했다.
 * @param seconds ms 오름차순 정렬된 초 단위 집계 (값이 있던 초만)
 */
export function rollupTick(
  seconds: TickSecond[],
  fromMs: number,
  toMs: number
): { minutes: TickMinute[]; peakA: TickPeak; peakB: TickPeak } {
  // ① 정각 분 합계 (참고용 — 화면에는 안 그린다)
  const fixed = new Map<number, { a: number; b: number }>();
  for (const s of seconds) {
    const k = floorMinute(s.ms);
    const cur = fixed.get(k) ?? { a: 0, b: 0 };
    cur.a += s.a;
    cur.b += s.b;
    fixed.set(k, cur);
  }

  // ② 슬라이딩 60초 — 윈도우 시작을 각 이벤트 초로 잡고 two-pointer 로 훑는다.
  //    분별 최대(그 분에 시작하는 윈도우 중 최대)와 전체 피크를 함께 모은다.
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

    // 다음 시작점으로 넘어가기 전에 좌측 끝(i) 을 뺀다
    sumA -= seconds[i].a;
    sumB -= seconds[i].b;
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
  // 임의로 넓은 범위가 와도 분 격자가 폭발하지 않도록 클램프 (뒤쪽 = 최신 유지)
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

    // STAT_CD/ERR_CTN 컬럼 존재 확인 (GAIA ALTER 전에도 죽지 않도록 — tokens.ts 와 동일)
    let hasStatus = true;
    try {
      await conn.execute("SELECT STAT_CD, ERR_CTN FROM TRX_TOKEN_DET WHERE 1 = 0", {}, opts);
    } catch {
      hasStatus = false;
    }

    // ⚠️ failure 뷰는 STAT_CD/ERR_CTN 이 있어야 성립한다. 컬럼이 없는데 0 을 내려주면
    //    "타임아웃이 없다(=문제 없음)" 로 오독되므로 statusAvailable=false 로 구분해 알린다.
    if (view === "failure" && !hasStatus) return emptyStats(fromMs, toMs, false);

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

    // A/B 에 담을 식 — 이 두 줄이 usage 와 failure 의 유일한 차이다.
    const [exprA, exprB] =
      view === "failure"
        ? [
            `SUM(CASE WHEN ${SQL_ERR_PRED} AND ${SQL_TIMEOUT_PRED} THEN 1 ELSE 0 END)`,
            `SUM(CASE WHEN ${SQL_ERR_PRED} THEN 1 ELSE 0 END)`,
          ]
        : ["SUM(TOTAL_TOKENS)", "COUNT(*)"];

    // ① 초 단위 집계 — 값이 있던 초만 행이 나오므로 범위가 1시간이어도 ≤3600행.
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
    // ORDER BY 는 ISO 문자열 사전순 = 시간순이지만, 파싱 실패 행을 건너뛴 뒤에도
    // 오름차순이 보장되도록 한 번 더 정렬한다(rollupTick 의 전제).
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

    // ② 드릴다운용 호출 목록 — 피크 윈도우 안을 들여다보는 용도.
    //   상한을 넘으면 **최신 쪽**을 남긴다(모니터는 방금 난 일을 먼저 본다).
    //   ⚠️ failure 뷰에서는 실패 호출만 가져온다 — 성공까지 섞으면 목록이 상한에 걸려
    //      정작 봐야 할 실패 건이 밀려난다.
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
    // 화면은 시간 오름차순으로 읽는다 (DESC 로 잘라온 뒤 되돌린다)
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
      // ⚠️ usage 뷰에서는 내려보내지 않는다 — 이 값이 false 면 화면이 "실패 정보 미적재"
      //    경고를 띄우는데, 토큰 사용량 조회에는 STAT_CD 가 필요 없어 헛경고가 된다.
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
        /* noop */
      }
    }
  }
}
