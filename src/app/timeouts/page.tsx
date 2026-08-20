"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtDuration } from "@/components/TokenLatencyChart";
import { TimeoutTrendChart } from "@/components/TimeoutTrendChart";
import { TimeoutDimStat, TimeoutItem, TimeoutStatsResponse } from "@/lib/types";
import { callStatus } from "@/lib/tokenStatus";
import { apiJson, errMessage } from "@/lib/apiClient";

// Timeout 탭 — LLM 호출이 끊긴 지점을 그대로 본다.
// 출처는 TRX_TOKEN_DET 의 실패 적재(STAT_CD='ERROR' + ERR_CTN + LATENCY_MS) 한 곳이며,
// 노드/모델/질의/대기시간 모두 그 실패한 호출의 값이다 (추정 없음).

type Preset = "24h" | "7d" | "30d";
const PRESETS: { key: Preset; label: string; hours: number }[] = [
  { key: "24h", label: "24H", hours: 24 },
  { key: "7d", label: "7D", hours: 168 },
  { key: "30d", label: "30D", hours: 720 },
];

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
  const [preset, setPreset] = useState<Preset>("7d");
  const [node, setNode] = useState("");
  const [stats, setStats] = useState<TimeoutStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (p: Preset, nodeNm: string) => {
    setLoading(true);
    setErr(null);
    try {
      const hours = PRESETS.find((x) => x.key === p)!.hours;
      const now = Date.now();
      const q = new URLSearchParams({
        dateFrom: toLocalInput(now - hours * 3_600_000),
        dateTo: toLocalInput(now),
      });
      if (nodeNm) q.set("nodeNm", nodeNm);
      setStats(await apiJson<TimeoutStatsResponse>(`/api/timeouts?${q.toString()}`, { cache: "no-store" }));
    } catch (e) {
      setErr(errMessage(e, "타임아웃 집계를 불러오지 못했습니다."));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(preset, node); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const onPreset = (p: Preset) => { setPreset(p); load(p, node); };
  const onNode = (k: string) => { const next = node === k ? "" : k; setNode(next); load(preset, next); };

  return (
    <div className="dash">
      <div className="dash-header">
        <div className="dash-title">
          <div className="dash-title-main">Timeout</div>
          <div className="dash-title-sub">
            {stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
            <span className="dash-title-note"> · LLM 호출 실패 적재 기준</span>
          </div>
        </div>
        <div className="dash-filter">
          {node && (
            <button type="button" className="btn ghost" onClick={() => onNode(node)}>
              노드: {node} ✕
            </button>
          )}
          <div className="preset-group" role="tablist" aria-label="time preset">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={"preset-btn" + (preset === p.key ? " active" : "")}
                onClick={() => onPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

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
            <div className="kpi-card tone-warn">
              <div className="kpi-title">평균 대기</div>
              <div className="kpi-value">{fmtDuration(stats.avgWaitMs)}</div>
              <div className="kpi-sub">끊기기까지 기다린 시간</div>
            </div>
            <div className="kpi-card tone-default">
              <div className="kpi-title">영향 사용자</div>
              <div className="kpi-value">{stats.affectedUsers.toLocaleString()}</div>
              <div className="kpi-sub">최근 발생 {fmtTs(stats.lastAt).slice(5, 16)}</div>
            </div>
          </div>

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">발생 추이</span>
                <span className="dash-card-sub">호출 시각 기준</span>
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

          <div className="to-grid">
            <DimCard
              title="노드별"
              sub="끊긴 그 호출의 NODE_NM · 클릭 = 필터"
              dims={stats.byNode}
              selected={node}
              onSelect={onNode}
            />
            <DimCard title="모델별" sub="끊긴 그 호출의 MODEL_NM" dims={stats.byModel} />
            <DimCard title="사용자별" sub="누가 겪었나" dims={stats.byUser} />
          </div>

          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">실패한 호출</span>
                <span className="dash-card-sub">최근 {stats.items.length.toLocaleString()}건</span>
              </div>
            </div>
            <div className="dash-card-body">
              {stats.items.length === 0 ? (
                <div className="top-empty">없음</div>
              ) : (
                <div className="token-recent-wrap">
                  <table className="token-recent to-table">
                    <thead>
                      <tr>
                        <th>호출 시각</th>
                        <th>결과</th>
                        <th>노드</th>
                        <th>모델</th>
                        <th className="num">대기</th>
                        <th>사용자</th>
                        <th className="to-col-q">질의</th>
                        <th className="to-col-q">사유</th>
                        <th>TRACE_ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.items.map((it: TimeoutItem) => {
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
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** 노드/모델/사용자 분포 — 실패 수 막대 + (그 값의 전체 호출 대비) 실패율 */
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
                <span className="to-dim-bar">
                  <span style={{ width: `${(d.failed / max) * 100}%` }} />
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
