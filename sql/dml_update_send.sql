-- ============================================================================
-- [UPDATE on SEND] 하위 레이어로 메시지를 인계한 직후 호출.
--
--   * SEND_COMPLT_YN 은 여기서 변경하지 않는다.
--     하위 레이어로부터 응답을 받은 뒤 dml_update_resp.sql 에서 'Y' 로 갱신.
-- ============================================================================

UPDATE BIZ_AIACTIONTXN_HIS
   SET SEND_SYS_ID    = :send_sys_id,
       SEND_MSG_CTN    = :send_msg_ctn,   -- 인계 메시지 JSON 전문 (컬럼명 원스펙 유지)
       SEND_TM        = SYSTIMESTAMP,
       SEND_COMPLT_YN = 'Y'
 WHERE TRACE_ID = :trace_id
   AND TIMEKEY  = :timekey;
