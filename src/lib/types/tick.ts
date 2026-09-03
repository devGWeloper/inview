// 틱(롤링 60초) 집계.

export type TickView = "usage" | "failure";

export interface TickMetricDef {
  name: string;
  unitText: string;
  unit: string;
  limit: number;
}

export interface TickFilter {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  nodeNm?: string;
  modelNm?: string;
  view?: TickView;
  agentId?: string;
}

export interface TickMinute {
  ts: string;
  fixedA: number;
  fixedB: number;
  rollA: number;
  rollAAt: string | null;
  rollB: number;
  rollBAt: string | null;
}

export interface TickPeak {
  value: number;
  at: string | null;
}

export interface TickCall {
  callTm: string | null;
  traceId: string | null;
  nodeNm: string | null;
  modelNm: string | null;
  userId: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number | null;
  statCd: string | null;
  errCtn: string | null;
}

export interface TickStatsResponse {
  range: { from: string | null; to: string | null };
  minutes: TickMinute[];
  peakA: TickPeak;
  peakB: TickPeak;
  totals: { a: number; b: number; rows: number };
  calls: TickCall[];
  truncated: boolean;
  statusAvailable?: boolean;
  agentId?: string;
}

export const TICK_WINDOW_SEC = 60;
