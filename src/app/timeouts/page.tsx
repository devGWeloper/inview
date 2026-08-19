"use client";

import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TopList } from "@/components/TopList";
import { TIMEOUT_DEFAULT_ERR_CD, TimeoutItem, TimeoutStatsResponse } from "@/lib/types";
import { apiJson, errMessage } from "@/lib/apiClient";

// Timeout 탭 — "얼마나 / 어떤 요청에서 / 어떤 노드에서 / 어떤 모델에서" 한 화면.
//
// ⚠️ 데이터 출처는 **기존 BIZ 데이터의 ERR_CD** (기본 ERROR_LLM) 다. 새로 추가한
// TRX_TOKEN_DET.STAT_CD 없이도 지금 당장 추적된다. 노드/모델만 TRX_TOKEN_DET 조인.
// 기존 대시보드에선 이게 "에러 1건" 으로 뭉뚱그려져 문제없어 보이던 걸 분리해 보여준다.

type Preset = "24h" | "7d" | "30d";
const PRESETS: { key: Preset; label: string; hours: number }[] = [
  { key: "24h", label: "24H", hours: 24 },
  { key: "7d", label: "7D", hours: 168 },
  { key: "30d", label: "30D", hours: 720 },
];

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return `${from.replace("T", " ").slice(0, 16)}  →  ${to.replace("T", " ").slice(0, 16)}`;
}
function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").slice(0, 19);
}
function tick(ts: string, g: TimeoutStatsResponse["granularity"]): string {
  return g === "1d" ? ts.slice(5, 10) : ts.slice(11, 16);
}

export default function TimeoutsPage() {
  const [preset, setPreset] = useState<Preset>("7d");
  const [errCd, setErrCd] = useState(TIMEOUT_DEFAULT_ERR_CD);
  const [stats, setStats] = useState<TimeoutStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (p: Preset, code: string) => {
    setLoading(true);
    setErr(null);
    try {
      const hours = PRESETS.find((x) => x.key === p)!.hours;
      const now = Date.now();
      const q = new URLSearchParams({
        dateFrom: toLocalInput(now - hours * 3_600_000),
        dateTo: toLocalInput(now),
        errCd: code,
      });
      setStats(await apiJson<TimeoutStatsResponse>(`/api/timeouts?${q.toString()}`, { cache: "no-store" }));
    } catch (e) {
      setErr(errMessage(e, "타임아웃 집계를 불러오지 못했습니다."));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(preset, errCd); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const onPreset = (p: Preset) => { setPreset(p); load(p, errCd); };
  const onErrCd = (c: string) => { setErrCd(c); load(preset, c); };

  const rate = stats && stats.totalTraces > 0 ? (stats.timeoutTraces / stats.totalTraces) * 100 : 0;
  const topNode = stats?.byNode[0];
  const chartData = (stats?.buckets ?? []).map((b) => ({ ...b, tick: tick(b.ts, stats!.granularity) }));

  return (
    <div className="dash">
      <div className="dash-header">
        <div className="dash-title">
          <div className="dash-title-main">Timeout</div>
          <div className="dash-title-sub">
            {stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
            <span className="dash-title-note"> · ERR_CD = {errCd} 기준</span>
          </div>
        </div>
        <div className="dash-filter">
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

      {stats && (
        <>
          <div className="kpi-grid">
            <div className="kpi-card tone-err">
              <div className="kpi-title">타임아웃</div>
              <div className="kpi-value">{stats.timeoutTraces.toLocaleString()}</div>
              <div className="kpi-sub">전체 {stats.totalTraces.toLocaleString()}건 중 {rate.toFixed(1)}%</div>
            </div>
            <div className="kpi-card tone-default">
              <div className="kpi-title">영향 사용자</div>
              <div className="kpi-value">{stats.affectedUsers.toLocaleString()}</div>
              <div className="kpi-sub">타임아웃을 겪은 사용자 수</div>
            </div>
            <div className="kpi-card tone-default">
              <div className="kpi-title">최근 발생</div>
              <div className="kpi-value to-kpi-sm">{fmtTs(stats.lastAt).slice(5)}</div>
              <div className="kpi-sub">마지막 타임아웃 시각</div>
            </div>
            <div className="kpi-card tone-warn">
              <div className="kpi-title">최다 노드</div>
              <div className="kpi-value to-kpi-sm">{topNode?.key ?? "—"}</div>
              <div className="kpi-sub">
                {topNode ? `${topNode.count.toLocaleString()}건` : stats.nodeLinked ? "데이터 없음" : "TRX_TOKEN_DET 연계 없음"}
              </div>
            </div>
          </div>

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">발생 추이</span>
                <span className="dash-card-sub">요청 시작 시각 기준</span>
              </div>
            </div>
            <div className="dash-card-body">
              {stats.timeoutTraces === 0 ? (
                <div className="top-empty">이 기간에 {errCd} 가 없습니다</div>
              ) : (
                <div className="ts-chart">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
                      <XAxis
                        dataKey="tick"
                        tick={{ fill: "var(--text-2)", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}
                        tickLine={{ stroke: "var(--border-strong)" }}
                        axisLine={{ stroke: "var(--border-strong)" }}
                        tickMargin={8}
                        height={32}
                        minTickGap={28}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fill: "var(--text-2)", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)" }}
                        tickLine={{ stroke: "var(--border-strong)" }}
                        axisLine={{ stroke: "var(--border-strong)" }}
                        width={44}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--surface-3)" }}
                        formatter={(v) => [`${Number(v ?? 0)}건`, "타임아웃"] as [string, string]}
                        labelFormatter={(l) => String(l)}
                      />
                      <Bar dataKey="count" fill="var(--err)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </section>

          <div className="to-grid">
            <Card title="노드별" sub={stats.nodeExact ? "실패한 호출 기준" : "타임아웃 직전 마지막 호출 기준"}>
              <TopList items={stats.byNode} totalForPct={stats.timeoutTraces} emptyText={stats.nodeLinked ? "데이터 없음" : "TRX_TOKEN_DET 연계 없음"} tone="err" />
            </Card>
            <Card title="모델별" sub="LLM 모델">
              <TopList items={stats.byModel} totalForPct={stats.timeoutTraces} emptyText="데이터 없음" tone="err" />
            </Card>
            <Card title="액션 타입별" sub="어떤 요청에서">
              <TopList items={stats.byAction} totalForPct={stats.timeoutTraces} emptyText="데이터 없음" tone="err" />
            </Card>
            <Card title="사용자별" sub="누가 겪었나">
              <TopList items={stats.byUser} totalForPct={stats.timeoutTraces} emptyText="데이터 없음" tone="err" />
            </Card>
          </div>

          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">기간 내 에러 코드</span>
                <span className="dash-card-sub">클릭 = 그 코드로 집계 (지금은 {errCd})</span>
              </div>
            </div>
            <div className="dash-card-body">
              <TopList
                items={stats.byErrCd}
                totalForPct={stats.totalTraces}
                emptyText="에러 없음"
                tone="neutral"
                onItemClick={(k) => onErrCd(k)}
                itemActionLabel="이 코드로 보기"
              />
            </div>
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">타임아웃 요청</span>
                <span className="dash-card-sub">최근 {stats.items.length.toLocaleString()}건</span>
              </div>
            </div>
            <div className="dash-card-body">
              {stats.items.length === 0 ? (
                <div className="top-empty">없음</div>
              ) : (
                <ul className="to-list">
                  {stats.items.map((it: TimeoutItem) => (
                    <li className="to-item" key={it.traceId}>
                      <div className="to-line">
                        <span className="to-time mono">{fmtTs(it.tm)}</span>
                        {it.nodeNm && <span className="qnode is-err">{it.nodeNm}</span>}
                        {it.modelNm && <span className="qmodel">{it.modelNm}</span>}
                        {it.actionTyp && <span className="to-action">{it.actionTyp}</span>}
                        {it.userId && <span className="to-user mono">{it.userId}</span>}
                      </div>
                      {it.question && <div className="to-q">{it.question}</div>}
                      <div className="to-foot">
                        <span className="to-err mono">
                          {it.errCd}
                          {it.errLayer ? ` · ${it.errLayer}` : ""}
                          {it.errDescCtn ? ` · ${it.errDescCtn}` : ""}
                        </span>
                        <span className="to-trace mono">{it.traceId}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <div className="to-note">
            타임아웃 판정은 <b>기존 BIZ 데이터의 ERR_CD</b>({errCd}) 기준입니다. 노드/모델은 TRX_TOKEN_DET
            를 TRACE_ID 로 붙인 값이며,{" "}
            {stats.nodeExact
              ? "실패한 LLM 호출을 직접 집습니다."
              : "STAT_CD 적재 전이라 타임아웃 직전 마지막 호출로 추정합니다."}
          </div>
        </>
      )}
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div className="dash-card-title-group">
          <span className="dash-card-title">{title}</span>
          <span className="dash-card-sub">{sub}</span>
        </div>
      </div>
      <div className="dash-card-body">{children}</div>
    </section>
  );
}
