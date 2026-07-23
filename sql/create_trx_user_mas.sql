-- ============================================================================
-- TRX_USER_MAS : 사용자 계정 마스터 (로그인 / 인증·인가)
--
--   [용도] TraceX 로그인 계정. 사번(USER_ID)으로 로그인하고, 권한(ROLE_CD)에 따라
--     접근 가능한 화면이 갈린다. 3단계 권한:
--       ADMIN(운영자) > BR(상위 권한자) > DEV(개발자/일반 READ)
--     - DEV : Traces / Dashboard / Tokens / Agent 조회
--     - BR  : + 실적 리포트 / Improvement Center / 이벤트-FAB 매핑
--       ADMIN: + 프로필 편집 / 계정 관리(이 테이블 편집) 등 전체
--     매핑 단일 소스: src/lib/roles.ts (ROUTE_RULES / roleAtLeast)
--
--   ※ 이 테이블은 레이어별로 복제되는 BIZ_AIACTIONTXN_HIS 와 다르다.
--     앱 자체 DB(= GAIA, src/lib/config.ts APP_DB_LAYER)에만 단 한 번 생성한다.
--     (TRX_TOKEN_DET / TRX_ERRMSG_COD / TRX_REQ_FAILURE_INF 와 같은 자리)
--     코드: src/lib/users.ts, config.ts getAppDbConfig()
--
--   ※ 실행 계정: 이 DDL 전체를 ADM 계정(IDMSADM2)으로 실행한다.
--     테이블 소유는 IDMSADM2, 앱이 접속하는 IDMSAPP2 계정은 아래
--     [권한 / PUBLIC SYNONYM] 섹션의 GRANT + PUBLIC SYNONYM 으로
--     스키마 접두어 없이 TRX_USER_MAS 로 참조한다.
--
--   [비밀번호] 평문 저장 금지. Node 내장 crypto 의 scrypt 로 해시(PWD_HASH)하고
--     계정별 난수 솔트(PWD_SALT)를 함께 저장한다 (src/lib/auth/password.ts).
--     비밀번호 초기화 시 MUST_CHG_YN='Y' 로 두면 다음 로그인에서 변경을 유도한다.
--
--   [최초 관리자 시드] 테이블이 비어 있으면 앱이 최초 로그인/계정목록 조회 시
--     기본 운영자 계정을 1건 자동 생성한다 (src/lib/users.ts ensureSeedAdmin):
--       USER_ID='admin' / 비밀번호='admin1234' / ROLE_CD='ADMIN' / MUST_CHG_YN='Y'
--     ⚠️ 최초 로그인 후 반드시 비밀번호를 변경할 것.
-- ============================================================================

CREATE TABLE TRX_USER_MAS (
    USER_ID       VARCHAR2(50)   NOT NULL,                   -- 사번 (로그인 ID, PK)
    USER_NM       VARCHAR2(100)  NOT NULL,                   -- 이름
    WORK_CTN      VARCHAR2(300),                             -- 업무 (담당 업무 설명)
    ROLE_CD       VARCHAR2(10)   DEFAULT 'DEV' NOT NULL,     -- 권한: ADMIN/BR/DEV (roles.ts)
    PWD_HASH      VARCHAR2(256)  NOT NULL,                   -- 비밀번호 scrypt 해시 (hex)
    PWD_SALT      VARCHAR2(64)   NOT NULL,                   -- 비밀번호 솔트 (hex, 계정별 난수)
    USE_YN        CHAR(1)        DEFAULT 'Y' NOT NULL,       -- 사용 여부 (N=비활성/로그인 차단)
    MUST_CHG_YN   CHAR(1)        DEFAULT 'N' NOT NULL,       -- 다음 로그인 시 비밀번호 변경 필요
    LAST_LOGIN_DT TIMESTAMP,                                 -- 최근 로그인 일시
    REG_DT        TIMESTAMP      DEFAULT SYSTIMESTAMP,       -- 등록 일시
    UPD_DT        TIMESTAMP      DEFAULT SYSTIMESTAMP,       -- 최근 수정 일시
    CONSTRAINT PK_TRX_USER_MAS PRIMARY KEY (USER_ID),
    CONSTRAINT CK_TRX_USER_MAS_ROLE CHECK (ROLE_CD IN ('ADMIN','BR','DEV')),
    CONSTRAINT CK_TRX_USER_MAS_USE  CHECK (USE_YN IN ('Y','N')),
    CONSTRAINT CK_TRX_USER_MAS_CHG  CHECK (MUST_CHG_YN IN ('Y','N'))
);

-- 컬럼 코멘트 ---------------------------------------------------------------
COMMENT ON TABLE  TRX_USER_MAS               IS '사용자 계정 마스터 (로그인/인증·인가, 앱 자체 DB=GAIA 전용)';
COMMENT ON COLUMN TRX_USER_MAS.USER_ID       IS '사번 (로그인 ID, PK)';
COMMENT ON COLUMN TRX_USER_MAS.USER_NM       IS '이름';
COMMENT ON COLUMN TRX_USER_MAS.WORK_CTN      IS '업무 (담당 업무 설명)';
COMMENT ON COLUMN TRX_USER_MAS.ROLE_CD       IS '권한 (ADMIN=운영자/BR=상위/DEV=개발자)';
COMMENT ON COLUMN TRX_USER_MAS.PWD_HASH      IS '비밀번호 scrypt 해시 (hex)';
COMMENT ON COLUMN TRX_USER_MAS.PWD_SALT      IS '비밀번호 솔트 (hex, 계정별 난수)';
COMMENT ON COLUMN TRX_USER_MAS.USE_YN        IS '사용 여부 (Y/N)';
COMMENT ON COLUMN TRX_USER_MAS.MUST_CHG_YN   IS '다음 로그인 시 비밀번호 변경 필요 (Y/N)';
COMMENT ON COLUMN TRX_USER_MAS.LAST_LOGIN_DT IS '최근 로그인 일시';
COMMENT ON COLUMN TRX_USER_MAS.REG_DT        IS '등록 일시';
COMMENT ON COLUMN TRX_USER_MAS.UPD_DT        IS '최근 수정 일시';

COMMIT;

-- ============================================================================
-- [권한 / PUBLIC SYNONYM] — IDMSADM2 로 실행
--   - TraceX 앱(IDMSAPP2 접속)은 조회(SELECT) + 계정 CRUD(INSERT/UPDATE/DELETE) 를 쓴다.
--   - IDMSADM2 에 CREATE PUBLIC SYNONYM 권한이 없으면 그 문장만 DBA 에게 요청
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON IDMSADM2.TRX_USER_MAS TO IDMSAPP2;

CREATE PUBLIC SYNONYM TRX_USER_MAS FOR IDMSADM2.TRX_USER_MAS;

-- ============================================================================
-- [확인 쿼리]
-- ============================================================================
-- SELECT USER_ID, USER_NM, ROLE_CD, USE_YN, MUST_CHG_YN FROM TRX_USER_MAS ORDER BY REG_DT;
-- SELECT ROLE_CD, COUNT(*) FROM TRX_USER_MAS GROUP BY ROLE_CD;

-- ============================================================================
-- [ROLLBACK] — IDMSADM2 로 실행 (시노님 → 테이블 순)
-- ============================================================================
-- DROP PUBLIC SYNONYM TRX_USER_MAS;
-- DROP TABLE IDMSADM2.TRX_USER_MAS PURGE;
-- COMMIT;
