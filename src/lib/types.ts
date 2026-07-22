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
  /** 설비/FAC ID — MCP 의 send update 단계에서만 기록(그 외 레이어는 NULL) */
  facId: string | null;
  /** AREA ID — FAC_ID 와 동일 개념, MCP 의 send update 단계에서만 기록(그 외 레이어는 NULL) */
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
  /** 다운스트림 응답 HTTP 상태 코드 (resp update 시 기록, 행 단위). ex. "201", "401" */
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
  /** ACTION_TYP 필터. facId 와 마찬가지로 queryLayer 는 무시하고 /api/traces 가 2단계(traceIds)로 처리 */
  actionTyp?: string;
  /** ERR_CD(=FAIL/ERROR 코드) 부분 일치 검색 (대소문자 무시) */
  errCd?: string;
  /**
   * FAC(FAB) 필터. FAC_ID 는 MCP send update 에서만 기록되므로 행 단위 SQL WHERE 로
   * 걸면 다른 레이어 행이 통째로 빠져 트레이스가 깨진다. queryLayer 는 이 필드를 무시하고,
   * /api/traces 가 2단계로 처리한다: fetchTraceIdsByFac(MCP)로 TRACE_ID 를 먼저 확정한 뒤
   * traceIds 로 전 레이어 행을 조회.
   */
  facId?: string;
  /** 서버 내부용: TRACE_ID IN (...) 조회. FAB 필터 2단계에서 사용하며 클라이언트는 설정하지 않는다. */
  traceIds?: string[];
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
  actionTyp?: string;
  /** 집계에서 제외할 에러 코드들. 해당 코드를 errCd 로 가진 trace 는 모든 집계(total 포함)에서 빠진다. */
  excludeErrCds?: string[];
}

export interface DimensionStats {
  /** 차원 값 (예: 'WEB', 'CHAT'). null/empty 는 '(none)' 로 정규화 */
  key: string;
  total: number;
  ok: number;
  fail: number;
  pending: number;
}

/**
 * "액션 타입별" 집계에서 ACTION_TYP 이 없는 트레이스의 표기 라벨.
 * 모든 BIZ 트레이스는 액션 요청이며(setup/judge 는 BIZ 에 안 쌓임), ACTION_TYP 이 없다는 건
 * ACTION ROUTER 에서 실제 ACTION 노드로 못 가고 튕긴 = 라우팅 단계에서 실패한 액션이라는 뜻이다.
 * 이런 트레이스는 반드시 errCd 를 동반하므로 status 는 이미 fail 로 집계되고 topErrors 에도 실제 코드로 잡힌다.
 * 여기서는 표기만 '(none)' → '라우팅 실패' 로 명확히 한다. (FAC/AREA 의 '(none)'=MCP 미도달 과는 무관)
 * 실제 ACTION_TYP 값이 아니라 표기 전용이라, DimensionBreakdown 에서 필터 클릭 대상에서 제외한다.
 */
export const ROUTING_FAIL_LABEL = "라우팅 실패";

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
  /** Action 전체 응답 지연(ms) 평균 — CUBE(진입 레이어) send→resp 기준이라 전 구간(LLM 포함) 왕복시간.
      Tokens 탭의 LLM 호출 지연(1콜 단위)과는 다른, end-to-end 지표. 측정 가능한 트레이스가 없으면 null */
  avgCubeLatencyMs?: number | null;
  /** 위 응답 지연 평균에 포함된 트레이스 수 */
  cubeLatencyTraces?: number;
}

export interface TopItem {
  key: string;
  count: number;
}

/**
 * 일별 브레이크다운 (실적 리포트용) — 주간/기간 조회에서도 하루 단위 실적이 바로 보이도록
 * 트레이스 시작일(첫 recv, 로컬 자정 floor) 기준으로 상태/사용자/응답지연을 하루 단위로 집계한다.
 * granularity 와 무관하게 항상 "일" 단위 (buckets 와 별개 — buckets 는 차트용 자동 granularity).
 */
export interface DailyStat {
  /** "YYYY-MM-DD" (로컬) */
  date: string;
  total: number;
  ok: number;
  fail: number;
  pending: number;
  /** 해당 일의 고유 사용자 수 (트레이스 대표 사용자 distinct — uniqueUsers 와 같은 기준) */
  users: number;
  /** 해당 일 Action 평균 응답 지연(ms) — CUBE send→resp. 측정 가능한 트레이스가 없으면 null */
  avgCubeLatencyMs: number | null;
  /** 해당 일 기능(ACTION_TYP)별 실행 세부 — total desc 정렬, 없으면 빈 배열. '(none)' 포함 가능 */
  byAction: DailyActionStat[];
}

/** 하루 안에서 한 기능(ACTION_TYP)의 실행/성공/실패 수 (DailyStat.byAction 요소) */
export interface DailyActionStat {
  /** ACTION_TYP 값 (예: "NEST_Seasoning"). null/empty 는 "(none)" */
  key: string;
  total: number;
  ok: number;
  fail: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent profile (이억수 TL 프로필 카드)
//
// 통계(Trace)와는 성격이 다른 "에이전트 소개" 데이터. data/agent-profile.json 에
// 영속 저장하고 ADMIN 페이지에서 편집한다. FTE(성과 지표)는 실데이터로 자동 집계하며
// (fte.ts), 계산식 상수(액션별 환산 분 등)만 프로필에 저장해 ADMIN 에서 커스터마이즈한다.
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkTask {
  /** 카드에 표시할 아이콘 (이모지 1자 권장) */
  icon: string;
  title: string;
  desc: string;
  /** 선택: 처리량/성과 같은 짧은 지표 (예: "1,240건/월") */
  metric?: string;
}

/** FTE 계산식의 액션별 환산 분. action 은 DB 의 ACTION_TYP 값(GAIA 기록)과 일치해야 한다. */
export interface FteActionMinute {
  /** ACTION_TYP 값 (예: "NEST_Seasoning", "AutoQual_Abort", "AutoQual_JobCreate") */
  action: string;
  /** 해당 액션 성공 1건당 환산 분(分) */
  minutes: number;
}

export interface AgentProfile {
  /** 이름 (예: 이억수 TL) */
  name: string;
  /** 호칭 (예: 억수야) */
  nickname: string;
  /** 직급 (예: CL2 1년차) */
  rank: string;
  /** 근무시간 (예: 24시간 365일) */
  workingHours: string;
  /** 보유 스킬 */
  skills: string[];
  /** FTE 계산식: ACTION_TYP 값별 성공 1건당 환산 분. ADMIN 에서 편집 (액션마다 다르게 줄 수 있다) */
  fteActionMinutes: FteActionMinute[];
  /** FTE 계산식: 위 목록에 없는 액션(ACTION_TYP 미기록 트레이스 포함)의 건당 환산 분 (기본 5) */
  fteDefaultMinutes: number;
  /** FTE 계산식: 1 FTE(1인 1년)에 해당하는 연간 분(分). ADMIN 에서 편집 가능 (기본 65,984) */
  fteAnnualMinutes: number;
  /** 한 줄 소개 */
  tagline: string;
  /** 아바타 이모지 (avatarImage 가 없을 때 폴백) */
  avatar: string;
  /** 아바타 사진 경로. public/ 에 올린 파일을 "/파일명" 으로 지정 (예: "/agent.jpg"). 비면 이모지 사용 */
  avatarImage: string;
  /** 역량 강화 로드맵 (사용자가 채우는 자유 텍스트, 줄바꿈 = 항목 구분) */
  roadmap: string;
  /** 하는 일 (정형/비정형 구분 없이 단일 목록) */
  tasks: WorkTask[];
}

export const DEFAULT_PROFILE: AgentProfile = {
  name: "이억수 TL",
  nickname: "억수야",
  rank: "CL2 1년차",
  workingHours: "24시간 365일",
  skills: ["시즈닝", "AutoQual 취소", "AutoQual 실행"],
  fteActionMinutes: [
    { action: "NEST_Seasoning", minutes: 5 },
    { action: "AutoQual_Abort", minutes: 5 },
    { action: "AutoQual_JobCreate", minutes: 5 },
  ],
  fteDefaultMinutes: 5,
  fteAnnualMinutes: 65984,
  tagline: "쉬지 않고 일하는 우리 팀의 AI 에이전트",
  avatar: "🧑‍🍳",
  avatarImage: "",
  roadmap: "",
  tasks: [
    { icon: "🧂", title: "시즈닝 자동 처리", desc: "수신 트랜잭션을 규칙 기반으로 시즈닝해 다운스트림으로 전달", metric: "상시 처리" },
    { icon: "🚫", title: "AutoQual 취소 처리", desc: "요청 받은 AutoQual 을 검증 후 자동으로 취소 처리", metric: "상시 처리" },
    { icon: "▶️", title: "AutoQual 실행 처리", desc: "요청 받은 AutoQual 을 검증 후 자동으로 실행 처리", metric: "상시 처리" },
    { icon: "🔀", title: "채널 라우팅", desc: "CUBE → GAIA → MCP → ONEOIS 경로로 메시지를 정확히 중계" },
    { icon: "🧾", title: "트랜잭션 추적·검증", desc: "TRACE_ID 기준 end-to-end 정합성 확인 및 완료 판정" },
    { icon: "📊", title: "정기 리포트 생성", desc: "사용 추이·성공률·에러 통계를 주기적으로 집계" },
    { icon: "💬", title: "자연어 요청 해석", desc: "정형화되지 않은 사용자 요청의 의도를 파악해 액션으로 변환" },
    { icon: "🧭", title: "예외 상황 판단", desc: "규칙에 없는 상황에서 맥락을 보고 최선의 처리를 선택" },
    { icon: "🧪", title: "신규 레시피 학습", desc: "새로운 시즈닝 패턴을 학습해 처리 범위를 확장" },
    { icon: "🤝", title: "사용자 문의 대응", desc: "실패·지연 트레이스에 대한 질의에 맥락을 담아 응답" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// FTE 성과 지표 (이억수 TL)
//   연간 FTE  = Σ(액션별 성공 수 × 액션별 환산 분) ÷ 연간 분
//   월별 FTE  = (해당 월 환산 분 합) ÷ 연간 분 × 12   (월 → 연 환산)
//   계산식 상수(액션별 분/기본 분/연간 분)는 프로필(fteActionMinutes/fteDefaultMinutes/
//   fteAnnualMinutes, ADMIN 편집)에서 가져온다. FTE 1 = 1년간 1인분(1 person-year).
//   '액션 성공' = 시즈닝·AutoQual 취소·AutoQual 실행 성공 트레이스 (대시보드 ok 기준:
//   에러 없고 CUBE 응답에 실패 문구(ACTION_FAIL_PHRASES)가 없는 트레이스). 액션 구분은
//   GAIA 의 ACTION_TYP (예: NEST_Seasoning/AutoQual_Abort/AutoQual_JobCreate) — db.ts monthlyActionSuccess 참고.
// ─────────────────────────────────────────────────────────────────────────────
export interface FteMonth {
  /** "YYYY-MM" */
  ym: string;
  /** 해당 월 액션 성공 트레이스 수 */
  count: number;
  /** 월 환산(annualized) FTE = 해당 월 환산 분 합 ÷ 연간 분 × 12 */
  fte: number;
}

export interface FteStats {
  /** 누적 연간 FTE = Σ(액션별 성공 수 × 환산 분) ÷ 연간 분 */
  annualFte: number;
  /** 2026-01-01~현재 누적 액션 성공 수 */
  totalCount: number;
  /** 집계 구간 (ISO, TZ 없음) */
  from: string;
  to: string;
  /** 2026-01 ~ 현재 월까지 (빈 월은 0으로 채움) */
  months: FteMonth[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Token usage (GAIA LLM 호출별 토큰 사용량)
//
// 트레이스(BIZ_AIACTIONTXN_HIS)와 별개로, GAIA 가 LLM 을 호출할 때마다 적재하는
// TRX_TOKEN_DET (앱 자체 DB = GAIA, config.ts APP_DB_LAYER) 를 집계한다.
//   - 1차 차원 = NODE(action/judge/setup_guide …), 보조 차원 = MODEL
//   - 한 질문은 셋 중 한 노드로 분기. "질문" 단위는 TRACE_ID(= questions).
//     TRACE_ID 가 없는(액션과 무관한) 호출은 호출 1건이 곧 1질문으로 본다.
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenRow {
  tokenId: string;
  traceId: string | null;
  nodeNm: string | null;
  modelNm: string | null;
  userId: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** LLM 요청→응답 소요시간(ms). GAIA 가 측정 못 했으면 null */
  latencyMs: number | null;
  /** LLM 에 실제로 들어간 쿼리/프롬프트 (디버깅용, 없으면 null) */
  queryCtn: string | null;
  /** ISO 형태 호출 시각 (TZ 없음) */
  callTm: string | null;
}

/** 질문(TRACE_ID) 단위로 묶은 토큰 사용량. TRACE_ID 없으면 호출 1건 = 질문 1건. */
export interface TokenQuestion {
  /** 표시/그룹 키. TRACE_ID 가 있으면 그 값, 없으면 "token:<TOKEN_ID>" */
  qKey: string;
  /** 질문의 TRACE_ID (없으면 null) */
  traceId: string | null;
  /**
   * 이 질문의 LLM 호출이 거친 노드 전부 (첫 호출 순서, 중복 제거).
   * 대표값 하나만 보여주면 "이 노드는 이 모델만 쓴다" 로 오해하게 되어 전체를 내린다.
   */
  nodes: string[];
  /** 이 질문의 호출에 사용된 모델 전부 (첫 호출 순서, 중복 제거) */
  models: string[];
  /**
   * 원본 질의 — 가장 이른 호출의 QUERY_CTN (non-null 우선).
   * 한 질문의 호출들은 보통 같은 QUERY_CTN 을 공유하므로 질문 단위 대표 정보로 취급한다.
   */
  queryCtn: string | null;
  userId: string | null;
  /** 이 질문에서 발생한 LLM 호출 수 */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 마지막 호출 시각 (ISO, TZ 없음) */
  lastTm: string | null;
}

export interface TokenFilter {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  nodeNm?: string;
  modelNm?: string;
  /** 특정 질문(TRACE_ID) 으로 좁히기. 설정 시 응답 calls 에 그 질문의 호출별 행이 채워진다. */
  traceId?: string;
}

export interface TokenBucket {
  /** ISO 형태 버킷 시작 시각 (stats 와 동일 규칙) */
  ts: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 해당 버킷의 LLM 호출 수 */
  calls: number;
  /** 해당 버킷의 평균 LLM 호출 소요시간(ms). LATENCY_MS 가 기록된 호출이 없으면 null */
  avgLatencyMs: number | null;
}

/** 교차 차원 구성 항목 — 노드별 카드에선 그 노드가 쓴 모델들, 모델별 카드에선 그 모델을 쓴 노드들 */
export interface TokenDimSub {
  key: string;
  calls: number;
  totalTokens: number;
}

/** byNode / byModel 공용 — 차원 값별 토큰 집계 */
export interface TokenDimStat {
  /** node 명 또는 model 명. null/empty 는 '(none)' 로 정규화 */
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 차원 값별 평균 LLM 호출 소요시간(ms). LATENCY_MS 기록이 없으면 null */
  avgLatencyMs: number | null;
  /** 교차 구성 (totalTokens desc). byNode 행 = 모델 구성, byModel 행 = 노드 구성 */
  sub: TokenDimSub[];
}

export interface TokenStatsResponse {
  range: { from: string | null; to: string | null };
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number };
  /** 호출당 평균 총 토큰. 호출이 없으면 null */
  avgTotalPerCall: number | null;
  /** 전체 평균 LLM 호출 소요시간(ms). LATENCY_MS 가 기록된 호출이 없으면 null */
  avgLatencyMs: number | null;
  granularity: "5m" | "1h" | "1d";
  buckets: TokenBucket[];
  /** 노드별 토큰 분포 (totalTokens desc) — "노드별" 리더보드 카드 + NODE 필터 옵션 */
  byNode: TokenDimStat[];
  /** 모델별 토큰 분포 (totalTokens desc) — "모델별" 리더보드 카드 + MODEL 필터 옵션 */
  byModel: TokenDimStat[];
  /** 상위 사용자 (TOTAL_TOKENS 기준, count = totalTokens) */
  topUsers: TopItem[];
  /** 질문(TRACE_ID) 단위 토큰 사용량 — 총 토큰 desc, 상위 N건. "질문별 토큰" 표의 데이터 */
  questions: TokenQuestion[];
  /** filter.traceId 가 지정됐을 때 그 질문의 호출별 행(callTm desc). 그 외엔 빈 배열 (행 펼침용) */
  calls: TokenRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 이벤트-FAB 매핑 (하이닉스 FAB 별 기능 선별 적용)
//
// 기능(이벤트)을 FAB 별로 켜고 끄는 매핑. MCP DB 의 TRX_EVENT_MAP 에 저장하며
// (config.ts EVENT_FAB_DB_LAYER — 앱 자체 DB(GAIA)가 아님), MCP 로직이 요청 FAB 이
// 허용 목록에 없으면 팅겨내는 데 쓴다. /event-fabs 화면에서 편집 (관리자 게이트).
// ─────────────────────────────────────────────────────────────────────────────

/** 하이닉스 FAB 목록 — /event-fabs 매트릭스의 고정 컬럼. FAB 이 늘면 여기에 추가 */
export const FAB_IDS = ["C2", "M10", "M11", "M14", "M15", "M16", "Y17"] as const;
export type FabId = typeof FAB_IDS[number];

/** 이벤트(액션) 1건의 허용 FAB 매핑. eventId 는 ACTION_TYP 값과 일치해야 한다 */
export interface EventFabMapping {
  /** 이벤트 식별자 (예: "NEST_Seasoning", "AutoQual_Abort", "AutoQual_JobCreate") */
  eventId: string;
  /** 허용 FAB 목록 (FAB_IDS 값. DB 에 수동 삽입된 미지 값도 왕복 보존을 위해 string) */
  fabs: string[];
}

export interface StatsResponse {
  /** 적용된 기간 */
  range: { from: string | null; to: string | null };
  /** 트레이스 단위 합계 */
  totals: StatusCounts & { total: number };
  /** 트레이스 평균 end-to-end 지연 (ms). 측정 가능한 트레이스가 없으면 null */
  avgLatencyMs: number | null;
  /** Action 전체 응답 지연(ms) 평균 — CUBE send→resp 기준(전 구간 왕복). 측정 가능한 트레이스가 없으면 null */
  cubeAvgLatencyMs?: number | null;
  /** 시간대별 버킷 (오름차순). granularity 는 자동: <=2h → 5분, <=48h → 1시간, 그 이상 → 1일 */
  granularity: "5m" | "1h" | "1d";
  buckets: TimeBucket[];
  /** 레이어별 행 단위 통계 */
  layers: LayerStats[];
  /** 상위 사용자 (트레이스 수 기준) */
  topUsers: TopItem[];
  /** 기간 내 고유 사용자 수 (USER_ID distinct, 트레이스 단위) — 실적 리포트의 "몇 명이 사용했나" */
  uniqueUsers?: number;
  /** 일별 브레이크다운 (from~to 를 덮는 날짜 오름차순, 빈 날은 0) — 실적 리포트 "일별 현황" 용 */
  daily?: DailyStat[];
  /** 상위 에러/실패 코드 */
  topErrors: TopItem[];
  /** 액션 유형별 트레이스 분포 (count desc) */
  byAction: DimensionStats[];
  /** FAC 별 트레이스 분포 (count desc) — FAC 는 MCP 의 send update 에서만 기록되므로 MCP 미도달 트레이스는 (none) */
  byFac: DimensionStats[];
  /** AREA 별 트레이스 분포 (count desc) — FAC 와 동일하게 MCP 미도달 트레이스는 (none) */
  byArea: DimensionStats[];
  /** 집계에 포함된 행 수 (제외 trace 의 행은 빠짐) */
  rowCount: number;
  /** 실제로 적용된 제외 에러 코드 목록 (echo) */
  excludeErrCds: string[];
  /** 제외 필터로 인해 빠진 trace 수. UI 가 사용자에게 "N개 제외 중" 같은 안내를 띄울 때 사용 */
  excludedTraceCount: number;
}
