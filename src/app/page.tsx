"use client";

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { TraceTimeline } from "@/components/TraceTimeline";
import {
  TraceFilter, TraceListResponse, TraceDetailResponse, TraceSummary, TraceRow
} from "@/lib/types";

const DEFAULT_FILTER: TraceFilter = {};
const SPLIT_KEY = "inview.splitPx";
const MIN_LEFT = 360;
const MIN_RIGHT = 480;
const SPLITTER_W = 14;

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").slice(0, 19);
}

export default function Page() {
  const [filter, setFilter] = useState<TraceFilter>(DEFAULT_FILTER);
  const [summaries, setSummaries] = useState<TraceSummary[]>([]);
  const [connectedLayers, setConnectedLayers] = useState(0);
  const [appEnv, setAppEnv] = useState<"dev" | "prd">("dev");
  const [selected, setSelected] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<TraceRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const layoutRef = useRef<HTMLDivElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [leftWidth, setLeftWidth] = useState<number | null>(null);

  useEffect(() => {
    const stored = Number(localStorage.getItem(SPLIT_KEY));
    if (Number.isFinite(stored) && stored > 0) setLeftWidth(stored);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(layoutRef.current).paddingLeft) || 0;
      const max = rect.width - padding * 2 - MIN_RIGHT - SPLITTER_W;
      let next = e.clientX - rect.left - padding;
      if (next < MIN_LEFT) next = MIN_LEFT;
      if (next > max) next = max;
      setLeftWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      splitterRef.current?.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    if (leftWidth != null && !draggingRef.current) {
      localStorage.setItem(SPLIT_KEY, String(Math.round(leftWidth)));
    }
  }, [leftWidth]);

  const onSplitterDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    splitterRef.current?.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onSplitterDoubleClick = () => {
    localStorage.removeItem(SPLIT_KEY);
    setLeftWidth(null);
  };

  const loadList = useCallback(async (f: TraceFilter) => {
    setListLoading(true);
    try {
      const q = new URLSearchParams();
      if (f.traceId) q.set("traceId", f.traceId);
      if (f.userId) q.set("userId", f.userId);
      if (f.dateFrom) q.set("dateFrom", f.dateFrom);
      if (f.dateTo) q.set("dateTo", f.dateTo);
      if (f.onlyError) q.set("onlyError", "true");
      const res = await fetch(`/api/traces?${q.toString()}`, { cache: "no-store" });
      const data: TraceListResponse = await res.json();
      setSummaries(data.summaries);
      setConnectedLayers(data.connectedLayers);
      setAppEnv(data.appEnv);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (traceId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/traces/${encodeURIComponent(traceId)}`, { cache: "no-store" });
      const data: TraceDetailResponse = await res.json();
      setDetailRows(data.rows);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { loadList(filter); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (selected) loadDetail(selected); }, [selected, loadDetail]);

  useEffect(() => {
    if (!selected && summaries.length > 0) setSelected(summaries[0].traceId);
  }, [summaries, selected]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSelected(null);
    setDetailRows([]);
    loadList(filter);
  };

  const onReset = () => {
    setFilter(DEFAULT_FILTER);
    setSelected(null);
    setDetailRows([]);
    loadList(DEFAULT_FILTER);
  };

  const errorCount = summaries.filter((s) => s.hasError).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden />
          INVIEW
          <span className="sub">· AI Action Trace</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`env-badge ${appEnv}`}>{appEnv.toUpperCase()}</span>
          <span className="env-badge live"><span className="dot" />CONNECTED · {connectedLayers} LAYER{connectedLayers !== 1 ? "S" : ""}</span>
        </div>
      </header>

      <div
        className="layout"
        ref={layoutRef}
        style={leftWidth != null ? ({ "--left-w": `${leftWidth}px` } as CSSProperties) : undefined}
      >
        <section className="panel">
          <div className="panel-header">
            <span className="title">Traces</span>
            <span className="meta">
              {summaries.length.toLocaleString()} 건
              {errorCount > 0 && <>  ·  <span style={{ color: "var(--err)" }}>오류 {errorCount}</span></>}
            </span>
          </div>

          <div className="filter">
            <form onSubmit={onSubmit}>
              <div className="filter-grid">
                <label>
                  TRACE_ID
                  <input
                    type="text"
                    value={filter.traceId ?? ""}
                    onChange={(e) => setFilter({ ...filter, traceId: e.target.value || undefined })}
                    placeholder="예) TRC-20260420-0001"
                  />
                </label>
                <label>
                  USER_ID
                  <input
                    type="text"
                    value={filter.userId ?? ""}
                    onChange={(e) => setFilter({ ...filter, userId: e.target.value || undefined })}
                    placeholder="예) hong.gildong"
                  />
                </label>
                <label>
                  FROM
                  <input
                    type="datetime-local"
                    value={filter.dateFrom ?? ""}
                    onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value || undefined })}
                  />
                </label>
                <label>
                  TO
                  <input
                    type="datetime-local"
                    value={filter.dateTo ?? ""}
                    onChange={(e) => setFilter({ ...filter, dateTo: e.target.value || undefined })}
                  />
                </label>
              </div>
              <div className="filter-actions">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!filter.onlyError}
                    onChange={(e) => setFilter({ ...filter, onlyError: e.target.checked || undefined })}
                  />
                  오류만 표시
                </label>
                <button type="button" className="btn" onClick={onReset}>초기화</button>
                <button type="submit" className="btn primary">조회</button>
              </div>
            </form>
          </div>

          <div className="panel-body tight">
            <table className="trace-list">
              <thead>
                <tr>
                  <th>TRACE_ID</th>
                  <th>USER</th>
                  <th>FIRST RECV</th>
                  <th>LAYERS</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {listLoading && (
                  <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>불러오는 중…</td></tr>
                )}
                {!listLoading && summaries.length === 0 && (
                  <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>조건에 맞는 TRACE 가 없습니다.</td></tr>
                )}
                {summaries.map((s) => (
                  <tr
                    key={s.traceId}
                    className={selected === s.traceId ? "active" : ""}
                    onClick={() => setSelected(s.traceId)}
                  >
                    <td className="mono strong">{s.traceId}</td>
                    <td>{s.userId ?? "—"}</td>
                    <td className="mono">{fmtTs(s.firstRecvTm)}</td>
                    <td>{s.layerCount} / 5</td>
                    <td>
                      {s.hasError
                        ? <span className="pill err"><span className="dot" />ERROR</span>
                        : s.allComplete
                          ? <span className="pill ok"><span className="dot" />OK</span>
                          : <span className="pill warn"><span className="dot" />PARTIAL</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div
          ref={splitterRef}
          className="splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="패널 너비 조절"
          onPointerDown={onSplitterDown}
          onDoubleClick={onSplitterDoubleClick}
          title="드래그하여 너비 조절 · 더블클릭으로 초기화"
        />

        <section className="panel">
          <div className="panel-header">
            <span className="title">Trace Detail</span>
            <span className="meta">CUBE → GAIA → MCP → ONEOIS → LEGACY</span>
          </div>
          <div className="panel-body tight">
            <TraceTimeline traceId={selected} rows={detailRows} loading={detailLoading} />
          </div>
        </section>
      </div>
    </div>
  );
}
