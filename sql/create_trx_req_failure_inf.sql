-- ============================================================================
-- TRX_REQ_FAILURE_INF : 요청 실패 조치 정보 (Request Failure Tracker)
--
--   [소속] TraceX > Improvement Center > Request Failure Tracker
--     Improvement Center 는 AI 에이전트 개선 허브(확장 가능한 플랫폼)이고,
--     Request Failure Tracker 는 그 첫 모듈 — 에이전트가 라우팅/LLM 단계에서
--     처리하지 못하고 튕긴 요청을 관리자가 추적·정정·조치한다. 이 테이블은
--     그 "조치 정보(상태/메모/담당자)"를 영속한다.
--
--   ※ 이 테이블은 레이어별로 복제되는 BIZ_AIACTIONTXN_HIS 와 다르다.
--     앱 자체 DB(= GAIA, src/lib/config.ts APP_DB_LAYER)에만 단 한 번 생성한다.
--     (TRX_TOKEN_DET / TRX_ERRMSG_COD 와 같은 자리 — GAIA 가 전용 DB 자원을 겸용)
--     코드: src/lib/requestFailures.ts, config.ts getAppDbConfig()
--
--   ※ 실행 계정: 이 DDL 전체를 ADM 계정(IDMSADM2)으로 실행한다.
--     테이블 소유는 IDMSADM2, 앱이 접속하는 IDMSAPP2 계정은 아래
--     [권한 / PUBLIC SYNONYM] 섹션의 GRANT + PUBLIC SYNONYM 으로
--     스키마 접두어 없이 TRX_REQ_FAILURE_INF 로 참조한다.
--
--   [실패 요청 정의] GAIA(= ACTION_TYP 권위 레이어)에서 메시지는 받았는데 ACTION_TYP
--     을 못 붙인 요청: ACTION_TYP IS NULL AND RECV_MSG_CTN IS NOT NULL. 보통 액션
--     라우팅 실패이거나 LLM 오류로 튕긴 요청이다.
--
--   행 단위 : 실패 요청 1건(= TRACE_ID) 당 조치 1행. TRACE_ID 가 PK 라 upsert(MERGE).
--   저장 방식: 앱이 이 테이블의 마스터 — 조치 저장은 TRACE_ID 기준 MERGE(있으면 UPDATE,
--             없으면 INSERT). 실패 요청 원본은 BIZ_AIACTIONTXN_HIS 에 있고, 이 테이블은
--             거기에 얹는 "조치 오버레이" 라서 실패 요청 자체를 여기 복제하지 않는다.
--   조인 규칙: 화면은 BIZ(ACTION_TYP IS NULL …) 결과에 이 테이블을 TRACE_ID 로 LEFT JOIN
--             (JS 병합)해 상태를 얹는다. 이 테이블에 행이 없는 요청 = '미조치(open)'.
--
--   상태값(STATUS) : open(미조치) / investigating(조치중) / resolved(조치완료) / ignored(무시)
--                    — src/lib/types.ts FAILURE_STATUSES 와 일치. 코드값(영문)으로 저장한다.
-- ============================================================================

CREATE TABLE TRX_REQ_FAILURE_INF (
    TRACE_ID    VARCHAR2(100)  NOT NULL,                  -- 실패 요청 식별자 = BIZ_AIACTIONTXN_HIS.TRACE_ID (PK, 요청 1건당 1행)
    STATUS      VARCHAR2(20)   DEFAULT 'open' NOT NULL,   -- 조치 상태: open/investigating/resolved/ignored (types.ts FAILURE_STATUSES)
    NOTE_CTN    VARCHAR2(2000),                           -- 조치 메모 (원인·정정 내용, 자유 텍스트)
    HANDLER_ID  VARCHAR2(50),                             -- 조치 담당자(작성자) ID (※ 로그인 도입 시 로그인 계정 자동 기록 예정)
    REG_DT      TIMESTAMP      DEFAULT SYSTIMESTAMP,      -- 최초 조치 등록 일시
    UPD_DT      TIMESTAMP      DEFAULT SYSTIMESTAMP,      -- 최근 수정 일시
    CONSTRAINT PK_TRX_REQ_FAILURE_INF PRIMARY KEY (TRACE_ID)
);

-- 컬럼 코멘트 ---------------------------------------------------------------
COMMENT ON TABLE  TRX_REQ_FAILURE_INF            IS '요청 실패 조치 정보 (앱 자체 DB=GAIA 전용 — TraceX > Improvement Center > Request Failure Tracker 에서 편집)';
COMMENT ON COLUMN TRX_REQ_FAILURE_INF.TRACE_ID   IS '실패 요청 식별자 = BIZ_AIACTIONTXN_HIS.TRACE_ID';
COMMENT ON COLUMN TRX_REQ_FAILURE_INF.STATUS     IS '조치 상태 (open=미조치/investigating=조치중/resolved=조치완료/ignored=무시)';
COMMENT ON COLUMN TRX_REQ_FAILURE_INF.NOTE_CTN   IS '조치 메모 (원인·정정 내용)';
COMMENT ON COLUMN TRX_REQ_FAILURE_INF.HANDLER_ID IS '조치 담당자 ID';
COMMENT ON COLUMN TRX_REQ_FAILURE_INF.REG_DT     IS '최초 조치 등록 일시';
COMMENT ON COLUMN TRX_REQ_FAILURE_INF.UPD_DT     IS '최근 수정 일시';

COMMIT;

-- ============================================================================
-- [권한 / PUBLIC SYNONYM] — IDMSADM2 로 실행
--   - TraceX 앱(IDMSAPP2 접속)은 조회(SELECT) + upsert(INSERT/UPDATE) 를 쓴다.
--     (조치 취소용 DELETE 는 현재 미사용이나 운영 편의상 함께 부여)
--   - IDMSADM2 에 CREATE PUBLIC SYNONYM 권한이 없으면 그 문장만 DBA 에게 요청
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON IDMSADM2.TRX_REQ_FAILURE_INF TO IDMSAPP2;

CREATE PUBLIC SYNONYM TRX_REQ_FAILURE_INF FOR IDMSADM2.TRX_REQ_FAILURE_INF;

-- ============================================================================
-- [확인 쿼리]
-- ============================================================================
-- SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE
--   FROM USER_TAB_COLUMNS
--  WHERE TABLE_NAME = 'TRX_REQ_FAILURE_INF'
--  ORDER BY COLUMN_ID;

-- 권한/시노님 확인 (IDMSAPP2 로 접속해서):
-- SELECT COUNT(*) FROM TRX_REQ_FAILURE_INF;   -- 시노님 경유 조회가 되면 OK

-- 상태별 조치 현황 한눈에 보기:
-- SELECT STATUS, COUNT(*) FROM TRX_REQ_FAILURE_INF GROUP BY STATUS ORDER BY STATUS;

-- ============================================================================
-- [ROLLBACK] — IDMSADM2 로 실행 (시노님 → 테이블 순)
-- ============================================================================
-- DROP PUBLIC SYNONYM TRX_REQ_FAILURE_INF;
-- DROP TABLE IDMSADM2.TRX_REQ_FAILURE_INF PURGE;
-- COMMIT;
