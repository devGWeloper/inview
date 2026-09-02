// 계정 목록 행. 화면과 편집/초기화/삭제 모달이 공유한다.

import { Role } from "@/lib/roles";

export interface Account {
  userId: string;
  name: string;
  work: string | null;
  role: Role;
  useYn: "Y" | "N";
  agentId: string | null;
  global: boolean;
  lastLoginDt: string | null;
  regDt: string | null;
}
