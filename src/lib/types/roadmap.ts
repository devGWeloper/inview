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
