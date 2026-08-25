-- ============================================================================
-- [MIGRATION] TRX_USER_MAS : AGENT_ID 컬럼 추가
--
--   배경 : Tokens / Timeout 화면이 다중 에이전트(config.yml agents[])를 지원하면서
--          로그인 계정이 어느 에이전트를 볼 수 있는지 묶을 필요가 생겼다.
--            NULL   = 전 에이전트 접근 (기존 계정 · 운영자)
--            값 있음 = config.yml agents[].id 중 그 에이전트 하나만
--          값은 로그인 시 세션 payload 에 실려 에이전트 목록/조회 판정에 쓰인다.
--          코드: src/lib/users.ts, src/lib/auth/session.ts
--
--   대상 : 앱 자체 DB(= GAIA, src/lib/config.ts APP_DB_LAYER) **한 곳에서 1회만**.
--          - TRX_USER_MAS 는 레이어별로 복제되는 BIZ_AIACTIONTXN_HIS 와 달리
--            앱 자체 DB 에만 존재한다 (sql/create_trx_user_mas.sql 참고).
--            그래서 다른 레이어 DB 에는 실행하지 않는다.
--          - 실행 계정은 테이블 소유자인 ADM 계정(IDMSADM2). 앱(IDMSAPP2)은 이미
--            GRANT + PUBLIC SYNONYM 으로 참조하고 있고 권한이 테이블 단위라
--            **컬럼 추가에 따른 추가 GRANT / SYNONYM 재생성은 필요 없다.**
--   적용 : NULL 허용이므로 기존 계정은 영향 없음 (전원 '전 에이전트' 유지).
--          ⚠️ 앱은 이 컬럼이 없어도 그대로 동작한다 — src/lib/users.ts 가 조회 시
--            컬럼 존재를 탐지해(WHERE 1=0) 없으면 전원 NULL 로 취급하고 INSERT/UPDATE
--            에서도 AGENT_ID 를 뺀다. 그래서 이 ALTER 와 앱 배포의 순서는 자유다.
--   롤백 : 페이지 하단 [ROLLBACK] 섹션 참고 (운영 데이터 손실 주의)
--
--   ※ 사내 운용중인 환경 대상.  DROP/REBUILD 가 아닌 ALTER 만 사용한다.
-- ============================================================================

-- 1) 컬럼 추가 ---------------------------------------------------------------
ALTER TABLE TRX_USER_MAS ADD (
    AGENT_ID  VARCHAR2(50)
);

-- 2) 컬럼 코멘트 -------------------------------------------------------------
COMMENT ON COLUMN TRX_USER_MAS.AGENT_ID IS '접근 가능 에이전트 id (NULL=전체, config.yml agents[].id)';

-- 3) 인덱스 ------------------------------------------------------------------
--    AGENT_ID 로 WHERE 를 걸지 않고(항상 USER_ID 단건 조회 또는 전건 목록),
--    계정 수가 수십 건 규모라 인덱스는 생략한다.

COMMIT;

-- ============================================================================
-- [확인 쿼리] -- 적용 후 확인용 (앱 자체 DB=GAIA 에서 실행)
-- ============================================================================
-- SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE
--   FROM USER_TAB_COLUMNS
--  WHERE TABLE_NAME = 'TRX_USER_MAS'
--    AND COLUMN_NAME = 'AGENT_ID';
--
-- SELECT USER_ID, USER_NM, ROLE_CD, NVL(AGENT_ID, '(전체)') AS AGENT_ID
--   FROM TRX_USER_MAS ORDER BY REG_DT;

-- ============================================================================
-- [값 설정 예] -- 계정을 한 에이전트에 묶기 / 다시 전체로 풀기
--   (화면에서 지정하는 기능이 붙기 전까지의 수동 운용용)
-- ============================================================================
-- UPDATE TRX_USER_MAS SET AGENT_ID = 'leeoksu', UPD_DT = SYSTIMESTAMP WHERE USER_ID = '사번';
-- UPDATE TRX_USER_MAS SET AGENT_ID = NULL,      UPD_DT = SYSTIMESTAMP WHERE USER_ID = '사번';
-- COMMIT;

-- ============================================================================
-- [ROLLBACK]  ※ 운영 데이터 손실 주의. 컬럼을 DROP 하면 결속 정보도 사라진다.
--   (앱은 컬럼이 없으면 전원 '전 에이전트' 로 되돌아간다 — 접근이 넓어지는 방향)
--
--   ⚠️ **DROP 후에는 앱을 재시작해야 한다.** 컬럼 존재 탐지 결과가 프로세스에 캐시돼 있어
--     (src/lib/users.ts hasAgentCol — 한 번 찾으면 다시 확인하지 않는다) 재시작 전까지는
--     모든 계정 조회가 없는 컬럼을 SELECT 해 ORA-00904 로 실패한다 =
--     **계정 목록/로그인이 안 된다.** 재시작하면 탐지가 다시 돌아 정상화된다.
-- ============================================================================
-- ALTER TABLE TRX_USER_MAS DROP (AGENT_ID);
-- COMMIT;
-- (그리고 앱 재시작)
