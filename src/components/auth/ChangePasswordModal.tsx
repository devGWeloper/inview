"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";

/**
 * 본인 비밀번호 변경 모달 (항상 닫기 가능).
 * TEMP(강제 변경 비활성): forced 모드는 뺐다. docs/architecture/temp-workarounds.md
 */
export function ChangePasswordModal({
  onClose,
  onDone,
}: {
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
    <div className="auth-modal-backdrop" onMouseDown={onClose}>
      <form className="auth-modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="auth-modal-head">
          <div className="auth-modal-title">비밀번호 변경</div>
          <button type="button" className="auth-modal-x" onClick={onClose} aria-label="닫기">×</button>
        </div>
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
              <button type="button" className="btn ghost" onClick={onClose}>취소</button>
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
