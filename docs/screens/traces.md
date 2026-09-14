# Traces — `/`

4계층 동기 메시지의 end-to-end 트레이스 뷰어. 이 앱의 원래 목적.

**파일**
- 화면: `src/app/page.tsx` · `src/features/traces/TraceTimeline.tsx`
- API: `src/app/api/traces/route.ts`(목록) · `src/app/api/traces/[traceId]/route.ts`(상세)
- 집계: `src/lib/db.ts` · `src/lib/workGroup.ts`
- 스타일: `src/styles/traces.css`
- 권한: DEV 이상 + 기본 에이전트(BIZ)

**참고**: [data-flow.md](../architecture/data-flow.md) — 2단계 조회 · 스키마 · 멀티콜

## 목록

`/api/traces` 가 `TRACE_ID` 로 행을 묶어 `allComplete`(레이어가 다 있고 모든 행이
`SEND_COMPLT_YN='Y'`)와 `hasError` 를 계산한다. `TraceSummary.lastSendTm` 은 모든 `sendTm`/`respTm`
중 최대.

그 요약을 `buildWorks()` 가 **묶음(works)** 으로 그룹핑하고 매칭된 묶음의 형제 트레이스를 back-fill
한다 → [temp-workarounds.md](../architecture/temp-workarounds.md) 의 TEMP(WORK_GROUP).

### 묶음 UI

묶음은 요약 행(`.work-row`) + 자식 행(`.work-child`)이 **한 덩어리**로 읽혀야 한다.
글자를 더하지 않고 톤으로만 구분한다:

- 바탕 `--work-band`(자식) / `--work-head`(펼친 요약 행)
- 요약 행부터 마지막 자식(`.work-last`)까지 끊기지 않는 좌측 레일 `--work-rail`
- 위(요약 행 border-top) 아래(마지막 자식 border-bottom)를 닫는 선

묶음 바탕 규칙이 `tr.active` 보다 **뒤에** 오므로 선택 행 배경은 `tr.work-child.active` /
`tr.work-row.active` 로 명시해 되돌린다(같은 specificity).

## 상세 타임라인

`TraceTimeline` 이 행을 레이어별로 묶어 렌더한다.

- 단일 호출 레이어: **recv | send | resp** 3열. 패널 폭 880px 이하에서 1열로 접힌다(`@container`).
  이 값을 올리지 말 것 — 사이드바를 펼친 1920px 화면에서 상세 패널이 ≈945px 이다
- JSON 블록(`.json-content`)의 **`content-visibility: auto` 를 지우지 말 것.** 원문 전체를 하이라이트
  span 으로 올리고(20KB×18블록이면 ≈42k span) 보이는 건 블록당 260px 뿐이다. 이게 없으면 화면 밖 블록까지
  배치해 조회 직후 첫 배치 ≈1.4s, 사이드바 토글 0.3~0.7s 가 멈춘다(있으면 ≈0.15s / ≈0.05s, 실측)
- 좌우 분할 폭 `--left-w` 는 `shell.css` 에서 **`@property` 로 비상속 등록**돼 있다. 지우지 말 것 — 상속
  변수면 드래그 한 스텝마다 패널 안 노드 전체가 스타일 재계산된다(실측 60~130ms → 20~45ms).
  인라인 `grid-template-columns` 로 바꾸지 말 것 — 좁은 화면의 1열 미디어쿼리를 덮어쓴다
- 분할 드래그 중엔 `--left-w` 를 DOM 에 직접 쓰고 **놓을 때 한 번만 `setLeftWidth`** 한다. 이동마다
  state 를 바꾸면 목록·상세 전체가 재렌더된다(실측 12~19ms/스텝, 개발 모드)
- 멀티 호출 레이어: 상위 recv 를 위에 한 번, 그 아래 번호 붙은 `Call #N` 마다 send | resp 쌍
- `Stepper` 는 레이어에 여러 행이 있으면 부제에 `N calls` 를 띄운다
- `HTTP_STS_CD` 는 route 옆(단일 카드 head) / `Call #N` 헤더(멀티)에 배지로

스테퍼의 `grid-template-columns` 와 레이어 배경색은 컴포넌트에서 `LAYER_ORDER.length` /
`LAYER_COLOR` 로 inline 주입한다.
