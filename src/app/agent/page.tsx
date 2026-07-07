import Link from "next/link";
import { ProfileCard } from "@/components/ProfileCard";
import { WorkShowcase } from "@/components/WorkShowcase";
import { readProfile } from "@/lib/profile";
import { computeFteStats } from "@/lib/fte";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const profile = readProfile();
  const fteStats = await computeFteStats(profile);
  return (
    <div className="agent-page">
      <div className="agent-shell">
        <div className="agent-page-head">
          <div className="agent-page-titles">
            <div className="agent-page-title">Agent Profile</div>
            <div className="agent-page-sub">우리 팀의 AI 에이전트, {profile.name}</div>
          </div>
          <Link href="/admin" className="btn ghost" prefetch={false}>관리자 편집</Link>
        </div>

        <div className="agent-layout">
          <ProfileCard profile={profile} fteStats={fteStats} />
          <WorkShowcase profile={profile} />
        </div>
      </div>
    </div>
  );
}
