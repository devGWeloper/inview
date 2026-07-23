"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ROLES, ROLE_LABEL, ROLE_DESC, Role } from "@/lib/roles";

interface Account {
  userId: string;
  name: string;
  work: string | null;
  role: Role;
  useYn: "Y" | "N";
  mustChangePw: boolean;
  lastLoginDt: string | null;
  regDt: string | null;
}

function fmt(ts: string | null): string {
  return ts ? ts.replace("T", " ").slice(0, 16) : "—";
}

export default function AccountsPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<Account[]>([]);
  const [available, setAvailable] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // 모달 상태
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; acc?: Account } | null>(null);
  const [resetFor, setResetFor] = useState<Account | null>(null);
  const [deleteFor, setDeleteFor] = useState<Account | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) { setAvailable(false); setReason(data.error ?? "불러오기 실패"); setUsers([]); return; }
      setAvailable(data.available);
      setReason(data.reason ?? null);
      setUsers(data.users ?? []);
    } catch (e) {
      setAvailable(false); setReason(String(e)); setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = users.filter((u) => {
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return (
      u.userId.toLowerCase().includes(t) ||
      u.name.toLowerCase().includes(t) ||
      (u.work ?? "").toLowerCase().includes(t)
    );
  });

  const counts = {
    total: users.length,
    admin: users.filter((u) => u.role === "ADMIN").length,
    br: users.filter((u) => u.role === "BR").length,
    dev: users.filter((u) => u.role === "DEV").length,
    off: users.filter((u) => u.useYn === "N").length,
  };

  return (
    <div className="acct-page">
      <div className="acct-hero">
        <div className="acct-hero-glow" aria-hidden />
        <div className="acct-hero-main">
          <div className="acct-hero-ic" aria-hidden>
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
              <circle cx="9" cy="8.5" r="3.3" stroke="#fff" strokeWidth="1.8" />
              <path d="M3.5 19c.6-3 2.9-4.7 5.5-4.7s4.9 1.7 5.5 4.7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="17.5" cy="9.5" r="2.4" stroke="#fff" strokeWidth="1.6" opacity=".85" />
              <path d="M15 18c.4-2 1.6-3.2 3.2-3.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".85" />
            </svg>
          </div>
          <div className="acct-hero-titles">
            <h1 className="acct-hero-title">계정 관리</h1>
            <p className="acct-hero-sub">사번으로 로그인하는 사용자 계정과 권한을 관리합니다.</p>
            <div className="acct-hero-pills">
              <span className="acct-hero-pill total"><b>{counts.total}</b> 전체</span>
              <span className="acct-hero-pill role-ADMIN"><b>{counts.admin}</b> 운영자</span>
              <span className="acct-hero-pill role-BR"><b>{counts.br}</b> BR</span>
              <span className="acct-hero-pill role-DEV"><b>{counts.dev}</b> 개발자</span>
              {counts.off > 0 && <span className="acct-hero-pill off"><b>{counts.off}</b> 비활성</span>}
            </div>
          </div>
        </div>
        <button type="button" className="btn primary acct-hero-add" onClick={() => setEditor({ mode: "create" })}>
          <span className="acct-hero-add-plus" aria-hidden>+</span> 새 계정
        </button>
      </div>

      {!available && (
        <div className="acct-warn">
          계정 저장소를 사용할 수 없습니다. {reason && <span className="mono">({reason})</span>}
          <div className="acct-warn-sub">
            앱 자체 DB(GAIA)에 <code>TRX_USER_MAS</code> 테이블이 필요합니다 — <code>sql/create_trx_user_mas.sql</code> 참고.
          </div>
        </div>
      )}

      <div className="acct-toolbar">
        <input
          className="acct-search"
          placeholder="사번 · 이름 · 업무 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="acct-count">{filtered.length} / {users.length}</span>
      </div>

      <div className="acct-table-wrap">
        <table className="acct-table">
          <thead>
            <tr>
              <th>사번</th>
              <th>이름</th>
              <th>업무</th>
              <th>권한</th>
              <th>상태</th>
              <th>최근 로그인</th>
              <th className="acct-actions-h">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="acct-empty">불러오는 중…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="acct-empty">계정이 없습니다.</td></tr>
            )}
            {filtered.map((u) => (
              <tr key={u.userId} className={u.useYn === "N" ? "off" : ""}>
                <td className="mono strong">{u.userId}{me?.userId === u.userId && <span className="acct-you">나</span>}</td>
                <td>{u.name}{u.mustChangePw && <span className="acct-flag" title="다음 로그인 시 비밀번호 변경 필요">PW</span>}</td>
                <td className="acct-work">{u.work || "—"}</td>
                <td><span className={"acct-role role-" + u.role}>{ROLE_LABEL[u.role]}</span></td>
                <td>
                  {u.useYn === "Y"
                    ? <span className="acct-badge on">활성</span>
                    : <span className="acct-badge off">비활성</span>}
                </td>
                <td className="mono acct-dim">{fmt(u.lastLoginDt)}</td>
                <td className="acct-actions">
                  {(() => {
                    // BR 은 운영자(ADMIN) 계정을 관리할 수 없다.
                    const locked = u.role === "ADMIN" && me?.role !== "ADMIN";
                    return (
                      <>
                        <button className="btn xs" disabled={locked}
                          onClick={() => setEditor({ mode: "edit", acc: u })}>수정</button>
                        <button className="btn xs" disabled={locked}
                          onClick={() => setResetFor(u)}>비번 초기화</button>
                        <button className="btn xs danger" disabled={locked || me?.userId === u.userId}
                          onClick={() => setDeleteFor(u)}>삭제</button>
                      </>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editor && (
        <AccountEditor
          mode={editor.mode}
          acc={editor.acc}
          meRole={me?.role}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void load(); }}
        />
      )}
      {resetFor && (
        <ResetPasswordModal acc={resetFor} onClose={() => setResetFor(null)} onDone={() => void load()} />
      )}
      {deleteFor && (
        <DeleteModal acc={deleteFor} onClose={() => setDeleteFor(null)} onDone={() => { setDeleteFor(null); void load(); }} />
      )}
    </div>
  );
}

// ── 생성 / 수정 모달 ──────────────────────────────────────────────────────
function AccountEditor({
  mode, acc, meRole, onClose, onSaved,
}: { mode: "create" | "edit"; acc?: Account; meRole?: Role; onClose: () => void; onSaved: () => void }) {
  const [userId, setUserId] = useState(acc?.userId ?? "");
  const [name, setName] = useState(acc?.name ?? "");
  const [work, setWork] = useState(acc?.work ?? "");
  const [role, setRole] = useState<Role>(acc?.role ?? "DEV");
  const [useYn, setUseYn] = useState<"Y" | "N">(acc?.useYn ?? "Y");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // BR 은 ADMIN 권한을 부여할 수 없다 — 선택지에서 ADMIN 을 숨긴다
  // (단, 이미 ADMIN 인 계정을 편집 중이면 표시는 유지).
  const assignableRoles = ROLES.filter(
    (r) => r !== "ADMIN" || meRole === "ADMIN" || acc?.role === "ADMIN"
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      let res: Response;
      if (mode === "create") {
        // 초기 비밀번호는 서버에서 사번으로 설정한다(별도 입력 없음).
        res = await fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, name, work, role, useYn }),
        });
      } else {
        res = await fetch(`/api/accounts/${encodeURIComponent(acc!.userId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, work, role, useYn }),
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

        {mode === "create" && (
          <div className="acct-initpw-note">
            <span className="acct-initpw-ic" aria-hidden>🔑</span>
            <span>
              초기 비밀번호는 <b>사번과 동일</b>하게 설정됩니다. 사용자가 <b>최초 로그인 시 직접 변경</b>합니다.
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

// ── 비밀번호 초기화 모달 ──────────────────────────────────────────────────
function ResetPasswordModal({ acc, onClose, onDone }: { acc: Account; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(acc.userId)}/reset-password`, {
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
            <div className="acct-temp-note">이 값을 대상자에게 전달하세요. 다음 로그인 시 변경이 요구됩니다.</div>
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

// ── 삭제 확인 모달 ────────────────────────────────────────────────────────
function DeleteModal({ acc, onClose, onDone }: { acc: Account; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(acc.userId)}`, { method: "DELETE" });
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
