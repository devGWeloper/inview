"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ROLES, ROLE_LABEL, ROLE_DESC, Role } from "@/lib/roles";
import { apiFetch, apiJson, asArray, errMessage, SESSION_EXPIRED_MSG } from "@/lib/apiClient";
import { AgentInfo, AgentsResponse } from "@/lib/types";
import { Account } from "@/features/accounts/types";
import { AccountEditor } from "@/features/accounts/AccountEditor";
import { ResetPasswordModal } from "@/features/accounts/ResetPasswordModal";
import { DeleteModal } from "@/features/accounts/DeleteModal";


function fmt(ts: string | null): string {
  return ts ? ts.replace("T", " ").slice(0, 16) : "—";
}

function AgentCell({ agents, id, global: isGlobal }: { agents: AgentInfo[]; id: string | null; global: boolean }) {
  if (isGlobal) return <span className="acct-badge on">전역</span>;
  if (!id) {
    return (
      <span className="acct-agent-bad" title="에이전트가 배정되지 않아 Tokens · Timeout 조회가 막혀 있습니다">
        미배정 ⚠️
      </span>
    );
  }
  const found = agents.find((a) => a.id === id);
  if (found) return <span>{found.avatar} {found.name}</span>;
  return (
    <span className="mono acct-agent-bad" title="config.yml 의 agents 에 없는 에이전트입니다 — 이 계정은 조회가 막힙니다">
      {id} ⚠️
    </span>
  );
}

type SortKey = "userId" | "name" | "work" | "role" | "agent" | "useYn" | "lastLoginDt";
type Dir = "asc" | "desc";
type AgentFilter = string;

const FIRST_DIR: Record<SortKey, Dir> = {
  userId: "asc", name: "asc", work: "asc", role: "asc",
  agent: "asc", useYn: "asc", lastLoginDt: "desc",
};

function sortKeyOf(u: Account, key: SortKey, agents: AgentInfo[]): string {
  switch (key) {
    case "name": return u.name.toLowerCase();
    case "work": return (u.work ?? "").toLowerCase();
    case "role": return String(Math.max(0, ROLES.indexOf(u.role)));
    case "useYn": return u.useYn === "Y" ? "0" : "1";
    case "lastLoginDt": return u.lastLoginDt ?? "";
    case "agent": {
      if (u.global) return "0";
      if (!u.agentId) return "3";
      const i = agents.findIndex((a) => a.id === u.agentId);
      return i >= 0 ? "1:" + String(i).padStart(3, "0") : "2:" + u.agentId;
    }
    default: return u.userId.toLowerCase();
  }
}

export default function AccountsPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<Account[]>([]);
  const [available, setAvailable] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState<Role | "">("");
  const [agentF, setAgentF] = useState<AgentFilter>("");
  const [useF, setUseF] = useState<"" | "Y" | "N">("");
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "role", dir: "asc" });
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [canGrantGlobal, setCanGrantGlobal] = useState(false);

  const [editor, setEditor] = useState<{ mode: "create" | "edit"; acc?: Account } | null>(null);
  const [resetFor, setResetFor] = useState<Account | null>(null);
  const [deleteFor, setDeleteFor] = useState<Account | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/accounts", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAvailable(false);
        setReason(res.status === 401 ? SESSION_EXPIRED_MSG : (data.error ?? "불러오기 실패"));
        setUsers([]);
        return;
      }
      setAvailable(data.available);
      setReason(data.reason ?? null);
      setUsers(asArray<Account>(data.users));
      setCanGrantGlobal(data.canGrantGlobal === true);
    } catch (e) {
      setAvailable(false); setReason(errMessage(e)); setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let alive = true;
    apiJson<AgentsResponse>("/api/agents", { cache: "no-store" })
      .then((d) => {
        if (!alive) return;
        setAgents(asArray<AgentInfo>(d.agents));
        setAgentsLoaded(true);
      })
      .catch(() => { /* 못 읽으면 결속 선택을 비활성으로 둔다(빈 목록으로 덮어쓰지 않기 위함) */ });
    return () => { alive = false; };
  }, []);

  const filtered = users.filter((u) => {
    if (roleF && u.role !== roleF) return false;
    if (useF && u.useYn !== useF) return false;
    if (agentF === "__global" && !u.global) return false;
    if (agentF === "__none" && (u.global || u.agentId)) return false;
    if (agentF && agentF !== "__global" && agentF !== "__none" && (u.global || u.agentId !== agentF)) return false;
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return (
      u.userId.toLowerCase().includes(t) ||
      u.name.toLowerCase().includes(t) ||
      (u.work ?? "").toLowerCase().includes(t)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = sortKeyOf(a, sort.key, agents);
    const bv = sortKeyOf(b, sort.key, agents);
    if (av !== bv) return (av < bv ? -1 : 1) * (sort.dir === "asc" ? 1 : -1);
    return a.userId.localeCompare(b.userId);
  });

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: FIRST_DIR[key] }));

  const SortTh = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <th className={className} aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" className={"qth-sort" + (sort.key === k ? " active" : "")} onClick={() => onSort(k)}>
        {label}
        <span className="qth-arrow" aria-hidden>{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  const filterOn = Boolean(roleF || agentF || useF || q.trim());

  const showAgent = agents.length > 1 || users.some((u) => u.agentId || !u.global);
  const cols = showAgent ? 8 : 7;

  const counts = {
    total: users.length,
    admin: users.filter((u) => u.role === "ADMIN").length,
    br: users.filter((u) => u.role === "BR").length,
    dev: users.filter((u) => u.role === "DEV").length,
    field: users.filter((u) => u.role === "FIELD").length,
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
              <span className="acct-hero-pill role-FIELD"><b>{counts.field}</b> 일반 사용자</span>
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
        <select className="acct-filter" value={roleF} onChange={(e) => setRoleF(e.target.value as Role | "")} aria-label="권한 필터">
          <option value="">권한 전체</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        {showAgent && (
          <select className="acct-filter" value={agentF} onChange={(e) => setAgentF(e.target.value)} aria-label="에이전트 필터">
            <option value="">에이전트 전체</option>
            <option value="__global">전역</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="__none">미배정</option>
          </select>
        )}
        <select className="acct-filter" value={useF} onChange={(e) => setUseF(e.target.value as "" | "Y" | "N")} aria-label="상태 필터">
          <option value="">상태 전체</option>
          <option value="Y">활성</option>
          <option value="N">비활성</option>
        </select>
        {filterOn && (
          <button type="button" className="acct-filter-clear"
            onClick={() => { setQ(""); setRoleF(""); setAgentF(""); setUseF(""); }}>필터 해제</button>
        )}
        <span className="acct-count">{filtered.length} / {users.length}</span>
      </div>

      <div className="acct-table-wrap">
        <table className="acct-table">
          <thead>
            <tr>
              <SortTh k="userId" label="사번" />
              <SortTh k="name" label="이름" />
              <SortTh k="work" label="업무" />
              <SortTh k="role" label="권한" />
              {showAgent && <SortTh k="agent" label="에이전트" />}
              <SortTh k="useYn" label="상태" />
              <SortTh k="lastLoginDt" label="최근 로그인" />
              <th className="acct-actions-h">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={cols} className="acct-empty">불러오는 중…</td></tr>}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={cols} className="acct-empty">
                {filterOn ? "조건에 맞는 계정이 없습니다." : "계정이 없습니다."}
              </td></tr>
            )}
            {sorted.map((u) => (
              <tr key={u.userId} className={u.useYn === "N" ? "off" : ""}>
                <td className="mono strong">{u.userId}{me?.userId === u.userId && <span className="acct-you">나</span>}</td>
                <td>{u.name}</td>
                <td className="acct-work">{u.work || "—"}</td>
                <td><span className={"acct-role role-" + u.role}>{ROLE_LABEL[u.role]}</span></td>
                {showAgent && <td className="acct-agent"><AgentCell agents={agents} id={u.agentId} global={u.global} /></td>}
                <td>
                  {u.useYn === "Y"
                    ? <span className="acct-badge on">활성</span>
                    : <span className="acct-badge off">비활성</span>}
                </td>
                <td className="mono acct-dim">{fmt(u.lastLoginDt)}</td>
                <td className="acct-actions">
                  {(() => {
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
          agents={agents}
          agentsLoaded={agentsLoaded}
          canGrantGlobal={canGrantGlobal}
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
