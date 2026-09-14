"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentProfile } from "@/lib/types";
import { apiJson } from "@/lib/apiClient";
import { useAgentScope } from "@/components/agents/AgentScopeProvider";

export function AgentNavChip() {
  const path = usePathname();
  const agentActive = path?.startsWith("/agent") ?? false;

  const { agent, isDefault, ready } = useAgentScope();

  const [profile, setProfile] = useState<AgentProfile | null>(null);
  useEffect(() => {
    if (!ready || !isDefault) return;
    let alive = true;
    apiJson<{ profile: AgentProfile }>("/api/profile", { cache: "no-store" })
      .then((d) => { if (alive && d?.profile) setProfile(d.profile); })
      .catch(() => {});
    return () => { alive = false; };
  }, [ready, isDefault]);

  if (!isDefault && agent) {
    const href = `/agent?agent=${encodeURIComponent(agent.id)}`;
    return (
      <Link
        href={href}
        className={"nav-agent" + (agentActive ? " active" : "")}
        prefetch={false}
        aria-current={agentActive ? "page" : undefined}
        title={`${agent.name} · 프로필 보기`}
      >
        <span className="nav-agent-photo" aria-hidden>
          <span className="nav-agent-emoji">{agent.avatar}</span>
        </span>
        <span className="nav-agent-id">
          <span className="nav-agent-name">{agent.name}</span>
          <span className="nav-agent-status">
            <span className="nav-agent-dot" />
            <span className="nav-agent-live">근무중</span>
            <span className="nav-agent-role">AI AGENT</span>
          </span>
        </span>
      </Link>
    );
  }

  const avatarImg = profile?.avatarImage?.trim() || "";
  const emoji = profile?.avatar || "🧑‍🍳";
  const name = profile?.name || "Agent";

  return (
    <Link
      href="/agent"
      className={"nav-agent" + (agentActive ? " active" : "")}
      prefetch={false}
      aria-current={agentActive ? "page" : undefined}
      title={`${name} · 프로필 보기`}
    >
      <span className={"nav-agent-photo" + (avatarImg ? " has-image" : "")} aria-hidden>
        {avatarImg ? <img src={avatarImg} alt="" /> : <span className="nav-agent-emoji">{emoji}</span>}
      </span>
      <span className="nav-agent-id">
        <span className="nav-agent-name">{name}</span>
        <span className="nav-agent-status">
          <span className="nav-agent-dot" />
          <span className="nav-agent-live">근무중</span>
          <span className="nav-agent-role">AI AGENT</span>
        </span>
      </span>
    </Link>
  );
}
