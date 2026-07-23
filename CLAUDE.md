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
   - `GET /api/traces` — list view, returns per-trace summaries
   - `GET /api/traces/[traceId]` — detail view, returns the raw rows across layers
2. Route handlers in `src/app/api/traces/` delegate to `src/lib/db.ts`.
3. `db.ts` fans out **one query per layer** in parallel (`Promise.all` over `LAYER_ORDER`), each using its own connection config read from the YAML loader in `src/lib/config.ts` (see "Config files" below).
4. `/api/traces` groups rows by `TRACE_ID` and computes `allComplete` (requires `layerSet.size === LAYER_ORDER.length` and every row `SEND_COMPLT_YN='Y'`) and `hasError`. `lastSendTm` in `TraceSummary` is the max of all `sendTm` and `respTm` values.
5. `TraceTimeline` groups rows by layer and renders them. Single-call layers show **recv | send | resp** in a 3-column layout; multi-call layers show the upstream recv once at the top, then numbered `Call #N` items each with a **send | resp** pair.

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

### App-owned DB — GAIA's DB doubles as it (⚠️ important)

The app needs its own DB for **app-only tables** (not the replicated `BIZ_AIACTIONTXN_HIS`). **No dedicated DB resource could be allocated, so GAIA's DB serves as the app's own DB.** This mapping lives in one place: `APP_DB_LAYER` (`= "GAIA"`) and `getAppDbConfig()` in `src/lib/config.ts` — if GAIA's DB moves, only that constant follows it. App-only tables are created **once, in that DB only** (unlike the per-layer BIZ table).

- **`TRX_ERRMSG_COD`** — error-code → meaning master (`sql/create_trx_errmsg_cod.sql`, run on the app DB only). Columns `ERR_CD` (PK), `ERR_MSG_CTN`, `USE_YN`, audit dates. `ERR_CD` matches `BIZ_AIACTIONTXN_HIS.ERR_CD`.
- Read path: `src/lib/errorCodes.ts` `loadErrorCodeMap()` (5-min in-memory cache, same lazy-`oracledb`-swallow pattern) → `GET /api/error-codes` → dashboard fetches once on mount and passes the map to the "주요 에러" `TopList` as `descriptions`, which surfaces the meaning in the hover tooltip. Missing table/driver/config ⇒ empty map ⇒ tooltip just shows the bare code (no breakage).
- **`TRX_TOKEN_DET`** — GAIA LLM 호출별 토큰 사용량 상세 (`sql/create_trx_token_det.sql`, run on the app DB only). One row **per LLM call**, inserted by GAIA via `sql/dml_insert_token_det.sql`. Columns: `TOKEN_ID` (IDENTITY PK), `TRACE_ID` (nullable — present for action calls, used only for display not aggregation), `NODE_NM` (the GAIA node that made the call: `action`/`judge`/`setup_guide` … — **primary aggregation dimension**), `MODEL_NM` (GAIA 호출 LLM, 현재 사내 Qwen — 변경 가능), `USER_ID`, `INPUT_TOKENS`/`OUTPUT_TOKENS`/`TOTAL_TOKENS` (provider-neutral 명칭 — Qwen 등 OpenAI 호환 응답의 `prompt_tokens`/`completion_tokens` 를 매핑), `LATENCY_MS` (LLM 요청→응답 소요시간 ms, **nullable** — GAIA 가 측정해 적재; 없으면 집계에서 자동 제외), `QUERY_CTN` (LLM 에 실제로 들어간 쿼리/프롬프트 — `VARCHAR2(4000)`, **디버깅용, nullable**; 집계 대상 아님, 호출 펼침에서만 노출), `CALL_TM`, `REG_DT`. Unlike `BIZ_AIACTIONTXN_HIS`, this is **not** replicated per layer.
- Read path: `src/lib/tokens.ts` `fetchTokenStats()` (same lazy-`oracledb`-swallow pattern; aggregates in **SQL `GROUP BY`** rather than JS since the table can be large) → `GET /api/tokens` → the **Tokens 탭** (`src/app/tokens/page.tsx`). Time-bucket helpers are shared with the stats route via `src/lib/timeBuckets.ts` (`pickGranularity`/`floorToBucket`/`isoNoTz`/`parseTs`/`enumerateBucketStarts`). Missing table/driver/config ⇒ empty stats (zeros) ⇒ page renders empty chart (no breakage).
  - `fetchTokenStats` 도 latency 를 집계한다: 버킷별 `avgLatencyMs`(`SUM/COUNT(LATENCY_MS)` 로 NULL 제외 평균), 전체 `avgLatencyMs`, `byNode`/`byModel` 의 `avgLatencyMs`(`AVG(LATENCY_MS)`). LATENCY_MS 가 한 건도 없으면 모두 null → UI 는 빈 상태/측정값 없음 표시(무해).
  - The Tokens 탭 has two halves: **현황**(KPI/추이 — `TokenStatsCards`/`TokenChart`, LLM 호출 지연 추이 차트 `TokenLatencyChart`, 노드별/모델별 리더보드 카드 `TokenBreakdown` — `byNode`/`byModel` 를 각각 별도 카드(노드=파랑, 모델=보라)로 렌더, 순위 배지 + 큰 값 + 1위 대비 상대 바 + 비중%, 토큰/호출/토큰·호출/지연 공유 메트릭 토글, 행 클릭 = 노드/모델 필터. **노드×모델 교차 집계**(`TokenDimStat.sub`, 별도 `GROUP BY NODE_NM, MODEL_NM` 쿼리)로 각 노드가 실제 쓴 모델 구성(역방향도)을 행 안에 칩+비중% 로 노출 — 한 질문이 여러 노드/모델을 거치므로(예: actionRouterNode=qwen3.6 → SeasoningNode=qwen3.5) "노드=모델 1개" 로 오해하지 않게 하는 장치) and **질문별 토큰**(`QuestionsTable`). A "질문" = one `TRACE_ID`; 한 질문의 호출은 라우터→실행 노드처럼 **여러 노드/모델을 거칠 수 있어** `questions` 는 대표값(MAX) 대신 거쳐간 노드/모델 **전부**를 내린다(`nodes[]`/`models[]`, `LISTAGG ... ON OVERFLOW TRUNCATE` 후 JS 중복 제거, 첫 호출 순) — 표에는 칩으로 나열. `fetchTokenStats` returns `questions` (grouped by `TRACE_ID`, null-trace rows treated as one-call-per-question, **최신 LAST_TM desc 상위 500건** — 토큰순 로드였을 때 최근 질문이 잘려 보이는 착시가 있어 최신순으로 변경). 집계 쿼리들은 `run()` 헬퍼로 **쿼리별 격리 실행**되어 한 쿼리가 SQL 에러여도 그 섹션만 비고 나머지는 정상, 로그에 `fetchTokenStats [섹션명] query failed` + ORA 코드가 남는다. **질의 = 질문의 대표 정보** 관점: 한 질문의 호출들은 같은 `QUERY_CTN` 을 공유하는 게 보통이라, `questions` 가 **원본 질의**(`queryCtn` — 가장 이른 non-null 호출의 QUERY_CTN, `MIN ... KEEP (DENSE_RANK FIRST ORDER BY NVL2(QUERY_CTN,0,1), CALL_TM)`)를 질문 단위로 내리고 표의 질문 셀은 **질의(크게) + TRACE_ID(작게) 2줄**로 그린다. `QuestionsTable` 은 **컬럼별 필터**(질문(질의+TRACE_ID)/USER 텍스트, NODE/MODEL 셀렉트 — 로드된 상위 질문 범위 내 클라이언트 필터) + **헤더 클릭 정렬**(LAST_TM/IN/OUT/TOTAL/CALLS, 재클릭 = 방향 토글, 기본 = LAST_TM desc) 구조. Passing `?traceId=` narrows everything and fills `calls` (per-call rows, incl. `queryCtn`/`latencyMs`) used to expand a question inline — 펼침(`CallsDetail`)은 **원본 질의 블록**(액센트 보더, 전체 노출 — 280자 초과 시만 3줄 접힘+더 보기 `QueryText`)을 헤드라인으로 두고, 아래에 **호출 타임라인**: 요약 스트립(호출 수 · 노드 흐름 · 총 토큰 · 첫→마지막 구간) + 시간순 `#N` 레일 + 호출 카드(노드→모델 · ⏱응답시간 · 직전 호출과의 간격 · 토큰 바). 호출 카드의 쿼리는 **원본과 다를 때만**(공백 정규화 비교) "이 호출의 쿼리" 로 다시 표시. **any** trace-linked question 에서 가능(호출 1건이어도). `QUERY_CTN` 은 `calls` 쿼리와 `questions` 의 원본 질의 집계에서만 SELECT 한다.

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
- **화면 구성**: ① Action Agent 실적 — KPI 5칸(총 실행/성공률/실패/평균 응답시간/**사용자 수**), 일별 현황 표(위 참고), 사용 추이(`TimeSeriesChart`), 평균 응답 지연(`CubeLatencyChart`), 상태 분포+주요 에러, 액션 타입별+주간 사용자(`TopList`), FAC별/AREA별 ② LLM 토큰 — `TokenStatsCards`/`TokenChart`/`TokenLatencyChart` + **노드별 구분**(`TokenBreakdown`, action 외 judge/setup_guide 노드 실적 분리 — 리포트에선 필터 없이 조회 전용) ③ 리포트 텍스트 미리보기(`<pre>`) — 복사될 내용 그대로 노출. 기존 대시보드/Tokens 탭 컴포넌트를 그대로 재사용한다.
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
- **사용자 요청 흐름**(`fetchRequestFailureContext`): 선택한 실패 요청의 `USER_ID`·수신시각을 찾고, 같은 사용자가 **±12h** 낸 요청을 TRACE_ID 단위(GROUP BY)로 묶어 시간순으로 내린다. `ACTION_TYP` 없는 요청은 `isFailure` 로 표시 — "무엇을 시도하다 어디서 튕겼나" 흐름을 관리자가 읽게 한다. 흐름의 각 노드는 기존 `TraceTimeline`(`/api/traces/[traceId]`)으로 full 상세 인라인 전개.
- **화면**(`src/components/improvement/RequestFailureTracker.tsx`, `rft-*` / 셸은 `ic-*`): 상단 KPI(미조치/조치중/조치완료/영향 사용자/기간 내 실패 수) + 기간 프리셋(24h/7d/30d/전체, 서버 `dateFrom`) + 좌(상태칩 필터·검색 리스트)/우(원본 요청·응답·조치 세그먼트+메모+담당자·사용자 흐름) 스플릿. 상태칩/검색은 클라이언트 필터, 조치 저장 시 로컬 카운트 재계산. 에러코드 의미는 `/api/error-codes` 재사용.
- **담당자(HANDLER_ID)**: 조치 저장 PUT 에서 명시하지 않으면 **로그인 세션의 사번으로 자동 기록**된다(`route.ts` 에서 `guard.session.sub` 폴백). 화면에서 수동 지정도 여전히 가능. (로그인 도입 완료 — 아래 "인증/인가" 참고.)

## 인증/인가 — 로그인 · 계정 · 권한 (⚠️ 앱 자체 DB = GAIA)

전 화면 로그인 필수. 사번(USER_ID)으로 로그인하고 3단계 권한(**ADMIN 운영자 > BR 상위 > DEV 개발자**)으로 접근을 가른다. 기존 하드코딩 `ADMIN_PASSWORD`/`AdminGate`(sessionStorage 게이트)는 **완전히 제거**되고 세션 기반 인증으로 대체됐다.

- **권한 단일 소스 `src/lib/roles.ts`** (클라이언트·Edge 미들웨어·서버 공용 — Node 전용 모듈 import 금지). `Role`, `ROLE_LABEL`, `roleAtLeast(role,min)`, 그리고 **경로→최소권한 매핑 `ROUTE_RULES`**(`requiredRoleForPath`). 접근 범위가 바뀌면 여기만 고친다. 현재: `/admin`=ADMIN, `/accounts`·`/api/accounts`·`/report`·`/improvement`·`/event-fabs`=BR, 그 외=인증만 되면 DEV. **계정 관리는 BR 이상**이되 권한 상향 방지 가드가 API 에 있다 — ADMIN 계정 생성/수정/삭제/초기화·ADMIN 승격은 **ADMIN 만**(BR 은 BR/DEV 만 다룰 수 있고 UI 도 ADMIN 옵션·행 버튼을 가림).
- **계정 저장소 `TRX_USER_MAS`** (`sql/create_trx_user_mas.sql`, **앱 자체 DB=GAIA 에서만 1회 실행**, ADM 소유 + GRANT + PUBLIC SYNONYM — 다른 앱 테이블과 동일 패턴). 컬럼: USER_ID(사번,PK)/USER_NM/WORK_CTN(업무)/ROLE_CD/PWD_HASH/PWD_SALT/USE_YN/MUST_CHG_YN/LAST_LOGIN_DT/감사일시. `src/lib/users.ts` 가 CRUD·로그인검증·시드를 담당(lazy-`oracledb`-swallow, DB 불가 시 `available=false`).
  - **최초 관리자 시드**: 테이블이 비면 로그인/목록 조회 시 `ensureSeedAdmin` 이 기본 운영자(USER_ID=`admin`/PW=`admin1234`/ADMIN/MUST_CHG_YN=Y)를 1회 생성. **최초 로그인 후 즉시 변경**.
- **비밀번호**: 평문 저장 금지. `src/lib/auth/password.ts` 가 Node 내장 `crypto` scrypt 로 해시(외부 의존성 없음 — 배포가 src 복붙이라 native dep 회피). 관리자 초기화 시 MUST_CHG_YN='Y' → 다음 로그인에서 강제 변경(`ChangePasswordModal forced`).
- **세션**: `src/lib/auth/session.ts` 서명 쿠키(`trx_session`, httpOnly, 12h). 형식 `base64url(payload).HMAC-SHA256`, **Web Crypto(`crypto.subtle`)만 사용**해 Edge 미들웨어·Node 라우트 공용. 비밀키 `AUTH_SECRET`(미설정 시 개발용 폴백 — **운영 배포 시 반드시 환경변수 설정**). 쿠키 `secure` 는 기본 off(사내 HTTP 배포에서 로그인 막힘 방지) — HTTPS 면 `AUTH_COOKIE_SECURE=true`. 옵션은 `sessionCookieOptions()` 한 곳.
- **미들웨어 `src/middleware.ts`**(Edge): 비로그인 페이지→`/login?next=`, API→401; 권한 부족 페이지→`/403`, API→403. 인가 근거는 `ROUTE_RULES`. 정적 자산·`/login`·`/api/auth/*` 는 통과.
- **API**: `POST /api/auth/login`·`logout`, `GET /api/auth/me`(비로그인 200+`{user:null}`), `POST /api/auth/change-password`(본인). 계정관리(BR 이상 + 위 상향방지 가드): `GET/POST /api/accounts`, `PUT/DELETE /api/accounts/[userId]`, `POST /api/accounts/[userId]/reset-password`. 서버 방어는 `src/lib/auth/current.ts` `requireRole(min)`.
- **초기 비밀번호 = 사번**: 계정 생성 시 비밀번호를 **USER_ID(사번)와 동일**하게 설정하고 `MUST_CHG_YN='Y'` → 최초 로그인에서 사용자가 강제 변경(`ChangePasswordModal forced`). 등록 폼엔 비번 입력이 없다. 관리자 **비밀번호 초기화**도 값 미지정 시 **사번으로** 초기화(지정하면 그 값). 결과 비번은 화면에 1회 노출해 전달용으로 보여준다.
- **클라이언트**: `AuthProvider`(`/api/auth/me` 컨텍스트, `useAuth()`) → `AppChrome`(상단바/푸터 셸, `/login` 은 셸 없이 전체화면) → `UserMenu`(계정 칩+드롭다운, 권한별 관리 링크·비번변경·로그아웃). 기존 mutation 클라이언트 fetch 들은 `x-admin-password` 헤더를 떼고 **세션 쿠키 자동 전송**에 의존(401/403 시 안내 문구).
- **화면**: `/login`(브랜드 히어로+폼 스플릿), `/accounts`(계정 목록·생성/수정/비번초기화/삭제, 권한 3택 카드), `/403`. `/agent` 헤더의 리포트/관리자 버튼은 서버에서 세션 권한으로 조건부 노출.
- **기존 PUT 게이트 교체**: `/api/profile`=ADMIN, `/api/event-fabs`=BR, `/api/request-failures`=BR (모두 `requireRole`). `/admin`·`/report`·`/event-fabs`·`/improvement` 페이지의 `AdminGate` 래퍼 제거(미들웨어가 인가). **삭제된 파일**: `src/components/AdminGate.tsx`, `src/lib/adminAuth.ts` (⚠️ 사내 복붙 배포는 삭제가 전파 안 되니 그쪽 레포에서도 지울 것 — memory `deploy-copy-paste-sync`).

## 두 가지 지연 지표 (둘 다 정규 — 재는 대상이 다름)

지연은 **성격이 다른 두 지표**로 나뉜다. 하나로 합치지 말 것.

| 지표 | 위치 | 재는 대상 | 단위 | 소스 |
|------|------|-----------|------|------|
| **평균 응답 지연** | 대시보드 | **Action 1건의 end-to-end 응답시간** (LLM 포함 전 구간 왕복) | 트레이스 | `BIZ_AIACTIONTXN_HIS` CUBE 행 |
| **LLM 호출 지연 추이** | Tokens 탭 | **LLM 호출 1건**의 순수 소요시간, **전 노드**(action/judge/setup_guide…) | LLM 콜 | `TRX_TOKEN_DET.LATENCY_MS` |

**① 대시보드 "평균 응답 지연"** — 트레이스별 **CUBE 행의 `SEND_TM`(min) → `RESP_TM`(max)**. CUBE 가 진입 레이어라
이 왕복은 하위(GAIA/MCP/ONEOIS) + LLM 을 모두 거친 **전체 응답시간**이 된다. 버킷 귀속은 사용 추이 차트와 동일하게
트레이스 시작 시각(첫 recv) 기준. 24h 이상/음수 이상치는 제외.
- `src/app/api/stats/route.ts` — `cubeLat` 버킷 집계 + `cubeAvgLatencyMs` 응답 필드
- `src/lib/types.ts` — `TimeBucket.avgCubeLatencyMs`/`cubeLatencyTraces`, `StatsResponse.cubeAvgLatencyMs` (모두 optional)
- `src/components/CubeLatencyChart.tsx` — 차트 (`TokenLatencyChart` 의 `fmtDuration` 재사용)
- `src/app/dashboard/page.tsx` — "평균 응답 지연" 섹션 (사용 추이 카드 바로 아래)

**② Tokens 탭 "LLM 호출 지연 추이"** — `TRX_TOKEN_DET.LATENCY_MS`(GAIA 가 LLM 요청→응답 시각차 측정) 의 버킷별 평균.
Action 에 한정되지 않고 GAIA 의 모든 노드 LLM 호출을 포괄한다. 노드별/모델별 `avgLatencyMs` 로도 분해된다. (위 "App-owned DB" 의 `TRX_TOKEN_DET` 참고.)

> 두 지표는 **상호 보완**이다: ①은 "사용자가 체감한 총 응답시간이 느려졌나", ②는 "그중 LLM 호출 자체가 느린가/어느 노드가 느린가"를 답한다.

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
