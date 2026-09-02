# 지표 정의

## 두 가지 지연 지표 — 하나로 합치지 말 것

| 지표 | 화면 | 재는 대상 | 단위 | 소스 |
|---|---|---|---|---|
| **평균 응답 속도** | 대시보드 | Action 1건의 end-to-end 응답시간 | 트레이스 | `BIZ_AIACTIONTXN_HIS` CUBE 행 |
| **LLM 속도 추이** | Tokens | LLM 호출 1건의 순수 소요시간, 전 노드 | LLM 콜 | `TRX_TOKEN_DET.LATENCY_MS` |

(UI 라벨은 위와 같고 내부 필드명은 latency 계열을 유지한다.)

두 지표는 상호 보완이다. ①은 "사용자가 체감한 총 응답시간이 느려졌나", ②는 "그중 LLM 호출 자체가
느린가 / 어느 노드가 느린가" 를 답한다.

### ① 대시보드 평균 응답 속도

트레이스별 **CUBE 행의 `SEND_TM`(min) → `RESP_TM`(max)**. CUBE 가 진입 레이어라 이 왕복은
하위(GAIA/MCP/ONEOIS) + LLM 을 모두 거친 전체 응답시간이 된다.
버킷 귀속은 사용 추이 차트와 동일하게 트레이스 시작 시각(첫 recv) 기준. 24h 이상/음수 이상치는 제외.

구현: `computeStats()` 의 `cubeLat` 버킷 집계 + `cubeAvgLatencyMs` 응답 필드,
`TimeBucket.avgCubeLatencyMs`/`cubeLatencyTraces`, `CubeLatencyChart`.

### ② Tokens LLM 속도 추이

`TRX_TOKEN_DET.LATENCY_MS` 의 버킷별 평균. Action 에 한정되지 않고 GAIA 의 모든 노드 LLM 호출을
포괄한다. 노드별/모델별 `avgLatencyMs` 로도 분해된다.

**평균은 성공 호출만** 쓴다(`CASE WHEN <OK> THEN LATENCY_MS END`). 타임아웃(예: 90s 한도)이 섞이면
평균이 한도값 쪽으로 끌려가 "모델이 느려졌다" 로 오독된다. 실패 건의 소요시간은 질문 펼침의
호출 카드에서 개별로 본다.

## 레이어별 소요 비중 (①의 분해, 대시보드 최하단)

"어느 레이어가 시간을 썼나 / 어디서 실패가 시작되나" 를 답한다.

**행의 `SEND_TM→RESP_TM`(=`LayerStats.avgRespMs`)으로 레이어를 비교하면 안 된다.**
이건 하위 레이어 대기를 통째로 품는 포함(inclusive) 시간이라 `CUBE ⊃ GAIA ⊃ MCP ⊃ ONEOIS` 로
중첩되고, 언제나 진입 레이어가 1등이라 아무 정보가 없다. `avgRespMs` 는 진단용 참고값이다.

대신 트레이스별로 **self time** 을 분해한다(`selfMs`/`selfTimeTraces`):

```
wait_i     = Σ(RESP_TM − SEND_TM)   i 가 하위를 기다린 시간 (멀티콜은 호출별 합)
outer_0    = 진입 레이어 RECV→RESP   트레이스 전체 관측 구간
outer_i    = wait_(i−1)              부모가 i 에게 내준 구간
self_i     = outer_i − wait_i        i 자신의 처리 + 전송 지연
self_최하위 = outer_최하위            그 아래(외부 시스템/미연결 레이어)는 미기록이라 제 몫으로 흡수
```

텔레스코핑되어 **Σ self_i = outer_0** 이므로 그대로 "시간 비중 100%" 로 읽힌다.
GAIA 의 LLM 호출은 MCP `send→resp` 창 밖(주로 앞)에서 일어나므로 자연히 `self_GAIA` 로 잡힌다.

- **체인은 그 트레이스에 행이 있는 레이어만** 돈다(`present`). 행 없는 레이어를 체인에 두면
  그 레이어의 `wait` 가 0 이라 부모가 기다린 시간이 통째로 존재하지도 않는 레이어의 몫이 된다
- 분모(`selfTimeTraces`)는 진입 레이어의 recv·resp 가 모두 기록된 완료 트레이스만
- 시계 편차로 `wait > outer` 인 경우 `Math.max(0, …)` clamp
- **실패 발생 레이어**(`LayerStats.failOriginTraces`) = `errCd` 를 가진 **가장 깊은** 레이어로
  트레이스 1건 귀속. 에러가 상위로 전파돼 여러 레이어에 찍혀도 최초 발생지 1곳만 센다
  (행 단위 `failCount` 는 그대로 유지)

화면은 `features/dashboard/LayerBudget.tsx` — 좌 도넛 + 우 표. 도넛은 시간/실패 세그먼트 토글로
한 번에 하나의 비중만 그리고, 표와 hover 로 서로를 하이라이트한다.
**도넛은 recharts 를 쓰지 않고 SVG arc 를 직접 그린다** — recharts v3 의 `Pie` 에는 제어형
`activeIndex` 가 없어 표→도넛 동기화가 불가능하다. 100% 한 조각은 시작점=끝점이라 arc 가
사라지므로 그때만 `<circle>` 링으로 그린다.

## 일별 브레이크다운 · 사용자 수 (`/api/stats` · `/api/insights` 공용)

### `daily: DailyStat[]`

buckets 와 별개로 **항상 "일" 단위**(귀속 기준은 buckets 와 동일한 트레이스 시작 시각).
빈 날은 0, `to` 상한 경계는 `-1ms` 로 끊어 마지막 빈 날을 만들지 않는다.

`DailyStat` = date / total / ok / fail / pending / **users** / avgCubeLatencyMs.
`users` 는 그날의 대표 사용자 distinct 라 Set 이 필요해 서버에서만 집계 가능하다.

`mergeDailyRows()` 가 여기에 토큰(`tok.buckets` 를 날짜별 합산)을 붙여, "일별 현황" 표와 리포트
복사 텍스트의 `[일별 현황]` 섹션이 같은 행을 공유한다. 둘 다 **2일 이상 조회일 때만** 노출한다
(하루짜리는 KPI 와 동어반복).

### `uniqueUsers`

"기간 내 몇 명이 사용했나" = 트레이스별 **대표 사용자의 distinct 수**(한 사용자가 100번 요청해도 1명).

대표 사용자는 `traceUserId()` 가 **진입 레이어(CUBE) 우선**으로 첫 non-null `USER_ID` 를 고르고
공백을 trim 한다. `USER_ID` 는 전 레이어가 INSERT 시 기록하므로 행 순서대로 집으면 하위 레이어의
시스템 계정 값이 섞여 부풀 수 있다. `topUsers` 도 같은 기준.

### 버킷의 `to` 는 배타적 상한이다

주간 조회의 `to` 는 다음 월요일 00:00 이라 그대로 `enumerateBucketStarts` 에 넘기면 그 경계가 속한
버킷이 하나 더 붙어 **끝에 항상 0 인 칸**이 생긴다. `to - 1ms` 로 끊는다(`daily` 가 이미 쓰던 방식).
`to`=now 인 프리셋은 now 와 now-1ms 가 같은 버킷이라 영향이 없다.

## FTE 성과 지표

`src/lib/fte.ts` `computeFteStats(profile)` 가 실데이터로 계산한다.

`db.ts` 의 `monthlyActionSuccess()` 가 2026-01-01~현재 '액션 성공' 수를 월별·액션별로 집계:
- **성공 판정**(에러 없고 CUBE RESP 에 실패 문구 없음)과 **월 귀속**(첫 recv)은 CUBE DB
- **액션 구분**은 `ACTION_TYP` 을 기록하는 GAIA DB
- 둘을 TRACE_ID 로 JS 조인

```
연간 FTE = Σ(액션별 성공 수 × 액션별 환산 분) ÷ 연간 분
월별      = 환산 분 합 기준 ×12 연환산
```

계산식은 프로필 필드로 커스터마이즈한다 — `fteActionMinutes`(ACTION_TYP→분, 기본
NEST_Seasoning=5 · AutoQual_Abort=5 · AutoQual_JobCreate=5) · `fteDefaultMinutes`(기본 5) ·
`fteAnnualMinutes`(기본 65,984). `/admin` "성과 지표 (FTE)" 에서 편집하고 `normalizeProfile` 이
잘못된 값을 보정한다.

FTE 1 = 1인·1년. CUBE 미연결이면 카드는 `—` + 안내(수동 폴백 필드 없음).
GAIA 미연결이면 전 트레이스가 기본 분으로 계산된다(무해). `FteChart` 는 최근 12개월만 노출.

> 성공 판정이 `ACTION_FAIL_PHRASES` 에 의존한다 → [temp-workarounds.md](./temp-workarounds.md)
