// 요청 여러 건을 현장 작업 1건으로 묶는 추론. docs/architecture/temp-workarounds.md

/**
 * [TEMP][WORK_GROUP] 액션 요청 여러 건을 "현장 작업 1건" 으로 묶는 추론.
 *
 * 묶는 규칙:
 *   챔버를 못 읽으면                                        → 단독(1건짜리 묶음)
 *   같은 챔버 + 윈도우(기본 8h) 안 + 흐름의 뒤 단계로 진행   → 붙인다
 *   그 외                                                   → 새 묶음
 *
 * 윈도우는 마지막 요청 시각 기준으로 갱신된다. 흐름은 전값 → 후값 → ERMAP(FLOW_ORDER)
 * 고정이고 뒤로만 갈 수 있다 — 되돌아가거나 같은 단계를 반복하면 새 묶음을 연다
 * (건너뛰기는 허용). 덕분에 "종료 액션" 을 따로 지정할 필요가 없다.
 * 묶음 ID 는 그 묶음의 첫 TRACE_ID 라 같은 입력이면 항상 같은 값이다.
 *
 * 챔버 값은 SEND_MSG_CTN 에서 읽으므로 MCP 까지 못 간 요청은 묶음 밖에 단독으로 남는다(의도).
 *
 * GAIA 가 TXN_ID 를 갖게 되면 이 추론부만 교체한다.
 * docs/architecture/temp-workarounds.md
 */

import { TraceStatus } from "./types";

export const WORK_WINDOW_HOURS = 8;

const CHAMBER_FIELD: Record<string, string> = {
  AutoQual_PrePost: "CHAMB_RAW_ID",
  ERMAP: "EQP_ID",
};

const VARIANT_FIELD: Record<string, string> = {
  AutoQual_PrePost: "ACT_SEQ",
};

const FLOW_ORDER = [
  "AutoQual_PrePost/PRE",   // 전값 측정
  "AutoQual_PrePost/POST",  // 후값 측정
  "ERMAP",                  // ERMAP 요청 (DSP 발) — 흐름의 마지막
];

export interface WorkSourceRow {
  traceId: string;
  actionTyp: string | null;
  recvTm: string | null;
  sendMsgCtn: string | null;
}

export interface TraceWorkInfo {
  workId: string;
  chamberId: string | null;
  actionLabel: string | null;
}

interface Entry {
  traceId: string;
  ms: number | null;
  chamber: string | null;
  step: number;
  label: string | null;
}

export function toMs(ts: string | null): number | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? null : t;
}

export function shiftLocalIso(ts: string, hours: number): string {
  const d = new Date(new Date(ts).getTime() + hours * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

function parsePayload(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readField(
  payload: Record<string, unknown> | null,
  text: string | null,
  field: string
): string | null {
  if (payload) {
    const v = payload[field];
    if (v === null || v === undefined) return null;
    return String(v).trim() || null;
  }
  if (!text) return null;
  const m = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`).exec(text);
  return m?.[1]?.trim() || null;
}

function toEntry(r: WorkSourceRow): Entry {
  const action = (r.actionTyp ?? "").trim();
  const payload = parsePayload(r.sendMsgCtn);
  const chamberField = CHAMBER_FIELD[action];
  const variantField = VARIANT_FIELD[action];
  const chamber = chamberField ? readField(payload, r.sendMsgCtn, chamberField) : null;
  const variant = variantField ? readField(payload, r.sendMsgCtn, variantField) : null;
  const v = variant ? variant.toUpperCase() : null;
  const stepKey = v ? `${action}/${v}` : action;
  return {
    traceId: r.traceId,
    ms: toMs(r.recvTm),
    chamber: chamber ? chamber.toUpperCase() : null,
    step: FLOW_ORDER.indexOf(stepKey),
    label: v ?? (action || null),
  };
}

export function groupTracesIntoWorks(
  rows: WorkSourceRow[],
  windowHours: number = WORK_WINDOW_HOURS
): Map<string, TraceWorkInfo> {
  const windowMs = Math.max(1, windowHours) * 3600_000;

  const order: Entry[] = [];
  const byTrace = new Map<string, Entry>();
  const sorted = [...rows].sort((a, b) => (a.recvTm ?? "").localeCompare(b.recvTm ?? ""));
  for (const r of sorted) {
    if (!r.traceId) continue;
    const e = toEntry(r);
    const prev = byTrace.get(e.traceId);
    if (!prev) {
      byTrace.set(e.traceId, e);
      order.push(e);
      continue;
    }
    if (!prev.chamber && e.chamber) {
      prev.chamber = e.chamber;
      prev.step = e.step;
      prev.label = e.label;
    }
  }

  const open = new Map<string, { workId: string; lastMs: number; lastStep: number }>();
  const out = new Map<string, TraceWorkInfo>();

  for (const e of order) {
    if (!e.chamber || e.ms === null || e.step < 0) {
      out.set(e.traceId, { workId: e.traceId, chamberId: e.chamber, actionLabel: e.label });
      continue;
    }
    const cur = open.get(e.chamber);
    const fits = !!cur && e.ms - cur.lastMs <= windowMs && e.step > cur.lastStep;
    const group = fits ? cur! : { workId: e.traceId, lastMs: e.ms, lastStep: e.step };
    if (!fits) open.set(e.chamber, group);
    group.lastMs = e.ms;
    group.lastStep = e.step;
    out.set(e.traceId, { workId: group.workId, chamberId: e.chamber, actionLabel: e.label });
  }

  return out;
}

const STATUS_RANK: Record<TraceStatus, number> = { error: 3, fail: 2, pending: 1, ok: 0 };

export function rollupStatus(statuses: TraceStatus[]): TraceStatus {
  let worst: TraceStatus = "ok";
  for (const s of statuses) {
    if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
  }
  return worst;
}
