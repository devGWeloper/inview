import Link from "next/link";
import { ProfileCard } from "@/components/ProfileCard";
import { WorkShowcase } from "@/components/WorkShowcase";
import { readProfile } from "@/lib/profile";
import { computeFteStats } from "@/lib/fte";
import { getSession } from "@/lib/auth/current";
import { roleAtLeast } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const profile = readProfile();
  const fteStats = await computeFteStats(profile);
  const session = await getSession();
  const canReport = session ? roleAtLeast(session.role, "BR") : false;
  const canAdmin = session ? roleAtLeast(session.role, "ADMIN") : false;
  return (
    <div className="agent-page">
      <div className="agent-shell">
        <div className="agent-page-head">
          <div className="agent-page-titles">
            <div className="agent-page-title">Agent Profile</div>
            <div className="agent-page-sub">우리 팀의 AI 에이전트, {profile.name}</div>
          </div>
          {(canReport || canAdmin) && (
            <div className="agent-page-actions">
              {canReport && (
                <Link href="/report" className="agent-action primary" prefetch={false}>
                  <span className="agent-action-ico" aria-hidden>📋</span>
                  실적 리포트
                </Link>
              )}
              {canAdmin && (
                <Link href="/admin" className="agent-action" prefetch={false}>
                  <span className="agent-action-ico" aria-hidden>⚙️</span>
                  관리자 편집
                </Link>
              )}
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
