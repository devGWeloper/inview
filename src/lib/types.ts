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
  // GAIA 는 CUBE(#4b6bfb) 바로 옆에 놓이는 자리라(스테퍼·소요 비중 스트립) 파랑과 충분히 갈라져야 한다.
  // 기존 #7c3aed(보라)는 정상 시야에서도 파랑과 ΔE 11 수준이라 구분이 어려워 마젠타 쪽으로 옮겼다.
  { key: "GAIA",   label: "Gaia Agent",      color: "#a21caf" },
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

/**
 * 묶음(= 현장 작업 1건) 안의 TRACE 한 건. TraceSummary 에 액션 표기만 얹은 것.
 */
export interface WorkTraceItem extends TraceSummary {
  /** 액션 칩 라벨 — "PRE" / "POST" / "ERMAP" 등. 판정 불가면 null */
  actionLabel: string | null;
}

/**
 * 여러 요청을 하나로 묶은 "현장 작업" 단위.
 * 전값 측정 → 후값 측정 → ERMAP 요청처럼 요청은 3건이지만 작업은 1건인 흐름을
 * 목록에서 한 행으로 보여주기 위한 것. 묶는 규칙은 lib/workGroup.ts 참고.
 *
 * 대부분의 묶음은 TRACE 1건짜리다 (= 지금까지의 목록 행과 같음).
 */
export interface WorkSummary {
  /** 묶음 식별자 = 묶음의 첫 TRACE_ID */
  workId: string;
  /** 묶음을 건 챔버 ID. 챔버를 못 읽어 단독으로 남은 묶음은 null */
  chamberId: string | null;
  firstRecvTm: string | null;
  lastRecvTm: string | null;
  /** 안에 든 TRACE 중 가장 나쁜 상태 */
  status: TraceStatus;
  /** 시간순(오름차순) TRACE 목록. 최소 1건 */
  traces: WorkTraceItem[];
}

export interface TraceDetailResponse {
  traceId: string;
  rows: TraceRow[];
}

export interface TraceListResponse {
  works: WorkSummary[];
  /** 묶음 개수 (TRACE 건수가 아니다) */
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
  /**
   * 서버 내부용: 목록(요약)용 가벼운 컬럼만 읽는다 — 요청/전달 본문 제외.
   * 이 모드의 행은 recvMsgCtn/sendMsgCtn 이 항상 null 이다 (db.ts SUMMARY_COLUMNS 참고).
   */
  lean?: boolean;
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
  /** ⚠️ 포함(inclusive) 시간 — 행의 SEND_TM→RESP_TM 평균이라 하위 레이어 대기시간을 전부 포함한다.
      CUBE ⊃ GAIA ⊃ MCP ⊃ ONEOIS 로 중첩되므로 "어느 레이어가 느린가" 에는 쓸 수 없다. 진단용 참고값. */
  avgRespMs: number | null;
  /** 자체 소요시간(self time) 평균 ms — 하위 대기를 뺀 이 레이어 자신의 몫. 아래 selfMsTotal 참고 */
  avgSelfMs: number | null;
  /** 자체 소요시간 합 ms — 레이어 간 "시간 비중" 의 분자. Σ(전 레이어) = 전체 응답시간 합 */
  selfMsTotal: number;
  /** 이 레이어에서 처음 실패가 발생한 트레이스 수 (errCd 를 가진 가장 깊은 레이어로 귀속) */
  failOriginTraces: number;
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
  /** 해당 일 Action 평균 응답 속도(ms) — CUBE send→resp. 측정 가능한 트레이스가 없으면 null */
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
  /**
   * 1TICK 모니터 기준선 — 분당 토큰 한도. 0 = 미설정(추이만 표시).
   *
   * ⚠️ config.yml 의 agents[].tpmLimit 보다 **이 값이 우선**한다(0 이 아니면).
   *    한도는 자주 바뀌는 운영 값이라 화면(/admin)에서 고치고, config 값은 초기값/폴백이다.
   *    접속정보는 여전히 config.yml 전용이다.
   */
  tpmLimit: number;
  /** 1TICK 모니터 기준선 — 분당 호출 한도. 0 = 미설정. (tpmLimit 과 같은 규칙) */
  rpmLimit: number;
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
  tpmLimit: 0,
  rpmLimit: 0,
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
  /** LLM 요청→응답 소요시간(ms). 실패 호출이면 예외까지의 경과시간. 측정 없으면 null */
  latencyMs: number | null;
  /** LLM 에 실제로 들어간 쿼리/프롬프트 (디버깅용, 없으면 null) */
  queryCtn: string | null;
  /**
   * 호출 결과 코드 — 'OK' | 'ERROR' (타임아웃도 ERROR). 컬럼 미적재/미생성이면 null.
   * 해석은 lib/tokenStatus.ts 의 callStatus() 로 통일한다(문구로 TIMEOUT 을 갈라냄).
   */
  statCd: string | null;
  /** 실패 사유 (STAT_CD='ERROR' 일 때. 성공/미적재면 null) */
  errCtn: string | null;
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
  /** 이 질문에서 발생한 LLM 호출 수 (실패 호출 포함) */
  calls: number;
  /**
   * 이 질문에서 LLM 호출이 실패(타임아웃)한 노드 이름들.
   * 표의 NODE 칩 중 어느 노드에서 끊겼는지 표시하는 데만 쓴다. 미적재/전건 성공이면 빈 배열.
   */
  errorNodes: string[];
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
  /**
   * 어느 에이전트의 TRX_TOKEN_DET 를 볼지 (config.yml agents[].id).
   * ⚠️ WHERE 절 조건이 아니라 **커넥션 선택**이다 — 에이전트는 행이 아니라 DB 단위로 갈린다.
   * 생략 = 기본 에이전트.
   */
  agentId?: string;
  /**
   * 질문 단위 집계(questions / topUsers / calls)를 건너뛴다.
   * 그 세 쿼리는 상위 500건 LISTAGG 라 무겁고, **질의 원문·사번을 실어 나른다** —
   * 현업 실적(/api/insights)처럼 화면에 쓰지도 않고 내려서도 안 되는 호출부는 켜 둔다.
   */
  skipQuestions?: boolean;
}

export interface TokenBucket {
  /** ISO 형태 버킷 시작 시각 (stats 와 동일 규칙) */
  ts: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 해당 버킷의 LLM 호출 수 (실패 호출 포함) */
  calls: number;
  /**
   * 해당 버킷의 평균 LLM 호출 소요시간(ms). **성공 호출만** 대상 —
   * 타임아웃(예: 90s 한도)이 섞이면 평균이 한도값 쪽으로 끌려가 "느려졌다" 로 오독된다.
   * LATENCY_MS 가 기록된 성공 호출이 없으면 null.
   */
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
  /** 호출 수 (실패 호출 포함) */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 차원 값별 평균 LLM 호출 소요시간(ms). **성공 호출만**. 기록이 없으면 null */
  avgLatencyMs: number | null;
  /** 교차 구성 (totalTokens desc). byNode 행 = 모델 구성, byModel 행 = 노드 구성 */
  sub: TokenDimSub[];
}

export interface TokenStatsResponse {
  range: { from: string | null; to: string | null };
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number };
  /** 호출당 평균 총 토큰. 호출이 없으면 null */
  avgTotalPerCall: number | null;
  /** 전체 평균 LLM 호출 소요시간(ms). **성공 호출만**. 기록이 없으면 null */
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
  /** 이 응답이 어느 에이전트를 집계한 것인지 (라우트가 에코). 늦게 도착한 응답 폐기용 */
  agentId?: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// Improvement Center > Request Failure Tracker (/improvement — 관리자 콘솔)
//
// Improvement Center = AI 에이전트 개선 허브(확장 가능한 플랫폼). 그 첫 모듈이
// Request Failure Tracker — 에이전트가 처리하지 못하고 튕긴 "실패 요청"을 추적·정정한다.
//
// "실패 요청" = GAIA(ACTION_TYP 권위 레이어 = 앱 자체 DB)에서 메시지는 받았는데
// ACTION_TYP 을 못 붙인 요청: ACTION_TYP IS NULL AND RECV_MSG_CTN IS NOT NULL.
// 보통 액션 라우팅 실패이거나 LLM 오류로 튕긴 요청이다. 관리자가 이런 요청을 훑어보고
// 조치 상태를 남긴다. 조치 상태는 앱 자체 DB(GAIA)의 TRX_REQ_FAILURE_INF 에 영속하고
// (src/lib/requestFailures.ts, sql/create_trx_req_failure_inf.sql), 실패 요청 원본(BIZ)에
// TRACE_ID 로 LEFT JOIN 해서 얹는다. 테이블에 행이 없는 요청 = '미조치(open)'.
// ─────────────────────────────────────────────────────────────────────────────

/** 실패 요청 조치 상태 코드값 (DB STATUS 컬럼에 그대로 저장) */
export type FailureStatus = "open" | "investigating" | "resolved" | "ignored";

/** 조치 상태 목록 (표시 순서 = 워크플로우 순서). key=DB 저장값, label=화면 표기 */
export const FAILURE_STATUSES: { key: FailureStatus; label: string; hint: string }[] = [
  { key: "open",          label: "미조치",   hint: "아직 확인/조치하지 않음" },
  { key: "investigating", label: "조치중",   hint: "원인 확인·조치 진행 중" },
  { key: "resolved",      label: "조치완료", hint: "원인 파악 및 정정·조치 완료" },
  { key: "ignored",       label: "무시",     hint: "조치 불필요 (오탐·일회성 등)" },
];

/** 실패 요청 1건 (BIZ 원본 + TRX_REQ_FAILURE_INF 조치 오버레이 병합) */
export interface RequestFailure {
  traceId: string;
  timekey: string;
  userId: string | null;
  /** 요청 수신 시각 (ISO, TZ 없음) */
  recvTm: string | null;
  /** 사용자의 원본 요청 메시지 (실패 판정의 핵심 근거 — 무엇을 요청했나) */
  recvMsgCtn: string | null;
  /** 응답/에러 본문 (튕긴 경우 사유가 담기기도) */
  respMsgCtn: string | null;
  errCd: string | null;
  errDescCtn: string | null;
  httpStsCd: string | null;
  channelId: string | null;
  sysId: string | null;
  // ── 조치 오버레이 (TRX_REQ_FAILURE_INF, 없으면 기본값) ──
  status: FailureStatus;
  note: string | null;
  handler: string | null;
  /** 최근 조치(수정) 시각 (ISO, TZ 없음). 미조치(행 없음)면 null */
  triagedAt: string | null;
}

export interface FailureStatusCounts {
  open: number;
  investigating: number;
  resolved: number;
  ignored: number;
}

export interface RequestFailureListResponse {
  items: RequestFailure[];
  total: number;
  /** 조회된 창(window) 내 상태별 카운트 */
  counts: FailureStatusCounts;
  /** 조회된 창 내 실패 요청을 낸 고유 사용자 수 */
  affectedUsers: number;
  /** GAIA(ACTION_TYP 권위 = 앱 자체 DB) 조회 가능 여부. false 면 화면이 안내 */
  available: boolean;
  /** available=false 사유 */
  reason?: string;
  /** 조치정보 테이블(TRX_REQ_FAILURE_INF) 사용 가능 여부. false 면 상태는 전부 미조치로 표시되고 저장 불가 */
  triageAvailable: boolean;
  appEnv: "dev" | "prd";
}

/** 특정 실패 요청 주변의 "사용자 요청 흐름" 한 노드 (같은 USER_ID 의 앞뒤 요청) */
export interface RequestFailureContextItem {
  traceId: string;
  /** 요청 수신 시각 (ISO, TZ 없음) */
  recvTm: string | null;
  /** 라우팅된 액션 (null = 이 요청도 라우팅 실패 = 실패 요청) */
  actionTyp: string | null;
  errCd: string | null;
  httpStsCd: string | null;
  recvMsgCtn: string | null;
  respMsgCtn: string | null;
  /**
   * 사용자 관점의 질문(Q). 사용자 I/F 레이어인 CUBE 의 SEND_MSG_CTN 이 권위값이다.
   * CUBE 를 못 읽는 경우(미구성 등) TRX_TOKEN_DET.QUERY_CTN 으로 폴백하고,
   * 그마저 없으면 null → 화면이 RECV_MSG_CTN 을 보여준다.
   */
  queryCtn: string | null;
  /**
   * 사용자 관점의 최종 응답(A) = CUBE 의 RESP_MSG_CTN.
   * CUBE 가 사용자 I/F 라 이 값이 사용자가 실제로 받은 답이다. 하위 레이어의
   * RESP_MSG_CTN(예: GAIA)은 다운스트림 툴 응답이므로 A 가 아니다.
   */
  answerCtn: string | null;
  /** ACTION_TYP 이 없어 이 요청도 실패(라우팅 실패)인가 */
  isFailure: boolean;
  /** 지금 선택한(중심) 실패 요청인가 */
  isCenter: boolean;
}

export interface RequestFailureContextResponse {
  traceId: string;
  userId: string | null;
  /** 시간 오름차순. 중심 요청 앞뒤로 같은 사용자의 요청 흐름 */
  items: RequestFailureContextItem[];
  available: boolean;
  /**
   * 흐름이 비어 있는 이유. available=false 면 조회 실패 사유(ORA 에러 등),
   * available=true 인데 채워져 있으면 기준값(USER_ID·RECV_TM) 부재 같은 데이터 사유.
   * 빈 흐름과 조회 실패를 화면에서 구분하기 위한 필드 — 정상 조회면 없다.
   */
  reason?: string | null;
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
  /** 레이어별 행 단위 통계 + 자체 소요시간(self time) 분해 */
  layers: LayerStats[];
  /** 자체 소요시간 분해에 사용된 트레이스 수 (진입 레이어의 recv/resp 가 모두 기록된 완료 트레이스) */
  selfTimeTraces?: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// 현업(FIELD) 실적 — /api/insights
//
// StatsResponse 를 그대로 내려보내면 안 된다. 거기엔 사용자 ID(topUsers), 에러 코드
// (topErrors), 레이어 내부 지표(layers/selfTime) 처럼 현업에게 보일 이유가 없는 정보가 섞여 있다.
//
// ⚠️ 그래서 **빼는 방식이 아니라 담는 방식**으로 만든다 — 라우트가 이 타입의 필드만 골라
//    새 객체를 짓는다(`toInsights`). StatsResponse 에 필드가 추가돼도 여기로는 새지 않는다.
//    이 타입에 필드를 더할 때는 "현업이 남의 요청 내용/신원을 알 수 있는가" 를 먼저 볼 것.
// ─────────────────────────────────────────────────────────────────────────────

/** 실적 화면의 시간 버킷 — 상태 3종과 평균 응답시간만. (트레이스 수 등 진단값 제외) */
export interface InsightsBucket {
  ts: string;
  ok: number;
  fail: number;
  pending: number;
  avgCubeLatencyMs?: number | null;
}

/** 실적 화면의 일별 행 — 사용자는 **수(count)만**, 누가인지는 내려가지 않는다. */
export interface InsightsDaily {
  date: string;
  total: number;
  ok: number;
  fail: number;
  pending: number;
  /** 그날의 고유 사용자 '수' */
  users: number;
  avgCubeLatencyMs: number | null;
  byAction: DailyActionStat[];
}

/** 실적 화면에 노출할 에이전트 소개 — 프로필의 공개 항목만 (편집용 계산식 등은 제외) */
export interface InsightsAgent {
  name: string;
  nickname: string;
  tagline: string;
  avatar: string;
  avatarImage: string;
}

/**
 * 실적 화면의 LLM 토큰 요약 — Tokens 탭 응답에서 **모델까지만** 옮겨 담은 것.
 * ⚠️ 노드명(내부 구조) · 사번 · 질의 원문은 이 타입에 자리가 없다.
 */
export interface InsightsTokens {
  granularity: "5m" | "1h" | "1d";
  buckets: TokenBucket[];
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number };
  /** 호출당 평균 총 토큰. 호출이 없으면 null */
  avgTotalPerCall: number | null;
  /** 전체 평균 LLM 호출 소요시간(ms). **성공 호출만**. 기록이 없으면 null */
  avgLatencyMs: number | null;
  /** 모델별 토큰/호출/속도 (totalTokens desc) */
  byModel: InsightsModelTokens[];
}

export interface InsightsModelTokens {
  key: string;
  calls: number;
  totalTokens: number;
  avgLatencyMs: number | null;
}

/**
 * 실적 화면의 타임아웃 요약. `available=false` = GAIA 가 실패 호출을 아직 적재하지 않음
 * (0 건과 구분해야 한다 — 0 으로 보이면 "문제 없음" 으로 오독된다).
 */
export interface InsightsTimeouts {
  available: boolean;
  granularity: "5m" | "1h" | "1d";
  buckets: TimeoutBucket[];
  /** 기간 내 전체 LLM 호출 수 (실패율 분모) */
  totalCalls: number;
  failedCalls: number;
  timeoutCalls: number;
  /** 실패 호출이 하나라도 있는 고유 질문 수 = "질문 몇 개가 깨졌나" */
  affectedTraces: number;
  /** 모델별 실패/타임아웃 (failed desc) */
  byModel: InsightsModelTimeouts[];
}

export interface InsightsModelTimeouts {
  key: string;
  failed: number;
  timeout: number;
  calls: number;
}

export interface InsightsResponse {
  range: { from: string | null; to: string | null };
  /** 트레이스(=요청) 단위 합계 */
  totals: StatusCounts & { total: number };
  /** 성공률 0~1. 집계 대상이 없으면 null */
  successRate: number | null;
  /** 평균 응답 속도 ms (CUBE send→resp, 전 구간 왕복). 측정 가능한 트레이스가 없으면 null */
  avgResponseMs: number | null;
  /** 기간 내 고유 사용자 수 (신원 아님, 수만) */
  uniqueUsers: number;
  granularity: "5m" | "1h" | "1d";
  buckets: InsightsBucket[];
  daily: InsightsDaily[];
  /** 기능(ACTION_TYP)별 실행/성공/실패 */
  byAction: DimensionStats[];
  /** FAB 별 실행/성공/실패 — 조직 단위 집계라 개인정보가 아니다 */
  byFac: DimensionStats[];
  agent: InsightsAgent;
  /** 누적 FTE 성과. CUBE 미연결이면 null */
  fte: FteStats | null;
  /** LLM 토큰 요약. 조회 실패/미구성이면 null → 화면이 그 섹션만 비운다 */
  tokens: InsightsTokens | null;
  /** 타임아웃 요약. 조회 실패/미구성이면 null */
  timeouts: InsightsTimeouts | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 타임아웃 추적 (Timeout 탭)
//
// 출처는 **TRX_TOKEN_DET 한 곳**이다. GAIA 가 call_llm 을 try/except 로 감싸
// 실패한 호출도 1행 적재하므로(STAT_CD='ERROR' + ERR_CTN + LATENCY_MS = 예외까지 기다린 시간),
// "어느 노드/모델에서, 어떤 질의가, 얼마나 기다리다 끊겼는지" 를 추정 없이 그대로 읽는다.
// 타임아웃/일반 오류 구분은 ERR_CTN 문구 (lib/tokenStatus.ts 의 callStatus/SQL_TIMEOUT_PRED).
// ─────────────────────────────────────────────────────────────────────────────

export interface TimeoutBucket {
  /** ISO 버킷 시작 시각 (TZ 없음) */
  ts: string;
  /** 해당 버킷의 실패 호출 수 */
  failed: number;
  /** 그중 타임아웃 */
  timeout: number;
}

/** 실패한 LLM 호출 1건 */
export interface TimeoutItem {
  tokenId: string;
  /** 호출 시각 */
  callTm: string | null;
  traceId: string | null;
  nodeNm: string | null;
  modelNm: string | null;
  userId: string | null;
  /** LLM 에 들어간 질의 (QUERY_CTN) */
  queryCtn: string | null;
  /** 예외까지 기다린 시간 (ms) */
  latencyMs: number | null;
  statCd: string | null;
  /** 실패 사유 */
  errCtn: string | null;
}

/** 노드별/모델별/사용자별 실패 집계 행 */
export interface TimeoutDimStat {
  key: string;
  /** 실패 호출 수 */
  failed: number;
  /** 그중 타임아웃 */
  timeout: number;
  /** 그 노드/모델/사용자의 기간 내 전체 호출 수 (실패율 계산용) */
  calls: number;
}

export interface TimeoutStatsResponse {
  range: { from: string | null; to: string | null };
  granularity: "5m" | "1h" | "1d";
  /**
   * TRX_TOKEN_DET 에 STAT_CD/ERR_CTN 이 있는지.
   * false = GAIA 적재 전(또는 조회 불가) → 모든 수치 0, 화면은 "적재 전" 안내만 띄운다.
   */
  available: boolean;
  /** 기간 내 전체 LLM 호출 수 */
  totalCalls: number;
  /** 실패 호출 수 */
  failedCalls: number;
  /** 그중 타임아웃 호출 수 */
  timeoutCalls: number;
  /** 타임아웃을 겪은 고유 사용자 수 */
  affectedUsers: number;
  /**
   * 실패 호출이 하나라도 있는 고유 질문(TRACE_ID) 수 = "사용자 질문 몇 개가 깨졌나".
   * TRACE_ID 가 없는 호출(비액션 흐름)은 셀 수 없어 제외된다.
   */
  affectedTraces: number;
  /** 마지막 실패 발생 시각 */
  lastAt: string | null;
  buckets: TimeoutBucket[];
  /** 실패가 난 노드 (failed desc) — 적재된 그 호출의 NODE_NM 이라 추정이 아니다 */
  byNode: TimeoutDimStat[];
  /** 실패가 난 모델 (failed desc) */
  byModel: TimeoutDimStat[];
  /** 실패를 겪은 사용자 (failed desc) */
  byUser: TimeoutDimStat[];
  /** 최근 실패 호출 목록 (callTm desc) */
  items: TimeoutItem[];
  /**
   * 모델 × 시간 히트맵 — 모델별로 버킷마다 총 호출/실패/타임아웃 을 편성한다.
   * buckets 와 같은 시간 격자를 공유한다 (빈 셀은 calls=0 으로 채움).
   * 상위 N개(호출 많은 순) 모델만 포함해 화면 밀도를 관리한다.
   */
  modelTrend: TimeoutModelSeries[];
  /** 오류 사유 top N — ERR_CTN 앞머리로 클러스터링해 자주 나오는 문구를 세운다 */
  topReasons: TimeoutReason[];
  /** 이 응답이 어느 에이전트를 집계한 것인지 (라우트가 에코). 늦게 도착한 응답 폐기용 */
  agentId?: string;
}

/** 히트맵 셀 하나 — 특정 모델·특정 시간 버킷의 요청/실패/타임아웃 수 */
export interface TimeoutModelCell {
  ts: string;
  calls: number;
  failed: number;
  timeout: number;
}

/** 모델 1개의 시간 격자 */
export interface TimeoutModelSeries {
  model: string;
  totalCalls: number;
  totalFailed: number;
  totalTimeout: number;
  /** buckets 와 정확히 같은 순서/시각으로 정렬된 셀 배열 */
  cells: TimeoutModelCell[];
}

/** 자주 발생한 오류 사유 (ERR_CTN 앞 100자 기준 클러스터) */
export interface TimeoutReason {
  /** 그룹핑 키 겸 표시 텍스트 */
  reason: string;
  failed: number;
  timeout: number;
  lastAt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1TICK — 분당 TPM/RPM 모니터 (Tokens 탭의 "1TICK" 프리셋)
//
// ⚠️ 정각 분 버킷만으로는 TPM/RPM 초과를 판정할 수 없다. 사내 제약은 "임의의 연속 60초"
//    기준이라, 12:01:13~12:02:12 에 몰린 버스트는 정각 버킷에선 두 칸으로 쪼개져
//    어느 칸도 한도를 안 넘는 것처럼 보인다(실제로는 초과). 그래서 이 화면은
//    **초 단위 집계 위에서 슬라이딩 60초 윈도우의 최대값**을 따로 계산해 같이 그린다.
//      - fixed*  = 정각 분 합계 (참고용 막대)
//      - roll*   = 그 분에 시작하는 60초 윈도우 중 최대값 (초과 판정의 실제 기준)
//    한도(tpmLimit/rpmLimit)는 config.yml 의 agents[] 에서 온다 (단일 소스).
// ─────────────────────────────────────────────────────────────────────────────

/** 1TICK 조회 필터 — TokenFilter 의 시간/차원 필터와 동일 규칙 (traceId 없음) */
export interface TickFilter {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  nodeNm?: string;
  modelNm?: string;
  /**
   * 어느 에이전트의 TRX_TOKEN_DET 를 볼지 (config.yml agents[].id).
   * ⚠️ WHERE 절 조건이 아니라 **커넥션 선택**이다 — 에이전트는 행이 아니라 DB 단위로 갈린다.
   * 생략 = 기본 에이전트.
   */
  agentId?: string;
}

/** 분 1칸. 빈 분도 0 으로 채워 내려간다(차트 격자를 균일하게 유지). */
export interface TickMinute {
  /** 분 시작 시각 (ISO 형태, TZ 없음) */
  ts: string;
  /** 정각 분 [ts, ts+60s) 합계 — 참고용 */
  fixedTokens: number;
  fixedCalls: number;
  fixedInputTokens: number;
  fixedOutputTokens: number;
  /** 이 분 안에서 시작하는 60초 윈도우 중 토큰 최대치 (= 그 시점 실제 TPM) */
  rollTokens: number;
  /** rollTokens 를 만든 윈도우의 시작 시각 (초 단위 ISO). 값이 0 이면 null */
  rollTokensAt: string | null;
  /** 이 분 안에서 시작하는 60초 윈도우 중 호출 수 최대치 (= 그 시점 실제 RPM) */
  rollCalls: number;
  /** rollCalls 를 만든 윈도우의 시작 시각 (초 단위 ISO). 값이 0 이면 null */
  rollCallsAt: string | null;
}

/** 기간 전체의 롤링 피크 1건 */
export interface TickPeak {
  value: number;
  /** 피크 윈도우 시작 시각 (초 단위 ISO). 데이터가 없으면 null */
  at: string | null;
}

/** 드릴다운용 호출 1건 — "왜 초과났나" 를 보려고 초과 윈도우 안의 호출을 나열한다 */
export interface TickCall {
  callTm: string | null;
  traceId: string | null;
  nodeNm: string | null;
  modelNm: string | null;
  userId: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number | null;
  statCd: string | null;
  errCtn: string | null;
}

export interface TickStatsResponse {
  range: { from: string | null; to: string | null };
  /** 분 격자 (빈 분 포함, 오름차순) */
  minutes: TickMinute[];
  /** 기간 전체 롤링 60초 피크 */
  peakTpm: TickPeak;
  peakRpm: TickPeak;
  /** 기간 내 총 호출/총 토큰 (KPI 용) */
  totals: { calls: number; totalTokens: number };
  /** 드릴다운용 호출 목록 (callTm asc). 상한을 넘으면 잘리고 truncated=true */
  calls: TickCall[];
  /** calls 가 상한(TICK_CALL_LIMIT)에 걸려 잘렸는지 */
  truncated: boolean;
  /** 이 응답이 어느 에이전트를 집계한 것인지 (라우트가 에코). 늦게 도착한 응답 폐기용 */
  agentId?: string;
}

/** 롤링 윈도우 길이(초). TPM/RPM 의 "per minute" 정의 그대로 60초. */
export const TICK_WINDOW_SEC = 60;

// ─────────────────────────────────────────────────────────────────────────────
// 멀티 에이전트 — Tokens / Timeout 화면이 어느 에이전트의 TRX_TOKEN_DET 를 볼지.
//
// ⚠️ AgentInfo 는 브라우저로 내려간다. 접속정보(user/password/connectString)는
//    절대 포함하지 않는다 — 구성 여부는 dbConfigured 로만 알린다.
//    접속정보를 다루는 서버 전용 형태는 config.ts 의 AgentDef 다.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentInfo {
  /** 불변 키. URL(?agent=) · localStorage · TRX_USER_MAS.AGENT_ID 에서 이 값을 쓴다 */
  id: string;
  name: string;
  /** 아바타 이모지 (셀렉터/상단바 칩용) */
  avatar: string;
  /** 기본 에이전트인가 (= BIZ 기반 화면까지 쓰는 에이전트) */
  isDefault: boolean;
  /** 1TICK 기준선. 0 = 미설정 */
  tpmLimit: number;
  rpmLimit: number;
  /** config 에 DB 접속정보가 채워져 있는가. false 면 조회가 빈 통계로 돌아온다 */
  dbConfigured: boolean;
}

export interface AgentsResponse {
  agents: AgentInfo[];
  defaultId: string;
}
