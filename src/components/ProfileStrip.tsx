"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentProfile, FteStats } from "@/lib/types";

function fteDisplay(fte: number | null): string {
  return fte === null ? "—" : fte.toFixed(2);
}

/**
 * 대시보드 상단에 얹는 컴팩트 프로필 스트립.
 * 전용 페이지(/agent)의 요약본 — 한눈에 보이는 위치에 에이전트 정체성을 노출한다.
 */
export function ProfileStrip() {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [fteStats, setFteStats] = useState<FteStats | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (!res.ok) return;
        const data: { profile: AgentProfile; fteStats: FteStats | null } = await res.json();
        if (alive) {
          setProfile(data.profile);
          setFteStats(data.fteStats ?? null);
        }
      } catch {
        /* ignore — 스트립은 보조 UI라 실패해도 대시보드는 그대로 동작 */
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!profile) return null;

  const fteValue = fteStats ? fteStats.annualFte : null;

  return (
    <Link href="/agent" className="profile-strip" prefetch={false}>
      <span className={"profile-strip-avatar" + (profile.avatarImage ? " has-image" : "")} aria-hidden>
        {profile.avatarImage
          ? <img src={profile.avatarImage} alt="" />
          : profile.avatar}
      </span>
      <span className="profile-strip-id">
        <span className="profile-strip-name">{profile.name}</span>
        <span className="profile-strip-tagline">{profile.tagline}</span>
      </span>
      <span className="profile-strip-divider" aria-hidden />
      <span className="profile-strip-fte">
        <span className="profile-strip-fte-val">{fteDisplay(fteValue)}</span>
        <span className="profile-strip-fte-unit">FTE</span>
      </span>
      <span className="profile-strip-meta">
        <span className="profile-strip-chip">{profile.rank}</span>
        <span className="profile-strip-chip">{profile.workingHours}</span>
        {profile.skills.map((s) => (
          <span key={s} className="profile-strip-chip skill">{s}</span>
        ))}
      </span>
      <span className="profile-strip-cta" aria-hidden>프로필 보기 →</span>
    </Link>
  );
}
