-- ============================================================================
-- [INSERT on LLM CALL] GAIA 앱이 "LLM 을 호출한 뒤" TRX_TOKEN_DET 에 신규 행을 기록한다.
--
--   ⚠️ 성공/실패 모두 1행씩 남긴다. call_llm 을 try/except 로 감싸고
--      성공 → STAT_CD='OK', 실패(타임아웃 포함) → STAT_CD='ERROR' 로 적재한다.
--      실패 행을 남기지 않으면 그 노드는 TraceX 에서 통째로 사라져
--      "actionRouter 27초 통과 → Seasoning 90초 타임아웃" 을 추적할 수 없다.
--
--   * 앱 자체 DB(= GAIA, src/lib/config.ts APP_DB_LAYER) 에서만 실행한다.
--     (BIZ_AIACTIONTXN_HIS 처럼 레이어별로 복제하지 않는다.)
--   * TOKEN_ID 는 IDENTITY 라 INSERT 에서 제외(자동 채번).
--   * REG_DT 는 DEFAULT SYSTIMESTAMP 로 자동 기록되므로 제외.
--   * CALL_TM 은 DB 시각(SYSTIMESTAMP)으로 남겨 시계열 집계가 일관되도록 한다.
--   * TRACE_ID 는 액션 호출이면 채우고, 액션과 무관한 노드 호출이면 NULL 가능.
--   * NODE_NM 은 LLM 을 호출한 노드(action/judge/setup_guide 등) — 집계의 1차 차원.
--     실패 행에서 특히 중요하다: "어느 노드에서 끊겼나" 를 이 값으로 읽는다.
--   * INPUT_TOKENS/OUTPUT_TOKENS 는 LLM usage 의 prompt_tokens/completion_tokens
--     (= input_tokens/output_tokens) 를 그대로 매핑해서 넣는다. 실패면 0.
--   * TOTAL_TOKENS 는 응답값을 그대로 넣되, 응답에 없으면 input+output 합으로 채워 전달.
--   * LATENCY_MS 는 LLM 요청→응답 소요시간(ms). 성공이면 응답까지, 실패면 예외까지의
--     경과시간을 넣는다(타임아웃이면 사실상 타임아웃 한도값). 측정값이 없으면 NULL.
--   * QUERY_CTN 은 LLM 에 실제로 들어간 쿼리/프롬프트(디버깅용). 최대 4000자이므로
--     길면 GAIA 쪽에서 잘라서 넣는다. 없으면 NULL.
--   * STAT_CD 는 'OK' / 'ERROR' 두 값만 쓴다. 타임아웃도 'ERROR' 이고 구분은 ERR_CTN 문구로.
--     (TraceX 가 ERR_CTN 에서 timeout/시간초과 류 문구를 찾아 TIMEOUT 으로 표기한다.)
--   * ERR_CTN 은 실패 사유. 예외 타입 + 메시지를 그대로 넣으면 좋다.
--     예) "ReadTimeout: HTTPSConnectionPool read timed out. (read timeout=90)"
--     최대 1000자이므로 스택트레이스 전체가 아니라 앞부분만 잘라서 넣는다.
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
    QUERY_CTN,
    STAT_CD,
    ERR_CTN,
    CALL_TM
) VALUES (
    :trace_id,          -- 액션 trace ID (없으면 NULL)
    :node_nm,           -- 호출 노드 (action/judge/setup_guide 등)
    :model_nm,          -- 모델명 (ex. claude-opus-4-8)
    :user_id,           -- 사용자 ID (없으면 NULL)
    :input_tokens,      -- 입력 토큰 (실패면 0)
    :output_tokens,     -- 출력 토큰 (실패면 0)
    :total_tokens,      -- 합계 토큰 (실패면 0)
    :latency_ms,        -- 성공: 응답까지 / 실패: 예외까지 경과시간(ms), 없으면 NULL
    :query_ctn,         -- LLM 에 들어간 실제 쿼리/프롬프트(디버깅용, 최대 4000자), 없으면 NULL
    :stat_cd,           -- 'OK' | 'ERROR'
    :err_ctn,           -- 실패 사유 (성공이면 NULL, 최대 1000자)
    SYSTIMESTAMP
);

-- ============================================================================
-- [GAIA 적재 예시] call_llm 을 try/except 로 감싸 성공/실패 모두 한 줄 남긴다.
--   커넥션/커밋 관리는 GAIA 서버에 이미 있으므로 적재 위치만 참고.
--
--   started = time.monotonic()
--   try:
--       resp  = call_llm(prompt)                      # ← 여기서 90s 타임아웃이 터진다
--       usage = resp.get("usage") or {}
--       insert_token_det(
--           trace_id=trace_id, node_nm=node_nm, model_nm=model_nm, user_id=user_id,
--           input_tokens =usage.get("prompt_tokens", 0),
--           output_tokens=usage.get("completion_tokens", 0),
--           total_tokens =usage.get("total_tokens",
--                                   usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0)),
--           latency_ms=int((time.monotonic() - started) * 1000),
--           query_ctn=prompt[:4000],
--           stat_cd="OK", err_ctn=None,
--       )
--       return resp
--   except Exception as e:                            # 타임아웃/커넥션/파싱 오류 전부
--       insert_token_det(
--           trace_id=trace_id, node_nm=node_nm, model_nm=model_nm, user_id=user_id,
--           input_tokens=0, output_tokens=0, total_tokens=0,
--           latency_ms=int((time.monotonic() - started) * 1000),   # 예외까지 실제로 기다린 시간
--           query_ctn=prompt[:4000],
--           stat_cd="ERROR",
--           err_ctn=f"{type(e).__name__}: {e}"[:1000],  # 예: "ReadTimeout: read timeout=90"
--       )
--       raise
--
--   ※ 적재 실패가 원래 예외를 덮지 않도록 insert_token_det 내부는 자체 try/except 로
--     감싸고, 실패 시 로그만 남기고 넘어가는 편이 안전하다.
-- ============================================================================
