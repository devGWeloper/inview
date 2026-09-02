# Agent 프로필 — `/agent`, `/admin`

트레이스 뷰어와는 별개의 부가 기능. 팀의 AI 에이전트를 소개하는 프로필 카드 + "하는 일" 목록.

**파일**
- 화면: `src/app/agent/page.tsx`(서버 컴포넌트) · `src/app/admin/page.tsx`(편집 폼)
- 컴포넌트: `src/features/agent/` — `ProfileCard` `WorkShowcase` · 대시보드 상단 `ProfileStrip`
- 공용: `src/components/ui/AgentAvatar` · `src/components/charts/FteChart`
- API: `src/app/api/profile/route.ts`
- 저장: `src/lib/profile.ts` · FTE 계산 `src/lib/fte.ts`
- 스타일: `src/styles/agent.css`
- 권한: `/agent` GET = `requireAgent(id, LOWEST_ROLE)`(FIELD 포함) / `/admin` · PUT =
  대상 에이전트의 ADMIN(`requireAgentAdmin`)

## 데이터 모델

`AgentProfile`. 업무는 정형/비정형 구분 없는 **단일 `tasks: WorkTask[]`** 배열(배열 순서 = 표시 순서).
`DEFAULT_PROFILE` 이 기본값.

## 저장

`data/agent-profile.json`(DB 아님, gitignore).
`normalizeProfile()` 이 부분/구버전 데이터를 항상 완전한 객체로 보정하며, 구버전의
`formalTasks`/`informalTasks` 는 읽을 때 `tasks` 로 자동 병합한다.

**에이전트마다 따로다** — `data/agent-profile.json`(기본, 파일명 유지) /
`data/agent-profile.<id>.json`.
비기본 에이전트는 **FTE 섹션이 없다**(BIZ 집계라 남의 실적이 된다).
`/admin` 은 전역 운영자에게 편집 대상 셀렉터를 띄우고, 에이전트 운영자에게는 자기 것 하나만 온다.

## 화면

사진은 `public/` 에 올리고 `avatarImage` 에 `/파일명` 을 지정한다(없거나 로드 실패 시 `avatar`
이모지로 폴백 — `AgentAvatar`). `/admin` 의 업무 목록은 드래그앤드롭으로 순서를 바꾼다.

`/agent` 헤더의 리포트/관리자 버튼은 서버에서 세션 권한으로 조건부 노출된다.

## FTE 성과 지표

계산식과 커스터마이즈 필드는 [metrics.md](../architecture/metrics.md) 참고.
`/admin` 의 "성과 지표 (FTE)" 섹션에서 편집한다.

## TPM/RPM 한도

`/admin` 의 "사용량 한도"(`tpmLimit`/`rpmLimit`). 우선순위는 **프로필 > config.yml**,
병합 지점은 `/api/agents` 한 곳 → [agents.md](../architecture/agents.md)
