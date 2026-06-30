-- ============================================================================
-- [INSERT on LLM CALL] GAIA 앱이 "LLM 을 호출하고 토큰 사용량 응답을 받은 순간"
--   TRX_TOKEN_DET 에 신규 행을 기록한다.
--
--   * 앱 자체 DB(= GAIA, src/lib/config.ts APP_DB_LAYER) 에서만 실행한다.
--     (BIZ_AIACTIONTXN_HIS 처럼 레이어별로 복제하지 않는다.)
--   * TOKEN_ID 는 IDENTITY 라 INSERT 에서 제외(자동 채번).
--   * REG_DT 는 DEFAULT SYSTIMESTAMP 로 자동 기록되므로 제외.
--   * CALL_TM 은 DB 시각(SYSTIMESTAMP)으로 남겨 시계열 집계가 일관되도록 한다.
--   * TRACE_ID 는 액션 호출이면 채우고, 액션과 무관한 노드 호출이면 NULL 가능.
--   * NODE_NM 은 LLM 을 호출한 노드(action/judge/setup_guide 등) — 집계의 1차 차원.
--   * INPUT_TOKENS/OUTPUT_TOKENS 는 LLM usage 의 prompt_tokens/completion_tokens
--     (= input_tokens/output_tokens) 를 그대로 매핑해서 넣는다.
--   * TOTAL_TOKENS 는 응답값을 그대로 넣되, 응답에 없으면 input+output 합으로 채워 전달.
--   * LATENCY_MS 는 LLM 요청→응답 소요시간(ms). GAIA 가 호출 직전·직후 시각 차로 측정해
--     넣는다. 측정값이 없으면 NULL 로 보내면 집계에서 자동 제외된다.
-- ============================================================================

INSERT INTO TRX_TOKEN_DET (
    TRACE_ID,
    NODE_NM,
    MODEL_NM,
    USER_ID,
    INPUT_TOKENS,
    OUTPUT_TOKENS,
    TOTAL_TOKENS,
    LATENCY_MS,
    CALL_TM
) VALUES (
    :trace_id,          -- 액션 trace ID (없으면 NULL)
    :node_nm,           -- 호출 노드 (action/judge/setup_guide 등)
    :model_nm,          -- 모델명 (ex. claude-opus-4-8)
    :user_id,           -- 사용자 ID (없으면 NULL)
    :input_tokens,     -- 입력 토큰
    :output_tokens, -- 출력 토큰
    :total_tokens,      -- 합계 토큰
    :latency_ms,        -- LLM 호출 소요시간(ms), 없으면 NULL
    SYSTIMESTAMP
);
