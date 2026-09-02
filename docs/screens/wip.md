# 공사장 — `/wip` (ADMIN 전용)

**파일**: `src/app/wip/page.tsx` · 권한 `ROUTE_RULES` 의 `{ prefix: "/wip", min: "ADMIN" }`
+ 페이지의 `requireRole("ADMIN")`

만들다 만 화면이 상단 탭이나 유저 메뉴에 하나씩 붙으면 정식 화면과 섞여 "이건 써도 되는 건가" 를
매번 되묻게 된다. 그래서 **아직 운영에 안 내보낸 화면은 전부 `/wip` 뒤**에 두고, 상단바에는 점선 칩
하나(`.wip-entry`, ADMIN 에게만 렌더)만 남긴다.

- 항목 추가는 `SITES` 배열 한 줄. 정식 오픈 = 거기서 지우고 `TabNav`(또는 `UserMenu`)로 옮긴다
- **이 목록은 표시일 뿐 접근 제어가 아니다** — 각 항목의 실제 차단은 자기 경로의 `ROUTE_RULES`/API
  가드가 한다. 여기서 지운다고 그 화면이 잠기지 않는다
- 현재: **Action 오픈 로드맵**([roadmap.md](./roadmap.md)) · **레이아웃 개편 시안**
  (`/design-preview.html`)
