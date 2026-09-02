"use client";

import { useEffect, useMemo, useState } from "react";
import { EventFabMapping, FAB_IDS } from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { useAuth } from "@/components/auth/AuthProvider";
import { roleAtLeast } from "@/lib/roles";


interface EventFabApi {
  available: boolean;
  mappings: EventFabMapping[];
  reason?: string;
}

export default function EventFabPage() {
  return <EventFabEditor />;
}

function EventFabEditor() {
  const [rows, setRows] = useState<EventFabMapping[]>([]);
  const [baseline, setBaseline] = useState("[]");
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const { user } = useAuth();
  const canEdit = !!user && roleAtLeast(user.role, "ADMIN");
  const editable = canEdit && available;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [data, acts] = await Promise.all([
          apiJson<EventFabApi>("/api/event-fabs", { cache: "no-store" }),
          apiJson<{ values: string[] }>("/api/action-types", { cache: "no-store" }).catch(() => null),
        ]);
        if (!alive) return;
        const mappings = asArray<EventFabMapping>(data.mappings);
        setRows(mappings);
        setBaseline(JSON.stringify(mappings));
        setAvailable(data.available);
        setReason(data.reason);
        if (acts) setActionTypes(asArray<string>(acts.values));
      } catch (e) {
        if (alive) {
          setAvailable(false); // 못 읽었으면 저장도 막는다
          setMsg({ kind: "err", text: "불러오기 실패: " + errMessage(e) });
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const dirty = useMemo(() => JSON.stringify(rows) !== baseline, [rows, baseline]);

  const fabColumns = useMemo(() => {
    const extras = new Set<string>();
    for (const r of rows) for (const f of r.fabs) {
      if (!(FAB_IDS as readonly string[]).includes(f)) extras.add(f);
    }
    return [...FAB_IDS, ...Array.from(extras).sort()];
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !needle || r.eventId.toLowerCase().includes(needle));
  }, [rows, q]);

  function setEventId(idx: number, value: string) {
    if (!editable) return;
    setRows((list) => list.map((r, i) => (i === idx ? { ...r, eventId: value } : r)));
  }
  function toggleFab(idx: number, fab: string) {
    if (!editable) return;
    setRows((list) =>
      list.map((r, i) => {
        if (i !== idx) return r;
        const fabs = r.fabs.includes(fab) ? r.fabs.filter((f) => f !== fab) : [...r.fabs, fab];
        return { ...r, fabs };
      })
    );
  }
  function toggleRow(idx: number) {
    if (!editable) return;
    setRows((list) =>
      list.map((r, i) => {
        if (i !== idx) return r;
        const all = fabColumns.every((f) => r.fabs.includes(f));
        return { ...r, fabs: all ? [] : [...fabColumns] };
      })
    );
  }
  function toggleCol(fab: string) {
    if (!editable) return;
    const idxs = new Set(visible.map((v) => v.i));
    if (idxs.size === 0) return;
    const allOn = visible.every(({ r }) => r.fabs.includes(fab));
    setRows((list) =>
      list.map((r, i) => {
        if (!idxs.has(i)) return r;
        const has = r.fabs.includes(fab);
        if (allOn) return has ? { ...r, fabs: r.fabs.filter((f) => f !== fab) } : r;
        return has ? r : { ...r, fabs: [...r.fabs, fab] };
      })
    );
  }
  function addRow() {
    if (!editable) return;
    setQ(""); // 필터가 걸려 있으면 새 행이 안 보이므로 해제
    setRows((list) => [...list, { eventId: "", fabs: [] }]);
  }
  function removeRow(idx: number) {
    if (!editable) return;
    setRows((list) => list.filter((_, i) => i !== idx));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving || !editable) return;
    setSaving(true);
    setMsg(null);
    try {
      const data = await apiJson<EventFabApi>("/api/event-fabs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings: rows }),
      });
      const saved = asArray<EventFabMapping>(data.mappings);
      setRows(saved);
      setBaseline(JSON.stringify(saved));
      setMsg({ kind: "ok", text: "저장되었습니다." });
    } catch (e) {
      setMsg({ kind: "err", text: "저장 실패: " + errMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="fm-page"><div className="dash-banner loading">불러오는 중…</div></div>;

  return (
    <div className="fm-page">
      <form className="fm-shell" onSubmit={onSave}>
        <div className="fm-toolbar">
          <div className="fm-title">
            <span className="fm-title-ico" aria-hidden>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                <path d="M4 20 V10 L9 6.5 V10 L14 6.5 V10 L20 6 V20 Z"
                      stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M8.5 15.5 h2 M13.5 15.5 h2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <div className="fm-title-text">
              <span className="fm-title-main">
                FAB 적용 매핑
                <span className="fm-title-chip">MCP</span>
              </span>
              <span className="fm-title-sub">이벤트별 허용 팹</span>
            </div>
          </div>
          <label className="fm-search">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10.4 10.4 L13.6 13.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이벤트 검색"
              aria-label="이벤트 검색"
            />
            {q && (
              <button type="button" className="fm-search-clear" onClick={() => setQ("")} aria-label="검색 지우기">✕</button>
            )}
          </label>
          <div className="fm-actions">
            {canEdit ? (
              <>
                <button type="button" className="btn ghost" onClick={addRow} disabled={!editable}>+ 이벤트</button>
                <button type="submit" className="btn primary" disabled={!dirty || saving || !editable}>
                  {saving ? "저장 중…" : "저장"}
                  {dirty && !saving && <span className="fm-dirty-dot" aria-label="저장되지 않은 변경 있음" />}
                </button>
              </>
            ) : (
              <span className="fm-readonly" title="매핑 수정은 운영자(ADMIN)만 할 수 있습니다">열람 전용</span>
            )}
          </div>
        </div>

        {!available && (
          <div className="dash-banner err">
            MCP DB 미연결 — 조회{canEdit ? "/저장" : ""} 불가{reason ? ` (${reason})` : ""}
          </div>
        )}
        {msg && <div className={`dash-banner ${msg.kind === "ok" ? "loading" : "err"}`}>{msg.text}</div>}

        <div className="fm-panel">
          <table className="fm-matrix" onMouseLeave={() => setHoverCol(null)}>
            <thead>
              <tr>
                <th className="fm-th-event">이벤트</th>
                {fabColumns.map((fab) => (
                  <th
                    key={fab}
                    className={hoverCol === fab ? "hl" : undefined}
                    onClick={() => toggleCol(fab)}
                    onMouseEnter={() => setHoverCol(fab)}
                    title={editable ? `${fab} 열 전체 토글` : fab}
                  >
                    {fab}
                  </th>
                ))}
                <th className="fm-th-ops" aria-label="행 동작" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td className="fm-empty" colSpan={fabColumns.length + 2}>
                    {rows.length === 0 ? (
                      canEdit
                        ? <>아직 매핑이 없습니다 — <button type="button" className="fm-empty-add" onClick={addRow} disabled={!editable}>이벤트 추가</button></>
                        : <>아직 매핑이 없습니다.</>
                    ) : (
                      <>“{q}” 에 해당하는 이벤트가 없습니다.</>
                    )}
                  </td>
                </tr>
              )}
              {visible.map(({ r, i }) => (
                <tr key={i} className={r.fabs.length === 0 ? "zero" : undefined}>
                  <td className="fm-td-event">
                    <div className="fm-event-wrap">
                      <input
                        className="fm-event-input"
                        list="event-fab-suggestions"
                        value={r.eventId}
                        onChange={(e) => setEventId(i, e.target.value)}
                        placeholder="ACTION_TYP"
                        aria-label="이벤트 (ACTION_TYP)"
                        autoFocus={editable && r.eventId === "" && i === rows.length - 1}
                        spellCheck={false}
                        readOnly={!editable}
                      />
                      {r.fabs.length === 0 && <span className="fm-zero" title="허용 FAB 이 없으면 저장할 수 없습니다">팹 없음</span>}
                    </div>
                  </td>
                  {fabColumns.map((fab) => {
                    const on = r.fabs.includes(fab);
                    return (
                      <td
                        key={fab}
                        className={"fm-cell" + (hoverCol === fab ? " hl" : "")}
                        onMouseEnter={() => setHoverCol(fab)}
                      >
                        <button
                          type="button"
                          className={"fm-dot" + (on ? " on" : "")}
                          onClick={() => toggleFab(i, fab)}
                          disabled={!editable}
                          aria-pressed={on}
                          aria-label={`${r.eventId || "이벤트"} — ${fab} 허용`}
                        />
                      </td>
                    );
                  })}
                  <td className="fm-td-ops">
                    {editable && (
                      <>
                        <button type="button" className="fm-op" onClick={() => toggleRow(i)} title="행 전체 토글">▦</button>
                        <button type="button" className="fm-op del" onClick={() => removeRow(i)} title="행 삭제">✕</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <datalist id="event-fab-suggestions">
          {actionTypes.map((v) => <option key={v} value={v} />)}
        </datalist>
      </form>
    </div>
  );
}
