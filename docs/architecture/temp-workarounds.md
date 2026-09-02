# 임시 조치 (제거 예정)

이 문서의 항목은 전부 **한시적**이다. 코드에서는 `// TEMP(...)` 마커로 찾을 수 있다.

---

## TEMP(ONEOIS) — 미연결 status 보정

**배경**: ONEOIS 레이어의 DB 연결이 아직 없어 모든 트레이스가 `allComplete=false` 가 되고,
에러 코드 없는 트레이스가 전부 `pending`(대시보드 PARTIAL)으로 분류돼 대시보드/목록 값이 무의미해졌다.

**규칙**: `errCd` 없는 pending 트레이스를 CUBE 레이어의 `respMsgCtn` 으로 재판정한다.
- CUBE RESP 에 액션 실패 문구 포함 → `fail`
- 그 외 → `ok`

실패 문구는 `ACTION_FAIL_RULES` 에 정의한다. 새 액션이 생기면 여기 한 줄 추가:

| 액션 | 문구 | 가상 코드 |
|---|---|---|
| 시즈닝 | `Seasoning 실패` | `FAIL_SEASONING` |
| AutoQual 취소 | `AutoQual 취소 실패` | `FAIL_AQ_CANCEL` |
| AutoQual 실행 | `AutoQual 실행 실패` | `FAIL_AQ_RUN` |

가상 코드는 DB 에 존재하지 않고 Top Errors 노출용이다.

**구현 위치**
- `src/lib/tempStatus.ts` — 파일 전체가 삭제 대상.
  `ACTION_FAIL_RULES` · `ACTION_FAIL_PHRASES` · `ACTION_FAIL_LABELS` ·
  `matchedActionFailCodes(rows)` · `hasActionFailure(rows)` · `classifyPendingByCubeResp(rows)`
- `src/app/api/traces/route.ts` / `src/lib/stats.ts` 의 `classify()` — pending 분기를
  `classifyPendingByCubeResp` 로 교체
- `src/lib/stats.ts` 트레이스 루프 — `matchedActionFailCodes(list)` 의 가상 코드를 `errCount` 에
  +1 해서 Top Errors 에 노출(제외 필터 `excludeErrCds` 도 같은 코드로 매칭)
- `src/lib/bizTickStats.ts` — 틱 뷰의 실패 판정
- `src/lib/db.ts` `monthlyActionSuccess()` — FTE 집계의 성공 제외
- `src/app/api/insights/route.ts` — `ACTION_FAIL_LABELS` 로 실패 사유 표기

**알려진 갭**: 가상 코드는 **트레이스 단위** 집계(도넛/시계열/Top Errors/byAction)에만 반영된다.
**행 단위** 집계인 `layers[].failCount`/`errCount`/`okRows` 는 보정되지 않아 액션 실패 트레이스의
CUBE 행이 `okRows` 로 잡힐 수 있다. 의도된 트레이드오프.

**원복 방법**
1. `src/lib/tempStatus.ts` 삭제
2. 위 파일들의 `from "@/lib/tempStatus"` import 제거
3. `classify()` 의 pending 분기를 원복: `if (errs.length === 0) return allComplete ? "ok" : "pending";`
4. `stats.ts` 의 Top Errors 보정 블록 삭제. `insights/route.ts` 도 같이 정리
   (가상 코드가 사라지면 `toInsightsErrors` 는 `TRX_ERRMSG_COD` 마스터만 보면 된다)
5. `db.ts` `monthlyActionSuccess()` 의 '액션 성공' 정의를 정식 기준(allComplete + errCd 없음)으로 재정의

---

## TEMP(WORK_GROUP) — 요청 묶음 추론

**배경**: GAIA 는 **요청 1건 = TRACE_ID 1건**으로 기록하지만, 현장 작업 1건은 여러 요청에 걸친다
(`전값 측정 → (SEA) → 후값 측정 → ERMAP`). `src/lib/workGroup.ts` 가 작업 경계를 추론해 목록이
작업당 한 행을 보이게 한다. 규칙과 제외 액션은 파일 헤더 참고.

**제약**
- **묶을 수 있는 건 GAIA 뿐이다.** 챔버 id 는 `SEND_MSG_CTN`(MCP 에 넘기는 파라미터)에 있다.
  CUBE 는 자연어뿐이고 MCP/ONEOIS 는 `ACTION_TYP` 을 기록하지 않는다
- **소스 쿼리는 매칭된 트레이스 시간 범위의 양쪽으로 `WORK_WINDOW_HOURS` 만큼 넓힌다**
  (`buildWorks()`). 안 그러면 날짜 필터에 걸친 작업이 둘로 쪼개진다
- **필터는 어떤 묶음을 찾을지를 정하지, 묶음이 무엇을 담을지는 정하지 않는다.**
  매칭된 트레이스를 묶음으로 해석한 뒤 빠진 형제 트레이스를 필터 없이 가져온다
- **실패는 무해하다.** GAIA 쿼리가 실패하거나 미구성이면 매핑이 비고 모든 트레이스가 1건짜리
  묶음이 된다 (= 묶기 이전 화면)

**"묶음만" 조회는 순서가 반대다** (`groupedOnly=true` → `resolveGroupedTraceIds`).
목록 상한이 트레이스 단위라 묶음이 드문 기간엔 최근 N 트레이스 안에 묶음이 하나도 안 걸려 화면이
계속 빈다. 그래서 이 경로는 GAIA 소스(`fetchWorkGroupRows`, 4컬럼·최근 5000행)로 묶음을 먼저
산출하고 TRACE 2건 이상인 묶음만 최신순으로 골라 그 묶음의 TRACE 를 통째로 가져온다.
나머지 조건(FAC/ACTION/USER/에러)은 "그 조건에 걸린 TRACE 를 가진 묶음" 으로 본다.
`buildWorks(summaries, preInfo)` 가 기존 매핑을 재사용해 GAIA 재조회는 없다.

**원복**: GAIA 가 진짜 `TXN_ID` 를 갖게 되면 `workGroup.ts` 의 추론만 교체한다.
`WorkSummary` · API 형태 · UI 는 그대로 둔다.

---

## TEMP(PWD) — 비밀번호 강제 변경 비활성

**배경**: 권한별 실질 로직이 아직 적고 내부 인원끼리만 쓰는 단계라 "최초 로그인 시 강제 변경" 이
번거로움만 됐다. 기능 폐기가 아니라 **임시 비활성** — 외부/타 조직에 열 때 되살린다.

**현재**: 계정 생성·관리자 초기화 후에도 사번 그대로 로그인하고, 변경은 사용자 메뉴에서 자율로만.
`TRX_USER_MAS.MUST_CHG_YN` 컬럼/제약은 그대로 두되 앱은 항상 `'N'` 만 쓰고 읽지 않는다
(기존 `'Y'` 행이 남아 있어도 무해).

**비활성 지점**
- `src/lib/users.ts` — `ensureSeedAdmin`/`createUser` INSERT 가 `'N'` 고정, `resetPassword` 도 `'N'`.
  `UserAccount.mustChangePw`/`CreateUserInput.mustChangePw`/`SELECT_COLS` 의 `MUST_CHG_YN` 제거됨
- `src/components/auth/ChangePasswordModal.tsx` — `forced` prop 제거(항상 닫기 가능)
- `src/components/auth/UserMenu.tsx` — 강제 모달 렌더 제거
- `src/app/api/auth/me/route.ts` — 강제 여부 확인용 `getUser()` 재조회 제거
- `src/app/api/auth/login/route.ts` · `AuthProvider`(`SessionUser`) · `/accounts` — 필드/배지 제거

**되살리는 법**: 위를 역순으로 복원한다. `MUST_CHG_YN` 을 `SELECT_COLS`/`UserAccount` 에 다시 넣고
(생성 `'Y'`, `resetPassword` `'Y'`), `/api/auth/me` 가 계정을 되읽어 `mustChangePw` 를 내리게 한 뒤,
`ChangePasswordModal` 의 `forced` 모드와 `UserMenu` 의 강제 렌더를 되살린다.
DB 마이그레이션 불필요. 남아 있는 `'Y'` 행을 한 번 정리할지 판단할 것.
