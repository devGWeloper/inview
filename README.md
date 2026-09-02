# TraceX

**AI Action Transaction Trace Integrated Viewer**

AI 액션 호출이 `CUBE → GAIA → MCP → ONEOIS` 레이어를 거쳐 흐를 때, 각 레이어가 자기 Oracle DB의 `BIZ_AIACTIONTXN_HIS` 테이블에 남기는 이력을 `TRACE_ID` 기준으로 합쳐 한 화면에서 보여주는 단일 페이지 뷰어.

> 레이어 구성은 `src/lib/types/layers.ts` 의 `LAYERS` 배열 한 곳에서만 정의된다. 레이어 추가/삭제/순서·라벨·색상 변경은 이 배열만 수정하면 화면, API, 스텝퍼, 색상이 모두 자동으로 따라간다 (+ `config.yml` / `config.dev.yml` 에 동일 key 로 접속 정보 추가).

---

## 무엇을 하는 앱인가

- 모든 레이어 DB에 **병렬로 동시 조회**하여 한 트랜잭션의 전 구간을 재구성한다.
- 좌측 패널: **묶음(현장 작업 1건) 목록** (필터 = TRACE_ID / USER_ID / 기간 / 오류만).
  - TRACE 1건짜리 묶음(대부분)은 지금까지의 TRACE 행 그대로.
  - 여러 건이면 요약 행 하나로 접히고, 클릭하면 안의 TRACE 가 펼쳐진다. → [묶음 규칙](#묶음--여러-요청을-작업-1건으로-temp)
- 우측 패널: 선택한 TRACE의 레이어별 타임라인.
  - 단일 호출 레이어 → `recv | send | resp` 3컬럼 카드.
  - 다중 호출 레이어 (예: GAIA 가 MCP 를 두 번 호출) → 상단에 upstream `recv` 1회, 그 아래 `Call #1`, `Call #2` … 각각 `send | resp`.

## 묶음 — 여러 요청을 작업 1건으로 [TEMP]

현장 업무는 `전값 측정 → (SEA) → 후값 측정 → ERMAP 요청` 처럼 여러 단계인데 GAIA 는
**요청 1건 = TRACE_ID 1개**로 기록한다. 그래서 한 작업이 목록에서 남남으로 흩어져 보인다.
`src/lib/workGroup.ts` 가 GAIA 행을 훑어 이걸 하나로 묶는다.

**묶는 규칙**

| | |
|---|---|
| 묶는 키 | 챔버 ID. `SEND_MSG_CTN` JSON 에서 읽는다 — `AutoQual_PrePost` → `CHAMB_RAW_ID`, `ERMAP` → `EQP_ID` |
| 윈도우 | **직전 요청으로부터 8시간**(교대 1번). 요청이 붙을 때마다 갱신되므로 전값→후값 7h, 후값→ERMAP 다시 7h 면 한 묶음 |
| 순서 | `전값 → 후값 → ERMAP`(`FLOW_ORDER`)로 고정. **뒤로만 갈 수 있다** |
| 중복·역행 | 같은 단계 반복(전값 뒤 전값)이나 되돌아가는 요청(후값 뒤 전값)은 **다음 작업의 시작**으로 보고 새 묶음을 연다 |
| 건너뛰기 | 허용. `전값 → ERMAP`, `후값 → ERMAP`, `전값 → 후값` 모두 한 묶음 — 3개를 다 갖출 필요 없다 |
| 묶음 ID | 그 묶음의 **첫 TRACE_ID**. 별도 발번 없음 |

**묶이는 액션은 `FLOW_ORDER` 에 있는 셋뿐이다.** `NEST_Seasoning`(시즈닝) / `AutoQual_Abort` /
`AutoQual_JobCreate` 는 흐름에 없어 전부 단독(1건짜리 묶음)으로 떨어진다.
흐름이 바뀌면 `FLOW_ORDER` 배열에 자리를 끼워 넣는다.
`ERMAP` 은 DSP 가 쏜 것과 사람이 큐브에서 요청한 것의 `ACTION_TYP` 이 같아 구분되지 않는다.

**미완결 묶음도 정상이다.** 전값만 재고 그만둔 작업은 1건짜리 묶음으로 그대로 남는다.
"덜 끝난 상태"는 데이터가 없는 게 아니라 STATUS 뱃지로 표시된다.

**알려진 구멍** — 챔버 값은 MCP 로 인계한 파라미터(`SEND_MSG_CTN`)에서 읽으므로,
필수값 누락 같은 **검증 실패로 MCP 까지 못 간 요청은 묶음 밖에 단독으로 남는다.** 의도된 동작이다.

**왜 [TEMP] 인가** — GAIA 에 시나리오 메이커가 들어오면 실행 1건마다 진짜 식별자(`TXN_ID`)가
생긴다. 그때 `workGroup.ts` 의 **추론부만** "GAIA 행의 `TXN_ID` 읽기" 로 교체되고,
타입(`WorkSummary`)·API·화면은 그대로 남는다. 윈도우 값(8시간)은 같은 파일의
`WORK_WINDOW_HOURS` 상수 — 임시 로직이라 설정 파일로 빼지 않았다.

## 레이어와 행(row) 모델

각 레이어는 **하위 시스템에 대한 1회 왕복(round-trip)당 1행**을 자기 DB에 남긴다. PK 는 `(TRACE_ID, TIMEKEY)` 라서 한 레이어에 여러 행이 존재할 수 있다 (= 다중 호출).

3-phase 기록 패턴:

| 단계 | 시점 | 갱신 컬럼 |
|---|---|---|
| 1. INSERT | upstream 에서 메시지 수신 | `RECV_*`, `SEND_COMPLT_YN='N'` |
| 2. UPDATE | downstream 으로 forward | `SEND_SYS_ID`, `SEND_MSG_CTN`, `SEND_TM` |
| 3. UPDATE | downstream 으로부터 응답 수신 | `RESP_MSG_CTN`, `RESP_TM`, `SEND_COMPLT_YN='Y'` |

`SEND_COMPLT_YN='Y'` 는 **응답까지 받았을 때만** 켜진다. 따라서 `SEND_TM` 은 있는데 `SEND_COMPLT_YN='N'` 이면 *"보냈고 응답 대기 중"* 상태.

## STATUS 뱃지 — OK / PARTIAL / ERROR

목록에서 한 TRACE 의 상태를 다음 규칙으로 판정한다 (`src/app/api/traces/route.ts:summarize`).

| 뱃지 | 조건 | 의미 |
|---|---|---|
| **OK** (초록) | 정의된 모든 레이어에 행이 있고 + 모든 행의 `SEND_COMPLT_YN='Y'` + 오류 없음 | 전 구간 왕복 완료 |
| **PARTIAL** (노랑) | OK 도 ERROR 도 아닌 모든 경우 | **불완전 상태** — 아래 케이스 중 하나 |
| **ERROR** (빨강) | 어떤 행이든 `ERR_CD` 가 채워져 있음 | 레이어 어디선가 오류 발생 |

(여기서 "정의된 모든 레이어" = `LAYERS.length`, 즉 `src/lib/types/layers.ts` 의 `LAYERS` 배열 길이)

### PARTIAL 이 뜨는 대표적 상황

1. **호출이 중간 레이어까지만 도달** — 예: CUBE → GAIA 까지만 흐르고 그 뒤 레이어 행이 아예 없음 (`layerCount < LAYERS.length`).
2. **응답을 아직 못 받음** — 행은 전부 있지만 일부 행의 `SEND_COMPLT_YN='N'` (= 보냈는데 응답 미수신, 진행 중 또는 hang).
3. **레이어 DB 중 일부만 연결됨** — 연결 안 된 레이어의 데이터는 가져올 수 없으니 자연스럽게 `layerCount` 가 모자라 PARTIAL 로 보임. 상단 `CONNECTED · N LAYERS` 뱃지로 확인.

> 즉 PARTIAL 은 "비정상" 이 아니라 **"OK 라고 단정할 만큼의 정보가 모이지 않은 상태"** 다. 실시간 진행 중인 트랜잭션도, 중간에 끊긴 트랜잭션도 모두 PARTIAL 로 묶인다.

## 설정 파일

설정은 프로젝트 루트의 YAML 파일로 관리합니다 (`src/lib/config.ts`).

| 파일 | 환경 |
|---|---|
| `config.dev.yml` | dev / local — 존재하면 우선 사용 |
| `config.yml` | prd — `config.dev.yml` 이 없을 때 사용 |

스키마:

```yaml
layers:
  CUBE:    { user: "...", password: "...", connectString: "host:1521/SVC" }
  GAIA:    { user: "...", password: "...", connectString: "..." }
  MCP:     { user: "...", password: "...", connectString: "..." }
  ONEOIS:  { user: "...", password: "...", connectString: "..." }
```

키는 `src/lib/types/layers.ts` 의 `LAYERS[*].key` 와 동일해야 한다. 새 레이어를 추가하려면 `LAYERS` 배열에 한 줄 추가하고 yml 에도 같은 key 로 접속 정보를 추가하면 된다.

- 일부 레이어만 설정해도 동작한다. 설정된 레이어만 조회하고, 나머지는 빈 결과로 처리.
- 두 yml 파일은 리포에 함께 커밋된다. prd 배포 시 `deploy.sh` 가 `config.dev.yml` 을 제거하여 `config.yml` 만 남도록 처리한다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5174
npm run build && npm run start
npm run lint      # ⚠️ ESLint 미설정 — 실행하면 설정 프롬프트가 뜬다
```

Oracle 네이티브 드라이버(`oracledb`)는 lazy import 로 로드되며, 실패하면 해당 레이어 조회는 빈 결과를 반환한다 — Instant Client 없는 머신에서도 앱은 뜬다.

## 스택

- Next.js 14 (App Router) · React 18 · TypeScript strict
- `oracledb` 6.x (서버 컴포넌트 외부 패키지로 지정)
- 별도 테스트 러너 없음

## 디렉터리

```
src/
  app/                라우트만. page.tsx 는 얇게 유지한다
    api/              라우트 핸들러 — 파싱 + 인가 + 응답 모양
  features/<화면>/    그 화면 전용 컴포넌트
  components/         2개 이상 화면이 쓰는 것만 (shell · auth · agents · tick · charts · ui)
  lib/                서버 집계 · 순수 로직
    types/            도메인별 타입 (layers.ts 가 LAYERS 단일 소스)
  styles/             화면별 CSS. app/globals.css 가 @import 순서를 정한다
docs/                 화면별 · 주제별 상세 문서 (CLAUDE.md 가 인덱스)
sql/                  DDL + 3-phase DML 템플릿
```

화면 단위 작업의 출발점은 `CLAUDE.md` 의 **화면 지도** 다 — 해당 `docs/screens/*.md` 하나에
그 화면이 쓰는 파일 목록과 규칙이 모여 있다.
