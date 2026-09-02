// 실패 요청(ACTION_TYP 미부여) 조회 + 조치정보. 사용자 관점 Q/A 는 CUBE 행에서만 찾는다
// — 단 '사용자가 실제로 본 응답 문장' 을 담는 컬럼은 없어 A 는 best-effort 다.
// docs/screens/improvement.md

import { getAppDbConfig, APP_DB_LAYER, loadConfig } from "./config";
import {
  RequestFailure,
  FailureStatus,
  FailureStatusCounts,
  RequestFailureContextItem,
  ErrCodeCount,
  FAILURE_STATUSES,
  NO_ERR_CD,
  LAYER_ORDER,
} from "./types";
import { logger } from "./logger";

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

const VALID_STATUSES = new Set<string>(FAILURE_STATUSES.map((x) => x.key));
const DEFAULT_STATUS: FailureStatus = "open";

function normalizeStatus(v: unknown): FailureStatus {
  const t = typeof v === "string" ? v.trim() : "";
  return VALID_STATUSES.has(t) ? (t as FailureStatus) : DEFAULT_STATUS;
}

export interface RequestFailureQuery {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  errCd?: string;
  /** 이 에러코드들은 목록에서 제외한다. ERR_CD 가 NULL 인 요청은 NO_ERR_CD 로 지정 */
  excludeErrCds?: string[];
  limit?: number;
}

export interface RequestFailureListResult {
  items: RequestFailure[];
  counts: FailureStatusCounts;
  affectedUsers: number;
  errCodes: ErrCodeCount[];
  available: boolean;
  reason?: string;
  triageAvailable: boolean;
}

interface RawFailure {
  traceId: string;
  timekey: string;
  userId: string | null;
  recvTm: string | null;
  recvMsgCtn: string | null;
  respMsgCtn: string | null;
  errCd: string | null;
  errDescCtn: string | null;
  httpStsCd: string | null;
  channelId: string | null;
  sysId: string | null;
}

const s = (r: Record<string, unknown>, k: string): string | null =>
  (r[k] ?? r[k.toLowerCase()] ?? null) as string | null;

const USER_IF_LAYER = LAYER_ORDER[0];

function clampNum(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.max(min, Math.min(n, max));
}

function normalizeExcluded(v: string[] | undefined): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const raw of v) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (t) out.add(t);
  }
  return [...out].slice(0, 50);
}

function oraMsg(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.split("\n")[0].trim() || "알 수 없는 오류";
}

export async function fetchRequestFailures(q: RequestFailureQuery): Promise<RequestFailureListResult> {
  const empty: RequestFailureListResult = {
    items: [],
    counts: { open: 0, investigating: 0, resolved: 0, ignored: 0 },
    affectedUsers: 0,
    errCodes: [],
    available: false,
    triageAvailable: false,
  };

  const cfg = getAppDbConfig();
  if (!cfg) {
    return { ...empty, reason: `${APP_DB_LAYER} DB 미구성 (config.yml 의 layers.${APP_DB_LAYER})` };
  }
  const oracle = await getOracle();
  if (!oracle) {
    return { ...empty, reason: "oracledb 드라이버를 사용할 수 없습니다." };
  }

  const limit = clampNum(q.limit, 300, 1, 1000);
  const where: string[] = ["ACTION_TYP IS NULL", "RECV_MSG_CTN IS NOT NULL"];
  const binds: Record<string, unknown> = {};
  if (q.dateFrom) {
    where.push("RECV_TM >= TO_TIMESTAMP(:dateFrom, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
    binds.dateFrom = q.dateFrom;
  }
  if (q.dateTo) {
    where.push("RECV_TM <= TO_TIMESTAMP(:dateTo, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
    binds.dateTo = q.dateTo;
  }
  if (q.userId) {
    where.push("USER_ID = :userId");
    binds.userId = q.userId;
  }
  if (q.errCd) {
    where.push("UPPER(ERR_CD) LIKE '%' || UPPER(:errCd) || '%'");
    binds.errCd = q.errCd;
  }

  // 코드 분포는 제외 필터를 걸기 전 WHERE 로 센다 — 가려둔 코드도 화면에서 되살릴 수 있어야 한다
  const codeSql = `
    SELECT NVL(ERR_CD, :noneCd) AS CODE, COUNT(*) AS CNT
      FROM BIZ_AIACTIONTXN_HIS
     WHERE ${where.join(" AND ")}
     GROUP BY NVL(ERR_CD, :noneCd)
     ORDER BY CNT DESC`;
  const codeBinds = { ...binds, noneCd: NO_ERR_CD };

  const listBinds: Record<string, unknown> = { ...binds, limit };
  const excluded = normalizeExcluded(q.excludeErrCds);
  if (excluded.length > 0) {
    const ph = excluded.map((cd, i) => {
      listBinds[`x${i}`] = cd;
      return `:x${i}`;
    });
    listBinds.noneCd = NO_ERR_CD;
    where.push(`NVL(ERR_CD, :noneCd) NOT IN (${ph.join(", ")})`);
  }

  const sql = `
    SELECT TRACE_ID, TIMEKEY, USER_ID, SYS_ID, CHANNEL_ID,
           RECV_MSG_CTN, RESP_MSG_CTN, HTTP_STS_CD, ERR_CD, ERR_DESC_CTN,
           TO_CHAR(RECV_TM, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RECV_TM
      FROM BIZ_AIACTIONTXN_HIS
     WHERE ${where.join(" AND ")}
     ORDER BY TIMEKEY DESC
     FETCH FIRST :limit ROWS ONLY`;

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  const t0 = Date.now();
  try {
    conn = await oracle.getConnection(cfg);

    const res = await conn.execute(sql, listBinds, { outFormat: oracle.OBJECT });
    const raws: RawFailure[] = ((res.rows ?? []) as Record<string, unknown>[]).map((r) => ({
      traceId: String(s(r, "TRACE_ID") ?? ""),
      timekey: String(s(r, "TIMEKEY") ?? ""),
      userId: s(r, "USER_ID"),
      sysId: s(r, "SYS_ID"),
      channelId: s(r, "CHANNEL_ID"),
      recvMsgCtn: s(r, "RECV_MSG_CTN"),
      respMsgCtn: s(r, "RESP_MSG_CTN"),
      httpStsCd: s(r, "HTTP_STS_CD"),
      errCd: s(r, "ERR_CD"),
      errDescCtn: s(r, "ERR_DESC_CTN"),
      recvTm: s(r, "RECV_TM"),
    }));

    const triageMap = new Map<
      string,
      { status: FailureStatus; note: string | null; handler: string | null; triagedAt: string | null }
    >();
    let triageAvailable = false;
    if (raws.length > 0) {
      try {
        const tr = await conn.execute(
          `SELECT TRACE_ID, STATUS, NOTE_CTN, HANDLER_ID,
                  TO_CHAR(UPD_DT, 'YYYY-MM-DD"T"HH24:MI:SS') AS UPD_DT
             FROM TRX_REQ_FAILURE_INF`,
          {},
          { outFormat: oracle.OBJECT }
        );
        for (const r of (tr.rows ?? []) as Record<string, unknown>[]) {
          const id = s(r, "TRACE_ID");
          if (!id) continue;
          triageMap.set(id, {
            status: normalizeStatus(s(r, "STATUS")),
            note: s(r, "NOTE_CTN"),
            handler: s(r, "HANDLER_ID"),
            triagedAt: s(r, "UPD_DT"),
          });
        }
        triageAvailable = true;
      } catch (e) {
        logger.warn("fetchRequestFailures: TRX_REQ_FAILURE_INF unavailable — 전부 미조치로 표시", { err: String(e) });
      }
    } else {
      try {
        await conn.execute(`SELECT 1 FROM TRX_REQ_FAILURE_INF FETCH FIRST 1 ROWS ONLY`, {}, { outFormat: oracle.OBJECT });
        triageAvailable = true;
      } catch {
        triageAvailable = false;
      }
    }

    const items: RequestFailure[] = raws.map((r) => {
      const t = triageMap.get(r.traceId);
      return {
        ...r,
        status: t?.status ?? DEFAULT_STATUS,
        note: t?.note ?? null,
        handler: t?.handler ?? null,
        triagedAt: t?.triagedAt ?? null,
      };
    });

    let errCodes: ErrCodeCount[] = [];
    try {
      const cr = await conn.execute(codeSql, codeBinds, { outFormat: oracle.OBJECT });
      errCodes = ((cr.rows ?? []) as Record<string, unknown>[])
        .map((r) => ({
          code: String(s(r, "CODE") ?? NO_ERR_CD),
          count: Number((r.CNT ?? r.cnt) ?? 0),
        }))
        .filter((c) => c.count > 0);
    } catch (e) {
      logger.warn("fetchRequestFailures: 에러코드 분포 조회 실패 — 조회된 목록으로 대체", { err: String(e) });
      const fallback = new Map<string, number>();
      for (const r of raws) fallback.set(r.errCd ?? NO_ERR_CD, (fallback.get(r.errCd ?? NO_ERR_CD) ?? 0) + 1);
      errCodes = [...fallback].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
    }

    const counts: FailureStatusCounts = { open: 0, investigating: 0, resolved: 0, ignored: 0 };
    const users = new Set<string>();
    for (const it of items) {
      counts[it.status] += 1;
      if (it.userId) users.add(it.userId);
    }

    logger.info("fetchRequestFailures ok", {
      items: items.length, triageAvailable, excluded: excluded.length, codes: errCodes.length, ms: Date.now() - t0,
    });
    return { items, counts, affectedUsers: users.size, errCodes, available: true, triageAvailable };
  } catch (e) {
    logger.error("fetchRequestFailures failed", { ms: Date.now() - t0, err: String(e) });
    return { ...empty, reason: String(e) };
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

export async function saveRequestFailureHandling(input: {
  traceId: string;
  status: FailureStatus;
  note?: string | null;
  handler?: string | null;
}): Promise<{ status: FailureStatus; note: string | null; handler: string | null; triagedAt: string | null }> {
  const traceId = (input.traceId ?? "").trim();
  if (!traceId) throw new Error("TRACE_ID 가 비어 있습니다.");
  if (!VALID_STATUSES.has(input.status)) throw new Error(`알 수 없는 조치 상태: ${input.status}`);
  const note = (input.note ?? "").trim() || null;
  const handler = (input.handler ?? "").trim() || null;

  const cfg = getAppDbConfig();
  if (!cfg) throw new Error(`${APP_DB_LAYER} DB 미구성 — config.yml 의 layers.${APP_DB_LAYER} 를 확인하세요.`);
  const oracle = await getOracle();
  if (!oracle) throw new Error("oracledb 드라이버를 사용할 수 없습니다.");

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  try {
    conn = await oracle.getConnection(cfg);
    await conn.execute(
      `MERGE INTO TRX_REQ_FAILURE_INF t
       USING (SELECT :traceId AS TRACE_ID FROM dual) src
          ON (t.TRACE_ID = src.TRACE_ID)
        WHEN MATCHED THEN
          UPDATE SET STATUS = :status, NOTE_CTN = :note, HANDLER_ID = :handler, UPD_DT = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
          INSERT (TRACE_ID, STATUS, NOTE_CTN, HANDLER_ID, REG_DT, UPD_DT)
          VALUES (:traceId, :status, :note, :handler, SYSTIMESTAMP, SYSTIMESTAMP)`,
      { traceId, status: input.status, note, handler },
      { autoCommit: true }
    );
    const back = await conn.execute(
      `SELECT TO_CHAR(UPD_DT, 'YYYY-MM-DD"T"HH24:MI:SS') AS UPD_DT FROM TRX_REQ_FAILURE_INF WHERE TRACE_ID = :traceId`,
      { traceId },
      { outFormat: oracle.OBJECT }
    );
    const row = (back.rows ?? [])[0] as Record<string, unknown> | undefined;
    const triagedAt = row ? s(row, "UPD_DT") : null;
    logger.info("saveRequestFailureHandling ok", { traceId, status: input.status });
    return { status: input.status, note, handler, triagedAt };
  } catch (e) {
    logger.error("saveRequestFailureHandling failed", { traceId, err: String(e) });
    throw e;
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

async function attachUserFacingQa(
  oracle: typeof import("oracledb"),
  items: RequestFailureContextItem[]
): Promise<void> {
  const ids = items.map((i) => i.traceId).filter(Boolean);
  if (ids.length === 0) return;

  const cfg = loadConfig().layers[USER_IF_LAYER] ?? null;
  if (!cfg) {
    logger.warn("attachUserFacingQa: 사용자 I/F 레이어 DB 미구성 — Q/A 없이 표시", { layer: USER_IF_LAYER });
    return;
  }

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  try {
    conn = await oracle.getConnection(cfg);
    const binds: Record<string, unknown> = {};
    const placeholders = ids
      .map((id, i) => {
        binds[`t${i}`] = id;
        return `:t${i}`;
      })
      .join(", ");
    const res = await conn.execute(
      `SELECT TRACE_ID,
              MAX(SEND_MSG_CTN) KEEP (DENSE_RANK FIRST ORDER BY NVL2(SEND_MSG_CTN, 0, 1), SEND_TM) AS QCTN,
              MAX(RESP_MSG_CTN) KEEP (DENSE_RANK LAST  ORDER BY NVL2(RESP_MSG_CTN, 1, 0), RESP_TM) AS ACTN
         FROM BIZ_AIACTIONTXN_HIS
        WHERE TRACE_ID IN (${placeholders})
        GROUP BY TRACE_ID`,
      binds,
      { outFormat: oracle.OBJECT }
    );
    const map = new Map<string, { q: string | null; a: string | null }>();
    for (const r of (res.rows ?? []) as Record<string, unknown>[]) {
      const id = s(r, "TRACE_ID");
      if (id) map.set(id, { q: s(r, "QCTN"), a: s(r, "ACTN") });
    }
    let withA = 0;
    for (const it of items) {
      const hit = map.get(it.traceId);
      if (!hit) continue;
      if (hit.q) it.queryCtn = hit.q; // CUBE SEND 가 권위 — 폴백을 덮는다
      if (hit.a) {
        it.answerCtn = hit.a;
        withA += 1;
      }
    }
    logger.info("attachUserFacingQa ok", { layer: USER_IF_LAYER, traces: map.size, withAnswer: withA });
  } catch (e) {
    logger.warn("attachUserFacingQa failed — Q/A 없이 표시", { layer: USER_IF_LAYER, err: String(e) });
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

export async function fetchRequestFailureContext(
  traceId: string,
  opts?: { windowHours?: number; limit?: number }
): Promise<{
  userId: string | null;
  items: RequestFailureContextItem[];
  available: boolean;
  reason?: string;
}> {
  const cfg = getAppDbConfig();
  if (!cfg) {
    return {
      userId: null,
      items: [],
      available: false,
      reason: `${APP_DB_LAYER} DB 미구성 (config.yml 의 layers.${APP_DB_LAYER})`,
    };
  }
  const oracle = await getOracle();
  if (!oracle) {
    return { userId: null, items: [], available: false, reason: "oracledb 드라이버를 사용할 수 없습니다." };
  }

  const windowHours = clampNum(opts?.windowHours, 12, 1, 72);
  const limit = clampNum(opts?.limit, 80, 1, 300);

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  try {
    conn = await oracle.getConnection(cfg);

    let cRow: Record<string, unknown> | undefined;
    try {
      const center = await conn.execute(
        `SELECT USER_ID, TO_CHAR(MIN(RECV_TM), 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RECV_TM
           FROM BIZ_AIACTIONTXN_HIS
          WHERE TRACE_ID = :traceId AND RECV_MSG_CTN IS NOT NULL
          GROUP BY USER_ID`,
        { traceId },
        { outFormat: oracle.OBJECT }
      );
      cRow = (center.rows ?? [])[0] as Record<string, unknown> | undefined;
    } catch (e) {
      logger.error("fetchRequestFailureContext [center] query failed", { traceId, err: String(e) });
      return { userId: null, items: [], available: false, reason: `중심 요청 조회 실패 — ${oraMsg(e)}` };
    }

    const userId = cRow ? s(cRow, "USER_ID") : null;
    const centerTm = cRow ? s(cRow, "RECV_TM") : null;

    if (!userId || !centerTm) {
      const reason = !cRow
        ? "이 TRACE_ID 로 수신(RECV) 행을 찾지 못했습니다."
        : !userId
          ? `이 요청에 USER_ID 가 없어 같은 사용자를 특정할 수 없습니다 (${APP_DB_LAYER} 행).`
          : `이 요청에 RECV_TM(수신시각) 이 없어 앞뒤 기간을 잡을 수 없습니다 (${APP_DB_LAYER} 행).`;
      logger.warn("fetchRequestFailureContext: no anchor", { traceId, userId, centerTm, reason });
      return { userId, items: [], available: true, reason };
    }

    let rawRows: Record<string, unknown>[];
    try {
      const rows = await conn.execute(
        `SELECT * FROM (
           SELECT TRACE_ID,
                  TO_CHAR(MIN(RECV_TM), 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS RECV_TM,
                  MAX(ACTION_TYP)   AS ACTION_TYP,
                  MAX(ERR_CD)       AS ERR_CD,
                  MAX(HTTP_STS_CD)  AS HTTP_STS_CD,
                  MAX(RECV_MSG_CTN) AS RECV_MSG_CTN,
                  MAX(RESP_MSG_CTN) AS RESP_MSG_CTN
             FROM BIZ_AIACTIONTXN_HIS
            WHERE USER_ID = :userId
              AND RECV_MSG_CTN IS NOT NULL
              AND RECV_TM BETWEEN TO_TIMESTAMP(:centerTm, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') - NUMTODSINTERVAL(:windowHours, 'HOUR')
                              AND TO_TIMESTAMP(:centerTm, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') + NUMTODSINTERVAL(:windowHours, 'HOUR')
            GROUP BY TRACE_ID
         )
         ORDER BY RECV_TM
         FETCH FIRST :limit ROWS ONLY`,
        { userId, centerTm, windowHours, limit },
        { outFormat: oracle.OBJECT }
      );
      rawRows = (rows.rows ?? []) as Record<string, unknown>[];
    } catch (e) {
      logger.error("fetchRequestFailureContext [flow] query failed", { traceId, userId, err: String(e) });
      return { userId, items: [], available: false, reason: `주변 요청 조회 실패 — ${oraMsg(e)}` };
    }

    const items: RequestFailureContextItem[] = rawRows.map((r) => {
      const id = String(s(r, "TRACE_ID") ?? "");
      const actionTyp = s(r, "ACTION_TYP");
      return {
        traceId: id,
        recvTm: s(r, "RECV_TM"),
        actionTyp,
        errCd: s(r, "ERR_CD"),
        httpStsCd: s(r, "HTTP_STS_CD"),
        recvMsgCtn: s(r, "RECV_MSG_CTN"),
        respMsgCtn: s(r, "RESP_MSG_CTN"),
        queryCtn: null,
        answerCtn: null,
        isFailure: !actionTyp,
        isCenter: id === traceId,
      };
    });

    const ids = items.map((i) => i.traceId).filter(Boolean);
    if (ids.length > 0) {
      try {
        const qBinds: Record<string, unknown> = {};
        const placeholders = ids
          .map((id, i) => {
            qBinds[`t${i}`] = id;
            return `:t${i}`;
          })
          .join(", ");
        const qres = await conn.execute(
          `SELECT TRACE_ID,
                  MIN(QUERY_CTN) KEEP (DENSE_RANK FIRST ORDER BY NVL2(QUERY_CTN, 0, 1), CALL_TM) AS QCTN
             FROM TRX_TOKEN_DET
            WHERE TRACE_ID IN (${placeholders})
            GROUP BY TRACE_ID`,
          qBinds,
          { outFormat: oracle.OBJECT }
        );
        const qmap = new Map<string, string>();
        for (const r of (qres.rows ?? []) as Record<string, unknown>[]) {
          const id = s(r, "TRACE_ID");
          const q = s(r, "QCTN");
          if (id && q) qmap.set(id, q);
        }
        for (const it of items) it.queryCtn = qmap.get(it.traceId) ?? null;
      } catch (e) {
        logger.warn("fetchRequestFailureContext [query] TRX_TOKEN_DET unavailable — 질의문 없이 표시", {
          traceId,
          err: String(e),
        });
      }
    }

    await attachUserFacingQa(oracle, items);

    logger.info("fetchRequestFailureContext ok", { traceId, userId, centerTm, items: items.length, windowHours });
    return { userId, items, available: true };
  } catch (e) {
    logger.error("fetchRequestFailureContext failed", { traceId, err: String(e) });
    return { userId: null, items: [], available: false, reason: oraMsg(e) };
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}
