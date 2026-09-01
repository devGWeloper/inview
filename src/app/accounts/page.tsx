"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ROLES, ROLE_LABEL, ROLE_DESC, Role } from "@/lib/roles";
import { apiFetch, apiJson, asArray, errMessage, SESSION_EXPIRED_MSG } from "@/lib/apiClient";
import { AgentInfo, AgentsResponse } from "@/lib/types";

interface Account {
  userId: string;
  name: string;
  work: string | null;
  role: Role;
  useYn: "Y" | "N";
  /** 소속 에이전트 id. null = 미배정 */
  agentId: string | null;
  /** 전역(모든 에이전트) 계정 */
  global: boolean;
  lastLoginDt: string | null;
  regDt: string | null;
}

function fmt(ts: string | null): string {
  return ts ? ts.replace("T", " ").slice(0, 16) : "—";
}

/** 범위 표기. 설정에 없는 id 는 원문을 그대로 보여 잘못된 값을 드러낸다. */
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
/** "" = 전체 · "__global" = 전역 · "__none" = 미배정 · 그 외 = 에이전트 id */
type AgentFilter = string;

/** 클릭 시 처음 잡을 방향 — 최근 로그인만 최신순이 자연스럽다. */
const FIRST_DIR: Record<SortKey, Dir> = {
  userId: "asc", name: "asc", work: "asc", role: "asc",
  agent: "asc", useYn: "asc", lastLoginDt: "desc",
};

/**
 * 정렬 키 → 비교 문자열. 전부 문자열로 맞춰 비교를 한 갈래로 둔다.
 * ⚠️ 권한은 사전순이 아니라 **서열순**(ROLES 배열 순서 = ADMIN > BR > DEV > FIELD)이다.
 * ⚠️ 에이전트도 사전순이 아니라 전역 → 설정 순서 → 알 수 없는 id → 미배정 순이다
 *    (미배정·미상은 조치가 필요한 값이라 뒤로 모은다).
 */
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
  // 조회 범위 — 전부 클라이언트 필터다. 계정 수는 많아야 수백이라 서버로 내리지 않는다.
  const [roleF, setRoleF] = useState<Role | "">("");
  const [agentF, setAgentF] = useState<AgentFilter>("");
  const [useF, setUseF] = useState<"" | "Y" | "N">("");
  // ⚠️ 기본 정렬이 권한순인 건 이 화면의 질문이 "누가 무슨 권한인가" 이기 때문이다.
  //    사번순으로 두면 권한이 흩어져 매번 눈으로 훑어야 한다.
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "role", dir: "asc" });
  // 에이전트 목록 — 결속 선택지/표기용.
  // ⚠️ /api/agents 는 **내 세션 범위**로 필터돼 내려온다. 결속을 다룰 수 있는 건 ADMIN 뿐이고
  //    ADMIN 은 결속이 없어(전체) 목록도 전체로 온다. 못 읽으면 셀렉트를 비활성으로 둔다.
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  // 전역 권한/소속을 부여할 수 있는가 (= 전역 운영자). 서버가 목록 응답에 실어 준다.
  const [canGrantGlobal, setCanGrantGlobal] = useState(false);

  // 모달 상태
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
    // 전역 계정은 특정 에이전트로 좁힐 때 걸리지 않는다 (한 팀 소속이 아니다).
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

  // 같은 값끼리는 사번순으로 고정 — 재조회할 때마다 행이 뒤바뀌면 읽기 어렵다.
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

  // 에이전트가 하나뿐인 배포에서는 결속 열/선택을 감춘다 — 기존 화면과 같아야 한다.
  // 단, 이미 결속된 계정이 있으면(설정이 줄었을 수도) 그 값은 반드시 보인다.
  // 에이전트가 하나뿐이고 전원이 전역이면(= 단일 에이전트 배포) 열을 감춘다.
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
                    // 잔여 방어: ADMIN 미만은 운영자 계정을 건드릴 수 없다.
                    // (이 화면 자체가 ADMIN 전용이 되어 지금은 항상 false 지만,
                    //  /api/accounts 의 같은 가드와 짝을 맞춰 남겨 둔다)
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

// ── 생성 / 수정 모달 ──────────────────────────────────────────────────────
function AccountEditor({
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
  // 범위 선택 — "" = 전역, 그 외 = 그 에이전트. (미배정은 화면에서 만들 수 없다;
  // 잠긴 계정만 남기는 실수를 방지한다. 이미 미배정인 계정은 아래 옵션에 남는다.)
  // 범위 선택 — "" = 전역, "__none" = 미배정(편집 시에만), 그 외 = 그 에이전트.
  // ⚠️ 신규는 **기본 에이전트**로 시작한다. 전역을 기본값으로 두면 실수로 전역 계정을 양산한다.
  const [agentId, setAgentId] = useState(
    acc ? (acc.global ? "" : (acc.agentId ?? "__none")) : (agents.find((a) => a.isDefault)?.id ?? "")
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 잔여 방어: ADMIN 미만은 ADMIN 권한을 부여할 수 없다 — 선택지에서 ADMIN 을 숨긴다
  // (단, 이미 ADMIN 인 계정을 편집 중이면 표시는 유지). 화면이 ADMIN 전용이라 지금은 항상 노출.
  const assignableRoles = ROLES.filter(
    (r) => r !== "ADMIN" || meRole === "ADMIN" || acc?.role === "ADMIN"
  );

  // 범위 변경은 **전역 운영자**만 한다 (전역 부여도, 다른 에이전트로 옮기는 것도 상향이다).
  // ⚠️ 여기서 막는 건 편의일 뿐이고, 실제 차단은 /api/accounts 의 403 이다.
  const canEditAgent = meRole === "ADMIN" && canGrantGlobal && agentsLoaded;
  // 일반 사용자(FIELD)는 **기본 에이전트 소속만 존재한다** — 실적(/insights)이 BIZ 경로라
  // 전역·타 에이전트로 만들면 홈부터 403 이다. 선택을 잠그고 기본 에이전트로 고정한다.
  // ⚠️ 권위 있는 차단은 /api/accounts 의 scopeErrorForRole 400 이고 이건 실수 방지용이다.
  const defaultAgent = agents.find((a) => a.isDefault)?.id ?? "";
  const fieldFixed = role === "FIELD";
  useEffect(() => {
    if (fieldFixed && agentsLoaded && agentId !== defaultAgent) setAgentId(defaultAgent);
  }, [fieldFixed, agentsLoaded, defaultAgent, agentId]);
  // 에이전트 운영자에게는 선택지가 없다 — 새 계정은 항상 자기 에이전트 소속이다.
  const showAgent = canGrantGlobal || agents.length > 1 || !!acc?.agentId || acc?.global === true;
  // 설정에서 사라진 소속이라도 선택 목록에 남겨야 저장 시 조용히 풀리지 않는다.
  const agentOptions = [
    ...agents.map((a) => ({ id: a.id, label: `${a.avatar} ${a.name}` })),
    ...(acc?.agentId && !agents.some((a) => a.id === acc.agentId)
      ? [{ id: acc.agentId, label: `${acc.agentId} (설정에 없음)` }] : []),
    // 이미 미배정인 계정을 편집할 때만 노출 (새로 만들 수는 없다).
    ...(acc && !acc.global && !acc.agentId ? [{ id: "__none", label: "미배정 (조회 불가)" }] : []),
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      // 결속을 바꿀 수 없는 사용자는 키 자체를 보내지 않는다 — 보내면 서버가 403 이다.
      // ⚠️ **값이 바뀐 경우에만** 보낸다. 늘 보내면 결속과 무관한 수정까지 "결속을 쓰겠다" 는
      //    요청이 되어, AGENT_ID 컬럼이 없는 ALTER 전 환경에서 저장이 통째로 실패한다.
      // 범위 변경 요청 — 전역이면 { global: true }, 에이전트면 { global: false, agentId }.
      // ⚠️ **값이 바뀐 경우에만** 보낸다. 늘 보내면 범위와 무관한 수정까지 "그 컬럼을 쓰겠다" 는
      //    요청이 되어, 컬럼이 없는 ALTER 전 환경에서 저장이 통째로 실패한다.
      // ⚠️ 생성은 **항상** 범위를 보낸다(서버 기본값에 기대지 않는다). 수정은 값이 바뀐
      //    경우에만 보낸다 — 늘 보내면 범위와 무관한 수정까지 "그 컬럼을 쓰겠다" 는 요청이
      //    되어, 컬럼이 없는 ALTER 전 환경에서 저장이 통째로 실패한다.
      // 생성에서 global:false 는 서버가 무시한다(컬럼 DEFAULT 'N'). 수정에서는 전역 회수를
      // 뜻하므로 실제로 GLOBAL_YN 을 쓴다 — 그건 전역 운영자의 명시적 변경이라 정상이다.
      const current = acc ? (acc.global ? "" : (acc.agentId ?? "__none")) : null;
      const changed = mode === "create" || agentId !== current;
      const agentPatch = canEditAgent && changed
        ? (agentId === ""
            ? { global: true }
            : { global: false, agentId: agentId === "__none" ? null : agentId })
        : {};
      let res: Response;
      if (mode === "create") {
        // 초기 비밀번호는 서버에서 사번으로 설정한다(별도 입력 없음).
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

// ── 삭제 확인 모달 ────────────────────────────────────────────────────────
function DeleteModal({ acc, onClose, onDone }: { acc: Account; onClose: () => void; onDone: () => void }) {
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
