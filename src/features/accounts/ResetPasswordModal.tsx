"use client";

import React, { useState } from "react";
import { apiFetch, apiJson, errMessage, SESSION_EXPIRED_MSG } from "@/lib/apiClient";
import { Account } from "./types";

export function ResetPasswordModal({ acc, onClose, onDone }: { acc: Account; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const res = await apiFetch(`/api/accounts/${encodeURIComponent(acc.userId)}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pw.trim() ? { newPassword: pw.trim() } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error ?? "초기화 실패"); return; }
      setResult(data.tempPassword ?? pw);
      onDone();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-modal-backdrop" onMouseDown={onClose}>
      <form className="auth-modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="auth-modal-head">
          <div className="auth-modal-title">비밀번호 초기화</div>
          <button type="button" className="auth-modal-x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        {result ? (
          <div className="auth-modal-done">
            <div className="auth-modal-done-icon">✓</div>
            <div><b>{acc.name}({acc.userId})</b> 님의 비밀번호가 초기화되었습니다.</div>
            <div className="acct-temp-pw">
              <span>초기화된 비밀번호</span>
              <code>{result}</code>
            </div>
            <div className="acct-temp-note">이 값을 대상자에게 전달하세요. 이 비밀번호로 바로 로그인할 수 있습니다.</div>
            <button type="button" className="btn primary" onClick={onClose}>확인</button>
          </div>
        ) : (
          <>
            <p className="auth-modal-note">
              <b>{acc.name}({acc.userId})</b> 님의 비밀번호를 초기화합니다.<br />
              비워두면 <b>사번({acc.userId})</b>으로 초기화됩니다.
            </p>
            <label className="auth-field">
              <span>새 비밀번호 (선택 · 비우면 사번)</span>
              <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`비우면 사번(${acc.userId})`} />
            </label>
            {err && <div className="auth-error">{err}</div>}
            <div className="auth-modal-actions">
              <button type="button" className="btn ghost" onClick={onClose}>취소</button>
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? "초기화 중…" : "초기화"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
