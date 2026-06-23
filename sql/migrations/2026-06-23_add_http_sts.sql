-- ============================================================================
-- [MIGRATION] BIZ_AIACTIONTXN_HIS : HTTP_STS_CD 컬럼 추가
--
--   배경 : Trace Detail 화면에서 각 레이어 호출의 다운스트림 응답 HTTP 상태 코드
--          (ex. 201 / 401)를 표기하기 위함. 응답 수신 시점(resp update)에
--          행 단위로 기록한다.
--
--   대상 : 각 레이어(CUBE / GAIA / MCP / ONEOIS) Oracle DB 모두
--          - 단일 SELECT(db.ts SELECT_COLUMNS)가 네 DB 에 동일하게 fan-out 되므로
--            한 DB 라도 컬럼이 없으면 해당 레이어 조회가 ORA-00904 로 깨진다.
--            모든 레이어가 다운스트림을 호출하므로 값도 전 레이어가 기록한다.
--   적용 : 운영 DB 한 곳 한 곳에 순차 실행. NULL 허용이므로 기존 행은 영향 없음.
--   롤백 : 페이지 하단 [ROLLBACK] 섹션 참고 (운영 데이터 손실 주의)
--
--   ※ 사내 운용중인 환경 대상.  DROP/REBUILD 가 아닌 ALTER 만 사용한다.
-- ============================================================================

-- 1) 컬럼 추가 ---------------------------------------------------------------
ALTER TABLE BIZ_AIACTIONTXN_HIS ADD (
    HTTP_STS_CD  VARCHAR2(10)
);

-- 2) 컬럼 코멘트 -------------------------------------------------------------
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.HTTP_STS_CD IS '다운스트림 응답 HTTP 상태 코드 (resp update 시 기록)';

COMMIT;

-- ============================================================================
-- [확인 쿼리] -- 적용 후 확인용 (각 레이어 DB 에서 실행)
-- ============================================================================
-- SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE
--   FROM USER_TAB_COLUMNS
--  WHERE TABLE_NAME = 'BIZ_AIACTIONTXN_HIS'
--    AND COLUMN_NAME = 'HTTP_STS_CD';

-- ============================================================================
-- [ROLLBACK]  ※ 운영 데이터 손실 주의. 컬럼을 DROP 하면 누적된 값도 사라진다.
-- ============================================================================
-- ALTER TABLE BIZ_AIACTIONTXN_HIS DROP (HTTP_STS_CD);
-- COMMIT;
