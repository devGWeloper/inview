-- ============================================================================
-- [UPDATE on SEND] 하위 레이어로 메시지를 성공적으로 인계한 직후 호출.
--
--   * SEND_COMPLT_YN = 'Y' 로 마킹되어야 INVIEW 의 allComplete 집계에
--     포함된다 (api/traces/route.ts 의 summarize()).
--   * LEGACY(종단) 레이어는 "다음 단"이 없으므로 SEND_SYS_ID 에
--     종단 마커(예: 'END') 를 넣거나 외부 응답 시스템 ID 를 기록한다.
-- ============================================================================

UPDATE BIZ_AIACTIONTXN_HIS
   SET SEND_SYS_ID    = :send_sys_id,
       SEND_MSG_CTN    = :send_msg_ctn,   -- 인계 메시지 JSON 전문 (컬럼명 원스펙 유지)
       SEND_TM        = SYSTIMESTAMP,
       SEND_COMPLT_YN = 'Y'
 WHERE TRACE_ID = :trace_id
   AND TIMEKEY  = :timekey;
