import { fetchAllRows } from "./db";
import { getAppDbConfig } from "./config";
import { humanText } from "./humanText";
import { logger } from "./logger";
import { isFailedCall } from "./tokenStatus";
import {
  LAYER_ORDER,
  TIMEOUT_DEFAULT_ERR_CD,
  TimeoutBucket,
  TimeoutItem,
  TimeoutStatsResponse,
  TopItem,
  TraceRow,
} from "./types";
import {
  Granularity,
  enumerateBucketStarts,
  floorToBucket,
  isoNoTz,
  parseTs,
  pickGranularity,
} from "./timeBuckets";

// ─────────────────────────────────────────────────────────────────────────────
// 타임아웃 추적 집계.
//
// ⚠️ **기존 데이터만** 쓴다 — BIZ_AIACTIONTXN_HIS 의 ERR_CD (기본 'ERROR_LLM').
// GAIA 가 LLM 호출에서 타임아웃으로 튕기면 그 트레이스에 이 코드가 남고, 실무상 이게
// 대부분 타임아웃(외부 LLM 인프라 문제)이다. 기존 대시보드는 이걸 "에러 1건" 으로만
// 세어서 얼마나 심한지·어디서 나는지가 안 보였다.
//
// 노드/모델은 앱 자체 DB(TRX_TOKEN_DET)를 TRACE_ID 로 조인해 붙인다(선택).
// STAT_CD 가 적재돼 있으면 실패한 호출의 노드를 정확히 집고, 없으면 그 트레이스에서
// **마지막으로 기록된 호출**의 노드를 쓴다(= 타임아웃 직전 노드, nodeExact=false).
// ─────────────────────────────────────────────────────────────────────────────

const ITEM_LIMIT = 100; // 목록에 내릴 최근 타임아웃 건수
const TOP_LIMIT = 10;   // 분포 리스트 상위 N
const ID_CHUNK = 500;   // Oracle IN 절 바인드 청크

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
  /** 타임아웃으로 볼 ERR_CD (기본 ERROR_LLM) */
  errCd?: string;
}

const str = (v: unknown): string | null => (v == null ? null : String(v));

function topN(map: Map<string, number>, n: number): TopItem[] {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/** 트레이스의 대표 사용자 — 진입 레이어(CUBE) 우선 (stats route 의 traceUserId 와 같은 기준) */
function traceUserId(list: TraceRow[]): string | null {
  for (const layer of LAYER_ORDER) {
    for (const r of list) {
      if (r.layer !== layer) continue;
      const u = r.userId?.trim();
      if (u) return u;
    }
  }
  return null;
}

/** 트레이스 시작 시각 = 첫 recv (없으면 첫 send) */
function traceStart(list: TraceRow[]): number | null {
  let min: number | null = null;
  for (const r of list) {
    const ms = parseTs(r.recvTm) ?? parseTs(r.sendTm);
    if (ms != null && (min === null || ms < min)) min = ms;
  }
  return min;
}

/** 사용자 질문 — 진입 레이어(CUBE)의 SEND_MSG_CTN (CLAUDE.md "사용자 관점 Q/A 는 CUBE") */
function traceQuestion(list: TraceRow[]): string | null {
  const entry = LAYER_ORDER[0];
  for (const r of list) {
    if (r.layer !== entry) continue;
    const q = humanText(r.sendMsgCtn);
    if (q) return q;
  }
  // CUBE 미구성이면 아무 레이어의 recv 라도 (없는 것보다 낫다)
  for (const r of list) {
    const q = humanText(r.recvMsgCtn);
    if (q) return q;
  }
  return null;
}

/** 타임아웃 트레이스들의 노드/모델을 TRX_TOKEN_DET 에서 붙인다. 실패해도 무해(빈 맵). */
async function attachNodes(
  traceIds: string[]
): Promise<{ map: Map<string, { nodeNm: string | null; modelNm: string | null; exact: boolean }>; exact: boolean }> {
  const empty = { map: new Map<string, { nodeNm: string | null; modelNm: string | null; exact: boolean }>(), exact: false };
  if (traceIds.length === 0) return empty;
  const cfg = getAppDbConfig();
  if (!cfg) return empty;
  const oracle = await getOracle();
  if (!oracle) return empty;

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  try {
    conn = await oracle.getConnection(cfg);
    const opts = { outFormat: oracle.OBJECT } as const;

    // STAT_CD 가 있으면 "실패한 호출" 을 정확히 집을 수 있다. 없으면(ALTER 전) 마지막 호출로 추정.
    let hasStatus = true;
    try {
      await conn.execute("SELECT STAT_CD, ERR_CTN FROM TRX_TOKEN_DET WHERE 1 = 0", {}, opts);
    } catch {
      hasStatus = false;
    }
    const cols = hasStatus ? ", STAT_CD, ERR_CTN" : "";

    // traceId 별 호출들을 시간순으로 모은다 (IN 절은 500개씩 청크)
    const perTrace = new Map<string, Array<{ node: string | null; model: string | null; failed: boolean }>>();
    for (let i = 0; i < traceIds.length; i += ID_CHUNK) {
      const chunk = traceIds.slice(i, i + ID_CHUNK);
      const binds: Record<string, unknown> = {};
      const names = chunk.map((id, j) => {
        binds[`t${j}`] = id;
        return `:t${j}`;
      });
      const sql =
        `SELECT TRACE_ID, NODE_NM, MODEL_NM${cols} FROM TRX_TOKEN_DET` +
        ` WHERE TRACE_ID IN (${names.join(", ")}) ORDER BY CALL_TM`;
      const res = await conn.execute(sql, binds, opts);
      for (const r of ((res.rows ?? []) as Array<Record<string, unknown>>)) {
        const tid = String(r.TRACE_ID ?? r.trace_id ?? "");
        if (!tid) continue;
        const arr = perTrace.get(tid) ?? [];
        arr.push({
          node: str(r.NODE_NM ?? r.node_nm),
          model: str(r.MODEL_NM ?? r.model_nm),
          failed: hasStatus && isFailedCall(str(r.STAT_CD ?? r.stat_cd), str(r.ERR_CTN ?? r.err_ctn)),
        });
        perTrace.set(tid, arr);
      }
    }

    const map = empty.map;
    for (const [tid, calls] of perTrace) {
      const failed = calls.filter((c) => c.failed);
      const pick = failed.length > 0 ? failed[failed.length - 1] : calls[calls.length - 1];
      if (pick) map.set(tid, { nodeNm: pick.node, modelNm: pick.model, exact: failed.length > 0 });
    }
    logger.info("timeouts attachNodes ok", { traces: map.size, hasStatus });
    return { map, exact: hasStatus };
  } catch (e) {
    logger.warn("timeouts attachNodes failed — 노드/모델 없이 표시", { err: String(e) });
    return empty;
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

export async function fetchTimeoutStats(filter: TimeoutFilter): Promise<TimeoutStatsResponse> {
  const t0 = Date.now();
  const now = Date.now();
  const fromMs = filter.dateFrom ? Date.parse(filter.dateFrom) : now - 24 * 3_600_000;
  const toMs = filter.dateTo ? Date.parse(filter.dateTo) : now;
  const g: Granularity = pickGranularity(fromMs, toMs);
  const target = (filter.errCd || TIMEOUT_DEFAULT_ERR_CD).trim().toUpperCase();

  const emptyBuckets: TimeoutBucket[] = enumerateBucketStarts(fromMs, toMs, g).map((k) => ({
    ts: isoNoTz(k),
    count: 0,
  }));

  // 기간 내 전 레이어 행 (limit 없음 — 집계는 전부 봐야 한다. stats route 와 동일)
  const rows = await fetchAllRows({ dateFrom: filter.dateFrom, dateTo: filter.dateTo });

  const byTrace = new Map<string, TraceRow[]>();
  for (const r of rows) {
    const arr = byTrace.get(r.traceId) ?? [];
    arr.push(r);
    byTrace.set(r.traceId, arr);
  }

  const errCdMap = new Map<string, number>();   // 기간 내 전체 에러 코드 분포
  const actionMap = new Map<string, number>();
  const userMap = new Map<string, number>();
  const bucketMap = new Map<number, number>();
  const users = new Set<string>();
  const hits: Array<{ item: TimeoutItem; ms: number | null }> = [];

  for (const [traceId, list] of byTrace) {
    // 이 트레이스가 가진 에러 코드들 (중복 제거 — 여러 레이어가 같은 코드를 남길 수 있다)
    const codes = new Map<string, TraceRow>();
    for (const r of list) {
      const c = r.errCd?.trim();
      if (c) codes.set(c.toUpperCase(), r);
    }
    for (const c of codes.keys()) bump(errCdMap, c);

    const hitRow = codes.get(target);
    if (!hitRow) continue;

    const startMs = traceStart(list);
    const userId = traceUserId(list);
    const actionTyp = list.find((r) => r.actionTyp?.trim())?.actionTyp?.trim() ?? null;

    if (startMs != null) bucketMap.set(floorToBucket(startMs, g), (bucketMap.get(floorToBucket(startMs, g)) ?? 0) + 1);
    bump(actionMap, actionTyp ?? "(없음)");
    if (userId) {
      bump(userMap, userId);
      users.add(userId);
    }

    hits.push({
      ms: startMs,
      item: {
        traceId,
        tm: startMs != null ? isoNoTz(startMs) : null,
        userId,
        actionTyp,
        question: traceQuestion(list),
        errCd: hitRow.errCd,
        errDescCtn: hitRow.errDescCtn,
        errLayer: hitRow.layer,
        nodeNm: null,
        modelNm: null,
        nodeExact: false,
      },
    });
  }

  // 최근순 정렬 후 목록 상한
  hits.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0));
  const items = hits.slice(0, ITEM_LIMIT).map((h) => h.item);

  // 노드/모델은 타임아웃 트레이스 전체에 붙인다(분포가 목록 상한에 안 잘리게)
  const { map: nodeMap, exact } = await attachNodes(hits.map((h) => h.item.traceId));
  const nodeCnt = new Map<string, number>();
  const modelCnt = new Map<string, number>();
  for (const h of hits) {
    const n = nodeMap.get(h.item.traceId);
    if (!n) continue;
    bump(nodeCnt, n.nodeNm ?? "(없음)");
    bump(modelCnt, n.modelNm ?? "(없음)");
  }
  for (const it of items) {
    const n = nodeMap.get(it.traceId);
    if (n) {
      it.nodeNm = n.nodeNm;
      it.modelNm = n.modelNm;
      it.nodeExact = n.exact;
    }
  }

  const buckets = enumerateBucketStarts(fromMs, toMs, g).map((k) => ({
    ts: isoNoTz(k),
    count: bucketMap.get(k) ?? 0,
  }));

  const res: TimeoutStatsResponse = {
    range: { from: filter.dateFrom ?? null, to: filter.dateTo ?? null },
    granularity: g,
    errCd: target,
    totalTraces: byTrace.size,
    timeoutTraces: hits.length,
    affectedUsers: users.size,
    lastAt: items[0]?.tm ?? null,
    buckets: buckets.length > 0 ? buckets : emptyBuckets,
    byErrCd: topN(errCdMap, TOP_LIMIT),
    byAction: topN(actionMap, TOP_LIMIT),
    byNode: topN(nodeCnt, TOP_LIMIT),
    byModel: topN(modelCnt, TOP_LIMIT),
    byUser: topN(userMap, TOP_LIMIT),
    items,
    nodeLinked: nodeMap.size > 0,
    nodeExact: exact,
  };

  logger.info("fetchTimeoutStats ok", {
    errCd: target,
    traces: res.totalTraces,
    timeouts: res.timeoutTraces,
    ms: Date.now() - t0,
  });
  return res;
}
