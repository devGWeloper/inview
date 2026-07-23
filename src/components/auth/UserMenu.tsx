"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { ROLE_LABEL, Role, roleAtLeast } from "@/lib/roles";

/** 권한별 관리 링크 (드롭다운). min 이상만 노출. */
const ADMIN_LINKS: { href: string; label: string; icon: string; min: Role }[] = [
  { href: "/report", label: "실적 리포트", icon: "📋", min: "BR" },
  { href: "/improvement", label: "Improvement Center", icon: "🚀", min: "BR" },
  { href: "/event-fabs", label: "이벤트-FAB 매핑", icon: "🗂", min: "BR" },
  { href: "/accounts", label: "계정 관리", icon: "👤", min: "BR" },
  { href: "/admin", label: "프로필 편집", icon: "✏️", min: "ADMIN" },
];

export function UserMenu() {
  const { user, loading, logout } = useAuth();
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
  const links = ADMIN_LINKS.filter((l) => roleAtLeast(user.role, l.min));

  return (
    <>
      {/* 비밀번호 초기화 직후엔 강제 변경 */}
      {user.mustChangePw && <ChangePasswordModal forced onClose={() => { /* 변경 완료 시 refresh 로 해제됨 */ }} />}

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
