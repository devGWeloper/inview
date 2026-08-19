// ─────────────────────────────────────────────────────────────────────────────
// LLM 호출 결과(TRX_TOKEN_DET.STAT_CD / ERR_CTN) 해석 — 서버·클라이언트 공용.
// Node 전용 모듈을 import 하지 말 것(클라이언트 컴포넌트에서 그대로 쓴다).
//
// GAIA 는 STAT_CD 를 'OK' / 'ERROR' 두 값만 쓴다(타임아웃도 'ERROR').
// "타임아웃이냐 다른 오류냐" 는 ERR_CTN 문구로 갈린다 — 타임아웃은 원인 규명 방향이
// 달라서(모델/프롬프트가 느린 것 vs 호출 자체가 깨진 것) 화면에서 구분해 보여준다.
// STAT_CD 에 'TIMEOUT' 을 직접 넣는 구현이 나중에 생겨도 그대로 인식한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 호출 1건의 결과 상태. ok = 정상 응답, timeout = 응답 못 받고 시간 초과, error = 그 외 실패 */
export type CallStatus = "ok" | "timeout" | "error";

/** ERR_CTN 에서 타임아웃 계열을 식별하는 문구 (파이썬/자바/HTTP 클라이언트 공통 표현 + 한글) */
const TIMEOUT_RE =
  /(time[\s_-]?out|timed[\s_-]?out|ETIMEDOUT|ReadTimeout|deadline exceeded|시간\s*초과|타임아웃)/i;

/** STAT_CD 가 '성공' 을 뜻하는 값들. NULL/빈값은 컬럼 추가 전 기존 행이므로 성공으로 본다. */
const OK_CODES = new Set(["", "OK", "SUCCESS", "S", "Y"]);

export function callStatus(
  statCd: string | null | undefined,
  errCtn?: string | null
): CallStatus {
  const s = (statCd ?? "").trim().toUpperCase();
  if (s === "TIMEOUT") return "timeout";
  if (OK_CODES.has(s)) return "ok";
  return TIMEOUT_RE.test(errCtn ?? "") ? "timeout" : "error";
}

export function isFailedCall(statCd: string | null | undefined, errCtn?: string | null): boolean {
  return callStatus(statCd, errCtn) !== "ok";
}

/**
 * SQL 에서 "실패 호출" 을 판정하는 술어. tokens.ts 의 집계 쿼리들이 공유한다.
 * NULL 은 성공(컬럼 추가 전 행)으로 취급 — callStatus() 의 OK_CODES 와 규칙을 맞춘다.
 */
export const SQL_ERR_PRED = "UPPER(NVL(STAT_CD, 'OK')) NOT IN ('OK', 'SUCCESS', 'S', 'Y')";
/** 위 술어의 부정 — 성공 호출만 대상으로 삼는 집계(지연 평균 등)에 쓴다. */
export const SQL_OK_PRED = "UPPER(NVL(STAT_CD, 'OK')) IN ('OK', 'SUCCESS', 'S', 'Y')";
