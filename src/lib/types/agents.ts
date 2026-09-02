// 에이전트 목록 (클라이언트용 — 접속정보 없음).

export interface AgentInfo {
  id: string;
  name: string;
  avatar: string;
  isDefault: boolean;
  tpmLimit: number;
  rpmLimit: number;
  dbConfigured: boolean;
}

export interface AgentsResponse {
  agents: AgentInfo[];
  defaultId: string;
}
