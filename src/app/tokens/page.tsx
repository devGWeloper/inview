"use client";

import { useCallback, useEffect, useState } from "react";
import { TokenChart } from "@/components/TokenChart";
import { TokenLatencyChart, fmtDuration } from "@/components/TokenLatencyChart";
import { TokenBreakdown } from "@/components/TokenBreakdown";
import { TokenStatsCards } from "@/components/TokenStatsCards";
import { QuestionsTable } from "@/components/QuestionsTable";
import { TopList } from "@/components/TopList";
import { TokenFilter, TokenRow, TokenStatsResponse } from "@/lib/types";

type Preset = "1h" | "6h" | "24h" | "7d" | "30d" | "custom";

const PRESETS: { key: Preset; label: string; hours: number }[] = [
  { key: "1h",  label: "1H",  hours: 1   },
  { key: "6h",  label: "6H",  hours: 6   },
  { key: "24h", label: "24H", hours: 24  },
  { key: "7d",  label: "7D",  hours: 168 },
  { key: "30d", label: "30D", hours: 720 },
];

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return `${from.replace("T", " ").slice(0, 16)}  →  ${to.replace("T", " ").slice(0, 16)}`;
}

export default function TokensPage() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [userId, setUserId] = useState("");
  const [nodeNm, setNodeNm] = useState("");
  const [modelNm, setModelNm] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [stats, setStats] = useState<TokenStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 셀렉트 옵션은 첫 응답의 byNode/byModel 에서 도출(필터로 좁혀져도 옵션은 유지)
  const [nodeOptions, setNodeOptions] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  const computeFilter = useCallback((): TokenFilter => {
    const base: TokenFilter = {
      userId: userId || undefined,
      nodeNm: nodeNm || undefined,
      modelNm: modelNm || undefined,
    };
    if (preset === "custom") {
      return { ...base, dateFrom: customFrom || undefined, dateTo: customTo || undefined };
    }
    const p = PRESETS.find((x) => x.key === preset)!;
    const now = Date.now();
    return {
      ...base,
      dateFrom: toLocalInput(now - p.hours * 3_600_000) + ":00",
      dateTo: toLocalInput(now) + ":00",
    };
  }, [preset, customFrom, customTo, userId, nodeNm, modelNm]);

  const load = useCallback(async (f: TokenFilter) => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams();
      if (f.dateFrom) q.set("dateFrom", f.dateFrom);
      if (f.dateTo) q.set("dateTo", f.dateTo);
      if (f.userId) q.set("userId", f.userId);
      if (f.nodeNm) q.set("nodeNm", f.nodeNm);
      if (f.modelNm) q.set("modelNm", f.modelNm);
      const res = await fetch(`/api/tokens?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TokenStatsResponse = await res.json();
      setStats(data);
      // 옵션 누적: 현재 응답의 차원 키를 합집합으로 유지 ('(none)' 제외)
      setNodeOptions((prev) => unionKeys(prev, data.byNode.map((d) => d.key)));
      setModelOptions((prev) => unionKeys(prev, data.byModel.map((d) => d.key)));
    } catch (e) {
      setErr(String(e));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(computeFilter()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // 질문 행 펼침: 현재 필터 + traceId 로 그 질문의 호출별 행을 가져온다.
  const fetchCalls = useCallback(async (traceId: string): Promise<TokenRow[]> => {
    const f = computeFilter();
    const query = new URLSearchParams();
    if (f.dateFrom) query.set("dateFrom", f.dateFrom);
    if (f.dateTo) query.set("dateTo", f.dateTo);
    if (f.userId) query.set("userId", f.userId);
    if (f.nodeNm) query.set("nodeNm", f.nodeNm);
    if (f.modelNm) query.set("modelNm", f.modelNm);
    query.set("traceId", traceId);
    const res = await fetch(`/api/tokens?${query.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: TokenStatsResponse = await res.json();
    return data.calls;
  }, [computeFilter]);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    load(computeFilter());
  };

  const onPresetClick = (k: Preset) => {
    setPreset(k);
    if (k !== "custom") {
      const p = PRESETS.find((x) => x.key === k)!;
      const now = Date.now();
      load({
        dateFrom: toLocalInput(now - p.hours * 3_600_000) + ":00",
        dateTo: toLocalInput(now) + ":00",
        userId: userId || undefined,
        nodeNm: nodeNm || undefined,
        modelNm: modelNm || undefined,
      });
    }
  };

  const onSelectNode = (k: string) => {
    const next = nodeNm === k ? "" : k;
    setNodeNm(next);
    load({ ...computeFilter(), nodeNm: next || undefined });
  };

  const onSelectModel = (k: string) => {
    const next = modelNm === k ? "" : k;
    setModelNm(next);
    load({ ...computeFilter(), modelNm: next || undefined });
  };

  const hasFilter = !!(userId || nodeNm || modelNm);
  const clearFilters = () => {
    setUserId("");
    setNodeNm("");
    setModelNm("");
    load({ ...computeFilter(), userId: undefined, nodeNm: undefined, modelNm: undefined });
  };

  return (
    <div className="dash">
      <div className="dash-header">
        <div className="dash-title">
          <div className="dash-title-main">Token Usage</div>
          <div className="dash-title-sub">
            {stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
            <span className="dash-title-note"> · GAIA LLM 호출 기준</span>
          </div>
        </div>
        <form className="dash-filter" onSubmit={onApply}>
          <div className="preset-group" role="tablist" aria-label="time preset">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={"preset-btn" + (preset === p.key ? " active" : "")}
                onClick={() => onPresetClick(p.key)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={"preset-btn" + (preset === "custom" ? " active" : "")}
              onClick={() => setPreset("custom")}
            >
              Custom
            </button>
          </div>
          {preset === "custom" && (
            <div className="custom-range">
              <input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="from" />
              <span className="range-arrow">→</span>
              <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="to" />
            </div>
          )}
          <input
            type="text"
            className="user-input"
            placeholder="USER_ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <select
            className="user-input user-select"
            value={nodeNm}
            onChange={(e) => { const v = e.target.value; setNodeNm(v); load({ ...computeFilter(), nodeNm: v || undefined }); }}
            aria-label="NODE"
          >
            <option value="">NODE (전체)</option>
            {nodeOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <select
            className="user-input user-select"
            value={modelNm}
            onChange={(e) => { const v = e.target.value; setModelNm(v); load({ ...computeFilter(), modelNm: v || undefined }); }}
            aria-label="MODEL"
          >
            <option value="">MODEL (전체)</option>
            {modelOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          {hasFilter && (
            <button type="button" className="btn ghost" onClick={clearFilters}>필터 초기화</button>
          )}
          <button type="submit" className="btn primary">조회</button>
        </form>
      </div>

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}

      {stats && (
        <>
          <TokenStatsCards stats={stats} />

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">토큰 사용 추이</span>
                <span className="dash-card-sub">input / output 적층 · {granText(stats.granularity)} 단위</span>
              </div>
              <div className="dash-card-aux">
                <span className="aux-pill">
                  <span className="aux-pill-key">총 토큰</span>
                  <span className="aux-pill-val">{stats.totals.totalTokens.toLocaleString()}</span>
                </span>
                <span className="aux-pill">
                  <span className="aux-pill-key">호출</span>
                  <span className="aux-pill-val">{stats.totals.calls.toLocaleString()}</span>
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <TokenChart stats={stats} />
            </div>
          </section>

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">LLM 호출 지연 추이</span>
                <span className="dash-card-sub">호출당 평균 소요시간 · {granText(stats.granularity)} 단위 · 어느 시점이 느렸는지</span>
              </div>
              <div className="dash-card-aux">
                <span className="aux-pill">
                  <span className="aux-pill-key">평균 지연</span>
                  <span className="aux-pill-val">{fmtDuration(stats.avgLatencyMs)}</span>
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <TokenLatencyChart stats={stats} />
            </div>
          </section>

          <TokenBreakdown
            stats={stats}
            emptyText="데이터 없음"
            onSelectNode={onSelectNode}
            onSelectModel={onSelectModel}
            selectedNode={nodeNm || undefined}
            selectedModel={modelNm || undefined}
          />

          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">질문별 토큰</span>
                <span className="dash-card-sub">
                  TRACE_ID(질문) 단위 · 총 토큰 상위 {stats.questions.length.toLocaleString()}건 · 노드/모델은 거쳐간 전부 표시 · 행 펼침 = 원본 질의 + 호출 타임라인
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <QuestionsTable questions={stats.questions} onExpand={fetchCalls} />
            </div>
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Top 사용자</span>
              <span className="dash-card-sub">총 토큰 기준</span>
            </div>
            <div className="dash-card-body">
              <TopList items={stats.topUsers} totalForPct={stats.totals.totalTokens} emptyText="데이터 없음" tone="neutral" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function unionKeys(prev: string[], next: string[]): string[] {
  const set = new Set(prev);
  for (const k of next) if (k && k !== "(none)") set.add(k);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function granText(g: TokenStatsResponse["granularity"]): string {
  return g === "5m" ? "5분" : g === "1h" ? "시간" : "일";
}
