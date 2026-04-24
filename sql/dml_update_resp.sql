-- ============================================================================
-- [UPDATE on RESPONSE] 하위 레이어로부터 응답을 수신한 직후 호출.
--
--   * RESP_MSG_CTN : 내가 send 한 시스템(하위 레이어)으로부터 받은 응답 JSON
--   * SEND_COMPLT_YN = 'Y' : 이 시점에 왕복(send→response) 완료로 마킹.
--     INVIEW 의 allComplete 집계는 이 값을 기준으로 한다.
-- ============================================================================

UPDATE BIZ_AIACTIONTXN_HIS
   SET RESP_MSG_CTN   = :resp_msg_ctn,
       RESP_TM        = SYSTIMESTAMP,
       SEND_COMPLT_YN = 'Y'
 WHERE TRACE_ID = :trace_id
   AND TIMEKEY  = :timekey;
