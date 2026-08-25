# 멀티 에이전트 지원 — TRX_TOKEN_DET 화면의 에이전트별 분리

- 작성일: 2026-08-24
- 상태: 설계 승인됨 (구현 대기)

## 배경 / 문제

TraceX 는 이억수 에이전트 하나를 전제로 만들어졌다. `config.yml` 의 `layers.GAIA` 한 개가
BIZ 조회 레이어이자 앱 자체 DB(`APP_DB_LAYER`)를 겸하고, `tokens.ts` / `timeouts.ts` /
`tickStats.ts` 세 모듈이 모두 `getAppDbConfig()` 를 직접 불러 그 DB 의 `TRX_TOKEN_DET` 를 읽는다.

이제 다른 팀의 AI 에이전트도 이 앱을 쓴다. 다만 이들은 **Traces / Dashboard 를 쓰지 않는다** —
그 화면들은 `BIZ_AIACTIONTXN_HIS` 를 CUBE→GAIA→MCP→ONEOIS 로 fan-out 하는 이억수 특화 구조이고,
다른 에이전트에는 그런 레이어 체인이 없다. 이들이 필요한 것은 **LLM 토큰 사용량(Tokens 탭)과
타임아웃 추적(Timeout 탭)** 뿐이며, 두 화면의 데이터 출처는 `TRX_TOKEN_DET` 하나다.

에이전트마다 GAIA DB 가 물리적으로 다르므로, 접속 정보도 에이전트별로 관리해야 한다.

## 범위

### 에이전트별로 분리되는 것

`TRX_TOKEN_DET` 를 읽는 모듈만이다.

| 모듈 | 테이블 | 판정 |
|---|---|---|
| `src/lib/tokens.ts` | `TRX_TOKEN_DET` | **에이전트별** |
| `src/lib/timeouts.ts` | `TRX_TOKEN_DET` | **에이전트별** |
| `src/lib/tickStats.ts` | `TRX_TOKEN_DET` | **에이전트별** |
| `src/lib/errorCodes.ts` | `TRX_ERRMSG_COD` | 이억수 전용 (BIZ 에러코드 마스터) — 변경 없음 |
| `src/lib/users.ts` | `TRX_USER_MAS` | 앱 공통 로그인 계정 — DB 는 분리하지 않음 |
| `src/lib/requestFailures.ts` | BIZ + `TRX_REQ_FAILURE_INF` | Improvement Center — 제외 |
| `src/lib/eventFabs.ts` | `TRX_EVENT_MAP` (MCP DB) | 이억수 전용 — 제외 |
| `src/lib/db.ts` | `BIZ_AIACTIONTXN_HIS` | 이억수 전용 — 제외 |

### 이억수 전용으로 남는 화면

`/` (Traces), `/dashboard`, `/agent`, `/report`, `/improvement`, `/event-fabs`.
모두 BIZ 를 읽거나 이억수의 업무 정의에 묶여 있다.

### 명시적 비목표

- BIZ 계열 화면의 멀티 에이전트화
- 에이전트별 프로필 카드(스킬/tasks/FTE) — FTE 는 BIZ 집계라 이억수에만 의미가 있다
- 에이전트 목록을 화면에서 편집하는 CRUD (config 파일 편집으로 충분)

## 설계

### 1. Config — `config.yml` 에 `agents:` 추가

```yaml
layers:            # 기존 그대로. 이억수 BIZ fan-out + 앱 공통 테이블(계정/에러코드)
  CUBE: { user: "", password: "", connectString: "" }
  GAIA: { user: "", password: "", connectString: "" }
  MCP:  { user: "", password: "", connectString: "" }
  ONEOIS: { user: "", password: "", connectString: "" }

agents:
  - id: leeoksu            # 불변 키. URL/저장/DB(AGENT_ID)에서 이 값을 쓴다
    name: 이억수
    avatar: "🧑‍🍳"
    default: true          # db 생략 → layers.GAIA 재사용
    tpmLimit: 0            # 0 = 미설정 (1TICK 이 기준선 없이 추이만 그림)
    rpmLimit: 0
  - id: agent-b
    name: 〇〇 에이전트
    avatar: "🤖"
    db:
      user: ""
      password: ""
      connectString: ""
    tpmLimit: 0
    rpmLimit: 0
```

`AgentInfo`(클라이언트 안전 형태)와 필터의 `agentId` 는 `src/lib/types.ts` 에, 접속정보를 다루는 `AgentDef` 와 로더는 `src/lib/config.ts` 에 둔다 (`roles.ts` 처럼 클라이언트가 import 하는 타입은 server-only 모듈과 분리).

`src/lib/config.ts` 에 추가:

- `AgentDef` — `{ id, name, avatar, isDefault, db: LayerDbConfig | null, tpmLimit, rpmLimit }` (서버 전용)
- `listAgents(): AgentDef[]`
- `getAgentDbConfig(id?: string): LayerDbConfig | null`
- `getAgent(id?: string): AgentDef | null`
- `DEFAULT_AGENT_ID` — `default: true` 인 첫 항목, 없으면 목록의 첫 항목
- `publicAgents(): AgentInfo[]` — 비밀정보를 제거한 클라이언트 안전 형태

**하위호환**: `agents:` 섹션이 없으면 `layers.GAIA` 를 db 로 갖는 기본 에이전트 1개를
합성한다(`id: "default"`, `name` 은 프로필 이름). 사내에 이미 배포된 `config.yml` 을
고치지 않아도 지금과 동일하게 동작한다.

**정규화 규칙** (`normalizeAgents`):

- `id` 가 없거나 빈 문자열인 항목은 버린다
- `id` 중복은 첫 항목만 남긴다
- `db` 의 세 필드 중 하나라도 비면 `db = null` (= 미구성). `layers` 정규화와 같은 규칙
- `default: true` 이고 `db` 가 없으면 `layers.GAIA` 로 폴백
- `tpmLimit`/`rpmLimit` 은 음수/비숫자를 0 으로 (기존 `normalizeProfile` 의 `nonNegNum` 규칙)

`getAppDbConfig()` / `APP_DB_LAYER` 는 그대로 둔다 — 계정(`TRX_USER_MAS`)과
에러코드(`TRX_ERRMSG_COD`)는 앱 공통이므로 계속 기본 GAIA 를 쓴다.

### 2. 조회 계층

`TokenFilter` / `TimeoutFilter` / `TickFilter` 에 `agentId?: string` 추가.
세 모듈의 `getAppDbConfig()` 호출을 `getAgentDbConfig(filter.agentId)` 로 교체한다.
그 외 SQL·집계 로직은 건드리지 않는다.

`tickStats.ts` 는 `tokens.ts` 의 `buildWhere()` 를 재사용하는데, `agentId` 는 WHERE 절이
아니라 **커넥션 선택**이므로 `buildWhere` 는 변경 없다 (에이전트 구분은 행이 아니라 DB 단위).

미구성 에이전트는 기존 lazy-`oracledb`-swallow 패턴 그대로 빈 통계를 돌려준다.

### 3. API

**신규 `GET /api/agents`**

```ts
// AgentInfo — 클라이언트로 내려가는 형태. 접속정보는 절대 포함하지 않는다.
{ agents: [{ id, name, avatar, isDefault, tpmLimit, rpmLimit, dbConfigured }] , defaultId }
```

`user`/`password`/`connectString` 은 **어떤 경우에도 응답에 넣지 않는다**. `dbConfigured`
(boolean) 로만 구성 여부를 알린다.

**기존 3개 라우트**에 `?agent=<id>` 파라미터 추가:

- `/api/tokens`, `/api/tokens/tick`, `/api/timeouts`
- 미지정 = `DEFAULT_AGENT_ID` (하위호환)
- **정의되지 않은 id 는 400** `{ error: "알 수 없는 에이전트: <id>" }`.
  조용히 기본으로 폴백하면 다른 에이전트의 수치를 자기 것으로 오독하게 된다.
- 응답에 `agentId` 를 에코해 클라이언트가 늦게 도착한 응답을 버릴 수 있게 한다

### 4. UI — 전역 모드 전환

**`src/components/agents/AgentScopeProvider.tsx`** (신규, client)

- `/api/agents` 를 마운트 시 1회 로드
- 선택 상태를 `localStorage["tracex.agent"]` 에 영속
- `useAgentScope()` → `{ agents, agentId, agent, setAgentId, isDefault, loading }`
- 저장된 id 가 현재 config 에 없으면 기본 에이전트로 리셋
- **BIZ 계열 경로에서는 항상 기본 에이전트로 스냅백**한다. 숨긴 화면에 다른 에이전트
  컨텍스트가 걸린 상태를 만들지 않기 위함.

`AGENT_SCOPED_PREFIXES = ["/tokens", "/timeouts"]` — 이 목록에 없는 경로 = 기본 고정.

**`src/components/AgentSelector.tsx`** (신규) — 상단바 드롭다운.
에이전트가 1개뿐이면 렌더하지 않는다(기존 배포에서 UI 변화 없음).
비기본 에이전트를 고를 때 현재 경로가 에이전트 화면이 아니면 `/tokens` 로 이동한다.

**`src/components/TabNav.tsx`**

- 비기본 에이전트 선택 시 `Tokens` / `Timeout` 탭만 노출 (`agentScoped: true` 플래그로 표시)
- `AgentNavChip`: 기본 에이전트면 지금처럼 `/api/profile` 기반 칩 + `/agent` 링크,
  비기본이면 링크 없이 그 에이전트의 `name`/`avatar` 만 표시

**`src/components/AppChrome.tsx`** — `AgentScopeProvider` 로 감싸고 상단바에 `AgentSelector` 배치.

**`src/app/tokens/page.tsx` / `src/app/timeouts/page.tsx`**

- 모든 `/api/tokens*`·`/api/timeouts` 호출에 `agent=<id>` 를 붙인다
- `agentId` 를 재조회 트리거(effect 의존성)에 넣는다
- 1TICK 한도는 `/api/profile` 대신 `useAgentScope().agent` 의 `tpmLimit`/`rpmLimit` 사용
  (`tokens/page.tsx` 의 프로필 fetch 제거)
- 선택 에이전트의 `dbConfigured === false` 면 "이 에이전트는 DB 가 설정되지 않았습니다"
  안내를 띄운다 — 빈 표가 "사용량 0" 으로 오독되지 않게

### 5. 프로필에서 한도 제거

한도의 단일 소스를 config 로 정한다.

- `AgentProfile.tpmLimit` / `rpmLimit` 필드 제거 (`types.ts`, `DEFAULT_PROFILE`, `profile.ts`)
- `/admin` 의 "사용량 한도" 섹션 제거
- 기존 `data/agent-profile.json` 에 남은 값은 `normalizeProfile` 이 무시한다 (무해)

### 6. 계정↔에이전트 결속 (2단계)

1단계는 로그인한 사용자 누구나 셀렉터에서 아무 에이전트나 고를 수 있다.
운영에 올리려면 계정이 자기 에이전트만 보게 묶어야 한다.

- `TRX_USER_MAS` 에 **`AGENT_ID VARCHAR2(50)`** 추가 (nullable)
  - `NULL` = 전 에이전트 접근 (기존 계정 · 운영자)
  - 값 있음 = 그 에이전트만
- `sql/migrations/2026-08-24_add_user_agent_id.sql` (ADM 계정 실행)
- `users.ts` 의 `SELECT_COLS`/`UserAccount`/`CreateUserInput`/INSERT/UPDATE 에 반영.
  **컬럼 미존재 내성**을 `fetchTokenStats` 의 `hasStatus` 패턴으로 넣어, ALTER 전에도
  앱이 정상 동작하게 한다 (ALTER · 배포 순서 자유)
- 세션 payload 에 `agentId` 를 실어 미들웨어/`requireRole` 이 참조
- `/api/agents` 는 세션의 `agentId` 로 목록을 걸러 내린다. `/api/tokens*`·`/api/timeouts`
  는 요청한 `agent` 가 세션 범위 밖이면 **403**
- `/accounts` 화면의 계정 등록/수정 폼에 에이전트 선택 추가 (ADMIN·BR)

**왜 나중인가**: 1단계는 그것 없이 완결되고, 1단계를 실제로 돌려봐야 어떤 제약이
필요한지가 정확해진다. 또 `AGENT_ID` 는 DB 마이그레이션을 동반하므로 앱 변경과
분리하는 편이 배포가 안전하다.

## 에러 처리

| 상황 | 동작 |
|---|---|
| `agents:` 섹션 없음 | 기본 에이전트 1개 합성 → 지금과 동일 동작 |
| `agents` 항목의 `id` 누락/중복 | 해당 항목 버림 + 경고 로그 |
| 에이전트 `db` 미구성 | `dbConfigured=false`, 조회는 빈 통계, 화면이 안내 |
| 알 수 없는 `?agent=` | 400 (조용한 폴백 금지) |
| `localStorage` 의 id 가 config 에 없음 | 기본 에이전트로 리셋 |
| `/api/agents` 로드 실패 | 셀렉터 미노출 + 기본 에이전트로 동작 |

## 검증

테스트 러너가 없으므로:

1. `npm run lint` · `npm run build` 통과
2. `config.dev.yml` 에 **같은 DB 를 가리키는 에이전트 2개**를 두고 전환 — 두 에이전트의
   Tokens/Timeout/1TICK 수치가 동일해야 한다 (커넥션 선택 경로가 옳다는 증거)
3. 한쪽 에이전트의 `db` 를 비우고 전환 — 빈 화면 + 미구성 안내, 에러 없음
4. `agents:` 섹션을 지우고 기동 — 기존과 동일 동작 (하위호환)
5. `?agent=없는키` 직접 호출 — 400 + 화면에 사유 노출
6. 비기본 에이전트 선택 상태에서 `/dashboard` 진입 — 기본 에이전트로 스냅백

## 사내 배포 주의

배포가 `src` 복사·붙여넣기이므로 **파일 삭제가 전파되지 않는다.** 이번 작업에서
삭제되는 파일은 없으나, `config.yml` 에 `agents:` 섹션을 추가해야 다중 에이전트가
동작한다 (추가하지 않으면 기존과 동일하게 단일 에이전트로 동작).
