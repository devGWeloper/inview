# INVIEW

**AI Action Transaction Trace Integrated Viewer**

AI 액션 호출이 `CUBE → GAIA → MCP → ONEOIS → LEGACY` 5개 레이어를 거쳐 흐를 때, 각 레이어가 자기 Oracle DB의 `BIZ_AIACTIONTXN_HIS` 테이블에 남기는 이력을 `TRACE_ID` 기준으로 합쳐 한 화면에서 보여주는 단일 페이지 뷰어.

---

## 무엇을 하는 앱인가

- 5개 레이어 DB에 **병렬로 동시 조회**하여 한 트랜잭션의 전 구간을 재구성한다.
- 좌측 패널: TRACE 목록 (필터 = TRACE_ID / USER_ID / 기간 / 오류만).
- 우측 패널: 선택한 TRACE의 레이어별 타임라인.
  - 단일 호출 레이어 → `recv | send | resp` 3컬럼 카드.
  - 다중 호출 레이어 (예: GAIA 가 MCP 를 두 번 호출) → 상단에 upstream `recv` 1회, 그 아래 `Call #1`, `Call #2` … 각각 `send | resp`.

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
| **OK** (초록) | 5개 레이어 모두 행이 있고 + 모든 행의 `SEND_COMPLT_YN='Y'` + 오류 없음 | 5단 전 구간 왕복 완료 |
| **PARTIAL** (노랑) | OK 도 ERROR 도 아닌 모든 경우 | **불완전 상태** — 아래 케이스 중 하나 |
| **ERROR** (빨강) | 어떤 행이든 `ERR_CD` 가 채워져 있음 | 레이어 어디선가 오류 발생 |

### PARTIAL 이 뜨는 대표적 상황

1. **호출이 중간 레이어까지만 도달** — 예: CUBE → GAIA 까지만 흐르고 MCP/ONEOIS/LEGACY 행이 아예 없음 (`layerCount < 5`).
2. **응답을 아직 못 받음** — 행은 전부 있지만 일부 행의 `SEND_COMPLT_YN='N'` (= 보냈는데 응답 미수신, 진행 중 또는 hang).
3. **5개 레이어 DB 중 일부만 연결됨** — 연결 안 된 레이어의 데이터는 가져올 수 없으니 자연스럽게 `layerCount` 가 5 미만이 되어 PARTIAL 로 보임. 상단 `CONNECTED · N LAYERS` 뱃지로 확인.

> 즉 PARTIAL 은 "비정상" 이 아니라 **"OK 라고 단정할 만큼의 정보가 모이지 않은 상태"** 다. 실시간 진행 중인 트랜잭션도, 중간에 끊긴 트랜잭션도 모두 PARTIAL 로 묶인다.

## 환경 변수

`.env.example` 참조. 핵심:

- `APP_ENV=dev|prd` — 어느 prefix 변수를 읽을지 (`DEV_*` vs `PRD_*`).
- 레이어별 3개씩 × 5레이어 = 15개의 DB 변수 (`{ENV}_{LAYER}_DB_USER` / `_PASSWORD` / `_CONNECT_STRING`).
- `USE_MOCK=true` 또는 **어느 레이어도 DB 설정이 완비되지 않은 경우** → mock 모드 (`src/lib/mock.ts`).
- 일부 레이어만 설정해도 동작한다. 설정된 레이어만 조회하고, 나머지는 빈 결과로 처리.

## 실행

```bash
npm install
npm run dev      # http://localhost:5174
npm run build && npm run start
npm run lint
```

Oracle 네이티브 드라이버(`oracledb`)는 lazy import 로 로드되며 실패하면 자동으로 mock 으로 폴백한다 — Instant Client 없는 머신에서도 앱은 뜬다.

## 스택

- Next.js 14 (App Router) · React 18 · TypeScript strict
- `oracledb` 6.x (서버 컴포넌트 외부 패키지로 지정)
- 별도 테스트 러너 없음

## 디렉터리

```
src/
  app/
    page.tsx                 # 단일 페이지 (목록 + 상세)
    api/traces/route.ts      # GET /api/traces
    api/traces/[traceId]/    # GET /api/traces/:id
  components/TraceTimeline.tsx
  lib/
    db.ts                    # 5레이어 병렬 조회 + 환경별 config
    types.ts                 # LAYER_ORDER, TraceRow, TraceSummary …
    mock.ts                  # 5 single + 1 multi-call 시나리오
sql/                         # DDL + 3-phase DML 템플릿
```
