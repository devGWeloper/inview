// ─────────────────────────────────────────────────────────────────────────────
// 로드맵 시점 해석 + 달력 격자 — **순수 함수만** (fs · DB · React 무관).
//
// 서버 라우트와 클라이언트 화면이 같이 쓰므로 Node 전용 모듈을 import 하지 않는다.
// 경계 조건(월 경계 · 윤년 · 주 시작 요일 · 항목 0건)의 검증 지점이 여기 하나다.
//
// ⚠️ 받는 정밀도는 **날짜와 월 둘뿐**이다. 분기/연도는 일부러 뺐다 — Action 은 실제로
//    한 달 안에 개발해서 여는 단위라 "2026-Q4" 는 너무 뭉툭하고, 무엇보다 **달력에 놓을
//    자리가 없다**. 아직 시점을 모르면 비워 두면 되고(표에 "일정 미정"), 달만 정해졌으면
//    월로 적으면 된다(달력의 '날짜 미정' 줄).
// ─────────────────────────────────────────────────────────────────────────────

import { Milestone, MilestoneStatus } from "./types";

export type WhenPrecision = "day" | "month";

export interface WhenSpan {
  /** 구간 시작 (로컬 ms) */
  start: number;
  /** 구간 끝 (로컬 ms, **배타적**) */
  end: number;
  precision: WhenPrecision;
  /** 짧은 표기 — "09.24" / "9월" */
  label: string;
  /** 연도까지 + 날짜면 요일까지 — "2026. 09. 24 (목)" / "2026. 9월" */
  longLabel: string;
  year: number;
  /** 0-based */
  monthIdx: number;
}

const MS_DAY = 86_400_000;

/** 일요일 시작 인덱스(getDay)에 맞춘 요일 이름. */
export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 달력은 월요일 시작. 표시 순서용 라벨. */
export const WEEK_HEADER_KO = ["월", "화", "수", "목", "금", "토", "일"] as const;

/** 로컬 자정 기준 ms. Date 생성자를 통하므로 DST/윤년은 런타임이 처리한다. */
function at(y: number, monthIdx: number, day = 1): number {
  return new Date(y, monthIdx, day).getTime();
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 시점 문자열 → 구간. 해석 불가면 null (화면이 "일정 미정" 으로 표기).
 *
 * 허용 형식 (구분자는 관대하게 `-` `.` `/` 공백):
 *   2026-09-24 / 2026.9.24 / 2026/09/24  → day
 *   2026-09    / 2026.9                  → month
 */
export function parseWhen(raw: string): WhenSpan | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  const parts = s.split(/[-./\s]+/).filter(Boolean);
  if (parts.length !== 2 && parts.length !== 3) return null;

  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  const [y, m, d] = nums;
  if (!y || y < 1900 || y > 3000) return null;
  if (!m || m < 1 || m > 12) return null;

  if (nums.length === 2) {
    return {
      start: at(y, m - 1),
      end: at(y, m),
      precision: "month",
      label: `${m}월`,
      longLabel: `${y}. ${m}월`,
      year: y,
      monthIdx: m - 1,
    };
  }

  // 존재하지 않는 날짜(2월 30일 등)는 거절한다 — Date 가 조용히 다음 달로 넘긴다.
  if (!d || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;

  return {
    start: dt.getTime(),
    end: dt.getTime() + MS_DAY,
    precision: "day",
    label: `${pad(m)}.${pad(d)}`,
    longLabel: `${y}. ${pad(m)}. ${pad(d)} (${WEEKDAY_KO[dt.getDay()]})`,
    year: y,
    monthIdx: m - 1,
  };
}

// ── 달력 격자 ────────────────────────────────────────────────────────────────

export interface CalendarDay {
  /** 그 날 00:00 의 ms */
  ms: number;
  day: number;
  /** 보고 있는 달의 날인가 (앞뒤로 채워 넣은 날이면 false) */
  inMonth: boolean;
  isToday: boolean;
  weekday: number;
}

/**
 * 그 달을 덮는 **월요일 시작** 주 배열. 기본은 필요한 만큼만(5주 또는 6주).
 *
 * `minWeeks` 를 주면 그만큼 채운다 — 년 보기의 미니 달력 12장은 주 수가 제각각이면
 * 카드마다 아래 목록이 시작하는 높이가 어긋나 격자가 흐트러진다. 그래서 6을 넘긴다.
 */
export function buildMonthGrid(
  year: number,
  monthIdx: number,
  now: number,
  minWeeks = 0
): CalendarDay[][] {
  const first = new Date(year, monthIdx, 1);
  // getDay: 0=일 … 6=토. 월요일 시작이므로 일요일은 6칸 앞선다.
  const lead = (first.getDay() + 6) % 7;
  const start = at(year, monthIdx, 1 - lead);

  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const total = Math.max(Math.ceil((lead + daysInMonth) / 7), minWeeks) * 7;

  const todayKey = dayKeyOf(now);
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < total; i++) {
    // ⚠️ start + i*MS_DAY 로 더하면 DST 가 있는 지역에서 날이 밀린다. Date 로 더한다.
    const dt = new Date(start);
    dt.setDate(dt.getDate() + i);
    const cell: CalendarDay = {
      ms: dt.getTime(),
      day: dt.getDate(),
      inMonth: dt.getFullYear() === year && dt.getMonth() === monthIdx,
      isToday: dayKeyOf(dt.getTime()) === todayKey,
      weekday: dt.getDay(),
    };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(cell);
  }
  return weeks;
}

/** 같은 날인지 비교할 때 쓰는 키 ("2026-09-24"). ms 직접 비교는 시분초 때문에 못 쓴다. */
export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 월 비교용 키 ("2026-09"). */
export function monthKeyOf(year: number, monthIdx: number): string {
  return `${year}-${pad(monthIdx + 1)}`;
}

export function monthLabel(year: number, monthIdx: number): string {
  return `${year}년 ${monthIdx + 1}월`;
}

/** 월 이동 (delta 달만큼). 연도 넘김은 Date 가 처리한다. */
export function shiftMonth(year: number, monthIdx: number, delta: number): { year: number; monthIdx: number } {
  const d = new Date(year, monthIdx + delta, 1);
  return { year: d.getFullYear(), monthIdx: d.getMonth() };
}

/** 한 해를 1~12월로 나눈 묶음. 연 보기(12달 한눈에)가 쓴다. */
export interface YearMonth {
  monthIdx: number;
  label: string;
  /** 그 달에 속한 항목 (날짜 정해진 것 + 달만 정해진 것, 시간순) */
  items: ResolvedMilestone[];
  isCurrent: boolean;
}

export function buildYear(items: ResolvedMilestone[], year: number, now: number): YearMonth[] {
  const today = new Date(now);
  const curY = today.getFullYear();
  const curM = today.getMonth();
  const out: YearMonth[] = [];
  for (let m = 0; m < 12; m++) {
    out.push({
      monthIdx: m,
      label: `${m + 1}월`,
      // items 는 이미 시간순이라 filter 만 해도 순서가 유지된다.
      items: items.filter((i) => i.span && i.span.year === year && i.span.monthIdx === m),
      isCurrent: year === curY && m === curM,
    });
  }
  return out;
}

// ── 파생 상태 ────────────────────────────────────────────────────────────────

/**
 * 화면에 실제로 그리는 상태. `overdue` 는 **저장하지 않고 오늘 날짜로 판정**한다 —
 * 운영자가 매번 상태를 손으로 갱신하지 않아도 목표일이 지난 항목이 스스로 드러난다.
 */
export type MilestoneState = MilestoneStatus | "overdue";

export const STATE_LABEL: Record<MilestoneState, string> = {
  released: "오픈 완료",
  in_progress: "개발 중",
  planned: "계획",
  hold: "보류",
  overdue: "일정 초과",
};

/** 상태 → CSS 클래스 조각. 화면 여러 곳이 같은 이름을 써야 색이 어긋나지 않는다. */
export const STATE_CLASS: Record<MilestoneState, string> = {
  released: "done",
  in_progress: "doing",
  planned: "plan",
  hold: "hold",
  overdue: "late",
};

/** 목표 구간이 이미 지났는데 아직 열리지 않았는가. 보류·완료는 대상이 아니다. */
export function isOverdue(status: MilestoneStatus, span: WhenSpan | null, now: number): boolean {
  if (!span) return false;
  if (status === "released" || status === "hold") return false;
  return span.end <= now;
}

export function stateOf(status: MilestoneStatus, span: WhenSpan | null, now: number): MilestoneState {
  return isOverdue(status, span, now) ? "overdue" : status;
}

/** 목표 구간 끝으로부터 며칠 지났는가 (최소 1). */
export function overdueDays(span: WhenSpan, now: number): number {
  return Math.max(1, Math.ceil((now - span.end) / MS_DAY));
}

// ── 화면이 쓰는 완성 형태 ────────────────────────────────────────────────────

export interface ResolvedMilestone {
  milestone: Milestone;
  span: WhenSpan | null;
  state: MilestoneState;
  /** 지연 일수 (state 가 overdue 일 때만) */
  lateDays: number;
}

/**
 * 마일스톤을 화면용 형태로 풀고 **시간순 정렬**한다.
 * 시점을 해석할 수 없는 항목(미정)은 맨 뒤로 — 달력에 놓을 자리가 없어 표로만 보여준다.
 */
export function resolveMilestones(milestones: Milestone[], now: number): ResolvedMilestone[] {
  return milestones
    .map((m) => {
      const span = parseWhen(m.when);
      const state = stateOf(m.status, span, now);
      return {
        milestone: m,
        span,
        state,
        lateDays: state === "overdue" && span ? overdueDays(span, now) : 0,
      };
    })
    .sort((a, b) => {
      if (!a.span && !b.span) return 0;
      if (!a.span) return 1;
      if (!b.span) return -1;
      // 같은 달이면 날짜가 정해진 쪽(day)이 먼저 — 달력에서도 같은 순서로 읽힌다.
      return a.span.start - b.span.start || a.span.end - b.span.end;
    });
}

/**
 * 처음 열었을 때 보여줄 달.
 *
 * ⚠️ 무조건 '이번 달' 이면 안 된다 — 이번 달이 비어 있고 다음 오픈이 두 달 뒤면 빈 달력만
 *    보이고 사용자가 직접 찾아 넘겨야 한다. 오늘 이후 가장 가까운 항목의 달을 고르고,
 *    앞으로 아무것도 없으면 마지막 항목의 달(가장 최근 오픈)로 간다. 둘 다 없으면 이번 달.
 */
export function initialMonth(items: ResolvedMilestone[], now: number): { year: number; monthIdx: number } {
  const dated = items.filter((i) => i.span);
  const upcoming = dated.find((i) => i.span!.end > now);
  const pick = upcoming ?? dated[dated.length - 1];
  if (pick) return { year: pick.span!.year, monthIdx: pick.span!.monthIdx };
  const d = new Date(now);
  return { year: d.getFullYear(), monthIdx: d.getMonth() };
}
