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
  - The Tokens 탭 has two halves: **현황**(KPI/추이 — `TokenStatsCards`/`TokenChart`, LLM 호출 지연 추이 차트 `TokenLatencyChart`, 노드별/모델별 리더보드 카드 `TokenBreakdown` — `byNode`/`byModel` 를 각각 별도 카드(노드=파랑, 모델=보라)로 렌더, 순위 배지 + 큰 값 + 1위 대비 상대 바 + 비중%, 토큰/호출/토큰·호출/지연 공유 메트릭 토글, 행 클릭 = 노드/모델 필터) and **질문별 토큰**(`QuestionsTable`). A "질문" = one `TRACE_ID` (GAIA routes each question to exactly one of `action`/`judge`/`setup_guide`); `fetchTokenStats` returns `questions` (grouped by `TRACE_ID`, null-trace rows treated as one-call-per-question, top by total tokens) for that table. Passing `?traceId=` narrows everything and fills `calls` (per-call rows, incl. `queryCtn`) used to expand a question inline — expansion is available for **any** trace-linked question (호출 1건이어도) so `QUERY_CTN`(실제 LLM 쿼리)을 확인할 수 있다. `calls` 쿼리만 `QUERY_CTN` 을 SELECT 한다(집계 쿼리들은 제외).

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
- **API**: `GET/PUT /api/profile`. PUT 은 헤더 `x-admin-password` 가 `ADMIN_PASSWORD`(`src/lib/adminAuth.ts`, 하드코딩 `"admin"`)와 일치해야 저장. ⚠️ 클라이언트 번들에도 노출되는 **단순 게이트** — 실제 보안 아님.
- **화면**: `/agent`(서버 컴포넌트, `ProfileCard` + `WorkShowcase`), 대시보드 상단 `ProfileStrip`(클라이언트), `/admin`(비밀번호 게이트 후 편집 폼, 업무 순서 드래그앤드롭). 사진은 `public/` 에 올리고 `avatarImage` 에 `/파일명` 지정(없거나 로드 실패 시 `avatar` 이모지로 폴백, `AgentAvatar`).
- **FTE 성과 지표**: `src/lib/fte.ts` `computeFteStats()` 가 **실데이터로 계산**한다. `db.ts.monthlySeaSuccess()` 가 CUBE 에서 2026-01-01~현재 'SEA 성공'(에러 없고 CUBE RESP 에 'Seasoning 실패' 문구 없는 트레이스) 수를 월별 집계 → 연간 FTE `= 누적 × 60 ÷ 65,984`, 월별 FTE `= 월 × 60 ÷ 65,984 × 12`(연환산). FTE 1 = 1인·1년. CUBE 미연결이면 `null` → 카드는 `profile.fte`(수동 폴백) 표시 + 차트는 안내 문구. 차트(`FteChart`)는 최근 12개월만 노출. **위 TEMPORARY WORKAROUND 의 `SEASONING_FAIL_PHRASE` 에 의존**(원복 시 5번 항목 참고).

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
- CUBE RESP 에 `"Seasoning 실패"` 문구 포함 → `fail`
- 그 외 → `ok`(성공으로 간주)

**구현 위치**:
- `src/lib/tempStatus.ts` — 아래 export 들이 모두 임시 코드 (파일 전체 삭제 대상):
  - `SEASONING_FAIL_PHRASE` — CUBE RESP 에서 검색할 문구
  - `SEASONING_FAIL_CODE` (`"FAIL_SEASONING"`) — Top Errors 에 노출할 가상 에러 코드 (DB 에는 존재하지 않음)
  - `hasSeasoningFailure(rows)` — CUBE RESP 에 위 문구 포함 여부
  - `classifyPendingByCubeResp(rows)` — pending 을 ok/fail 로 대체 판정
- `src/app/api/traces/route.ts` 와 `src/app/api/stats/route.ts` 의 `classify()` 내 `// TEMP(ONEOIS 미연결)` 블록 — pending 분기를 `classifyPendingByCubeResp` 로 교체
- `src/app/api/stats/route.ts` 의 트레이스 루프 내 `// TEMP(ONEOIS 미연결)` 블록 — `hasSeasoningFailure(list)` 시 `errCount` 에 `SEASONING_FAIL_CODE` 를 +1 해서 Top Errors 리스트에 노출

> ⚠️ 알려진 갭(미보정): 위 가상 코드는 **트레이스 단위**(도넛/시계열/Top Errors/byChannel/byAction)에만 반영된다. **행 단위** 집계인 `layers[].failCount` / `errCount` / `okRows` (LayerBars) 는 여전히 보정되지 않아, Seasoning 실패 트레이스의 CUBE 행이 `okRows` 로 잡힐 수 있다. 의도된 트레이드오프이며, 필요해지면 같은 패턴으로 보정 가능.

**ONEOIS DB 연결이 완료되면 원복 방법**:
1. `src/lib/tempStatus.ts` 파일 삭제
2. 두 route 파일의 `import { ... } from "@/lib/tempStatus"` 라인 제거
3. 두 `classify()` 의 `// TEMP(ONEOIS 미연결)` 블록을 원래 코드로 복원:
   `if (errs.length === 0) return allComplete ? "ok" : "pending";`
4. `src/app/api/stats/route.ts` 의 트레이스 루프에서 Seasoning Top Errors 보정 블록 삭제
5. ⚠️ `src/lib/db.ts` 의 `monthlySeaSuccess()`(FTE 집계)도 `SEASONING_FAIL_PHRASE` 를 import 한다.
   tempStatus.ts 를 지우면 빌드가 깨지므로, 'SEA 성공' 정의를 ONEOIS 포함 정식 기준
   (allComplete + errCd 없음)으로 다시 잡고 import 를 정리할 것. (아래 "Agent 프로필" 참고)
