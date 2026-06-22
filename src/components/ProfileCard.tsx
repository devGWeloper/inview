import { AgentProfile, FteStats } from "@/lib/types";
import { AgentAvatar } from "./AgentAvatar";
import { FteChart } from "./FteChart";

function fteDisplay(fte: number | null): string {
  if (fte === null) return "—";
  return fte.toFixed(2);
}

/**
 * 이억수 TL 프로필 카드. 좌측의 "잘 보이는" 신분증 형태 카드.
 * FTE 는 fteStats(데이터 집계)가 있으면 그 연간 FTE 를, 없으면(=DB 미연결)
 * profile.fte(수동 입력)를 폴백으로 표시한다.
 */
export function ProfileCard({
  profile,
  fteStats,
}: {
  profile: AgentProfile;
  fteStats: FteStats | null;
}) {
  const roadmapItems = profile.roadmap
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const fteValue = fteStats ? fteStats.annualFte : profile.fte;
  const fteNote = fteStats
    ? `2026-01-01 ~ 현재 · SEA 성공 ${fteStats.totalCount.toLocaleString()}건 누적`
    : profile.fteNote;

  return (
    <section className="agent-card">
      <div className="agent-card-glow" aria-hidden />

      <header className="agent-card-head">
        <AgentAvatar image={profile.avatarImage} emoji={profile.avatar} />
        <div className="agent-id">
          <div className="agent-name">{profile.name}</div>
          <div className="agent-nick">
            <span className="agent-nick-key">호칭</span>
            <span className="agent-nick-val">“{profile.nickname}”</span>
          </div>
        </div>
        <span className="agent-live" title="24시간 가동 중">
          <span className="agent-live-dot" />
          ON-DUTY
        </span>
      </header>

      {/* 소개말 — 헤더 아래 전체 폭으로 (좁은 폭에서 한 글자 외톨이 줄바뀜 방지) */}
      <div className="agent-tagline">{profile.tagline}</div>

      {/* 성과 지표 — 카드의 핵심 수치 (연간 FTE) */}
      <div className="agent-fte">
        <div className="agent-fte-num">
          <span className="agent-fte-val">{fteDisplay(fteValue)}</span>
          <span className="agent-fte-unit">FTE</span>
        </div>
        <div className="agent-fte-meta">
          <span className="agent-fte-label">연간 성과 지표</span>
          <span className="agent-fte-note">{fteNote}</span>
        </div>
      </div>

      {/* 월별 FTE 추세 차트 (DB 미연결 시 안내) */}
      {fteStats && fteStats.months.length > 0 ? (
        <FteChart stats={fteStats} />
      ) : (
        <div className="fte-chart fte-chart-empty">
          <div className="fte-chart-head">
            <span className="fte-chart-title">월별 FTE 추세</span>
          </div>
          <div className="fte-chart-empty-text">
            CUBE DB 연결 시 2026-01부터 월별 추세가 집계됩니다.
          </div>
        </div>
      )}

      {/* 스펙 그리드 */}
      <dl className="agent-specs">
        <div className="agent-spec">
          <dt>직급</dt>
          <dd>{profile.rank}</dd>
        </div>
        <div className="agent-spec">
          <dt>근무시간</dt>
          <dd>{profile.workingHours}</dd>
        </div>
        <div className="agent-spec agent-spec-wide">
          <dt>보유 스킬</dt>
          <dd className="agent-skills">
            {profile.skills.length === 0
              ? <span className="agent-skill-empty">—</span>
              : profile.skills.map((s) => (
                  <span key={s} className="agent-skill">{s}</span>
                ))}
          </dd>
        </div>
      </dl>

      {/* 라이브 가동 위젯 — 지금도 일하는 중 (데코) */}
      <div className="agent-live-widget">
        <div className="agent-eq" aria-hidden>
          <span /><span /><span /><span /><span />
        </div>
        <div className="agent-live-widget-text">
          <span className="agent-live-widget-title">지금도 일하는 중</span>
          <span className="agent-live-widget-sub">쉬는 시간 없이 맡은 일을 처리하고 있어요</span>
        </div>
        <span className="agent-live-widget-emoji" aria-hidden>🧂</span>
      </div>

      {/* 역량 강화 로드맵 */}
      <div className="agent-roadmap">
        <div className="agent-roadmap-title">역량 강화 로드맵</div>
        {roadmapItems.length === 0 ? (
          <div className="agent-roadmap-empty">아직 등록된 로드맵이 없습니다. ADMIN에서 입력하세요.</div>
        ) : (
          <ol className="agent-roadmap-list">
            {roadmapItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
