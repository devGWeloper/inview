-- ============================================================================
-- BIZ_AIACTIONTXN_HIS : 권한(GRANT) & PUBLIC SYNONYM 스크립트
--   * ADM 계정(테이블 소유자)과 APP 계정(애플리케이션 접속자)이 분리된 환경에서
--     APP 계정이 ADM 계정 소유의 테이블을 스키마 prefix 없이 접근할 수 있도록
--     권한을 부여하고 PUBLIC SYNONYM 을 생성한다.
--   * 각 레이어(CUBE / GAIA / MCP / ONEOIS / LEGACY)의 Oracle DB 에서
--     동일하게 실행한다.
--
--   ▶ 가정 : ADM 계정명 = AIACT_ADM, APP 계정명 = AIACT_APP
--           (실제 환경에 맞게 치환하여 사용)
-- ============================================================================


-- ============================================================================
-- [1] 권한 부여 (GRANT)
--     실행 계정 : AIACT_ADM (테이블 소유자)
-- ============================================================================

-- 1-1) 테이블 DML 권한 부여 --------------------------------------------------
GRANT SELECT  ON AIACT_ADM.BIZ_AIACTIONTXN_HIS TO AIACT_APP;
GRANT INSERT  ON AIACT_ADM.BIZ_AIACTIONTXN_HIS TO AIACT_APP;
GRANT UPDATE  ON AIACT_ADM.BIZ_AIACTIONTXN_HIS TO AIACT_APP;
GRANT DELETE  ON AIACT_ADM.BIZ_AIACTIONTXN_HIS TO AIACT_APP;

-- 1-2) 한 줄로 부여하려면 위 4개 대신 아래 한 줄로 대체 가능 ----------------
-- GRANT SELECT, INSERT, UPDATE, DELETE ON AIACT_ADM.BIZ_AIACTIONTXN_HIS TO AIACT_APP;

-- 1-3) (선택) DDL 변경/참조 권한이 필요한 경우 -------------------------------
-- GRANT ALTER     ON AIACT_ADM.BIZ_AIACTIONTXN_HIS TO AIACT_APP;
-- GRANT REFERENCES ON AIACT_ADM.BIZ_AIACTIONTXN_HIS TO AIACT_APP;
-- GRANT INDEX     ON AIACT_ADM.BIZ_AIACTIONTXN_HIS TO AIACT_APP;

-- 1-4) (선택) ROLE 로 묶어서 관리하는 방식 -----------------------------------
-- CREATE ROLE ROLE_AIACT_APP;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON AIACT_ADM.BIZ_AIACTIONTXN_HIS TO ROLE_AIACT_APP;
-- GRANT ROLE_AIACT_APP TO AIACT_APP;


-- ============================================================================
-- [2] PUBLIC SYNONYM 생성
--     실행 계정 : CREATE PUBLIC SYNONYM 권한 보유 계정 (보통 SYSTEM/DBA)
--
--   ※ 주의 : FOR 절에는 반드시 "스키마.테이블" 형태로 prefix 를 붙일 것.
--           prefix 를 빼고 FOR BIZ_AIACTIONTXN_HIS 로 만들면
--           시노님이 자기 자신을 가리켜 ORA-01775(순환 고리) 가 발생한다.
-- ============================================================================

CREATE OR REPLACE PUBLIC SYNONYM BIZ_AIACTIONTXN_HIS FOR AIACT_ADM.BIZ_AIACTIONTXN_HIS;

-- 2-1) (대안) APP 계정 전용 PRIVATE SYNONYM 으로 운영하려는 경우 ------------
--      PUBLIC SYNONYM 대신 APP 계정으로 접속하여 아래 구문 실행.
-- CREATE OR REPLACE SYNONYM BIZ_AIACTIONTXN_HIS FOR AIACT_ADM.BIZ_AIACTIONTXN_HIS;


-- ============================================================================
-- [3] 부여 결과 확인 쿼리
-- ============================================================================
-- SELECT GRANTEE, PRIVILEGE
--   FROM ALL_TAB_PRIVS
--  WHERE TABLE_NAME = 'BIZ_AIACTIONTXN_HIS';
--
-- SELECT OWNER, SYNONYM_NAME, TABLE_OWNER, TABLE_NAME
--   FROM ALL_SYNONYMS
--  WHERE SYNONYM_NAME = 'BIZ_AIACTIONTXN_HIS';


-- ============================================================================
-- [4] (롤백용) PUBLIC SYNONYM 및 권한 회수
-- ============================================================================
-- DROP PUBLIC SYNONYM BIZ_AIACTIONTXN_HIS;
-- REVOKE SELECT, INSERT, UPDATE, DELETE ON AIACT_ADM.BIZ_AIACTIONTXN_HIS FROM AIACT_APP;

COMMIT;
