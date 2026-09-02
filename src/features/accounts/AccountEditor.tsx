"use client";

import React, { useEffect, useState } from "react";
import { ROLES, ROLE_LABEL, ROLE_DESC, Role } from "@/lib/roles";
import { apiFetch, apiJson, errMessage, SESSION_EXPIRED_MSG } from "@/lib/apiClient";
import { AgentInfo } from "@/lib/types";
import { Account } from "./types";

export function AccountEditor({
  mode, acc, meRole, agents, agentsLoaded, canGrantGlobal, onClose, onSaved,
}: {
  mode: "create" | "edit"; acc?: Account; meRole?: Role;
  agents: AgentInfo[]; agentsLoaded: boolean; canGrantGlobal: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const [userId, setUserId] = useState(acc?.userId ?? "");
  const [name, setName] = useState(acc?.name ?? "");
  const [work, setWork] = useState(acc?.work ?? "");
  const [role, setRole] = useState<Role>(acc?.role ?? "DEV");
  const [useYn, setUseYn] = useState<"Y" | "N">(acc?.useYn ?? "Y");
  const [agentId, setAgentId] = useState(
    acc ? (acc.global ? "" : (acc.agentId ?? "__none")) : (agents.find((a) => a.isDefault)?.id ?? "")
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const assignableRoles = ROLES.filter(
    (r) => r !== "ADMIN" || meRole === "ADMIN" || acc?.role === "ADMIN"
  );

  const canEditAgent = meRole === "ADMIN" && canGrantGlobal && agentsLoaded;
  const defaultAgent = agents.find((a) => a.isDefault)?.id ?? "";
  const fieldFixed = role === "FIELD";
  useEffect(() => {
    if (fieldFixed && agentsLoaded && agentId !== defaultAgent) setAgentId(defaultAgent);
  }, [fieldFixed, agentsLoaded, defaultAgent, agentId]);
  const showAgent = canGrantGlobal || agents.length > 1 || !!acc?.agentId || acc?.global === true;
  const agentOptions = [
    ...agents.map((a) => ({ id: a.id, label: `${a.avatar} ${a.name}` })),
    ...(acc?.agentId && !agents.some((a) => a.id === acc.agentId)
      ? [{ id: acc.agentId, label: `${acc.agentId} (설정에 없음)` }] : []),
    ...(acc && !acc.global && !acc.agentId ? [{ id: "__none", label: "미배정 (조회 불가)" }] : []),
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const current = acc ? (acc.global ? "" : (acc.agentId ?? "__none")) : null;
      const changed = mode === "create" || agentId !== current;
      const agentPatch = canEditAgent && changed
        ? (agentId === ""
            ? { global: true }
            : { global: false, agentId: agentId === "__none" ? null : agentId })
        : {};
      let res: Response;
      if (mode === "create") {
        res = await apiFetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, name, work, role, useYn, ...agentPatch }),
        });
      } else {
        res = await apiFetch(`/api/accounts/${encodeURIComponent(acc!.userId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, work, role, useYn, ...agentPatch }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error ?? "저장 실패"); return; }
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-modal-backdrop" onMouseDown={onClose}>
      <form className="auth-modal wide" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="auth-modal-head">
          <div className="auth-modal-title">{mode === "create" ? "새 계정 등록" : `계정 수정 · ${acc?.userId}`}</div>
          <button type="button" className="auth-modal-x" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="auth-grid">
          <label className="auth-field">
            <span>사번 {mode === "create" && <em className="req">*</em>}</span>
            <input value={userId} disabled={mode === "edit"}
              onChange={(e) => setUserId(e.target.value)} placeholder="예: 12345678" />
          </label>
          <label className="auth-field">
            <span>이름 <em className="req">*</em></span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" />
          </label>
        </div>

        <label className="auth-field">
          <span>업무</span>
          <input value={work} onChange={(e) => setWork(e.target.value)} placeholder="담당 업무" />
        </label>

        <div className="auth-field">
          <span>권한</span>
          <div className="acct-role-pick">
            {assignableRoles.map((r) => (
              <button type="button" key={r}
                className={"acct-role-opt role-" + r + (role === r ? " active" : "")}
                onClick={() => setRole(r)}>
                <span className="acct-role-opt-name">{ROLE_LABEL[r]}</span>
                <span className="acct-role-opt-desc">{ROLE_DESC[r]}</span>
              </button>
            ))}
          </div>
        </div>

        {showAgent && (
          <label className="auth-field">
            <span>에이전트</span>
            <select value={agentId} disabled={!canEditAgent || fieldFixed} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">전역 (모든 에이전트)</option>
              {agentOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <em className="auth-hint">
              {fieldFixed
                ? "일반 사용자 계정은 기본 에이전트 소속만 가능합니다 — 실적 화면이 기본 에이전트 집계입니다."
                : canEditAgent
                ? "에이전트를 고르면 그 에이전트만 보고 관리합니다. 전역은 모든 에이전트를 오갈 수 있습니다."
                : "에이전트 범위는 전역 운영자만 변경할 수 있습니다. 새 계정은 내 에이전트 소속으로 만들어집니다."}
            </em>
          </label>
        )}

        {mode === "create" && (
          <div className="acct-initpw-note">
            <span className="acct-initpw-ic" aria-hidden>🔑</span>
            <span>
              초기 비밀번호는 <b>사번과 동일</b>하게 설정됩니다. 변경은 사용자가 <b>원할 때</b> 계정 메뉴에서 하면 됩니다.
            </span>
          </div>
        )}

        {mode === "edit" && (
          <label className="auth-check">
            <input type="checkbox" checked={useYn === "Y"} onChange={(e) => setUseYn(e.target.checked ? "Y" : "N")} />
            <span>계정 활성화 (해제 시 로그인 차단)</span>
          </label>
        )}

        {err && <div className="auth-error">{err}</div>}

        <div className="auth-modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "저장 중…" : mode === "create" ? "등록" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
