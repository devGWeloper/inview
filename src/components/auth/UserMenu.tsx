"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { ROLE_LABEL, Role, roleAtLeast } from "@/lib/roles";
import { useAgentScope } from "@/components/agents/AgentScopeProvider";

/**
 * 권한별 관리 링크 (드롭다운). min 이상만 노출.
 * ⚠️ min 은 **화면을 볼 수 있는 최소 권한**(roles.ts ROUTE_RULES)과 같아야 한다 —
 *    BR 은 전 화면 열람이라 개선센터/이벤트-FAB 이 보이고, 그 화면의 저장만 ADMIN 이다.
 *    계정 관리·프로필 편집은 화면 자체가 쓰기 전용이라 ADMIN 에게만 노출한다.
 * ⚠️ biz 표시된 항목은 **기본 에이전트 전용**(BIZ_AIACTIONTXN_HIS 기반)이라 비기본 에이전트에서는
 * 감춘다 — TabNav 가 같은 이유로 탭을 감추는데 여기만 남기면 "메뉴엔 보이는데 누르면 튀긴다" 가 된다.
 */
const ADMIN_LINKS: { href: string; label: string; icon: string; min: Role; biz?: true }[] = [
  { href: "/improvement", label: "Improvement Center", icon: "🚀", min: "BR", biz: true },
  { href: "/event-fabs", label: "이벤트-FAB 매핑", icon: "🗂", min: "BR", biz: true },
  { href: "/accounts", label: "계정 관리", icon: "👤", min: "ADMIN" },
  { href: "/admin", label: "프로필 편집", icon: "✏️", min: "ADMIN" },
];

export function UserMenu() {
  const { user, loading, logout } = useAuth();
  const { isDefault: isDefaultAgent } = useAgentScope();
  const [open, setOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  if (loading || !user) return null;

  const initial = user.name?.trim()?.[0] ?? user.userId[0] ?? "?";
  const links = ADMIN_LINKS.filter((l) => roleAtLeast(user.role, l.min) && (isDefaultAgent || !l.biz));

  return (
    <>
      <div className="usermenu" ref={ref}>
        <button
          type="button"
          className={"usermenu-trigger" + (open ? " open" : "")}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="usermenu-avatar" aria-hidden>{initial}</span>
          <span className="usermenu-id">
            <span className="usermenu-name">{user.name || user.userId}</span>
            <span className={"usermenu-role role-" + user.role}>{ROLE_LABEL[user.role]}</span>
          </span>
          <svg className="usermenu-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M3 4.5 L6 7.5 L9 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div className="usermenu-pop" role="menu">
            <div className="usermenu-pop-head">
              <div className="usermenu-pop-name">{user.name || "—"}</div>
              <div className="usermenu-pop-sub">
                <span className="mono">{user.userId}</span>
                <span className={"usermenu-role role-" + user.role}>{ROLE_LABEL[user.role]}</span>
              </div>
            </div>

            {links.length > 0 && (
              <div className="usermenu-section">
                <div className="usermenu-section-label">관리</div>
                {links.map((l) => (
                  <Link key={l.href} href={l.href} className="usermenu-item" role="menuitem"
                    prefetch={false} onClick={() => setOpen(false)}>
                    <span className="usermenu-item-icon" aria-hidden>{l.icon}</span>
                    <span>{l.label}</span>
                  </Link>
                ))}
              </div>
            )}

            <div className="usermenu-section">
              <button type="button" className="usermenu-item" role="menuitem"
                onClick={() => { setOpen(false); setShowChangePw(true); }}>
                <span className="usermenu-item-icon" aria-hidden>🔑</span>
                <span>비밀번호 변경</span>
              </button>
              <button type="button" className="usermenu-item danger" role="menuitem"
                onClick={() => { setOpen(false); void logout(); }}>
                <span className="usermenu-item-icon" aria-hidden>⎋</span>
                <span>로그아웃</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} onDone={() => { /* keep open to show done */ }} />}
    </>
  );
}
