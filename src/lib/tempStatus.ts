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
// ONEOIS DB 연결이 완료되면 이 파일과 호출부(traces/stats route 의 classify TEMP 블록)를
// 삭제하면 원래의 pending 동작으로 복귀한다.
// ─────────────────────────────────────────────────────────────────────────────
import { TraceRow, TraceStatus } from "./types";

export const SEASONING_FAIL_PHRASE = "Seasoning 실패";

/** pending 대체 판정: CUBE RESP 메시지에 실패 문구가 있으면 fail, 없으면 ok */
export function classifyPendingByCubeResp(rows: TraceRow[]): TraceStatus {
  const failed = rows.some(
    (r) => r.layer === "CUBE" && !!r.respMsgCtn && r.respMsgCtn.includes(SEASONING_FAIL_PHRASE)
  );
  return failed ? "fail" : "ok";
}
