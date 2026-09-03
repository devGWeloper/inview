// 대시보드 집계 (computeStats 의 입출력).
import type { Granularity } from "../timeBuckets";
import type { LayerKey } from "./layers";

export interface StatsFilter {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  actionTyp?: string;
  excludeErrCds?: string[];
  gran?: Granularity;
}

export interface DimensionStats {
  key: string;
  total: number;
  ok: number;
  fail: number;
  pending: number;
}

export const ROUTING_FAIL_LABEL = "라우팅 실패";

export interface StatusCounts {
  ok: number;
  fail: number;
  pending: number;
}

export interface LayerStats {
  layer: LayerKey;
  total: number;
  failCount: number;
  okRows: number;
  avgRespMs: number | null;
  avgSelfMs: number | null;
  selfMsTotal: number;
  failOriginTraces: number;
}

export interface TimeBucket {
  ts: string;
  ok: number;
  fail: number;
  pending: number;
  avgCubeLatencyMs?: number | null;
  cubeLatencyTraces?: number;
}

export interface TopItem {
  key: string;
  count: number;
}

export interface DailyStat {
  date: string;
  total: number;
  ok: number;
  fail: number;
  pending: number;
  users: number;
  avgCubeLatencyMs: number | null;
  byAction: DailyActionStat[];
}

export interface DailyActionStat {
  key: string;
  total: number;
  ok: number;
  fail: number;
}

export interface StatsResponse {
  range: { from: string | null; to: string | null };
  totals: StatusCounts & { total: number };
  avgLatencyMs: number | null;
  cubeAvgLatencyMs?: number | null;
  granularity: Granularity;
  buckets: TimeBucket[];
  layers: LayerStats[];
  selfTimeTraces?: number;
  topUsers: TopItem[];
  uniqueUsers?: number;
  daily?: DailyStat[];
  topErrors: TopItem[];
  byAction: DimensionStats[];
  byFac: DimensionStats[];
  byArea: DimensionStats[];
  rowCount: number;
  excludeErrCds: string[];
  excludedTraceCount: number;
}
