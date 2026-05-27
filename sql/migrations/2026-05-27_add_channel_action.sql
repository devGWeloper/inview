-- ============================================================================
-- [MIGRATION] BIZ_AIACTIONTXN_HIS : CHANNEL_ID, ACTION_TYP 컬럼 추가
--
--   대상 : 각 레이어(CUBE / GAIA / MCP / ONEOIS) Oracle DB 모두
--   적용 : 운영 DB 한 곳 한 곳에 순차 실행. NULL 허용이므로 기존 행은 영향 없음.
--   롤백 : 페이지 하단 [ROLLBACK] 섹션 참고 (운영 데이터 손실 주의)
--
--   ※ 사내 운용중인 환경 대상.  DROP/REBUILD 가 아닌 ALTER 만 사용한다.
-- ============================================================================

-- 1) 컬럼 추가 ---------------------------------------------------------------
--    같은 ALTER 문 안에서 두 컬럼을 한 번에 추가 (재시작/락 최소화).
ALTER TABLE BIZ_AIACTIONTXN_HIS ADD (
    CHANNEL_ID  VARCHAR2(50),
    ACTION_TYP  VARCHAR2(50)
);

-- 2) 컬럼 코멘트 -------------------------------------------------------------
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.CHANNEL_ID IS '채널 ID (요청 유입 채널)';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.ACTION_TYP IS '액션 유형 (요청된 액션 타입)';

-- 3) 인덱스 생성 -------------------------------------------------------------
--    대시보드 집계 쿼리(RECV_TM 범위 + CHANNEL_ID / ACTION_TYP 필터)에 사용.
--    ONLINE 옵션은 EE 라이선스가 필요하므로 환경에 맞게 조정한다.
CREATE INDEX IX_BIZ_AIACTIONTXN_HIS_04 ON BIZ_AIACTIONTXN_HIS (CHANNEL_ID, RECV_TM);
CREATE INDEX IX_BIZ_AIACTIONTXN_HIS_05 ON BIZ_AIACTIONTXN_HIS (ACTION_TYP, RECV_TM);

COMMIT;

-- ============================================================================
-- [확인 쿼리] -- 적용 후 확인용 (각 레이어 DB 에서 실행)
-- ============================================================================
-- SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE
--   FROM USER_TAB_COLUMNS
--  WHERE TABLE_NAME = 'BIZ_AIACTIONTXN_HIS'
--    AND COLUMN_NAME IN ('CHANNEL_ID', 'ACTION_TYP');
--
-- SELECT INDEX_NAME, COLUMN_NAME, COLUMN_POSITION
--   FROM USER_IND_COLUMNS
--  WHERE TABLE_NAME = 'BIZ_AIACTIONTXN_HIS'
--    AND INDEX_NAME IN ('IX_BIZ_AIACTIONTXN_HIS_04', 'IX_BIZ_AIACTIONTXN_HIS_05')
--  ORDER BY INDEX_NAME, COLUMN_POSITION;

-- ============================================================================
-- [ROLLBACK]  ※ 운영 데이터 손실 주의. 컬럼을 DROP 하면 누적된 값도 사라진다.
-- ============================================================================
-- DROP INDEX IX_BIZ_AIACTIONTXN_HIS_05;
-- DROP INDEX IX_BIZ_AIACTIONTXN_HIS_04;
-- ALTER TABLE BIZ_AIACTIONTXN_HIS DROP (CHANNEL_ID, ACTION_TYP);
-- COMMIT;
