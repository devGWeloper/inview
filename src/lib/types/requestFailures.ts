// 실패 요청 · 조치정보.

export type FailureStatus = "open" | "investigating" | "resolved" | "ignored";

export const FAILURE_STATUSES: { key: FailureStatus; label: string; hint: string }[] = [
  { key: "open",          label: "미조치",   hint: "아직 확인/조치하지 않음" },
  { key: "investigating", label: "조치중",   hint: "원인 확인·조치 진행 중" },
  { key: "resolved",      label: "조치완료", hint: "원인 파악 및 정정·조치 완료" },
  { key: "ignored",       label: "무시",     hint: "조치 불필요 (오탐·일회성 등)" },
];

export interface RequestFailure {
  traceId: string;
  timekey: string;
  userId: string | null;
  recvTm: string | null;
  recvMsgCtn: string | null;
  respMsgCtn: string | null;
  errCd: string | null;
  errDescCtn: string | null;
  httpStsCd: string | null;
  channelId: string | null;
  sysId: string | null;
  status: FailureStatus;
  note: string | null;
  handler: string | null;
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
  counts: FailureStatusCounts;
  affectedUsers: number;
  available: boolean;
  reason?: string;
  triageAvailable: boolean;
  appEnv: "dev" | "prd";
}

export interface RequestFailureContextItem {
  traceId: string;
  recvTm: string | null;
  actionTyp: string | null;
  errCd: string | null;
  httpStsCd: string | null;
  recvMsgCtn: string | null;
  respMsgCtn: string | null;
  queryCtn: string | null;
  answerCtn: string | null;
  isFailure: boolean;
  isCenter: boolean;
}

export interface RequestFailureContextResponse {
  traceId: string;
  userId: string | null;
  items: RequestFailureContextItem[];
  available: boolean;
  reason?: string | null;
}
