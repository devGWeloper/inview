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

- 단일 호출 레이어: **recv | send | resp** 3열
- 멀티 호출 레이어: 상위 recv 를 위에 한 번, 그 아래 번호 붙은 `Call #N` 마다 send | resp 쌍
- `Stepper` 는 레이어에 여러 행이 있으면 부제에 `N calls` 를 띄운다
- `HTTP_STS_CD` 는 route 옆(단일 카드 head) / `Call #N` 헤더(멀티)에 배지로

스테퍼의 `grid-template-columns` 와 레이어 배경색은 컴포넌트에서 `LAYER_ORDER.length` /
`LAYER_COLOR` 로 inline 주입한다.
