"use client";

import React, { useState } from "react";
import { apiFetch, apiJson, errMessage, SESSION_EXPIRED_MSG } from "@/lib/apiClient";
import { Account } from "./types";

export function DeleteModal({ acc, onClose, onDone }: { acc: Account; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setErr(null);
    setSaving(true);
    try {
      const res = await apiFetch(`/api/accounts/${encodeURIComponent(acc.userId)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error ?? "삭제 실패"); setSaving(false); return; }
      onDone();
    } catch (e) {
      setErr(String(e)); setSaving(false);
    }
  }

  return (
    <div className="auth-modal-backdrop" onMouseDown={onClose}>
      <div className="auth-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <div className="auth-modal-title">계정 삭제</div>
          <button type="button" className="auth-modal-x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <p className="auth-modal-note">
          <b>{acc.name}({acc.userId})</b> 계정을 삭제합니다. 이 작업은 되돌릴 수 없습니다.
        </p>
        {err && <div className="auth-error">{err}</div>}
        <div className="auth-modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="button" className="btn danger-solid" disabled={saving} onClick={remove}>
            {saving ? "삭제 중…" : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
