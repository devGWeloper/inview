import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileCard } from "@/components/ProfileCard";
import { WorkShowcase } from "@/components/WorkShowcase";
import { readProfile } from "@/lib/profile";
import { computeFteStats } from "@/lib/fte";
import { getSession, requireAgent } from "@/lib/auth/current";
import { LOWEST_ROLE, roleAtLeast } from "@/lib/roles";
import { defaultAgentId, getAgent } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * 에이전트 프로필 카드.
 *
 * ⚠️ 에이전트마다 프로필이 따로 있다(data/agent-profile[.<id>].json). `?agent=` 로 대상을 고르며,
 *    **FTE 성과 지표는 기본 에이전트만** 붙는다 — BIZ_AIACTIONTXN_HIS 집계라 다른 에이전트에
 *    대고 계산하면 남의 실적을 자기 것으로 보여주게 된다. 없으면 ProfileCard 가 '—' 로 그린다.
 */
export default async function AgentPage({
  searchParams,
}: {
  searchParams?: { agent?: string };
}) {
  const raw = (searchParams?.agent ?? "").trim();
  // 알 수 없는 id 는 기본 에이전트로 되돌린다(페이지라 400 대신 리다이렉트).
  const agentId = raw && getAgent(raw) ? raw : defaultAgentId();
  // 소개 카드는 집계·원문이 없는 공개 정보라 일반 사용자(FIELD)에게도 연다 (roles.ts FIELD_ALLOW_PREFIXES).
  const guard = await requireAgent(agentId, LOWEST_ROLE);
  if (!guard.ok) redirect(guard.status === 401 ? "/login?next=/agent" : "/403");

  const isDefault = agentId === defaultAgentId();
  const profile = readProfile(agentId);
  const fteStats = isDefault ? await computeFteStats(profile) : null;
  const session = await getSession();
  const canAdmin = session ? roleAtLeast(session.role, "ADMIN") : false;
  const adminHref = isDefault ? "/admin" : `/admin?agent=${encodeURIComponent(agentId)}`;

  return (
    <div className="agent-page">
      <div className="agent-shell">
        <div className="agent-page-head">
          <div className="agent-page-titles">
            <div className="agent-page-title">Agent Profile</div>
            <div className="agent-page-sub">우리 팀의 AI 에이전트, {profile.name}</div>
          </div>
          {canAdmin && (
            <div className="agent-page-actions">
              <Link href={adminHref} className="agent-action" prefetch={false}>
                <span className="agent-action-ico" aria-hidden>⚙️</span>
                관리자 편집
              </Link>
            </div>
          )}
        </div>

        <div className="agent-layout">
          <ProfileCard profile={profile} fteStats={fteStats} />
          <WorkShowcase profile={profile} />
        </div>
      </div>
    </div>
  );
}
