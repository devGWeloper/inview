-- ============================================================================
-- [MIGRATION] TRX_USER_MAS : GLOBAL_YN 컬럼 추가 + 기존 계정 재배정
--
--   배경 : 계정 범위를 "전역 / 특정 에이전트 / 미배정" 3가지로 나눈다.
--            GLOBAL_YN='Y'                → 모든 에이전트 (전역 운영자)
--            GLOBAL_YN='N' + AGENT_ID 값  → 그 에이전트 하나
--            GLOBAL_YN='N' + AGENT_ID NULL→ **잠금** (미배정 — 아무것도 못 본다)
--
--          ⚠️ AGENT_ID 하나로는 '전역' 과 '미배정' 을 구분할 수 없어(둘 다 NULL)
--            컬럼을 하나 더 둔다. 그래서 **AGENT_ID 의 의미가 뒤집힌다** —
--            이 마이그레이션 전에는 NULL = 전 에이전트였고, 후에는 NULL = 잠금이다.
--            아래 2)의 UPDATE 가 그 전환을 담당하므로 **1)~3)을 한 번에 실행**한다.
--          코드: src/lib/roles.ts(resolveScope/canViewAgent), src/lib/users.ts
--
--   대상 : 앱 자체 DB(= GAIA, src/lib/config.ts APP_DB_LAYER) **한 곳에서 1회만**.
--          실행 계정은 테이블 소유자인 ADM 계정(IDMSADM2). 권한이 테이블 단위라
--          **추가 GRANT / SYNONYM 재생성은 필요 없다.**
--
--   선행 : sql/migrations/2026-08-24_add_user_agent_id.sql (AGENT_ID 컬럼)
--
--   적용 : ⚠️ 앱은 이 컬럼이 없어도 그대로 동작한다 — src/lib/users.ts 가 컬럼 존재를
--          탐지해(WHERE 1=0) 없으면 **옛 규칙(AGENT_ID 없음 = 전역)** 으로 읽는다.
--          그래서 ALTER 와 앱 배포의 순서는 자유지만, ALTER 만 하고 2)의 UPDATE 를
--          빠뜨리면 전원이 GLOBAL_YN='N' + AGENT_ID NULL = **전원 잠금**이 된다.
--   롤백 : 페이지 하단 [ROLLBACK] 섹션 참고
--
--   ※ 사내 운용중인 환경 대상.  DROP/REBUILD 가 아닌 ALTER 만 사용한다.
-- ============================================================================

-- 1) 컬럼 추가 ---------------------------------------------------------------
--    DEFAULT 'N' — 앞으로 만들어지는 계정은 명시하지 않으면 전역이 아니다(안전 기본값).
ALTER TABLE TRX_USER_MAS ADD (
    GLOBAL_YN  CHAR(1) DEFAULT 'N' NOT NULL
);

ALTER TABLE TRX_USER_MAS ADD CONSTRAINT CK_TRX_USER_MAS_GLOBAL
    CHECK (GLOBAL_YN IN ('Y', 'N'));

COMMENT ON COLUMN TRX_USER_MAS.GLOBAL_YN IS '전역 계정 여부 (Y=모든 에이전트, N=AGENT_ID 하나 / AGENT_ID NULL 이면 미배정=잠금)';

-- 2) 기존 계정 재배정 --------------------------------------------------------
--    ⚠️ 이 블록을 건너뛰면 전원이 잠긴다. 반드시 1) 과 함께 실행할 것.

--    2-1) 기존 운영자(ADMIN) 는 전역으로 올린다.
UPDATE TRX_USER_MAS
   SET GLOBAL_YN = 'Y', UPD_DT = SYSTIMESTAMP
 WHERE ROLE_CD = 'ADMIN';

--    2-2) 그 외 결속이 없던 계정은 기본 에이전트(config.yml 의 default: true) 소속으로.
--         ⚠️ 'leeoksu' 는 현재 기본 에이전트 id 다. config.yml 을 바꿨다면 그 값으로 고칠 것.
UPDATE TRX_USER_MAS
   SET AGENT_ID = 'leeoksu', UPD_DT = SYSTIMESTAMP
 WHERE ROLE_CD <> 'ADMIN'
   AND AGENT_ID IS NULL;

-- 3) 커밋 --------------------------------------------------------------------
COMMIT;

-- ============================================================================
-- [확인 쿼리] -- 적용 후 확인용 (앱 자체 DB=GAIA 에서 실행)
-- ============================================================================
-- SELECT USER_ID, USER_NM, ROLE_CD, GLOBAL_YN,
--        NVL(AGENT_ID, '(미배정)') AS AGENT_ID,
--        CASE WHEN GLOBAL_YN = 'Y'      THEN '전역'
--             WHEN AGENT_ID IS NOT NULL THEN '에이전트: ' || AGENT_ID
--             ELSE '⚠ 잠금(미배정)' END AS SCOPE
--   FROM TRX_USER_MAS ORDER BY REG_DT;
--
-- -- 잠긴 계정이 남아 있는지 (있으면 화면 /accounts 에서 배정할 것)
-- SELECT USER_ID, USER_NM FROM TRX_USER_MAS
--  WHERE GLOBAL_YN = 'N' AND AGENT_ID IS NULL;

-- ============================================================================
-- [값 설정 예] -- 화면(/accounts)에서도 지정할 수 있지만 수동 운용용
-- ============================================================================
-- -- 전역 운영자로
-- UPDATE TRX_USER_MAS SET GLOBAL_YN='Y', UPD_DT=SYSTIMESTAMP WHERE USER_ID='사번';
-- -- 특정 에이전트 소속으로 (전역 해제 + 결속)
-- UPDATE TRX_USER_MAS SET GLOBAL_YN='N', AGENT_ID='agent-x', UPD_DT=SYSTIMESTAMP WHERE USER_ID='사번';
-- COMMIT;

-- ============================================================================
-- [ROLLBACK]  ※ 컬럼을 DROP 하면 앱이 옛 규칙(AGENT_ID 없음 = 전역)으로 되돌아간다.
--   = 접근이 넓어지는 방향이다. 2-2) 로 채운 AGENT_ID 는 남으므로 그 계정들은
--     계속 해당 에이전트에 묶인 채로 남는다(원하면 별도로 NULL 로 되돌릴 것).
--
--   ⚠️ **DROP 후에는 앱을 재시작해야 한다.** 컬럼 존재 탐지 결과가 프로세스에 캐시돼 있어
--     (src/lib/users.ts hasGlobalCol — 한 번 찾으면 다시 확인하지 않는다) 재시작 전까지는
--     모든 계정 조회가 없는 컬럼을 SELECT 해 ORA-00904 로 실패한다 =
--     **계정 목록/로그인이 안 된다.** 재시작하면 탐지가 다시 돌아 정상화된다.
-- ============================================================================
-- ALTER TABLE TRX_USER_MAS DROP CONSTRAINT CK_TRX_USER_MAS_GLOBAL;
-- ALTER TABLE TRX_USER_MAS DROP (GLOBAL_YN);
-- COMMIT;
-- (그리고 앱 재시작)
