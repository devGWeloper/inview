-- ============================================================================
-- [MIGRATION] TRX_USER_MAS : 권한에 FIELD(현업) 추가 — CHECK 제약 확장
--
--   배경 : 이 앱은 개발자가 4계층 메시지를 추적하려고 만들었지만, 실적 리포트 성격의
--          화면이 늘면서 **현업(비개발) 사용자**도 실적을 보고 싶어졌다. 현업에게는
--          레이어 JSON 원문 · 다른 사용자의 질의/사번 · 내부 에러 코드를 보이면 안 된다.
--          그래서 기존 3권한 아래에 **FIELD(현업)** 를 하나 더 둔다.
--
--            ADMIN(운영자) > BR(상위) > DEV(개발자) > FIELD(현업)
--
--          ⚠️ FIELD 는 서열만 낮은 게 아니라 **경로 허용 목록(allow-list)** 으로 판정한다.
--            ROUTE_RULES 는 "규칙에 없으면 통과"(fail-open)라 서열만 낮추면 앞으로
--            추가되는 화면이 자동으로 현업에게 열린다. 코드: src/lib/roles.ts
--            (FIELD_ALLOW_PREFIXES / canAccessPath) — 현재 열린 화면은 /insights 하나다.
--
--   대상 : 앱 자체 DB(= GAIA, src/lib/config.ts APP_DB_LAYER) **한 곳에서 1회만**.
--          실행 계정은 테이블 소유자인 ADM 계정(IDMSADM2). 권한이 테이블 단위라
--          **추가 GRANT / SYNONYM 재생성은 필요 없다.**
--
--   적용 : ⚠️ **앱 배포보다 이 마이그레이션이 먼저**여야 한다. 제약을 넓히기 전에는
--          /accounts 에서 현업 계정을 만들 때 ORA-02290(CHECK 위반)으로 저장이 실패한다.
--          (기존 계정은 영향 없음 — 값이 늘어나는 방향의 변경이라 데이터 이관이 없다.)
--   롤백 : 페이지 하단 [ROLLBACK] 섹션 참고
--
--   ※ 사내 운용중인 환경 대상.  DROP/REBUILD 가 아닌 ALTER 만 사용한다.
-- ============================================================================

-- 1) CHECK 제약 교체 ---------------------------------------------------------
--    Oracle 은 CHECK 조건을 수정할 수 없어 DROP → ADD 한다.
--    ⚠️ 두 문장 사이에는 제약이 없는 순간이 있지만, 값을 넣는 주체가 앱 하나뿐이고
--      앱은 roles.ts 의 isRole() 로 이미 검증한다.
ALTER TABLE TRX_USER_MAS DROP CONSTRAINT CK_TRX_USER_MAS_ROLE;

ALTER TABLE TRX_USER_MAS ADD CONSTRAINT CK_TRX_USER_MAS_ROLE
    CHECK (ROLE_CD IN ('ADMIN', 'BR', 'DEV', 'FIELD'));

COMMENT ON COLUMN TRX_USER_MAS.ROLE_CD
    IS '권한 (ADMIN=운영자/BR=상위/DEV=개발자/FIELD=현업 — 실적 화면만)';

COMMIT;

-- ============================================================================
-- [확인 쿼리] -- 적용 후 확인용 (앱 자체 DB=GAIA 에서 실행)
-- ============================================================================
-- SELECT SEARCH_CONDITION_VC
--   FROM USER_CONSTRAINTS
--  WHERE CONSTRAINT_NAME = 'CK_TRX_USER_MAS_ROLE';
--
-- SELECT ROLE_CD, COUNT(*) FROM TRX_USER_MAS GROUP BY ROLE_CD ORDER BY 1;

-- ============================================================================
-- [현업 계정 만들기]
--   화면(/accounts)에서 권한 "현업" 을 골라 만드는 것이 정상 경로다.
--   초기 비밀번호는 사번과 동일하게 설정된다(앱이 해시해 저장하므로 여기서 INSERT 하지 말 것).
--
--   ⚠️ 소속(AGENT_ID)을 반드시 기본 에이전트로 둘 것 — /insights 는 BIZ_AIACTIONTXN_HIS
--      집계라 기본 에이전트 전용이고, 미배정(AGENT_ID NULL + GLOBAL_YN='N')이면 잠긴다.
-- ============================================================================
-- -- 기존 계정을 현업으로 내리는 경우
-- UPDATE TRX_USER_MAS SET ROLE_CD='FIELD', UPD_DT=SYSTIMESTAMP WHERE USER_ID='사번';
-- COMMIT;

-- ============================================================================
-- [ROLLBACK]  ※ 되돌리기 전에 FIELD 계정이 남아 있으면 제약 추가가 실패한다.
--   남아 있는 현업 계정을 먼저 DEV 로 올리거나(=접근이 넓어짐, 주의) 삭제할 것.
-- ============================================================================
-- -- SELECT USER_ID FROM TRX_USER_MAS WHERE ROLE_CD = 'FIELD';
-- ALTER TABLE TRX_USER_MAS DROP CONSTRAINT CK_TRX_USER_MAS_ROLE;
-- ALTER TABLE TRX_USER_MAS ADD CONSTRAINT CK_TRX_USER_MAS_ROLE
--     CHECK (ROLE_CD IN ('ADMIN', 'BR', 'DEV'));
-- COMMIT;
