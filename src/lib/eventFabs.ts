import { getEventFabDbConfig, EVENT_FAB_DB_LAYER } from "./config";
import { EventFabMapping } from "./types";
import { logger } from "./logger";

// 이벤트(액션)별 허용 FAB 매핑 — MCP DB(config.ts EVENT_FAB_DB_LAYER)의 TRX_EVENT_MAP.
// MCP 가 "요청한 FAB 이 이 이벤트에 허용된 FAB 인가" 를 판정하는 기준 데이터를
// 이 앱(/event-fabs 화면 → GET/PUT /api/event-fabs)에서 편집한다.
// 앱이 이 테이블의 마스터라서 저장은 전량 교체(DELETE 후 INSERT, 한 트랜잭션)다.

// oracledb 는 next.config 의 serverComponentsExternalPackages 로 빠져 있어 lazy import.
// 네이티브 드라이버가 없으면 에러를 삼키고 null (읽기는 available=false 로 안내).
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

export interface EventFabReadResult {
  /** MCP DB 사용 가능 여부. false 면 편집 화면이 저장을 막고 reason 을 안내한다 */
  available: boolean;
  mappings: EventFabMapping[];
  /** available=false 사유 (미구성/드라이버 없음/쿼리 실패 — ORA-00942 = 테이블 미생성) */
  reason?: string;
}

/**
 * 저장 전 정규화·검증. 편집 화면의 느슨한 입력을 DB 에 넣을 형태로 다듬고,
 * 잘못된 입력은 한국어 메시지로 throw 해 그대로 화면에 노출한다.
 *  - 완전 빈 행(이벤트도 FAB 도 없음)은 조용히 무시
 *  - FAB 0개 행은 에러: 전량 교체 저장에선 "행 없음 = 미등록(전 FAB 허용 정책)" 과
 *    구분이 안 되므로, 의도가 삭제라면 행을 지우게 강제한다
 */
function normalizeMappings(input: EventFabMapping[]): EventFabMapping[] {
  const out: EventFabMapping[] = [];
  const seen = new Set<string>();
  for (const m of input) {
    const eventId = (m?.eventId ?? "").trim();
    const fabs = Array.from(
      new Set((m?.fabs ?? []).map((f) => String(f).trim().toUpperCase()).filter(Boolean))
    );
    if (eventId === "" && fabs.length === 0) continue;
    if (eventId === "") throw new Error("이벤트(EVENT_ID)가 비어 있는 행이 있습니다.");
    if (fabs.length === 0)
      throw new Error(`'${eventId}': 허용 FAB 을 1개 이상 선택하세요. (매핑을 없애려면 행을 삭제)`);
    if (seen.has(eventId)) throw new Error(`이벤트 '${eventId}' 가 중복 입력되었습니다.`);
    seen.add(eventId);
    out.push({ eventId, fabs });
  }
  return out;
}

/** 매핑 전체 조회. DB 를 못 쓰는 상황은 throw 대신 available=false 로 내려 화면에서 안내. */
export async function fetchEventFabMappings(): Promise<EventFabReadResult> {
  const cfg = getEventFabDbConfig();
  if (!cfg) {
    return {
      available: false,
      mappings: [],
      reason: `${EVENT_FAB_DB_LAYER} DB 미구성 (config.yml 의 layers.${EVENT_FAB_DB_LAYER})`,
    };
  }
  const oracle = await getOracle();
  if (!oracle) {
    return { available: false, mappings: [], reason: "oracledb 드라이버를 사용할 수 없습니다." };
  }

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  try {
    conn = await oracle.getConnection(cfg);
    const result = await conn.execute(
      `SELECT EVENT_ID, FAB_ID
         FROM TRX_EVENT_MAP
        WHERE USE_YN = 'Y'
        ORDER BY EVENT_ID, FAB_ID`,
      {},
      { outFormat: oracle.OBJECT }
    );
    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    const byEvent = new Map<string, string[]>();
    for (const r of rows) {
      const eventId = ((r["EVENT_ID"] ?? r["event_id"]) as string | null)?.trim();
      const fabId = ((r["FAB_ID"] ?? r["fab_id"]) as string | null)?.trim();
      if (!eventId || !fabId) continue;
      const list = byEvent.get(eventId) ?? [];
      if (!list.includes(fabId)) list.push(fabId);
      byEvent.set(eventId, list);
    }
    const mappings = Array.from(byEvent, ([eventId, fabs]) => ({ eventId, fabs }));
    return { available: true, mappings };
  } catch (e) {
    logger.error("fetchEventFabMappings failed", { err: String(e) });
    return { available: false, mappings: [], reason: String(e) };
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * 매핑 전체 저장 — 전량 교체(DELETE 후 INSERT)를 한 트랜잭션으로.
 * 조회와 달리 저장 실패는 관리자가 반드시 알아야 하므로 삼키지 않고 throw 한다.
 * 반환값은 정규화된 매핑 (화면이 저장 직후 상태를 이것으로 갱신).
 */
export async function saveEventFabMappings(input: EventFabMapping[]): Promise<EventFabMapping[]> {
  const mappings = normalizeMappings(input);

  const cfg = getEventFabDbConfig();
  if (!cfg) {
    throw new Error(`${EVENT_FAB_DB_LAYER} DB 미구성 — config.yml 의 layers.${EVENT_FAB_DB_LAYER} 를 확인하세요.`);
  }
  const oracle = await getOracle();
  if (!oracle) throw new Error("oracledb 드라이버를 사용할 수 없습니다.");

  let conn: Awaited<ReturnType<typeof oracle.getConnection>> | undefined;
  try {
    conn = await oracle.getConnection(cfg);
    await conn.execute(`DELETE FROM TRX_EVENT_MAP`, {}, { autoCommit: false });
    const rows = mappings.flatMap((m) => m.fabs.map((f) => ({ eventId: m.eventId, fabId: f })));
    if (rows.length > 0) {
      await conn.executeMany(
        `INSERT INTO TRX_EVENT_MAP (EVENT_ID, FAB_ID, USE_YN) VALUES (:eventId, :fabId, 'Y')`,
        rows,
        {
          autoCommit: false,
          bindDefs: {
            eventId: { type: oracle.STRING, maxSize: 50 },
            fabId: { type: oracle.STRING, maxSize: 20 },
          },
        }
      );
    }
    await conn.commit();
    logger.info("saveEventFabMappings ok", { events: mappings.length, rows: rows.length });
    return mappings;
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch { /* ignore */ }
    }
    logger.error("saveEventFabMappings failed", { err: String(e) });
    throw e;
  } finally {
    if (conn) {
      try { await conn.close(); } catch { /* ignore */ }
    }
  }
}
