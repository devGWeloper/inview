// 이벤트-FAB 매핑. MCP 가 판정 시 직접 읽어야 해서 앱 자체 DB 가 아니라 MCP DB 에 있다.
// 저장은 전량 교체(앱이 이 테이블의 마스터). docs/screens/event-fabs.md

import { getEventFabDbConfig, EVENT_FAB_DB_LAYER } from "./config";
import { EventFabMapping } from "./types";
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

export interface EventFabReadResult {
  available: boolean;
  mappings: EventFabMapping[];
  reason?: string;
}

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
