# 멀티 에이전트 · 앱 자체 DB · 설정

## 설정 파일

`src/lib/config.ts` 가 시작 시 YAML 을 로드해 캐시한다.
`config.dev.yml` 이 있으면 그것을 쓰고 `appEnv='dev'`, 없으면 `config.yml` + `appEnv='prd'`.
둘 다 레포에 커밋되어 있고, `deploy.sh` 가 prd 배포 때 `config.dev.yml` 을 지운다.

스키마: `{ layers: { <LAYER>: { user, password, connectString } } }`.
`loadConfig()` 는 세 필드 중 하나라도 없는 레이어 항목을 제거한다 → 미구성 레이어는 `queryLayer` 가
빈 행을 돌려준다.

## 앱 자체 DB = GAIA 의 DB

앱 전용 테이블(복제되지 않는 것)을 둘 DB 를 따로 할당받지 못해 **GAIA 의 DB 를 앱 자체 DB 로 겸용**한다.
매핑은 `src/lib/config.ts` 의 `APP_DB_LAYER`(= `"GAIA"`) 와 `getAppDbConfig()` 한 곳 —
GAIA 의 DB 가 옮겨가면 이 상수만 따라간다.

앱 전용 테이블은 **그 DB 에서만 1회** 생성한다(레이어별 BIZ 테이블과 다르다).

| 테이블 | 용도 | DDL |
|---|---|---|
| `TRX_ERRMSG_COD` | 에러코드 → 의미 마스터 | `sql/create_trx_errmsg_cod.sql` |
| `TRX_TOKEN_DET` | GAIA LLM 호출별 토큰/지연/결과 상세 | `sql/create_trx_token_det.sql` |
| `TRX_USER_MAS` | 계정 | `sql/create_trx_user_mas.sql` |
| `TRX_REQ_FAILURE_INF` | 실패 요청 조치정보 | `sql/create_trx_req_failure_inf.sql` |

예외: **`TRX_EVENT_MAP` 은 MCP DB** 에 있다(MCP 가 판정 시 직접 읽어야 해서).
매핑은 `EVENT_FAB_DB_LAYER`(= `"MCP"`) / `getEventFabDbConfig()`.

DDL 은 ADM 계정(IDMSADM2) 소유로 실행하고 앱/MCP 계정(IDMSAPP2)은 GRANT + PUBLIC SYNONYM 으로 참조한다.

### `TRX_ERRMSG_COD`

`ERR_CD`(PK) · `ERR_MSG_CTN` · `USE_YN` · 감사일시. `ERR_CD` 는 `BIZ_AIACTIONTXN_HIS.ERR_CD` 와 매칭.
읽기: `src/lib/errorCodes.ts` `loadErrorCodeMap()`(5분 캐시) → `GET /api/error-codes` → 대시보드가
mount 시 1회 받아 "주요 에러" `TopList` 에 `descriptions` 로 넘겨 툴팁에 의미를 띄운다.
테이블/드라이버/설정 없음 ⇒ 빈 맵 ⇒ 툴팁에 코드만(무해).

### `TRX_TOKEN_DET`

LLM 호출 1건 = 1행. GAIA 가 `sql/dml_insert_token_det.sql` 로 적재. **에이전트마다 별도 DB** 에 있다.

| 컬럼 | 설명 |
|---|---|
| `TOKEN_ID` | IDENTITY PK |
| `TRACE_ID` | nullable — 액션 호출에만 있음. 표시용, 집계 대상 아님 |
| `NODE_NM` | 호출한 GAIA 노드(`action`/`judge`/`setup_guide`…) — **주 집계 차원** |
| `MODEL_NM` | 호출 LLM (현재 사내 Qwen, 변경 가능) |
| `USER_ID` | |
| `INPUT_TOKENS`/`OUTPUT_TOKENS`/`TOTAL_TOKENS` | provider-neutral 명칭. OpenAI 호환 응답의 `prompt_tokens`/`completion_tokens` 매핑 |
| `LATENCY_MS` | LLM 요청→응답 ms, **nullable**. 없으면 집계에서 자동 제외 |
| `QUERY_CTN` | LLM 에 실제 들어간 쿼리/프롬프트. `VARCHAR2(4000)`, nullable, 집계 대상 아님 |
| `STAT_CD`/`ERR_CTN` | 호출 결과 |
| `CALL_TM`/`REG_DT` | |

**실패 호출도 1행 적재한다.** GAIA 가 `call_llm` 을 try/except 로 감싸 성공은 `STAT_CD='OK'`,
실패(타임아웃 포함)는 `'ERROR'` + `ERR_CTN`(사유) + 토큰 0 + `LATENCY_MS`=예외까지의 경과시간.
성공만 적재하던 때는 실패한 노드의 행 자체가 없어 "actionRouter 27s 통과 → Seasoning 90s 타임아웃"
의 뒷부분이 화면에서 통째로 사라졌고 지연 평균도 생존자 편향으로 낮게 나왔다.

**타임아웃/일반오류 구분은 `STAT_CD` 가 아니라 `ERR_CTN` 문구로 한다.** 판정은
`src/lib/tokenStatus.ts` 한 곳 — `callStatus()`(화면용) 과 `SQL_ERR_PRED`/`SQL_OK_PRED`/
`SQL_TIMEOUT_PRED`(집계 SQL용). 하나를 고치면 다른 쪽도 같이.

**컬럼 미존재 내성**: `fetchTokenStats` 는 시작 시 `SELECT STAT_CD, ERR_CTN ... WHERE 1=0` 으로
컬럼 존재를 탐지(`hasStatus`)하고, 없으면 실패 관련 표현식을 상수로 대체한다.
덕분에 ALTER · GAIA 배포 · 앱 배포 순서가 자유롭다.

## 멀티 에이전트 — Tokens / Timeout 두 화면만

이 앱은 에이전트 하나를 전제로 만들어졌지만, 다른 팀 에이전트도 **Tokens / Timeout 두 화면만** 쓴다.
두 화면의 출처는 `TRX_TOKEN_DET` 하나이고 에이전트마다 GAIA DB 가 다르다.

### 정의는 `config.yml` 의 `agents:`

`{ id, name, avatar, default, db, tpmLimit, rpmLimit }`.
`id` 가 전 계층의 키다 (`?agent=<id>`, `localStorage["tracex.agent"]`, `TRX_USER_MAS.AGENT_ID`).

- 기본 에이전트(`default: true`)가 `db` 를 생략하면 `layers.GAIA` 를 재사용
- **`agents:` 섹션이 없으면 `layers.GAIA` 를 쓰는 단일 에이전트를 합성**하므로 기존 배포가 그대로 돈다
- 계정별 접근 제한은 `roles.ts` 의 `resolveScope()`/`canViewAgent()` 가 판정한다
  (→ [auth.md](./auth.md)). 집행 지점은 조회 라우트의 `requireAgent()` 403 이고,
  `/api/agents` 의 목록 필터는 표시용이다

### 로더 — `src/lib/config.ts`

`listAgents()` / `getAgent(id)` / `getAgentDbConfig(id)` / `defaultAgentId()` / `publicAgents()`.

**`AgentDef` 는 접속정보를 품으므로 서버 전용이다.** 클라이언트로 내려가는 건 `publicAgents()` 가
만드는 `AgentInfo`(비밀 제거, `dbConfigured` 만).

### 에이전트별로 갈리는 모듈은 넷

`tokens.ts` · `timeouts.ts` · `tickStats.ts`(DB 선택) 과 `profile.ts`(파일 선택).
앞 셋은 `getAppDbConfig()` 대신 `getAgentDbConfig(filter.agentId)` 로 커넥션을 고른다.

**agentId 는 WHERE 조건이 아니라 커넥션 선택이다** — 에이전트는 행이 아니라 DB 단위로 갈린다.
`buildWhere()` 는 손대지 않는다. `getAppDbConfig()` 는 앱 공통 테이블(`TRX_USER_MAS`,
`TRX_ERRMSG_COD`)용으로 그대로 남는다.

### 라우트

`GET /api/agents`(목록 — 프로필의 이름/아바타/한도를 얹어 내린다) +
`/api/tokens` · `/api/tokens/tick` · `/api/timeouts` · `/api/profile` 의 `?agent=<id>`.

**알 수 없는 id 는 400 이다** — 조용히 기본으로 폴백하면 남의 에이전트 수치를 자기 것으로 오독한다.
조회 응답은 `agentId` 를 에코한다.

### 화면

`AgentScopeProvider`(`src/components/agents/`)가 선택 상태를 쥐고 `localStorage` 에 영속한다.
상단바 `AgentSelector`(에이전트 1개면 미렌더).

- 비기본 에이전트를 고르면 `TabNav` 가 **Tokens/Timeout 만** 남기고 우측 칩은 그 에이전트의
  프로필(`/agent?agent=<id>`)로 간다
- **BIZ 계열 경로로 이동하면 기본 에이전트로 스냅백**한다 — 숨긴 화면에 남의 에이전트 컨텍스트가
  걸린 상태를 만들지 않는다. 스냅백 effect 의 deps 는 **`[pathname]` 뿐**이다
  (agentId 를 넣으면 셀렉터로 고른 직후 되돌아간다)
- **BIZ_AIACTIONTXN_HIS 기반 화면은 전부 기본 에이전트 전용**이다 — Traces / Dashboard /
  `/improvement` / `/event-fabs`. 경로 목록은 `roles.ts` 의 `isBizPath()` 단일 소스이고
  **서버에서 막는다**(각 API 의 `requireBiz()` 가 권위, 미들웨어는 UX)

### TPM/RPM 한도

`/admin` 의 "사용량 한도" 에서 편집(`AgentProfile.tpmLimit`/`rpmLimit`).
**우선순위는 프로필 > config.yml** — 프로필 값이 0(미설정)이면 `config.yml` 의 `agents[]` 값이 쓰인다.
병합 지점은 `/api/agents` 한 곳. 접속정보는 여전히 `config.yml` 전용.
