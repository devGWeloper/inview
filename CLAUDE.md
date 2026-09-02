# CLAUDE.md

TraceX — AI Action 트랜잭션 추적 뷰어. Next.js 14 (App Router) · React 18 · TypeScript strict.

## 명령어

| | |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 빌드 결과 서빙 |
| `npm run lint` | `next lint` — ⚠️ ESLint 미설정 상태라 실행하면 설정 프롬프트가 뜬다 |
| `npx tsc --noEmit` | 타입 체크 |

테스트 러너는 없다. 검증은 `npx tsc --noEmit` → `npm run build`.

## 큰 그림

요청은 `CUBE → GAIA → MCP → ONEOIS` 4계층을 지나고, 각 계층이 **자기 Oracle DB** 에 같은 스키마의
`BIZ_AIACTIONTXN_HIS` 를 복제해 기록한다. 앱은 계층별로 병렬 조회해 `TRACE_ID` 로 조인하고 하나의
트레이스를 재구성한다. 여기에 GAIA 의 LLM 호출 상세(`TRX_TOKEN_DET`)와 앱 전용 테이블
(계정·에러코드·조치정보)이 얹힌다.

**GAIA 의 DB 가 앱 자체 DB 를 겸한다** (전용 DB 를 할당받지 못해서). 매핑은
`src/lib/config.ts` 의 `APP_DB_LAYER` 한 곳.

경로 alias: `@/*` → `./src/*`

---

## 화면 지도

수정 요청이 오면 **해당 문서 하나만 읽고 시작**한다. 문서 첫머리에 그 화면이 쓰는 파일 목록이 있다.

| 화면 | 경로 | 문서 |
|---|---|---|
| Traces (트레이스 목록·상세) | `/` | [docs/screens/traces.md](docs/screens/traces.md) |
| Dashboard | `/dashboard` | [docs/screens/dashboard.md](docs/screens/dashboard.md) |
| Tokens | `/tokens` | [docs/screens/tokens.md](docs/screens/tokens.md) |
| Timeout | `/timeouts` | [docs/screens/timeouts.md](docs/screens/timeouts.md) |
| 실적 (일반 사용자용) | `/insights` | [docs/screens/insights.md](docs/screens/insights.md) |
| Improvement Center | `/improvement` | [docs/screens/improvement.md](docs/screens/improvement.md) |
| 이벤트-FAB 매핑 | `/event-fabs` | [docs/screens/event-fabs.md](docs/screens/event-fabs.md) |
| Action 오픈 로드맵 | `/roadmap` | [docs/screens/roadmap.md](docs/screens/roadmap.md) |
| Agent 프로필 · 관리 | `/agent` `/admin` | [docs/screens/agent-profile.md](docs/screens/agent-profile.md) |
| 계정 · 로그인 | `/accounts` `/login` | [docs/screens/accounts.md](docs/screens/accounts.md) |
| 공사장 | `/wip` | [docs/screens/wip.md](docs/screens/wip.md) |
| 차트 단위(집계 ┊ 틱) *(3화면 공용)* | — | [docs/screens/tick.md](docs/screens/tick.md) |

## 구조 문서

| 주제 | 문서 |
|---|---|
| 데이터 흐름 · 스키마 · 조회 규칙 · Oracle | [docs/architecture/data-flow.md](docs/architecture/data-flow.md) |
| 인증 · 권한 · 에이전트 범위 | [docs/architecture/auth.md](docs/architecture/auth.md) |
| 멀티 에이전트 · 앱 자체 DB · 설정 | [docs/architecture/agents.md](docs/architecture/agents.md) |
| 지표 정의 (지연 2종 · FTE · 일별) | [docs/architecture/metrics.md](docs/architecture/metrics.md) |
| 클라이언트 공통 규칙 | [docs/architecture/ui-conventions.md](docs/architecture/ui-conventions.md) |
| 임시 조치 (제거 예정) | [docs/architecture/temp-workarounds.md](docs/architecture/temp-workarounds.md) |

---

## 디렉터리

```
src/
  app/                라우트만. page.tsx 는 얇게 유지하고 화면 컴포넌트는 features/ 로
    api/              라우트 핸들러 — 파싱 + 인가 + 응답 모양. 집계 로직은 lib/ 에
  features/<화면>/    그 화면 전용 컴포넌트
  components/         2개 이상 화면이 쓰는 것만
    shell/ auth/ agents/ tick/ charts/ ui/
  lib/                서버 집계 · 순수 로직 · 타입
    types/            도메인별 타입. index.ts 배럴로 re-export
  styles/             화면별 CSS. globals.css 가 @import 순서를 정한다
```

**컴포넌트를 어디 둘지**: 쓰는 화면이 1개면 `features/<화면>/`, 2개 이상이면 `components/`.

---

## 전역 불변 규칙

이것만 여기 둔다. 나머지는 위 문서에 있다.

1. **레이어 정의의 단일 소스는 `src/lib/types/layers.ts` 의 `LAYERS` 배열.**
   레이어 추가/삭제/순서변경 = 이 배열 + `config.yml`/`config.dev.yml`. 다른 곳을 고치지 말 것.
2. **SQL 값은 `:바인드` 로만.** 숫자여도 `${}` 보간 금지. INTERVAL 은 `NUMTODSINTERVAL` 바인드.
3. **클라이언트에서 `/api/*` 는 `apiJson()`/`apiFetch()`(`src/lib/apiClient.ts`)로만 부른다.**
   원시 `fetch` + `res.json()` 은 세션 만료 401 을 데이터로 둔갑시킨다.
4. **추이 차트의 recharts `Brush` 에는 `key={data.length + ":" + (data[0]?.tick ?? "")}` 를 단다.**
   없으면 기간을 바꿔도 예전 표시 구간이 남는다.
5. **`oracledb` 는 `await import()` 로 lazy 하고 실패를 삼켜 `null` 을 반환한다.**
   드라이버 없는 머신에서도 앱이 떠야 한다. DB 코드를 건드릴 때 이 패턴을 유지할 것.
6. **목록 조회는 2단계다** — 자르는 단위가 행이 아니라 트레이스여야 한다
   ([data-flow.md](docs/architecture/data-flow.md)).
7. **집계 규칙을 두 벌로 만들지 말 것.** `/api/stats` 와 `/api/insights` 는 같은
   `computeStats()`(`src/lib/stats.ts`)를 쓰고 응답 모양만 다르다.
8. **`src/lib/roles.ts` 는 Node 전용 모듈(fs/crypto/oracledb)을 import 하지 않는다.**
   Edge 미들웨어가 import 한다.

---

## 주석 정책

이 프로젝트는 한때 설계 의도·과거 시도·피드백을 전부 코드 주석에 적어 넣어 주석이 코드보다 많아졌다.
지금은 **배경 지식이 `docs/` 에 있다.**

**남기는 것**
- `// TEMP(...)` 마커 — 임시 코드의 위치 표시
  ([temp-workarounds.md](docs/architecture/temp-workarounds.md) 와 짝)
- 코드만 봐선 틀리게 고치기 쉬운 한 줄 경고
- `eslint-disable` / `@ts-` 같은 지시자

**쓰지 않는 것**
- 배너 주석(`// ─────`), 섹션 구분 주석
- 결정의 역사, 되돌린 시도, 사용자 피드백 인용
- 코드를 그대로 다시 말하는 설명
- 여러 줄짜리 설계 설명 → 해당 `docs/` 문서에 쓴다

## 문서 정책

- **`CLAUDE.md` 는 인덱스다.** 매 세션 자동 로드되므로 여기에 상세를 쓰면 모든 대화가 비싸진다.
  새 내용은 해당 `docs/` 문서에 쓰고, 여기엔 화면 지도에 줄만 추가한다.
- 화면 문서는 **파일 목록 → 규칙** 순. "왜 이렇게 했나" 는 되돌리면 안 되는 이유일 때만 적는다.
- 이미 지나간 논의(무엇을 시도했다 물렀다)는 적지 않는다.
