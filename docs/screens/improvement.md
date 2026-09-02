# Improvement Center — `/improvement`

**TraceX > Improvement Center > Request Failure Tracker.**
Improvement Center 는 AI 에이전트 개선 허브(확장 가능한 플랫폼 셸)이고 Request Failure Tracker 는
그 첫 모듈이다.

**파일**
- 셸: `src/app/improvement/page.tsx` (`MODULES` 배열 — `{ key, name, tagline, icon, Component }`
  한 줄 추가하면 좌측 레일에 붙는다. `PLANNED` 는 로드맵 표시용, 클릭 불가)
- 모듈: `src/features/improvement/RequestFailureTracker.tsx` (`rft-*`, 셸은 `ic-*`)
- API: `src/app/api/request-failures/route.ts` ·
  `src/app/api/request-failures/[traceId]/context/route.ts`
- 집계: `src/lib/requestFailures.ts`
- 스타일: `src/styles/improvement.css`
- 권한: **목록/컨텍스트 조회 = DEV, 조치 저장(PUT) = ADMIN** (`requireBiz("ADMIN")`).
  진입은 `/admin` 헤더 또는 유저 메뉴

## 실패 요청의 정의

```sql
ACTION_TYP IS NULL AND RECV_MSG_CTN IS NOT NULL ORDER BY TIMEKEY DESC
```

메시지는 받았는데 `ACTION_TYP` 을 못 붙인 요청 = **라우팅 실패이거나 LLM 오류로 튕긴 요청**.

`ACTION_TYP` 권위 레이어가 **GAIA** 라 이 판정은 GAIA DB 에서 한다. GAIA 는 앱 자체 DB
(`APP_DB_LAYER`)이기도 해서 실패 요청 조회와 조치정보 저장이 같은 DB·같은 커넥션(`getAppDbConfig`)이다.

## 조치정보 — `TRX_REQ_FAILURE_INF` (앱 자체 DB=GAIA)

`sql/create_trx_req_failure_inf.sql`, ADM 소유 + GRANT + PUBLIC SYNONYM.

`TRACE_ID`(PK) / `STATUS`(open/investigating/resolved/ignored = `FAILURE_STATUSES`) /
`NOTE_CTN` / `HANDLER_ID` / 감사일시.

실패 요청 원본은 BIZ 에 있고 이 테이블은 **조치 오버레이**다(TRACE_ID 로 LEFT JOIN, JS 병합).
행 없는 요청 = `open`(미조치).

실패행 조회와 조치행 조회는 **격리 실행** — `TRX_REQ_FAILURE_INF` 미생성(ORA-00942)이어도 리스트는
정상 노출되고 `triageAvailable=false` 로 저장만 막는다.
저장은 `TRACE_ID` 기준 **MERGE upsert**(autoCommit).

**담당자(`HANDLER_ID`)** 는 PUT 에서 명시하지 않으면 로그인 세션의 사번으로 자동 기록된다
(`guard.session.sub` 폴백). 화면에서 수동 지정도 가능.

## 사용자 대화 흐름 — `fetchRequestFailureContext`

선택한 실패 요청의 `USER_ID`·수신시각을 찾고, 같은 사용자가 **±12h** 낸 요청을 TRACE_ID 단위
(GROUP BY)로 묶어 시간순으로 내린다. `ACTION_TYP` 없는 요청은 `isFailure` 로 표시한다 —
"무엇을 시도하다 어디서 튕겼나" 를 관리자가 읽게 한다.

화면은 **채팅 로그**다: 턴마다 Q(우측 말풍선) → A(좌측 말풍선)를 시간순으로 쌓고, 문제의 그 요청만
"이 요청" 배지 + 액센트 링으로 집어준다.

**레이어별 JSON 전문(`TraceTimeline`)은 여기 쓰지 않는다** — 이 화면은 비즈니스 관점(무엇을 묻고
무엇을 받았나)이고 envelope 디버깅은 Traces 화면의 일이다.

말풍선은 `pre-wrap` + `overflow-wrap:anywhere` 로 접혀 좁은 분할 패널에서도 밀리지 않는다
(고정 다단·`@container` 레이아웃을 두지 않는 이유 — `@container` 는 `.panel-body` 밖에서 발동하지 않는다).

## 사용자 관점 Q/A 는 CUBE 에서 본다 — 단, 최종 응답 문장 컬럼은 없다

사용자는 **CUBE 와만 대화**하므로 사용자 관점 데이터는 CUBE(= 진입 레이어) 행에서 찾는다.

- **Q = `CUBE.SEND_MSG_CTN`** (사용자 질문)
- **A**: `CUBE.RESP_MSG_CTN` 은 레이어 간 JSON 전문이고, **CUBE BotServer 가 사용자에게 실제로
  렌더해 내보내는 문장을 저장하는 컬럼은 존재하지 않는다.** 그래서 A 는 그 JSON 에서 문장을 긁어내는
  **best-effort**(`humanText()`)이며 "사용자가 본 그 문장" 이라고 보장할 수 없다.
  추출 실패 시 화면은 비우고 안내한다

진짜 A 가 필요하면 BotServer 가 렌더 결과를 적재하는 컬럼(예: `ANSWER_CTN`)이 새로 있어야 한다.
하위 레이어(GAIA/MCP/ONEOIS)의 `RESP_MSG_CTN` 은 다운스트림 툴 응답이라 A 후보조차 아니다.

구현 지점은 `requestFailures.ts` 의 `USER_IF_LAYER`(= `LAYER_ORDER[0]`)와 `attachUserFacingQa()`.
CUBE 는 앱 자체 DB(GAIA)와 다른 DB 라 커넥션을 따로 열어 `TRACE_ID` 로 JS 조인한다.
CUBE 미구성/조회 실패 시 Q 는 `TRX_TOKEN_DET.QUERY_CTN` → `RECV_MSG_CTN` 순으로 폴백하고
A 는 비워 안내한다(무해).

## 화면 구성

상단 KPI(미조치/조치중/조치완료/영향 사용자/기간 내 실패 수) + 기간 프리셋(24h/7d/30d/전체, 서버
`dateFrom`) + 좌(상태칩 필터·검색 리스트) / 우(원본 요청·응답·조치 세그먼트+메모+담당자·사용자
대화 흐름) 스플릿.

상태칩/검색은 클라이언트 필터, 조치 저장 시 로컬 카운트 재계산. 에러코드 의미는
`/api/error-codes` 재사용.

`canEdit`(ADMIN)이 false 면 조치 세그먼트·메모·담당자·저장이 잠기고 "열람 전용" 배지가 뜬다
(권위는 서버 PUT).
