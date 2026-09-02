
// 로드맵 시점 해석. 순수 함수만 둘 것 — 서버·클라이언트가 같이 쓴다.

import { Milestone, MilestoneStatus } from "./types";

export type WhenPrecision = "day" | "month";

export interface WhenSpan {
  start: number;
  end: number;
  precision: WhenPrecision;
  label: string;
  longLabel: string;
  year: number;
  monthIdx: number;
}

const MS_DAY = 86_400_000;

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export const WEEK_HEADER_KO = ["월", "화", "수", "목", "금", "토", "일"] as const;

function at(y: number, monthIdx: number, day = 1): number {
  return new Date(y, monthIdx, day).getTime();
}

const pad = (n: number) => String(n).padStart(2, "0");

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

export interface CalendarDay {
  ms: number;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  weekday: number;
}

export function buildMonthGrid(
  year: number,
  monthIdx: number,
  now: number,
  minWeeks = 0
): CalendarDay[][] {
  const first = new Date(year, monthIdx, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = at(year, monthIdx, 1 - lead);

  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const total = Math.max(Math.ceil((lead + daysInMonth) / 7), minWeeks) * 7;

  const todayKey = dayKeyOf(now);
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < total; i++) {
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

export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthKeyOf(year: number, monthIdx: number): string {
  return `${year}-${pad(monthIdx + 1)}`;
}

export function monthLabel(year: number, monthIdx: number): string {
  return `${year}년 ${monthIdx + 1}월`;
}

export function shiftMonth(year: number, monthIdx: number, delta: number): { year: number; monthIdx: number } {
  const d = new Date(year, monthIdx + delta, 1);
  return { year: d.getFullYear(), monthIdx: d.getMonth() };
}

export interface YearMonth {
  monthIdx: number;
  label: string;
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
      items: items.filter((i) => i.span && i.span.year === year && i.span.monthIdx === m),
      isCurrent: year === curY && m === curM,
    });
  }
  return out;
}

export type MilestoneState = MilestoneStatus | "overdue";

export const STATE_LABEL: Record<MilestoneState, string> = {
  released: "오픈 완료",
  in_progress: "개발 중",
  planned: "계획",
  hold: "보류",
  overdue: "일정 초과",
};

export const STATE_CLASS: Record<MilestoneState, string> = {
  released: "done",
  in_progress: "doing",
  planned: "plan",
  hold: "hold",
  overdue: "late",
};

export function isOverdue(status: MilestoneStatus, span: WhenSpan | null, now: number): boolean {
  if (!span) return false;
  if (status === "released" || status === "hold") return false;
  return span.end <= now;
}

export function stateOf(status: MilestoneStatus, span: WhenSpan | null, now: number): MilestoneState {
  return isOverdue(status, span, now) ? "overdue" : status;
}

export function overdueDays(span: WhenSpan, now: number): number {
  return Math.max(1, Math.ceil((now - span.end) / MS_DAY));
}

export interface ResolvedMilestone {
  milestone: Milestone;
  span: WhenSpan | null;
  state: MilestoneState;
  lateDays: number;
}

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
      return a.span.start - b.span.start || a.span.end - b.span.end;
    });
}

export function initialMonth(items: ResolvedMilestone[], now: number): { year: number; monthIdx: number } {
  const dated = items.filter((i) => i.span);
  const upcoming = dated.find((i) => i.span!.end > now);
  const pick = upcoming ?? dated[dated.length - 1];
  if (pick) return { year: pick.span!.year, monthIdx: pick.span!.monthIdx };
  const d = new Date(now);
  return { year: d.getFullYear(), monthIdx: d.getMonth() };
}
