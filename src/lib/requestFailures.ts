import { getAppDbConfig, APP_DB_LAYER, loadConfig } from "./config";
import {
  RequestFailure,
  FailureStatus,
  FailureStatusCounts,
  RequestFailureContextItem,
  FAILURE_STATUSES,
  LAYER_ORDER,
} from "./types";
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Improvement Center > Request Failure Tracker — 데이터 접근 계층.
//
// "실패 요청" = GAIA(= ACTION_TYP 권위 레이어이자 앱 자체 DB)에서 메시지는 받았는데
// ACTION_TYP 을 못 붙인 요청: ACTION_TYP IS NULL AND RECV_MSG_CTN IS NOT NULL.
// 보통 라우팅 실패이거나 LLM 오류로 튕긴 요청이다. 관리자가 /improvement 콘솔에서 훑고
// 조치 정보(TRX_REQ_FAILURE_INF)를 남긴다.
//
// GAIA 가 ACTION_TYP 권위 레이어이면서 앱 자체 DB 이기도 해서, 실패 요청 조회와 조치
// 정보 저장이 같은 DB·같은 커넥션 대상이다(getAppDbConfig). 두 쿼리(BIZ 실패행 / 조치행)는
// 격리 실행해 조치 테이블이 아직 없어도(ORA-00942) 리스트는 정상 노출된다.
//
// oracledb 는 next.config 의 serverComponentsExternalPackages 로 빠져 있어 lazy import.
// 드라이버가 없으면 에러를 삼키고 available=false 로 화면이 안내한다.
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
  limit?: number;
}

export interface RequestFailureListResult {
  items: RequestFailure[];
  counts: FailureStatusCounts;
  affectedUsers: number;
  available: boolean;
  reason?: string;
  triageAvailable: boolean;
}

// 실패 요청 원본(BIZ) — 조치 오버레이 없이 순수 실패행만.
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

/**
 * 사용자 I/F 레이어 = 요청 경로의 첫 레이어(CUBE).
 * 사용자는 이 레이어와만 대화하므로 **CUBE 의 SEND_MSG_CTN = 사용자가 던진 질문(Q),
 * RESP_MSG_CTN = 사용자가 받은 최종 응답(A)** 이다. 하위 레이어의 RESP 는 다운스트림
 * 툴 응답이라 A 가 아니다. 경로가 바뀌어도 LAYERS 배열만 고치면 따라온다.
 */
const USER_IF_LAYER = LAYER_ORDER[0];

/**
 * 숫자 파라미터를 [min,max] 로 클램프. `??` 만 쓰면 Number("abc") = NaN 이 그대로
 * 통과해 SQL 로 흘러가므로(예: NUMTODSINTERVAL(NaN,'HOUR')) 유한수 검사를 함께 한다.
 */
function clampNum(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.max(min, Math.min(n, max));
}

// 오라클 에러를 화면에 한 줄로 보여주기 위한 축약 (ORA-xxxxx: … 첫 줄만).
function oraMsg(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.split("\n")[0].trim() || "알 수 없는 오류";
}

/**
 * 실패 요청 목록 조회 + 조치 정보 병합.
 * DB 를 못 쓰는 상황은 throw 대신 available=false 로 내려 화면에서 안내한다.
 */
export async function fetchRequestFailures(q: RequestFailureQuery): Promise<RequestFailureListResult> {
  const empty: RequestFailureListResult = {
    items: [],
    counts: { open: 0, investigating: 0, resolved: 0, ignored: 0 },
    affectedUsers: 0,
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
  const binds: Record<string, unknown> = { limit };
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

  // 정의 그대로: 메시지는 받았으나 ACTION_TYP 을 못 붙인 요청, TIMEKEY 최신순.
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

    const res = await conn.execute(sql, binds, { outFormat: oracle.OBJECT });
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

    // 조치 정보를 같은 커넥션에서 격리 조회 — 테이블 미생성이면 이 블록만 실패하고 리스트는 유지.
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
      // 실패 요청 자체가 0건이어도 저장 가능 여부는 알려야 하므로 존재 확인만 시도.
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

    const counts: FailureStatusCounts = { open: 0, investigating: 0, resolved: 0, ignored: 0 };
    const users = new Set<string>();
    for (const it of items) {
      counts[it.status] += 1;
      if (it.userId) users.add(it.userId);
    }

    logger.info("fetchRequestFailures ok", { items: items.length, triageAvailable, ms: Date.now() - t0 });
    return { items, counts, affectedUsers: users.size, available: true, triageAvailable };
  } catch (e) {
    logger.error("fetchRequestFailures failed", { ms: Date.now() - t0, err: String(e) });
    return { ...empty, reason: String(e) };
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * 조치 정보 저장 (upsert). 조회와 달리 저장 실패는 관리자가 반드시 알아야 하므로 throw 한다.
 * ⚠️ handler(담당자)는 지금은 화면 입력값 — 로그인 도입 시 로그인 계정으로 자동 채운다
 * (memory: auth-login-future-need).
 */
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
    // UPD_DT 를 되읽어 화면 갱신에 쓸 시각을 정확히 돌려준다.
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

/**
 * 사용자 관점 Q/A 를 CUBE(= USER_IF_LAYER) 에서 붙인다.
 *   Q = SEND_MSG_CTN (가장 이른 non-null), A = RESP_MSG_CTN (가장 늦은 non-null)
 * CUBE 는 앱 자체 DB(GAIA)와 **다른 DB** 라 커넥션을 따로 연다 — monthlyActionSuccess
 * 가 쓰는 CUBE+GAIA 크로스 조회와 같은 방식(조회 후 TRACE_ID 로 JS 조인).
 * 실패하면 조용히 넘긴다: Q 는 TRX_TOKEN_DET 폴백이 있고 A 는 비면 화면이 안내한다.
 */
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
      // KEEP DENSE_RANK: NVL2 로 non-null 을 먼저(Q) / 나중(A) 로 몰아 시각 순으로 고른다.
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

/**
 * 특정 실패 요청 주변의 "사용자 요청 흐름".
 * 중심 요청의 USER_ID·수신시각을 찾고, 같은 사용자가 그 앞뒤(±windowHours)로 낸 요청들을
 * GAIA(BIZ)에서 TRACE_ID 단위로 묶어 시간순으로 돌려준다. 라우팅 실패(ACTION_TYP 없음)한
 * 요청은 isFailure 로 표시 — 관리자가 "무엇을 시도하다 어디서 튕겼나" 흐름을 읽게 한다.
 */
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

    // 1) 중심 요청의 사용자·수신시각
    //    쿼리별로 격리 실행해(fetchTokenStats 의 run() 과 같은 이유) 어느 단계가
    //    왜 죽었는지 reason 으로 올려보낸다 — 빈 흐름과 조회 실패는 다른 사건이다.
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
      // 조회는 됐지만 기준값이 없어 흐름을 만들 수 없는 경우 — 사유를 구분해 올린다.
      const reason = !cRow
        ? "이 TRACE_ID 로 수신(RECV) 행을 찾지 못했습니다."
        : !userId
          ? `이 요청에 USER_ID 가 없어 같은 사용자를 특정할 수 없습니다 (${APP_DB_LAYER} 행).`
          : `이 요청에 RECV_TM(수신시각) 이 없어 앞뒤 기간을 잡을 수 없습니다 (${APP_DB_LAYER} 행).`;
      logger.warn("fetchRequestFailureContext: no anchor", { traceId, userId, centerTm, reason });
      return { userId, items: [], available: true, reason };
    }

    // 2) 같은 사용자의 ±windowHours 요청 흐름 (TRACE_ID 단위로 묶음)
    let rawRows: Record<string, unknown>[];
    try {
      // ⚠️ 집계는 인라인 뷰 안에서 끝내고 ORDER BY / FETCH FIRST 는 바깥에서 건다.
      //    Oracle 은 FETCH FIRST 를 ROW_NUMBER() OVER (ORDER BY …) 로 재작성하므로
      //    `ORDER BY MIN(RECV_TM)` 처럼 정렬식이 집계함수면 분석함수 안에 집계가
      //    중첩돼 ORA-00935(group function is nested too deeply) 가 난다.
      //    RECV_TM 은 'YYYY-MM-DDTHH24:MI:SS.FF3' 고정폭 ISO 문자열이라 문자열
      //    정렬 = 시간 정렬이다.
      //    앞뒤 기간·행수는 INTERVAL 리터럴 대신 NUMTODSINTERVAL 로 바인드한다
      //    (INTERVAL 'n' HOUR 는 리터럴만 받아 바인드가 불가). 행수도 :limit 바인드.
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

    // 3) 질의 폴백 — CUBE 를 못 읽을 때만 쓰는 LLM 프롬프트(QUERY_CTN).
    //    TRX_TOKEN_DET 도 앱 자체 DB(GAIA)라 같은 커넥션에서 배치로 붙인다.
    //    tokens.ts 의 '원본 질의' 집계와 같은 규칙(non-null 우선 → 첫 호출).
    //    테이블 미생성/미적재여도 흐름은 그대로 보여야 하므로 격리 실행한다.
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

    // 4) 사용자 관점 Q/A — CUBE(사용자 I/F) 의 SEND/RESP. 권위값이라 3) 의 폴백을 덮는다.
    await attachUserFacingQa(oracle, items);

    logger.info("fetchRequestFailureContext ok", { traceId, userId, centerTm, items: items.length, windowHours });
    return { userId, items, available: true };
  } catch (e) {
    // 커넥션 획득/종료 등 쿼리 밖 실패 — 사유를 그대로 올려 화면에서 구분되게 한다.
    logger.error("fetchRequestFailureContext failed", { traceId, err: String(e) });
    return { userId: null, items: [], available: false, reason: oraMsg(e) };
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}
