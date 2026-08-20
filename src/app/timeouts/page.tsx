"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtDuration } from "@/components/TokenLatencyChart";
import { TimeoutTrendChart } from "@/components/TimeoutTrendChart";
import { TimeoutModelHeatmap } from "@/components/TimeoutModelHeatmap";
import { TimeoutDimStat, TimeoutItem, TimeoutReason, TimeoutStatsResponse } from "@/lib/types";
import { callStatus } from "@/lib/tokenStatus";
import { apiJson, errMessage } from "@/lib/apiClient";

// Timeout 탭 — LLM 호출이 끊긴 지점을 그대로 본다.
// 출처는 TRX_TOKEN_DET 의 실패 적재(STAT_CD='ERROR' + ERR_CTN + LATENCY_MS) 한 곳이며,
// 노드/모델/질의/대기시간 모두 그 실패한 호출의 값이다 (추정 없음).
//
// 조회 조건(기간·노드·모델)은 서버 필터라 KPI/추이/분포/목록이 전부 같은 범위로 좁혀진다.
// 목록 안의 컬럼 필터는 그 위에 얹는 클라이언트 필터(로드된 행 범위)다.

type Preset = "24h" | "7d" | "30d";
const PRESETS: { key: Preset; label: string; hours: number }[] = [
  { key: "24h", label: "24H", hours: 24 },
  { key: "7d", label: "7D", hours: 168 },
  { key: "30d", label: "30D", hours: 720 },
];
type Mode = Preset | "custom";

interface Range { from: string; to: string }

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function presetRange(p: Preset): Range {
  const now = Date.now();
  return { from: toLocalInput(now - PRESETS.find((x) => x.key === p)!.hours * 3_600_000), to: toLocalInput(now) };
}
function fmtRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return `${from.replace("T", " ").slice(0, 16)}  →  ${to.replace("T", " ").slice(0, 16)}`;
}
function fmtTs(ts: string | null): string {
  return ts ? ts.replace("T", " ").slice(0, 19) : "—";
}
const pct = (n: number, total: number): string => (total > 0 ? ((n / total) * 100).toFixed(1) + "%" : "—");

export default function TimeoutsPage() {
  const [mode, setMode] = useState<Mode>("7d");
  const [range, setRange] = useState<Range>(() => presetRange("7d"));
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [node, setNode] = useState("");
  const [model, setModel] = useState("");
  const [stats, setStats] = useState<TimeoutStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (r: Range, nodeNm: string, modelNm: string) => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ dateFrom: r.from, dateTo: r.to });
      if (nodeNm) q.set("nodeNm", nodeNm);
      if (modelNm) q.set("modelNm", modelNm);
      setStats(await apiJson<TimeoutStatsResponse>(`/api/timeouts?${q.toString()}`, { cache: "no-store" }));
    } catch (e) {
      setErr(errMessage(e, "타임아웃 집계를 불러오지 못했습니다."));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(range, node, model); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const onPreset = (p: Preset) => {
    const r = presetRange(p);
    setMode(p);
    setRange(r);
    load(r, node, model);
  };
  const enterCustom = () => {
    setCustomFrom(range.from.slice(0, 16));
    setCustomTo(range.to.slice(0, 16));
    setMode("custom");
  };
  const applyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    // datetime-local 은 'YYYY-MM-DDTHH:MM' — 초 단위 보정
    const norm = (s: string) => (s.length === 16 ? s + ":00" : s);
    const r = { from: norm(customFrom), to: norm(customTo) };
    setRange(r);
    load(r, node, model);
  };
  const onNode = (k: string) => { const next = node === k ? "" : k; setNode(next); load(range, next, model); };
  const onModel = (k: string) => { const next = model === k ? "" : k; setModel(next); load(range, node, next); };

  const scope = [node && `노드 ${node}`, model && `모델 ${model}`].filter(Boolean).join(" · ");
  const topNode = stats?.byNode[0];

  return (
    <div className="dash">
      <div className="dash-header">
        <div className="dash-title">
          <div className="dash-title-main">Timeout</div>
          <div className="dash-title-sub">
            {stats ? fmtRange(stats.range.from, stats.range.to) : fmtRange(range.from, range.to)}
            <span className="dash-title-note"> · LLM 호출 실패 적재 기준</span>
          </div>
        </div>
        <div className="dash-filter">
          <div className="preset-group" role="tablist" aria-label="time preset">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={"preset-btn" + (mode === p.key ? " active" : "")}
                onClick={() => onPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={"preset-btn" + (mode === "custom" ? " active" : "")}
              onClick={enterCustom}
            >
              직접 설정
            </button>
          </div>
          {mode === "custom" && (
            <form className="custom-range" onSubmit={applyCustom}>
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="from"
              />
              <span className="range-arrow">→</span>
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="to"
              />
              <button type="submit" className="btn primary">적용</button>
            </form>
          )}
        </div>
      </div>

      {(node || model) && (
        <div className="to-scope">
          <span className="to-scope-label">조회 범위</span>
          {node && (
            <button type="button" className="to-chip" onClick={() => onNode(node)}>
              노드 <b>{node}</b> ✕
            </button>
          )}
          {model && (
            <button type="button" className="to-chip is-model" onClick={() => onModel(model)}>
              모델 <b>{model}</b> ✕
            </button>
          )}
        </div>
      )}

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}

      {stats && !stats.available && (
        <div className="dash-banner">
          아직 실패 호출이 적재되지 않았습니다 · GAIA 가 <code>TRX_TOKEN_DET.STAT_CD</code> /{" "}
          <code>ERR_CTN</code> 을 적재하면 이 화면이 채워집니다.
        </div>
      )}

      {stats && stats.available && (
        <>
          <div className="kpi-grid">
            <div className="kpi-card tone-err">
              <div className="kpi-title">타임아웃</div>
              <div className="kpi-value">{stats.timeoutCalls.toLocaleString()}</div>
              <div className="kpi-sub">
                전체 호출 {stats.totalCalls.toLocaleString()}건 중 {pct(stats.timeoutCalls, stats.totalCalls)}
              </div>
            </div>
            <div className="kpi-card tone-fail">
              <div className="kpi-title">실패 호출</div>
              <div className="kpi-value">{stats.failedCalls.toLocaleString()}</div>
              <div className="kpi-sub">
                타임아웃 외 오류 {(stats.failedCalls - stats.timeoutCalls).toLocaleString()}건 포함
              </div>
            </div>
            {/* 사용자 체감 피해량 — 호출 수보다 "질문 몇 개가 깨졌나" 가 크기를 말해준다 */}
            <div className="kpi-card tone-warn">
              <div className="kpi-title">영향 질문</div>
              <div className="kpi-value">{stats.affectedTraces.toLocaleString()}</div>
              <div className="kpi-sub">
                {stats.lastAt ? `최근 발생 ${fmtTs(stats.lastAt).slice(5, 16)}` : "발생 없음"}
              </div>
            </div>
            <div className="kpi-card tone-default">
              <div className="kpi-title">영향 사용자</div>
              <div className="kpi-value">{stats.affectedUsers.toLocaleString()}</div>
              <div className="kpi-sub">
                {topNode ? `최다 발생 ${topNode.key} (${topNode.failed.toLocaleString()}건)` : "—"}
              </div>
            </div>
          </div>

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">발생 추이</span>
                <span className="dash-card-sub">호출 시각 기준{scope && ` · ${scope}`}</span>
              </div>
            </div>
            <div className="dash-card-body">
              {stats.failedCalls === 0 ? (
                <div className="top-empty">이 기간에 실패한 LLM 호출이 없습니다</div>
              ) : (
                <TimeoutTrendChart stats={stats} />
              )}
            </div>
          </section>

          {/* 모델 × 시간 히트맵 — "그 시간대에 이 모델이 몇 건 중 몇 건 실패" 를 셀 하나로 압축.
              총 요청 수를 분모로 두는 게 핵심 — 색은 실패율, 라벨 옆 숫자는 총 호출. */}
          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">모델별 요청·실패 격자</span>
                <span className="dash-card-sub">
                  가로축 시간 · 세로축 모델 · 셀 색 = 그 슬롯의 실패율{scope && ` · ${scope}`}
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <TimeoutModelHeatmap stats={stats} selectedModel={model} onSelectModel={onModel} />
            </div>
          </section>

          <div className="to-grid">
            <DimCard
              title="노드별"
              sub="어느 노드에서 끊겼나"
              dims={stats.byNode}
              selected={node}
              onSelect={onNode}
            />
            <DimCard
              title="모델별"
              sub="어느 모델에서 끊겼나"
              dims={stats.byModel}
              selected={model}
              onSelect={onModel}
            />
            <section className="dash-card">
              <div className="dash-card-head">
                <div className="dash-card-title-group">
                  <span className="dash-card-title">오류 사유</span>
                  <span className="dash-card-sub">가장 흔한 원인</span>
                </div>
              </div>
              <div className="dash-card-body">
                {stats.topReasons.length === 0 ? (
                  <div className="top-empty">데이터 없음</div>
                ) : (
                  <ReasonList reasons={stats.topReasons} totalFailed={stats.failedCalls} />
                )}
              </div>
            </section>
          </div>

          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">실패한 호출</span>
                <span className="dash-card-sub">최근 {stats.items.length.toLocaleString()}건</span>
              </div>
            </div>
            <div className="dash-card-body">
              <FailedCallsTable items={stats.items} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** 노드/모델/사용자 분포 — 실패 수 막대(타임아웃/기타 구분) + 그 값의 전체 호출 대비 실패율 */
function DimCard({
  title, sub, dims, selected, onSelect,
}: {
  title: string;
  sub: string;
  dims: TimeoutDimStat[];
  selected?: string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...dims.map((d) => d.failed));
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div className="dash-card-title-group">
          <span className="dash-card-title">{title}</span>
          <span className="dash-card-sub">{sub}</span>
        </div>
      </div>
      <div className="dash-card-body">
        {dims.length === 0 ? (
          <div className="top-empty">데이터 없음</div>
        ) : (
          <div className="to-dims">
            {dims.map((d) => (
              <button
                key={d.key}
                type="button"
                className={"to-dim" + (selected === d.key ? " active" : "")}
                onClick={onSelect ? () => onSelect(d.key) : undefined}
                disabled={!onSelect}
                title={`실패 ${d.failed.toLocaleString()} / 전체 호출 ${d.calls.toLocaleString()} · 타임아웃 ${d.timeout.toLocaleString()}`}
              >
                <span className="to-dim-key">{d.key}</span>
                {/* 막대는 추이 차트와 같은 색 규칙 — 타임아웃(진한 빨강) + 기타 오류(주황) */}
                <span className="to-dim-bar">
                  <span className="seg-t" style={{ width: `${(d.timeout / max) * 100}%` }} />
                  <span className="seg-o" style={{ width: `${(Math.max(0, d.failed - d.timeout) / max) * 100}%` }} />
                </span>
                <span className="to-dim-val mono">{d.failed.toLocaleString()}</span>
                <span className="to-dim-rate mono">{pct(d.failed, d.calls)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** 오류 사유 top — 순위 · 문구 · 발생 수(비중) */
function ReasonList({ reasons, totalFailed }: { reasons: TimeoutReason[]; totalFailed: number }) {
  return (
    <ol className="rs-list">
      {reasons.map((r, i) => {
        const share = totalFailed > 0 ? (r.failed / totalFailed) * 100 : 0;
        return (
          <li key={`${r.reason}-${i}`} className="rs-item">
            <span className="rs-rank">{i + 1}</span>
            <span className="rs-text" title={r.reason}>{r.reason}</span>
            <span className="rs-stats mono">
              <b>{r.failed.toLocaleString()}</b>
              <span className="rs-stats-sub">{share.toFixed(0)}%</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── 실패한 호출 목록 ─────────────────────────────────────────────────────────
// 컬럼 필터(결과/노드/모델/사용자/텍스트) + 헤더 클릭 정렬 + 페이징.
// 서버 조회 범위(기간·노드·모델) 안에서 로드된 행을 다시 좁히는 클라이언트 필터다.

const PAGE_SIZE = 25;
type SortKey = "time" | "wait";
type SortDir = "asc" | "desc";
type Result = "" | "timeout" | "error";

function FailedCallsTable({ items }: { items: TimeoutItem[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "time", dir: "desc" });
  const [fResult, setFResult] = useState<Result>("");
  const [fNode, setFNode] = useState("");
  const [fModel, setFModel] = useState("");
  const [fUser, setFUser] = useState("");
  const [fText, setFText] = useState("");
  const [page, setPage] = useState(0);

  const opts = (pick: (it: TimeoutItem) => string | null) =>
    Array.from(new Set(items.map((it) => pick(it) ?? "(없음)"))).sort((a, b) => a.localeCompare(b));
  const nodeOptions = useMemo(() => opts((it) => it.nodeNm), [items]);
  const modelOptions = useMemo(() => opts((it) => it.modelNm), [items]);

  const hasFilter = !!(fResult || fNode || fModel || fUser.trim() || fText.trim());
  const clearFilters = () => {
    setFResult("");
    setFNode("");
    setFModel("");
    setFUser("");
    setFText("");
  };

  const rows = useMemo(() => {
    const u = fUser.trim().toLowerCase();
    const t = fText.trim().toLowerCase();
    let list = items;
    if (fResult) list = list.filter((it) => (callStatus(it.statCd, it.errCtn) === "timeout") === (fResult === "timeout"));
    if (fNode) list = list.filter((it) => (it.nodeNm ?? "(없음)") === fNode);
    if (fModel) list = list.filter((it) => (it.modelNm ?? "(없음)") === fModel);
    if (u) list = list.filter((it) => (it.userId ?? "").toLowerCase().includes(u));
    if (t)
      list = list.filter(
        (it) =>
          (it.queryCtn ?? "").toLowerCase().includes(t) ||
          (it.errCtn ?? "").toLowerCase().includes(t) ||
          (it.traceId ?? "").toLowerCase().includes(t)
      );
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort.key === "wait") return ((a.latencyMs ?? -1) - (b.latencyMs ?? -1)) * mul;
      return (a.callTm ?? "").localeCompare(b.callTm ?? "") * mul;
    });
  }, [items, fResult, fNode, fModel, fUser, fText, sort]);

  useEffect(() => { setPage(0); }, [fResult, fNode, fModel, fUser, fText, sort, items]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const paged = rows.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const SortTh = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <th
      className={num ? "num" : undefined}
      aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button type="button" className={"qth-sort" + (sort.key === k ? " active" : "")} onClick={() => onSort(k)}>
        {label}
        <span className="qth-arrow" aria-hidden>{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  if (items.length === 0) return <div className="top-empty">없음</div>;

  return (
    <div className="qtable-wrap">
      <div className="qtable-controls">
        <span className="qtable-meta">
          {rows.length.toLocaleString()}
          {hasFilter && ` / ${items.length.toLocaleString()}`} 건
        </span>
        {hasFilter && (
          <button type="button" className="qfilter-clear" onClick={clearFilters}>
            컬럼 필터 초기화 ✕
          </button>
        )}
      </div>

      <div className="token-recent-wrap">
        <table className="token-recent to-table">
          <thead>
            <tr>
              <SortTh k="time" label="호출 시각" />
              <th>결과</th>
              <th>노드</th>
              <th>모델</th>
              <SortTh k="wait" label="대기" num />
              <th>사용자</th>
              <th className="to-col-q">질의</th>
              <th className="to-col-q">사유</th>
              <th>TRACE_ID</th>
            </tr>
            <tr className="qfilter-row">
              <th />
              <th>
                <select
                  className="qft-select"
                  value={fResult}
                  onChange={(e) => setFResult(e.target.value as Result)}
                  aria-label="결과 필터"
                >
                  <option value="">전체</option>
                  <option value="timeout">타임아웃</option>
                  <option value="error">오류</option>
                </select>
              </th>
              <th>
                <select className="qft-select" value={fNode} onChange={(e) => setFNode(e.target.value)} aria-label="노드 필터">
                  <option value="">전체</option>
                  {nodeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th>
                <select className="qft-select" value={fModel} onChange={(e) => setFModel(e.target.value)} aria-label="모델 필터">
                  <option value="">전체</option>
                  {modelOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th />
              <th>
                <input
                  type="text"
                  className="qft-input"
                  placeholder="검색"
                  value={fUser}
                  onChange={(e) => setFUser(e.target.value)}
                  aria-label="사용자 필터"
                />
              </th>
              <th colSpan={3}>
                <input
                  type="text"
                  className="qft-input"
                  placeholder="질의 / 사유 / TRACE_ID 검색"
                  value={fText}
                  onChange={(e) => setFText(e.target.value)}
                  aria-label="질의·사유 필터"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((it) => {
              const st = callStatus(it.statCd, it.errCtn);
              return (
                <tr key={it.tokenId}>
                  <td className="mono">{fmtTs(it.callTm)}</td>
                  <td>
                    <span className={"to-st" + (st === "timeout" ? " is-timeout" : "")}>
                      {st === "timeout" ? "타임아웃" : "오류"}
                    </span>
                  </td>
                  <td>{it.nodeNm ? <span className="qnode">{it.nodeNm}</span> : "—"}</td>
                  <td>{it.modelNm ? <span className="qmodel">{it.modelNm}</span> : "—"}</td>
                  <td className="num mono">{fmtDuration(it.latencyMs)}</td>
                  <td className="mono">{it.userId ?? "—"}</td>
                  <td className="to-col-q">
                    <span className="to-q" title={it.queryCtn ?? undefined}>{it.queryCtn ?? "—"}</span>
                  </td>
                  <td className="to-col-q">
                    <span className="to-q to-err" title={it.errCtn ?? undefined}>{it.errCtn ?? "—"}</span>
                  </td>
                  <td className="to-trace mono">{it.traceId ?? "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="top-empty">조건에 맞는 호출이 없습니다</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE_SIZE && (
        <div className="qpager">
          <button
            type="button"
            className="qpage-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={curPage === 0}
          >
            ‹ 이전
          </button>
          <span className="qpage-info">
            {curPage + 1} / {pageCount}
            <span className="qpage-range">
              {" "}· {(curPage * PAGE_SIZE + 1).toLocaleString()}–
              {Math.min(rows.length, curPage * PAGE_SIZE + PAGE_SIZE).toLocaleString()}
              {" / "}
              {rows.length.toLocaleString()}
            </span>
          </span>
          <button
            type="button"
            className="qpage-btn"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={curPage >= pageCount - 1}
          >
            다음 ›
          </button>
        </div>
      )}
    </div>
  );
}
