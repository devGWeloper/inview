"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { ROLE_LABEL } from "@/lib/roles";

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
