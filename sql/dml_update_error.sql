-- ============================================================================
-- [UPDATE on ERROR] 처리 중 예외/실패 발생 시 호출.
--
--   * ERR_CD 가 채워지면 TraceX 는 해당 TRACE 를 ERROR 상태로 노출
--     (api/traces/route.ts 의 hasError 집계).
--   * 에러 발생 레이어에서 이후 인계가 불가능하면 SEND_COMPLT_YN='N' 유지.
-- ============================================================================

UPDATE BIZ_AIACTIONTXN_HIS
   SET ERR_CD         = :err_cd,
       ERR_DESC_CTN   = :err_desc_ctn,
       SEND_COMPLT_YN = 'N'
 WHERE TRACE_ID = :trace_id
   AND TIMEKEY  = :timekey;
