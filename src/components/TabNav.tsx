"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentProfile } from "@/lib/types";

/** 분석 성격의 탭 묶음 (세그먼트 컨트롤). Agent 는 성격이 달라 별도 칩으로 분리. */
const ANALYSIS_TABS = [
  { href: "/", label: "Traces", icon: TracesIcon },
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/tokens", label: "Tokens", icon: TokensIcon },
] as const;

/** 분석 탭 세그먼트 그룹 (Traces / Dashboard / Tokens). 상단바 가운데. */
export function TabNav() {
  const path = usePathname();
  return (
    <nav className="tabnav" aria-label="primary">
      <div className="tabnav-group" role="tablist">
        {ANALYSIS_TABS.map((t) => {
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

  const [profile, setProfile] = useState<AgentProfile | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/profile", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { profile: AgentProfile } | null) => {
        if (alive && d?.profile) setProfile(d.profile);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

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
      <span className={"nav-agent-avatar" + (avatarImg ? " has-image" : "")} aria-hidden>
        {avatarImg ? <img src={avatarImg} alt="" /> : <span>{emoji}</span>}
        <span className="nav-agent-status-dot" />
      </span>
      <span className="nav-agent-id">
        <span className="nav-agent-name">{name}</span>
        <span className="nav-agent-status">
          <span className="nav-agent-role">AI AGENT</span>
          <span className="nav-agent-live">근무중</span>
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
function TokensIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <ellipse cx="8" cy="4" rx="5.2" ry="2.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.8 4v4c0 1.2 2.33 2.2 5.2 2.2s5.2-1 5.2-2.2V4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.8 8v4c0 1.2 2.33 2.2 5.2 2.2s5.2-1 5.2-2.2V8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
