# 멀티 에이전트 TRX_TOKEN_DET 분리 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tokens / Timeout 화면이 `config.yml` 에 정의된 여러 AI 에이전트 중 하나를 골라 그 에이전트의 GAIA DB(`TRX_TOKEN_DET`)를 읽도록 하고, 비기본 에이전트에서는 BIZ 기반 화면을 감춘다.

**Architecture:** `config.yml` 에 `agents:` 섹션을 추가하고 `config.ts` 가 이를 정규화해 `AgentDef[]` 로 노출한다. `tokens.ts` / `timeouts.ts` / `tickStats.ts` 의 `getAppDbConfig()` 호출을 `getAgentDbConfig(agentId)` 로 바꾸는 것이 서버 변경의 전부이고 SQL·집계 로직은 손대지 않는다. 클라이언트는 `AgentScopeProvider`(localStorage 영속) 하나가 선택 상태를 쥐고, `TabNav`·`AgentSelector`·두 페이지가 그것을 구독한다.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5.5 strict, js-yaml, oracledb(lazy import), recharts

**Spec:** `docs/superpowers/specs/2026-08-24-multi-agent-token-scope-design.md`

## Global Constraints

- **테스트 러너가 없다.** 이 저장소에는 jest/vitest 가 없고 `npm test` 도 없다. 각 태스크의 검증은 **① `npx tsc --noEmit` ② `npm run lint` ③ `npm run build` ④ 명시된 수동/`curl` 시나리오** 로 한다. 테스트 파일을 새로 만들지 말 것 — 러너가 없어 실행되지 않는 죽은 코드가 된다.
- **`oracledb` 는 lazy import + 에러 삼킴 패턴을 유지한다.** 드라이버가 없는 머신에서도 앱이 떠야 한다. 새 DB 코드에도 같은 `getOracle()` 패턴을 쓴다.
- **SQL 값은 `:바인드` 로만 넘긴다.** 숫자여도 `${}` 문자열 보간 금지.
- **접속정보(`user` / `password` / `connectString`)는 어떤 API 응답에도 넣지 않는다.**
- **사내 배포는 `src` 복사·붙여넣기다.** 파일 삭제가 전파되지 않으므로 파일을 지우면 마지막에 목록으로 알려야 한다. 이 계획에서 삭제되는 파일은 없다.
- 주석·UI 문구는 한국어. 기존 파일의 주석 밀도와 어투를 따른다.
- 경로 별칭 `@/*` → `./src/*`.
- 에이전트 식별자 이름은 전 계층에서 통일한다: config `agents[].id`, 타입 `AgentInfo.id`, API 쿼리 `?agent=<id>`, DB 컬럼 `TRX_USER_MAS.AGENT_ID`.

---

### Task 1: config 계층 + `GET /api/agents`

에이전트 정의를 읽어 들이고, 접속정보를 뺀 목록을 클라이언트에 내려주는 지점까지 만든다. 이 태스크만으로 `curl` 로 독립 검증된다.

**Files:**
- Modify: `src/lib/types.ts` (파일 끝에 추가)
- Modify: `src/lib/config.ts`
- Create: `src/app/api/agents/route.ts`
- Modify: `config.yml`
- Modify: `config.dev.yml`

**Interfaces:**
- Produces:
  - `AgentInfo { id: string; name: string; avatar: string; isDefault: boolean; tpmLimit: number; rpmLimit: number; dbConfigured: boolean }` (`@/lib/types`)
  - `AgentsResponse { agents: AgentInfo[]; defaultId: string }` (`@/lib/types`)
  - `AgentDef { id, name, avatar, isDefault, db: LayerDbConfig | null, tpmLimit, rpmLimit }` (`@/lib/config`)
  - `listAgents(): AgentDef[]`, `getAgent(id?: string | null): AgentDef | null`, `getAgentDbConfig(id?: string | null): LayerDbConfig | null`, `defaultAgentId(): string`, `publicAgents(): AgentInfo[]` (모두 `@/lib/config`)

- [ ] **Step 1: `src/lib/types.ts` 끝에 클라이언트 안전 타입 추가**

```ts
// ─────────────────────────────────────────────────────────────────────────────
// 멀티 에이전트 — Tokens / Timeout 화면이 어느 에이전트의 TRX_TOKEN_DET 를 볼지.
//
// ⚠️ AgentInfo 는 브라우저로 내려간다. 접속정보(user/password/connectString)는
//    절대 포함하지 않는다 — 구성 여부는 dbConfigured 로만 알린다.
//    접속정보를 다루는 서버 전용 형태는 config.ts 의 AgentDef 다.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentInfo {
  /** 불변 키. URL(?agent=) · localStorage · TRX_USER_MAS.AGENT_ID 에서 이 값을 쓴다 */
  id: string;
  name: string;
  /** 아바타 이모지 (셀렉터/상단바 칩용) */
  avatar: string;
  /** 기본 에이전트인가 (= BIZ 기반 화면까지 쓰는 에이전트) */
  isDefault: boolean;
  /** 1TICK 기준선. 0 = 미설정 */
  tpmLimit: number;
  rpmLimit: number;
  /** config 에 DB 접속정보가 채워져 있는가. false 면 조회가 빈 통계로 돌아온다 */
  dbConfigured: boolean;
}

export interface AgentsResponse {
  agents: AgentInfo[];
  defaultId: string;
}
```

- [ ] **Step 2: `src/lib/config.ts` 에 agents 파싱 타입 추가**

1행의 import 를 바꾼다.
```ts
import { AgentInfo, DEFAULT_PROFILE, LayerKey } from "./types";
```

`interface RawConfig` 위에 추가한다.
```ts
/**
 * 에이전트 1개의 서버측 정의. db 는 그 에이전트의 GAIA DB(= TRX_TOKEN_DET 위치).
 * ⚠️ 접속정보를 품으므로 클라이언트로 내보내지 말 것 — publicAgents() 를 쓴다.
 */
export interface AgentDef {
  id: string;
  name: string;
  avatar: string;
  isDefault: boolean;
  db: LayerDbConfig | null;
  tpmLimit: number;
  rpmLimit: number;
}

interface RawAgent {
  id?: string;
  name?: string;
  avatar?: string;
  default?: boolean;
  db?: RawLayer;
  tpmLimit?: number | string;
  rpmLimit?: number | string;
}
```

`interface RawConfig` 에 `agents?: RawAgent[];` 를 추가하고, `interface AppConfig` 에 `agents: AgentDef[];` 와 `defaultAgentId: string;` 을 추가한다.

- [ ] **Step 3: 정규화 함수 추가**

`normalizeLayers` 바로 아래에 붙인다.

```ts
/** 접속정보 3필드가 모두 있어야 구성된 것으로 본다 (normalizeLayers 와 같은 규칙) */
function normalizeDb(v: RawLayer | undefined): LayerDbConfig | null {
  if (!v) return null;
  const { user, password, connectString } = v;
  if (!user || !password || !connectString) return null;
  return { user, password, connectString };
}

/** 한도(TPM/RPM): 0 = 미설정을 허용해야 하므로 음수/비숫자만 0 으로 떨군다 */
function normalizeLimit(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * agents 섹션 정규화.
 * ⚠️ 섹션이 아예 없거나 쓸 만한 항목이 하나도 없으면 기본 에이전트 1개를 합성한다 —
 *    사내에 이미 배포된 config.yml(agents 없음)을 고치지 않아도 지금과 똑같이 동작해야 한다.
 */
function normalizeAgents(
  raw: RawConfig | null,
  layers: Partial<Record<LayerKey, LayerDbConfig>>
): AgentDef[] {
  const src = Array.isArray(raw?.agents) ? raw!.agents! : [];
  const out: AgentDef[] = [];
  const seen = new Set<string>();

  for (const a of src) {
    if (!a || typeof a !== "object") continue;
    const id = typeof a.id === "string" ? a.id.trim() : "";
    if (!id) {
      logger.warn("agent entry skipped: id 누락", { name: a?.name ?? null });
      continue;
    }
    if (seen.has(id)) {
      logger.warn("agent entry skipped: id 중복", { id });
      continue;
    }
    seen.add(id);
    out.push({
      id,
      name: typeof a.name === "string" && a.name.trim() ? a.name.trim() : id,
      avatar: typeof a.avatar === "string" && a.avatar.trim() ? a.avatar.trim() : "🤖",
      isDefault: a.default === true,
      db: normalizeDb(a.db),
      tpmLimit: normalizeLimit(a.tpmLimit),
      rpmLimit: normalizeLimit(a.rpmLimit),
    });
  }

  if (out.length === 0) {
    // 하위호환: agents 섹션이 없는 기존 배포 → 앱 자체 DB(GAIA)를 쓰는 단일 에이전트
    out.push({
      id: "default",
      name: DEFAULT_PROFILE.name,
      avatar: DEFAULT_PROFILE.avatar,
      isDefault: true,
      db: layers[APP_DB_LAYER] ?? null,
      tpmLimit: 0,
      rpmLimit: 0,
    });
    return out;
  }

  // 기본 에이전트는 정확히 하나. default:true 가 없으면 첫 항목을 기본으로 승격한다.
  let defaultIdx = out.findIndex((a) => a.isDefault);
  if (defaultIdx < 0) defaultIdx = 0;
  out.forEach((a, i) => { a.isDefault = i === defaultIdx; });

  // 기본 에이전트가 db 를 생략하면 layers.GAIA(앱 자체 DB)를 쓴다 — 기존 설정 재사용.
  if (!out[defaultIdx].db) out[defaultIdx].db = layers[APP_DB_LAYER] ?? null;

  return out;
}
```

> ⚠️ `normalizeAgents` 는 `APP_DB_LAYER` 상수를 참조한다. `APP_DB_LAYER` 선언이 이 함수보다 아래에 있어도 `const` 는 모듈 평가 시점에 초기화되고 함수는 호출 시점(=`loadConfig()` 실행 중)에 읽으므로 문제없다.

- [ ] **Step 4: 조회 함수 추가**

`getEventFabDbConfig()` 아래에 추가한다.

```ts
// ── 멀티 에이전트 ────────────────────────────────────────────────────────
// Tokens / Timeout 화면만 에이전트별로 갈린다 (출처가 TRX_TOKEN_DET 하나).
// BIZ_AIACTIONTXN_HIS 기반 화면은 전부 기본 에이전트 전용이며 위 layers 를 쓴다.

/** config 에 정의된 에이전트 목록 (항상 1개 이상). */
export function listAgents(): AgentDef[] {
  return loadConfig().agents;
}

/** 기본 에이전트의 id. */
export function defaultAgentId(): string {
  return loadConfig().defaultAgentId;
}

/** id 로 에이전트를 찾는다. id 생략 = 기본 에이전트. 없는 id 면 null. */
export function getAgent(id?: string | null): AgentDef | null {
  const cfg = loadConfig();
  const key = id && id.trim() ? id.trim() : cfg.defaultAgentId;
  return cfg.agents.find((a) => a.id === key) ?? null;
}

/**
 * 그 에이전트의 TRX_TOKEN_DET 가 있는 DB. 없는 id/미구성이면 null →
 * 호출부(tokens/timeouts/tickStats)가 기존대로 빈 통계를 돌려준다.
 */
export function getAgentDbConfig(id?: string | null): LayerDbConfig | null {
  return getAgent(id)?.db ?? null;
}

/** 클라이언트로 내려도 안전한 형태 (접속정보 제거). */
export function publicAgents(): AgentInfo[] {
  return listAgents().map((a) => ({
    id: a.id,
    name: a.name,
    avatar: a.avatar,
    isDefault: a.isDefault,
    tpmLimit: a.tpmLimit,
    rpmLimit: a.rpmLimit,
    dbConfigured: a.db != null,
  }));
}
```

- [ ] **Step 5: `loadConfig()` 에 배선**

`loadConfig()` 의 `cached = { ... }` 부터 `logger.info("config loaded", {...});` 까지를 아래로 교체한다.

```ts
  const layers = normalizeLayers(raw);
  const agents = normalizeAgents(raw, layers);

  cached = {
    appEnv,
    layers,
    agents,
    defaultAgentId: (agents.find((a) => a.isDefault) ?? agents[0]).id,
    sourceFile,
  };
  logger.info("config loaded", {
    appEnv: cached.appEnv,
    sourceFile: cached.sourceFile,
    layers: Object.keys(cached.layers),
    agents: cached.agents.map((a) => `${a.id}${a.db ? "" : "(db미구성)"}`),
    defaultAgentId: cached.defaultAgentId,
  });
```

- [ ] **Step 6: `src/app/api/agents/route.ts` 생성**

```ts
import { NextRequest, NextResponse } from "next/server";
import { defaultAgentId, publicAgents } from "@/lib/config";
import { AgentsResponse } from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

// 에이전트 목록. Tokens/Timeout 화면의 셀렉터가 마운트 시 1회 읽는다.
// ⚠️ 접속정보는 내려가지 않는다 (publicAgents 가 dbConfigured 로만 알린다).
export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  const body: AgentsResponse = { agents: publicAgents(), defaultId: defaultAgentId() };
  logger.info("GET /api/agents", { ...ctx, count: body.agents.length });
  return NextResponse.json(body);
}
```

- [ ] **Step 7: `config.yml` 끝에 agents 섹션 추가**

```yaml

# ============================================================
# agents — Tokens / Timeout 화면이 볼 수 있는 AI 에이전트 목록
#
#   각 에이전트는 자기 GAIA DB 의 TRX_TOKEN_DET 를 갖는다.
#   BIZ_AIACTIONTXN_HIS 기반 화면(Traces/Dashboard/Report/Improvement)은
#   기본(default: true) 에이전트 전용이며 위 layers 를 그대로 쓴다.
#
#   - id       : 불변 키. ?agent=<id> / TRX_USER_MAS.AGENT_ID 에서 이 값을 쓴다
#   - default  : 기본 에이전트 1개. db 를 생략하면 layers.GAIA 를 재사용한다
#   - tpmLimit / rpmLimit : 1TICK 모니터의 기준선. 0 = 미설정(추이만 표시)
#
#   이 섹션을 통째로 지우면 layers.GAIA 를 쓰는 단일 에이전트로 동작한다(하위호환).
# ============================================================

agents:
  - id: leeoksu
    name: 이억수 TL
    avatar: "🧑‍🍳"
    default: true
    tpmLimit: 0
    rpmLimit: 0
```

- [ ] **Step 8: `config.dev.yml` 에 검증용 에이전트 3개 추가**

`config.dev.yml` 끝에 붙인다. **`agent-mirror` 의 `db` 는 `layers.GAIA` 와 동일한 값으로 채운다** — Task 4 에서 "전환해도 수치가 같아야 한다" 를 확인하는 대조군이다. (개발용 파일이므로 접속정보를 그대로 복사해 둔다.)

```yaml

agents:
  - id: leeoksu
    name: 이억수 TL
    avatar: "🧑‍🍳"
    default: true
    tpmLimit: 0
    rpmLimit: 0
  - id: agent-mirror
    name: 검증용 미러
    avatar: "🪞"
    db:
      user: ""            # ← layers.GAIA 와 동일한 값으로 채울 것
      password: ""
      connectString: ""
    tpmLimit: 100000
    rpmLimit: 30
  - id: agent-nodb
    name: 미구성 에이전트
    avatar: "🚧"
```

- [ ] **Step 9: 타입/린트 확인**

```bash
npx tsc --noEmit && npm run lint
```
Expected: 에러 없음.

- [ ] **Step 10: `/api/agents` 동작 확인**

```bash
npm run dev
```
브라우저에서 로그인한 뒤 `http://localhost:5174/api/agents` 를 연다.

Expected:
- `agents` 배열에 `leeoksu`(isDefault=true, dbConfigured=true) / `agent-mirror`(dbConfigured=true) / `agent-nodb`(dbConfigured=false) 3개
- `defaultId` 가 `"leeoksu"`
- **응답 어디에도 접속정보가 없다.** DevTools 콘솔에서 확인:
  ```js
  fetch("/api/agents").then(r => r.text()).then(t => console.log(/password|connectString|user"/.test(t) ? "❌ 유출" : "✅ 안전"))
  ```
  Expected: `✅ 안전`

- [ ] **Step 11: 하위호환 확인**

`config.dev.yml` 의 `agents:` 섹션 전체를 임시로 주석 처리하고 dev 서버를 재시작한 뒤 다시 `/api/agents` 를 연다.
Expected: `agents` 길이 1, `id="default"`, `isDefault=true`, `dbConfigured` 는 `layers.GAIA` 구성 여부와 같음. 확인 후 주석을 되돌린다.

- [ ] **Step 12: 커밋**

```bash
git add src/lib/types.ts src/lib/config.ts src/app/api/agents/route.ts config.yml config.dev.yml
git commit -m "feat(agents): config 에 agents 섹션 추가 + GET /api/agents"
```

---

### Task 2: 조회 3모듈 · API 3라우트에 agentId 배선

`getAppDbConfig()` 를 `getAgentDbConfig(agentId)` 로 바꾼다. SQL·집계 로직은 한 줄도 건드리지 않는다.

**Files:**
- Modify: `src/lib/types.ts` (`TokenFilter`, `TickFilter`, `TokenStatsResponse`, `TickStatsResponse`, `TimeoutStatsResponse`)
- Modify: `src/lib/tokens.ts` (1행, 23행 주석, 138행 부근)
- Modify: `src/lib/tickStats.ts` (1행, 28행 주석, 186행 부근)
- Modify: `src/lib/timeouts.ts` (1행, `TimeoutFilter`, 133행 부근)
- Modify: `src/app/api/tokens/route.ts`
- Modify: `src/app/api/timeouts/route.ts`
- Modify: `src/app/api/tokens/tick/route.ts`

**Interfaces:**
- Consumes: `getAgent`, `getAgentDbConfig`, `defaultAgentId` (Task 1)
- Produces: 세 라우트가 `?agent=<id>` 를 받고, 응답에 `agentId: string` 을 에코한다.

- [ ] **Step 1: 필터 타입에 `agentId` 추가**

`src/lib/types.ts` 의 `TokenFilter` 와 `TickFilter` 각각에 아래 필드를 넣는다.

```ts
  /**
   * 어느 에이전트의 TRX_TOKEN_DET 를 볼지 (config.yml agents[].id).
   * ⚠️ WHERE 절 조건이 아니라 **커넥션 선택**이다 — 에이전트는 행이 아니라 DB 단위로 갈린다.
   * 생략 = 기본 에이전트.
   */
  agentId?: string;
```

`src/lib/timeouts.ts` 의 `export interface TimeoutFilter` 에도 같은 필드를 넣는다.

`TokenStatsResponse` / `TickStatsResponse` / `TimeoutStatsResponse` 각각에 아래를 추가한다 (라우트가 채워 준다).

```ts
  /** 이 응답이 어느 에이전트를 집계한 것인지 (라우트가 에코). 늦게 도착한 응답 폐기용 */
  agentId?: string;
```

- [ ] **Step 2: 세 모듈의 커넥션 선택 교체**

`src/lib/tokens.ts`
- 1행: `import { getAppDbConfig } from "./config";` → `import { getAgentDbConfig } from "./config";`
- 138행 부근 `const cfg = getAppDbConfig();` → `const cfg = getAgentDbConfig(filter.agentId);`
- 23행 주석 `앱 자체 DB(= GAIA, config.ts APP_DB_LAYER)에서만 조회한다(BIZ 테이블처럼 fan-out 안 함).` → `filter.agentId 가 가리키는 에이전트의 GAIA DB 에서만 조회한다(BIZ 테이블처럼 fan-out 안 함).`

`src/lib/tickStats.ts`
- 1행 import 를 `getAgentDbConfig` 로 교체
- 186행 부근 `const cfg = getAppDbConfig();` → `const cfg = getAgentDbConfig(filter.agentId);`
- 28행 주석 `앱 자체 DB(= GAIA, config.ts APP_DB_LAYER)의 TRX_TOKEN_DET 만 본다.` → `filter.agentId 에이전트의 TRX_TOKEN_DET 만 본다.`

`src/lib/timeouts.ts`
- 1행 import 를 `getAgentDbConfig` 로 교체
- 133행 부근 `const cfg = getAppDbConfig();` → `const cfg = getAgentDbConfig(filter.agentId);`

⚠️ `buildWhere()` 는 **변경하지 않는다** — agentId 는 WHERE 조건이 아니다.

- [ ] **Step 3: `src/app/api/tokens/route.ts` 에 agent 검증 추가**

import 에 추가한다.
```ts
import { defaultAgentId, getAgent } from "@/lib/config";
```

`const filter: TokenFilter = {` 선언 **앞**에 넣는다.
```ts
  // ⚠️ 알 수 없는 id 는 400 이다. 조용히 기본 에이전트로 폴백하면
  //    다른 에이전트의 수치를 자기 것으로 오독하게 된다.
  const rawAgent = sp.get("agent") || undefined;
  if (rawAgent && !getAgent(rawAgent)) {
    logger.warn("GET /api/tokens unknown agent", { ...ctx, agent: rawAgent });
    return NextResponse.json({ error: `알 수 없는 에이전트: ${rawAgent}` }, { status: 400 });
  }
  const agentId = rawAgent ?? defaultAgentId();
```

`filter` 객체에 `agentId,` 를 추가하고, 성공 응답을 바꾼다.
```ts
    return NextResponse.json({ ...stats, agentId });
```

- [ ] **Step 4: `src/app/api/tokens/tick/route.ts` 에 동일 처리**

같은 import, 같은 검증 블록(로그 문구만 `GET /api/tokens/tick unknown agent`), `filter` 에 `agentId,` 추가, 응답을 `NextResponse.json({ ...stats, agentId })` 로 교체.

- [ ] **Step 5: `src/app/api/timeouts/route.ts` 에 동일 처리**

같은 import, 같은 검증 블록(로그 문구 `GET /api/timeouts unknown agent`), `filter` 에 `agentId,` 추가, 응답 에코.

- [ ] **Step 6: 타입/린트/빌드 확인**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: 에러 없음.

- [ ] **Step 7: 라우트 동작 확인**

`npm run dev` 후 브라우저에 로그인한 상태에서 주소창으로 확인한다.

| 요청 | 기대 |
|---|---|
| `/api/tokens?dateFrom=2026-08-01T00:00:00&dateTo=2026-08-24T23:59:59` | 200, `agentId:"leeoksu"` |
| 위 + `&agent=agent-mirror` | 200, `agentId:"agent-mirror"`, **totals 가 위와 동일** |
| 위 + `&agent=agent-nodb` | 200, `agentId:"agent-nodb"`, `totals.calls === 0` |
| 위 + `&agent=nope` | **400**, `{"error":"알 수 없는 에이전트: nope"}` |
| `/api/timeouts?dateFrom=...&dateTo=...&agent=nope` | **400** |
| `/api/tokens/tick?agent=nope` | **400** |

- [ ] **Step 8: 커밋**

```bash
git add src/lib/types.ts src/lib/tokens.ts src/lib/timeouts.ts src/lib/tickStats.ts src/app/api/tokens/route.ts src/app/api/tokens/tick/route.ts src/app/api/timeouts/route.ts
git commit -m "feat(agents): tokens/timeouts/tick 조회를 에이전트별 DB 로 라우팅"
```

---

### Task 3: 클라이언트 선택 상태 + 상단바 전환

**Files:**
- Create: `src/components/agents/AgentScopeProvider.tsx`
- Create: `src/components/agents/AgentSelector.tsx`
- Modify: `src/components/AppChrome.tsx`
- Modify: `src/components/TabNav.tsx`
- Modify: `src/app/globals.css` (파일 끝에 추가)

**Interfaces:**
- Consumes: `AgentInfo`, `AgentsResponse` (`@/lib/types`), `GET /api/agents` (Task 1), `apiJson`/`asArray` (`@/lib/apiClient`)
- Produces:
  - `useAgentScope(): { agents: AgentInfo[]; agentId: string; agent: AgentInfo | null; defaultId: string; isDefault: boolean; ready: boolean; setAgentId(id: string): void }`
  - `isAgentScopedPath(pathname: string | null): boolean`, `AGENT_HOME`
  - `<AgentScopeProvider>`, `<AgentSelector />`

- [ ] **Step 1: `src/components/agents/AgentScopeProvider.tsx` 생성**

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AgentInfo, AgentsResponse } from "@/lib/types";
import { apiJson, asArray } from "@/lib/apiClient";

// ─────────────────────────────────────────────────────────────────────────────
// 선택된 에이전트를 앱 전역에 공급한다.
//
// ⚠️ 에이전트별로 갈리는 화면은 TRX_TOKEN_DET 를 읽는 Tokens / Timeout 둘뿐이다.
//    나머지(Traces/Dashboard/Agent/Report/Improvement/event-fabs)는
//    BIZ_AIACTIONTXN_HIS 기반의 기본 에이전트 전용이므로, 그 경로로 이동하면
//    선택을 기본 에이전트로 되돌린다 — 숨긴 화면에 남의 에이전트 컨텍스트가
//    걸려 있는 상태를 만들지 않기 위함이다.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "tracex.agent";

/** 에이전트별로 갈리는 경로 접두사 */
const AGENT_SCOPED_PREFIXES = ["/tokens", "/timeouts"];

export function isAgentScopedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return AGENT_SCOPED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** 비기본 에이전트를 골랐을 때 보낼 기본 착지 경로 */
export const AGENT_HOME = "/tokens";

interface AgentScope {
  agents: AgentInfo[];
  agentId: string;
  agent: AgentInfo | null;
  defaultId: string;
  isDefault: boolean;
  /** /api/agents 로드가 끝났는가. 페이지는 이게 true 가 된 뒤 조회한다 */
  ready: boolean;
  setAgentId: (id: string) => void;
}

const Ctx = createContext<AgentScope>({
  agents: [],
  agentId: "",
  agent: null,
  defaultId: "",
  isDefault: true,
  ready: false,
  setAgentId: () => {},
});

export function useAgentScope(): AgentScope {
  return useContext(Ctx);
}

export function AgentScopeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [defaultId, setDefaultId] = useState("");
  const [agentId, setAgentIdState] = useState("");
  const [ready, setReady] = useState(false);

  // 스냅백 effect 가 최신 값을 보되 agentId 변경으로는 재실행되지 않게 ref 로 읽는다.
  const agentIdRef = useRef("");
  const defaultIdRef = useRef("");
  agentIdRef.current = agentId;
  defaultIdRef.current = defaultId;

  useEffect(() => {
    let alive = true;
    apiJson<AgentsResponse>("/api/agents", { cache: "no-store" })
      .then((d) => {
        if (!alive) return;
        const list = asArray<AgentInfo>(d.agents);
        const def = d.defaultId || (list[0]?.id ?? "");
        setAgents(list);
        setDefaultId(def);

        // 저장된 선택이 지금 config 에 없으면 기본으로 리셋한다.
        let saved = "";
        try { saved = window.localStorage.getItem(STORAGE_KEY) ?? ""; } catch { /* 접근 불가면 기본값 */ }
        const valid = saved && list.some((a) => a.id === saved) ? saved : def;
        // 에이전트 화면이 아니면 기본으로 시작한다.
        setAgentIdState(isAgentScopedPath(window.location.pathname) ? valid : def);
      })
      .catch(() => { /* 목록을 못 읽으면 셀렉터 없이 기본 에이전트로 동작 */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // 경로 이동 시에만 스냅백 판정한다.
  // ⚠️ deps 에 agentId 를 넣으면 셀렉터로 고른 직후(아직 /tokens 로 이동 전) 되돌려 버린다.
  useEffect(() => {
    if (!isAgentScopedPath(pathname) && defaultIdRef.current && agentIdRef.current !== defaultIdRef.current) {
      setAgentIdState(defaultIdRef.current);
    }
  }, [pathname]);

  const setAgentId = useCallback((id: string) => {
    setAgentIdState(id);
    try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* 저장 못 해도 이번 세션은 동작 */ }
    // 비기본 에이전트를 에이전트 화면 밖에서 고르면 Tokens 로 데려간다.
    if (id !== defaultIdRef.current && !isAgentScopedPath(window.location.pathname)) {
      router.push(AGENT_HOME);
    }
  }, [router]);

  const value = useMemo<AgentScope>(() => {
    const agent = agents.find((a) => a.id === agentId) ?? null;
    return {
      agents,
      agentId,
      agent,
      defaultId,
      isDefault: !agentId || agentId === defaultId,
      ready,
      setAgentId,
    };
  }, [agents, agentId, defaultId, ready, setAgentId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 2: `src/components/agents/AgentSelector.tsx` 생성**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useAgentScope } from "./AgentScopeProvider";

/**
 * 상단바 에이전트 셀렉터.
 * 에이전트가 하나뿐이면 렌더하지 않는다 — 기존 단일 에이전트 배포에서 UI 변화가 없어야 한다.
 */
export function AgentSelector() {
  const { agents, agentId, agent, setAgentId } = useAgentScope();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (agents.length < 2) return null;

  return (
    <div className="agent-switch" ref={boxRef}>
      <button
        type="button"
        className={"agent-switch-btn" + (open ? " open" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="에이전트 전환"
      >
        <span className="agent-switch-emoji" aria-hidden>{agent?.avatar ?? "🤖"}</span>
        <span className="agent-switch-name">{agent?.name ?? "에이전트"}</span>
        <span className="agent-switch-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="agent-switch-menu" role="listbox">
          {agents.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                role="option"
                aria-selected={a.id === agentId}
                className={"agent-switch-item" + (a.id === agentId ? " active" : "")}
                onClick={() => { setAgentId(a.id); setOpen(false); }}
              >
                <span className="agent-switch-emoji" aria-hidden>{a.avatar}</span>
                <span className="agent-switch-label">
                  <span className="agent-switch-name">{a.name}</span>
                  <span className="agent-switch-meta">
                    {a.isDefault ? "전체 화면" : "Tokens · Timeout"}
                    {a.dbConfigured ? "" : " · DB 미구성"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `src/components/AppChrome.tsx` 배선**

import 에 추가한다.
```tsx
import { AgentScopeProvider } from "@/components/agents/AgentScopeProvider";
import { AgentSelector } from "@/components/agents/AgentSelector";
```

`if (bare) return <>{children}</>;` 는 그대로 두고, 그 아래 `return (` 의 `<div className="app">` 전체를 `<AgentScopeProvider>` 로 감싼다.

```tsx
  return (
    <AgentScopeProvider>
      <div className="app">
        {/* ...기존 내용 그대로... */}
      </div>
    </AgentScopeProvider>
  );
```

그리고 `<div className="topbar-right">` 안, `<AgentNavChip />` **바로 앞**에 `<AgentSelector />` 를 넣는다.

- [ ] **Step 4: `src/components/TabNav.tsx` — 비기본 에이전트에서 BIZ 탭 감추기**

import 에 추가한다.
```tsx
import { useAgentScope } from "@/components/agents/AgentScopeProvider";
```

`ANALYSIS_TABS` 의 원소 타입에 `agentScoped?: boolean;` 을 추가하고 배열을 교체한다.
```tsx
  { href: "/", label: "Traces", icon: TracesIcon },
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/tokens", label: "Tokens", icon: TokensIcon, agentScoped: true },
  { href: "/timeouts", label: "Timeout", icon: TimeoutIcon, minRole: "ADMIN", agentScoped: true },
```

`TabNav()` 의 `tabs` 계산을 교체한다.
```tsx
  const { isDefault } = useAgentScope();
  // 비기본 에이전트는 BIZ_AIACTIONTXN_HIS 기반 화면을 쓰지 않는다 — 탭 자체를 감춘다.
  const tabs = ANALYSIS_TABS
    .filter((t) => isDefault || t.agentScoped)
    .filter((t) => !t.minRole || (user && roleAtLeast(user.role, t.minRole)));
```

`AgentNavChip()` 본문 첫 줄에 추가한다.
```tsx
  const { agent, isDefault } = useAgentScope();
```
`const avatarImg = ...` **앞**에 정적 칩 분기를 삽입한다.
```tsx
  // 비기본 에이전트: /agent 프로필은 기본 에이전트(BIZ 기반 FTE 포함) 전용이라 링크하지 않는다.
  if (!isDefault && agent) {
    return (
      <span className="nav-agent static" title={agent.name}>
        <span className="nav-agent-photo" aria-hidden>
          <span className="nav-agent-emoji">{agent.avatar}</span>
        </span>
        <span className="nav-agent-id">
          <span className="nav-agent-name">{agent.name}</span>
          <span className="nav-agent-status">
            <span className="nav-agent-dot" />
            <span className="nav-agent-live">근무중</span>
            <span className="nav-agent-role">AI AGENT</span>
          </span>
        </span>
      </span>
    );
  }
```

> ⚠️ 이 `if` 는 `useState`/`useEffect` 훅 **뒤에** 와야 한다 (조기 return 이 훅 순서를 깨면 안 된다). `AgentNavChip` 의 기존 `useState`/`useEffect` 블록 바로 다음에 넣을 것.

- [ ] **Step 5: `src/app/globals.css` 끝에 셀렉터 스타일 추가**

```css
/* ── 에이전트 전환 셀렉터 (상단바) ─────────────────────────────────── */
.agent-switch { position: relative; }
.agent-switch-btn {
  display: flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 9px;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--panel); color: var(--fg);
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.agent-switch-btn:hover, .agent-switch-btn.open { border-color: var(--accent); }
.agent-switch-emoji { font-size: 14px; line-height: 1; }
.agent-switch-caret { font-size: 9px; opacity: .6; }
.agent-switch-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 60;
  min-width: 220px; margin: 0; padding: 4px; list-style: none;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--panel); box-shadow: 0 10px 28px rgba(0,0,0,.18);
}
.agent-switch-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 8px; border: 0; border-radius: 7px;
  background: transparent; color: var(--fg); text-align: left; cursor: pointer;
}
.agent-switch-item:hover, .agent-switch-item.active { background: var(--hover); }
.agent-switch-label { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.agent-switch-label .agent-switch-name { font-size: 12.5px; font-weight: 600; }
.agent-switch-meta { font-size: 10.5px; opacity: .62; }
.nav-agent.static { cursor: default; }
```

> ⚠️ `--line` / `--panel` / `--fg` / `--hover` / `--accent` 가 이 저장소의 실제 토큰명과 다르면 **`globals.css` 상단 `:root` 에 정의된 이름으로 맞춰 쓴다.** 새 토큰을 만들지 말 것.

- [ ] **Step 6: 타입/린트/빌드 확인**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: 에러 없음.

- [ ] **Step 7: 브라우저 수동 확인**

`npm run dev` → 로그인 후:

1. 상단바 우측에 셀렉터가 보이고 기본값이 `이억수 TL` 이다
2. `검증용 미러` 를 고른다 → `/tokens` 로 이동하고, 탭이 **Tokens / Timeout 만** 남는다. 우측 칩이 `🪞 검증용 미러` 로 바뀌고 클릭해도 `/agent` 로 가지 않는다
3. 새로고침 → 선택이 유지된다 (localStorage)
4. 주소창에 `/dashboard` 직접 입력 → **기본 에이전트로 되돌아가고** 4개 탭이 모두 보인다
5. DevTools 콘솔에서 `localStorage.setItem("tracex.agent","없는키")` 후 새로고침 → 기본 에이전트로 리셋되고 콘솔 에러가 없다

- [ ] **Step 8: 커밋**

```bash
git add src/components/agents src/components/AppChrome.tsx src/components/TabNav.tsx src/app/globals.css
git commit -m "feat(agents): 상단바 에이전트 셀렉터 + 전역 모드 전환"
```

---

### Task 4: Tokens / Timeout 페이지 배선

**Files:**
- Modify: `src/app/tokens/page.tsx`
- Modify: `src/app/timeouts/page.tsx`

**Interfaces:**
- Consumes: `useAgentScope()` (Task 3), `?agent=` 라우트 (Task 2)

- [ ] **Step 1: `src/app/tokens/page.tsx` — 훅 연결과 쿼리 파라미터**

import 에 추가한다.
```tsx
import { useAgentScope } from "@/components/agents/AgentScopeProvider";
```
`AgentProfile` 은 더 이상 쓰지 않으므로 `@/lib/types` import 목록에서 제거한다.

`export default function TokensPage() {` 첫 줄에 추가한다.
```tsx
  const { agentId, agent, isDefault, ready } = useAgentScope();
```

`load` 콜백의 `const q = new URLSearchParams();` 다음 줄에 추가하고, `useCallback` deps 를 `[]` → `[agentId]` 로 바꾼다.
```tsx
      if (agentId) q.set("agent", agentId);
```

`loadTick` 콜백의 `const q = new URLSearchParams({ ... });` 다음 줄에 같은 줄을 추가하고, deps 를 `[userId, nodeNm, modelNm]` → `[userId, nodeNm, modelNm, agentId]` 로 바꾼다.

`fetchCalls` 의 `const query = new URLSearchParams({ traceId });` 다음 줄에 추가하고 deps 를 `[]` → `[agentId]` 로 바꾼다.
```tsx
    if (agentId) query.set("agent", agentId);
```

- [ ] **Step 2: 마운트 effect 를 에이전트 변경에도 반응하게 교체**

기존 (파일 내 1줄짜리 effect):
```tsx
  useEffect(() => { load(computeFilter()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
```
교체:
```tsx
  // 최초 조회 + 에이전트 전환 시 재조회. ready 이전에는 agentId 가 비어 있어 조회하지 않는다.
  useEffect(() => {
    if (!ready) return;
    if (preset === "1tick") loadTick(tickWin);
    else load(computeFilter());
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ready, agentId]);
```

- [ ] **Step 3: 한도 소스를 프로필 → 에이전트로 교체**

아래 상태 선언을 **삭제**한다.
```tsx
  const [limits, setLimits] = useState<{ tpm: number; rpm: number }>({ tpm: 0, rpm: 0 });
```

아래 effect **전체**를 삭제한다.
```tsx
  // TPM/RPM 한도는 프로필(/admin 편집)에서 온다. 실패해도 무해 — 한도 미설정으로 본다.
  useEffect(() => {
    let alive = true;
    apiJson<{ profile: AgentProfile }>("/api/profile", { cache: "no-store" })
      .then((d) => { ... })
      .catch(() => { /* 한도 없이도 추이는 보여준다 */ });
    return () => { alive = false; };
  }, []);
```

`<TickMonitor>` 의 두 prop 을 교체한다.
```tsx
          tpmLimit={agent?.tpmLimit ?? 0}
          rpmLimit={agent?.rpmLimit ?? 0}
```

상태 선언 부근 주석의 `/ 프로필의 TPM·RPM 한도` 를 `(한도는 config 의 agents[] 에서 온다)` 로 고친다.

- [ ] **Step 4: DB 미구성 안내 배너**

`{err && <div className="dash-banner err">불러오기 실패: {err}</div>}` 바로 아래에 추가한다.

```tsx
      {agent && !agent.dbConfigured && (
        <div className="dash-banner err">
          {agent.name} 의 DB 접속 정보가 설정되지 않았습니다 — config.yml 의 agents 항목을 확인하세요.
          (빈 화면은 &ldquo;사용량 0&rdquo; 이 아닙니다)
        </div>
      )}
```

- [ ] **Step 5: 헤더 부제에 에이전트 표시**

`<span className="dash-title-note">` 블록을 교체한다.
```tsx
            <span className="dash-title-note">
              {preset === "1tick" ? " · TPM/RPM" : " · LLM 호출 기준"}
              {!isDefault && agent ? ` · ${agent.name}` : ""}
            </span>
```

- [ ] **Step 6: `src/app/timeouts/page.tsx` 배선**

import 에 추가하고, 컴포넌트 본문 첫 줄에 훅을 넣는다.
```tsx
import { useAgentScope } from "@/components/agents/AgentScopeProvider";
```
```tsx
  const { agentId, agent, isDefault, ready } = useAgentScope();
```

61행 부근의 조회 블록에 agent 를 붙인다.
```tsx
      const q = new URLSearchParams({ dateFrom: r.from, dateTo: r.to });
      if (agentId) q.set("agent", agentId);
      if (nodeNm) q.set("nodeNm", nodeNm);
      if (modelNm) q.set("modelNm", modelNm);
```
`load` 의 `useCallback` deps 배열에 `agentId` 를 추가한다.

73행의 마운트 effect 를 교체한다.
```tsx
  useEffect(() => {
    if (!ready) return;
    load(range, node, model);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ready, agentId]);
```

- [ ] **Step 7: timeouts 페이지에도 미구성 배너 + 에이전트 표시**

이 페이지에서 로딩/에러 배너를 그리는 위치(클래스 `dash-banner` 를 쓰는 곳) 바로 아래에 넣는다.

```tsx
      {agent && !agent.dbConfigured && (
        <div className="dash-banner err">
          {agent.name} 의 DB 접속 정보가 설정되지 않았습니다 — config.yml 의 agents 항목을 확인하세요.
          (빈 화면은 &ldquo;사용량 0&rdquo; 이 아닙니다)
        </div>
      )}
```

페이지 제목 부제(`dash-title-sub` 계열)의 끝에 에이전트 이름을 덧붙인다.

```tsx
          {!isDefault && agent ? ` · ${agent.name}` : ""}
```

- [ ] **Step 8: 타입/린트/빌드 확인**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: 에러 없음. (`AgentProfile` import 를 지웠으므로 미사용 import 경고가 없어야 한다.)

- [ ] **Step 9: 핵심 검증 — 같은 DB 두 에이전트가 같은 수치인가**

`npm run dev` → Tokens 탭에서:

1. `이억수 TL` 로 30D 조회 → KPI 카드의 총 토큰 / 호출 수를 적어 둔다
2. 셀렉터로 `검증용 미러` 전환 → **재조회가 자동으로 일어나고 수치가 1번과 동일**해야 한다 (커넥션 선택 경로가 옳다는 증거)
3. `미구성 에이전트` 전환 → 빈 화면 + 미구성 배너, 콘솔 에러 없음
4. `검증용 미러` 에서 `1TICK` → 게이지에 기준선(TPM 100,000 / RPM 30)이 그려진다. `이억수 TL` 의 1TICK 은 한도 0 이라 기준선이 없다
5. Timeout 탭에서 1~3 을 반복

- [ ] **Step 10: 커밋**

```bash
git add src/app/tokens/page.tsx src/app/timeouts/page.tsx
git commit -m "feat(agents): Tokens/Timeout 화면을 선택 에이전트로 조회"
```

---

### Task 5: 프로필에서 TPM/RPM 한도 제거

한도의 단일 소스를 config 로 못 박는다. 두 곳에 같은 수치가 남으면 어느 쪽이 기준인지 읽는 사람이 헷갈린다.

**Files:**
- Modify: `src/lib/types.ts` (`AgentProfile`, `DEFAULT_PROFILE`, 804행 부근 주석)
- Modify: `src/lib/profile.ts`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: 타입에서 제거**

`src/lib/types.ts` 의 `AgentProfile` 에서 아래 블록을 삭제한다.
```ts
  /**
   * LLM 사용량 한도 — TPM(분당 토큰). Tokens 탭 1TICK 모니터의 초과 판정 기준선.
   * 0 = 미설정(기준선/초과 판정 없이 추이만 표시). ADMIN 에서 편집.
   */
  tpmLimit: number;
  /** LLM 사용량 한도 — RPM(분당 호출). 0 = 미설정. ADMIN 에서 편집 */
  rpmLimit: number;
```
`DEFAULT_PROFILE` 의 `tpmLimit: 0,` / `rpmLimit: 0,` 두 줄도 삭제한다.

804행 부근 주석 `한도(tpmLimit/rpmLimit)는 AgentProfile 에서 온다 (/admin 편집).` 을 교체한다.
```
//    한도(tpmLimit/rpmLimit)는 config.yml 의 agents[] 에서 온다 (단일 소스).
```

- [ ] **Step 2: `src/lib/profile.ts` 에서 제거**

`nonNegNum` 함수 정의와 그 위 주석 블록을 삭제한다.
```ts
  // 사용량 한도(TPM/RPM): 0 = 미설정을 허용해야 하므로 posNum 이 아닌 별도 보정.
  //   음수/비숫자는 0(미설정)으로 떨어뜨린다 — 잘못된 값이 기준선으로 그려지지 않게.
  const nonNegNum = (v: unknown, d: number): number => { ... };
```
`return { ... }` 의 아래 두 줄을 삭제한다.
```ts
    tpmLimit:          nonNegNum(r.tpmLimit, DEFAULT_PROFILE.tpmLimit),
    rpmLimit:          nonNegNum(r.rpmLimit, DEFAULT_PROFILE.rpmLimit),
```

> 기존 `data/agent-profile.json` 에 남아 있는 값은 `normalizeProfile` 이 그냥 무시한다 — 마이그레이션 불필요.

- [ ] **Step 3: `/admin` 에서 편집 UI 제거**

`src/app/admin/page.tsx` 에서 아래를 모두 삭제한다.
- 22-24행: `tpmText` / `rpmText` 상태와 그 위 주석 (`// LLM 사용량 한도(TPM/RPM) 편집용 — 0/빈칸 = 미설정`)
- 39-40행: `setTpmText(...)` / `setRpmText(...)`
- 135-147행 부근: 사용량 한도 검증 주석 + `parseLimit` 호출과 실패 분기. `parseLimit` 함수가 다른 곳에서 안 쓰이면 정의도 삭제
- 155행: 저장 payload 의 `tpmLimit, rpmLimit,`
- 245-253행 부근: `<legend>LLM 사용량 한도 (TPM / RPM)</legend>` 를 포함한 `<fieldset>` 전체

FTE 섹션 아래에 안내 한 줄을 남긴다 (주변 마크업 패턴을 따를 것 — 힌트용 클래스가 다르면 그것에 맞춘다).
```tsx
          <p className="hint">LLM 사용량 한도(TPM/RPM)는 config.yml 의 agents 항목에서 관리합니다.</p>
```

- [ ] **Step 4: 타입/린트/빌드 확인**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: 에러 없음.

잔재 확인:
```bash
grep -rn "tpmLimit\|rpmLimit" src/
```
Expected: `src/lib/config.ts`(AgentDef/normalizeLimit/publicAgents), `src/lib/types.ts`(AgentInfo), `src/components/TickMonitor.tsx`(prop), `src/components/agents/*`, `src/app/tokens/page.tsx`(prop 전달) 에만 남아 있어야 한다. `profile.ts` / `admin/page.tsx` 에는 없어야 한다.

- [ ] **Step 5: 수동 확인**

`npm run dev` → `/admin` 진입 → "LLM 사용량 한도" 섹션이 사라졌고, 프로필 저장이 정상 동작한다(이름을 한 글자 바꿔 저장 후 새로고침해 반영 확인).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/types.ts src/lib/profile.ts src/app/admin/page.tsx
git commit -m "refactor(agents): TPM/RPM 한도를 config 단일 소스로 이관"
```

---

### Task 6: 문서화

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: `CLAUDE.md` 에 멀티 에이전트 절 추가**

`### App-owned DB — GAIA's DB doubles as it (⚠️ important)` 절 **바로 앞**에 삽입한다.

```markdown
### 멀티 에이전트 — Tokens / Timeout 만 에이전트별 (⚠️ config.yml `agents:`)

이 앱은 원래 이억수 에이전트 하나를 전제로 만들어졌지만, 다른 팀 에이전트도 **Tokens / Timeout
두 화면만** 쓴다. 두 화면의 출처는 `TRX_TOKEN_DET` 하나이고 에이전트마다 GAIA DB 가 다르다.

- **정의는 `config.yml` 의 `agents:`** — `{ id, name, avatar, default, db, tpmLimit, rpmLimit }`.
  `id` 가 전 계층의 키다 (`?agent=<id>`, `localStorage["tracex.agent"]`, `TRX_USER_MAS.AGENT_ID`).
  기본 에이전트(`default: true`)가 `db` 를 생략하면 `layers.GAIA` 를 재사용한다.
  **`agents:` 섹션이 없으면 `layers.GAIA` 를 쓰는 단일 에이전트를 합성**하므로 기존 배포가 그대로 돈다.
- **로더는 `src/lib/config.ts`** — `listAgents()` / `getAgent(id)` / `getAgentDbConfig(id)` /
  `defaultAgentId()` / `publicAgents()`. ⚠️ `AgentDef` 는 접속정보를 품으므로 서버 전용이고,
  클라이언트로 내려가는 건 `publicAgents()` 가 만드는 `AgentInfo`(비밀 제거, `dbConfigured` 만) 뿐이다.
- **에이전트별로 갈리는 모듈은 셋뿐**: `tokens.ts` · `timeouts.ts` · `tickStats.ts`. 셋 다
  `getAppDbConfig()` 대신 `getAgentDbConfig(filter.agentId)` 로 커넥션을 고른다.
  ⚠️ **agentId 는 WHERE 조건이 아니라 커넥션 선택이다** — 에이전트는 행이 아니라 DB 단위로 갈린다.
  `buildWhere()` 는 손대지 않는다. `getAppDbConfig()` 는 앱 공통 테이블(`TRX_USER_MAS`,
  `TRX_ERRMSG_COD`)용으로 그대로 남는다.
- **라우트**: `GET /api/agents`(목록) + 기존 `/api/tokens`·`/api/tokens/tick`·`/api/timeouts` 의
  `?agent=<id>`. ⚠️ **알 수 없는 id 는 400 이다** — 조용히 기본으로 폴백하면 남의 에이전트 수치를
  자기 것으로 오독한다. 응답은 `agentId` 를 에코한다.
- **화면**: `AgentScopeProvider`(`src/components/agents/`)가 선택 상태를 쥐고 `localStorage` 에
  영속한다. 상단바 `AgentSelector`(에이전트 1개면 미렌더). **비기본 에이전트를 고르면 `TabNav` 가
  Tokens/Timeout 만 남기고** 우측 칩도 링크 없는 정적 칩이 된다. ⚠️ **BIZ 계열 경로로 이동하면
  기본 에이전트로 스냅백**한다 — 숨긴 화면에 남의 에이전트 컨텍스트가 걸린 상태를 만들지 않는다.
  스냅백 effect 의 deps 는 **`[pathname]` 뿐**이다(agentId 를 넣으면 셀렉터로 고른 직후 되돌아간다).
- **BIZ_AIACTIONTXN_HIS 기반 화면은 전부 기본 에이전트 전용**이다 — Traces / Dashboard / `/agent` /
  `/report` / `/improvement` / `/event-fabs`.
- **TPM/RPM 한도는 config 단일 소스**다. `AgentProfile.tpmLimit`/`rpmLimit` 과 `/admin` 의
  "사용량 한도" 섹션은 제거됐다.
```

- [ ] **Step 2: 기존 서술 정정**

`CLAUDE.md` 에서 아래 두 곳을 고친다.

1. `TRX_TOKEN_DET` 설명 문단의 `Unlike BIZ_AIACTIONTXN_HIS, this is not replicated per layer.` 뒤에 한 문장 추가:
   `단, **에이전트마다 별도 DB** 에 있다 (위 "멀티 에이전트" 참고).`
2. `1TICK` 절의 문장 `**한도(TPM/RPM)는 AgentProfile.tpmLimit/rpmLimit** — FTE 계산식 상수와 같은 패턴으로 /admin 에서 편집하고 프로필 JSON 에 저장된다.` 와 그 뒤의 `normalizeProfile` 관련 문장(`0 = 미설정이라 normalizeProfile 은 여기만 posNum 이 아닌 nonNegNum 으로 보정한다…`)을 아래 한 문단으로 교체:
   `**한도(TPM/RPM)는 config.yml 의 agents[].tpmLimit/rpmLimit** 이다. **0 = 미설정**이며 config.ts 의 normalizeLimit 이 음수/비숫자를 0 으로 떨군다. 미설정이면 기준선·초과 판정 없이 추이만 그린다.`

- [ ] **Step 3: 최종 확인**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs: 멀티 에이전트 구조 문서화"
```

---

### Task 7: [2단계] 계정↔에이전트 결속 (`TRX_USER_MAS.AGENT_ID`)

Task 1~6 을 실제로 돌려 본 뒤에 착수한다. 여기까지는 로그인한 사용자 누구나 셀렉터에서 아무 에이전트나 고를 수 있다.

**Files:**
- Create: `sql/alter_trx_user_mas_agent_id.sql`
- Modify: `src/lib/users.ts`
- Modify: `src/lib/auth/session.ts`
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `src/app/api/agents/route.ts`
- Modify: `src/app/api/tokens/route.ts`, `src/app/api/tokens/tick/route.ts`, `src/app/api/timeouts/route.ts`
- Modify: `src/components/auth/AuthProvider.tsx` (`SessionUser`)
- Modify: `src/app/accounts/page.tsx`

**Interfaces:**
- Consumes: `listAgents()`, `getAgent()`, `publicAgents()` (Task 1)
- Produces: `UserAccount.agentId: string | null`, `SessionPayload.agentId?: string`

- [ ] **Step 1: `sql/alter_trx_user_mas_agent_id.sql` 작성**

기존 `sql/create_trx_user_mas.sql` 의 헤더 주석·권한 섹션 형식을 그대로 따른다.

```sql
-- ============================================================
-- TRX_USER_MAS 에 AGENT_ID 추가 — 계정이 볼 수 있는 에이전트
--
--   앱 자체 DB(= GAIA, config.ts APP_DB_LAYER)에서 1회 실행.
--   ADM 계정(IDMSADM2) 소유로 실행한다.
--
--   NULL   = 전 에이전트 접근 (기존 계정 · 운영자)
--   값 있음 = config.yml agents[].id 중 그 에이전트만
--
--   ⚠️ 앱은 컬럼이 없어도 동작한다(users.ts 가 존재를 탐지). ALTER 와 배포 순서는 자유.
-- ============================================================

ALTER TABLE TRX_USER_MAS ADD (AGENT_ID VARCHAR2(50));

COMMENT ON COLUMN TRX_USER_MAS.AGENT_ID IS '접근 가능 에이전트 id (NULL=전체)';
```

- [ ] **Step 2: `users.ts` 에 컬럼 미존재 내성 추가**

`tokens.ts` 의 `hasStatus` 패턴을 그대로 쓴다. `SELECT_COLS`(118행) 아래에 추가한다.

```ts
// AGENT_ID 컬럼 존재 탐지 — ALTER 전에도 앱이 동작해야 한다
// (tokens.ts 의 hasStatus 와 같은 패턴: 1=0 으로 컬럼만 확인).
let agentColCached: boolean | null = null;
async function hasAgentCol(conn: import("oracledb").Connection): Promise<boolean> {
  if (agentColCached !== null) return agentColCached;
  try {
    await conn.execute(`SELECT AGENT_ID FROM TRX_USER_MAS WHERE 1=0`);
    agentColCached = true;
  } catch {
    agentColCached = false;
  }
  return agentColCached;
}

/** 컬럼이 없으면 상수 NULL 로 대체해 SELECT 목록을 만든다 */
function selectCols(hasAgent: boolean): string {
  return `${SELECT_COLS}, ${hasAgent ? "AGENT_ID" : "CAST(NULL AS VARCHAR2(50)) AS AGENT_ID"}`;
}
```

- `UserAccount` 에 `agentId: string | null;` 추가
- `CreateUserInput` / `UpdateUserInput` 에 `agentId?: string | null;` 추가
- 행 매핑 함수에 `agentId: (row.AGENT_ID as string | null) ?? null` 추가
- `listUsers` / `getUser` / `verifyLogin` / `createUser`·`updateUser` 직후 재조회의
  `SELECT ${SELECT_COLS}` 를 `SELECT ${selectCols(await hasAgentCol(conn))}` 로 교체
  (`verifyLogin` 은 `SELECT ${SELECT_COLS}, PWD_HASH, PWD_SALT` → `SELECT ${selectCols(...)}, PWD_HASH, PWD_SALT`)
- INSERT / UPDATE 는 `await hasAgentCol(conn)` 이 true 일 때만 `AGENT_ID` 컬럼과 `:agentId` 바인드를
  포함하도록 분기한다 (컬럼이 없으면 조용히 무시). ⚠️ 값은 반드시 `:agentId` 바인드로 넘긴다

- [ ] **Step 3: 세션에 agentId 싣기**

`src/lib/auth/session.ts`
- `SessionPayload` 에 `agentId?: string;` 추가
- 토큰 생성부의 `const payload: SessionPayload = { sub, name, role, exp }` 에 `agentId: input.agentId` 추가 (입력 타입에도 optional 필드 추가)
- 검증부의 반환에 파싱을 추가:
```ts
  const agentId = typeof parsed.agentId === "string" && parsed.agentId ? parsed.agentId : undefined;
  return { sub, name, role, agentId, exp };
```

`src/app/api/auth/login/route.ts` — 토큰 생성 호출에 `agentId: account.agentId ?? undefined` 를 넘긴다.

- [ ] **Step 4: `/api/agents` 를 세션 범위로 필터**

`src/app/api/agents/route.ts` 를 교체한다.

```ts
import { NextRequest, NextResponse } from "next/server";
import { defaultAgentId, publicAgents } from "@/lib/config";
import { AgentsResponse } from "@/lib/types";
import { getSessionFromRequest } from "@/lib/auth/session";
import { logger, reqContext } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = reqContext(req);
  const session = await getSessionFromRequest(req);
  const all = publicAgents();
  // 세션이 특정 에이전트에 묶여 있으면 그것만. 묶임 없음(NULL/운영자) = 전체.
  const scoped = session?.agentId ? all.filter((a) => a.id === session.agentId) : all;
  const body: AgentsResponse = {
    agents: scoped,
    defaultId: scoped.some((a) => a.isDefault) ? defaultAgentId() : (scoped[0]?.id ?? defaultAgentId()),
  };
  logger.info("GET /api/agents", { ...ctx, count: body.agents.length, scoped: session?.agentId ?? null });
  return NextResponse.json(body);
}
```

> ⚠️ `getSessionFromRequest` 의 실제 export 이름은 `src/lib/auth/session.ts` 에서 확인해 맞출 것 (`readSession` 등 다른 이름일 수 있다). `src/lib/auth/current.ts` 에 이미 세션을 읽는 헬퍼가 있으면 그것을 재사용한다.

- [ ] **Step 5: 조회 3라우트에 범위 검사 추가**

세 파일의 agent 검증 블록(Task 2 Step 3~5) **바로 뒤**에 동일하게 넣는다.

```ts
  // 세션이 특정 에이전트에 묶여 있으면 그 밖의 요청은 403.
  const session = await getSessionFromRequest(req);
  if (session?.agentId && agentId !== session.agentId) {
    logger.warn("agent scope violation", { ...ctx, want: agentId, allowed: session.agentId });
    return NextResponse.json({ error: "이 에이전트에 접근할 권한이 없습니다." }, { status: 403 });
  }
```

- [ ] **Step 6: `/accounts` 화면에 에이전트 선택 추가**

`src/components/auth/AuthProvider.tsx` 의 `SessionUser` 에 `agentId?: string | null;` 추가.

`src/app/accounts/page.tsx`:
- `Account` 타입에 `agentId: string | null` 추가
- 마운트 시 `apiJson<AgentsResponse>("/api/agents", { cache: "no-store" })` 로 목록을 받아 셀렉트 옵션 구성
- 등록/수정 폼에 `<select>` 추가 — 첫 옵션 `전체 (제한 없음)` = 값 `""`, 저장 시 `null` 로 변환
- 목록 표에 "에이전트" 열 추가. `null` 은 `전체` 로 표기
- **권한 가드**: 기존의 "BR 은 ADMIN 을 다룰 수 없다" 패턴을 따라 `agentId` 변경은 **ADMIN 만** 허용한다 (BR 이 자기 범위를 넓히지 못하게). BR 로 로그인하면 셀렉트를 `disabled` 로 렌더하고, API 쪽에서도 BR 요청의 `agentId` 변경을 무시한다

- [ ] **Step 7: 타입/린트/빌드 확인**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: 에러 없음.

- [ ] **Step 8: ALTER 전 동작 확인 (컬럼 미존재 내성)**

ALTER 를 **실행하지 않은** 상태로 `npm run dev` → 로그인, `/accounts` 목록 조회, 계정 생성/수정.
Expected: 모두 정상 동작하고 에이전트 열은 전부 `전체` 로 보인다. 서버 로그에 ORA-00904 가 한 번 남더라도 앱이 죽지 않는다.

- [ ] **Step 9: ALTER 후 동작 확인**

앱 자체 DB(GAIA)에서 `sql/alter_trx_user_mas_agent_id.sql` 실행 → dev 서버 재시작.

1. 테스트 계정을 만들고 에이전트를 `검증용 미러` 로 지정
2. 그 계정으로 로그인 → 셀렉터에 `검증용 미러` 하나만 보인다 (`agents.length < 2` 라 셀렉터 자체가 안 보일 수 있다 — 정상)
3. 주소창으로 `/api/tokens?dateFrom=...&dateTo=...&agent=leeoksu` 직접 호출 → **403**
4. 운영자 계정(에이전트 `전체`)으로 로그인 → 셀렉터에 전부 보이고 전환이 정상

- [ ] **Step 10: 커밋**

```bash
git add sql/alter_trx_user_mas_agent_id.sql src/lib/users.ts src/lib/auth/session.ts src/app/api/auth/login/route.ts src/app/api/agents/route.ts src/app/api/tokens/route.ts src/app/api/tokens/tick/route.ts src/app/api/timeouts/route.ts src/components/auth/AuthProvider.tsx src/app/accounts/page.tsx
git commit -m "feat(agents): 계정별 에이전트 결속 (TRX_USER_MAS.AGENT_ID)"
```

- [ ] **Step 11: `CLAUDE.md` 의 인증 절 갱신**

"인증/인가" 절의 `TRX_USER_MAS` 컬럼 목록에 `AGENT_ID` 를 추가하고 한 줄을 붙인다.
```
- **계정↔에이전트 결속**: `TRX_USER_MAS.AGENT_ID` (NULL = 전 에이전트). 세션 payload 에 실려
  `/api/agents` 목록 필터와 조회 3라우트의 403 판정에 쓰인다. ⚠️ `users.ts` 가 **컬럼 존재를 탐지**하므로
  ALTER 전에도 동작한다(전원 NULL 취급). 변경 권한은 ADMIN 만.
```

```bash
git add CLAUDE.md && git commit -m "docs: 계정별 에이전트 결속 문서화"
```

---

## 배포 노트 (사내)

- **삭제되는 파일 없음.** `src` 복사·붙여넣기 배포로 충분하다.
- **`config.yml` 에 `agents:` 섹션을 추가해야** 다중 에이전트가 동작한다. 추가하지 않으면 기존과 동일하게 단일 에이전트로 동작한다(무해).
- **`config.dev.yml` 의 `agents:` 는 개발 검증용**이다. `deploy.sh` 가 prd 배포에서 이 파일을 지우므로 운영에는 영향이 없다.
- Task 7 은 **DB ALTER 를 동반**한다. 앱은 컬럼 없이도 동작하므로 ALTER 와 배포 순서는 자유다.
