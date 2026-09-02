// 타임아웃/실패 호출 집계.
import type { Granularity } from "../timeBuckets";

export interface TimeoutBucket {
  ts: string;
  failed: number;
  timeout: number;
}

export interface TimeoutItem {
  tokenId: string;
  callTm: string | null;
  traceId: string | null;
  nodeNm: string | null;
  modelNm: string | null;
  userId: string | null;
  queryCtn: string | null;
  latencyMs: number | null;
  statCd: string | null;
  errCtn: string | null;
}

export interface TimeoutDimStat {
  key: string;
  failed: number;
  timeout: number;
  calls: number;
}

export interface TimeoutStatsResponse {
  range: { from: string | null; to: string | null };
  granularity: Granularity;
  available: boolean;
  totalCalls: number;
  failedCalls: number;
  timeoutCalls: number;
  affectedUsers: number;
  affectedTraces: number;
  lastAt: string | null;
  buckets: TimeoutBucket[];
  byNode: TimeoutDimStat[];
  byModel: TimeoutDimStat[];
  byUser: TimeoutDimStat[];
  items: TimeoutItem[];
  modelTrend: TimeoutModelSeries[];
  topReasons: TimeoutReason[];
  agentId?: string;
}

export interface TimeoutModelCell {
  ts: string;
  calls: number;
  failed: number;
  timeout: number;
}

export interface TimeoutModelSeries {
  model: string;
  totalCalls: number;
  totalFailed: number;
  totalTimeout: number;
  cells: TimeoutModelCell[];
}

export interface TimeoutReason {
  reason: string;
  failed: number;
  timeout: number;
  lastAt: string | null;
}
