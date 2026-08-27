"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { FteChart } from "@/components/FteChart";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { fmtDuration } from "@/components/TokenLatencyChart";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { InsightsResponse, ROUTING_FAIL_LABEL } from "@/lib/types";

/**
 * 현업(FIELD) 실적 화면.
 *
 * ⚠️ 이 화면의 데이터는 /api/insights **하나뿐**이다. 다른 API(/api/stats, /api/traces,
 *    /api/tokens …)를 여기서 부르지 말 것 — 그 응답에는 사번·질의 원문·에러 코드가 들어 있고,
 *    현업 계정은 애초에 그 경로들에서 403 이다(roles.ts FIELD_ALLOW_PREFIXES).
 *
 * 운영자/개발자도 같은 화면을 그대로 본다 — "현업에게 무엇이 보이는가" 를 확인하려면
 * 별도 미리보기가 아니라 같은 화면이어야 어긋나지 않는다.
 */

type Preset = "today" | "7d" | "30d" | "month";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
  { key: "month", label: "이번 달" },
];

function isoNoTz(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 프리셋 → 조회 구간. 끝은 항상 '지금'. */
function rangeOf(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (preset === "7d") start.setDate(start.getDate() - 6);
  else if (preset === "30d") start.setDate(start.getDate() - 29);
  else if (preset === "month") start.setDate(1);
  return { from: isoNoTz(start), to: isoNoTz(now) };
}

function pct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(1)}%`;
}

/** 기능(ACTION_TYP) 내부 코드를 사람이 읽는 이름으로. 모르는 값은 그대로 둔다. */
const ACTION_LABEL: Record<string, string> = {
  NEST_Seasoning: "시즈닝",
  AutoQual_JobCreate: "AutoQual 실행",
  AutoQual_Abort: "AutoQual 취소",
};
function actionLabel(key: string): string {
  return ACTION_LABEL[key] ?? key;
}

export default function InsightsPage() {
  const { user } = useAuth();
  const [preset, setPreset] = useState<Preset>("30d");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (p: Preset) => {
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

  useEffect(() => { void load(preset); }, [preset, load]);

  const daily = asArray<InsightsResponse["daily"][number]>(data?.daily);
  const byAction = asArray<InsightsResponse["byAction"][number]>(data?.byAction);
  // 일별 표는 하루짜리 조회에선 KPI 와 동어반복이라 2일 이상일 때만 노출한다.
  const showDaily = daily.length > 1;
  const maxAction = useMemo(
    () => Math.max(1, ...byAction.map((a) => a.total)),
    [byAction]
  );

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
        <div className="dash-filter">
          <div className="preset-group" role="tablist" aria-label="기간">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={preset === p.key}
                className={"preset" + (preset === p.key ? " active" : "")}
                onClick={() => setPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn ghost" onClick={() => void load(preset)}>
            새로고침
          </button>
        </div>
      </div>

      {/* 운영자/개발자에게만 — 지금 보고 있는 것이 '현업 공개 화면' 임을 밝힌다 */}
      {user && user.role !== "FIELD" && (
        <div className="ins-note">
          이 화면은 <b>현업 계정에게 공개되는 유일한 화면</b>입니다. 요청 원문 · 사번 · 에러
          코드는 서버에서 제외되어 내려오지 않습니다.
        </div>
      )}

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}

      {data && (
        <div className="dash-body">
          {/* ── KPI ─────────────────────────────────────────────── */}
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

          {/* ── 처리 추이 ────────────────────────────────────────── */}
          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">처리 추이</span>
                <span className="dash-card-sub">성공 · 실패 적층</span>
              </div>
            </div>
            <div className="dash-card-body">
              <TimeSeriesChart stats={{ granularity: data.granularity, buckets: data.buckets }} />
            </div>
          </section>

          {/* ── 기능별 실적 ──────────────────────────────────────── */}
          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">기능별 실적</span>
                <span className="dash-card-sub">무엇을 얼마나 처리했나</span>
              </div>
            </div>
            <div className="dash-card-body">
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
            </div>
          </section>

          {/* ── 일별 현황 ────────────────────────────────────────── */}
          {showDaily && (
            <section className="dash-card">
              <div className="dash-card-head">
                <div className="dash-card-title-group">
                  <span className="dash-card-title">일별 현황</span>
                  <span className="dash-card-sub">하루 단위 처리량</span>
                </div>
              </div>
              <div className="dash-card-body">
                <div className="ins-table-wrap">
                  <table className="ins-table">
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th className="num">처리</th>
                        <th className="num">성공</th>
                        <th className="num">실패</th>
                        <th className="num">사용 인원</th>
                        <th className="num">평균 응답</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((d) => {
                        const dow = new Date(d.date + "T00:00:00").getDay();
                        return (
                          <tr key={d.date} className={dow === 0 ? "sun" : dow === 6 ? "sat" : undefined}>
                            <td>{d.date.slice(5)}</td>
                            <td className="num">{d.total.toLocaleString()}</td>
                            <td className="num ok">{d.ok.toLocaleString()}</td>
                            <td className={"num" + (d.fail > 0 ? " err" : "")}>{d.fail.toLocaleString()}</td>
                            <td className="num">{d.users.toLocaleString()}</td>
                            <td className="num">{fmtDuration(d.avgCubeLatencyMs)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* ── 절감 효과 추이 ───────────────────────────────────── */}
          {data.fte && (
            <section className="dash-card">
              <div className="dash-card-head">
                <div className="dash-card-title-group">
                  <span className="dash-card-title">절감 효과 추이</span>
                  <span className="dash-card-sub">월별 FTE (1 FTE = 1인 1년치 업무량)</span>
                </div>
              </div>
              <div className="dash-card-body">
                <FteChart stats={data.fte} />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({
  label, value, unit, sub, tone,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone: "accent" | "ok" | "err" | "muted";
}) {
  return (
    <div className={"ins-kpi tone-" + tone}>
      <div className="ins-kpi-label">{label}</div>
      <div className="ins-kpi-value">
        {value}
        {unit && <span className="ins-kpi-unit">{unit}</span>}
      </div>
      {sub && <div className="ins-kpi-sub">{sub}</div>}
    </div>
  );
}
