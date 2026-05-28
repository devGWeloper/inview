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
  channelId: string | null;
  actionTyp: string | null;
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
  /** 행이 존재하는 레이어 키 목록 (목록 패널의 dot 인디케이터용) */
  layers: LayerKey[];
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
  channelId?: string;
  actionTyp?: string;
  dateFrom?: string;
  dateTo?: string;
  onlyError?: boolean;
  limit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard stats
// ─────────────────────────────────────────────────────────────────────────────

export interface StatsFilter {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  channelId?: string;
  actionTyp?: string;
}

export interface DimensionStats {
  /** 차원 값 (예: 'WEB', 'CHAT'). null/empty 는 '(none)' 로 정규화 */
  key: string;
  total: number;
  ok: number;
  fail: number;
  pending: number;
}

// 대시보드 집계는 ERROR_/FAIL_ 구분 없이 모두 fail 로 통합한다.
// (라우트 단의 TraceStatus 는 ERROR/FAIL 을 구분하지만 dashboard 카드/차트는 OK·FAIL·PENDING 3분류만 사용)
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
}

export interface TimeBucket {
  /** ISO 형태 버킷 시작 시각 (예: "2026-05-27T13:00:00") */
  ts: string;
  ok: number;
  fail: number;
  pending: number;
}

export interface TopItem {
  key: string;
  count: number;
}

export interface StatsResponse {
  /** 적용된 기간 */
  range: { from: string | null; to: string | null };
  /** 트레이스 단위 합계 */
  totals: StatusCounts & { total: number };
  /** 트레이스 평균 end-to-end 지연 (ms). 측정 가능한 트레이스가 없으면 null */
  avgLatencyMs: number | null;
  /** 시간대별 버킷 (오름차순). granularity 는 자동: <=2h → 5분, <=48h → 1시간, 그 이상 → 1일 */
  granularity: "5m" | "1h" | "1d";
  buckets: TimeBucket[];
  /** 레이어별 행 단위 통계 */
  layers: LayerStats[];
  /** 상위 사용자 (트레이스 수 기준) */
  topUsers: TopItem[];
  /** 상위 에러/실패 코드 */
  topErrors: TopItem[];
  /** 채널별 트레이스 분포 (count desc) */
  byChannel: DimensionStats[];
  /** 액션 유형별 트레이스 분포 (count desc) */
  byAction: DimensionStats[];
  /** 트레이스 행 데이터를 가져온 전체 행 수 */
  rowCount: number;
}
