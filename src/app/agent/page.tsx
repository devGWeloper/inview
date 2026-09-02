import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileCard } from "@/features/agent/ProfileCard";
import { WorkShowcase } from "@/features/agent/WorkShowcase";
import { readProfile } from "@/lib/profile";
import { computeFteStats } from "@/lib/fte";
import { getSession, requireAgent } from "@/lib/auth/current";
import { LOWEST_ROLE, roleAtLeast } from "@/lib/roles";
import { defaultAgentId, getAgent } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function AgentPage({
  searchParams,
}: {
  searchParams?: { agent?: string };
}) {
  const raw = (searchParams?.agent ?? "").trim();
  const agentId = raw && getAgent(raw) ? raw : defaultAgentId();
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
