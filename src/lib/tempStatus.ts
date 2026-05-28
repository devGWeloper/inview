// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ TEMPORARY — ONEOIS 레이어 DB 미연결 대응 (제거 예정)
//
// ONEOIS 레이어에 아직 DB 연결이 없어 모든 트레이스가 allComplete=false 가 되고,
// 에러 코드가 없는 트레이스는 전부 "pending" 으로 분류되어 대시보드 값이 무의미해진다.
//
// 임시 규칙: 에러 코드가 없는 미완료(pending) 트레이스는 CUBE 레이어의 RESP 메시지로 판정한다.
//   - CUBE RESP 메시지에 "Seasoning 실패" 문구 포함  → fail
//   - 그 외                                          → ok (성공으로 간주)
//
// 추가 보정: Seasoning 실패 트레이스는 실제 errCd 가 없어 stats 의 topErrors 리스트에
// 잡히지 않는다. stats route 에서 hasSeasoningFailure() 와 SEASONING_FAIL_CODE 를
// 사용해 가상 코드로 카운트한다.
//
// ONEOIS DB 연결이 완료되면 이 파일과 호출부(traces/stats route 의 TEMP 블록)를
// 삭제하면 원래의 pending 동작으로 복귀한다.
// ─────────────────────────────────────────────────────────────────────────────
import { TraceRow, TraceStatus } from "./types";

export const SEASONING_FAIL_PHRASE = "Seasoning 실패";
/** topErrors 리스트에 노출할 가상 에러 코드 (실제 DB 에는 존재하지 않음) */
export const SEASONING_FAIL_CODE = "FAIL_SEASONING";

/** CUBE RESP 메시지에 Seasoning 실패 문구가 있는지 */
export function hasSeasoningFailure(rows: TraceRow[]): boolean {
  return rows.some(
    (r) => r.layer === "CUBE" && !!r.respMsgCtn && r.respMsgCtn.includes(SEASONING_FAIL_PHRASE)
  );
}

/** pending 대체 판정: Seasoning 실패면 fail, 없으면 ok */
export function classifyPendingByCubeResp(rows: TraceRow[]): TraceStatus {
  return hasSeasoningFailure(rows) ? "fail" : "ok";
}
