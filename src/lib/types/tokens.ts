// TRX_TOKEN_DET 기반 토큰 집계.
import type { TopItem } from "./stats";

export interface TokenRow {
  tokenId: string;
  traceId: string | null;
  nodeNm: string | null;
  modelNm: string | null;
  userId: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number | null;
  queryCtn: string | null;
  statCd: string | null;
  errCtn: string | null;
  callTm: string | null;
}

export interface TokenQuestion {
  qKey: string;
  traceId: string | null;
  nodes: string[];
  models: string[];
  queryCtn: string | null;
  userId: string | null;
  calls: number;
  errorNodes: string[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastTm: string | null;
}

export interface TokenFilter {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  nodeNm?: string;
  modelNm?: string;
  traceId?: string;
  agentId?: string;
  skipQuestions?: boolean;
}

export interface TokenBucket {
  ts: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  calls: number;
  avgLatencyMs: number | null;
}

export interface TokenDimSub {
  key: string;
  calls: number;
  totalTokens: number;
}

export interface TokenDimStat {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgLatencyMs: number | null;
  sub: TokenDimSub[];
}

export interface TokenStatsResponse {
  range: { from: string | null; to: string | null };
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number };
  avgTotalPerCall: number | null;
  avgLatencyMs: number | null;
  granularity: "5m" | "1h" | "1d";
  buckets: TokenBucket[];
  byNode: TokenDimStat[];
  byModel: TokenDimStat[];
  topUsers: TopItem[];
  questions: TokenQuestion[];
  calls: TokenRow[];
  agentId?: string;
}
