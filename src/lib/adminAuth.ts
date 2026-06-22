// 관리자 편집 보호용 비밀번호.
// ⚠️ 하드코딩된 단순 게이트 (실제 보안용 아님 — 클라이언트 번들에도 노출됨).
//    제대로 된 인증이 필요해지면 서버 세션/환경변수 기반으로 교체할 것.
export const ADMIN_PASSWORD = "admin";

/** PUT /api/profile 에 비밀번호를 싣는 헤더 이름 */
export const ADMIN_PASSWORD_HEADER = "x-admin-password";
