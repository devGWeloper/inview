-- ============================================================================
-- [MIGRATION] BIZ_AIACTIONTXN_HIS : FAC_ID, AREA_ID 컬럼 추가
--
--   배경 : 대시보드에서 FAC별 / AREA별 집계를 위함. 둘 다 같은 개념으로,
--          MCP 의 send update 단계에서 비로소 확정되므로 컬럼 자체는 전 레이어에
--          두되 실제 값은 MCP 만 기록한다(나머지 레이어는 NULL 유지).
--
--   대상 : 각 레이어(CUBE / GAIA / MCP / ONEOIS) Oracle DB 모두
--          - 단일 SELECT(db.ts SELECT_COLUMNS)가 네 DB 에 동일하게 fan-out 되므로
--            한 DB 라도 컬럼이 없으면 해당 레이어 조회가 ORA-00904 로 깨진다.
--            (단, queryLayer 가 에러를 잡아 [] 반환하므로 앱 전체가 죽지는 않고
--             해당 레이어 행만 사라진다 — 연결된 DB 전부에 함께 적용할 것.)
--   적용 : 운영 DB 한 곳 한 곳에 순차 실행. NULL 허용이므로 기존 행은 영향 없음.
--   롤백 : 페이지 하단 [ROLLBACK] 섹션 참고 (운영 데이터 손실 주의)
--
--   ※ 사내 운용중인 환경 대상.  DROP/REBUILD 가 아닌 ALTER 만 사용한다.
-- ============================================================================

-- 1) 컬럼 추가 ---------------------------------------------------------------
ALTER TABLE BIZ_AIACTIONTXN_HIS ADD (
    FAC_ID   VARCHAR2(50),
    AREA_ID  VARCHAR2(50)
);

-- 2) 컬럼 코멘트 -------------------------------------------------------------
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.FAC_ID  IS 'FAC ID (MCP send update 에서만 기록)';
COMMENT ON COLUMN BIZ_AIACTIONTXN_HIS.AREA_ID IS 'AREA ID (FAC_ID 와 동일 개념, MCP send update 에서만 기록)';

-- 3) 인덱스 ------------------------------------------------------------------
--    현재 FAC/AREA 는 집계(앱단 그룹핑)에만 쓰고 WHERE 필터로는 쓰지 않으므로 인덱스 생략.
--    추후 필터를 추가하면 MCP DB 에 한해 (FAC_ID, RECV_TM) / (AREA_ID, RECV_TM) 인덱스 고려.

COMMIT;

-- ============================================================================
-- [확인 쿼리] -- 적용 후 확인용 (각 레이어 DB 에서 실행)
-- ============================================================================
-- SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE
--   FROM USER_TAB_COLUMNS
--  WHERE TABLE_NAME = 'BIZ_AIACTIONTXN_HIS'
--    AND COLUMN_NAME IN ('FAC_ID', 'AREA_ID');

-- ============================================================================
-- [ROLLBACK]  ※ 운영 데이터 손실 주의. 컬럼을 DROP 하면 누적된 값도 사라진다.
-- ============================================================================
-- ALTER TABLE BIZ_AIACTIONTXN_HIS DROP (FAC_ID, AREA_ID);
-- COMMIT;
