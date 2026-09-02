// 트레이스 행 · 요약 · 묶음 · 목록/상세 응답.
import type { LayerKey } from "./layers";

export interface TraceRow {
  layer: LayerKey;
  traceId: string;
  timekey: string;
  userId: string | null;
  sysId: string | null;
  channelId: string | null;
  actionTyp: string | null;
  facId: string | null;
  areaId: string | null;
  recvSysId: string | null;
  recvMsgCtn: string | null;
  recvTm: string | null;
  sendSysId: string | null;
  sendMsgCtn: string | null;
  sendTm: string | null;
  sendCompltYn: "Y" | "N" | null;
  respMsgCtn: string | null;
  respTm: string | null;
  httpStsCd: string | null;
  errCd: string | null;
  errDescCtn: string | null;
}

export type TraceStatus = "ok" | "pending" | "fail" | "error";

export interface TraceSummary {
  traceId: string;
  userId: string | null;
  firstRecvTm: string | null;
  lastSendTm: string | null;
  layerCount: number;
  layers: LayerKey[];
  status: TraceStatus;
  allComplete: boolean;
}

export interface WorkTraceItem extends TraceSummary {
  actionLabel: string | null;
}

export interface WorkSummary {
  workId: string;
  chamberId: string | null;
  firstRecvTm: string | null;
  lastRecvTm: string | null;
  status: TraceStatus;
  traces: WorkTraceItem[];
}

export interface TraceDetailResponse {
  traceId: string;
  rows: TraceRow[];
}

export interface TraceListResponse {
  works: WorkSummary[];
  total: number;
  connectedLayers: number;
  appEnv: "dev" | "prd";
}

export interface TraceFilter {
  traceId?: string;
  userId?: string;
  actionTyp?: string;
  errCd?: string;
  facId?: string;
  traceIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  onlyError?: boolean;
  limit?: number;
  lean?: boolean;
}
