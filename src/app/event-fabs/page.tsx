"use client";

import { useEffect, useMemo, useState } from "react";
import { EventFabMapping, FAB_IDS } from "@/lib/types";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_HEADER } from "@/lib/adminAuth";
import { AdminGate } from "@/components/AdminGate";

// 이벤트(액션) × FAB 허용 매트릭스 편집기. 저장하면 MCP DB 의 TRX_EVENT_MAP 에
// 전량 교체로 반영되고, MCP 로직이 요청 FAB 허용 여부 판정에 사용한다.
// 이벤트가 100개로 늘어도 견디도록: 스티키 헤더 + 내부 스크롤 + 검색 필터 +
// 열/행 단위 일괄 토글. (스키마·MCP 연동 예시: sql/create_trx_event_map.sql)

interface EventFabApi {
  available: boolean;
  mappings: EventFabMapping[];
  reason?: string;
}

export default function EventFabPage() {
  return (
    <AdminGate
      title="FAB 적용 매핑"
      sub="관리자 비밀번호를 입력하세요."
      icon="🏭"
      backHref="/admin"
    >
      <EventFabEditor />
    </AdminGate>
  );
}

function EventFabEditor() {
  const [rows, setRows] = useState<EventFabMapping[]>([]);
  // 저장 시점 스냅샷 — 비교해서 dirty(저장 버튼 활성/변경 표시)를 판정
  const [baseline, setBaseline] = useState("[]");
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  const [q, setQ] = useState("");
  // 열 크로스하이라이트 — 셀에 올리면 해당 FAB 열 전체가 은은하게 강조
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [mapRes, actRes] = await Promise.all([
          fetch("/api/event-fabs", { cache: "no-store" }),
          fetch("/api/action-types", { cache: "no-store" }).catch(() => null),
        ]);
        const data: EventFabApi = await mapRes.json();
        if (!alive) return;
        setRows(data.mappings);
        setBaseline(JSON.stringify(data.mappings));
        setAvailable(data.available);
        setReason(data.reason);
        if (actRes?.ok) {
          const acts: { values: string[] } = await actRes.json();
          if (alive) setActionTypes(acts.values ?? []);
        }
      } catch (e) {
        if (alive) setMsg({ kind: "err", text: "불러오기 실패: " + String(e) });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const dirty = useMemo(() => JSON.stringify(rows) !== baseline, [rows, baseline]);

  // 컬럼 = 고정 FAB 목록 + DB 에 수동으로 들어간 미지 FAB (저장 시 유실 방지)
  const fabColumns = useMemo(() => {
    const extras = new Set<string>();
    for (const r of rows) for (const f of r.fabs) {
      if (!(FAB_IDS as readonly string[]).includes(f)) extras.add(f);
    }
    return [...FAB_IDS, ...Array.from(extras).sort()];
  }, [rows]);

  // 검색 필터 — 원본 인덱스(i)를 함께 들고 다녀야 필터 중에도 올바른 행을 수정한다
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !needle || r.eventId.toLowerCase().includes(needle));
  }, [rows, q]);

  function setEventId(idx: number, value: string) {
    setRows((list) => list.map((r, i) => (i === idx ? { ...r, eventId: value } : r)));
  }
  function toggleFab(idx: number, fab: string) {
    setRows((list) =>
      list.map((r, i) => {
        if (i !== idx) return r;
        const fabs = r.fabs.includes(fab) ? r.fabs.filter((f) => f !== fab) : [...r.fabs, fab];
        return { ...r, fabs };
      })
    );
  }
  /** 행 전체 토글 — 모두 켜져 있으면 비우고, 아니면 전체 선택 */
  function toggleRow(idx: number) {
    setRows((list) =>
      list.map((r, i) => {
        if (i !== idx) return r;
        const all = fabColumns.every((f) => r.fabs.includes(f));
        return { ...r, fabs: all ? [] : [...fabColumns] };
      })
    );
  }
  /** 열 전체 토글 — 현재 보이는(필터된) 행들만 대상으로 켜고 끈다 */
  function toggleCol(fab: string) {
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
    setQ(""); // 필터가 걸려 있으면 새 행이 안 보이므로 해제
    setRows((list) => [...list, { eventId: "", fabs: [] }]);
  }
  function removeRow(idx: number) {
    setRows((list) => list.filter((_, i) => i !== idx));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/event-fabs", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [ADMIN_PASSWORD_HEADER]: ADMIN_PASSWORD,
        },
        body: JSON.stringify({ mappings: rows }),
      });
      const data = await res.json();
      if (res.status === 401) throw new Error("비밀번호가 올바르지 않습니다.");
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setRows(data.mappings);
      setBaseline(JSON.stringify(data.mappings));
      setMsg({ kind: "ok", text: "저장되었습니다." });
    } catch (e) {
      setMsg({ kind: "err", text: "저장 실패: " + (e instanceof Error ? e.message : String(e)) });
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
            <button type="button" className="btn ghost" onClick={addRow} disabled={!available}>+ 이벤트</button>
            <button type="submit" className="btn primary" disabled={!dirty || saving || !available}>
              {saving ? "저장 중…" : "저장"}
              {dirty && !saving && <span className="fm-dirty-dot" aria-label="저장되지 않은 변경 있음" />}
            </button>
          </div>
        </div>

        {!available && (
          <div className="dash-banner err">
            MCP DB 미연결 — 조회/저장 불가{reason ? ` (${reason})` : ""}
          </div>
        )}
        {msg && <div className={`dash-banner ${msg.kind === "ok" ? "loading" : "err"}`}>{msg.text}</div>}

        <div className="fm-panel">
          <table className="fm-matrix" onMouseLeave={() => setHoverCol(null)}>
            <thead>
              <tr>
                <th className="fm-th-event">EVENT</th>
                {fabColumns.map((fab) => (
                  <th
                    key={fab}
                    className={hoverCol === fab ? "hl" : undefined}
                    onClick={() => toggleCol(fab)}
                    onMouseEnter={() => setHoverCol(fab)}
                    title={`${fab} 열 전체 토글`}
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
                      <>아직 매핑이 없습니다 — <button type="button" className="fm-empty-add" onClick={addRow} disabled={!available}>이벤트 추가</button></>
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
                        autoFocus={r.eventId === "" && i === rows.length - 1}
                        spellCheck={false}
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
                          aria-pressed={on}
                          aria-label={`${r.eventId || "이벤트"} — ${fab} 허용`}
                        />
                      </td>
                    );
                  })}
                  <td className="fm-td-ops">
                    <button type="button" className="fm-op" onClick={() => toggleRow(i)} title="행 전체 토글">▦</button>
                    <button type="button" className="fm-op del" onClick={() => removeRow(i)} title="행 삭제">✕</button>
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
