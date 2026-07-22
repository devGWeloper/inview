"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentProfile, WorkTask } from "@/lib/types";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_HEADER } from "@/lib/adminAuth";
import { AdminGate } from "@/components/AdminGate";

const EMPTY_TASK: WorkTask = { icon: "•", title: "", desc: "" };

export default function AdminPage() {
  return (
    <AdminGate title="관리자 편집" sub="비밀번호를 입력하면 프로필을 수정할 수 있습니다.">
      <AdminEditor />
    </AdminGate>
  );
}

function AdminEditor() {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [skillsText, setSkillsText] = useState("");
  // FTE 계산식 상수 편집용 (입력 중엔 문자열로 두고 저장 시 숫자 검증)
  const [fteActs, setFteActs] = useState<{ action: string; minutes: string }[]>([]);
  const [fteDefText, setFteDefText] = useState("");
  const [fteAnnText, setFteAnnText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        const data: { profile: AgentProfile } = await res.json();
        if (!alive) return;
        setProfile(data.profile);
        setSkillsText(data.profile.skills.join(", "));
        setFteActs(data.profile.fteActionMinutes.map((a) => ({ action: a.action, minutes: String(a.minutes) })));
        setFteDefText(String(data.profile.fteDefaultMinutes));
        setFteAnnText(String(data.profile.fteAnnualMinutes));
      } catch (e) {
        if (alive) setMsg({ kind: "err", text: "불러오기 실패: " + String(e) });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

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
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [ADMIN_PASSWORD_HEADER]: ADMIN_PASSWORD,
        },
        body: JSON.stringify({ ...profile, skills, fteActionMinutes, fteDefaultMinutes, fteAnnualMinutes }),
      });
      if (res.status === 401) throw new Error("비밀번호가 올바르지 않습니다.");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { profile: AgentProfile } = await res.json();
      setProfile(data.profile);
      setSkillsText(data.profile.skills.join(", "));
      setFteActs(data.profile.fteActionMinutes.map((a) => ({ action: a.action, minutes: String(a.minutes) })));
      setFteDefText(String(data.profile.fteDefaultMinutes));
      setFteAnnText(String(data.profile.fteAnnualMinutes));
      setMsg({ kind: "ok", text: "저장되었습니다." });
    } catch (e) {
      setMsg({ kind: "err", text: "저장 실패: " + String(e) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="admin-page"><div className="dash-banner loading">불러오는 중…</div></div>;
  if (!profile) return <div className="admin-page"><div className="dash-banner err">프로필을 불러오지 못했습니다.</div></div>;

  return (
    <div className="admin-page">
      <form className="admin-form" onSubmit={onSave}>
        <div className="admin-head">
          <div className="admin-titles">
            <div className="admin-title">프로필 관리자</div>
            <div className="admin-sub">{profile.name} · 입력 후 저장하면 /agent 와 대시보드에 즉시 반영됩니다.</div>
          </div>
          <div className="admin-actions">
            <Link href="/improvement" className="btn ghost" prefetch={false}>🚀 Improvement Center</Link>
            <Link href="/event-fabs" className="btn ghost" prefetch={false}>이벤트-FAB 매핑</Link>
            <Link href="/agent" className="btn ghost" prefetch={false}>프로필 보기</Link>
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

        <fieldset className="admin-section">
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
        </fieldset>

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
