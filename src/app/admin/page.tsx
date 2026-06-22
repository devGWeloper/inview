"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentProfile, WorkTask } from "@/lib/types";

type TaskKey = "formalTasks" | "informalTasks";

const EMPTY_TASK: WorkTask = { icon: "•", title: "", desc: "" };

export default function AdminPage() {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [skillsText, setSkillsText] = useState("");
  const [fteText, setFteText] = useState("");
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
        setFteText(data.profile.fte === null ? "" : String(data.profile.fte));
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

  function setTask(key: TaskKey, idx: number, field: keyof WorkTask, value: string) {
    setProfile((p) => {
      if (!p) return p;
      const list = p[key].map((t, i) =>
        i === idx ? { ...t, [field]: field === "metric" && value === "" ? undefined : value } : t
      );
      return { ...p, [key]: list };
    });
  }
  function addTask(key: TaskKey) {
    setProfile((p) => (p ? { ...p, [key]: [...p[key], { ...EMPTY_TASK }] } : p));
  }
  function removeTask(key: TaskKey, idx: number) {
    setProfile((p) => (p ? { ...p, [key]: p[key].filter((_, i) => i !== idx) } : p));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setMsg(null);
    const skills = skillsText.split(",").map((s) => s.trim()).filter(Boolean);
    const fte = fteText.trim() === "" ? null : Number(fteText);
    if (fte !== null && !Number.isFinite(fte)) {
      setSaving(false);
      setMsg({ kind: "err", text: "FTE는 숫자여야 합니다 (비우면 '측정 예정')." });
      return;
    }
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...profile, skills, fte }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { profile: AgentProfile } = await res.json();
      setProfile(data.profile);
      setSkillsText(data.profile.skills.join(", "));
      setFteText(data.profile.fte === null ? "" : String(data.profile.fte));
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
            <Field label="보유 스킬 (쉼표로 구분)"><input value={skillsText} onChange={(e) => setSkillsText(e.target.value)} placeholder="시즈닝, ..." /></Field>
            <Field label="프로필 사진 경로 (public/ 기준)" wide>
              <input value={profile.avatarImage} onChange={(e) => set("avatarImage", e.target.value)} placeholder="예: /agent.jpg  (public 폴더에 올린 파일명)" />
            </Field>
            <Field label="한 줄 소개" wide><input value={profile.tagline} onChange={(e) => set("tagline", e.target.value)} /></Field>
          </div>
        </fieldset>

        <fieldset className="admin-section">
          <legend>성과 지표 (FTE) — 자동 집계</legend>
          <div className="admin-grid">
            <Field label="FTE 폴백 값 (DB 미연결 시에만 사용)">
              <input value={fteText} onChange={(e) => setFteText(e.target.value)} placeholder="예: 4.32" inputMode="decimal" />
            </Field>
            <Field label="FTE 주석 (폴백 시 표시)" wide><input value={profile.fteNote} onChange={(e) => set("fteNote", e.target.value)} /></Field>
          </div>
          <p className="admin-hint">
            ※ FTE 는 <b>2026-01-01 ~ 현재 SEA 성공 수 × 60 ÷ 65,984</b> 로 자동 집계되며(월별은 ×12 연환산),
            CUBE DB 가 연결돼 있으면 위 입력값 대신 실측값이 표시됩니다. 입력값은 DB 미연결 시 폴백으로만 쓰입니다.
          </p>
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
          legend="정형업무"
          tasks={profile.formalTasks}
          onChange={(i, f, v) => setTask("formalTasks", i, f, v)}
          onAdd={() => addTask("formalTasks")}
          onRemove={(i) => removeTask("formalTasks", i)}
        />
        <TaskEditor
          legend="비정형업무"
          tasks={profile.informalTasks}
          onChange={(i, f, v) => setTask("informalTasks", i, f, v)}
          onAdd={() => addTask("informalTasks")}
          onRemove={(i) => removeTask("informalTasks", i)}
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
  legend, tasks, onChange, onAdd, onRemove,
}: {
  legend: string;
  tasks: WorkTask[];
  onChange: (idx: number, field: keyof WorkTask, value: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <fieldset className="admin-section">
      <legend>{legend}</legend>
      <div className="admin-tasks">
        {tasks.map((t, i) => (
          <div className="admin-task" key={i}>
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
