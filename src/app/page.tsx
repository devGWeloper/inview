"use client";

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { TraceTimeline } from "@/components/TraceTimeline";
import {
  LAYER_COLOR, LAYER_ORDER,
  TraceFilter, TraceListResponse, TraceDetailResponse, TraceSummary, TraceRow
} from "@/lib/types";

const DEFAULT_FILTER: TraceFilter = {};
const MIN_LEFT = 360;
const MIN_RIGHT = 480;
const SPLITTER_W = 14;

// 기간 프리셋 — datetime-local 두 개 대신 원클릭 범위. 'custom' 만 직접 입력을 편다.
type DatePreset = "all" | "24h" | "7d" | "30d" | "custom";
const DATE_PRESETS: { key: Exclude<DatePreset, "custom">; label: string; hours: number }[] = [
  { key: "all", label: "전체", hours: 0 },
  { key: "24h", label: "24시간", hours: 24 },
  { key: "7d", label: "7일", hours: 24 * 7 },
  { key: "30d", label: "30일", hours: 24 * 30 },
];

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").slice(0, 19);
}

/** Date → 로컬 ISO(TZ 없음, 초 포함) — DB TO_TIMESTAMP('YYYY-MM-DD"T"HH24:MI:SS') 포맷과 일치 */
function toLocalIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** datetime-local 값("YYYY-MM-DDTHH:mm", 초 없음)에 초를 보정해 DB 포맷과 맞춘다 */
function withSeconds(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00` : v;
}

export default function Page() {
  const [filter, setFilter] = useState<TraceFilter>(DEFAULT_FILTER);
  const [summaries, setSummaries] = useState<TraceSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<TraceRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  // FAIL CODE 드롭다운 옵션 — TRX_ERRMSG_COD 마스터(/api/error-codes)에서 로드
  const [errCodes, setErrCodes] = useState<Array<{ code: string; desc: string }>>([]);
  // FAB 드롭다운 옵션 — MCP DB 의 DISTINCT FAC_ID(/api/facs)에서 로드
  const [facs, setFacs] = useState<string[]>([]);
  // ACTION_TYP 드롭다운 옵션 — DISTINCT ACTION_TYP(/api/action-types)에서 로드
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  // 기간 프리셋 선택 상태 (UI 전용)
  const [datePreset, setDatePreset] = useState<DatePreset>("all");

  const layoutRef = useRef<HTMLDivElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [leftWidth, setLeftWidth] = useState<number | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !layoutRef.current) return;
      e.preventDefault();
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

  const onSplitterDown = () => {
    draggingRef.current = true;
    splitterRef.current?.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onSplitterDoubleClick = () => setLeftWidth(null);

  const loadList = useCallback(async (f: TraceFilter) => {
    setListLoading(true);
    try {
      const q = new URLSearchParams();
      if (f.traceId) q.set("traceId", f.traceId);
      if (f.userId?.trim()) q.set("userId", f.userId.trim());
      if (f.actionTyp) q.set("actionTyp", f.actionTyp);
      if (f.errCd) q.set("errCd", f.errCd);
      if (f.facId) q.set("facId", f.facId);
      const df = withSeconds(f.dateFrom);
      const dt = withSeconds(f.dateTo);
      if (df) q.set("dateFrom", df);
      if (dt) q.set("dateTo", dt);
      if (f.onlyError) q.set("onlyError", "true");
      const res = await fetch(`/api/traces?${q.toString()}`, { cache: "no-store" });
      const data: TraceListResponse = await res.json();
      setSummaries(data.summaries);
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

  // FAIL CODE 옵션 로드 (TRX_ERRMSG_COD). 실패/미구성 시 빈 목록 → 셀렉트는 '전체'만.
  useEffect(() => {
    fetch("/api/error-codes", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { codes?: Record<string, string> }) => {
        const codes = data.codes ?? {};
        setErrCodes(
          Object.entries(codes)
            .map(([code, desc]) => ({ code, desc }))
            .sort((a, b) => a.code.localeCompare(b.code))
        );
      })
      .catch(() => setErrCodes([]));
  }, []);

  // FAB 옵션 로드 (MCP DISTINCT FAC_ID). 실패/미구성 시 빈 목록 → 셀렉트는 '전체'만.
  useEffect(() => {
    fetch("/api/facs", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { values?: string[] }) => setFacs(data.values ?? []))
      .catch(() => setFacs([]));
  }, []);

  // ACTION_TYP 옵션 로드. 실패/미구성 시 빈 목록 → 셀렉트는 '전체'만.
  useEffect(() => {
    fetch("/api/action-types", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { values?: string[] }) => setActionTypes(data.values ?? []))
      .catch(() => setActionTypes([]));
  }, []);
  useEffect(() => { if (selected) loadDetail(selected); }, [selected, loadDetail]);

  useEffect(() => {
    if (!selected && summaries.length > 0) setSelected(summaries[0].traceId);
  }, [summaries, selected]);

  const runList = (f: TraceFilter) => {
    setSelected(null);
    setDetailRows([]);
    loadList(f);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runList(filter);
  };

  const onReset = () => {
    setFilter(DEFAULT_FILTER);
    setDatePreset("all");
    runList(DEFAULT_FILTER);
  };

  // 프리셋 클릭 = 기간을 즉시 적용하고 재조회 (다른 필터는 현재 값 유지). 'custom' 은 입력만 편다.
  const applyPreset = (p: Exclude<DatePreset, "custom">) => {
    setDatePreset(p);
    const from = p === "all" ? undefined : toLocalIso(new Date(Date.now() - DATE_PRESETS.find((x) => x.key === p)!.hours * 3600_000));
    const next: TraceFilter = { ...filter, dateFrom: from, dateTo: undefined };
    setFilter(next);
    runList(next);
  };

  const errorCount = summaries.filter((s) => s.status === "error").length;
  const failCount = summaries.filter((s) => s.status === "fail").length;

  return (
    <>
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
              {failCount > 0 && <>  ·  <span style={{ color: "var(--fail)" }}>실패 {failCount}</span></>}
            </span>
          </div>

          <div className="filter">
            <form onSubmit={onSubmit}>
              <div className="flt-controls">
                <input
                  className="flt-field"
                  type="text"
                  placeholder="TRACE_ID"
                  aria-label="TRACE_ID"
                  value={filter.traceId ?? ""}
                  onChange={(e) => setFilter({ ...filter, traceId: e.target.value || undefined })}
                />
                <input
                  className="flt-field"
                  type="text"
                  placeholder="USER_ID"
                  aria-label="USER_ID (부분 일치)"
                  value={filter.userId ?? ""}
                  onChange={(e) => setFilter({ ...filter, userId: e.target.value || undefined })}
                />
                <select
                  className="flt-field"
                  aria-label="ACTION_TYP"
                  data-empty={!filter.actionTyp}
                  value={filter.actionTyp ?? ""}
                  onChange={(e) => setFilter({ ...filter, actionTyp: e.target.value || undefined })}
                >
                  <option value="">ACTION_TYP · 전체</option>
                  {actionTypes.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <select
                  className="flt-field"
                  aria-label="FAIL CODE"
                  data-empty={!filter.errCd}
                  value={filter.errCd ?? ""}
                  onChange={(e) => setFilter({ ...filter, errCd: e.target.value || undefined })}
                >
                  <option value="">FAIL CODE · 전체</option>
                  {errCodes.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.desc ? `${c.code} — ${c.desc}` : c.code}
                    </option>
                  ))}
                </select>
                <select
                  className="flt-field"
                  aria-label="FAB"
                  data-empty={!filter.facId}
                  value={filter.facId ?? ""}
                  onChange={(e) => setFilter({ ...filter, facId: e.target.value || undefined })}
                >
                  <option value="">FAB</option>
                  {facs.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>

              <div className="flt-bottom">
                <div className="flt-dates">
                  <span className="flt-tag">기간</span>
                  <div className="seg" role="group" aria-label="기간 프리셋">
                    {DATE_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        className={datePreset === p.key ? "on" : ""}
                        onClick={() => applyPreset(p.key)}
                      >
                        {p.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={datePreset === "custom" ? "on" : ""}
                      onClick={() => setDatePreset("custom")}
                    >
                      직접
                    </button>
                  </div>
                </div>
                <div className="flt-run">
                  <label className="flt-check">
                    <input
                      type="checkbox"
                      checked={!!filter.onlyError}
                      onChange={(e) => setFilter({ ...filter, onlyError: e.target.checked || undefined })}
                    />
                    오류만
                  </label>
                  <button type="button" className="btn ghost xs" onClick={onReset}>초기화</button>
                  <button type="submit" className="btn primary xs">조회</button>
                </div>
              </div>

              {datePreset === "custom" && (
                <div className="flt-custom">
                  <label>
                    시작
                    <input
                      type="datetime-local"
                      value={filter.dateFrom ?? ""}
                      onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value || undefined })}
                    />
                  </label>
                  <label>
                    종료
                    <input
                      type="datetime-local"
                      value={filter.dateTo ?? ""}
                      onChange={(e) => setFilter({ ...filter, dateTo: e.target.value || undefined })}
                    />
                  </label>
                </div>
              )}
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
                    <td>
                      <span
                        className="layer-dots"
                        title={`${s.layerCount} / ${LAYER_ORDER.length} layers · ${s.layers.join(", ") || "—"}`}
                      >
                        {LAYER_ORDER.map((l) => {
                          const present = s.layers.includes(l);
                          return (
                            <span
                              key={l}
                              className={"layer-dot" + (present ? " on" : "")}
                              style={present ? { background: LAYER_COLOR[l], borderColor: LAYER_COLOR[l] } : undefined}
                              aria-label={`${l} ${present ? "present" : "missing"}`}
                            />
                          );
                        })}
                        <span className="layer-dots-count">{s.layerCount}/{LAYER_ORDER.length}</span>
                      </span>
                    </td>
                    <td>
                      {s.status === "error"
                        ? <span className="pill err"><span className="dot" />ERROR</span>
                        : s.status === "fail"
                          ? <span className="pill fail"><span className="dot" />FAIL</span>
                          : s.status === "ok"
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
            <span className="meta">{LAYER_ORDER.join(" → ")}</span>
          </div>
          <div className="panel-body tight">
            <TraceTimeline traceId={selected} rows={detailRows} loading={detailLoading} />
          </div>
        </section>
      </div>
    </>
  );
}
