// 에이전트 프로필 · FTE.

export interface WorkTask {
  icon: string;
  title: string;
  desc: string;
  metric?: string;
}

export interface FteActionMinute {
  action: string;
  minutes: number;
}

export interface AgentProfile {
  name: string;
  nickname: string;
  rank: string;
  workingHours: string;
  skills: string[];
  fteActionMinutes: FteActionMinute[];
  fteDefaultMinutes: number;
  fteAnnualMinutes: number;
  tagline: string;
  avatar: string;
  avatarImage: string;
  roadmap: string;
  tasks: WorkTask[];
  tpmLimit: number;
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

export interface FteMonth {
  ym: string;
  count: number;
  fte: number;
}

export interface FteStats {
  annualFte: number;
  totalCount: number;
  from: string;
  to: string;
  months: FteMonth[];
}
