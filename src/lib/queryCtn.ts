// TRX_TOKEN_DET.QUERY_CTN 조회 규칙. 에이전트마다 VARCHAR2 / CLOB 가 섞여 있다. docs/architecture/agents.md

type OracleModule = typeof import("oracledb");

export const QUERY_CTN_MAX_CHARS = 4000;

// ⚠️ QUERY_CTN 자체를 MIN/MAX/GROUP BY 하지 말 것 — CLOB 이면 ORA-00932. 대표 호출의 TOKEN_ID 를 골라 조인한다.
export const SQL_QUERY_TOKEN_ID =
  "MIN(TOKEN_ID) KEEP (DENSE_RANK FIRST ORDER BY CASE WHEN QUERY_CTN IS NULL THEN 1 ELSE 0 END, CALL_TM)";

// CLOB/NCLOB 컬럼을 Lob 객체 대신 문자열로 받는다. 컬럼 이름과 무관하게 적용된다.
export function lobAsText(oracle: OracleModule, maxChars = QUERY_CTN_MAX_CHARS) {
  return (meta: { dbType?: unknown }) =>
    meta.dbType === oracle.DB_TYPE_CLOB || meta.dbType === oracle.DB_TYPE_NCLOB
      ? {
          type: oracle.STRING,
          converter: (v: string | null) => (v == null ? v : v.slice(0, maxChars)),
        }
      : undefined;
}
