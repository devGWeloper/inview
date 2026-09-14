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
- **분 단위 프리셋을 여기 넣지 말 것** — 기간과 차트 단위는 다른 축이다. 차트를 잘게 보고 싶은 요구는
  기간이 아니라 틱(`TickSelect`)이 받는다 → [tick.md](../screens/tick.md)
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

## 셸 · 사이드바 (`src/components/shell/`)

상단바(☰ · 브랜드 · 현재 위치 · Agent 칩 · 유저 메뉴) + 좌측 사이드바 + 본문 + 상태바.

- **메뉴의 단일 소스는 `nav.ts` 의 `NAV_GROUPS`**(분석 · 관리 · 공사장). 화면 추가 = 여기 한 줄 +
  `Sidebar.tsx` 의 `ICON` 한 줄. 상단 현재 위치(`PageCrumb`)도 같은 배열에서 찾고, 메뉴 밖 경로는 `OFF_NAV`
- **노출은 `visibleNav()` 하나** — `canAccessPath`(권한) + 비기본 에이전트면 `isBizPath` 숨김.
  항목에 `minRole`/`agentScoped` 같은 플래그를 다시 두지 말 것(미들웨어와 두 벌이 된다)
- `ADMIN` 태그는 `adminOnly()`(= `ROUTE_RULES` 최소 권한이 ADMIN)가 붙인다 — 항목에 손으로 적지 말 것.
  공사장 박스는 통째로 ADMIN 전용이라 태그를 생략한다
- 공사장 그룹 = `WIP_SITES`, ADMIN 에게만. `/wip` 페이지가 같은 배열을 그린다
- 접기: `localStorage["tracex.navFolded"]` · ☰ · 사이드바 하단 버튼 · `[` 키(입력 중엔 무시).
  ≤760px 는 항상 64px 레일
- **사이드바 폭(`--side-w`)에 transition 을 걸지 말 것** — 폭은 레이아웃 속성이라 애니메이션 매 프레임
  본문 전체가 재배치되고, 차트 `ResponsiveContainer` 가 매 프레임 다시 그리며, Traces 상세의 `@container`
  경계를 지나는 순간 3열↔1열이 뒤집혀 크게 버벅인다. 접기는 즉시 전환이다
- 화면 루트는 `.app-main`(flex column) 안에서 `flex:1; min-height:0; overflow:auto` 로 스스로 스크롤한다
- **`.sidenav` 에 overflow 를 두지 말 것** — 에이전트 전환 드롭다운이 사이드바 밖으로 나가야 한다.
  스크롤은 `.sidenav-scroll` 만

## CSS

- 스타일시트는 `src/styles/` 아래 화면별로 나뉘고 `src/app/globals.css` 가 `@import` 순서를 정한다.
  **캐스케이드가 순서에 의존하므로 import 순서를 바꾸지 말 것**
- 화면 전용 클래스는 접두사를 붙인다(`rm-` 로드맵, `fm-` 이벤트-FAB, `rft-`/`ic-` 개선센터,
  `ins-` 실적, `tick-` 틱, `lb-` 레이어 비중). 접두사 없는 이름은 `base.css` 의 전역 규칙과 충돌한다
- 공용 패턴: `.dash-header`/`.dash-card`/`.custom-range`/`.copy-btn`/`.load-error`/`.empty`

## 포맷 유틸

`src/lib/format.ts` — `fmtDuration()` 등. 차트 컴포넌트 안에 두지 말 것(그것만 쓰려고 차트를
import 하게 된다). 일별 현황 행 모델은 `src/lib/dailyRows.ts`.
