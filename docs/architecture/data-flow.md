# 데이터 흐름 · 스키마

## 레이어

요청 경로는 `CUBE → GAIA → MCP → ONEOIS`. 각 레이어가 **자기 Oracle DB** 에 같은 스키마의
`BIZ_AIACTIONTXN_HIS` 를 복제해 갖고 있고, 앱은 `TRACE_ID` 로 조인해 하나의 트레이스를 재구성한다.

**단일 소스는 `src/lib/types/layers.ts` 의 `LAYERS` 배열.** `LayerKey`·`LAYER_ORDER`·`LAYER_LABEL`·
`LAYER_COLOR`·스테퍼·`/N` 분모·태그 색이 전부 여기서 파생된다.
레이어 추가/삭제/순서변경 = 이 배열 + `config.yml`/`config.dev.yml` 의 블록.

## 조회 경로

```
브라우저 → /api/traces          목록 (works 단위)
         → /api/traces/[id]    상세 (레이어별 원본 행)
              ↓
         src/lib/db.ts  — LAYER_ORDER 를 Promise.all 로 레이어별 1쿼리 병렬
```

### 목록 조회는 반드시 2단계

자르는 단위가 **행이 아니라 트레이스**여야 한다.

1. `fetchRecentTraceIds(filter)` — 레이어별 `GROUP BY TRACE_ID` 로 최근 TRACE_ID 합집합 상위 N 확정
2. `fetchAllRows({ traceIds })` — **행 필터 없이** 그 트레이스의 전 레이어 행을 통째로 읽음

레이어별로 `FETCH FIRST N` 을 걸어 합치면 커버 시간대가 레이어마다 달라져(라우팅 실패는 MCP 미도달,
GAIA 는 멀티콜) 목록 아래쪽이 한 레이어짜리 트레이스로 채워진다. 같은 이유로 행 단위 필터
(`errCd`/`onlyError`/기간)를 2단계에 걸면 안 된다 — 에러 조건은 route 의 `keepErrorMatchingTraces()`
가 트레이스 단위로 판정한다. FAC/ACTION_TYP/USER_ID 는 `fetchTraceIdsBy()` 가 1단계를 맡는다.

### 그 밖의 조회 규칙

- Oracle `ORDER BY <ts> DESC` 의 기본은 NULLS FIRST — RECV_TM 이 빈 멀티콜 2번째 행이 상한을 먼저 먹는다.
  행수 상한이 붙는 정렬에는 **`DESC NULLS LAST`** 를 명시한다.
- 목록 상한은 트레이스 건수 기준 기본 500(`DEFAULT_LIMIT`), `db.ts` 가 500 으로 clamp.
  2단계가 `TRACE_ID IN (...)` 이라 Oracle IN 목록 상한(1000)에 여유를 둔 값. 늘리려면
  `fetchAllRows` 가 traceIds 를 나눠 조회하도록 먼저 고칠 것.
- 목록은 `lean: true` — 본문(`RECV_MSG_CTN`/`SEND_MSG_CTN`)을 뺀다(`SUMMARY_COLUMNS`).
  `RESP_MSG_CTN` 은 남긴다(TEMP 상태 판정이 CUBE 응답 문구를 본다).
  **lean 행의 `recvMsgCtn`/`sendMsgCtn` 은 항상 null** 이므로 본문이 필요한 상세에는 lean 을 쓰지 않는다.

## 행 생명주기 — 3단계 쓰기

각 레이어는 호출 1사이클당 1행을 기록한다 (`sql/`).

| 단계 | 파일 | 시점 | 기록 |
|---|---|---|---|
| 1 | `dml_insert_recv.sql` | 상위에서 수신 | INSERT, `RECV_*`, `SEND_COMPLT_YN='N'` |
| 2 | `dml_update_send.sql` | 하위로 전달 | `SEND_SYS_ID`/`SEND_MSG_CTN`/`SEND_TM`, `FAC_ID`·`AREA_ID`(MCP만) |
| 3 | `dml_update_resp.sql` | 하위 응답 수신 | `RESP_MSG_CTN`/`RESP_TM`/`HTTP_STS_CD`, `SEND_COMPLT_YN='Y'` |

`SEND_COMPLT_YN='Y'` 는 3단계에서만 세팅된다 → `'N'` + `SEND_TM` 있음 = "보내고 응답 대기중".

## 주요 컬럼 (`BIZ_AIACTIONTXN_HIS`)

PK 는 `(TRACE_ID, TIMEKEY)` — **레이어당 여러 행이 가능**하다(GAIA 가 MCP 를 2번 호출 등).
멀티콜일 때 `RECV_MSG_CTN` 은 첫 행에만 있다.

- `RECV_*` 상위에서 받은 요청 / `SEND_*` 하위로 보낸 요청 / `RESP_*` 하위에서 받은 응답
- `HTTP_STS_CD` — 하위 응답의 HTTP 상태. 3단계에 행 단위로 전 레이어가 기록
- `FAC_ID` / `AREA_ID` — 같은 개념. 컬럼은 전 레이어에 있으나 **MCP 만 2단계에서 기록**,
  나머지는 null. 대시보드 `byFac`/`byArea` 의 소스
- `CHANNEL_ID` / `ACTION_TYP` — 최상위 레이어가 INSERT 시 기록. `CHANNEL_ID` 는 선택만 하고 집계 안 함
- `SEND_COMPLT_YN` — 응답까지 받아야 `'Y'`

### `ACTION_TYP` 없음 = 라우팅 실패

BIZ 에 쌓이는 트레이스는 전부 액션 요청이다(setup_guide/judge 같은 비액션 흐름은 `TRX_TOKEN_DET`
에만 남는다). 따라서 `ACTION_TYP` 이 비었다 = ACTION ROUTER 에서 실제 ACTION 노드로 못 간 것.
이런 트레이스는 반드시 `errCd` 를 동반하므로 status 는 이미 fail 이다.

`stats/route.ts` 의 액션 타입별 집계는 이 키를 `(none)` 대신 `ROUTING_FAIL_LABEL`("라우팅 실패")로
표기한다. **표기 전용 라벨이라 실제 `ACTION_TYP` 값이 아니므로** `DimensionBreakdown` 에서
필터 클릭 대상에서 제외한다(흐리게 하지는 않는다 — 의미 있는 실패 항목).
FAC/AREA 의 `(none)`(=MCP 미도달)과는 무관하다.

## 상세 화면의 멀티콜 처리

`TraceTimeline` 이 행을 레이어별로 묶는다.
- 1행: `SingleCallCard` — recv | send | resp 3열
- 2행 이상: `MultiCallCard` — 첫 행의 recv 를 위에 한 번, 그 아래 `Call #N` 마다 send | resp

## Oracle 통합

- `oracledb` 는 `next.config.mjs` 의 `experimental.serverComponentsExternalPackages` — 번들 금지
- import 는 `getOracle()` 안에서 `await import("oracledb")` 로 lazy 하고 **에러를 삼켜 `null` 반환**.
  드라이버 없는 머신에서도 앱이 뜨게 하기 위함이며, DB 코드를 건드릴 때 이 패턴을 유지할 것
- 타임스탬프는 `TO_CHAR(..., 'YYYY-MM-DD"T"HH24:MI:SS.FF3')` 로 ISO 유사 문자열로 받는다
- WHERE 절은 `TraceFilter` 에서 **바인드 변수**로 조립한다. 값 보간(`${}`) 금지
