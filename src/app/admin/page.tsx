"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentProfile, WorkTask } from "@/lib/types";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_HEADER } from "@/lib/adminAuth";

const EMPTY_TASK: WorkTask = { icon: "•", title: "", desc: "" };
const UNLOCK_KEY = "admin-unlocked";

export default function AdminPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);

  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [skillsText, setSkillsText] = useState("");
  const [fteText, setFteText] = useState("");
  const [fteMinText, setFteMinText] = useState("");
  const [fteAnnText, setFteAnnText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 세션 동안 잠금 해제 상태 유지
  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(UNLOCK_KEY) === "1") {
      setUnlocked(true);
    }
  }, []);

  function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (pwInput === ADMIN_PASSWORD) {
      setUnlocked(true);
      setPwError(false);
      sessionStorage.setItem(UNLOCK_KEY, "1");
    } else {
      setPwError(true);
    }
  }

  useEffect(() => {
    if (!unlocked) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        const data: { profile: AgentProfile } = await res.json();
        if (!alive) return;
        setProfile(data.profile);
        setSkillsText(data.profile.skills.join(", "));
        setFteText(data.profile.fte === null ? "" : String(data.profile.fte));
        setFteMinText(String(data.profile.fteMinutesPerCase));
        setFteAnnText(String(data.profile.fteAnnualMinutes));
      } catch (e) {
        if (alive) setMsg({ kind: "err", text: "불러오기 실패: " + String(e) });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [unlocked]);

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
    const fteMinutesPerCase = Number(fteMinText);
    const fteAnnualMinutes = Number(fteAnnText);
    if (
      !Number.isFinite(fteMinutesPerCase) || fteMinutesPerCase <= 0 ||
      !Number.isFinite(fteAnnualMinutes) || fteAnnualMinutes <= 0
    ) {
      setSaving(false);
      setMsg({ kind: "err", text: "FTE 계산식 상수(건당 분·연간 분)는 0보다 큰 숫자여야 합니다." });
      return;
    }
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [ADMIN_PASSWORD_HEADER]: ADMIN_PASSWORD,
        },
        body: JSON.stringify({ ...profile, skills, fte, fteMinutesPerCase, fteAnnualMinutes }),
      });
      if (res.status === 401) throw new Error("비밀번호가 올바르지 않습니다.");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { profile: AgentProfile } = await res.json();
      setProfile(data.profile);
      setSkillsText(data.profile.skills.join(", "));
      setFteText(data.profile.fte === null ? "" : String(data.profile.fte));
      setFteMinText(String(data.profile.fteMinutesPerCase));
      setFteAnnText(String(data.profile.fteAnnualMinutes));
      setMsg({ kind: "ok", text: "저장되었습니다." });
    } catch (e) {
      setMsg({ kind: "err", text: "저장 실패: " + String(e) });
    } finally {
      setSaving(false);
    }
  }

  if (!unlocked) {
    return (
      <div className="admin-page">
        <form className="admin-lock" onSubmit={onUnlock}>
          <div className="admin-lock-icon" aria-hidden>🔒</div>
          <div className="admin-lock-title">관리자 편집</div>
          <div className="admin-lock-sub">비밀번호를 입력하면 프로필을 수정할 수 있습니다.</div>
          <input
            type="password"
            className={"admin-lock-input" + (pwError ? " error" : "")}
            value={pwInput}
            onChange={(e) => { setPwInput(e.target.value); setPwError(false); }}
            placeholder="비밀번호"
            autoFocus
            aria-label="관리자 비밀번호"
          />
          {pwError && <div className="admin-lock-error">비밀번호가 올바르지 않습니다.</div>}
          <div className="admin-lock-actions">
            <Link href="/agent" className="btn ghost" prefetch={false}>취소</Link>
            <button type="submit" className="btn primary">잠금 해제</button>
          </div>
        </form>
      </div>
    );
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
            <Field label="보유 스킬 (쉼표로 구분)"><input value={skillsText} onChange={(e) => setSkillsText(e.target.value)} placeholder="시즈닝, AutoQual 취소, ..." /></Field>
            <Field label="프로필 사진 경로 (public/ 기준)" wide>
              <input value={profile.avatarImage} onChange={(e) => set("avatarImage", e.target.value)} placeholder="예: /agent.jpg  (public 폴더에 올린 파일명)" />
            </Field>
            <Field label="한 줄 소개" wide><input value={profile.tagline} onChange={(e) => set("tagline", e.target.value)} /></Field>
          </div>
        </fieldset>

        <fieldset className="admin-section">
          <legend>성과 지표 (FTE) — 자동 집계</legend>
          <div className="admin-grid">
            <Field label="성공 1건당 환산 분 (기본 5)">
              <input value={fteMinText} onChange={(e) => setFteMinText(e.target.value)} placeholder="예: 5" inputMode="decimal" />
            </Field>
            <Field label="1 FTE 연간 분 (기본 65,984)">
              <input value={fteAnnText} onChange={(e) => setFteAnnText(e.target.value)} placeholder="예: 65984" inputMode="numeric" />
            </Field>
            <Field label="FTE 폴백 값 (DB 미연결 시에만 사용)">
              <input value={fteText} onChange={(e) => setFteText(e.target.value)} placeholder="예: 4.32" inputMode="decimal" />
            </Field>
            <Field label="FTE 주석 (폴백 시 표시)"><input value={profile.fteNote} onChange={(e) => set("fteNote", e.target.value)} /></Field>
          </div>
          <p className="admin-hint">
            ※ FTE 는 <b>2026-01-01 ~ 현재 액션 성공 수(시즈닝·AutoQual 취소) × {fteMinText || "?"} ÷ {fteAnnText || "?"}</b> 로
            자동 집계되며(월별은 ×12 연환산), CUBE DB 가 연결돼 있으면 폴백 입력값 대신 실측값이 표시됩니다.
            건당 분·연간 분 상수는 저장 즉시 카드/대시보드 FTE 에 반영됩니다.
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
