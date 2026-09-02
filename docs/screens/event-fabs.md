# 이벤트-FAB 매핑 — `/event-fabs`

**DB 가 MCP DB 다 — 앱 자체 DB 가 아니다.**

**파일**
- 화면: `src/app/event-fabs/page.tsx` (`fm-*`)
- API: `src/app/api/event-fabs/route.ts`
- 집계: `src/lib/eventFabs.ts`
- 스타일: `src/styles/event-fabs.css`
- 권한: **조회 = BR, 저장(PUT) = ADMIN** (`requireBiz("ADMIN")`). 진입은 `/admin` 헤더

## 왜 있나

하이닉스는 기능(이벤트)을 FAB 별로 선별 적용한다(예: AutoQual 실행은 M14/M15 만).
이벤트별 허용 FAB 을 이 앱에서 편집하면 MCP DB 의 `TRX_EVENT_MAP` 에 저장되고, MCP 로직이 요청 FAB 이
허용 목록에 없으면 팅겨낸다.

## DB 위치

앱 자체 DB(GAIA)가 **아니라 MCP DB** — MCP 가 판정 시 직접 읽어야 해서다.
매핑은 `config.ts` 의 `EVENT_FAB_DB_LAYER`(= `"MCP"`) / `getEventFabDbConfig()` 한 곳
(`APP_DB_LAYER` 와 같은 패턴).

## 테이블 — `TRX_EVENT_MAP`

`sql/create_trx_event_map.sql`, **MCP DB 에서만 1회 실행**.

`MAP_ID` IDENTITY PK / `EVENT_ID`(= `ACTION_TYP` 값) / `FAB_ID` + `UNIQUE(EVENT_ID, FAB_ID)` /
`USE_YN` / 감사일시. 이벤트 1 × 허용 FAB 1 = 1행.

DDL 은 ADM 계정(IDMSADM2) 소유로 실행하고 앱/MCP 계정(IDMSAPP2)은 GRANT + PUBLIC SYNONYM 으로 참조한다.
**DDL 파일 하단에 MCP 팀용 Python 체크 메서드 예시**(`is_fab_allowed(cursor, event_id, fab_id)`)가
블록 주석으로 들어 있다.

**판정 규칙**: `USE_YN='Y'` 행의 FAB 집합 = 허용.
매핑 미등록 이벤트는 MCP 정책(Python 예시의 `allow_when_unregistered`, 기본 전 FAB 허용).

## FAB 목록

`FAB_IDS` = C2/M10/M11/M14/M15/M16/Y17 (매트릭스 고정 컬럼 — FAB 이 늘면 여기 추가).
DB 에 수동 삽입된 미지 FAB 은 컬럼으로 동적 추가돼 저장 시 유실되지 않는다.

## 읽기/쓰기

읽기는 lazy-oracledb-swallow 패턴으로 미구성/미생성 시 `available=false + reason` 을 내려 화면이
안내하고 저장을 막는다.

**저장은 전량 교체**(DELETE 후 INSERT, 한 트랜잭션, 실패 시 rollback + throw) — 앱이 이 테이블의
마스터다. FAB 0개 행은 "미등록" 과 구분이 안 돼 저장을 거부한다(행 삭제를 강제).

## 화면 — 권한 매트릭스 콘솔

컴팩트 툴바(작은 타이틀 + 이벤트 검색 + `+ 이벤트` / 저장) 아래 이벤트(행) × FAB(열) 매트릭스.
스티키 헤더 + 패널 내부 스크롤이라 이벤트 100개 스케일을 전제한다.

- 셀 = 토글 도트(켜면 액센트 채움 + 체크 팝)
- **열 헤더 클릭 = 보이는 행 대상 열 일괄 토글**
- 행 액션(행 전체 토글/삭제)은 hover 시에만 노출
- 이벤트명은 borderless 인라인 입력(`/api/action-types` datalist)
- 저장 버튼은 **dirty(스냅샷 비교) 일 때만 활성** + 흰 점 표시
- FAB 0개 행은 "팹 없음" 배지
- 안내문은 하단 풋노트 한 줄
- BR 은 **열람 전용** — `canEdit`(ADMIN)이 false 면 도트/행 액션/저장이 잠기고 툴바에 "열람 전용"
  배지가 뜬다(권위는 서버 PUT)
