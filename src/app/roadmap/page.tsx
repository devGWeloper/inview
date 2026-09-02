"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Milestone, Roadmap } from "@/lib/types";
import { dayKeyOf, initialMonth, resolveMilestones, shiftMonth } from "@/lib/roadmapTime";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { useAuth } from "@/components/auth/AuthProvider";
import { CalMode, RoadmapCalendar } from "@/features/roadmap/RoadmapCalendar";
import { MilestoneDialog } from "@/features/roadmap/MilestoneDialog";


type Dialog = { mode: "create" } | { mode: "edit"; id: string } | null;

export default function RoadmapPage() {
  const { user } = useAuth();
  const canEdit = !!user && user.role === "ADMIN" && user.global === true;

  const [rows, setRows] = useState<Milestone[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  const [mode, setMode] = useState<CalMode>("year");
  const [view, setView] = useState<{ year: number; monthIdx: number } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await apiJson<{ roadmap: Roadmap }>("/api/roadmap", { cache: "no-store" });
        if (!alive) return;
        setRows(asArray<Milestone>(d.roadmap?.milestones));
        setUpdatedAt(d.roadmap?.updatedAt ?? "");
      } catch (e) {
        if (alive) setLoadError(errMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const items = useMemo(() => (now === null ? [] : resolveMilestones(rows, now)), [rows, now]);

  useEffect(() => {
    if (now === null || loading || view !== null) return;
    setView(initialMonth(items, now));
  }, [items, now, loading, view]);

  const move = useCallback(
    (delta: number) => {
      setView((v) => {
        if (!v) return v;
        return mode === "year" ? { ...v, year: v.year + delta } : shiftMonth(v.year, v.monthIdx, delta);
      });
    },
    [mode]
  );

  const goToday = useCallback(() => {
    if (now === null) return;
    const d = new Date(now);
    setView({ year: d.getFullYear(), monthIdx: d.getMonth() });
  }, [now]);

  function pickFromCalendar(id: string) {
    setSelectedId(id);
    setSaveError("");
    setDialog({ mode: "edit", id });
  }

  function openCreate() {
    setSaveError("");
    setDialog({ mode: "create" });
  }

  async function commit(next: Milestone[]) {
    setSaving(true);
    setSaveError("");
    try {
      const d = await apiJson<{ roadmap: Roadmap }>("/api/roadmap", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestones: next }),
      });
      setRows(asArray<Milestone>(d.roadmap?.milestones));
      setUpdatedAt(d.roadmap?.updatedAt ?? "");
      setDialog(null);
    } catch (e) {
      setSaveError(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function saveOne(m: Milestone) {
    const exists = rows.some((r) => r.id === m.id);
    const next = exists ? rows.map((r) => (r.id === m.id ? m : r)) : [...rows, m];
    setSelectedId(m.id);
    commit(next);
  }

  function deleteOne(id: string) {
    if (selectedId === id) setSelectedId(null);
    commit(rows.filter((r) => r.id !== id));
  }

  const editing = dialog?.mode === "edit" ? rows.find((r) => r.id === dialog.id) ?? null : null;
  const dialogOpen = dialog?.mode === "create" || (dialog?.mode === "edit" && editing !== null);

  const ready = !loading && now !== null && view !== null;

  return (
    <div className="rm-page">
      <header className="rm-head">
        <div className="rm-head-id">
          <h1 className="rm-title">Action 오픈 로드맵</h1>
          <p className="rm-sub">Action Agent 가 여는 기능의 오픈 일정입니다.</p>
        </div>
        <div className="rm-head-act">
          {canEdit ? (
            <button type="button" className="btn primary" onClick={openCreate}>
              + Action 추가
            </button>
          ) : (
            <span className="rm-readonly" title="일정 수정은 전역 운영자만 할 수 있습니다">
              열람 전용
            </span>
          )}
        </div>
      </header>

      {loadError && <div className="load-error">일정을 불러오지 못했습니다 — {loadError}</div>}

      {!ready ? (
        <div className="dash-banner loading">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="rm-blank">
          <p className="rm-blank-main">아직 등록된 일정이 없습니다.</p>
          {canEdit ? (
            <>
              <p className="rm-blank-sub">첫 Action 을 추가하면 달력에 나타납니다.</p>
              <button type="button" className="btn primary" onClick={openCreate}>
                + Action 추가
              </button>
            </>
          ) : (
            <p className="rm-blank-sub">운영자가 등록하면 여기에 표시됩니다.</p>
          )}
        </div>
      ) : (
        <>
          <RoadmapCalendar
            items={items}
            mode={mode}
            year={view.year}
            monthIdx={view.monthIdx}
            now={now}
            selectedId={selectedId}
            onMove={move}
            onToday={goToday}
            onMode={setMode}
            onOpenMonth={(m) => {
              setView((v) => (v ? { ...v, monthIdx: m } : v));
              setMode("month");
            }}
            onPick={pickFromCalendar}
          />
        </>
      )}

      {updatedAt && <p className="rm-foot">마지막 수정 {formatStamp(updatedAt)}</p>}

      {dialogOpen && (
        <MilestoneDialog
          initial={editing}
          readOnly={!canEdit}
          defaultDay={view ? defaultDayFor(view, now) : ""}
          saving={saving}
          error={saveError}
          onSave={saveOne}
          onDelete={canEdit && editing ? () => deleteOne(editing.id) : null}
          onClose={() => {
            if (!saving) setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function defaultDayFor(view: { year: number; monthIdx: number }, now: number | null): string {
  if (now === null) return "";
  const today = new Date(now);
  if (today.getFullYear() === view.year && today.getMonth() === view.monthIdx) return dayKeyOf(now);
  return dayKeyOf(new Date(view.year, view.monthIdx, 1).getTime());
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
