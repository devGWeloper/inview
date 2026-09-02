# 실적 — `/insights`

**일반 사용자(FIELD)에게 공개되는 유일한 화면.** BR·ADMIN 도 같은 화면을 본다.

**파일**
- 화면: `src/app/insights/page.tsx`
- 컴포넌트: `src/features/insights/` — `DailyTable` `Card`(Card/Kpi) · `range.ts`(기간 선택) · `labels.ts`(표기)
- 공용: `src/components/charts/*`(FteChart 포함) · `src/components/ui/AgentAvatar`
- API: `src/app/api/insights/route.ts` (`toInsights()` 등 축소 변환)
- 집계: `src/lib/stats.ts` `computeStats()`(대시보드와 공유) · `src/lib/fte.ts` ·
  `src/lib/tokens.ts` · `src/lib/timeouts.ts`
- 리포트: `src/lib/insightsReport.ts` `buildInsightsReport()`
- 스타일: `src/styles/insights.css`
- 권한: `canViewInsights(role)` = **FIELD + BR 이상. DEV 만 못 본다**

**참고**: [auth.md](../architecture/auth.md) 의 FIELD 허용 목록 · [metrics.md](../architecture/metrics.md)

## 왜 이 화면만 여는가

이 앱은 개발자가 4계층 메시지를 추적하려고 만들었는데 리포트성 화면이 늘면서 비개발 사용자도 실적을
보고 싶어졌다. 하지만 일반 사용자에게 레이어 JSON 원문·다른 사용자의 질의/사번·내부 에러 코드를
보이면 안 된다. 그래서 화면 하나만 연다.

DEV 가 빠진 이유: 개발자는 Dashboard 로 같은 수치를 더 자세히 보고, BR·ADMIN 은 "일반 사용자에게
무엇이 보이는가" 를 같은 화면으로 확인해야 한다. 별도 미리보기를 만들면 두 화면이 어긋난다.
FIELD 가 아닌 계정에게만 "일반 사용자 계정에게 공개되는 유일한 화면" 안내 띠를 띄운다.

## 집계는 공유, 응답은 분리

`computeStats()` 는 `/api/stats` 와 공유하고 **다른 건 응답 모양뿐이다**.
`toInsights()` 가 `InsightsResponse` 의 필드를 **하나씩 옮겨 담는다.**

**`...stats` spread 를 쓰지 말 것** — 빼는 방식이면 `StatsResponse` 에 필드가 추가될 때마다 새로 새고,
담는 방식이면 안 샌다.

| | |
|---|---|
| 빠지는 것 | `topUsers`(사번) · `layers`/`selfTime`(내부 구조) · `excludeErrCds` |
| 남는 것 | 상태 합계 · 성공률 · 평균 응답 · **사용자 '수'** · 버킷 · 일별 · 기능(ACTION_TYP)별 · FAC별 · 주요 실패 원인 · 프로필 공개 항목 · FTE |

토큰·타임아웃도 **같은 라우트가 실어 내린다** — 일반 사용자는 `/api/tokens`·`/api/timeouts` 에서
403 이라 거기서 부를 수 없다. `fetchTokenStats`/`fetchTimeoutStats`(기본 에이전트)를 같이 호출해
`toInsightsTokens()`/`toInsightsTimeouts()` 로 **모델까지만** 옮겨 담는다.

| | |
|---|---|
| 빠지는 것 | `byNode`(내부 노드명) · `topUsers`/`byUser`(사번) · `questions`/`calls`(질의 원문) · `items`(실패 호출 원문) · `topReasons`(스택 트레이스) |

토큰 조회는 **`skipQuestions: true`** 로 부른다. 넷(stats/fte/tokens/timeouts)은 `Promise.all` 이고
뒤 셋은 `.catch(() => null)` 이라 한쪽이 죽어도 그 섹션만 빈다.

**이 화면의 데이터 소스는 끝까지 `/api/insights` 하나여야 한다.** 여기서 다른 API 를 부르지 말 것.

## 주요 실패 원인은 코드가 아니라 '사유'

`InsightsError = {code, label, count, described}` (`toInsightsErrors()`).
개발자가 아닌 사람이 보므로 서버가 설명을 붙여 내리고 화면은 설명을 앞세운다.

설명 출처는 둘 — ① `TRX_ERRMSG_COD` 마스터(`loadErrorCodeMap()`) ② TEMP 가상 코드 라벨
(`ACTION_FAIL_LABELS`). 둘 다 없으면 `label = code` + `described=false` 로 내려 화면이 코드를 두 번
그리지 않는다.

일반 사용자는 `/api/error-codes` 를 못 부르므로(허용 목록 밖) 설명 조회를 `/api/insights` 안에 넣었다.

**막대는 1위 대비 상대 길이이고 %를 쓰지 않는다** — `topErrors` 의 분모가 실제 `ERR_CD`(행 단위)와
TEMP 가상 코드(트레이스 단위)에서 서로 달라 "전체 대비 %" 로 읽으면 틀린다.

## 기간 선택 — 세 갈래

```ts
Sel = { kind:"recent", key } | { kind:"week", offset } | { kind:"custom", from, to }
```

1. **최근 구간** — 오늘 / 최근 7일 / 최근 30일 / 이번 달. 끝은 항상 '지금'
2. **`◀ ▶` 주 이동** — 월~일 한 주를 통째로. 몇 주 전이든 거슬러 올라가고 `▶` 는 이번 주에서 멈춘다.
   `offset` 은 **0 = 이번 주, -1 = 지난주**. `weekRange(offset)` = 월요일 00:00 ~ 다음 월요일 00:00
3. **Custom** — `datetime-local` 2개, 공용 `custom-range` 패턴. 적용 버튼을 눌러야 조회

- 주간은 **화살표 하나로만** 조작한다. `이번 주`/`지난주` 버튼을 따로 두면 두 벌이 되고,
  고정 프리셋만 있으면 그 이전 주는 볼 방법이 없다
- **지나간 주의 상한을 '지금' 으로 줄이지 말 것** — 매번 다른 구간이 되어 비교가 깨진다.
  아직 끝나지 않은 이번 주만 줄인다
- **Custom 의 상한만은 배타 처리(-1ms)를 하지 않는다** — 사용자가 찍은 시각이라 8/10 을 골랐는데
  라벨이 8/9 로 나오면 "왜 하루가 빠지냐" 가 된다
- 툴바 우측 `ins-range` 가 실제 조회 구간을 `08/24 (월) ~ 08/28 (금)` 로 밝힌다

## 레이아웃 — 두 단

### ① 업무 실적
KPI 6(처리 건수 · 성공률 · 실패 · 평균 응답 속도 · 사용 인원 · 누적 절감 FTE)
→ 처리 추이(전폭)
→ **일별 현황 표**(2일 이상 조회일 때)
→ [기능별 실적 | 주요 실패 원인] 2열 — "무엇을 처리했나 / 무엇이 안 됐나" 한 쌍
→ [절감 효과 추이 | FAB별 실적] 2열

### ② `ins-sep` 아래 AI 운영 현황
KPI 4(토큰 사용량 · LLM 호출 · 평균 LLM 속도 · 타임아웃)
→ [토큰 사용 추이 | LLM 속도 추이] 2열
→ [타임아웃 발생 추이 | 모델별 현황] 2열

### 레이아웃 규칙
- **카드를 혼자 한 줄에 두면 가로만 길고 안이 비어 보인다.** 조밀하지 않은 카드는
  `.ins-grid-2`(auto-fit minmax 380px, 좁으면 1열)로 짝지을 것
- 카드를 추가·삭제해 짝이 홀수가 되면 **남는 한 장을 전폭으로 늘리지 말고 짝을 찾을 것**
- FAB별의 `(none)`(=MCP 미도달)은 **'미상' 으로 표기하고 흐리게** 둔다. 빼면 합이 총 처리 건수와
  안 맞아 "왜 숫자가 다르냐" 가 된다(기능별의 `라우팅 실패` 와 같은 취급)
- 기능 코드는 `ACTION_LABEL` 로 한글 표기(시즈닝/AutoQual 실행·취소), 모르는 값은 원문 그대로
- **세로 여백은 `.ins .dash-body` 의 flex `gap` 한 곳에서 준다.** `.dash-body` 자체에는 간격 규칙이
  없어(대시보드는 카드마다 따로 잡는다) 그냥 두면 섹션이 맞붙는다. 카드마다 margin 을 다는 방식은
  섹션을 추가할 때마다 빠뜨린다. `.ins` 스코프라 대시보드에는 영향 없음

## 리포트 복사 — `src/lib/insightsReport.ts`

매주 수기로 옮겨 적던 실적을 원클릭 복사로 대체한다.

- **입력은 `InsightsResponse` 하나뿐이다.** 다른 API 를 끌어오면 "화면에 보이는 것 = 복사되는 것"
  관계가 깨지고, 일반 사용자 세션에는 애초에 없는 데이터를 리포트에만 싣게 된다
- 라벨도 화면과 같은 것을 쓴다 — 기능은 `actionLabel`, 실패 사유는 `topErrors[].label`(코드 아님).
  일별 현황은 화면 표와 같은 `DailyRow[]`
- 섹션 순서: 헤더 → [업무 실적] → [일별 현황](2일 이상) → [기능별 실적] → [주요 실패 원인] →
  [FAB별 TOP] → [AI 운영 현황] → [모델별] → [타임아웃]
- **버튼은 전 권한에 노출**한다(FIELD 포함) — 화면에 이미 보이는 숫자를 텍스트로 바꿔 줄 뿐이다
- 복사는 `navigator.clipboard` → 실패 시 textarea + `execCommand` 폴백(사내 배포가 HTTP 라
  clipboard API 가 막히는 경우가 있다). 성공 시 2초간 `.copy-btn.copied`
- 미리보기(`ins-report-*`)는 **기본 접힘**이고 툴바 버튼과 **같은 `reportText`** 를 쓴다.
  항상 펼쳐 두면 화면 끝에 텍스트 덩어리가 붙어 실적을 훑는 흐름이 끊기고, 텍스트를 두 벌로
  만들면 미리보기와 실제 복사본이 어긋난다

## 일별 현황 표

행 모델(`DailyRow` · `mergeDailyRows`)은 `src/lib/dailyRows.ts`, 표는
`src/features/insights/DailyTable.tsx`. 화면과 리포트 텍스트가 이 행을 **공유**한다.
두 벌로 두면 한쪽만 고쳐져 표와 복사본이 어긋난다.
화면은 `labelAction={actionLabel}` 로 기능 코드만 한글로 바꾼다.

- **실적이 없는 날(`tr.empty`)은 한 줄로 얇게 그린다**(패딩·글자 축소). 30일 조회에선 빈 날이 표의
  절반을 넘어 같은 높이를 주면 스크롤만 길어진다
- **행 자체를 빼지는 말 것** — 날짜가 건너뛰면 "조회가 덜 됐나" 로 읽히고, 연속된 공백이 보이는 것
  자체가 정보다(그 기간에 안 썼다). 높이만 줄이고 톤을 낮춘다

## 차트 prop 타입

차트 컴포넌트의 prop 타입은 **실제로 읽는 필드로 좁혀져 있다**(`TokenSeries`/`TimeoutSeries`/
`TokenSummary`). 전체 응답을 요구하면 축소 응답(`InsightsTokens` 등)을 못 넘긴다.
구조적 타이핑이라 기존 호출부는 전체 응답 그대로 통과한다. **이 규칙을 깨지 말 것.**

## DB

`ROLE_CD` CHECK 제약에 `'FIELD'` 추가 — `sql/migrations/2026-08-28_add_field_role.sql`
(앱 자체 DB=GAIA, ADM 계정 1회). **앱 배포보다 먼저** 실행할 것 — 제약을 넓히기 전에는 `/accounts`
에서 일반 사용자 계정 저장이 ORA-02290 으로 실패한다.

## FIELD 계정의 소속

`/insights` 는 BIZ 집계라 `isBizPath` 에 포함된다. 미배정이거나 다른 팀 에이전트 소속이면 `/403` 이다
(FIELD 는 `/tokens` 도 못 보므로 미들웨어가 그쪽으로 되돌리지 않는다 — 서로를 가리키면 리다이렉트
루프가 된다).

그래서 **계정 저장 시점에 막는다** — `roles.ts` 의 `scopeErrorForRole(role, scope, defaultAgent)` 가
단일 소스이고 `/api/accounts` POST 와 `[userId]` PUT 이 400 으로 거절한다.
PUT 은 요청만이 아니라 **최종 상태**로 판정한다(권한만 FIELD 로 바꾸는 경우와 FIELD 계정의 소속만
옮기는 경우를 둘 다 걸러야 한다). `/accounts` 화면이 셀렉트를 잠그는 건 UX 다.
