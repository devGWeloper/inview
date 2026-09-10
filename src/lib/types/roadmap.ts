// Action 오픈 로드맵.

export type MilestoneStatus = "released" | "in_progress" | "planned" | "hold";

export const MILESTONE_STATUSES: MilestoneStatus[] = ["released", "in_progress", "planned", "hold"];

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  released: "오픈 완료",
  in_progress: "개발 중",
  planned: "계획",
  hold: "보류",
};

export interface Milestone {
  id: string;
  name: string;
  status: MilestoneStatus;
  when: string;
  desc: string;
}

export interface Roadmap {
  milestones: Milestone[];
  updatedAt: string;
}

export const DEFAULT_ROADMAP: Roadmap = { milestones: [], updatedAt: "" };

/** 운영자가 넣는 임시공휴일. 내장 표(`lib/holidays.ts`) 위에 얹힌다. */
export interface HolidayDay {
  date: string;
  name: string;
}

export interface HolidayDoc {
  days: HolidayDay[];
  updatedAt: string;
}

export const EMPTY_HOLIDAYS: HolidayDoc = { days: [], updatedAt: "" };
