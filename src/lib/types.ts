export type LayerKey = "CUBE" | "GAIA" | "MCP" | "ONEOIS" | "LEGACY";

export const LAYER_ORDER: LayerKey[] = ["CUBE", "GAIA", "MCP", "ONEOIS", "LEGACY"];

export const LAYER_LABEL: Record<LayerKey, string> = {
  CUBE: "Cube / Cube Bot",
  GAIA: "Gaia Agent",
  MCP: "MCP Server",
  ONEOIS: "OneOIS",
  LEGACY: "Legacy (MES/EWORKS)"
};

export interface TraceRow {
  layer: LayerKey;
  traceId: string;
  timekey: string;
  userId: string | null;
  sysId: string | null;
  recvSysId: string | null;
  recvMsgCtn: string | null;
  recvTm: string | null;
  sendSysId: string | null;
  sendMsgCtn: string | null;
  sendTm: string | null;
  sendCompltYn: "Y" | "N" | null;
  respMsgCtn: string | null;
  respTm: string | null;
  errCd: string | null;
  errDescCtn: string | null;
}

export interface TraceSummary {
  traceId: string;
  userId: string | null;
  firstRecvTm: string | null;
  lastSendTm: string | null;
  layerCount: number;
  hasError: boolean;
  allComplete: boolean;
}

export interface TraceDetailResponse {
  traceId: string;
  rows: TraceRow[];
}

export interface TraceListResponse {
  summaries: TraceSummary[];
  total: number;
  usedMock: boolean;
}

export interface TraceFilter {
  traceId?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  onlyError?: boolean;
  limit?: number;
}
