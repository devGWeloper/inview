// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ TEMPORARY — ONEOIS 레이어 DB 미연결 대응 (제거 예정)
//
// ONEOIS 레이어에 아직 DB 연결이 없어 모든 트레이스가 allComplete=false 가 되고,
// 에러 코드가 없는 트레이스는 전부 "pending" 으로 분류되어 대시보드 값이 무의미해진다.
//
// 임시 규칙: 에러 코드가 없는 미완료(pending) 트레이스는 CUBE 레이어의 RESP 메시지로 판정한다.
//   - CUBE RESP 메시지에 ACTION_FAIL_RULES 의 실패 문구 포함 → fail
//     (시즈닝 = "Seasoning 실패", AutoQual 취소 = "AutoQual 취소 실패",
//      AutoQual 실행 = "AutoQual 실행 실패")
//   - 그 외                                                  → ok (성공으로 간주)
//
// 추가 보정: 위 실패 트레이스는 실제 errCd 가 없어 stats 의 topErrors 리스트에
// 잡히지 않는다. stats route 에서 matchedActionFailCodes() 로 가상 코드를 카운트한다.
//
// ONEOIS DB 연결이 완료되면 이 파일과 호출부(traces/stats route 의 TEMP 블록)를
// 삭제하면 원래의 pending 동작으로 복귀한다.
// ─────────────────────────────────────────────────────────────────────────────
import { TraceRow, TraceStatus } from "./types";

/** 액션별 실패 판정 규칙. 새 액션이 생기면 여기에 한 줄 추가. code 는 topErrors 에 노출할 가상 에러 코드(실제 DB 에는 존재하지 않음). */
export const ACTION_FAIL_RULES = [
  { action: "시즈닝",        phrase: "Seasoning 실패",     code: "FAIL_SEASONING" },
  { action: "AutoQual 취소", phrase: "AutoQual 취소 실패", code: "FAIL_AQ_CANCEL" },
  { action: "AutoQual 실행", phrase: "AutoQual 실행 실패", code: "FAIL_AQ_RUN" },
] as const;

/** FTE 집계(monthlyActionSuccess)에서 성공 제외용으로 쓰는 실패 문구 목록 */
export const ACTION_FAIL_PHRASES: readonly string[] = ACTION_FAIL_RULES.map((r) => r.phrase);

function cubeRespIncludes(rows: TraceRow[], phrase: string): boolean {
  return rows.some(
    (r) => r.layer === "CUBE" && !!r.respMsgCtn && r.respMsgCtn.includes(phrase)
  );
}

/** CUBE RESP 에 매칭된 실패 규칙들의 가상 에러 코드 목록 (매칭 없으면 빈 배열) */
export function matchedActionFailCodes(rows: TraceRow[]): string[] {
  return ACTION_FAIL_RULES.filter((rule) => cubeRespIncludes(rows, rule.phrase)).map((r) => r.code);
}

/** CUBE RESP 에 액션 실패 문구(시즈닝/AutoQual 취소·실행)가 하나라도 있는지 */
export function hasActionFailure(rows: TraceRow[]): boolean {
  return ACTION_FAIL_RULES.some((rule) => cubeRespIncludes(rows, rule.phrase));
}

/** pending 대체 판정: 액션 실패 문구가 있으면 fail, 없으면 ok */
export function classifyPendingByCubeResp(rows: TraceRow[]): TraceStatus {
  return hasActionFailure(rows) ? "fail" : "ok";
}
