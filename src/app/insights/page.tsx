"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { DailyTable } from "@/features/insights/DailyTable";
import { mergeDailyRows } from "@/lib/dailyRows";
import { FteChart } from "@/components/charts/FteChart";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { TimeoutTrendChart } from "@/components/charts/TimeoutTrendChart";
import { TokenChart } from "@/components/charts/TokenChart";
import { TokenLatencyChart } from "@/components/charts/TokenLatencyChart";
import { fmtDuration } from "@/lib/format";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { buildInsightsReport } from "@/lib/insightsReport";
import { InsightsResponse, ROUTING_FAIL_LABEL } from "@/lib/types";
import { RECENT_PRESETS, RecentKey, Sel, isoNoTz, rangeDates, rangeLabel, rangeOf, sameSel, weekBadge } from "@/features/insights/range";
import { ACTION_LABEL, FAC_NONE, actionLabel, compact, facLabel, pct } from "@/features/insights/labels";
import { Card, Kpi } from "@/features/insights/Card";


export default function InsightsPage() {
  const { user } = useAuth();
  const [sel, setSel] = useState<Sel>({ kind: "recent", key: "30d" });
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(async (p: Sel) => {
    setLoading(true);
    setErr(null);
    try {
      const { from, to } = rangeOf(p);
      const qs = new URLSearchParams({ dateFrom: from, dateTo: to });
      setData(await apiJson<InsightsResponse>(`/api/insights?${qs}`, { cache: "no-store" }));
    } catch (e) {
      setErr(errMessage(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(sel); }, [sel, load]);

  const weekOffset = sel.kind === "week" ? sel.offset : 0;
  const goWeek = (offset: number) => setSel({ kind: "week", offset: Math.min(0, offset) });

  function enterCustom() {
    const { from, to } = rangeDates(sel);
    const v = (x: Date) => isoNoTz(x).slice(0, 16); // datetime-local 은 분 정밀
    setCustomFrom(v(from));
    setCustomTo(v(to));
    setSel({ kind: "custom", from: v(from), to: v(to) });
  }
  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    setSel({ kind: "custom", from: customFrom, to: customTo });
  }

  const daily = asArray<InsightsResponse["daily"][number]>(data?.daily);
  const byAction = asArray<InsightsResponse["byAction"][number]>(data?.byAction);
  const topErrors = asArray<InsightsResponse["topErrors"][number]>(data?.topErrors);
  const byFac = asArray<InsightsResponse["byFac"][number]>(data?.byFac);
  const tokens = data?.tokens ?? null;
  const timeouts = data?.timeouts ?? null;

  const showDaily = daily.length > 1;
  const dailyRows = useMemo(() => mergeDailyRows(data, tokens), [data, tokens]);
  const maxAction = useMemo(
    () => Math.max(1, ...byAction.map((a) => a.total)),
    [byAction]
  );
  // TEMP 가상 코드에서 서로 달라 "전체 대비 %" 로는 읽을 수 없기 때문 — 건수와 순위만 보여준다.
  const maxError = useMemo(
    () => Math.max(1, ...topErrors.map((e) => e.count)),
    [topErrors]
  );
  const maxFac = useMemo(() => Math.max(1, ...byFac.map((f) => f.total)), [byFac]);

  const reportText = useMemo(
    () => (data ? buildInsightsReport({ data, rangeLabel: rangeLabel(sel), dailyRows, actionLabel }) : ""),
    [data, sel, dailyRows]
  );

  async function copyReport() {
    if (!reportText) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(reportText);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = reportText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      document.body.removeChild(ta);
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const modelRows = useMemo(() => {
    type Row = {
      key: string;
      calls: number;
      totalTokens: number;
      avgLatencyMs: number | null;
      timeout: number;
    };
    const idx = new Map<string, Row>();
    for (const m of tokens?.byModel ?? []) {
      idx.set(m.key, {
        key: m.key,
        calls: m.calls,
        totalTokens: m.totalTokens,
        avgLatencyMs: m.avgLatencyMs,
        timeout: 0,
      });
    }
    for (const m of timeouts?.byModel ?? []) {
      const cur = idx.get(m.key);
      if (cur) cur.timeout = m.timeout;
      else idx.set(m.key, { key: m.key, calls: m.calls, totalTokens: 0, avgLatencyMs: null, timeout: m.timeout });
    }
    return [...idx.values()].sort((a, b) => b.calls - a.calls);
  }, [tokens, timeouts]);

  const timeoutRate =
    timeouts && timeouts.totalCalls > 0 ? timeouts.timeoutCalls / timeouts.totalCalls : null;

  return (
    <div className="dash ins">
      <div className="dash-header">
        <div className="ins-id">
          {data && (
            <span className="ins-avatar">
              <AgentAvatar emoji={data.agent.avatar} image={data.agent.avatarImage} />
            </span>
          )}
          <div className="dash-title">
            <div className="dash-title-main">{data?.agent.name ?? "Agent"} 실적</div>
            <div className="dash-title-sub">
              {data?.agent.tagline || "AI 에이전트가 처리한 업무 현황"}
            </div>
          </div>
        </div>
        <div className="dash-filter ins-filter">
          <div className="ins-presets">
            <div className="preset-group" role="tablist" aria-label="최근 기간">
              {RECENT_PRESETS.map((p) => {
                const active = sameSel(sel, { kind: "recent", key: p.key });
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={"preset-btn" + (active ? " active" : "")}
                    onClick={() => setSel({ kind: "recent", key: p.key })}
                  >
                    {p.label}
                  </button>
                );
              })}
              {/* 프리셋으로 안 잡히는 구간(특정 며칠, 월 중간 등)을 직접 찍는다 */}
              <button
                type="button"
                role="tab"
                aria-selected={sel.kind === "custom"}
                className={"preset-btn" + (sel.kind === "custom" ? " active" : "")}
                onClick={enterCustom}
              >
                Custom
              </button>
            </div>
            {/* 주 단위 이동 — 화살표 하나로만 조작한다(이번 주/지난주 버튼을 따로 두지 않는다). */}
            <div className="week-nav" role="group" aria-label="주 이동">
              <button type="button" onClick={() => goWeek(weekOffset - 1)} aria-label="이전 주">
                ◀
              </button>
              <span className={"week-nav-label" + (sel.kind === "week" ? " on" : "")}>
                {sel.kind === "week" ? weekBadge(sel.offset) : "주 단위"}
              </span>
              <button
                type="button"
                onClick={() => goWeek(weekOffset + 1)}
                disabled={sel.kind !== "week" || sel.offset >= 0}
                aria-label="다음 주"
              >
                ▶
              </button>
            </div>
          </div>
          {sel.kind === "custom" && (
            <form className="custom-range" onSubmit={applyCustom}>
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="시작"
              />
              <span className="range-arrow">→</span>
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="끝"
              />
              <button type="submit" className="btn primary">적용</button>
            </form>
          )}
          <div className="ins-range" title="조회 구간">{rangeLabel(sel)}</div>
          <button
            type="button"
            className={"btn primary copy-btn" + (copied ? " copied" : "")}
            onClick={() => void copyReport()}
            disabled={!data}
            title="이 화면의 실적을 보고용 텍스트로 복사합니다"
          >
            {copied ? "✓ 복사됨" : "📋 리포트 복사"}
          </button>
          <button type="button" className="btn ghost" onClick={() => void load(sel)}>
            새로고침
          </button>
        </div>
      </div>

      {/* 운영자/개발자에게만 — 지금 보고 있는 것이 '일반 사용자 공개 화면' 임을 밝힌다 */}
      {user && user.role !== "FIELD" && (
        <div className="ins-note">
          이 화면은 <b>일반 사용자 계정에게 공개되는 유일한 화면</b>입니다. 요청 원문 · 사번 ·
          내부 노드명은 서버에서 제외되어 내려오지 않습니다. (실패 사유는 코드가 아니라 설명으로 내려갑니다)
        </div>
      )}

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}

      {data && (
        <div className="dash-body">
          {/* ═══ ① 업무 실적 ═══════════════════════════════════════ */}
          <div className="ins-kpis">
            <Kpi label="처리 건수" value={data.totals.total.toLocaleString()} unit="건" tone="accent" />
            <Kpi label="성공률" value={pct(data.successRate)} sub={`성공 ${data.totals.ok.toLocaleString()}건`} tone="ok" />
            <Kpi label="실패" value={data.totals.fail.toLocaleString()} unit="건" tone={data.totals.fail > 0 ? "err" : "muted"} />
            <Kpi label="평균 응답 속도" value={fmtDuration(data.avgResponseMs)} tone="muted" />
            <Kpi label="사용 인원" value={data.uniqueUsers.toLocaleString()} unit="명" tone="muted" />
            <Kpi
              label="누적 절감 효과"
              value={data.fte ? data.fte.annualFte.toFixed(2) : "—"}
              unit="FTE"
              sub={data.fte ? `${data.fte.totalCount.toLocaleString()}건 처리 (연 환산)` : "집계 준비 중"}
              tone="accent"
            />
          </div>

          <Card title="처리 추이" sub="성공 · 실패 적층" hero>
            <TimeSeriesChart stats={{ granularity: data.granularity, buckets: data.buckets }} />
          </Card>

          {showDaily && (
            <Card title="일별 현황" sub="하루 단위 처리량 — 날짜를 누르면 기능별 상세가 열립니다">
              <DailyTable rows={dailyRows} labelAction={actionLabel} />
            </Card>
          )}

          {/* 기능별 실적 + 주요 실패 원인 — "무엇을 처리했나 / 무엇이 안 됐나" 한 쌍으로 읽는다.
              둘 다 같은 형태의 막대 목록이라 나란히 두면 눈이 한 줄로 훑는다. */}
          <div className="ins-grid-2">
            <Card title="기능별 실적" sub="무엇을 얼마나 처리했나">
              {byAction.length === 0 ? (
                <div className="ins-empty">기간 내 처리 내역이 없습니다.</div>
              ) : (
                <ul className="ins-bars">
                  {byAction.map((a) => (
                    <li
                      key={a.key}
                      className={"ins-bar-row" + (a.key === ROUTING_FAIL_LABEL ? " muted" : "")}
                    >
                      <span className="ins-bar-key">{actionLabel(a.key)}</span>
                      <span className="ins-bar-track">
                        <span className="ins-bar-fill ok" style={{ width: `${(a.ok / maxAction) * 100}%` }} />
                        <span className="ins-bar-fill fail" style={{ width: `${(a.fail / maxAction) * 100}%` }} />
                      </span>
                      <span className="ins-bar-val">
                        <b>{a.total.toLocaleString()}</b>
                        <em>성공 {a.ok.toLocaleString()} · 실패 {a.fail.toLocaleString()}</em>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="주요 실패 원인" sub={topErrors.length > 0 ? `발생 빈도 상위 ${topErrors.length}건` : "기간 내 실패 사유"}>
              {topErrors.length === 0 ? (
                <div className="ins-empty">기간 내 실패한 요청이 없습니다 ✓</div>
              ) : (
                <ul className="ins-bars errors">
                  {topErrors.map((e) => (
                    <li key={e.code} className="ins-bar-row">
                      <span className="ins-bar-key" title={e.described ? `${e.label} (${e.code})` : e.code}>
                        <span className="ins-bar-reason">{e.label}</span>
                        {/* 설명이 붙은 항목만 코드를 보조로 병기한다 — 설명이 없으면 라벨이 이미 코드다 */}
                        {e.described && <em className="ins-bar-code">{e.code}</em>}
                      </span>
                      <span className="ins-bar-track">
                        <span className="ins-bar-fill fail" style={{ width: `${(e.count / maxError) * 100}%` }} />
                      </span>
                      <span className="ins-bar-val">
                        <b>{e.count.toLocaleString()}</b>
                        <em>건</em>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* ⚠️ 절감 효과 추이는 **혼자 한 줄을 쓰면 가로만 길고 안이 비어 보인다** (실제로 두 번
              그렇게 만들었다가 되돌렸다). 조밀하지 않은 카드는 반드시 짝을 지어 둘 것. */}
          <div className="ins-grid-2">
            <Card title="절감 효과 추이" sub="월별 FTE (1 FTE = 1인 1년치 업무량)">
              {data.fte ? <FteChart stats={data.fte} /> : <div className="ins-empty">집계 준비 중입니다.</div>}
            </Card>

            <Card title="FAB별 실적" sub="어느 팹에서 얼마나 처리했나">
              {byFac.length === 0 ? (
                <div className="ins-empty">기간 내 처리 내역이 없습니다.</div>
              ) : (
                <ul className="ins-bars">
                  {byFac.map((f) => (
                    <li key={f.key} className={"ins-bar-row" + (f.key === FAC_NONE ? " muted" : "")}>
                      <span className="ins-bar-key">{facLabel(f.key)}</span>
                      <span className="ins-bar-track">
                        <span className="ins-bar-fill ok" style={{ width: `${(f.ok / maxFac) * 100}%` }} />
                        <span className="ins-bar-fill fail" style={{ width: `${(f.fail / maxFac) * 100}%` }} />
                      </span>
                      <span className="ins-bar-val">
                        <b>{f.total.toLocaleString()}</b>
                        <em>성공 {f.ok.toLocaleString()} · 실패 {f.fail.toLocaleString()}</em>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* ═══ ② AI 운영 현황 ════════════════════════════════════ */}
          <div className="ins-sep">
            <span className="ins-sep-label">AI 운영 현황</span>
            <span className="ins-sep-hint">에이전트를 움직이는 LLM 의 사용량과 속도</span>
          </div>

          <div className="ins-kpis">
            <Kpi
              label="LLM 토큰 사용량"
              value={tokens ? compact(tokens.totals.totalTokens) : "—"}
              sub={
                tokens
                  ? `입력 ${compact(tokens.totals.inputTokens)} · 출력 ${compact(tokens.totals.outputTokens)}`
                  : undefined
              }
              tone="accent"
            />
            <Kpi
              label="LLM 호출"
              value={tokens ? tokens.totals.calls.toLocaleString() : "—"}
              unit="회"
              sub={
                tokens?.avgTotalPerCall != null
                  ? `호출당 평균 ${Math.round(tokens.avgTotalPerCall).toLocaleString()} 토큰`
                  : undefined
              }
              tone="muted"
            />
            <Kpi
              label="평균 LLM 속도"
              value={tokens ? fmtDuration(tokens.avgLatencyMs) : "—"}
              sub="응답에 성공한 호출 기준"
              tone="muted"
            />
            <Kpi
              label="타임아웃"
              value={timeouts?.available ? timeouts.timeoutCalls.toLocaleString() : "—"}
              unit={timeouts?.available ? "건" : undefined}
              sub={
                timeouts?.available
                  ? `전체 호출의 ${pct(timeoutRate)} · 영향 질문 ${timeouts.affectedTraces.toLocaleString()}건`
                  : "집계 준비 중"
              }
              tone={timeouts?.available && timeouts.timeoutCalls > 0 ? "err" : "muted"}
            />
          </div>

          <div className="ins-grid-2">
            <Card title="토큰 사용 추이" sub="입력 · 출력 적층">
              {tokens ? (
                <TokenChart stats={tokens} />
              ) : (
                <div className="ins-empty">토큰 데이터를 불러오지 못했습니다.</div>
              )}
            </Card>
            <Card title="LLM 속도 추이" sub="호출 1건의 평균 소요시간">
              {tokens ? (
                <TokenLatencyChart stats={tokens} />
              ) : (
                <div className="ins-empty">토큰 데이터를 불러오지 못했습니다.</div>
              )}
            </Card>
          </div>

          <div className="ins-grid-2">
            <Card title="타임아웃 발생 추이" sub="끊긴 LLM 호출">
              {!timeouts || !timeouts.available ? (
                <div className="ins-empty">타임아웃 집계가 아직 준비되지 않았습니다.</div>
              ) : timeouts.failedCalls === 0 ? (
                <div className="ins-empty">기간 내 끊긴 호출이 없습니다.</div>
              ) : (
                <TimeoutTrendChart stats={timeouts} />
              )}
            </Card>

            <Card title="모델별 현황" sub="어느 모델을 얼마나 쓰고 얼마나 빠른가">
              {modelRows.length === 0 ? (
                <div className="ins-empty">기간 내 LLM 호출이 없습니다.</div>
              ) : (
                <div className="ins-table-wrap">
                  <table className="ins-table">
                    <thead>
                      <tr>
                        <th>모델</th>
                        <th className="num">호출</th>
                        <th className="num">토큰</th>
                        <th className="num">평균 속도</th>
                        <th className="num">타임아웃</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelRows.map((m) => (
                        <tr key={m.key}>
                          <td>{m.key}</td>
                          <td className="num">{m.calls.toLocaleString()}</td>
                          <td className="num">{m.totalTokens.toLocaleString()}</td>
                          <td className="num">{fmtDuration(m.avgLatencyMs)}</td>
                          <td className={"num" + (m.timeout > 0 ? " err" : "")}>
                            {m.timeout > 0 ? m.timeout.toLocaleString() : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* 리포트 미리보기 — 기본 접힘. 복사 버튼과 같은 reportText 를 쓴다(두 벌 금지). */}
          <div className="ins-report">
            <button
              type="button"
              className={"ins-report-toggle" + (showPreview ? " open" : "")}
              onClick={() => setShowPreview((v) => !v)}
              aria-expanded={showPreview}
            >
              <span className="ins-report-caret" aria-hidden>▸</span>
              <span>리포트 미리보기</span>
              <span className="ins-report-hint">복사될 텍스트 전문</span>
            </button>
            {showPreview && (
              <div className="ins-report-body">
                <pre className="ins-report-text">{reportText}</pre>
                <button
                  type="button"
                  className={"btn primary copy-btn" + (copied ? " copied" : "")}
                  onClick={() => void copyReport()}
                >
                  {copied ? "✓ 복사됨" : "📋 리포트 복사"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
