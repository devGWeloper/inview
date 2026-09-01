"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Milestone, Roadmap } from "@/lib/types";
import { dayKeyOf, initialMonth, resolveMilestones, shiftMonth } from "@/lib/roadmapTime";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { useAuth } from "@/components/auth/AuthProvider";
import { CalMode, RoadmapCalendar } from "@/components/roadmap/RoadmapCalendar";
import { MilestoneDialog } from "@/components/roadmap/MilestoneDialog";

/**
 * Action 오픈 로드맵 — "언제 무엇이 열렸고 앞으로 무엇을 열 것인가".
 *
 * **화면은 달력 하나다.** 한때 아래에 전체 목록 표를 뒀지만 "눈에 안 들어온다" 는 피드백으로
 * 통째로 뺐다. 항목의 설명·상태·정확한 날짜는 **클릭하면 뜨는 팝업**이 맡는다 — 그래서 그
 * 팝업은 수정 권한이 없는 사람에게도 열린다(읽기 전용).
 *
 * DB 연동이 없다. 운영자가 직접 적고(data/roadmap.json) 나머지 전원이 읽는다.
 * 읽기는 일반 사용자까지 열려 있으므로(roles.ts FIELD_ALLOW_PREFIXES) 사번·원문 같은
 * 내부 정보를 이 화면에 얹지 말 것.
 *
 * 쓰기는 **전역 ADMIN 전용**이다. 아래 canEdit 는 UI 잠금이고 권위는 PUT /api/roadmap 의
 * requireGlobalAdmin() 이다. 편집은 팝업 하나(MilestoneDialog)로만 하고, 저장은 그때마다
 * 전체 목록을 PUT 한다 — '저장 안 한 변경' 상태를 화면이 들고 있지 않게 하기 위해서다.
 */

type Dialog = { mode: "create" } | { mode: "edit"; id: string } | null;

export default function RoadmapPage() {
  const { user } = useAuth();
  // 전역 ADMIN 만 수정한다 — 에이전트 하나에 매인 운영자는 앱 공용 계획표를 고치지 않는다.
  const canEdit = !!user && user.role === "ADMIN" && user.global === true;

  const [rows, setRows] = useState<Milestone[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // 서버에서 렌더할 때와 값이 달라지지 않도록 '오늘' 은 마운트 후에 정한다.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  // 보기 단위는 **년이 기본**이다 — 로드맵을 여는 이유는 대개 전체 조망이고,
  // 한 달만 보이면 다음 오픈이 두 달 뒤일 때 빈 달력을 직접 넘겨 찾아야 한다.
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

  // 처음 보여줄 달은 '이번 달' 이 아니라 **가장 가까운 오픈이 있는 달**이다.
  // (이번 달이 비어 있으면 빈 달력만 보이고 사용자가 직접 찾아 넘겨야 한다)
  useEffect(() => {
    if (now === null || loading || view !== null) return;
    setView(initialMonth(items, now));
  }, [items, now, loading, view]);

  // 이동 단위는 보기 단위를 따른다 — 년 보기에서 ‹ › 가 한 달씩 움직이면 화면이 안 바뀐다.
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

  /**
   * 달력에서 항목 클릭 — 팝업을 연다.
   * 운영자면 수정 폼, 아니면 읽기 전용 상세. **표를 없앴으므로 설명을 볼 다른 길이 없다.**
   */
  function pickFromCalendar(id: string) {
    setSelectedId(id);
    setSaveError("");
    setDialog({ mode: "edit", id });
  }

  function openCreate() {
    setSaveError("");
    setDialog({ mode: "create" });
  }

  /** 전량 PUT. 서버가 정규화한 결과를 그대로 화면 상태로 삼는다. */
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
  // 팝업을 열었는데 대상 행이 사라졌으면(다른 세션이 지웠다면) 추가 모드로 두지 않는다.
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

/**
 * 새 항목의 기본 날짜 — 보고 있는 달이 이번 달이면 오늘, 아니면 그 달 1일.
 * (달력을 10월로 넘겨 두고 추가를 누르면 10월에 만들려는 것이다)
 */
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
