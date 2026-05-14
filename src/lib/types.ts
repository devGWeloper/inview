// ─────────────────────────────────────────────────────────────────────────────
// LAYERS: 레이어 정의의 단일 소스(single source of truth).
// 추가/삭제/순서 변경/색상 변경/라벨 변경은 모두 이 배열만 수정하면 된다.
//
//   - 배열 순서가 곧 요청 경로 순서(LAYER_ORDER)
//   - key 는 YAML config 의 layer 키, DB 쿼리 라벨, CSS hook 으로 함께 쓰인다
//   - 새 레이어를 추가할 때:
//       1) 이 배열에 { key, label, color } 한 줄 추가
//       2) config.yml / config.dev.yml 에 동일 key 로 접속 정보 추가
//     그 외 변경은 필요 없다.
// ─────────────────────────────────────────────────────────────────────────────
export const LAYERS = [
  { key: "CUBE",   label: "Cube / Cube Bot", color: "#4b6bfb" },
  { key: "GAIA",   label: "Gaia Agent",      color: "#7c3aed" },
  { key: "MCP",    label: "MCP Server",      color: "#059669" },
  { key: "ONEOIS", label: "OneOIS",          color: "#d97706" },
] as const;

export type LayerKey = typeof LAYERS[number]["key"];

export const LAYER_ORDER: readonly LayerKey[] = LAYERS.map((l) => l.key);

export const LAYER_LABEL: Record<LayerKey, string> = Object.fromEntries(
  LAYERS.map((l) => [l.key, l.label])
) as Record<LayerKey, string>;

export const LAYER_COLOR: Record<LayerKey, string> = Object.fromEntries(
  LAYERS.map((l) => [l.key, l.color])
) as Record<LayerKey, string>;

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

export type TraceStatus = "ok" | "pending" | "fail" | "error";

export interface TraceSummary {
  traceId: string;
  userId: string | null;
  firstRecvTm: string | null;
  lastSendTm: string | null;
  layerCount: number;
  status: TraceStatus;
  allComplete: boolean;
}

export interface TraceDetailResponse {
  traceId: string;
  rows: TraceRow[];
}

export interface TraceListResponse {
  summaries: TraceSummary[];
  total: number;
  connectedLayers: number;
  appEnv: "dev" | "prd";
}

export interface TraceFilter {
  traceId?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  onlyError?: boolean;
  limit?: number;
}
