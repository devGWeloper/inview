# Timeout — `/timeouts`

LLM 타임아웃 전용 추적. **에이전트별로 갈리는 두 화면 중 하나.**

**파일**
- 화면: `src/app/timeouts/page.tsx`
- 컴포넌트: `src/features/timeouts/` — `ModelVolumeBars` `FailedCallsTable` `DimCard` `ReasonList`
- 공용: `src/components/charts/TimeoutTrendChart` · `src/components/tick/*`
- API: `src/app/api/timeouts/route.ts` · `src/app/api/tokens/tick/route.ts?view=failure`
- 집계: `src/lib/timeouts.ts` `fetchTimeoutStats()` · 판정은 `src/lib/tokenStatus.ts`
- 스타일: `src/styles/timeouts.css`
- 권한: **DEV 이상** — LLM 타임아웃을 파는 건 개발자다.
  `ROUTE_RULES` 의 `/timeouts`·`/api/timeouts` + `requireAgent(agentId)` 로 서버에서도 막는다

**참고**: [agents.md](../architecture/agents.md) 의 `TRX_TOKEN_DET` · [tick.md](./tick.md)

## 왜 별도 화면인가

기존 대시보드에선 "에러 한 줄" 로 뭉뚱그려져 얼마나 심한지·어디서 나는지가 안 보였다.

## 출처는 `TRX_TOKEN_DET` 한 곳

GAIA 가 실패 호출도 1행 적재하므로(`STAT_CD='ERROR'` + `ERR_CTN` + 토큰 0 + `LATENCY_MS`=예외까지
기다린 시간) **끊긴 그 호출의 노드/모델/질의/대기시간을 그대로 읽는다. 추정하지 않는다.**

BIZ 의 `ERR_CD` 를 보거나 "마지막 성공 호출" 로 노드를 되짚는 방식은 **틀린 답**을 준다 — 성공 호출만
남던 시절엔 항상 actionRouter 가 잡혀 "라우터에서만 타임아웃" 처럼 보였다. 그 방식은 폐기했다.

타임아웃 vs 그 외 오류는 `ERR_CTN` 문구로 가른다 — 판정은 `src/lib/tokenStatus.ts` 한 곳.

## 집계

`fetchTimeoutStats()` 는 전부 `TRX_TOKEN_DET` 대상의 SQL `GROUP BY` 이며 BIZ 조회/조인이 없어 가볍다.
쿼리별 격리 실행(`run()`).

`STAT_CD`/`ERR_CTN` 컬럼이 없으면(적재 전) **`available=false`** 로 내려 화면이 "적재 전" 안내만 띄운다.
0 건으로 보이면 "문제 없음" 으로 오독되므로 구분한다.

## 화면

- **KPI 4**: 타임아웃 수(+전체 호출 대비 비율) / 실패 호출 / **영향 질문** / 영향 사용자
  - "평균 대기" 는 뺐다 — 목록 행이 전부 실패 건이라 그 평균은 해석할 게 없다(90s 한도에 붙어 있을 뿐).
    대신 **영향 질문**(`affectedTraces` = 실패 호출이 있는 고유 TRACE_ID 수)을 둔다.
    사용자 체감 피해량은 호출 수가 아니라 "질문 몇 개가 깨졌나" 다. 개별 대기시간은 목록의 `대기` 열
- **발생 추이** (`TimeoutTrendChart`) — **X 를 공유하는 패널 2개**다.
  - 위(건수): 전체 호출(회색 `#94a3b8`) 면적을 배경에 깔고 그 위에 타임아웃/LLM 오류 스택 + peak 라인.
    **분모를 차트 안에 둔 게 요점** — 실패 건수만 그리면 "3건" 이 100건 중 3건인지 3건 중 3건인지 모른다
  - 아래(비율): 타임아웃 ÷ 전체 호출. `Brush` 와 X 눈금이 여기 붙고 `syncId="to-trend"` 가 두 패널의
    툴팁 위치·Brush 구간을 함께 움직인다
  - **이중축(y 스케일 2개)으로 합치지 말 것.** 건수와 비율은 스케일이 달라 한 축에 얹으면 두 선이
    교차하는 지점이 아무 뜻도 없는 좌표가 된다. 패널을 나누는 게 정답이다
  - 두 패널의 `YAxis width`(`Y_WIDTH`)와 `margin`(`MARGIN`)이 같아야 위아래가 같은 시각으로 읽힌다
  - 호출 0건 버킷의 비율은 `null` 이다(`connectNulls={false}`) — 0% 로 그리면 "안정" 으로 읽힌다
  - 비율 축 최댓값은 **1% 가 바닥**이다. 최대가 0.2% 인데 축을 0.2% 에 맞추면 두더지 언덕이 산맥이 된다
  - 카드 부제가 `전체 호출 N건 중 실패 M건 (x.x%) · 타임아웃 K건 (y.y%)` 을 문장으로 못 박는다
- **모델별 요청 대비 실패** (`ModelVolumeBars`) — 모델 한 줄에 **같은 눈금의 막대 두 개**.
  위 = 전체 호출, 아래 = 그중 실패(타임아웃 + LLM 오류). 아래가 위보다 얼마나 짧은지가 곧 안전 마진이라
  실패율을 **색이 아니라 길이**로 읽는다. 우측에 총 호출 · 실패 건수 · 실패율.
  막대 클릭 = 모델 서버 필터. 서버는 `modelVolSql`(모델 GROUP BY, 호출 많은 순 상위 8).
  - `byModel`(`DimCard`)과 달리 **`HAVING failed > 0` 이 없다** — "8천 건 중 0건" 인 모델도 분모로서
    보여줘야 이 카드가 성립한다
  - 실패 세그먼트에 `min-width: 3px` — 0.1% 여도 막대가 사라지면 "실패 없음" 으로 오독된다
  - 앞서 있던 모델 × 시간 히트맵을 대체했다. 셀 색(실패율 6단계)으로만 말하니 "몇 건 중 몇 건" 이
    hover 해야 나왔고, 8행 × N칸이라 셀이 납작해 라벨이 안 읽혔다
- **노드별·모델별·사용자별 분포** (`DimCard`)
- **자주 발생한 오류 사유** (`ReasonList`) — `ERR_CTN` 앞 100자로 클러스터링해 상위 8개
  (`REASON_LIMIT`). 순위 배지 + 문구 + 발생 수 + 그중 타임아웃 비중. 스택 트레이스도 앞머리가 같으면
  하나로 묶인다
- **실패한 호출 표** (`FailedCallsTable`) — 호출 시각·결과·노드·모델·대기·사용자·질의·사유·TRACE_ID.
  컬럼 필터(결과/노드/모델 셀렉트, 사용자·질의·사유·TRACE_ID 텍스트) + 헤더 클릭 정렬(호출 시각/대기)
  + 페이징(25건). `QuestionsTable` 의 `qfilter-row`/`qft-*`/`qth-sort`/`qpager` 스타일 재사용.
  **서버가 내려준 최근 `ITEM_LIMIT`(200)건 안에서 좁히는 클라이언트 필터다**

## 조회 범위 = 기간 + 노드 + 모델 (전부 서버 필터)

기간은 공유 `TimeRangeProvider`. 노드/모델은 `DimCard` 행 클릭으로 걸리고(조합 가능) 상단 `to-scope`
칩으로 해제한다 — **노드별·모델별 추이를 보는 수단이 이것이다**(KPI·차트·분포·목록이 한꺼번에 좁혀진다).

## 색

두 계열의 색은 **명도까지 벌려 둔다** — 색상·명도가 모두 가까우면 적층 면적에서 경계가 안 보인다.

| 계열 | 색 |
|---|---|
| 타임아웃 | `#b42318` (`--err`) |
| LLM 오류 | `#d97706` 앰버 (`--llm-err`) |
| 전체 호출(분모) | `#94a3b8` 중립 회색 — 배경으로 물러나야 하므로 계열색을 주지 않는다 |

차트는 JS 상수(`TimeoutTrendChart.SERIES_COLOR`), 막대·배지는 CSS 변수를 쓰므로 **두 값을 같이 고칠 것**.

문구는 "기타 오류" 가 아니라 **"LLM 오류"**(추이 범례·분포 막대·목록 필터·상태 배지).
타임아웃도 넓게 보면 LLM 오류지만 이 화면에서 둘은 **배타적인 두 계열**이다
(타임아웃 = `SQL_TIMEOUT_PRED`, LLM 오류 = 그 외 실패).
