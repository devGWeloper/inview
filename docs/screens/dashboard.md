# Dashboard — `/dashboard`

BIZ 트레이스 집계. 개발자용 진단 화면.

**파일**
- 화면: `src/app/dashboard/page.tsx`
- 컴포넌트: `src/features/dashboard/` — `StatsCards` `StatusDonut` `LayerBudget`
  `DimensionBreakdown` `CubeLatencyChart`
- 공용 컴포넌트: `src/components/charts/TimeSeriesChart` · `src/components/ui/TopList` ·
  `src/components/tick/*`
- API: `src/app/api/stats/route.ts`(파싱+인가만)
- 집계: `src/lib/stats.ts` `computeStats()`
- 스타일: `src/styles/dashboard.css`
- 권한: DEV 이상 + 기본 에이전트(BIZ)

**참고**: [metrics.md](../architecture/metrics.md) · [tick.md](./tick.md)

## 집계는 `src/lib/stats.ts` 에 있다

`/api/stats` 와 `/api/insights` 가 **같은 `computeStats()` 를 쓴다**. 집계 규칙이 두 벌이 되면
같은 기간인데 두 화면의 숫자가 갈린다. 라우트는 파싱 + 인가 + 응답 모양만 담당한다.

## 구성

- KPI 카드 (`StatsCards`) — 총계/성공/실패/대기, 평균 응답 속도
- 상태 도넛 (`StatusDonut`)
- 사용 추이 (`TimeSeriesChart`) — 버킷 격자는 `src/lib/timeBuckets.ts` 공용
- 평균 응답 속도 추이 (`CubeLatencyChart`) — 사용 추이 카드 바로 아래
- 브레이크다운 (`DimensionBreakdown`) — 액션 타입별 / FAC별 / AREA별
- 주요 에러 (`TopList`) — `/api/error-codes` 의 의미를 `descriptions` 로 받아 툴팁에 노출
- 레이어별 소요 비중 (`LayerBudget`) — 최하단

## 주의

- 액션 타입별 집계의 `라우팅 실패`(= `ROUTING_FAIL_LABEL`)는 표기 전용 라벨이라 실제 `ACTION_TYP`
  값이 아니다 → `DimensionBreakdown` 에서 필터 클릭 대상에서 제외(흐리게 하지는 않는다)
- FAC/AREA 의 `(none)` 은 MCP 미도달을 뜻한다. 빼 버리면 합이 총 건수와 안 맞는다
- 틱 단위는 전부 집계 라우트의 `g=` 다 — `1분` 도 롤링 60초가 아니라 정각 분 격자다.
  대시보드는 한도가 없어 TPM/RPM 판정이 뜻이 없다(그건 Tokens·Timeout 것) → [tick.md](./tick.md)
- 에러 코드 제외 필터(`excludeErrCds`)는 칩 바(`.dash-exclude`)로 상태를 보인다
- 분석 보기 상단의 `ScopeNote`(`src/components/ui/ScopeNote.tsx`) — 이 화면은 BIZ 트레이스 집계라
  `TRX_TOKEN_DET` 의 LLM 타임아웃이 따로 안 잡힌다는 한 줄 + `/timeouts` 링크. Tokens 와 공용
