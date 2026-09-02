# Tokens — `/tokens`

GAIA LLM 호출의 토큰 사용량·속도. **에이전트별로 갈리는 두 화면 중 하나.**

**파일**
- 화면: `src/app/tokens/page.tsx`
- 컴포넌트: `src/features/tokens/` — `QuestionsTable` `TokenBreakdown` `TokenStatsCards`
- 공용: `src/components/charts/TokenChart` · `TokenLatencyChart` · `src/components/ui/TopList` ·
  `src/components/tick/*`
- API: `src/app/api/tokens/route.ts` · `src/app/api/tokens/tick/route.ts`
- 집계: `src/lib/tokens.ts` `fetchTokenStats()`
- 스타일: `src/styles/tokens.css`
- 권한: DEV 이상 (에이전트 지정 가능)

**참고**: [agents.md](../architecture/agents.md) 의 `TRX_TOKEN_DET` · [tick.md](./tick.md) ·
[ui-conventions.md](../architecture/ui-conventions.md) 의 TimeRangeProvider

## 집계

`fetchTokenStats()` 는 JS 가 아니라 **SQL `GROUP BY`** 로 집계한다(테이블이 클 수 있다).
버킷 헬퍼는 `src/lib/timeBuckets.ts` 공용(`pickGranularity`/`floorToBucket`/`isoNoTz`/`parseTs`/
`enumerateBucketStarts`).

집계 쿼리들은 `run()` 헬퍼로 **쿼리별 격리 실행**되어 한 쿼리가 SQL 에러여도 그 섹션만 비고 나머지는
정상이며, 로그에 `fetchTokenStats [섹션명] query failed` + ORA 코드가 남는다.
테이블/드라이버/설정 없음 ⇒ 빈 stats(0) ⇒ 빈 차트(무해).

latency 도 같이 집계한다: 버킷별 `avgLatencyMs`(`SUM/COUNT` 로 NULL 제외) · 전체 `avgLatencyMs` ·
`byNode`/`byModel` 의 `avgLatencyMs`. **성공 호출만** 대상이다
→ [metrics.md](../architecture/metrics.md)

## 화면 — 두 부분

### 현황

`TokenStatsCards`(KPI) · `TokenChart`(추이) · `TokenLatencyChart`(LLM 속도 추이) ·
`TokenBreakdown`(노드별/모델별 리더보드).

`TokenBreakdown` 은 `byNode`/`byModel` 을 **별도 카드**(노드=파랑, 모델=보라)로 렌더한다 —
순위 배지 + 큰 값 + 1위 대비 상대 바 + 비중%, 토큰/호출/토큰·호출/속도 공유 메트릭 토글,
행 클릭 = 필터.

**노드×모델 교차 집계**(`TokenDimStat.sub`, 별도 `GROUP BY NODE_NM, MODEL_NM` 쿼리)로 각 노드가 실제
쓴 모델 구성을 행 안에 칩+비중% 로 노출한다. 한 질문이 여러 노드/모델을 거치므로
(예: actionRouterNode=qwen3.6 → SeasoningNode=qwen3.5) "노드=모델 1개" 로 오해하지 않게 하는 장치다.

### 질문별 토큰 (`QuestionsTable`)

**"질문" = `TRACE_ID` 하나.** 한 질문의 호출은 라우터→실행 노드처럼 여러 노드/모델을 거칠 수 있어
`questions` 는 대표값(MAX) 대신 거쳐간 노드/모델 **전부**를 내린다(`nodes[]`/`models[]`,
`LISTAGG ... ON OVERFLOW TRUNCATE` 후 JS 중복 제거, 첫 호출 순). 표에는 칩으로 나열.

`questions` 는 **최신 `LAST_TM` desc 상위 500건**이다(토큰순이면 최근 질문이 잘려 보이는 착시가 있다).
null-trace 행은 한 질문 = 한 호출로 취급.

**원본 질의**: 한 질문의 호출들은 보통 같은 `QUERY_CTN` 을 공유하므로 `questions` 가 질문 단위로
`queryCtn`(가장 이른 non-null 호출의 값,
`MIN ... KEEP (DENSE_RANK FIRST ORDER BY NVL2(QUERY_CTN,0,1), CALL_TM)`)을 내리고, 표의 질문 셀은
**질의(크게) + TRACE_ID(작게) 2줄**로 그린다.

표에는 **컬럼별 필터**(질문/USER 텍스트, NODE/MODEL 셀렉트 — 로드된 상위 질문 범위 내 클라이언트
필터)와 **헤더 클릭 정렬**(LAST_TM/IN/OUT/TOTAL/CALLS, 재클릭 = 방향 토글, 기본 LAST_TM desc)이 붙는다.

### 질문 펼침 (`CallsDetail`)

`?traceId=` 를 넘기면 `calls`(호출별 행, `queryCtn`/`latencyMs` 포함)가 채워져 인라인으로 펼쳐진다.
호출이 1건이어도 trace 가 연결된 질문이면 가능하다.

**`calls` 쿼리만은 `TRACE_ID` 단독 조회다** — 기간/노드/모델 필터를 걸지 않는다. 질문을 펼치는
목적은 그 질문이 실제로 거친 호출 **전부**를 보는 것이고 나머지 필터는 "질문을 찾는" 조건일 뿐이다.
예전엔 창을 그대로 적용한 데다 클라이언트가 펼침 시점의 `Date.now()` 로 창을 다시 계산해서, 화면을
띄워두고 시간이 흐르면 같은 질문의 호출이 잘려 보였다.
대신 표의 `CALLS`(기간 내 집계)보다 상세가 많을 수 있어 "조회 조건 밖 N건 포함" 배지로 차이를 밝힌다.

구성: **원본 질의 블록**(액센트 보더, 전체 노출 — 280자 초과 시만 3줄 접힘 + 더 보기 `QueryText`)을
헤드라인으로 두고, 아래에 **호출 타임라인** — 요약 스트립(호출 수 · 노드 흐름 · 총 토큰 · 첫→마지막
구간) + 시간순 `#N` 레일 + 호출 카드(노드→모델 · ⏱응답시간 · 직전 호출과의 간격 · 토큰 바).
호출 카드의 쿼리는 **원본과 다를 때만**(공백 정규화 비교) "이 호출의 쿼리" 로 다시 표시한다.

`QUERY_CTN` 은 `calls` 쿼리와 `questions` 의 원본 질의 집계에서만 SELECT 한다.

## 실패 호출은 최소한으로만 얹는다

응답에 내려가는 건 `TokenQuestion.errorNodes`(그 질문에서 LLM 호출이 실패한 노드 이름들)와
`TokenRow.statCd`/`errCtn`(펼침용) 둘뿐이다.
화면 반영도 **질문별 토큰 표 한 곳** — NODE 칩 중 끊긴 노드만 빨갛게, 펼친 호출 카드에
`타임아웃`/`실패` 배지 + 사유 한 줄.

**KPI · 추이 차트 · 리더보드에는 실패 관련 표시를 넣지 않는다.** 타임아웃 추적은 `/timeouts` 담당.

다만 그 사실 자체는 화면에 밝힌다 — 분석 보기 상단의 `ScopeNote`(`src/components/ui/ScopeNote.tsx`,
대시보드와 공용)가 "실패 호출은 호출 수에만 잡히고 토큰 0 · 속도 평균 제외" 를 한 줄로 적고
`/timeouts` 로 넘긴다. 집계 SQL 이 실제로 그렇다(`COUNT(*)` 에 필터 없음, latency 만 `SQL_OK_PRED`).

## 성능

`skipQuestions: true`(`TokenFilter`)를 주면 questions/topUsers/calls 를 건너뛴다.
`/api/insights` 가 이걸 쓴다 — 상위 500건 LISTAGG 로 무거운 데다 화면에 쓰지도 않는다.
