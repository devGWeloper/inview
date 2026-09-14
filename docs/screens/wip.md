# 공사장 — `/wip` (ADMIN 전용)

**파일**: `src/app/wip/page.tsx` · 목록 `src/components/shell/nav.ts` 의 `WIP_SITES`
· 권한 `ROUTE_RULES` 의 `{ prefix: "/wip", min: "ADMIN" }` + 페이지의 `requireRole("ADMIN")`

만들다 만 화면이 정식 메뉴에 하나씩 붙으면 "이건 써도 되는 건가" 를 매번 되묻게 된다. 그래서
**아직 운영에 안 내보낸 화면은 전부 공사장 뒤**에 둔다. 사이드바 맨 아래 점선 박스(ADMIN 에게만)와
`/wip` 페이지가 같은 `WIP_SITES` 를 그린다.

- 항목 추가는 `WIP_SITES` 한 줄. 정식 오픈 = 거기서 지우고 `NAV_GROUPS` 의 분석/관리 그룹으로 옮긴다
- **이 목록은 표시일 뿐 접근 제어가 아니다** — 각 항목의 실제 차단은 자기 경로의 `ROUTE_RULES`/API
  가드가 한다. 여기서 지운다고 그 화면이 잠기지 않는다
- 현재: **Action 오픈 로드맵**([roadmap.md](./roadmap.md)) · **레이아웃 개편 시안**
  (`/design-preview.html`)
