"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AgentInfo, AgentProfile, AgentsResponse, WorkTask } from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";

const EMPTY_TASK: WorkTask = { icon: "•", title: "", desc: "" };

/** 편집 대상 에이전트의 프로필 URL. 빈 id 는 기본 에이전트를 뜻한다. */
function profileUrl(agentId: string): string {
  return agentId ? `/api/profile?agent=${encodeURIComponent(agentId)}` : "/api/profile";
}

/** 한도 입력 파싱 — 빈칸은 0(미설정), 음수/비숫자/소수는 null(=거절). */
function limitOf(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

// 접근 제어는 미들웨어(운영자 전용)가 담당한다.
// ⚠️ Suspense 로 감싸는 이유: AdminEditor 가 useSearchParams(?agent=)를 쓰는데,
//    경계가 없으면 빌드 시 프리렌더가 실패한다(Next.js CSR bailout).
export default function AdminPage() {
  return (
    <Suspense fallback={<div className="admin-page"><div className="dash-banner loading">불러오는 중…</div></div>}>
      <AdminEditor />
    </Suspense>
  );
}

function AdminEditor() {
  // 편집 대상 에이전트. 전역 운영자는 골라서 편집하고, 에이전트 운영자에게는
  // /api/agents 가 자기 에이전트 하나만 내려주므로 선택지가 없다.
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [agentsReady, setAgentsReady] = useState(false);
  // /agent?agent=x → "관리자 편집" 으로 들어오면 그 에이전트를 편집 대상으로 연다.
  const wantAgent = useSearchParams()?.get("agent")?.trim() ?? "";

  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [skillsText, setSkillsText] = useState("");
  // FTE 계산식 상수 편집용 (입력 중엔 문자열로 두고 저장 시 숫자 검증)
  const [fteActs, setFteActs] = useState<{ action: string; minutes: string }[]>([]);
  const [fteDefText, setFteDefText] = useState("");
  const [fteAnnText, setFteAnnText] = useState("");
  // 1TICK 한도(0 = 미설정)도 입력 중엔 문자열로 둔다.
  const [tpmText, setTpmText] = useState("");
  const [rpmText, setRpmText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 응답 프로필을 편집 폼 상태로 펼친다. 응답이 비정상(세션 만료 등)이면
  // 던져서 아래 catch 가 사유를 보여주게 한다 — 폼을 반쯤 채우지 않는다.
  const applyProfile = useCallback((p: AgentProfile | undefined) => {
    if (!p) throw new Error("프로필 응답이 비어 있습니다.");
    setProfile(p);
    setSkillsText(asArray<string>(p.skills).join(", "));
    setFteActs(asArray<{ action: string; minutes: number }>(p.fteActionMinutes)
      .map((a) => ({ action: a.action, minutes: String(a.minutes) })));
    setFteDefText(String(p.fteDefaultMinutes));
    setFteAnnText(String(p.fteAnnualMinutes));
    setTpmText(String(p.tpmLimit ?? 0));
    setRpmText(String(p.rpmLimit ?? 0));
  }, []);

  // 편집 가능한 에이전트 목록 (마운트 1회).
  useEffect(() => {
    let alive = true;
    apiJson<AgentsResponse>("/api/agents", { cache: "no-store" })
      .then((d) => {
        if (!alive) return;
        const list = asArray<AgentInfo>(d.agents);
        setAgents(list);
        // URL 로 지정한 에이전트 → 기본 에이전트 → 목록 첫 항목 순.
        // (지정한 id 가 내 범위 밖이면 목록에 없으므로 자연히 무시된다)
        setAgentId(
          list.find((a) => a.id === wantAgent)?.id
          ?? list.find((a) => a.id === d.defaultId)?.id
          ?? list[0]?.id
          ?? ""
        );
      })
      .catch(() => { /* 목록을 못 읽어도 기본 에이전트 프로필은 편집할 수 있다 */ })
      .finally(() => { if (alive) setAgentsReady(true); });
    return () => { alive = false; };
  }, [wantAgent]);

  useEffect(() => {
    if (!agentsReady) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const data = await apiJson<{ profile: AgentProfile }>(profileUrl(agentId), { cache: "no-store" });
        if (!alive) return;
        applyProfile(data.profile);
        setMsg(null);
      } catch (e) {
        if (alive) { setProfile(null); setMsg({ kind: "err", text: "불러오기 실패: " + errMessage(e) }); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [applyProfile, agentId, agentsReady]);

  function set<K extends keyof AgentProfile>(key: K, value: AgentProfile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  }

  function setTask(idx: number, field: keyof WorkTask, value: string) {
    setProfile((p) => {
      if (!p) return p;
      const list = p.tasks.map((t, i) =>
        i === idx ? { ...t, [field]: field === "metric" && value === "" ? undefined : value } : t
      );
      return { ...p, tasks: list };
    });
  }
  function addTask() {
    setProfile((p) => (p ? { ...p, tasks: [...p.tasks, { ...EMPTY_TASK }] } : p));
  }
  function removeTask(idx: number) {
    setProfile((p) => (p ? { ...p, tasks: p.tasks.filter((_, i) => i !== idx) } : p));
  }
  function moveTask(from: number, to: number) {
    setProfile((p) => {
      if (!p || from === to) return p;
      const list = [...p.tasks];
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      return { ...p, tasks: list };
    });
  }

  function setFteAct(idx: number, field: "action" | "minutes", value: string) {
    setFteActs((list) => list.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function addFteAct() {
    setFteActs((list) => [...list, { action: "", minutes: "" }]);
  }
  function removeFteAct(idx: number) {
    setFteActs((list) => list.filter((_, i) => i !== idx));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setMsg(null);
    const skills = skillsText.split(",").map((s) => s.trim()).filter(Boolean);

    // FTE 계산식 검증: 액션별 분 (완전히 빈 행은 무시, 반쪽 입력·0 이하·중복은 에러)
    const fteActionMinutes: { action: string; minutes: number }[] = [];
    const seen = new Set<string>();
    for (const row of fteActs) {
      const action = row.action.trim();
      const minutes = Number(row.minutes);
      if (action === "" && row.minutes.trim() === "") continue;
      if (action === "" || row.minutes.trim() === "" || !Number.isFinite(minutes) || minutes <= 0) {
        setSaving(false);
        setMsg({ kind: "err", text: "액션별 환산 분: ACTION_TYP 값과 0보다 큰 분을 함께 입력하세요." });
        return;
      }
      if (seen.has(action)) {
        setSaving(false);
        setMsg({ kind: "err", text: `액션별 환산 분: '${action}' 이(가) 중복 입력되었습니다.` });
        return;
      }
      seen.add(action);
      fteActionMinutes.push({ action, minutes });
    }
    const fteDefaultMinutes = Number(fteDefText);
    const fteAnnualMinutes = Number(fteAnnText);
    if (
      !Number.isFinite(fteDefaultMinutes) || fteDefaultMinutes <= 0 ||
      !Number.isFinite(fteAnnualMinutes) || fteAnnualMinutes <= 0
    ) {
      setSaving(false);
      setMsg({ kind: "err", text: "FTE 계산식 상수(기본 분·연간 분)는 0보다 큰 숫자여야 합니다." });
      return;
    }
    // 한도: 빈칸/0 = 미설정. 음수·비숫자는 거절한다(조용히 0 으로 만들면 기준선이 사라진다).
    const tpmLimit = limitOf(tpmText);
    const rpmLimit = limitOf(rpmText);
    if (tpmLimit === null || rpmLimit === null) {
      setSaving(false);
      setMsg({ kind: "err", text: "사용량 한도는 0 이상의 정수여야 합니다 (0 = 미설정)." });
      return;
    }
    try {
      const data = await apiJson<{ profile: AgentProfile }>(profileUrl(agentId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profile, skills, fteActionMinutes, fteDefaultMinutes, fteAnnualMinutes, tpmLimit, rpmLimit,
        }),
      });
      applyProfile(data.profile);
      setMsg({ kind: "ok", text: "저장되었습니다." });
    } catch (e) {
      setMsg({ kind: "err", text: "저장 실패: " + errMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  // 선택된 에이전트가 기본(BIZ)인가 — FTE 등 BIZ 전용 섹션의 노출 조건.
  // 목록을 못 읽었으면(agents 비어 있음) 기본 에이전트를 편집 중인 것으로 본다.
  const isDefaultAgent = agents.length === 0 || (agents.find((a) => a.id === agentId)?.isDefault ?? true);

  if (loading) return <div className="admin-page"><div className="dash-banner loading">불러오는 중…</div></div>;
  if (!profile) {
    return (
      <div className="admin-page">
        <div className="dash-banner err">{msg?.text ?? "프로필을 불러오지 못했습니다."}</div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <form className="admin-form" onSubmit={onSave}>
        <div className="admin-head">
          <div className="admin-titles">
            <div className="admin-title">프로필 관리자</div>
            <div className="admin-sub">
              {profile.name}
              {isDefaultAgent
                ? " · 입력 후 저장하면 /agent 와 대시보드에 즉시 반영됩니다."
                : " · Tokens · Timeout 화면에 반영됩니다."}
            </div>
          </div>
          <div className="admin-actions">
            {agents.length > 1 && (
              <label className="admin-agent-pick">
                <span>에이전트</span>
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={saving}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>
                  ))}
                </select>
              </label>
            )}
            {/* BIZ 기반 화면들은 기본 에이전트 전용이라 다른 에이전트를 편집 중일 땐 감춘다. */}
            {isDefaultAgent && <>
              <Link href="/improvement" className="btn ghost" prefetch={false}>🚀 Improvement Center</Link>
              <Link href="/event-fabs" className="btn ghost" prefetch={false}>이벤트-FAB 매핑</Link>
              <Link href="/agent" className="btn ghost" prefetch={false}>프로필 보기</Link>
            </>}
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>

        {msg && <div className={`dash-banner ${msg.kind === "ok" ? "loading" : "err"}`}>{msg.text}</div>}

        <fieldset className="admin-section">
          <legend>기본 정보</legend>
          <div className="admin-grid">
            <Field label="이름"><input value={profile.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="호칭"><input value={profile.nickname} onChange={(e) => set("nickname", e.target.value)} /></Field>
            <Field label="직급"><input value={profile.rank} onChange={(e) => set("rank", e.target.value)} /></Field>
            <Field label="근무시간"><input value={profile.workingHours} onChange={(e) => set("workingHours", e.target.value)} /></Field>
            <Field label="아바타 (이모지 · 사진 없을 때 폴백)"><input value={profile.avatar} onChange={(e) => set("avatar", e.target.value)} /></Field>
            <Field label="보유 스킬 (쉼표로 구분)"><input value={skillsText} onChange={(e) => setSkillsText(e.target.value)} placeholder="시즈닝, AutoQual 취소, AutoQual 실행, ..." /></Field>
            <Field label="프로필 사진 경로 (public/ 기준)" wide>
              <input value={profile.avatarImage} onChange={(e) => set("avatarImage", e.target.value)} placeholder="예: /agent.jpg  (public 폴더에 올린 파일명)" />
            </Field>
            <Field label="한 줄 소개" wide><input value={profile.tagline} onChange={(e) => set("tagline", e.target.value)} /></Field>
          </div>
        </fieldset>

        {/* 사용량 한도 — 1TICK 모니터의 기준선. 에이전트마다 다르므로 여기서 편집한다. */}
        <fieldset className="admin-section">
          <legend>사용량 한도 (TPM / RPM)</legend>
          <p className="admin-hint admin-hint-top">
            Tokens 탭의 <b>1TICK</b> 모니터가 쓰는 기준선입니다. 슬라이딩 60초 창의 최대값이 이 값을 넘으면
            초과로 표시됩니다. <b>0 = 미설정</b>(기준선·초과 판정 없이 추이만 표시).
            비워 두면 <code>config.yml</code> 의 값이 쓰입니다.
          </p>
          <div className="admin-grid">
            <Field label="TPM — 분당 토큰 한도">
              <input value={tpmText} onChange={(e) => setTpmText(e.target.value)} placeholder="예: 100000 (0 = 미설정)" inputMode="numeric" />
            </Field>
            <Field label="RPM — 분당 호출 한도">
              <input value={rpmText} onChange={(e) => setRpmText(e.target.value)} placeholder="예: 30 (0 = 미설정)" inputMode="numeric" />
            </Field>
          </div>
        </fieldset>

        {/* FTE 는 BIZ_AIACTIONTXN_HIS 집계라 기본 에이전트에만 의미가 있다. */}
        {isDefaultAgent && <fieldset className="admin-section">
          <legend>성과 지표 (FTE) — 계산식</legend>
          <p className="admin-hint admin-hint-top">
            FTE = <b>Σ(액션별 성공 수 × 환산 분) ÷ 연간 분</b> (월별은 ×12 연환산) · 2026-01-01부터 자동 집계.
            액션은 DB 의 <b>ACTION_TYP</b> 값(예: NEST_Seasoning, AutoQual_Abort, AutoQual_JobCreate)과 일치해야 하며,
            목록에 없는 액션은 기본 환산 분으로 계산됩니다. 저장 즉시 카드/대시보드 FTE 에 반영됩니다.
          </p>
          <div className="admin-fte-actions">
            {fteActs.map((row, i) => (
              <div className="admin-fte-row" key={i}>
                <input
                  value={row.action}
                  onChange={(e) => setFteAct(i, "action", e.target.value)}
                  placeholder="ACTION_TYP (예: NEST_Seasoning)"
                  aria-label="액션 타입"
                />
                <input
                  value={row.minutes}
                  onChange={(e) => setFteAct(i, "minutes", e.target.value)}
                  placeholder="환산 분 (예: 5)"
                  inputMode="decimal"
                  aria-label="성공 1건당 환산 분"
                />
                <button type="button" className="btn ghost xs" onClick={() => removeFteAct(i)} aria-label="삭제">✕</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn ghost xs" onClick={addFteAct}>+ 액션 추가</button>
          <div className="admin-grid admin-fte-consts">
            <Field label="기본 환산 분 (목록에 없는 액션 · 기본 5)">
              <input value={fteDefText} onChange={(e) => setFteDefText(e.target.value)} placeholder="예: 5" inputMode="decimal" />
            </Field>
            <Field label="1 FTE 연간 분 (기본 65,984)">
              <input value={fteAnnText} onChange={(e) => setFteAnnText(e.target.value)} placeholder="예: 65984" inputMode="numeric" />
            </Field>
          </div>
        </fieldset>}

        <fieldset className="admin-section">
          <legend>역량 강화 로드맵</legend>
          <textarea
            className="admin-textarea"
            rows={5}
            value={profile.roadmap}
            onChange={(e) => set("roadmap", e.target.value)}
            placeholder={"한 줄에 항목 하나씩 입력하세요.\n예) 멀티 레시피 동시 시즈닝 지원\n예) 응답시간 30% 단축"}
          />
        </fieldset>

        <TaskEditor
          legend="하는 일"
          tasks={profile.tasks}
          onChange={(i, f, v) => setTask(i, f, v)}
          onAdd={() => addTask()}
          onRemove={(i) => removeTask(i)}
          onMove={moveTask}
        />

        <div className="admin-footer">
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={"admin-field" + (wide ? " wide" : "")}>
      <span className="admin-field-label">{label}</span>
      {children}
    </label>
  );
}

function TaskEditor({
  legend, tasks, onChange, onAdd, onRemove, onMove,
}: {
  legend: string;
  tasks: WorkTask[];
  onChange: (idx: number, field: keyof WorkTask, value: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  function onDrop(target: number) {
    if (dragIdx !== null) onMove(dragIdx, target);
    setDragIdx(null);
    setOverIdx(null);
  }

  return (
    <fieldset className="admin-section">
      <legend>{legend}</legend>
      <p className="admin-hint admin-hint-top">
        ⠿ 핸들을 잡고 끌어 순서를 바꿀 수 있습니다. 이 순서대로 /agent 에 표시됩니다.
      </p>
      <div className="admin-tasks">
        {tasks.map((t, i) => (
          <div
            className={
              "admin-task" +
              (dragIdx === i ? " dragging" : "") +
              (overIdx === i && dragIdx !== i ? " drop-target" : "")
            }
            key={i}
            onDragOver={(e) => { e.preventDefault(); if (overIdx !== i) setOverIdx(i); }}
            onDrop={() => onDrop(i)}
          >
            <span
              className="admin-task-handle"
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              title="끌어서 순서 변경"
              aria-label="순서 변경 핸들"
            >
              ⠿
            </span>
            <span className="admin-task-no">{i + 1}</span>
            <input className="admin-task-icon" value={t.icon} onChange={(e) => onChange(i, "icon", e.target.value)} aria-label="아이콘" />
            <div className="admin-task-fields">
              <input value={t.title} onChange={(e) => onChange(i, "title", e.target.value)} placeholder="제목" />
              <input value={t.desc} onChange={(e) => onChange(i, "desc", e.target.value)} placeholder="설명" />
              <input value={t.metric ?? ""} onChange={(e) => onChange(i, "metric", e.target.value)} placeholder="지표 (선택)" />
            </div>
            <button type="button" className="btn ghost xs" onClick={() => onRemove(i)} aria-label="삭제">✕</button>
          </div>
        ))}
      </div>
      <button type="button" className="btn ghost xs" onClick={onAdd}>+ 업무 추가</button>
    </fieldset>
  );
}
