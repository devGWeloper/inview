// ─────────────────────────────────────────────────────────────────────────────
// 권한(Role) 단일 소스.
//
//   ADMIN(운영자) > BR(상위 권한자) > DEV(개발자/일반 READ)
//
// 이 파일은 클라이언트 컴포넌트 · Edge 미들웨어 · 서버 라우트 모두에서 import 하므로
// Node 전용/서버 전용 모듈(fs, crypto, oracledb 등)을 절대 import 하지 않는다.
// 화면↔경로↔권한 매핑의 유일한 출처 — 접근 범위가 바뀌면 ROUTE_RULES 만 고친다.
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "ADMIN" | "BR" | "DEV";

export const ROLES: Role[] = ["ADMIN", "BR", "DEV"];

/** 화면 표기용 한글 라벨 */
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "운영자",
  BR: "BR",
  DEV: "개발자",
};

/** 권한 선택 UI 등에서 쓰는 짧은 설명 */
export const ROLE_DESC: Record<Role, string> = {
  ADMIN: "전체 관리 · 계정/프로필 편집",
  BR: "리포트 · 개선센터 · 이벤트-FAB 열람/편집",
  DEV: "Traces · Dashboard · Tokens · Agent 조회",
};

/** 권한 서열 (클수록 상위). 비교의 유일한 근거. */
const RANK: Record<Role, number> = { ADMIN: 3, BR: 2, DEV: 1 };

export function isRole(v: unknown): v is Role {
  return v === "ADMIN" || v === "BR" || v === "DEV";
}

/** role 이 min 이상의 권한인가 (ADMIN>=BR>=DEV). */
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

// ── 경로 → 최소 권한 매핑 ────────────────────────────────────────────────
// prefix 와 정확히 같거나 그 하위 경로면 min 권한을 요구한다.
// 여기 없는(로그인만 되면 되는) 경로는 DEV 로 취급 = 인증된 사용자 누구나.
export interface RouteRule {
  prefix: string;
  min: Role;
}

export const ROUTE_RULES: RouteRule[] = [
  // 운영자 전용
  { prefix: "/admin", min: "ADMIN" }, // 프로필 편집
  // BR 이상
  { prefix: "/accounts", min: "BR" }, // 계정 관리 화면 (등록 권한 ADMIN/BR)
  { prefix: "/api/accounts", min: "BR" }, // 계정 CRUD API
  { prefix: "/report", min: "BR" }, // 실적 리포트
  { prefix: "/improvement", min: "BR" }, // Improvement Center
  { prefix: "/event-fabs", min: "BR" }, // 이벤트-FAB 매핑
];

/** 해당 경로에 필요한 최소 권한. 규칙에 없으면 null(= 인증만 되면 접근 가능). */
export function requiredRoleForPath(pathname: string): Role | null {
  for (const r of ROUTE_RULES) {
    if (pathname === r.prefix || pathname.startsWith(r.prefix + "/")) return r.min;
  }
  return null;
}
