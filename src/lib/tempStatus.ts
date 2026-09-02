// ⚠️ TEMPORARY — ONEOIS 레이어 DB 미연결 대응 (제거 예정)
// ONEOIS DB 연결이 완료되면 이 파일과 호출부(traces/stats route 의 TEMP 블록)를
import { TraceRow, TraceStatus } from "./types";

export const ACTION_FAIL_RULES = [
  { action: "시즈닝",        phrase: "Seasoning 실패",     code: "FAIL_SEASONING" },
  { action: "AutoQual 취소", phrase: "AutoQual 취소 실패", code: "FAIL_AQ_CANCEL" },
  { action: "AutoQual 실행", phrase: "AutoQual 실행 실패", code: "FAIL_AQ_RUN" },
] as const;

export const ACTION_FAIL_LABELS: Record<string, string> = Object.fromEntries(
  ACTION_FAIL_RULES.map((r) => [r.code, `${r.action} 실패`])
);

export const ACTION_FAIL_PHRASES: readonly string[] = ACTION_FAIL_RULES.map((r) => r.phrase);

function cubeRespIncludes(rows: TraceRow[], phrase: string): boolean {
  return rows.some(
    (r) => r.layer === "CUBE" && !!r.respMsgCtn && r.respMsgCtn.includes(phrase)
  );
}

export function matchedActionFailCodes(rows: TraceRow[]): string[] {
  return ACTION_FAIL_RULES.filter((rule) => cubeRespIncludes(rows, rule.phrase)).map((r) => r.code);
}

export function hasActionFailure(rows: TraceRow[]): boolean {
  return ACTION_FAIL_RULES.some((rule) => cubeRespIncludes(rows, rule.phrase));
}

export function classifyPendingByCubeResp(rows: TraceRow[]): TraceStatus {
  return hasActionFailure(rows) ? "fail" : "ok";
}
