-- ============================================================================
-- TRX_ERRMSG_COD : 에러 코드 의미(메시지) 마스터
--
--   ※ 이 테이블은 레이어별로 복제되는 BIZ_AIACTIONTXN_HIS 와 다르다.
--     이 앱의 "자체 DB" 에만 단 한 번 생성한다.
--   ※ 전용 DB 자원을 할당받지 못해, 현재 앱 자체 DB = GAIA 의 DB 다.
--     (코드: src/lib/config.ts 의 APP_DB_LAYER, getAppDbConfig())
--     따라서 이 DDL 은 GAIA DB 에서만 실행한다.
--
--   용도 : 대시보드 "주요 에러" 카드에서 에러 코드 호버 시 의미를 툴팁으로 노출.
--          API GET /api/error-codes → src/lib/errorCodes.ts loadErrorCodeMap()
--          이 SELECT ERR_CD, ERR_MSG_CTN ... WHERE USE_YN='Y' 로 읽는다.
-- ============================================================================

CREATE TABLE TRX_ERRMSG_COD (
    ERR_CD       VARCHAR2(50)   NOT NULL,            -- 에러 코드 (BIZ_AIACTIONTXN_HIS.ERR_CD 와 동일 값)
    ERR_MSG_CTN  VARCHAR2(1000),                     -- 에러 코드 의미/설명 (툴팁 노출 문구)
    USE_YN       VARCHAR2(1)    DEFAULT 'Y',         -- 사용 여부 (N 이면 조회 제외)
    REG_DT       TIMESTAMP      DEFAULT SYSTIMESTAMP,-- 등록 일시
    UPD_DT       TIMESTAMP,                          -- 수정 일시
    CONSTRAINT PK_TRX_ERRMSG_COD PRIMARY KEY (ERR_CD)
);

COMMENT ON TABLE  TRX_ERRMSG_COD             IS '에러 코드 의미 마스터 (앱 자체 DB 전용)';
COMMENT ON COLUMN TRX_ERRMSG_COD.ERR_CD      IS '에러 코드';
COMMENT ON COLUMN TRX_ERRMSG_COD.ERR_MSG_CTN IS '에러 코드 의미/설명';
COMMENT ON COLUMN TRX_ERRMSG_COD.USE_YN      IS '사용 여부 (Y/N)';
COMMENT ON COLUMN TRX_ERRMSG_COD.REG_DT      IS '등록 일시';
COMMENT ON COLUMN TRX_ERRMSG_COD.UPD_DT      IS '수정 일시';

-- 초기 시드 ------------------------------------------------------------------
-- ERR_CD 컨벤션: FAIL_* = 비즈니스 validation 실패, ERROR_* = 인프라/통신 에러.
-- 운영하며 코드가 늘면 이 테이블에 INSERT 만 추가하면 툴팁에 자동 반영된다.
INSERT INTO TRX_ERRMSG_COD (ERR_CD, ERR_MSG_CTN) VALUES
    ('FAIL_SEASONING',  'Seasoning(시즈닝) 처리 실패 — CUBE 응답에 실패 문구가 포함된 케이스');
INSERT INTO TRX_ERRMSG_COD (ERR_CD, ERR_MSG_CTN) VALUES
    ('FAIL_VALIDATION', '요청 값 검증 실패 (필수값 누락/형식 오류 등)');
INSERT INTO TRX_ERRMSG_COD (ERR_CD, ERR_MSG_CTN) VALUES
    ('ERROR_TIMEOUT',   '다운스트림 응답 시간 초과');
INSERT INTO TRX_ERRMSG_COD (ERR_CD, ERR_MSG_CTN) VALUES
    ('ERROR_CONN',      '다운스트림 연결 실패');
INSERT INTO TRX_ERRMSG_COD (ERR_CD, ERR_MSG_CTN) VALUES
    ('ERROR_INTERNAL',  '내부 서버 오류');

COMMIT;

-- ============================================================================
-- [ROLLBACK]
-- ============================================================================
-- DROP TABLE TRX_ERRMSG_COD PURGE;
-- COMMIT;
