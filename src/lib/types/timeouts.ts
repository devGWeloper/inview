// 타임아웃/실패 호출 집계.
import type { Granularity } from "../timeBuckets";

export interface TimeoutBucket {
  ts: string;
  calls: number;
  failed: number;
  timeout: number;
}

export interface TimeoutItem {
  tokenId: string;
  callTm: string | null;
  traceId: string | null;
  nodeNm: string | null;
  modelNm: string | null;
  keyNm: string | null;
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
  byKey: TimeoutDimStat[];
  byUser: TimeoutDimStat[];
  /** KEY_NM 컬럼이 실제로 있는지 — 없으면 키 관련 표시를 숨긴다. */
  keyAvailable: boolean;
  items: TimeoutItem[];
  /** 호출 많은 순 상위 모델 — 실패가 0건인 모델도 포함한다(분모를 보여주는 게 목적). */
  modelVolume: TimeoutDimStat[];
  topReasons: TimeoutReason[];
  agentId?: string;
}

export interface TimeoutReason {
  reason: string;
  failed: number;
  timeout: number;
  lastAt: string | null;
}
