# Link Board — 사이드바 플라이아웃 (전용 화면 없음)

개발하며 자주 여는 사이트를 사이드바 **도구 › Link Board** 에서 펼쳐 바로 여는 기능.
**라우트가 없다** — 어느 화면에 있든 현재 화면을 떠나지 않고 패널만 뜨고, 링크는 새 탭으로 열린다.

**파일**
- 트리거 + 상태: `src/components/shell/link-board/LinkBoardNav.tsx` (사이드바 버튼 · 패널 위치 · 조회/저장)
- 패널 내용: `src/components/shell/link-board/LinkPanel.tsx` (검색 · 태그 필터 · 그룹 · 행)
- 편집 팝업: `src/components/shell/link-board/LinkEditor.tsx` (ADMIN 전용)
- 사이드바 배치: `src/components/shell/Sidebar.tsx` 의 `도구` 그룹
- API: `src/app/api/link-board/route.ts`
- 저장: `src/lib/linkBoard.ts` → `data/links.json` (fs, gitignore)
- 순수 로직 · 타입: `src/lib/types/links.ts` (`groupLinks`/`allTags`/`matchesQuery`/`hostOf`)
- 스타일: `src/styles/link-board.css` (`lb-*`)
- 권한: **읽기 DEV 이상 / 쓰기 전역 ADMIN**

## 메뉴가 아니라 패널이다

`NAV_GROUPS`(`nav.ts`)에 **넣지 않는다.** 그쪽은 `href` 기반이라 미들웨어 인가·`locatePage`
(상단 빵부스러기)·활성 표시가 전부 "이동"을 전제로 움직인다. Link Board 는 이동하지 않으므로
`Sidebar.tsx` 가 `도구` 그룹을 직접 그리고 그 안에 `<LinkBoardNav>` 버튼을 둔다.

패널은 **`createPortal` 로 `document.body`** 에 붙인다. `.sidenav-scroll` 안에 두면 스크롤 영역에
갇힌다. 위치는 트리거의 `getBoundingClientRect()` 로 계산해 `left`/`bottom`/`maxHeight` 를 주는데,
**버튼 밑선 기준으로 위로 자란다** — 도구 그룹이 사이드바 맨 아래라 아래로 펴면 화면 밖으로 나간다.
메뉴가 접힌 상태(64px 레일)에서도 같은 계산이 그대로 맞는다.

링크 목록은 **처음 펼칠 때 한 번만** 불러온다(`loaded` ref). 저장하면 응답으로 갱신된다.

## 즐겨찾기는 개인 것, 목록은 공용

- 목록(`data/links.json`)은 앱 전체에 1벌이고 편집은 전역 ADMIN 하나다.
- 핀은 **브라우저 `localStorage`(`tracex.linkPins`)** 에만 남는다. 서버로 보내지 않는다 —
  공용 데이터에 넣으면 남의 핀이 내 목록 순서를 흔들고, 편집 권한 없는 DEV 는 핀도 못 누른다.
- 핀된 링크는 위 `즐겨찾기` 줄로 **옮겨 간다**(원래 카테고리에서는 빠진다). 330px 패널에서 같은
  줄이 두 번 보이면 목록이 두 배로 길어진다.

## 카테고리는 저장하지 않는다

별도 목록 없이 `LinkItem.category` 에서 파생하고, **그룹 순서는 `links` 배열에서 처음 나온 순서**다
(`groupLinks`). 비우면 `미분류`. 카테고리 이름을 바꾸려면 그 카테고리의 링크를 다 고쳐야 한다 —
링크 수십 개짜리 보드에서 그게 별도 관리 화면보다 싸다.

## 저장 · 검증

저장은 **그때마다 전체 목록을 PUT** 한다(화면이 '저장 안 한 변경' 을 들고 있지 않게).
`normalizeLinkBoard()` 가 부분/깨진 입력을 보정한다 — `id` 중복·경로문자 제거, 태그 8개·링크 500개
상한, 길이 자르기, **URL 은 `http`/`https` 만 통과**(스킴이 없으면 `https://` 를 붙이고, 그 외
스킴은 행을 버린다. `javascript:` 가 앵커에 실리면 안 된다). 편집 팝업도 같은 스킴 보정을 하지만
권위는 서버다.

## 권한

- 조회 `GET /api/link-board`: `requireRole("DEV")`. `roles.ts` `ROUTE_RULES` 에 `/api/link-board`
  = DEV. FIELD 는 allow-list 방식이라 자동으로 빠진다(현장 사용자에게 개발 링크는 필요 없다).
- 쓰기 `PUT`: **`requireGlobalAdmin()`**. `requireAgentAdmin` 을 쓰면 안 된다 — 에이전트 하나에
  매인 운영자가 앱 공용 문서를 고치게 된다. 패널의 `canEdit`(`role==="ADMIN" && user.global`)은 UX 다.
- 사이드바 노출도 `roleAtLeast(user.role, "DEV")` 로 같은 선을 쓴다.
- **BIZ 경로가 아니다** — `isBizPath`/`requireBiz` 를 붙이지 않는다. 에이전트 범위와 무관한 파일이다.

## 그 밖에

- **파비콘을 받아오지 말 것.** 운영은 폐쇄망이라 외부 파비콘 요청은 깨진 아이콘만 남긴다.
  호스트명 해시로 색을 정한 글자 칩(`lb-mark`, `--lb-h`)이 그 자리를 대신한다.
- 링크는 `target="_blank" rel="noreferrer noopener"` 로만 연다.
- 행의 설명은 툴팁(`title`)으로 간다. 패널이 좁아 제목·호스트 두 줄이 한계다.
- 태그 여러 개를 고르면 **모두 가진** 링크만 남는다(AND).
