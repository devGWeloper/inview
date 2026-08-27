"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentProfile } from "@/lib/types";
import { Role, roleAtLeast } from "@/lib/roles";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiJson } from "@/lib/apiClient";
import { useAgentScope } from "@/components/agents/AgentScopeProvider";

/**
 * 분석 성격의 탭 묶음 (세그먼트 컨트롤). Agent 는 성격이 달라 별도 칩으로 분리.
 * minRole 이 있는 탭은 그 권한 이상일 때만 노출한다 (미들웨어가 실제 접근을 막지만,
 * 못 들어갈 탭을 띄워두면 403 만 보게 되므로 메뉴에서도 감춘다).
 */
const ANALYSIS_TABS: ReadonlyArray<{
  href: string;
  label: string;
  icon: () => JSX.Element;
  minRole?: Role;
  /** 에이전트별로 갈리는 탭인가 (TRX_TOKEN_DET 기반). 비기본 에이전트에서도 남는다 */
  agentScoped?: boolean;
}> = [
  { href: "/", label: "Traces", icon: TracesIcon },
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/tokens", label: "Tokens", icon: TokensIcon, agentScoped: true },
  { href: "/timeouts", label: "Timeout", icon: TimeoutIcon, minRole: "ADMIN", agentScoped: true },
];

/** 분석 탭 세그먼트 그룹 (Traces / Dashboard / Tokens / Timeout). 상단바 가운데. */
export function TabNav() {
  const path = usePathname();
  const { user } = useAuth();
  const { isDefault } = useAgentScope();
  // 비기본 에이전트는 BIZ_AIACTIONTXN_HIS 기반 화면을 쓰지 않는다 — 탭 자체를 감춘다.
  const tabs = ANALYSIS_TABS
    .filter((t) => isDefault || t.agentScoped)
    .filter((t) => !t.minRole || (user && roleAtLeast(user.role, t.minRole)));
  return (
    <nav className="tabnav" aria-label="primary">
      <div className="tabnav-group" role="tablist">
        {tabs.map((t) => {
          const active = t.href === "/" ? path === "/" : (path?.startsWith(t.href) ?? false);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={"tab" + (active ? " active" : "")}
              prefetch={false}
              aria-current={active ? "page" : undefined}
            >
              <Icon />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Agent 프로필 칩 — 분석 탭과 성격이 달라 상단바 우측 코너에 분리 배치.
 * 실제 프로필(아바타/이름)을 띄워 '탭'이 아닌 '사람'처럼 보이게 한다.
 * 보조 UI라 로드 실패 시 기본값으로 폴백.
 */
export function AgentNavChip() {
  const path = usePathname();
  const agentActive = path?.startsWith("/agent") ?? false;

  const { agent, isDefault, ready } = useAgentScope();

  const [profile, setProfile] = useState<AgentProfile | null>(null);
  useEffect(() => {
    // ⚠️ 기본 에이전트가 아니면 /api/profile(기본) 은 403 이다 — 아예 부르지 않는다.
    //    (아래 static 칩이 config 의 이름/아바타로 그린다)
    if (!ready || !isDefault) return;
    let alive = true;
    apiJson<{ profile: AgentProfile }>("/api/profile", { cache: "no-store" })
      .then((d) => { if (alive && d?.profile) setProfile(d.profile); })
      .catch(() => {});
    return () => { alive = false; };
  }, [ready, isDefault]);

  // 비기본 에이전트도 프로필 카드를 갖는다(FTE 없는 축소판) — ?agent= 로 그 프로필을 연다.
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

/* ── inline icons (currentColor, 16px) ─────────────────────────────── */
function TracesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4h12M2 8h12M2 12h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="13" cy="12" r="1.3" fill="currentColor" />
    </svg>
  );
}
function DashboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="10.5" width="5" height="3.5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="2" width="5" height="3.5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="7.5" width="5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function TimeoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="9" r="5.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 6.2V9l2 1.4M6 2h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function TokensIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <ellipse cx="8" cy="4" rx="5.2" ry="2.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.8 4v4c0 1.2 2.33 2.2 5.2 2.2s5.2-1 5.2-2.2V4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.8 8v4c0 1.2 2.33 2.2 5.2 2.2s5.2-1 5.2-2.2V8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
