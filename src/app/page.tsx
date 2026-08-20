"use client";

import { CSSProperties, Fragment, useCallback, useEffect, useRef, useState } from "react";
import { TraceTimeline } from "@/components/TraceTimeline";
import {
  LAYER_COLOR, LAYER_ORDER,
  TraceFilter, TraceListResponse, TraceDetailResponse, TraceRow,
  TraceStatus, WorkSummary, WorkTraceItem
} from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";

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

/** 상태 뱃지 — 묶음 행과 TRACE 행이 같은 모양을 쓴다 */
function statusPill(status: TraceStatus) {
  if (status === "error") return <span className="pill err"><span className="dot" />ERROR</span>;
  if (status === "fail") return <span className="pill fail"><span className="dot" />FAIL</span>;
  if (status === "ok") return <span className="pill ok"><span className="dot" />OK</span>;
  return <span className="pill warn"><span className="dot" />PARTIAL</span>;
}

/**
 * 묶음 대표 사용자 = 후값(POST)을 요청한 사람.
 * 흐름을 끝맺는 사람이라 작업의 주인으로 보기 가장 자연스럽다.
 * 아직 후값이 안 온 미완결 묶음은 첫 요청자로 대신한다.
 */
function workUserLabel(w: WorkSummary): string {
  const post = w.traces.find((t) => t.actionLabel === "POST" && t.userId);
  return post?.userId ?? w.traces.find((t) => t.userId)?.userId ?? "—";
}

/**
 * 목록의 TRACE 행. 묶음이 1건짜리면 그대로 최상위 행으로, 여러 건이면 펼친 자식 행으로 쓰인다.
 * (child 여부만 다르고 내용은 동일 — 묶음 도입 전 화면과 같은 정보를 보여준다)
 */
function traceRow(t: WorkTraceItem, active: boolean, onClick: () => void, child = false) {
  return (
    <tr
      key={t.traceId}
      className={(child ? "work-child" : "") + (active ? " active" : "")}
      onClick={onClick}
    >
      <td className="mono strong" title={t.traceId}>{t.traceId}</td>
      <td>{t.userId ?? "—"}</td>
      <td className="mono">{fmtTs(t.firstRecvTm)}</td>
      <td>
        {/* 액션 칩은 첫 열이 아니라 여기 둔다 — 이 열의 폭은 이미 묶음 행의 칩들이
            정하고 있어서 칩이 하나 더 들어가도 안 넓어지고, 첫 열(TRACE_ID)은 그만큼 넉넉해진다 */}
        {child && t.actionLabel && <span className="work-chip">{t.actionLabel}</span>}
        <span
          className="layer-dots"
          title={`${t.layerCount} / ${LAYER_ORDER.length} layers · ${t.layers.join(", ") || "—"}`}
        >
          {LAYER_ORDER.map((l) => {
            const present = t.layers.includes(l);
            return (
              <span
                key={l}
                className={"layer-dot" + (present ? " on" : "")}
                style={present ? { background: LAYER_COLOR[l], borderColor: LAYER_COLOR[l] } : undefined}
                aria-label={`${l} ${present ? "present" : "missing"}`}
              />
            );
          })}
          <span className="layer-dots-count">{t.layerCount}/{LAYER_ORDER.length}</span>
        </span>
      </td>
      <td>{statusPill(t.status)}</td>
    </tr>
  );
}

export default function Page() {
  const [filter, setFilter] = useState<TraceFilter>(DEFAULT_FILTER);
  // 목록 1행 = 묶음(현장 작업 1건). 대부분은 TRACE 1건짜리라 지금까지의 행과 같아 보인다.
  const [works, setWorks] = useState<WorkSummary[]>([]);
  // 펼쳐놓은 묶음 (TRACE 2건 이상인 것만 펼침 대상)
  const [expandedWorks, setExpandedWorks] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<TraceRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  // 조회 실패 사유 (세션 만료·권한·DB 오류 등) — 빈 표 대신 이유를 보여준다
  const [listErr, setListErr] = useState<string | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
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
    setListErr(null);
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
      // apiJson: 401(세션 만료)/에러 응답을 데이터로 오인하지 않고 ApiError 로 던진다.
      const data = await apiJson<TraceListResponse>(`/api/traces?${q.toString()}`, { cache: "no-store" });
      setWorks(asArray<WorkSummary>(data.works));
    } catch (e) {
      setListErr(errMessage(e, "목록을 불러오지 못했습니다."));
      setWorks([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (traceId: string) => {
    setDetailLoading(true);
    setDetailErr(null);
    try {
      const data = await apiJson<TraceDetailResponse>(
        `/api/traces/${encodeURIComponent(traceId)}`, { cache: "no-store" }
      );
      setDetailRows(asArray<TraceRow>(data.rows));
    } catch (e) {
      setDetailErr(errMessage(e, "상세를 불러오지 못했습니다."));
      setDetailRows([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { loadList(filter); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // FAIL CODE 옵션 로드 (TRX_ERRMSG_COD). 실패/미구성 시 빈 목록 → 셀렉트는 '전체'만.
  useEffect(() => {
    apiJson<{ codes?: Record<string, string> }>("/api/error-codes", { cache: "no-store" })
      .then((data) => {
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
    apiJson<{ values?: string[] }>("/api/facs", { cache: "no-store" })
      .then((data) => setFacs(asArray<string>(data.values)))
      .catch(() => setFacs([]));
  }, []);

  // ACTION_TYP 옵션 로드. 실패/미구성 시 빈 목록 → 셀렉트는 '전체'만.
  useEffect(() => {
    apiJson<{ values?: string[] }>("/api/action-types", { cache: "no-store" })
      .then((data) => setActionTypes(asArray<string>(data.values)))
      .catch(() => setActionTypes([]));
  }, []);
  useEffect(() => { if (selected) loadDetail(selected); }, [selected, loadDetail]);

  // 첫 묶음의 첫 TRACE 를 자동 선택. 여러 건짜리면 선택한 행이 보이도록 같이 펼쳐준다.
  useEffect(() => {
    if (selected || works.length === 0) return;
    const first = works[0];
    const firstTrace = first.traces[0];
    if (!firstTrace) return;
    setSelected(firstTrace.traceId);
    if (first.traces.length > 1) setExpandedWorks(new Set([first.workId]));
  }, [works, selected]);

  const runList = (f: TraceFilter) => {
    setSelected(null);
    setDetailRows([]);
    setExpandedWorks(new Set());
    loadList(f);
  };

  // 묶음 행 클릭 = 펼침/접힘. 펼칠 때는 첫 TRACE 를 골라 오른쪽 상세를 바로 띄운다.
  const toggleWork = (w: WorkSummary) => {
    const opening = !expandedWorks.has(w.workId);
    setExpandedWorks((prev) => {
      const next = new Set(prev);
      if (opening) next.add(w.workId);
      else next.delete(w.workId);
      return next;
    });
    if (opening && w.traces.length > 0) setSelected(w.traces[0].traceId);
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

  const errorCount = works.filter((w) => w.status === "error").length;
  const failCount = works.filter((w) => w.status === "fail").length;

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
              {works.length.toLocaleString()} 건
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
                {!listLoading && listErr && (
                  <tr><td colSpan={5} style={{ padding: 12 }}>
                    <div className="load-error"><span aria-hidden>⚠</span>{listErr}</div>
                  </td></tr>
                )}
                {!listLoading && !listErr && works.length === 0 && (
                  <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>조건에 맞는 TRACE 가 없습니다.</td></tr>
                )}
                {works.map((w) => {
                  // TRACE 1건짜리 묶음(대부분)은 펼칠 게 없으니 지금까지의 목록 행 그대로 둔다.
                  if (w.traces.length <= 1) {
                    const only = w.traces[0];
                    return only ? traceRow(only, selected === only.traceId, () => setSelected(only.traceId)) : null;
                  }
                  const open = expandedWorks.has(w.workId);
                  return (
                    <Fragment key={w.workId}>
                      <tr className={"work-row" + (open ? " open" : "")} onClick={() => toggleWork(w)}>
                        <td className="strong" title={w.chamberId ?? w.workId}>
                          <span className="work-caret" aria-hidden>{open ? "▾" : "▸"}</span>
                          <span className="mono">{w.chamberId ?? w.workId}</span>
                        </td>
                        <td>{workUserLabel(w)}</td>
                        <td className="mono">{fmtTs(w.firstRecvTm)}</td>
                        {/* 레이어 dots 자리 — 묶음 행은 흐름이 어디까지 갔는지를 보여준다.
                            칩 여러 개보다 화살표로 이은 한 덩이가 좁고, 순서가 있는 흐름이라 읽기도 낫다 */}
                        <td>
                          <span className="work-flow" title={`TRACE ${w.traces.length}건`}>
                            {w.traces.map((t) => t.actionLabel ?? "?").join(" › ")}
                          </span>
                        </td>
                        <td>{statusPill(w.status)}</td>
                      </tr>
                      {open && w.traces.map((t) =>
                        traceRow(t, selected === t.traceId, () => setSelected(t.traceId), true)
                      )}
                    </Fragment>
                  );
                })}
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
            {detailErr && !detailLoading && (
              <div className="load-error" style={{ margin: 12 }}><span aria-hidden>⚠</span>{detailErr}</div>
            )}
            <TraceTimeline traceId={selected} rows={detailRows} loading={detailLoading} />
          </div>
        </section>
      </div>
    </>
  );
}
