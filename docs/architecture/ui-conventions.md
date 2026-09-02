# 클라이언트 공통 규칙

## API 호출 — 원시 `fetch` 금지 (`src/lib/apiClient.ts`)

세션은 7일 고정 만료라 화면을 오래 열어두면 결국 만료된다. 페이지 '이동' 은 미들웨어가 `/login` 으로
리다이렉트해 주지만 **이미 떠 있는 탭의 fetch 는 리다이렉트가 아니라 401 JSON(`{error}`)** 을 받는다.
`res.ok` 를 안 보고 `await res.json()` 결과를 그대로 상태에 넣으면 기대한 배열이 `undefined` 가 되어
렌더에서 죽는다.

- 클라이언트에서 `/api/*` 를 부를 땐 **`apiJson<T>()`**(상태코드 분기가 필요하면 `apiFetch()`)만 쓴다
- `apiJson` 은 401/403/그 외 실패를 **`ApiError`(`status` 보유)로 던진다** — 실패가 데이터로 둔갑하지 않는다
- 401 이면 전역 '세션 만료' 신호가 **1회** 발화 → `AuthProvider` 가 `SessionExpiredDialog` 를 띄우고
  `/login?next=<현재경로>` 로 보낸다. `/api/auth/login` 의 401 은 '비밀번호 오류' 라 제외된다
- 응답의 배열은 **`asArray<T>()`** 로 감싼다
- 에러 문구는 `errMessage(e)` 로 뽑아 화면에 사유를 보여준다(빈 표 ≠ 조회 실패).
  패널 내부 배너 스타일은 `.load-error`

## 차트 Brush — 구간이 바뀌면 key 로 remount

추이 차트 6종(`TimeSeriesChart` · `CubeLatencyChart` · `TokenChart` · `TokenLatencyChart` ·
`TimeoutTrendChart` · `TickMonitorChart`)은 데이터가 많을 때 recharts `Brush` 를 붙인다.

**Brush 의 표시 구간(startIndex/endIndex)은 recharts 내부 state 라 `data` 가 바뀌어도 초기화되지 않는다.**
7일(7칸)을 보다 30일(30칸)로 바꾸면 예전 끝 인덱스가 남아 앞쪽 일부만 그려진다.

```tsx
<Brush key={data.length + ":" + (data[0]?.tick ?? "")} … />
```

구간이 달라졌을 때만 remount 되어 전체 범위로 되돌아가고, key 가 같은 재조회(새로고침·자동 갱신)에서는
사용자가 끌어둔 구간이 유지된다. 새 추이 차트에도 이 key 를 같이 달 것.

## 조회 기간은 Tokens ↔ Timeout 공유 (`TimeRangeProvider`)

두 탭은 성격이 같고(둘 다 `TRX_TOKEN_DET` 기준) 오가며 같이 본다.

- **단일 소스는 `src/components/ui/TimeRangeProvider.tsx`** — `AppChrome` 의 `AgentScopeProvider`
  안쪽에 마운트되고 `useTimeRange()` 로 `{ sel, ready, setPreset, setCustom, resolve }` 를 공급한다.
  `RANGE_PRESETS`(1H/6H/24H/7D/30D) · `CUSTOM_LABEL`("직접 설정") · `DEFAULT_PRESET`("7d") 도 여기
- **페이지에 프리셋 배열이나 기간 state 를 다시 두지 말 것**
- 분 단위 프리셋을 여기 넣지 말 것 — 그건 틱 뷰의 창 길이가 맡는다
- 저장은 `localStorage["tracex.timeRange"]`(`{preset, customFrom, customTo}`). 모르는 프리셋,
  구간이 빈 `custom` 은 기본값으로. SSR 에선 읽을 수 없으므로 **`ready` 가 true 가 된 뒤에 조회**한다
  (안 그러면 기본값으로 한 번, 복원값으로 한 번 이중 조회)
- **`{from,to}` 실제 시각은 저장하지 않는다.** 프리셋은 항상 '지금' 기준이라 `resolveRange(sel)` 가
  호출 시점에 계산한다. `setPreset` 직후엔 `sel` 이 아직 옛 값이므로 조회는
  `resolveRange({ ...sel, preset: k })` 로 방금 고른 값을 직접 풀어서 한다
- **`resolveRange` 는 `{from,to}` 이고 `TokenFilter` 는 `{dateFrom,dateTo}` 다** — 스프레드로 펼쳐
  넣지 말 것. 둘 다 옵셔널이라 타입 검사에 안 걸리고 기간이 조용히 빠져 서버 기본(24h)으로 조회된다
- 직접 설정 입력은 로컬 초안이고 `조회`/`적용` 을 눌렀을 때만 공유 상태에 커밋된다.
  `draftCustom` = 패널만 열린 상태
- **노드/모델/USER 필터는 공유하지 않는다** — 에이전트 전환 시 비워야 하고 두 화면의 차원 목록도 다르다
- Dashboard/Insights 는 공유 대상이 아니다(기간 개념이 다르다 — 주 단위 이동, 월~월 경계 등)

## CSS

- 스타일시트는 `src/styles/` 아래 화면별로 나뉘고 `src/app/globals.css` 가 `@import` 순서를 정한다.
  **캐스케이드가 순서에 의존하므로 import 순서를 바꾸지 말 것**
- 화면 전용 클래스는 접두사를 붙인다(`rm-` 로드맵, `fm-` 이벤트-FAB, `rft-`/`ic-` 개선센터,
  `ins-` 실적, `tick-` 틱, `lb-` 레이어 비중). 접두사 없는 이름은 `base.css` 의 전역 규칙과 충돌한다
- 공용 패턴: `.dash-header`/`.dash-card`/`.custom-range`/`.copy-btn`/`.load-error`/`.empty`

## 포맷 유틸

`src/lib/format.ts` — `fmtDuration()` 등. 차트 컴포넌트 안에 두지 말 것(그것만 쓰려고 차트를
import 하게 된다). 일별 현황 행 모델은 `src/lib/dailyRows.ts`.
