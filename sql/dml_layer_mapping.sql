-- ============================================================================
-- 레이어별 주입값 레퍼런스
--
--   흐름:  CUBE → GAIA → MCP → ONEOIS → LEGACY
--
--   각 앱의 자기 Oracle DB 에 기록할 때 :recv_sys_id / :send_sys_id 에
--   넣어야 하는 값을 정리한다. SYS_ID 는 보통 RECV_SYS_ID 와 동일
--   (= 기록 주체 = 이 앱).
-- ============================================================================
--
--  레이어   | RECV_SYS_ID | SEND_SYS_ID | 비고
--  ---------+-------------+-------------+----------------------------------
--  CUBE     | CUBE        | GAIA        | 최초 진입점. TRACE_ID 신규 발급
--  GAIA     | GAIA        | MCP         |
--  MCP      | MCP         | ONEOIS      |
--  ONEOIS   | ONEOIS      | LEGACY      |
--  LEGACY   | LEGACY      | END         | 종단. 응답 후 SEND_COMPLT_YN='Y'
--
-- ============================================================================
-- 샘플 실행 (CUBE 레이어 DB 에서)
-- ============================================================================

-- 1) 수신
INSERT INTO BIZ_AIACTIONTXN_HIS (
    TRACE_ID, TIMEKEY, USER_ID, SYS_ID,
    RECV_SYS_ID, RECV_MSG_CTN, RECV_TM, SEND_COMPLT_YN
) VALUES (
    'TRC-20260422-0001',
    TO_CHAR(SYSTIMESTAMP, 'YYYYMMDDHH24MISSFF3'),
    'hong.gildong',
    'CUBE',
    'CUBE',
    '{"intent":"summarize","input":"..."}',
    SYSTIMESTAMP,
    'N'
);

-- 2) 다음 단(GAIA) 인계 완료 후
UPDATE BIZ_AIACTIONTXN_HIS
   SET SEND_SYS_ID    = 'GAIA',
       SEND_MSG_CTN   = '{"forwardedTo":"GAIA","payload":"..."}',
       SEND_TM        = SYSTIMESTAMP,
       SEND_COMPLT_YN = 'Y'
 WHERE TRACE_ID = 'TRC-20260422-0001'
   AND TIMEKEY  = '20260422120000123';

COMMIT;
