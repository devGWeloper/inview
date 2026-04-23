-- ============================================================================
-- [INSERT on RECEIVE] 각 레이어 앱이 "상위 레이어로부터 메시지를 받은 순간"
--   BIZ_AIACTIONTXN_HIS 에 신규 행을 기록한다.
--
--   * SEND_* 컬럼은 아직 비워두고, 다음 단계로 인계가 끝난 뒤
--     dml_update_send.sql 로 UPDATE 한다.
--   * TIMEKEY 는 앱에서 'YYYYMMDDHH24MISSFF3' 형식으로 생성해서 전달.
--   * RECV_TM 은 DB 시각으로 남겨 레이어 간 지연 측정이 편하도록 한다.
-- ============================================================================

INSERT INTO BIZ_AIACTIONTXN_HIS (
    TRACE_ID,
    TIMEKEY,
    USER_ID,
    SYS_ID,
    RECV_SYS_ID,
    RECV_MSG_CTN,
    RECV_TM,
    SEND_COMPLT_YN
) VALUES (
    :trace_id,        -- 상위에서 전파된 추적 ID (없으면 최초 레이어가 발급)
    :timekey,         -- YYYYMMDDHH24MISSFF3
    :user_id,
    :sys_id,          -- 현재 이 앱의 시스템 ID
    :recv_sys_id,     -- 기록 주체(= 이 앱) 시스템 ID
    :recv_msg_ctn,    -- 수신 메시지 JSON 전문
    SYSTIMESTAMP,
    'N'
);
