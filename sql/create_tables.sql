-- ============================================================================
-- BIZ_AIACTIONTXN_HIS : AI 액션 트랜잭션 이력 테이블
--   * 각 레이어(CUBE / GAIA / MCP / ONEOIS / LEGACY)의 Oracle DB 에서
--     동일 스키마로 생성한다.
--   * TRACE_ID + TIMEKEY 복합 PK 로 레이어 간 연결(조인) 시 TRACE_ID 기준.
-- ============================================================================

-- 기존 테이블이 있다면 재생성 (필요 시 주석 해제)
-- DROP TABLE BIZ_AIACTIONTXN_HIS PURGE;

CREATE TABLE BIZ_AIACTIONTXN_HIS (
    TRACE_ID         VARCHAR2(50)   NOT NULL,           -- 추적 ID (레이어 공통)
    TIMEKEY          VARCHAR2(50)   NOT NULL,           -- 타임키 (ex. YYYYMMDDHH24MISSFF3)
    USER_ID          VARCHAR2(50),                      -- 사용자 ID
    SYS_ID           VARCHAR2(50),                      -- 시스템 ID
    RECV_SYS_ID      VARCHAR2(50),                      -- 수신 시스템 ID (기록 주체, ex. GAIA)
    RECV_MSG_CTN     VARCHAR2(4000),                    -- 수신 메시지 (JSON 전문)
    RECV_TM          TIMESTAMP,                         -- 인수 시간 (MSG 받은 시각)
    SEND_SYS_ID      VARCHAR2(50),                      -- 발신 시스템 ID (ex. MCP)
    SEND_MSG_CTN      VARCHAR2(4000),                   -- 인계 메시지 (JSON 전문)  ※ 원 스펙 컬럼명 유지
    SEND_TM          TIMESTAMP,                         -- 인계 일시
    SEND_COMPLT_YN   VARCHAR2(1)    DEFAULT 'N',        -- 인계 완료 여부 (Y/N)
    ERR_CD           VARCHAR2(50),                      -- 에러 코드
    ERR_DESC_CTN     VARCHAR2(4000),                      -- 에러 내용 설명
    CONSTRAINT PK_BIZ_AIACTIONTXN_HIS PRIMARY KEY (TRACE_ID, TIMEKEY)
);

-- 조회 성능용 인덱스 ---------------------------------------------------------
CREATE INDEX IX_BIZ_AIACTIONTXN_HIS_01 ON BIZ_AIACTIONTXN_HIS (RECV_TM);
CREATE INDEX IX_BIZ_AIACTIONTXN_HIS_02 ON BIZ_AIACTIONTXN_HIS (USER_ID, RECV_TM);
CREATE INDEX IX_BIZ_AIACTIONTXN_HIS_03 ON BIZ_AIACTIONTXN_HIS (RECV_SYS_ID, SEND_SYS_ID);

-- 컬럼 코멘트 ---------------------------------------------------------------
COMMENT ON TABLE  BIZ_AIACTIONTXN_HIS               IS 'AI 액션 트랜잭션 이력';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.TRACE_ID      IS '추적 ID';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.TIMEKEY       IS '타임키';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.USER_ID       IS '사용자 ID';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.SYS_ID        IS '시스템 ID';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.RECV_SYS_ID   IS '수신 시스템 ID (기록 주체 시스템)';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.RECV_MSG_CTN  IS '수신 메시지 내용 (JSON 전문)';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.RECV_TM       IS '인수 시간';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.SEND_SYS_ID   IS '발신 시스템 ID';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.SEND_MSG_CTN  IS '인계 메시지 내용 (JSON 전문)';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.SEND_TM       IS '인계 일시';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.SEND_COMPLT_YN IS '인계 완료 여부 (Y/N)';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.ERR_CD        IS '에러 코드';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.ERR_DESC_CTN  IS '에러 내용 설명';

COMMIT;
