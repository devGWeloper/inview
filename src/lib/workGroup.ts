/**
 * [TEMP][WORK_GROUP] 액션 요청 여러 건을 "현장 작업 1건" 으로 묶는 추론 로직.
 *
 * ## 왜 있나
 * 현장 업무는 `전값 측정 → (SEA) → 후값 측정 → ERMAP 요청` 처럼 여러 단계인데,
 * 지금 GAIA 는 요청 1건 = TRACE_ID 1개로 기록한다. 그래서 화면에서 세 요청이
 * 서로 남남으로 보인다. 여기서 그 세 건을 하나로 묶어준다.
 *
 * ## 임시 코드다
 * GAIA 에 시나리오 메이커가 들어오면 실행 1건마다 진짜 식별자(`TXN_ID`)가
 * 생긴다. 그때 **이 파일의 추론부만 "GAIA 행의 TXN_ID 읽기" 로 바뀐다.**
 * types.ts 의 WorkSummary, /api/traces 의 조립, 화면은 그대로 남는다.
 *
 * ### 제거 방법
 * 1. `groupTracesIntoWorks()` 를 TXN_ID 를 읽어 Map 을 만드는 구현으로 교체
 * 2. `CHAMBER_FIELD` / `VARIANT_FIELD` / `FLOW_ORDER` / `WORK_WINDOW_HOURS` 삭제
 * 3. `db.ts` 의 `fetchWorkGroupRows()` 에서 SEND_MSG_CTN 대신 TXN_ID 를 읽게 수정
 *
 * ## 묶는 규칙
 * ```
 * 챔버를 못 읽으면                      → 단독 (1건짜리 묶음)
 * 같은 챔버 + 윈도우(기본 8시간) 안 +
 *   흐름의 뒤 단계로 진행하는 요청이면   → 붙인다
 * 그 외                                 → 새 묶음을 연다
 * ```
 * 윈도우는 **마지막 요청 시각 기준**으로 갱신된다 (전값→후값 8h, 후값→ERMAP 다시 8h).
 *
 * 흐름 순서는 `전값 → 후값 → ERMAP`(FLOW_ORDER)로 고정이고 **뒤로만 갈 수 있다.**
 * 되돌아가는 요청(후값 뒤의 전값)이나 같은 단계 반복(전값 뒤의 전값)은 다음 작업의
 * 시작으로 보고 새 묶음을 연다. 건너뛰기는 허용된다 (전값 → ERMAP).
 * 덕분에 "종료 액션" 을 따로 지정할 필요가 없다.
 *
 * 묶음 ID 는 **그 묶음의 첫 TRACE_ID** 를 그대로 쓴다. 발번 규칙이 필요 없고
 * 같은 입력이면 항상 같은 값이라 URL·북마크가 안정적이다.
 *
 * ## 알려진 구멍
 * 챔버 값은 `SEND_MSG_CTN`(MCP 로 인계한 파라미터)에서 읽는다. 필수값 누락 같은
 * **검증 실패로 MCP 까지 못 간 요청은 이 칸이 비어 있어 묶음 밖에 단독으로 남는다.**
 * 의도된 동작이다 (대시보드가 ACTION_TYP 이 없는 트레이스를 '라우팅 실패' 로 따로
 * 세는 것과 같은 종류의 구멍).
 */

import { TraceStatus } from "./types";

/**
 * 묶음 유효 윈도우(시간) — 교대 1번.
 * 이 시간 안에 같은 챔버로 들어온 요청까지를 한 작업으로 본다.
 * 조정이 필요하면 이 값만 고친다 (임시 로직이라 설정 파일로 빼지 않았다).
 */
export const WORK_WINDOW_HOURS = 8;

/**
 * 묶음 키(챔버 ID)를 SEND_MSG_CTN JSON 의 어느 필드에서 읽나. ACTION_TYP 별 매핑.
 * 액션마다 키 이름이 다르다 — AutoQual 계열은 CHAMB_RAW_ID, DSP→ERMAP 은 EQP_ID 에
 * 챔버 값(`5EKEH214_PM2`)이 들어온다.
 *
 * 후보 필드를 순서대로 훑는 방식이 더 짧지만, 다른 액션에 우연히 같은 이름 필드가
 * 생기면 조용히 오탐이 난다. 액션이 늘어도 여기 한 줄이라 명시 매핑을 쓴다.
 * 여기 없는 ACTION_TYP 은 묶지 않는다 (= 단독).
 */
const CHAMBER_FIELD: Record<string, string> = {
  AutoQual_PrePost: "CHAMB_RAW_ID",
  ERMAP: "EQP_ID",
};

/**
 * 흐름 단계를 ACTION_TYP 보다 잘게 갈라야 하는 액션.
 * 전값/후값은 ACTION_TYP 이 둘 다 AutoQual_PrePost 라, ACT_SEQ(PRE/POST)까지 봐야
 * 서로 다른 단계로 인식된다. 이 값은 화면의 액션 칩 라벨로도 그대로 쓰인다.
 */
const VARIANT_FIELD: Record<string, string> = {
  AutoQual_PrePost: "ACT_SEQ",
};

/**
 * 작업 흐름의 단계 순서. 요청은 이 순서를 **앞에서 뒤로만** 진행할 수 있다.
 * 원소는 아래 stepKey() 가 만드는 키 (`ACTION_TYP` 또는 `ACTION_TYP/변형값`).
 *
 * 흐름이 바뀌면(예: 중간에 SEA 가 들어오면) 이 배열에 자리만 끼워 넣는다.
 */
const FLOW_ORDER = [
  "AutoQual_PrePost/PRE",   // 전값 측정
  "AutoQual_PrePost/POST",  // 후값 측정
  "ERMAP",                  // ERMAP 요청 (DSP 발) — 흐름의 마지막
];

/** 묶음 산출에 필요한 GAIA 행의 최소 형태 */
export interface WorkSourceRow {
  traceId: string;
  actionTyp: string | null;
  /** "YYYY-MM-DDTHH:mm:ss.SSS" (로컬, TZ 없음) */
  recvTm: string | null;
  sendMsgCtn: string | null;
}

/** TRACE 하나가 어느 묶음에 속하는지 */
export interface TraceWorkInfo {
  /** 묶음의 첫 TRACE_ID */
  workId: string;
  /** 묶음을 건 챔버 ID. 못 읽었으면 null (= 단독) */
  chamberId: string | null;
  /** 화면 칩 라벨 — "PRE" / "POST" / "ERMAP" 등. 판정 불가면 null */
  actionLabel: string | null;
}

interface Entry {
  traceId: string;
  ms: number | null;
  chamber: string | null;
  /** FLOW_ORDER 상의 위치. 흐름에 없는 단계면 -1 (= 묶지 않는다) */
  step: number;
  label: string | null;
}

/** 로컬 ISO 문자열 → epoch ms. 파싱 불가면 null */
export function toMs(ts: string | null): number | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 로컬 ISO 문자열을 시간 단위로 밀어 같은 포맷으로 되돌린다 (DB TO_TIMESTAMP 포맷과 일치) */
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
    // SEND_MSG_CTN 은 VARCHAR2(4000) 에서 잘릴 수 있어 JSON 이 깨진 채 저장될 수 있다.
    // readField() 의 정규식 폴백으로 넘긴다.
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
  // 필드명은 위 상수 테이블의 고정값이라 정규식에 그대로 넣어도 안전하다.
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

/**
 * GAIA 행들을 훑어 TRACE_ID → 소속 묶음을 만든다.
 *
 * 입력은 묶음 경계가 정확해지도록 **화면 기간보다 앞뒤로 windowHours 만큼 넓게**
 * 읽어온 행이어야 한다. 안 그러면 어제 22시 전값 + 오늘 2시 후값이 두 묶음으로 갈라진다.
 */
export function groupTracesIntoWorks(
  rows: WorkSourceRow[],
  windowHours: number = WORK_WINDOW_HOURS
): Map<string, TraceWorkInfo> {
  const windowMs = Math.max(1, windowHours) * 3600_000;

  // TRACE 당 1건으로 접는다 — 한 TRACE 에 GAIA 행이 여러 개일 수 있어(다중 호출)
  // 시간순 첫 행을 대표로 삼되, 챔버가 잡히는 행이 나오면 그 값으로 승격시킨다.
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
    // 챔버를 못 읽었거나, 수신 시각이 없거나, 흐름에 없는 단계면 묶을 근거가 없다 → 단독
    if (!e.chamber || e.ms === null || e.step < 0) {
      out.set(e.traceId, { workId: e.traceId, chamberId: e.chamber, actionLabel: e.label });
      continue;
    }
    const cur = open.get(e.chamber);
    // 흐름은 뒤로만 진행한다 — 같은 단계 반복도, 되돌아가는 요청도 다음 작업의 시작으로 본다.
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

/** 묶음 상태 = 안에 든 TRACE 중 가장 나쁜 것 (error > fail > pending > ok) */
export function rollupStatus(statuses: TraceStatus[]): TraceStatus {
  let worst: TraceStatus = "ok";
  for (const s of statuses) {
    if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
  }
  return worst;
}
