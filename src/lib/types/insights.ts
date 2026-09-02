// 실적 화면 전용 축소 응답 (내부 정보를 걷어낸 형태).
import type { Granularity } from "../timeBuckets";
import type { FteStats } from "./profile";
import type { DailyActionStat, DimensionStats, StatusCounts } from "./stats";
import type { TimeoutBucket } from "./timeouts";
import type { TokenBucket } from "./tokens";

export interface InsightsBucket {
  ts: string;
  ok: number;
  fail: number;
  pending: number;
  avgCubeLatencyMs?: number | null;
}

export interface InsightsDaily {
  date: string;
  total: number;
  ok: number;
  fail: number;
  pending: number;
  users: number;
  avgCubeLatencyMs: number | null;
  byAction: DailyActionStat[];
}

export interface InsightsAgent {
  name: string;
  nickname: string;
  tagline: string;
  avatar: string;
  avatarImage: string;
}

export interface InsightsTokens {
  granularity: Granularity;
  buckets: TokenBucket[];
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number };
  avgTotalPerCall: number | null;
  avgLatencyMs: number | null;
  byModel: InsightsModelTokens[];
}

export interface InsightsModelTokens {
  key: string;
  calls: number;
  totalTokens: number;
  avgLatencyMs: number | null;
}

export interface InsightsTimeouts {
  available: boolean;
  granularity: Granularity;
  buckets: TimeoutBucket[];
  totalCalls: number;
  failedCalls: number;
  timeoutCalls: number;
  affectedTraces: number;
  byModel: InsightsModelTimeouts[];
}

export interface InsightsModelTimeouts {
  key: string;
  failed: number;
  timeout: number;
  calls: number;
}

/**
 * 실적 화면의 "주요 실패 원인" 한 항목 — 코드가 아니라 사유로 내린다.
 * 서버가 설명을 붙이고(설명 없으면 label = code) 화면은 설명을 앞세운다.
 */
export interface InsightsError {
  code: string;
  label: string;
  count: number;
  described: boolean;
}

export interface InsightsResponse {
  range: { from: string | null; to: string | null };
  totals: StatusCounts & { total: number };
  successRate: number | null;
  avgResponseMs: number | null;
  uniqueUsers: number;
  granularity: Granularity;
  buckets: InsightsBucket[];
  daily: InsightsDaily[];
  byAction: DimensionStats[];
  byFac: DimensionStats[];
  topErrors: InsightsError[];
  agent: InsightsAgent;
  fte: FteStats | null;
  tokens: InsightsTokens | null;
  timeouts: InsightsTimeouts | null;
}
