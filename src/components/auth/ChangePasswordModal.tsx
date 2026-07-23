"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";

/**
 * 본인 비밀번호 변경 모달.
 * - forced=true : 비밀번호 초기화 직후 강제 변경 (닫기 불가).
 * - 그 외        : 사용자 메뉴에서 자발적 변경 (닫기 가능).
 */
export function ChangePasswordModal({
  forced = false,
  onClose,
  onDone,
}: {
  forced?: boolean;
  onClose?: () => void;
  onDone?: () => void;
}) {
  const { refresh } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next.length < 8) { setErr("새 비밀번호는 8자 이상이어야 합니다."); return; }
    if (next !== confirm) { setErr("새 비밀번호 확인이 일치하지 않습니다."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error ?? "변경에 실패했습니다."); return; }
      setDone(true);
      await refresh();
      onDone?.();
    } catch {
      setErr("변경 처리 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-modal-backdrop" onMouseDown={forced ? undefined : onClose}>
      <form className="auth-modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="auth-modal-head">
          <div className="auth-modal-title">{forced ? "비밀번호 변경 필요" : "비밀번호 변경"}</div>
          {!forced && (
            <button type="button" className="auth-modal-x" onClick={onClose} aria-label="닫기">×</button>
          )}
        </div>
        {forced && (
          <p className="auth-modal-note">
            비밀번호가 초기화되었습니다. 계속하려면 새 비밀번호로 변경하세요.
          </p>
        )}
        {done ? (
          <div className="auth-modal-done">
            <div className="auth-modal-done-icon">✓</div>
            <div>비밀번호가 변경되었습니다.</div>
            <button type="button" className="btn primary" onClick={onClose ?? onDone}>확인</button>
          </div>
        ) : (
          <>
            <label className="auth-field">
              <span>현재 비밀번호</span>
              <input type="password" value={current} autoFocus autoComplete="current-password"
                onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <label className="auth-field">
              <span>새 비밀번호 (8자 이상)</span>
              <input type="password" value={next} autoComplete="new-password"
                onChange={(e) => setNext(e.target.value)} />
            </label>
            <label className="auth-field">
              <span>새 비밀번호 확인</span>
              <input type="password" value={confirm} autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)} />
            </label>
            {err && <div className="auth-error">{err}</div>}
            <div className="auth-modal-actions">
              {!forced && <button type="button" className="btn ghost" onClick={onClose}>취소</button>}
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? "변경 중…" : "변경"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
