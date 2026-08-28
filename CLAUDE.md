# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Next.js dev server (App Router)
- `npm run build` — production build
- `npm run start` — serve the built app
- `npm run lint` — `next lint`

There is no test runner configured.

## Big picture

TraceX is a single-page **AI Action Transaction trace viewer** built on Next.js 14 (App Router, React 18, TypeScript strict). It reads the `BIZ_AIACTIONTXN_HIS` table that is replicated across one Oracle database per layer in the request path. The current path is `CUBE → GAIA → MCP → ONEOIS`, but the layer set is **data-driven**: the `LAYERS` array at the top of `src/lib/types.ts` is the single source of truth. Everything else (`LayerKey`, `LAYER_ORDER`, `LAYER_LABEL`, `LAYER_COLOR`, the API’s `allComplete` check, the stepper, the `/N` denominator, the inline tag colors) is derived from it. Adding/removing/reordering a layer = edit that array + add/remove the matching block in `config.yml` / `config.dev.yml`. The UI reconstructs a single end-to-end trace by joining rows from all configured layers on `TRACE_ID`.

### Data flow

1. Browser (`src/app/page.tsx`, client component) calls the two API routes:
   - `GET /api/traces` — list view, returns **works** (traces grouped into one field job each; see "Work grouping" below)
   - `GET /api/traces/[traceId]` — detail view, returns the raw rows across layers
2. Route handlers in `src/app/api/traces/` delegate to `src/lib/db.ts`.
3. `db.ts` fans out **one query per layer** in parallel (`Promise.all` over `LAYER_ORDER`), each using its own connection config read from the YAML loader in `src/lib/config.ts` (see "Config files" below).
   - ⚠️ **목록 조회는 반드시 2단계** — 자르는 단위가 "행" 이면 안 되고 **"트레이스"** 여야 한다.
     ① `fetchRecentTraceIds(filter)` 가 레이어별 `GROUP BY TRACE_ID` 로 최근 TRACE_ID 를 뽑아 **합집합** 상위 N 을 확정하고
     ② `fetchAllRows({ traceIds })` 가 **행 필터 없이** 그 트레이스의 전 레이어 행을 통째로 읽는다.
     레이어별로 `FETCH FIRST N` 을 따로 걸어 합치면 같은 N 행이라도 커버하는 시간대가 레이어마다 달라
     (라우팅 실패는 MCP 미도달 → MCP 행이 적고, GAIA 는 멀티콜로 행이 많다) 목록 아래쪽이
     **한 레이어 행만 들어온 트레이스**로 채워지고 LAYERS 점이 그 레이어 하나만 켜진다. 같은 이유로
     행 단위 필터(`errCd`/`onlyError`/기간)를 2단계에 걸면 안 된다 — 에러 조건은 route 의
     `keepErrorMatchingTraces()` 가 **트레이스 단위**로 판정한다. FAC/ACTION_TYP/USER_ID 는 기존대로
     `fetchTraceIdsBy()` 가 1단계를 맡는다.
   - Oracle `ORDER BY <ts> DESC` 의 기본은 **NULLS FIRST** 라, RECV_TM 이 빈 멀티콜 2번째 행이 상한을 먼저 먹는다.
     행수 상한이 붙는 정렬에는 `DESC NULLS LAST` 를 명시한다.
   - 목록 상한은 **TRACE 건수** 기준 기본 500 (`DEFAULT_LIMIT`), `db.ts` 가 **500 으로 clamp** 한다 —
     2단계가 `TRACE_ID IN (...)` 이라 Oracle IN 목록 상한(1000)에 여유를 둔 값이다. 더 늘리려면
     `fetchAllRows` 가 traceIds 를 나눠 조회하도록 먼저 고쳐야 한다.
   - 목록 조회는 `lean: true` 로 **요청/전달 본문(RECV_MSG_CTN/SEND_MSG_CTN)을 빼고** 읽는다
     (`db.ts` `SUMMARY_COLUMNS`). 목록은 요약만 만들면 되고 본문은 행당 수 KB 라 500건이면 그대로 지연이 된다.
     `RESP_MSG_CTN` 은 남긴다 — TEMP 상태 판정이 CUBE 응답 문구를 본다. ⚠️ lean 행의
     `recvMsgCtn`/`sendMsgCtn` 은 **항상 null** 이므로 본문이 필요한 곳(상세)은 lean 을 켜지 않는다.
4. `/api/traces` groups rows by `TRACE_ID` and computes `allComplete` (requires `layerSet.size === LAYER_ORDER.length` and every row `SEND_COMPLT_YN='Y'`) and `hasError`. `lastSendTm` in `TraceSummary` is the max of all `sendTm` and `respTm` values.
5. `/api/traces` then hands those summaries to `buildWorks()`, which groups them into **works** via `src/lib/workGroup.ts` and back-fills the sibling traces of every matched work. See "Work grouping" below.
6. `TraceTimeline` groups rows by layer and renders them. Single-call layers show **recv | send | resp** in a 3-column layout; multi-call layers show the upstream recv once at the top, then numbered `Call #N` items each with a **send | resp** pair.

### Row lifecycle — 3-phase write pattern

Each layer records **one row per call cycle** using three DML operations in `sql/`:

| Phase | File | When | What changes |
|-------|------|------|--------------|
| 1 | `dml_insert_recv.sql` | Message received from upstream | INSERT with `RECV_*` filled, `SEND_COMPLT_YN='N'` |
| 2 | `dml_update_send.sql` | Message forwarded to downstream | UPDATE `SEND_SYS_ID`, `SEND_MSG_CTN`, `SEND_TM`, `FAC_ID` / `AREA_ID` (MCP only) |
| 3 | `dml_update_resp.sql` | Response received from downstream | UPDATE `RESP_MSG_CTN`, `RESP_TM`, `HTTP_STS_CD`, `SEND_COMPLT_YN='Y'` |

`SEND_COMPLT_YN='Y'` is only set in phase 3 (response received), not on send. This means a row with `SEND_COMPLT_YN='N'` and a non-null `SEND_TM` indicates "sent but awaiting response".

### Schema key columns (`BIZ_AIACTIONTXN_HIS`)

PK is `(TRACE_ID, TIMEKEY)`, which allows **multiple rows per layer per trace** (e.g. GAIA calling MCP twice). Each row captures one full round-trip to the downstream system:

- `RECV_SYS_ID` / `RECV_MSG_CTN` / `RECV_TM` — upstream request received by this layer
- `SEND_SYS_ID` / `SEND_MSG_CTN` / `SEND_TM` — request forwarded to downstream
- `RESP_MSG_CTN` / `RESP_TM` — response received **back from** the downstream system
- `HTTP_STS_CD` — HTTP status of the downstream response (e.g. `201`, `401`), written per row at phase 3 by every layer. Surfaced in `TraceTimeline` next to the route (single-call card head; per `Call #N` header for multi-call).
- `FAC_ID` / `AREA_ID` — same concept; both written **only by MCP** at phase 2 (send-update; first known at MCP). The columns exist in **all** layer tables (the shared SELECT fans out to every DB), but non-MCP rows leave them null. Drive the dashboard "FAC별" / "AREA별" breakdowns (`byFac` / `byArea`).
- `CHANNEL_ID` / `ACTION_TYP` — channel / action dimensions, written by the top layer on INSERT. `CHANNEL_ID` is still selected into `TraceRow` but no longer aggregated (channel breakdown was removed); `ACTION_TYP` drives the dashboard "액션 타입별" breakdown and the `/api/action-types` filter options.
  - **`ACTION_TYP` 없음 = "라우팅 실패"**: 모든 BIZ 트레이스는 액션 요청이다(setup_guide/judge 같은 비액션 흐름은 BIZ 에 안 쌓이고 `TRX_TOKEN_DET` 에만 남는다). 따라서 `ACTION_TYP` 이 비어 있다는 건 ACTION ROUTER 에서 실제 ACTION 노드로 못 가고 튕긴 = **라우팅 단계에서 실패한 액션**이라는 뜻이다. 이런 트레이스는 **반드시 `errCd` 를 동반**하므로 status 는 이미 fail 로 집계되고 topErrors 에도 실제 코드로 잡힌다. `stats/route.ts` 의 "액션 타입별" 집계는 이 트레이스의 키를 `(none)` 대신 `ROUTING_FAIL_LABEL`("라우팅 실패", `types.ts`)로 표기한다 — 표기 전용 라벨이라 실제 `ACTION_TYP` 값이 아니므로 `DimensionBreakdown` 에서 필터 클릭 대상에서 제외한다(단 `(none)` 처럼 흐리게 하진 않음 — 의미 있는 실패 항목). FAC/AREA 의 `(none)`(=MCP 미도달)과는 무관.
- `SEND_COMPLT_YN` — `'Y'` only after response received (full round-trip complete)

For layers that make multiple downstream calls in one trace (e.g. GAIA → MCP twice), only the first row has `RECV_MSG_CTN` populated; subsequent rows leave it null.

### Multi-call handling in the UI

`TraceTimeline.tsx` groups `TraceRow[]` by layer before rendering. `SingleCallCard` handles the `rows.length === 1` case (3-col). `MultiCallCard` handles `rows.length > 1`: it reads `recvMsgCtn` from the first row and renders each row's `send`/`resp` as a numbered call. The `Stepper` shows call count (`N calls`) in the subtitle when a layer has multiple rows.

### Config files

`src/lib/config.ts` loads YAML at startup (cached): if `config.dev.yml` exists it's used and `appEnv='dev'`, otherwise `config.yml` is used and `appEnv='prd'`. Both files are committed to the repo. `deploy.sh` deletes `config.dev.yml` on prd deploys so the loader picks `config.yml`. The schema is `{ layers: { <LAYER>: { user, password, connectString } } }`. `loadConfig()` strips any layer entry missing one of the three credential fields, so partially-filled layers behave like "not configured" and return empty rows from `queryLayer`.

### 멀티 에이전트 — Tokens / Timeout 만 에이전트별 (⚠️ config.yml `agents:`)

이 앱은 원래 이억수 에이전트 하나를 전제로 만들어졌지만, 다른 팀 에이전트도 **Tokens / Timeout
두 화면만** 쓴다. 두 화면의 출처는 `TRX_TOKEN_DET` 하나이고 에이전트마다 GAIA DB 가 다르다.

- **정의는 `config.yml` 의 `agents:`** — `{ id, name, avatar, default, db, tpmLimit, rpmLimit }`.
  `id` 가 전 계층의 키다 (`?agent=<id>`, `localStorage["tracex.agent"]`, `TRX_USER_MAS.AGENT_ID`).
  ⚠️ **계정별 접근 제한이 있다** — 범위는 계정의 `GLOBAL_YN`/`AGENT_ID` 로 정해지며 판정은
  `src/lib/roles.ts` 의 `resolveScope()`/`canViewAgent()` 한 곳이다 (아래 "인증/인가 — 에이전트 범위").
  집행 지점은 조회 라우트의 `requireAgent()` 403 이고, `/api/agents` 의 목록 필터는 표시용이다.
  기본 에이전트(`default: true`)가 `db` 를 생략하면 `layers.GAIA` 를 재사용한다.
  **`agents:` 섹션이 없으면 `layers.GAIA` 를 쓰는 단일 에이전트를 합성**하므로 기존 배포가 그대로 돈다.
- **로더는 `src/lib/config.ts`** — `listAgents()` / `getAgent(id)` / `getAgentDbConfig(id)` /
  `defaultAgentId()` / `publicAgents()`. ⚠️ `AgentDef` 는 접속정보를 품으므로 서버 전용이고,
  클라이언트로 내려가는 건 `publicAgents()` 가 만드는 `AgentInfo`(비밀 제거, `dbConfigured` 만) 뿐이다.
- **에이전트별로 갈리는 모듈은 넷**: `tokens.ts` · `timeouts.ts` · `tickStats.ts` (DB 선택) 과
  `profile.ts` (파일 선택). 앞 셋은
  `getAppDbConfig()` 대신 `getAgentDbConfig(filter.agentId)` 로 커넥션을 고른다.
  ⚠️ **agentId 는 WHERE 조건이 아니라 커넥션 선택이다** — 에이전트는 행이 아니라 DB 단위로 갈린다.
  `buildWhere()` 는 손대지 않는다. `getAppDbConfig()` 는 앱 공통 테이블(`TRX_USER_MAS`,
  `TRX_ERRMSG_COD`)용으로 그대로 남는다.
- **라우트**: `GET /api/agents`(목록 — 프로필의 이름/아바타/한도를 얹어 내린다) +
  `/api/tokens`·`/api/tokens/tick`·`/api/timeouts`·`/api/profile` 의 `?agent=<id>`.
  ⚠️ **알 수 없는 id 는 400 이다** — 조용히 기본으로 폴백하면 남의 에이전트 수치를
  자기 것으로 오독한다. 조회 응답은 `agentId` 를 에코한다.
- **화면**: `AgentScopeProvider`(`src/components/agents/`)가 선택 상태를 쥐고 `localStorage` 에
  영속한다. 상단바 `AgentSelector`(에이전트 1개면 미렌더). **비기본 에이전트를 고르면 `TabNav` 가
  Tokens/Timeout 만 남기고** 우측 칩은 그 에이전트의 프로필(`/agent?agent=<id>`)로 간다.
  ⚠️ **BIZ 계열 경로로 이동하면
  기본 에이전트로 스냅백**한다 — 숨긴 화면에 남의 에이전트 컨텍스트가 걸린 상태를 만들지 않는다.
  스냅백 effect 의 deps 는 **`[pathname]` 뿐**이다(agentId 를 넣으면 셀렉터로 고른 직후 되돌아간다).
- **BIZ_AIACTIONTXN_HIS 기반 화면은 전부 기본 에이전트 전용**이다 — Traces / Dashboard /
  `/report` / `/improvement` / `/event-fabs`. 경로 목록은 `roles.ts` 의 `isBizPath()` 단일 소스이고,
  ⚠️ **서버에서 막는다**: 각 API 가 `requireBiz()` 로 판정하고(권위), 미들웨어는 세션의
  `bizAllowed` 클레임으로 화면을 `/tokens` 로 되돌린다(UX). 예전엔 클라이언트 스냅백뿐이라
  **URL 을 직접 치면 그대로 열렸다**.
- **프로필(`/agent`, `/admin`)은 에이전트마다 따로다** — `data/agent-profile.json`(기본, 파일명 유지)
  / `data/agent-profile.<id>.json`. 비기본 에이전트는 **FTE 섹션이 없다**(BIZ 집계라 남의 실적이 된다).
  `/admin` 은 전역 운영자에게 편집 대상 셀렉터를 띄우고, 에이전트 운영자에게는 자기 것 하나만 온다.
- **TPM/RPM 한도는 `/admin` 의 "사용량 한도" 에서 편집**한다(`AgentProfile.tpmLimit`/`rpmLimit`).
  ⚠️ 우선순위는 **프로필 > config.yml** — 프로필 값이 0(미설정)이면 `config.yml` 의 `agents[]` 값이
  쓰인다. 병합 지점은 `/api/agents` 한 곳이다. 접속정보는 여전히 `config.yml` 전용이다.

### App-owned DB — GAIA's DB doubles as it (⚠️ important)

The app needs its own DB for **app-only tables** (not the replicated `BIZ_AIACTIONTXN_HIS`). **No dedicated DB resource could be allocated, so GAIA's DB serves as the app's own DB.** This mapping lives in one place: `APP_DB_LAYER` (`= "GAIA"`) and `getAppDbConfig()` in `src/lib/config.ts` — if GAIA's DB moves, only that constant follows it. App-only tables are created **once, in that DB only** (unlike the per-layer BIZ table).

- **`TRX_ERRMSG_COD`** — error-code → meaning master (`sql/create_trx_errmsg_cod.sql`, run on the app DB only). Columns `ERR_CD` (PK), `ERR_MSG_CTN`, `USE_YN`, audit dates. `ERR_CD` matches `BIZ_AIACTIONTXN_HIS.ERR_CD`.
- Read path: `src/lib/errorCodes.ts` `loadErrorCodeMap()` (5-min in-memory cache, same lazy-`oracledb`-swallow pattern) → `GET /api/error-codes` → dashboard fetches once on mount and passes the map to the "주요 에러" `TopList` as `descriptions`, which surfaces the meaning in the hover tooltip. Missing table/driver/config ⇒ empty map ⇒ tooltip just shows the bare code (no breakage).
- **`TRX_TOKEN_DET`** — GAIA LLM 호출별 토큰 사용량 상세 (`sql/create_trx_token_det.sql`, run on the app DB only). One row **per LLM call**, inserted by GAIA via `sql/dml_insert_token_det.sql`. Columns: `TOKEN_ID` (IDENTITY PK), `TRACE_ID` (nullable — present for action calls, used only for display not aggregation), `NODE_NM` (the GAIA node that made the call: `action`/`judge`/`setup_guide` … — **primary aggregation dimension**), `MODEL_NM` (GAIA 호출 LLM, 현재 사내 Qwen — 변경 가능), `USER_ID`, `INPUT_TOKENS`/`OUTPUT_TOKENS`/`TOTAL_TOKENS` (provider-neutral 명칭 — Qwen 등 OpenAI 호환 응답의 `prompt_tokens`/`completion_tokens` 를 매핑), `LATENCY_MS` (LLM 요청→응답 소요시간 ms, **nullable** — GAIA 가 측정해 적재; 없으면 집계에서 자동 제외), `QUERY_CTN` (LLM 에 실제로 들어간 쿼리/프롬프트 — `VARCHAR2(4000)`, **디버깅용, nullable**; 집계 대상 아님, 호출 펼침에서만 노출), `STAT_CD`/`ERR_CTN` (호출 결과 — 아래 "실패 호출" 참고), `CALL_TM`, `REG_DT`. Unlike `BIZ_AIACTIONTXN_HIS`, this is **not** replicated per layer. 단, **에이전트마다 별도 DB** 에 있다 (위 "멀티 에이전트" 참고).
  - **⚠️ 실패 호출도 1행 적재한다 (`STAT_CD`/`ERR_CTN`)**. GAIA 가 `call_llm` 을 try/except 로 감싸 **성공은 `STAT_CD='OK'`, 실패(타임아웃 포함)는 `'ERROR'` + `ERR_CTN`(사유) + 토큰 0 + `LATENCY_MS`=예외까지의 경과시간**으로 남긴다. 성공만 적재하던 때는 실패한 노드의 행 자체가 없어 **"actionRouter 27s 통과 → Seasoning 90s 타임아웃" 의 뒷부분이 화면에서 통째로 사라졌고**, 지연 평균도 생존자 편향으로 낮게 나왔다. 타임아웃/일반오류 구분은 `STAT_CD` 가 아니라 **`ERR_CTN` 문구**로 한다 — 판정은 `src/lib/tokenStatus.ts` 의 `callStatus()` 한 곳(서버·클라이언트 공용, SQL 술어 `SQL_ERR_PRED`/`SQL_OK_PRED` 도 여기).
  - **컬럼 미존재 내성**: `fetchTokenStats` 는 시작 시 `SELECT STAT_CD, ERR_CTN ... WHERE 1=0` 로 **컬럼 존재를 탐지**(`hasStatus`)하고, 없으면(ALTER 전) 실패 관련 표현식을 전부 상수로 대체해 예전과 동일하게 동작한다(`errorNodes` 빈 배열, `statCd` null → `callStatus()` 가 'ok'). 덕분에 ALTER·GAIA 배포·앱 배포 순서가 자유롭다.
- Read path: `src/lib/tokens.ts` `fetchTokenStats()` (same lazy-`oracledb`-swallow pattern; aggregates in **SQL `GROUP BY`** rather than JS since the table can be large) → `GET /api/tokens` → the **Tokens 탭** (`src/app/tokens/page.tsx`). Time-bucket helpers are shared with the stats route via `src/lib/timeBuckets.ts` (`pickGranularity`/`floorToBucket`/`isoNoTz`/`parseTs`/`enumerateBucketStarts`). Missing table/driver/config ⇒ empty stats (zeros) ⇒ page renders empty chart (no breakage).
  - `fetchTokenStats` 도 latency 를 집계한다: 버킷별 `avgLatencyMs`(`SUM/COUNT` 로 NULL 제외 평균), 전체 `avgLatencyMs`, `byNode`/`byModel` 의 `avgLatencyMs`(`AVG`). LATENCY_MS 가 한 건도 없으면 모두 null → UI 는 빈 상태/측정값 없음 표시(무해). ⚠️ **지연 평균은 성공 호출만** 대상이다(`CASE WHEN <OK> THEN LATENCY_MS END`) — 타임아웃(예: 90s 한도)이 섞이면 평균이 한도값 쪽으로 끌려가 "모델이 느려졌다" 로 오독된다. 실패 건의 소요시간은 질문 펼침의 호출 카드에서 개별로 본다.
  - **UI 는 최소한으로만 얹는다** (요구사항: 대시보드/차트에 실패 지표를 늘리지 말 것). 응답에 내려가는 건
    `TokenQuestion.errorNodes`(그 질문에서 LLM 호출이 실패한 노드 이름들)와 `TokenRow.statCd`/`errCtn`(행 펼침용 `calls`) 둘뿐이다.
    화면 반영도 **질문별 토큰 표 한 곳**: NODE 칩 중 끊긴 노드만 빨갛게, 펼친 호출 카드에 `타임아웃`/`실패` 배지 + 사유 한 줄.
    KPI·추이 차트·리더보드에는 실패 관련 표시를 넣지 않는다.
  - 다만 **지연 평균은 성공 호출만** 집계한다(`CASE WHEN <OK> THEN LATENCY_MS END`) — 화면엔 안 드러나지만
    타임아웃(90s 한도)이 섞이면 평균이 한도값으로 끌려가 "모델이 느려졌다" 로 오독되기 때문.
  - **타임아웃 추적은 Tokens 탭이 아니라 `/timeouts` 탭이 담당한다** (아래 "Timeout 탭" 참고).
  - The Tokens 탭 has two halves: **현황**(KPI/추이 — `TokenStatsCards`/`TokenChart`, LLM 속도 추이 차트 `TokenLatencyChart`, 노드별/모델별 리더보드 카드 `TokenBreakdown` — `byNode`/`byModel` 를 각각 별도 카드(노드=파랑, 모델=보라)로 렌더, 순위 배지 + 큰 값 + 1위 대비 상대 바 + 비중%, 토큰/호출/토큰·호출/속도 공유 메트릭 토글, 행 클릭 = 노드/모델 필터. **노드×모델 교차 집계**(`TokenDimStat.sub`, 별도 `GROUP BY NODE_NM, MODEL_NM` 쿼리)로 각 노드가 실제 쓴 모델 구성(역방향도)을 행 안에 칩+비중% 로 노출 — 한 질문이 여러 노드/모델을 거치므로(예: actionRouterNode=qwen3.6 → SeasoningNode=qwen3.5) "노드=모델 1개" 로 오해하지 않게 하는 장치) and **질문별 토큰**(`QuestionsTable`). A "질문" = one `TRACE_ID`; 한 질문의 호출은 라우터→실행 노드처럼 **여러 노드/모델을 거칠 수 있어** `questions` 는 대표값(MAX) 대신 거쳐간 노드/모델 **전부**를 내린다(`nodes[]`/`models[]`, `LISTAGG ... ON OVERFLOW TRUNCATE` 후 JS 중복 제거, 첫 호출 순) — 표에는 칩으로 나열. `fetchTokenStats` returns `questions` (grouped by `TRACE_ID`, null-trace rows treated as one-call-per-question, **최신 LAST_TM desc 상위 500건** — 토큰순 로드였을 때 최근 질문이 잘려 보이는 착시가 있어 최신순으로 변경). 집계 쿼리들은 `run()` 헬퍼로 **쿼리별 격리 실행**되어 한 쿼리가 SQL 에러여도 그 섹션만 비고 나머지는 정상, 로그에 `fetchTokenStats [섹션명] query failed` + ORA 코드가 남는다. **질의 = 질문의 대표 정보** 관점: 한 질문의 호출들은 같은 `QUERY_CTN` 을 공유하는 게 보통이라, `questions` 가 **원본 질의**(`queryCtn` — 가장 이른 non-null 호출의 QUERY_CTN, `MIN ... KEEP (DENSE_RANK FIRST ORDER BY NVL2(QUERY_CTN,0,1), CALL_TM)`)를 질문 단위로 내리고 표의 질문 셀은 **질의(크게) + TRACE_ID(작게) 2줄**로 그린다. `QuestionsTable` 은 **컬럼별 필터**(질문(질의+TRACE_ID)/USER 텍스트, NODE/MODEL 셀렉트 — 로드된 상위 질문 범위 내 클라이언트 필터) + **헤더 클릭 정렬**(LAST_TM/IN/OUT/TOTAL/CALLS, 재클릭 = 방향 토글, 기본 = LAST_TM desc) 구조. Passing `?traceId=` narrows everything and fills `calls` (per-call rows, incl. `queryCtn`/`latencyMs`) used to expand a question inline. ⚠️ **`calls` 쿼리만은 `TRACE_ID` 단독 조회**다 — 기간/노드/모델 필터를 걸지 않는다. 질문을 펼치는 목적은 그 질문이 실제로 거친 호출 **전부**(라우터→실행 노드)를 보는 것이고, 나머지 필터는 "질문을 찾는" 조건일 뿐이다. 예전엔 창을 그대로 적용한 데다 클라이언트가 **펼침 시점의 `Date.now()`로 창을 다시 계산**해서, 화면을 띄워두고 시간이 흐르면 같은 질문의 호출이 1건/2건으로 잘려 보였다(프리셋 창이 앞으로 밀림). 그래서 `fetchCalls` 도 `traceId` 만 보낸다. 대신 표의 `CALLS`(기간 내 집계)보다 상세가 많을 수 있어 `CallsDetail` 이 "조회 조건 밖 N건 포함" 배지로 차이를 밝힌다 — 펼침(`CallsDetail`)은 **원본 질의 블록**(액센트 보더, 전체 노출 — 280자 초과 시만 3줄 접힘+더 보기 `QueryText`)을 헤드라인으로 두고, 아래에 **호출 타임라인**: 요약 스트립(호출 수 · 노드 흐름 · 총 토큰 · 첫→마지막 구간) + 시간순 `#N` 레일 + 호출 카드(노드→모델 · ⏱응답시간 · 직전 호출과의 간격 · 토큰 바). 호출 카드의 쿼리는 **원본과 다를 때만**(공백 정규화 비교) "이 호출의 쿼리" 로 다시 표시. **any** trace-linked question 에서 가능(호출 1건이어도). `QUERY_CTN` 은 `calls` 쿼리와 `questions` 의 원본 질의 집계에서만 SELECT 한다.

### 1TICK — 분당 TPM/RPM 모니터 (Tokens 탭 프리셋)

사내 LLM 제약이 **TPM/RPM(분당 토큰·호출)** 이라 초과 여부를 화면에서 확인해야 하는데, Tokens 탭의
기존 추이는 5분/1시간/1일 격자라 분당 판정이 불가능했다. 그래서 프리셋 줄에 **`1TICK`** 을 추가했다 —
기간을 고르는 다른 프리셋과 달리 **본문을 모니터 뷰로 통째로 전환**한다(격자·응답 형태가 달라서).

- ⚠️ **정각 분 버킷은 판정 기준이 못 된다.** 제약은 "임의의 연속 60초" 기준이라, 12:01:13~12:02:12 에
  몰린 버스트는 정각 격자에선 두 칸으로 쪼개져 어느 칸도 한도를 안 넘는 것처럼 보인다(실제로는 초과).
  그래서 **초 단위 SQL 집계 위에서 슬라이딩 60초 윈도우의 최대값**을 구한다. 윈도우 시작을 "호출이 있던 초"
  로만 잡아도 실수 t 전체의 최대와 같으므로(합은 구간별 상수, 어떤 시작점의 창이든 그 안 첫 호출 시각에서
  시작하는 창이 같은 호출을 모두 포함) **근사가 아니라 정확한 최대**다.
- **집계** `src/lib/tickStats.ts` `fetchTickStats()` → `GET /api/tokens/tick` → `TickMonitor`.
  대상은 `TRX_TOKEN_DET`(앱 자체 DB=GAIA) 하나뿐이고 필터 규칙은 `tokens.ts` 의 `buildWhere()` 를
  **재사용**한다(두 화면의 조회 범위 해석이 갈리면 같은 조건인데 다른 수치가 나온다). lazy-oracledb-swallow
  + 쿼리별 `run()` 격리. 초 단위 집계는 호출이 있던 초만 행이 나와 1시간이어도 ≤3600행.
  - `rollupTick()` 은 **순수 함수**로 분리돼 있다(DB 무관) — 경계 조건(정확히 60초 간격은 창 밖, 빈 입력,
    같은 초 다건) 검증이 여기 하나로 끝난다.
  - 응답의 `fixed*` = 정각 분 합계(참고용 막대), `roll*` = 그 분에 시작하는 60초 창의 최대(판정값).
    `calls` 는 드릴다운용으로 최근 `TICK_CALL_LIMIT`(3000)건까지 — 넘으면 `truncated=true` 로 화면이 알린다.
- **한도(TPM/RPM)는 `config.yml` 의 `agents[].tpmLimit`/`rpmLimit`** 이다. **0 = 미설정**이며
  `config.ts` 의 `normalizeLimit` 이 음수/비숫자를 0 으로 떨군다. 미설정이면 기준선·초과 판정 없이
  추이만 그린다.
- **화면** `TickMonitor.tsx` / 차트 `TickMonitorChart.tsx` (`tick-*`) — 위에서 아래로 **세 가지만** 답한다:
  ① **게이지 2장**(TPM/RPM: 값 + 한도 대비 막대 + %) ② **추이 차트** ③ **초과한 순간 목록**
  (연속 초과 분을 구간으로 병합, 행을 열면 그 구간 피크 60초의 호출 전부 = 초과 원인).
  - ⚠️ **정각 분 합계(`fixed*`)는 그리지 않는다.** 처음엔 막대(정각 분)+선(롤링)을 겹쳐 그렸는데
    "막대랑 선이 뭐가 다르냐"는 질문이 바로 나왔다 — 판정값과 비판정값을 나란히 두면 어느 게 기준인지
    읽는 사람이 헷갈린다. 차트는 롤링 60초 값 하나만 Area 로 그리고 한도는 점선 하나. 초과한 분만 점을 찍는다.
    (`fixed*` 는 응답에 남아 있다 — 같은 쿼리에서 공짜로 나오고 진단에 쓸 수 있어서. 화면에는 안 쓴다.)
  - ⚠️ **TPM/RPM 전환은 게이지 카드 클릭**이다. 별도 토글 + KPI 카드를 따로 두니 같은 수치가 두 번
    나와 화면이 복잡해졌다. 게이지가 곧 선택지 역할을 한다.
  - ⚠️ 시각은 **`windowLabel()` 로 "09:16:30 ~ 09:17:30"** 처럼 끝 시각을 직접 적는다. `+60s` 표기는
    읽는 사람이 한 번 더 계산해야 해서 폐기했다. 차트 툴팁은 이 **구간을 제목으로** 올려
    라벨 없이 보여준다 — "가장 몰린 60초" 같은 설명 라벨은 화면에서 뺐다(직관적이지 않다는 피드백).
    화면 문구는 값이 무엇인지 설명하려 들지 말고 숫자·시각·%만 보여줄 것. 계산 방식 설명은 여기에만 둔다.
  - ⚠️ 조회 시각은 `toLocalSec()`(초 정밀)로 만든다 — 다른 프리셋처럼 분 정밀 + `":00"` 을 쓰면
    현재 분이 통째로 잘려 방금 난 버스트가 안 잡힌다.
  - **조회 구간은 두 모드**다 (`TickMode`, `TickMonitor.tsx`). `live` = 창 길이(15/60/180분)만큼
    "지금까지" — 창이 계속 앞으로 밀린다. `custom` = 툴바의 **`직접 설정`** 으로 펼치는 From/To
    (`datetime-local` 2개, `.custom-range` 재사용)로 찍은 **고정 구간** — 과거 이력을 보는 경로다.
    페이지의 모든 1TICK 조회(조회/새로고침/필터 변경/에이전트 전환)는 `submitTick()` 한 곳을 지나
    `tickReq()` 로 **현재 모드를 유지**한다 — 필터 하나 바꿨다고 라이브 창으로 되돌아가면 안 된다.
    ⚠️ `custom` 에서는 **자동 새로고침을 잠근다**(체크박스 disabled + effect 가드) — 고정 구간을
    다시 부를 이유가 없을 뿐 아니라, 라이브 갱신은 매번 '지금' 으로 창을 다시 잡아 사용자가
    지정한 구간을 덮어쓴다. 끝 시각엔 `withSec(...,"59")` 로 초를 채워 **그 분을 통째로** 포함시킨다.
    ⚠️ 서버(`fetchTickStats`)는 24시간(`TICK_MAX_MINUTES`)을 넘는 구간을 **뒤쪽(최신)만 남기고**
    자르므로, 요청한 `from` 보다 응답 `range.from` 이 뒤면 `clamped` 로 화면이 밝힌다 —
    안 밝히면 잘려나간 앞 구간이 "그 시간엔 호출이 없었다" 로 오독된다.
  - 기존 USER/NODE/MODEL 필터는 그대로 적용된다(`reloadWith()` 가 현재 모드에 맞는 쪽을 다시 조회).
  - **1TICK 이 아닐 때 Tokens 탭은 기존 경로 그대로다** — 기존 화면 로직은 바뀌지 않았다.

### Timeout 탭 — `/timeouts` (ADMIN 전용)

LLM 타임아웃이 잦아 추적이 필요한데 기존 대시보드에선 "에러 한 줄" 로 뭉뚱그려져
얼마나 심한지·어디서 나는지가 안 보였다. 그래서 타임아웃 전용 화면을 뒀다.

- **출처는 `TRX_TOKEN_DET` 한 곳.** GAIA 가 `call_llm` 을 try/except 로 감싸 실패 호출도 1행 적재하므로
  (`STAT_CD='ERROR'` + `ERR_CTN` + 토큰 0 + `LATENCY_MS`=예외까지 기다린 시간),
  **끊긴 그 호출의 노드/모델/질의/대기시간을 그대로 읽는다. 추정하지 않는다.**
  (BIZ 의 `ERR_CD` 를 보거나 "마지막 성공 호출" 로 노드를 되짚는 방식은 **틀린 답**을 준다 —
  성공 호출만 남던 시절엔 항상 actionRouter 가 잡혀 "라우터에서만 타임아웃" 처럼 보였다. 그 방식은 폐기했다.)
- **타임아웃 vs 그 외 오류**는 `ERR_CTN` 문구로 가른다 — 판정은 `src/lib/tokenStatus.ts` 한 곳
  (`callStatus()` = 화면용, `SQL_ERR_PRED`/`SQL_TIMEOUT_PRED` = 집계 SQL용. 하나를 고치면 다른 쪽도 같이).
- **집계** `src/lib/timeouts.ts` `fetchTimeoutStats()` → `GET /api/timeouts` → `src/app/timeouts/page.tsx`.
  전부 `TRX_TOKEN_DET` 대상의 SQL `GROUP BY` 이며 BIZ 조회/조인이 없어 가볍다. 쿼리별 격리 실행(`run()`).
  `STAT_CD`/`ERR_CTN` 컬럼이 없으면(적재 전) `available=false` 로 내려 화면이 "적재 전" 안내만 띄운다
  (0 건으로 보이면 "문제 없음" 으로 오독되므로 구분한다).
- **화면**: KPI 4(타임아웃 수+전체 호출 대비 비율 / 실패 호출 / **영향 질문** / 영향 사용자) ·
  발생 추이 · **모델 × 시간 히트맵**(`TimeoutModelHeatmap`) · 노드별·모델별·사용자별 분포(`DimCard`) ·
  **자주 발생한 오류 사유**(`ReasonList` — 클러스터링된 topReasons) · **실패한 호출 표**.
  - **히트맵**: "이 시간대에 이 모델이 몇 건 요청 중 몇 건 실패했나" 를 셀 1개로 압축한다. 세로=모델(호출 많은 순
    상위 8), 가로=시간 버킷(추이 차트와 같은 격자), 셀 색=실패율 6단계(안정/<5%/5–15%/15–35%/35–70%/70–100%),
    비활동(calls=0) 은 대각 격자 무늬로 구분해 "그 시간에 안 쓰였다" 를 실패율과 분리한다. hover=상세 팝오버,
    셀/모델 라벨 클릭=모델 서버 필터. 서버 집계는 `fetchTimeoutStats` 의 `modelTrendSql`(모델·버킷 GROUP BY 뒤
    JS 에서 격자로 재편) — 총 요청 수를 분모로 두는 게 핵심(단순 실패 수 막대와 달리 "어느 시간대에 이 모델이
    특히 위험했나" 가 보인다).
  - **오류 사유 리스트**: `ERR_CTN` 앞 100자 로 클러스터링해 상위 8개(`REASON_LIMIT`) 를 세운다. 순위 배지 + 문구 +
    발생 수 + 그중 타임아웃 비중. 스택 트레이스도 앞머리가 같으면 하나로 묶인다.
  - KPI 의 "평균 대기" 는 뺐다 — 목록 행이 전부 실패 건이라 그 평균은 해석할 게 없다(90s 한도에
    붙어 있을 뿐). 대신 **영향 질문**(`affectedTraces` = 실패 호출이 있는 고유 TRACE_ID 수)을 둔다:
    사용자 체감 피해량은 호출 수가 아니라 "질문 몇 개가 깨졌나" 다. 개별 대기시간은 목록의 `대기` 열에서 본다.
  - **조회 범위 = 기간 + 노드 + 모델 (전부 서버 필터)**. 기간은 24H/7D/30D 프리셋 + **직접 설정**
    (`datetime-local` 2개, `/report` 의 `custom-range` 패턴 재사용). 노드/모델은 `DimCard` 행 클릭으로
    걸리고(둘 다 클릭 가능, 조합 가능) 상단 `to-scope` 칩으로 해제한다 — **노드별·모델별 추이**를 보는 수단이
    이것이다(KPI·차트·분포·목록이 한꺼번에 좁혀진다). 차트 카드 부제에 현재 범위를 적어 무엇의 추이인지 밝힌다.
  - 추이 차트는 `TimeoutTrendChart` (`src/components/TimeoutTrendChart.tsx`) — 대시보드/Tokens 탭과 **같은
    형태**(그라디언트 스택 AreaChart + `ts-legend` 토글 + `ts-tooltip` + peak 라인 + Brush). 처음엔 이 화면만
    막대였는데 다른 차트들 사이에서 튀어서 통일했다. 색은 타임아웃 `#b42318`(`--err`) / 기타 오류
    `#c2410c`(`--fail`) 이고 `DimCard` 막대도 같은 두 색 세그먼트라 화면 전체가 한 규칙으로 읽힌다.
  - 실패한 호출 표(호출 시각·결과·노드·모델·대기·사용자·질의·사유·TRACE_ID — `token-recent` 스타일)는
    `FailedCallsTable` 로 분리해 **컬럼 필터**(결과 타임아웃/오류 · 노드 · 모델 셀렉트, 사용자 텍스트,
    질의/사유/TRACE_ID 텍스트) + **헤더 클릭 정렬**(호출 시각/대기) + **페이징**(25건) 을 얹었다.
    `QuestionsTable` 의 `qfilter-row`/`qft-*`/`qth-sort`/`qpager` 스타일을 그대로 재사용한다.
    ⚠️ 이건 서버가 내려준 최근 `ITEM_LIMIT`(200)건 안에서 좁히는 **클라이언트 필터**다 — 전체 기간을
    다시 집계하려면 위의 서버 필터(기간/노드/모델)를 쓴다.
- **접근 권한 = ADMIN 전용** — `ROUTE_RULES` 에 `/timeouts`, `/api/timeouts` 등록. `TabNav` 도 `minRole` 로
  ADMIN 에게만 탭을 노출한다.

### Oracle integration notes

- `oracledb` is listed in `next.config.mjs` under `experimental.serverComponentsExternalPackages` — it must not be bundled.
- Import is done lazily via `await import("oracledb")` inside `getOracle()` and **swallows the error** if the native driver is unavailable, returning `null` so the layer query yields an empty result. Keep this pattern when touching DB code so the app still runs on machines without the Oracle Instant Client.
- Timestamps are selected with `TO_CHAR(..., 'YYYY-MM-DD"T"HH24:MI:SS.FF3')` so that the app receives ISO-like strings and never has to deal with Oracle date objects.
- The SQL assembles a `WHERE` clause from `TraceFilter` using bind variables — preserve the bind-variable style when adding filters.
- The physical column for the outbound message is `SEND_MSG_CTN` (not `SEND_MSG_TM` — the old name was a legacy spec artifact that has since been corrected).

### Path alias

`@/*` → `./src/*` (configured in `tsconfig.json`).

### Agent 프로필 (이억수 TL) — `/agent`, `/admin`

트레이스 뷰어와는 별개의 부가 기능. 팀의 AI 에이전트를 소개하는 프로필 카드 + "하는 일" 목록.

- **데이터 모델**: `AgentProfile` (`src/lib/types.ts`). 업무는 정형/비정형 구분 없는 **단일 `tasks: WorkTask[]`** 배열 (배열 순서 = 표시 순서). `DEFAULT_PROFILE` 가 기본값.
- **영속 저장**: `src/lib/profile.ts` → `data/agent-profile.json` (DB 아님, gitignore 됨). `normalizeProfile()` 가 부분/구버전 데이터를 항상 완전한 객체로 보정하며, 구버전의 `formalTasks`/`informalTasks` 는 읽을 때 `tasks` 로 자동 병합(마이그레이션).
- **API**: `GET/PUT /api/profile`. PUT 은 **세션 인가(ADMIN)** — `requireRole("ADMIN")` (아래 "인증/인가" 참고).
- **화면**: `/agent`(서버 컴포넌트, `ProfileCard` + `WorkShowcase`), 대시보드 상단 `ProfileStrip`(클라이언트), `/admin`(비밀번호 게이트 후 편집 폼, 업무 순서 드래그앤드롭). 사진은 `public/` 에 올리고 `avatarImage` 에 `/파일명` 지정(없거나 로드 실패 시 `avatar` 이모지로 폴백, `AgentAvatar`).
- **FTE 성과 지표**: `src/lib/fte.ts` `computeFteStats(profile)` 가 **실데이터로 계산**한다. `db.ts.monthlyActionSuccess()` 가 2026-01-01~현재 '액션 성공' 수를 **월별·액션별**로 집계: 성공 판정(에러 없고 CUBE RESP 에 실패 문구 — `ACTION_FAIL_PHRASES`: 'Seasoning 실패'/'AutoQual 취소 실패'/'AutoQual 실행 실패' — 없는 트레이스)·월 귀속(첫 recv)은 **CUBE DB**, 액션 구분은 `ACTION_TYP`(`NEST_Seasoning`/`AutoQual_Abort`/`AutoQual_JobCreate`)을 기록하는 **GAIA DB**(`/api/action-types` 와 동일)에서 조회해 TRACE_ID 로 JS 조인. 연간 FTE `= Σ(액션별 성공 수 × 액션별 환산 분) ÷ 연간 분`, 월별은 환산 분 합 기준 ×12 연환산. **계산식은 프로필 필드로 커스터마이즈**: `fteActionMinutes`(ACTION_TYP→분 목록, 기본 NEST_Seasoning=5·AutoQual_Abort=5·AutoQual_JobCreate=5), `fteDefaultMinutes`(목록에 없는 액션·ACTION_TYP 미상, 기본 5), `fteAnnualMinutes`(기본 65,984) — `/admin` "성과 지표 (FTE)" 섹션에서 편집, `normalizeProfile` 이 잘못된 값을 보정하고 구버전 `fteMinutesPerCase` 는 `fteDefaultMinutes` 로 마이그레이션한다 (수동 폴백 `fte`/`fteNote` 필드는 **제거됨** — CUBE 미연결이면 카드는 `—` + 안내 문구). FTE 1 = 1인·1년. GAIA 미연결이면 전 트레이스가 기본 분으로 계산된다(무해). 차트(`FteChart`)는 최근 12개월만 노출. **위 TEMPORARY WORKAROUND 의 `ACTION_FAIL_PHRASES` 에 의존**(원복 시 5번 항목 참고).

### 실적 리포트 — `/report`

관리자가 매주 수기로 옮겨 적던 실적을 원클릭 복사로 대체하는 종합 리포트 화면. `/agent` 페이지 헤드의 "📋 실적 리포트" 버튼(`agent-action` 스타일 — 관리자 편집 버튼과 한 쌍)으로 진입.

- **접근 제어**: **미들웨어가 인가(BR 이상)** — `/report` 는 `ROUTE_RULES` 로 BR+ 로 막힌다(아래 "인증/인가" 참고). 페이지는 세션 쿠키로 인증된 상태로만 마운트되므로 데이터 fetch 도 정상 진행. (구 `AdminGate` sessionStorage 게이트는 제거됨.)
- **기간**: 기본 주 단위 — **월요일 00:00 ~ 다음주 월요일 00:00** (`weekRange()`). **일간 모드**(`dayRange()`, 자정~다음날 자정)도 지원: 오늘/어제/이번 주/지난주 프리셋 + ◀▶ 로 현재 단위(일/주) 기준 기간 이동(미래는 비활성). "직접 설정" 모드에서 `datetime-local` 로 시각까지 자유 지정.
- **데이터**: 적용 기간으로 `GET /api/stats` + `GET /api/tokens` 를 병렬 호출 (필터 없음 = FullScope). 보조로 `/api/profile`(리포트 제목의 에이전트 이름)과 `/api/error-codes`(에러 의미)도 로드하며 실패해도 무해.
- **일별 브레이크다운**: 주간/기간 조회에서도 하루 단위 실적이 바로 보이도록 `/api/stats` 가 `daily: DailyStat[]` 을 항상 내린다 — buckets 와 별개로 **항상 "일" 단위**(귀속 기준은 buckets 와 동일한 트레이스 시작 시각), 빈 날은 0, `to` 상한 경계는 `-1ms` 로 마지막 빈 날 방지. `DailyStat` = date/total/ok/fail/pending/**users**(그날의 대표 사용자 distinct — Set 이 필요해 서버에서만 집계 가능)/avgCubeLatencyMs. 리포트의 `mergeDailyRows()` 가 여기에 토큰(`tok.buckets` 를 날짜별 합산)을 붙여, **"일별 현황" 표**(`DailyTable` — 실행 상대 바 + peak 배지 + 토/일 색 + 합계 행, KPI 바로 아래)와 복사 텍스트의 **`[일별 현황]`** 섹션이 같은 행을 공유한다. 둘 다 **2일 이상 조회일 때만** 노출(하루짜리는 KPI 와 동어반복).
- **화면 구성**: ① Action Agent 실적 — KPI 5칸(총 실행/성공률/실패/평균 응답시간/**사용자 수**), 일별 현황 표(위 참고), 사용 추이(`TimeSeriesChart`), 평균 응답 속도(`CubeLatencyChart`), 상태 분포+주요 에러, 액션 타입별+주간 사용자(`TopList`), FAC별/AREA별 ② LLM 토큰 — `TokenStatsCards`/`TokenChart`/`TokenLatencyChart` + **노드별 구분**(`TokenBreakdown`, action 외 judge/setup_guide 노드 실적 분리 — 리포트에선 필터 없이 조회 전용) ③ 리포트 텍스트 미리보기(`<pre>`) — 복사될 내용 그대로 노출. 기존 대시보드/Tokens 탭 컴포넌트를 그대로 재사용한다.
- **전체 복사**: `buildReportText()` 가 두 응답을 보고용 플레인 텍스트로 조립(일별 현황, 액션별 성공/실패, 주요 에러+의미, Top 사용자, FAC/AREA top5, 노드별/모델별 토큰) → `navigator.clipboard.writeText` (실패 시 textarea+`execCommand` 폴백) → 버튼이 2초간 "✓ 복사됨" 으로 바뀜.
- **사용자 수**: `/api/stats` 가 `uniqueUsers`(optional 필드) 를 함께 내린다 — "기간 내 몇 명이 사용했나". 정의: 트레이스별 **대표 사용자의 distinct 수** (한 사용자가 100번 요청해도 1명). 대표 사용자는 `traceUserId()` 가 **진입 레이어(CUBE) 우선**으로 첫 non-null `USER_ID` 를 고르고 공백을 trim 한다 — USER_ID 는 전 레이어가 INSERT 시 기록하므로 행 순서대로 집으면 하위 레이어의 시스템 계정 값이 섞여 부풀 수 있어서다. `topUsers` 도 같은 대표 사용자 기준.

### 이벤트-FAB 매핑 — `/event-fabs` (⚠️ MCP DB — 앱 자체 DB 아님)

하이닉스는 기능(이벤트)을 FAB 별로 선별 적용한다 (예: AutoQual 실행은 M14/M15 만). 이벤트별 허용 FAB 을 이 앱에서 편집하면 **MCP DB** 의 `TRX_EVENT_MAP` 에 저장되고, MCP 로직이 요청 FAB 이 허용 목록에 없으면 팅겨낸다.

- **DB 위치**: 앱 자체 DB(GAIA)가 **아니라 MCP DB** — MCP 가 판정 시 직접 읽어야 해서다. 매핑은 `config.ts` 의 `EVENT_FAB_DB_LAYER`(`= "MCP"`) / `getEventFabDbConfig()` 한 곳에 있다 (APP_DB_LAYER 와 같은 패턴).
- **테이블**: `TRX_EVENT_MAP` (`sql/create_trx_event_map.sql`, MCP DB 에서만 1회 실행). TRX_TOKEN_DET 룰: `MAP_ID` IDENTITY PK, `EVENT_ID`(= `ACTION_TYP` 값)/`FAB_ID` + `UNIQUE(EVENT_ID, FAB_ID)`, `USE_YN`, 감사 일시. 이벤트 1 × 허용 FAB 1 = 1행. **DDL 은 ADM 계정(IDMSADM2) 소유로 실행**하고 앱/MCP 계정(IDMSAPP2)은 GRANT + PUBLIC SYNONYM 으로 참조 (DDL 파일의 [권한 / PUBLIC SYNONYM] 섹션). **DDL 파일 하단에 MCP 팀용 Python 체크 메서드 예시**(`is_fab_allowed(cursor, event_id, fab_id)` — 커넥션 관리는 MCP 서버에 이미 있어 쿼리 체크 비즈니스 로직만)가 블록 주석으로 들어 있다.
- **FAB 목록**: `types.ts` `FAB_IDS` = C2/M10/M11/M14/M15/M16/Y17 (매트릭스 고정 컬럼 — FAB 이 늘면 여기 추가). DB 에 수동 삽입된 미지 FAB 은 컬럼으로 동적 추가돼 저장 시 유실되지 않는다.
- **읽기/쓰기**: `src/lib/eventFabs.ts` → `GET/PUT /api/event-fabs`. 읽기는 lazy-`oracledb`-swallow 패턴으로 미구성/미생성 시 `available=false + reason` 을 내려 화면이 안내하고 저장을 막는다. **저장은 전량 교체**(DELETE 후 INSERT, 한 트랜잭션, 실패 시 rollback + throw) — 앱이 이 테이블의 마스터. FAB 0개 행은 "미등록" 과 구분이 안 돼 저장 거부(행 삭제를 강제). PUT 은 **세션 인가(BR 이상)** — `requireRole("BR")`.
- **화면**: `/event-fabs` (클라이언트, **미들웨어 인가 BR 이상** 뒤). **권한 매트릭스 콘솔** 스타일(`fm-*`): 컴팩트 툴바(작은 타이틀 + 이벤트 검색 + "+ 이벤트"/저장) 아래 이벤트(행)×FAB(열) 매트릭스 — 스티키 헤더 + 패널 내부 스크롤이라 이벤트 100개 스케일을 전제. 셀 = 토글 도트(켜면 액센트 채움+체크 팝), **열 헤더 클릭 = 보이는 행 대상 열 일괄 토글**, 행 액션(행 전체 토글/삭제)은 hover 시에만 노출, 이벤트명은 borderless 인라인 입력(`/api/action-types` datalist). 저장 버튼은 **dirty(스냅샷 비교) 일 때만 활성** + 흰 점 표시, FAB 0개 행은 "팹 없음" 배지. 안내문은 하단 풋노트 한 줄로 축약. 진입은 `/admin` 헤더의 "이벤트-FAB 매핑" 버튼.
- **판정 규칙**: `USE_YN='Y'` 행의 FAB 집합 = 허용. **매핑 미등록 이벤트는 MCP 정책**(Python 예시의 `allow_when_unregistered`, 기본 전 FAB 허용).

### Improvement Center — `/improvement` (⚠️ 앱 자체 DB = GAIA)

**TraceX > Improvement Center > Request Failure Tracker**. Improvement Center 는 AI 에이전트 개선 허브(**확장 가능한 플랫폼 셸**)이고, Request Failure Tracker 는 그 **첫 모듈**이다. 앞으로 개선 모듈이 이 센터에 더 붙는 구조 — `src/app/improvement/page.tsx` 의 `MODULES` 배열에 `{ key, name, tagline, icon, Component }` 한 줄 추가하면 좌측 레일에 붙는다(`PLANNED` 는 로드맵 표시용, 클릭 불가). 진입은 `/admin` 헤더의 "🚀 Improvement Center" 버튼(또는 유저 메뉴), **미들웨어 인가 BR 이상** 뒤(아래 "인증/인가" 참고).

- **실패 요청 정의**: 사용자 정의 그대로 — `ACTION_TYP IS NULL AND RECV_MSG_CTN IS NOT NULL ORDER BY TIMEKEY DESC`. 메시지는 받았는데 ACTION_TYP 을 못 붙인 요청 = **라우팅 실패이거나 LLM 오류로 튕긴 요청**. `ACTION_TYP` 권위 레이어가 **GAIA**(= `/api/action-types`·`monthlyActionSuccess` 와 동일)라서 이 판정은 GAIA DB 에서 한다. GAIA 는 **앱 자체 DB**(`APP_DB_LAYER`)이기도 해서 실패 요청 조회와 조치정보 저장이 **같은 DB·같은 커넥션**(`getAppDbConfig`)이다.
- **조치정보 테이블 `TRX_REQ_FAILURE_INF`** (`sql/create_trx_req_failure_inf.sql`, **앱 자체 DB=GAIA 에서만 1회 실행**, ADM 소유 + GRANT + PUBLIC SYNONYM 패턴 — TRX_EVENT_MAP 과 동일). `TRACE_ID`(PK) / `STATUS`(open/investigating/resolved/ignored = `FAILURE_STATUSES`) / `NOTE_CTN` / `HANDLER_ID` / 감사일시. 실패 요청 원본은 BIZ 에 있고 이 테이블은 **조치 오버레이**(TRACE_ID 로 LEFT JOIN, JS 병합) — 행 없는 요청 = `open`(미조치).
- **읽기/쓰기**: `src/lib/requestFailures.ts` → `GET/PUT /api/request-failures`(+ `GET /api/request-failures/[traceId]/context`). 실패행 조회와 조치행 조회는 **격리 실행** — `TRX_REQ_FAILURE_INF` 미생성(ORA-00942)이어도 리스트는 정상 노출되고 `triageAvailable=false` 로 저장만 막는다(lazy-`oracledb`-swallow, `available=false + reason` 안내). 저장은 `TRACE_ID` 기준 **MERGE upsert**(autoCommit), PUT 은 **세션 인가(BR 이상)** — `requireRole("BR")`.
- **사용자 대화 흐름**(`fetchRequestFailureContext`): 선택한 실패 요청의 `USER_ID`·수신시각을 찾고, 같은 사용자가 **±12h** 낸 요청을 TRACE_ID 단위(GROUP BY)로 묶어 시간순으로 내린다. `ACTION_TYP` 없는 요청은 `isFailure` 로 표시 — "무엇을 시도하다 어디서 튕겼나" 를 관리자가 읽게 한다. 화면은 **채팅 로그**다: 턴마다 Q(우측 말풍선) → A(좌측 말풍선)를 시간순으로 쌓고, 문제의 그 요청만 "이 요청" 배지+액센트 링으로 집어준다. **레이어별 JSON 전문(`TraceTimeline`)은 여기 쓰지 않는다** — 이 화면은 비즈니스 관점(무엇을 묻고 무엇을 받았나)이고 envelope 디버깅은 Traces 화면의 일이다. 말풍선은 `pre-wrap`+`overflow-wrap:anywhere` 로 접혀 좁은 분할 패널에서도 밀리지 않는다(고정 다단·`@container` 레이아웃을 두지 않는 이유 — `@container` 는 `.panel-body` 밖에서 발동하지 않는다).
- **⚠️ 사용자 관점 Q/A 는 CUBE 에서 본다 — 단, "최종 응답 문장" 컬럼은 없다.** 사용자는 **CUBE 와만 대화**하므로 사용자 관점 데이터는 CUBE(= 진입 레이어) 행에서 찾는다: **`CUBE.SEND_MSG_CTN` = 사용자 질문(Q)**. 하지만 **`CUBE.RESP_MSG_CTN` 은 레이어 간 JSON 전문**이고, **CUBE BotServer 가 사용자에게 실제로 렌더해 내보내는 문장을 저장하는 컬럼은 존재하지 않는다.** 그래서 A 는 그 JSON 에서 문장을 긁어내는 **best-effort**(`humanText()`)이며 "사용자가 본 그 문장"이라고 보장할 수 없다 — 추출 실패 시 화면은 비우고 안내한다. 진짜 A 가 필요하면 BotServer 가 렌더 결과를 적재하는 컬럼(예: `ANSWER_CTN`)이 새로 있어야 한다. 하위 레이어(GAIA/MCP/ONEOIS)의 `RESP_MSG_CTN` 은 다운스트림 툴 응답이라 A 후보조차 아니다. `requestFailures.ts` 의 `USER_IF_LAYER`(= `LAYER_ORDER[0]`)와 `attachUserFacingQa()` 가 이 규칙의 구현 지점이며, CUBE 는 앱 자체 DB(GAIA)와 다른 DB 라 커넥션을 따로 열어 `TRACE_ID` 로 JS 조인한다(`monthlyActionSuccess` 와 같은 크로스 DB 방식). CUBE 미구성/조회 실패 시 Q 는 `TRX_TOKEN_DET.QUERY_CTN`(LLM 프롬프트) → `RECV_MSG_CTN` 순으로 폴백하고 A 는 비워 안내한다(무해). SEND/RESP 가 JSON envelope 인 경우 `humanText()` 가 사람이 읽는 문장만 뽑고, 못 찾으면 원문을 보여준다.
- **화면**(`src/components/improvement/RequestFailureTracker.tsx`, `rft-*` / 셸은 `ic-*`): 상단 KPI(미조치/조치중/조치완료/영향 사용자/기간 내 실패 수) + 기간 프리셋(24h/7d/30d/전체, 서버 `dateFrom`) + 좌(상태칩 필터·검색 리스트)/우(원본 요청·응답·조치 세그먼트+메모+담당자·사용자 대화 흐름) 스플릿. 상태칩/검색은 클라이언트 필터, 조치 저장 시 로컬 카운트 재계산. 에러코드 의미는 `/api/error-codes` 재사용.
- **담당자(HANDLER_ID)**: 조치 저장 PUT 에서 명시하지 않으면 **로그인 세션의 사번으로 자동 기록**된다(`route.ts` 에서 `guard.session.sub` 폴백). 화면에서 수동 지정도 여전히 가능. (로그인 도입 완료 — 아래 "인증/인가" 참고.)

## 인증/인가 — 로그인 · 계정 · 권한 (⚠️ 앱 자체 DB = GAIA)

전 화면 로그인 필수. 사번(USER_ID)으로 로그인하고 **두 축**으로 접근을 가른다 —
**권한**(ADMIN 운영자 > BR 상위 > DEV 개발자 > FIELD 일반 사용자) × **에이전트 범위**(전역 / 에이전트 하나 / 미배정).
두 축은 직교한다: "전역 ADMIN"은 모든 에이전트를 오가며 관리하고, "에이전트 ADMIN"은 **자기 에이전트 안에서만** ADMIN 이다. 기존 하드코딩 `ADMIN_PASSWORD`/`AdminGate`(sessionStorage 게이트)는 **완전히 제거**되고 세션 기반 인증으로 대체됐다.

- **권한 단일 소스 `src/lib/roles.ts`** (클라이언트·Edge 미들웨어·서버 공용 — Node 전용 모듈 import 금지). `Role`, `ROLE_LABEL`, `roleAtLeast(role,min)`, 그리고 **경로→최소권한 매핑 `ROUTE_RULES`**(`requiredRoleForPath`). 접근 범위가 바뀌면 여기만 고친다. 현재: `/admin`·`/timeouts`=ADMIN, `/accounts`·`/api/accounts`·`/report`·`/improvement`·`/event-fabs`=BR, 그 외=인증만 되면 DEV. **계정 관리는 BR 이상**이되 권한 상향 방지 가드가 API 에 있다 — ADMIN 계정 생성/수정/삭제/초기화·ADMIN 승격은 **ADMIN 만**(BR 은 그 아래 권한만 다룰 수 있고 UI 도 ADMIN 옵션·행 버튼을 가림).
- ⚠️ **경로 인가의 진입점은 `canAccessPath(role, pathname, global)` 하나다** (미들웨어의 실제 차단과 `TabNav` 의 탭 노출이 같은 함수를 쓴다 — 예전처럼 탭별 `minRole` 목록을 따로 두면 `ROUTE_RULES` 와 두 벌이 되어 "메뉴엔 보이는데 누르면 403" 이 생긴다). 내부에서 FIELD 는 서열이 아니라 **허용 목록**으로 갈린다 (아래 절).
- **계정 저장소 `TRX_USER_MAS`** (`sql/create_trx_user_mas.sql`, **앱 자체 DB=GAIA 에서만 1회 실행**, ADM 소유 + GRANT + PUBLIC SYNONYM — 다른 앱 테이블과 동일 패턴). 컬럼: USER_ID(사번,PK)/USER_NM/WORK_CTN(업무)/ROLE_CD/PWD_HASH/PWD_SALT/USE_YN/MUST_CHG_YN/**AGENT_ID**/**GLOBAL_YN**/LAST_LOGIN_DT/감사일시. `src/lib/users.ts` 가 CRUD·로그인검증·시드를 담당(lazy-`oracledb`-swallow, DB 불가 시 `available=false`).
  - **에이전트 범위 = `GLOBAL_YN` + `AGENT_ID`** (`sql/migrations/2026-08-24_add_user_agent_id.sql`
    → `sql/migrations/2026-08-27_add_user_global_yn.sql`, 순서대로):

    | GLOBAL_YN | AGENT_ID | 범위 |
    |---|---|---|
    | `Y` | (무시) | **전역** — 모든 에이전트를 오가며 열람·관리 |
    | `N` | `leeoksu` | 그 에이전트 하나 |
    | `N` | NULL | **잠금**(미배정) — 아무 에이전트도 못 본다 |

    ⚠️ **`AGENT_ID` 의 의미가 뒤집혔다** — 예전엔 NULL = 전 에이전트였고 지금은 NULL = 잠금이다.
    그래서 **판정은 반드시 `src/lib/roles.ts` 를 거친다**: `resolveScope(claim)` → `canViewAgent` /
    `canManageAgent` / `canActOnAccount` / `isLockedScope`. 호출부에서 `session.agentId` 를 직접
    비교하면 규칙이 조용히 뒤집힌다.
    서버 진입점은 `src/lib/auth/current.ts` 의 **`requireAgent(agentId, min)`**(열람) ·
    **`requireAgentAdmin(agentId)`**(관리) · **`requireBiz(min)`**(기본 에이전트 전용 화면).
    판정 순서는 **400(없는 에이전트) → 403(내 범위 아님) → DB 조회** 다 — 권한 밖 요청은 커넥션을 열기 전에 끊는다.
    ⚠️ **세션 클레임은 `scope`("global"/"agent"/"locked")를 반드시 함께 싣는다.** `agentId` 만으로는
    전역과 미배정을 구분할 수 없다. **`scope` 키가 없는 토큰은 이 기능 이전의 쿠키**라 `resolveScope` 가
    옛 규칙(결속 없음 = 전역)으로 읽는다 — 배포 직후 살아 있는 로그인을 끊지 않기 위함이다.
    ⚠️ **범위 변경은 다음 로그인부터 적용된다** — 세션 클레임이고 쿠키는 고정 7일 만료(갱신 없음)라
    살아 있는 세션은 최대 7일간 옛 범위로 돈다. `ROLE_CD` 도 같은 방식이다(`/api/auth/me` 는 계정을 되읽지 않는다).
  - **계정 관리도 범위 안에서만 된다** — 목록/수정/삭제/비번초기화 모두 `canActOnAccount()` 를 지난다.
    에이전트 운영자에게는 **다른 팀 계정이 목록에도 안 뜨고**, 직접 URL 로 쳐도 **404**(존재를 알리지 않는다).
    ⚠️ 전역 계정과 미배정 계정은 **전역 운영자만** 손댈 수 있다 — 전역 계정의 비밀번호를 초기화할 수
    있으면 그 계정으로 범위를 벗어날 수 있기 때문이다(예전 "보안 경계가 아니다" 라고 적어 둔 구멍이 이것이다).
    새 계정의 소속은 에이전트 운영자면 **자기 에이전트로 고정**되고(다른 값을 보내면 403),
    전역 운영자가 범위를 지정하지 않으면 **기본 에이전트**로 만들어진다 — 그대로 두면 잠긴 계정이 되어
    만든 사람도 받는 사람도 왜 안 보이는지 모른다.
    `GLOBAL_YN` 부여/회수와 소속 이동은 **전역 ADMIN 전용**이고, 본인 계정의 범위는 스스로 못 바꾼다(자기 잠금 방지).
    ⚠️ 저장 값은 `validateAgentId()`(`users.ts`)가 config 의 실제 id 인지 검증한다 — 없는 id 를 저장하면
    그 계정은 목록이 비고 403 만 받는 막다른 길이 된다. 그래도 설정에서 사라진 경우를 대비해
    `AgentScopeProvider.scopeWarning` → `AgentScopeWarning`(상단바 아래 안내 띠)이 이유를 화면에 밝힌다.
    ⚠️ `users.ts` 가 **두 컬럼의 존재를 각각 탐지**하므로 ALTER 전에도 범위와 무관한 계정 저장은 그대로
    동작하고, 읽기는 **옛 규칙(AGENT_ID 없음 = 전역)** 으로 되돌아간다. 다만 **범위를 쓰려는 요청은
    조용히 무시하지 않고 실패**한다 — `createUser`/`updateUser` 가 `agentId`/`global` 키를 받았는데 컬럼이
    없으면 마이그레이션 파일명을 담아 throw 한다(저장했다고 믿게 두지 않는다). 그래서 호출부는
    **범위를 바꿀 때만** 키를 보내고, `global: false` 는 아예 보내지 않는다(컬럼 DEFAULT `'N'` 과 결과가 같다).
  - **최초 관리자 시드**: 테이블이 비면 로그인/목록 조회 시 `ensureSeedAdmin` 이 기본 운영자(USER_ID=`admin`/PW=`admin1234`/ADMIN)를 1회 생성. **최초 로그인 후 즉시 변경**(강제되진 않음 — 아래 TEMP 절).
- **비밀번호**: 평문 저장 금지. `src/lib/auth/password.ts` 가 Node 내장 `crypto` scrypt 로 해시(외부 의존성 없음 — 배포가 src 복붙이라 native dep 회피). 변경은 사용자 메뉴의 `ChangePasswordModal` 에서 **자율**로만 한다 (강제 변경은 아래 TEMP 절 참고).
- **세션**: `src/lib/auth/session.ts` 서명 쿠키(`trx_session`, httpOnly, **7일** — `SESSION_TTL_SEC` 한 곳. 슬라이딩 갱신 없음 = 로그인 시각 기준 고정 만료). 형식 `base64url(payload).HMAC-SHA256`, **Web Crypto(`crypto.subtle`)만 사용**해 Edge 미들웨어·Node 라우트 공용. 비밀키 `AUTH_SECRET`(미설정 시 개발용 폴백 — **운영 배포 시 반드시 환경변수 설정**). 쿠키 `secure` 는 기본 off(사내 HTTP 배포에서 로그인 막힘 방지) — HTTPS 면 `AUTH_COOKIE_SECURE=true`. 옵션은 `sessionCookieOptions()` 한 곳.
- **미들웨어 `src/middleware.ts`**(Edge): 비로그인 페이지→`/login?next=`, API→401; 권한 부족 페이지→`/403`, API→403. 인가 근거는 `ROUTE_RULES`. 정적 자산·`/login`·`/api/auth/*` 는 통과.
  BIZ 경로(`isBizPath`)에 범위 밖 계정이 오면 페이지는 `/tokens`(미배정이면 `/403`)로 보낸다.
  ⚠️ Edge 는 `config.yml` 을 못 읽어(fs) 기본 에이전트 id 를 모른다 — 그래서 로그인 시 계산한
  `bizAllowed` 클레임을 쓴다. **이건 UX 리다이렉트일 뿐 권위가 아니다**; 실제 차단은 각 API 의
  `requireBiz()` 가 매 요청 현재 config 로 다시 한다. 클레임이 없는 옛 쿠키는 통과시킨다.
- **API**: `POST /api/auth/login`·`logout`, `GET /api/auth/me`(비로그인 200+`{user:null}`), `POST /api/auth/change-password`(본인). 계정관리(BR 이상 + 위 상향방지 가드): `GET/POST /api/accounts`, `PUT/DELETE /api/accounts/[userId]`, `POST /api/accounts/[userId]/reset-password`. 서버 방어는 `src/lib/auth/current.ts` `requireRole(min)`.
- **초기 비밀번호 = 사번**: 계정 생성 시 비밀번호를 **USER_ID(사번)와 동일**하게 설정한다 (강제 변경 없음 — 사번 그대로 로그인). 등록 폼엔 비번 입력이 없다. 관리자 **비밀번호 초기화**도 값 미지정 시 **사번으로** 초기화(지정하면 그 값). 결과 비번은 화면에 1회 노출해 전달용으로 보여준다.
- **클라이언트**: `AuthProvider`(`/api/auth/me` 컨텍스트, `useAuth()`) → `AppChrome`(상단바/푸터 셸, `/login` 은 셸 없이 전체화면) → `UserMenu`(계정 칩+드롭다운, 권한별 관리 링크·비번변경·로그아웃). 기존 mutation 클라이언트 fetch 들은 `x-admin-password` 헤더를 떼고 **세션 쿠키 자동 전송**에 의존(401/403 시 안내 문구).
- **화면**: `/login`(브랜드 히어로+폼 스플릿), `/accounts`(계정 목록·생성/수정/비번초기화/삭제, 권한 3택 카드), `/403`. `/agent` 헤더의 리포트/관리자 버튼은 서버에서 세션 권한으로 조건부 노출.
- **기존 PUT 게이트 교체**: `/api/profile`=대상 에이전트의 ADMIN(`requireAgentAdmin`),
  `/api/event-fabs`=BR+BIZ, `/api/request-failures`=BR+BIZ (`requireBiz("BR")`). `/admin`·`/report`·`/event-fabs`·`/improvement` 페이지의 `AdminGate` 래퍼 제거(미들웨어가 인가). **삭제된 파일**: `src/components/AdminGate.tsx`, `src/lib/adminAuth.ts` (⚠️ 사내 복붙 배포는 삭제가 전파 안 되니 그쪽 레포에서도 지울 것 — memory `deploy-copy-paste-sync`).

### 일반 사용자(FIELD) 권한 — 실적 화면 `/insights` 하나만 (⚠️ allow-list)

이 앱은 원래 개발자가 4계층 동기 메시지를 추적하려고 만들었는데, 대시보드·토큰·타임아웃 같은
**리포트성 화면이 늘면서 일반 사용자(비개발)도 실적을 보고 싶어졌다.** 하지만 일반 사용자에게
레이어 JSON 원문·다른 사용자의 질의/사번·내부 에러 코드를 보이면 안 된다. 그래서 기존 3권한
아래에 **FIELD(일반 사용자)** 를 두고, 일반 사용자 전용 화면 하나만 연다.

- ⚠️ **FIELD 만은 서열이 아니라 허용 목록(`FIELD_ALLOW_PREFIXES`)으로 판정한다.** `ROUTE_RULES` 는
  "규칙에 없으면 통과"(fail-open)라, 서열만 낮춰 두면 **앞으로 추가되는 화면이 자동으로 일반 사용자에게
  열린다.** 일반 사용자는 반대로 **명시적으로 연 경로만** 들어갈 수 있어야 한다. 두 규칙의 합류 지점이
  `canAccessPath()` 이고, 일반 사용자에게 새 화면을 열려면 목록에 한 줄 추가해야 한다.
  현재 열린 것: `/insights` · `/api/insights` · `/agent` · `/api/profile` · `/api/agents` · `/403`.
- ⚠️ **`/insights` 는 반대로 위쪽도 좁힌다 — 일반 사용자 + 전역 ADMIN 뿐이다** (`canViewInsights(role, global)`).
  일반 사용자에게 보여주는 화면이라 그 위 권한이 전부 볼 이유가 없고, BR·DEV·**에이전트 ADMIN** 은
  Dashboard/Report 로 같은 수치를 더 자세히 본다. 전역 운영자만 함께 보는 이유는 "일반 사용자에게
  무엇이 보이는가" 를 같은 화면으로 확인하기 위함이다. 그래서 이 판정만은 서열이 아니라
  **role + 전역 여부**를 함께 본다 — `canAccessPath` 의 3번째 인자 `global` 이 이것 하나에만 쓰인다.
  기본값이 `false` 라 **넘기는 것을 잊으면 탭이 안 보이는 쪽(fail-closed)으로** 틀린다.
  ⚠️ 권위 있는 차단은 `/api/insights` 의 `canViewInsights` 403 이고, 미들웨어·`TabNav` 는 UX 다.
- ⚠️ **서버 가드의 기본 min 은 그대로 `DEV` 다.** 그래서 기존 API 는 전부 일반 사용자에게 자동으로 닫혀
  있고(`requireBiz()`/`requireAgent()` 가 403), 일반 사용자에게 열 API 만 `LOWEST_ROLE` 을 **명시**한다
  (`/api/insights` 의 `requireBiz(LOWEST_ROLE)`, `/api/profile` GET·`/agent` 의 `requireAgent(id, LOWEST_ROLE)`).
  기본값을 낮추면 fail-open 이 된다.
- ⚠️ **버킷의 `to` 는 배타적 상한이다** (`computeStats`). 주간 조회의 `to` 는 **다음 월요일 00:00**
  이라, 그대로 `enumerateBucketStarts` 에 넘기면 그 경계가 속한 버킷이 하나 더 붙어 **끝에 항상 0 인
  칸**이 생긴다 — 8/3~8/10(월~월) 조회가 8칸으로 그려지고 마지막 8/10 이 0 이라 차트가 뚝 떨어졌다.
  `to - 1ms` 로 끊는다(`daily` 가 이미 쓰던 방식 — 두 배열의 끝 날짜가 어긋났던 것도 이 때문이다).
  `to`=now 인 프리셋은 now 와 now-1ms 가 같은 버킷이라 영향이 없다. **`/report` 주간 모드의 같은
  증상도 이 수정으로 함께 사라진다** (집계가 한 곳이라).
- **집계는 공유, 응답은 분리** — 대시보드 집계 계산을 라우트에서 끌어내 `src/lib/stats.ts`
  `computeStats()` 로 옮겼다(`/api/stats` 는 이제 파싱+인가만). 집계 규칙이 두 벌이 되면 같은
  기간인데 두 화면의 숫자가 갈리기 때문이다. **다른 건 응답 모양뿐이다**:
  `/api/insights` 의 `toInsights()` 가 `InsightsResponse` 의 필드를 **하나씩 옮겨 담는다**.
  ⚠️ `...stats` spread 를 쓰지 말 것 — 빼는 방식이면 `StatsResponse` 에 필드가 추가될 때마다
  새로 새고, 담는 방식이면 안 샌다. 빠지는 것: `topUsers`(사번) · `topErrors`(내부 에러 코드) ·
  `layers`/`selfTime`(내부 구조) · `excludeErrCds`. 남는 것: 상태 합계 · 성공률 · 평균 응답 ·
  **사용자 '수'** · 버킷 · 일별 · 기능(ACTION_TYP)별 · FAC별 · 프로필 공개 항목 · FTE.
- **토큰·타임아웃도 같은 라우트가 실어 내린다** — 일반 사용자는 `/api/tokens`·`/api/timeouts` 에서 403 이라
  거기서 부를 수 없다. `/api/insights` 가 `fetchTokenStats`/`fetchTimeoutStats`(기본 에이전트)를
  같이 호출해 `toInsightsTokens()`/`toInsightsTimeouts()` 로 **모델까지만** 옮겨 담는다
  (`InsightsTokens`/`InsightsTimeouts`). 빠지는 것: `byNode`(내부 노드명) · `topUsers`/`byUser`(사번) ·
  `questions`/`calls`(질의 원문) · `items`(실패 호출 원문) · `topReasons`(스택 트레이스).
  ⚠️ 토큰 조회는 **`skipQuestions: true`** 로 부른다(`TokenFilter`) — questions/topUsers/calls 는
  상위 500건 LISTAGG 로 무거운 데다 화면에 쓰지도 않을 사번·질의 원문을 실어 나른다.
  넷(stats/fte/tokens/timeouts)은 `Promise.all` 이고 뒤 셋은 `.catch(() => null)` 이라
  한쪽이 죽어도 그 섹션만 빈다.
- **화면 `/insights`** (`src/app/insights/page.tsx`, `ins-*`): 기간 선택은 세 갈래다 —
  ① 최근 구간(오늘/최근 7일/최근 30일/이번 달, 끝은 항상 '지금') ② **`◀ ▶` 주 이동**(월~일 한 주를
  통째로, 몇 주 전이든 거슬러 올라간다. `▶` 는 이번 주에서 멈춘다) ③ **Custom**(`datetime-local` 2개,
  `/report` 의 `custom-range` 패턴 재사용 — 적용 버튼을 눌러야 조회된다).
  ⚠️ 주간은 **화살표 하나로만** 조작한다 — `이번 주`/`지난주` 버튼을 따로 두면 화살표와 두 벌이 되고,
  고정 프리셋만 있으면 그 이전 주는 볼 방법이 없다.
  상태는 `Sel = {kind:"recent",key} | {kind:"week",offset} | {kind:"custom",from,to}` 이고
  **offset 부호는 `/report` 와 같다**(0 = 이번 주, -1 = 지난주). `weekRange(offset)` 도 `/report` 의
  것과 **같은 정의**(월요일 00:00 ~ 다음 월요일 00:00)이며 정의를 바꾸면 양쪽을 같이 고쳐야 한다
  (두 화면이 "지난주" 를 다르게 자르면 숫자가 갈린다). ⚠️ **지나간 주의 상한을 '지금' 으로 줄이지 말 것**
  — 매번 다른 구간이 되어 비교가 깨진다. 아직 끝나지 않은 이번 주만 줄인다.
  ⚠️ **Custom 의 상한만은 배타 처리(-1ms)를 하지 않는다** — 사용자가 찍은 시각이라 8/10 을 골랐는데
  라벨이 8/9 로 나오면 "왜 하루가 빠지냐" 가 된다. 툴바 우측 `ins-range`
  가 실제 조회 구간을 "08/24 (월) ~ 08/28 (금)" 로 밝힌다. 그 뒤로
  **두 단**이 이어진다 — ① 업무 실적: KPI 6(처리 건수·성공률·실패·평균 응답 속도·사용 인원·누적 절감
  FTE) + 처리 추이 + **일별 현황 표**(2일 이상 조회일 때) + [기능별 실적 막대 | 절감 효과 추이] 2열,
  ② `ins-sep` 구분선 아래 **AI 운영 현황**: KPI 4(토큰 사용량·LLM 호출·평균 LLM 속도·타임아웃) +
  [토큰 사용 추이 | LLM 속도 추이] 2열 + [타임아웃 발생 추이 | 모델별 현황] 2열.
  데이터 소스는 `/api/insights` **하나뿐**이다 — 여기서 다른 API 를 부르지 말 것(일반 사용자 세션은 어차피 403).
  기능 코드는 `ACTION_LABEL` 로 한글 표기(시즈닝/AutoQual 실행·취소), 모르는 값은 원문 그대로.
  ⚠️ 카드를 혼자 한 줄에 두면 **가로만 길고 안이 비어 보인다**(FTE 추이가 그랬다) — 조밀하지 않은
  카드는 `.ins-grid-2`(auto-fit minmax 380px, 좁으면 1열)로 짝지어 둘 것.
- **일별 현황 표는 `/report` 와 공유한다** (`src/components/DailyTable.tsx` — `DailyRow` ·
  `mergeDailyRows` · `DailyTable`). 원래 `report/page.tsx` 안에 있던 것을 뺐다: 두 벌로 두면 한쪽만
  고쳐져 같은 기간인데 다른 표가 된다. 일반 사용자 화면은 `labelAction={actionLabel}` 로 기능 코드만 한글로 바꾼다.
- **차트 컴포넌트의 prop 타입은 '실제로 읽는 필드' 로 좁혀져 있다** (`TokenSeries`/`TimeoutSeries`/
  `TokenSummary`). 전체 응답을 요구하면 축소 응답(`InsightsTokens` 등)을 못 넘긴다 — 구조적 타이핑이라
  기존 호출부(Tokens/Timeout/Report 탭)는 전체 응답 그대로 통과한다. 화면을 늘릴 때 이 규칙을 깨지 말 것.
- **전역 운영자는 일반 사용자가 보는 것을 같은 화면으로 본다** — 별도 미리보기를 만들면 두 화면이
  어긋나므로 같은 화면을 함께 보고, FIELD 가 아닌 계정에게만 "일반 사용자 계정에게 공개되는 유일한
  화면" 안내 띠를 띄운다. 탭 이름은 **실적**. (열람 범위는 위 `canViewInsights` 참고)
- **세로 여백은 `.ins .dash-body` 의 flex `gap` 한 곳에서 준다** — `.dash-body` 자체에는 간격 규칙이
  없어(대시보드는 카드마다 따로 잡는다) 그냥 두면 섹션이 맞붙는다. 카드마다 margin 을 다는 방식은
  섹션을 추가할 때마다 빠뜨리므로 쓰지 말 것. `.ins` 스코프라 대시보드에는 영향이 없다.
- **DB**: `ROLE_CD` CHECK 제약에 `'FIELD'` 추가 — `sql/migrations/2026-08-28_add_field_role.sql`
  (앱 자체 DB=GAIA, ADM 계정 1회). ⚠️ **앱 배포보다 먼저** 실행할 것 — 제약을 넓히기 전에는
  `/accounts` 에서 일반 사용자 계정 저장이 ORA-02290 으로 실패한다.
- **로그인 착지**: 일반 사용자의 홈은 `/` 가 아니라 `/insights` (`homePathFor`). 로그인 페이지가 `next`
  파라미터를 `canAccessPath` 로 검사해 갈 수 없는 곳이면 홈으로 바꾼다(화면이 한 번 튀는 것 방지).
- ⚠️ **일반 사용자 계정의 소속은 기본 에이전트여야 한다** — `/insights` 는 BIZ_AIACTIONTXN_HIS 집계라
  `isBizPath` 에 포함된다. 미배정이거나 다른 팀 에이전트 소속이면 `/403` 이다(일반 사용자는 `/tokens` 도
  못 보므로 미들웨어가 그쪽으로 되돌리지 않는다 — 서로를 가리키면 리다이렉트 루프가 된다).

### ⚠️ TEMP — 비밀번호 강제 변경 비활성 (되살리기 전제)

**배경**: 아직 권한별로 실질 동작하는 로직이 적어 로그인/권한 자체의 중요도가 낮고, 내부 인원끼리만
쓰는 단계라 "최초 로그인 시 비밀번호 강제 변경" 이 번거로움만 됐다. 그래서 **임시로 비활성**했다
(기능 폐기가 아님 — 외부/타 조직에 열 때 되살릴 것).

**현재 동작**: 계정 생성·관리자 초기화 후에도 **사번(또는 지정한 값) 그대로 로그인**하고, 변경은
사용자 메뉴 → "비밀번호 변경" 에서 자율로만 한다. `TRX_USER_MAS.MUST_CHG_YN` 컬럼/제약은 **그대로
두되 앱은 항상 `'N'` 만 쓰고 읽지 않는다** (기존 `'Y'` 행이 남아 있어도 무해).

**비활성 지점** (`// TEMP` / `⚠️ TEMP` 주석):
- `src/lib/users.ts` — `ensureSeedAdmin`/`createUser` INSERT 가 `'N'` 고정, `resetPassword` 가 `MUST_CHG_YN='N'`. `UserAccount.mustChangePw` 와 `CreateUserInput.mustChangePw`, `SELECT_COLS` 의 `MUST_CHG_YN` 은 제거됨.
- `src/components/auth/ChangePasswordModal.tsx` — `forced` prop 제거(항상 닫기 가능).
- `src/components/auth/UserMenu.tsx` — `mustChangePw` 일 때 강제 모달을 띄우던 렌더 제거.
- `src/app/api/auth/me/route.ts` — 강제 여부 확인용 `getUser()` 재조회 제거(로그인마다 DB 1회 절약).
- `src/app/api/auth/login/route.ts`·`src/components/auth/AuthProvider.tsx`(`SessionUser`)·`src/app/accounts/page.tsx`(`Account` + "PW" 배지, `.acct-flag` CSS) — `mustChangePw` 필드/표시 제거.

**되살리는 법**: 위 지점을 역순으로 복원한다 — `MUST_CHG_YN` 을 `SELECT_COLS`/`UserAccount` 에 다시 넣고
(생성 시 `'Y'`, `resetPassword` `'Y'`), `/api/auth/me` 가 계정을 되읽어 `mustChangePw` 를 내리게 한 뒤,
`ChangePasswordModal` 의 `forced` 모드(닫기 불가 + 안내문)와 `UserMenu` 의 강제 렌더를 되살린다.
DB 마이그레이션은 불필요(컬럼 유지). 되살릴 땐 남아 있는 `'Y'` 행을 한 번 정리할지 판단할 것.

### Work grouping — `src/lib/workGroup.ts` [TEMP]

GAIA records **one request = one TRACE_ID**, but a field job spans several requests
(`전값 측정 → (SEA) → 후값 측정 → ERMAP`). `workGroup.ts` infers the job boundary so the
list panel can show one row per job. Rules, the excluded actions, and the removal path are
documented in the file header and in `README.md` ("묶음 — 여러 요청을 작업 1건으로").

Points that matter when touching this code:

- **GAIA is the only layer that can group.** The chamber id lives in `SEND_MSG_CTN` (the
  params handed to MCP); CUBE has natural language only, MCP/ONEOIS do not record `ACTION_TYP`.
- **The source query is widened by `WORK_WINDOW_HOURS` on both sides** of the matched traces'
  time span (`buildWorks()` in `src/app/api/traces/route.ts`). Without it, a job straddling the
  date filter splits in two.
- **Filters decide which works to find, not what a work contains.** Matched traces are resolved
  to works, then the missing siblings are fetched with no filters applied.
- **Failure is soft.** If the GAIA query fails or GAIA is not configured, the mapping comes back
  empty and every trace becomes a one-trace work — i.e. the pre-grouping screen.
- This is temporary. When GAIA gains a real `TXN_ID`, only the inference in `workGroup.ts` is
  replaced; `WorkSummary`, the API shape, and the UI stay.
- **목록 UI** — 묶음은 요약 행(`.work-row`) + 자식 행(`.work-child`)이 **한 덩어리**로 읽혀야 한다.
  글자를 더하지 않고 톤으로만 구분한다: 바탕 `--work-band`(자식) / `--work-head`(펼친 요약 행) +
  요약 행부터 마지막 자식(`.work-last`)까지 끊기지 않는 좌측 레일 `--work-rail` + 위(요약 행 border-top)
  아래(마지막 자식 border-bottom)를 닫는 선. ⚠️ 묶음 바탕 규칙이 `tr.active` 보다 **뒤에** 오므로
  선택 행 배경은 `tr.work-child.active`/`tr.work-row.active` 로 명시해 되돌린다(같은 specificity).
- **"묶음만" 조회는 순서가 반대다** (`groupedOnly=true` → `route.ts` `resolveGroupedTraceIds`).
  목록 상한은 트레이스 단위라, 묶음이 드문 기간엔 최근 N 트레이스 안에 묶음이 한 건도 안 걸려
  화면이 계속 빈다(실제로는 있는데). 그래서 이 경로는 **GAIA 소스(`fetchWorkGroupRows`, 4컬럼·최근
  5000행)로 묶음을 먼저 산출**하고 TRACE 2건 이상인 묶음만 최신순으로 골라 그 묶음의 TRACE 를
  통째로 가져온다(묶음을 쪼개지 않는다). 나머지 조건(FAC/ACTION/USER/에러)은 "그 조건에 걸린 TRACE 를
  가진 묶음" 으로 본다. `buildWorks(summaries, preInfo)` 가 이미 만든 매핑을 재사용해 GAIA 재조회는 없다.

### ⚠️ 클라이언트 API 호출 규칙 — 원시 `fetch` 금지 (`src/lib/apiClient.ts`)

세션은 7일(고정 만료)이라 **화면을 오래 열어두면 결국 만료**된다. 페이지 '이동' 은 미들웨어가
`/login` 으로 리다이렉트해 주지만, **이미 떠 있는 탭의 fetch 는 리다이렉트가 아니라 401 JSON
(`{error}`)** 을 받는다. 화면이 `res.ok` 를 안 보고 `await res.json()` 결과를 그대로 상태에
넣으면 기대한 배열이 `undefined` 가 되어 렌더에서 죽는다 (실제 사례: Traces 화면의
`works.filter` → `TypeError: Cannot read properties of undefined`).

- 클라이언트에서 `/api/*` 를 부를 땐 **`apiJson<T>()`**(또는 상태코드 분기가 필요하면 `apiFetch()`)만 쓴다.
- `apiJson` 은 401/403/그 외 실패를 **`ApiError`(`status` 보유)로 던진다** — 실패가 데이터로 둔갑하지 않는다.
- 401 이면 전역 '세션 만료' 신호가 **1회** 발화 → `AuthProvider` 가 `SessionExpiredDialog` 를 띄우고
  `/login?next=<현재경로>` 로 보낸다. `/api/auth/login` 의 401 은 '비밀번호 오류' 라 제외된다.
- 응답의 배열은 **`asArray<T>()`** 로 감싸 렌더가 `undefined.map/filter` 를 만지지 않게 한다.
- 에러 문구는 `errMessage(e)` 로 뽑아 화면에 사유를 보여준다(빈 표 ≠ 조회 실패). 패널 내부 배너 스타일은 `.load-error`.

## 두 가지 지연 지표 (둘 다 정규 — 재는 대상이 다름)

지연은 **성격이 다른 두 지표**로 나뉜다. 하나로 합치지 말 것.

| 지표 | 위치 | 재는 대상 | 단위 | 소스 |
|------|------|-----------|------|------|
| **평균 응답 속도** (UI 라벨; 내부 필드명은 latency 계열 유지) | 대시보드 | **Action 1건의 end-to-end 응답시간** (LLM 포함 전 구간 왕복) | 트레이스 | `BIZ_AIACTIONTXN_HIS` CUBE 행 |
| **LLM 속도 추이** (UI 라벨; 내부 필드명은 latency 계열 유지) | Tokens 탭 | **LLM 호출 1건**의 순수 소요시간, **전 노드**(action/judge/setup_guide…) | LLM 콜 | `TRX_TOKEN_DET.LATENCY_MS` |

**① 대시보드 "평균 응답 속도"** — 트레이스별 **CUBE 행의 `SEND_TM`(min) → `RESP_TM`(max)**. CUBE 가 진입 레이어라
이 왕복은 하위(GAIA/MCP/ONEOIS) + LLM 을 모두 거친 **전체 응답시간**이 된다. 버킷 귀속은 사용 추이 차트와 동일하게
트레이스 시작 시각(첫 recv) 기준. 24h 이상/음수 이상치는 제외.
- `src/app/api/stats/route.ts` — `cubeLat` 버킷 집계 + `cubeAvgLatencyMs` 응답 필드
- `src/lib/types.ts` — `TimeBucket.avgCubeLatencyMs`/`cubeLatencyTraces`, `StatsResponse.cubeAvgLatencyMs` (모두 optional)
- `src/components/CubeLatencyChart.tsx` — 차트 (`TokenLatencyChart` 의 `fmtDuration` 재사용)
- `src/app/dashboard/page.tsx` — "평균 응답 속도" 섹션 (사용 추이 카드 바로 아래)

**② Tokens 탭 "LLM 속도 추이"** — `TRX_TOKEN_DET.LATENCY_MS`(GAIA 가 LLM 요청→응답 시각차 측정) 의 버킷별 평균.
Action 에 한정되지 않고 GAIA 의 모든 노드 LLM 호출을 포괄한다. 노드별/모델별 `avgLatencyMs` 로도 분해된다.
**평균은 성공 호출만** 쓴다(타임아웃이 섞이면 한도값으로 끌려가 오독된다). 차트에 실패 지표를 얹지는 않는다 —
타임아웃 추적은 `/timeouts` 탭이 담당한다. (위 "App-owned DB" 의 `TRX_TOKEN_DET` 참고.)

> 두 지표는 **상호 보완**이다: ①은 "사용자가 체감한 총 응답시간이 느려졌나", ②는 "그중 LLM 호출 자체가 느린가/어느 노드가 느린가"를 답한다.

### ①의 레이어별 분해 — "레이어별 소요 비중" (대시보드 최하단)

①(전체 응답시간)을 **레이어별로 쪼개** "어느 레이어가 시간을 썼나 / 어디서 실패가 시작되나"를 답하는 카드.

⚠️ **행의 `SEND_TM→RESP_TM`(=`LayerStats.avgRespMs`)로 레이어를 비교하면 안 된다.** 이건 하위 레이어
대기를 통째로 품는 **포함(inclusive) 시간**이라 `CUBE ⊃ GAIA ⊃ MCP ⊃ ONEOIS` 로 중첩되고, 언제나
진입 레이어가 1등으로 나와 아무 정보가 없다. `avgRespMs` 는 진단용 참고값으로만 남겨 뒀다.

대신 `stats/route.ts` 가 트레이스별로 **self time** 을 분해한다 (`selfMs`/`selfTimeTraces`):

```
wait_i    = Σ(RESP_TM − SEND_TM)   i 가 하위를 기다린 시간 (멀티콜은 호출별 합)
outer_0   = 진입 레이어 RECV→RESP   트레이스 전체 관측 구간
outer_i   = wait_(i−1)              부모가 i 에게 내준 구간
self_i    = outer_i − wait_i        i 자신의 처리 + 전송 지연
self_최하위 = outer_최하위           그 아래(외부 시스템/미연결 레이어)는 미기록이라 제 몫으로 흡수
```

텔레스코핑되어 **Σ self_i = outer_0** 이므로 그대로 "시간 비중 100%" 로 읽힌다. GAIA 의 LLM 호출은
MCP `send→resp` 창 **밖**(주로 앞)에서 일어나므로 자연히 `self_GAIA` 로 잡힌다 — 실제로 GAIA 가 1등이 된다.

- ⚠️ **체인은 그 트레이스에 행이 있는 레이어만** 돈다(`present`). 행 없는 레이어를 체인에 두면 그 레이어의
  `wait` 가 0 이라 부모가 기다린 시간이 통째로 **존재하지도 않는 레이어**의 몫으로 잡힌다(MCP 미도달
  트레이스인데 MCP 가 2.7s 쓴 것처럼 보이는 버그).
- 분모(`selfTimeTraces`)는 **진입 레이어의 recv·resp 가 모두 기록된 완료 트레이스**만. 미완료는 제외.
- 시계 편차로 `wait > outer` 인 경우 `Math.max(0, …)` 로 clamp.
- **실패 발생 레이어**(`LayerStats.failOriginTraces`) = `errCd` 를 가진 **가장 깊은** 레이어로 트레이스 1건 귀속.
  에러가 상위로 전파돼 여러 레이어에 `errCd` 가 찍혀도 최초 발생지 1곳만 센다. (행 단위 `failCount` 는 그대로 유지)
- 화면 `src/components/LayerBudget.tsx` (`lb-*`): **좌 도넛 + 우 표** 2단 컴팩트 레이아웃.
  도넛은 시간/실패 **세그먼트 토글**로 한 번에 하나의 비중만 그리고(레이어 색 = `LAYER_COLOR`),
  중앙에 전체 요약(평균 응답 / 실패 건수)을, hover 시엔 그 레이어 값+비중을 띄운다.
  우측 표(자체 소요 평균·비중·실패·행 수)와 도넛은 hover 로 **서로를 하이라이트**하고,
  활성 토글에 대응하는 열만 배경을 띄워 둘을 연결한다. 막대 길이 비교가 아니라 **비중**으로 읽는 구성.
  ⚠️ 도넛은 **recharts 를 쓰지 않고 SVG arc 를 직접 그린다** — recharts v3 의 `Pie` 에는 제어형
  `activeIndex` 가 없어 표→도넛 하이라이트 동기화가 불가능하다. 100% 한 조각(예: 실패가 한 레이어에서만)은
  시작점=끝점이라 arc 가 사라지므로 그때만 `<circle>` 링으로 그린다. (구 `LayerBars.tsx` 는 삭제됨)

## ⚠️ TEMPORARY WORKAROUND — ONEOIS 미연결 status 보정 (제거 예정)

**배경**: ONEOIS 레이어의 DB 연결이 아직 없어 모든 트레이스가 `allComplete=false`가 되고,
에러 코드가 없는 트레이스가 전부 `pending`(대시보드의 PARTIAL)으로 분류되어 대시보드/목록 값이 무의미해지는 문제가 있었다.

**임시 규칙**: 에러 코드(`errCd`)가 없는 미완료(pending) 트레이스를 CUBE 레이어의 RESP 메시지(`respMsgCtn`)로 재판정한다.
- CUBE RESP 에 액션 실패 문구 포함 → `fail` — 문구는 `ACTION_FAIL_RULES` 로 정의 (시즈닝 = `"Seasoning 실패"`, AutoQual 취소 = `"AutoQual 취소 실패"`, AutoQual 실행 = `"AutoQual 실행 실패"`; 새 액션이 생기면 여기에 한 줄 추가)
- 그 외 → `ok`(성공으로 간주)

**구현 위치**:
- `src/lib/tempStatus.ts` — 아래 export 들이 모두 임시 코드 (파일 전체 삭제 대상):
  - `ACTION_FAIL_RULES` — 액션별 `{ action, phrase, code }` 규칙. `phrase` 는 CUBE RESP 검색 문구, `code` 는 Top Errors 에 노출할 가상 에러 코드 (DB 에는 존재하지 않음): `FAIL_SEASONING` / `FAIL_AQ_CANCEL` / `FAIL_AQ_RUN`
  - `ACTION_FAIL_PHRASES` — 실패 문구 목록 (db.ts FTE 집계에서 성공 제외용)
  - `matchedActionFailCodes(rows)` — CUBE RESP 에 매칭된 규칙들의 가상 코드 목록
  - `hasActionFailure(rows)` — 실패 문구가 하나라도 있는지
  - `classifyPendingByCubeResp(rows)` — pending 을 ok/fail 로 대체 판정
- `src/app/api/traces/route.ts` 와 `src/app/api/stats/route.ts` 의 `classify()` 내 `// TEMP(ONEOIS 미연결)` 블록 — pending 분기를 `classifyPendingByCubeResp` 로 교체
- `src/app/api/stats/route.ts` 의 트레이스 루프 내 `// TEMP(ONEOIS 미연결)` 블록 — `matchedActionFailCodes(list)` 의 각 가상 코드를 `errCount` 에 +1 해서 Top Errors 리스트에 노출 (제외 필터 `excludeErrCds` 도 같은 코드로 매칭)

> ⚠️ 알려진 갭(미보정): 위 가상 코드는 **트레이스 단위**(도넛/시계열/Top Errors/byChannel/byAction)에만 반영된다. **행 단위** 집계인 `layers[].failCount` / `errCount` / `okRows` (LayerBars) 는 여전히 보정되지 않아, 액션 실패 트레이스의 CUBE 행이 `okRows` 로 잡힐 수 있다. 의도된 트레이드오프이며, 필요해지면 같은 패턴으로 보정 가능.

**ONEOIS DB 연결이 완료되면 원복 방법**:
1. `src/lib/tempStatus.ts` 파일 삭제
2. 두 route 파일의 `import { ... } from "@/lib/tempStatus"` 라인 제거
3. 두 `classify()` 의 `// TEMP(ONEOIS 미연결)` 블록을 원래 코드로 복원:
   `if (errs.length === 0) return allComplete ? "ok" : "pending";`
4. `src/app/api/stats/route.ts` 의 트레이스 루프에서 액션 실패 Top Errors 보정 블록 삭제
5. ⚠️ `src/lib/db.ts` 의 `monthlyActionSuccess()`(FTE 집계)도 `ACTION_FAIL_PHRASES` 를 import 한다.
   tempStatus.ts 를 지우면 빌드가 깨지므로, '액션 성공' 정의를 ONEOIS 포함 정식 기준
   (allComplete + errCd 없음)으로 다시 잡고 import 를 정리할 것. (아래 "Agent 프로필" 참고)
