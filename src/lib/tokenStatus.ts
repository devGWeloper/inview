
// 호출 성공 / 타임아웃 / LLM 오류 판정의 단일 소스.
// callStatus() = 화면용, SQL_* = 집계 SQL 용. 한쪽을 고치면 다른 쪽도 같이 고칠 것.

export type CallStatus = "ok" | "timeout" | "error";

const TIMEOUT_RE =
  /(time[\s_-]?out|timed[\s_-]?out|ETIMEDOUT|ReadTimeout|deadline exceeded|시간\s*초과|타임아웃)/i;

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

export const SQL_ERR_PRED = "UPPER(NVL(STAT_CD, 'OK')) NOT IN ('OK', 'SUCCESS', 'S', 'Y')";
export const SQL_OK_PRED = "UPPER(NVL(STAT_CD, 'OK')) IN ('OK', 'SUCCESS', 'S', 'Y')";
export const SQL_TIMEOUT_PRED =
  "(UPPER(NVL(STAT_CD, '')) = 'TIMEOUT'" +
  " OR UPPER(NVL(ERR_CTN, '')) LIKE '%TIMEOUT%'" +
  " OR UPPER(NVL(ERR_CTN, '')) LIKE '%TIMED OUT%'" +
  " OR UPPER(NVL(ERR_CTN, '')) LIKE '%ETIMEDOUT%'" +
  " OR UPPER(NVL(ERR_CTN, '')) LIKE '%DEADLINE EXCEEDED%'" +
  " OR NVL(ERR_CTN, '') LIKE '%타임아웃%'" +
  " OR NVL(ERR_CTN, '') LIKE '%시간 초과%')";
