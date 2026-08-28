"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { DailyTable, mergeDailyRows } from "@/components/DailyTable";
import { FteChart } from "@/components/FteChart";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { TimeoutTrendChart } from "@/components/TimeoutTrendChart";
import { TokenChart } from "@/components/TokenChart";
import { TokenLatencyChart, fmtDuration } from "@/components/TokenLatencyChart";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { InsightsResponse, ROUTING_FAIL_LABEL } from "@/lib/types";

/**
 * 일반 사용자(FIELD) 실적 화면 — 팀장·현장 엔지니어가 본다. 개발자용 진단 화면이 아니다.
 *
 * ⚠️ 이 화면의 데이터는 /api/insights **하나뿐**이다. 다른 API(/api/stats, /api/traces,
 *    /api/tokens, /api/timeouts …)를 여기서 부르지 말 것 — 그 응답에는 사번·질의 원문·
 *    에러 코드·내부 노드명이 들어 있고, 일반 사용자 계정은 애초에 그 경로들에서 403 이다
 *    (roles.ts FIELD_ALLOW_PREFIXES).
 *
 * 구성은 두 단이다:
 *   ① 업무 실적 — 무엇을 얼마나 처리했고 얼마나 아꼈나 (KPI · 추이 · 일별 · 기능별 · FTE)
 *   ② AI 운영 현황 — 그걸 돌리는 LLM 이 얼마나 쓰였고 빠른가 (토큰 · 속도 · 타임아웃)
 * "누가 무슨 요청을 했는지" 는 어느 단에도 없다 — 사용자는 **수(count)** 로만 나온다.
 *
 * 운영자/개발자도 같은 화면을 그대로 본다 — "일반 사용자에게 무엇이 보이는가" 를 확인하려면
 * 별도 미리보기가 아니라 같은 화면이어야 어긋나지 않는다.
 */

// 기간 프리셋은 두 줄이다.
//  ① 최근 구간 — "지금까지" 를 본다 (오늘 / 최근 7일 / 최근 30일 / 이번 달)
//  ② 주간      — **월~일 한 주를 통째로** 본다 (이번 주 / 지난주 / 2주 전 / 3주 전)
// ⚠️ "최근 7일"(오늘 포함 7일, 창이 매일 밀림)과 "지난주"(고정된 월~일)는 다른 구간이다.
//    주 단위 보고는 ②를 써야 매주 같은 기준으로 비교된다 — /report 의 주간 모드와 같은 정의다.
type Preset = "today" | "7d" | "30d" | "month" | `w${number}`;

const RECENT_PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
  { key: "month", label: "이번 달" },
];

/** 주간 프리셋 — offset 0 = 이번 주, 1 = 지난주 … (클릭 한 번으로 그 주 전체) */
const WEEK_PRESETS: { key: Preset; label: string }[] = [
  { key: "w0", label: "이번 주" },
  { key: "w1", label: "지난주" },
  { key: "w2", label: "2주 전" },
  { key: "w3", label: "3주 전" },
];

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function isoNoTz(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * offset 주 전의 [월요일 00:00, 다음 월요일 00:00) — /report 의 weekRange() 와 같은 정의.
 * ⚠️ 두 화면이 "지난주" 를 다르게 자르면 같은 주인데 숫자가 갈린다. 정의를 바꾸려면 양쪽 다.
 */
function weekRange(offset: number): { from: Date; to: Date } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - offset * 7); // (getDay()+6)%7 = 월요일까지의 일수
  const from = new Date(d);
  const to = new Date(d);
  to.setDate(to.getDate() + 7);
  return { from, to };
}

/** 프리셋 → 조회 구간 (Date). 주간이 아니면 끝은 '지금'. */
function rangeDates(preset: Preset): { from: Date; to: Date } {
  const now = new Date();
  if (preset.startsWith("w")) {
    const { from, to } = weekRange(Number(preset.slice(1)) || 0);
    // 이번 주는 아직 끝나지 않았다 — 상한을 '지금' 으로 줄여 일별 표에 빈 미래 날짜가 붙지 않게.
    return { from, to: to > now ? now : to };
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (preset === "7d") start.setDate(start.getDate() - 6);
  else if (preset === "30d") start.setDate(start.getDate() - 29);
  else if (preset === "month") start.setDate(1);
  return { from: start, to: now };
}

function rangeOf(preset: Preset): { from: string; to: string } {
  const { from, to } = rangeDates(preset);
  return { from: isoNoTz(from), to: isoNoTz(to) };
}

/** 조회 구간을 사람이 읽는 한 줄로 — 어느 구간을 보고 있는지 화면에 밝힌다. */
function rangeLabel(preset: Preset): string {
  const { from, to } = rangeDates(preset);
  const d = (x: Date) => `${String(x.getMonth() + 1).padStart(2, "0")}/${String(x.getDate()).padStart(2, "0")} (${DAY_KO[x.getDay()]})`;
  // 상한은 배타적(다음날 00:00)이라 표시용으로 1ms 당겨 마지막 날을 가리킨다.
  const last = new Date(to.getTime() - 1);
  return from.toDateString() === last.toDateString() ? d(from) : `${d(from)} ~ ${d(last)}`;
}

function pct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(1)}%`;
}

/** 큰 수를 KPI 한 칸에 담기 위한 축약 (12,345,678 → 12.3M). 표에는 쓰지 않는다. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
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
  const tokens = data?.tokens ?? null;
  const timeouts = data?.timeouts ?? null;

  // 일별 표는 하루짜리 조회에선 KPI 와 동어반복이라 2일 이상일 때만 노출한다.
  const showDaily = daily.length > 1;
  // /report 와 같은 표 = 같은 병합 규칙. 토큰 열은 tokens 가 없으면 자연히 0("-")이 된다.
  const dailyRows = useMemo(() => mergeDailyRows(data, tokens), [data, tokens]);
  const maxAction = useMemo(
    () => Math.max(1, ...byAction.map((a) => a.total)),
    [byAction]
  );

  // 모델별 현황 — 토큰(사용량·속도)과 타임아웃(끊김)을 모델 키로 합쳐 한 표로 읽는다.
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
              {RECENT_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={preset === p.key}
                  className={"preset-btn" + (preset === p.key ? " active" : "")}
                  onClick={() => setPreset(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {/* 주 단위 — 월~일 한 주를 클릭 한 번으로. 주간 보고가 매주 같은 기준이 되도록 분리했다 */}
            <div className="preset-group" role="tablist" aria-label="주 단위">
              {WEEK_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={preset === p.key}
                  className={"preset-btn week" + (preset === p.key ? " active" : "")}
                  onClick={() => setPreset(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ins-range" title="조회 구간">{rangeLabel(preset)}</div>
          <button type="button" className="btn ghost" onClick={() => void load(preset)}>
            새로고침
          </button>
        </div>
      </div>

      {/* 운영자/개발자에게만 — 지금 보고 있는 것이 '일반 사용자 공개 화면' 임을 밝힌다 */}
      {user && user.role !== "FIELD" && (
        <div className="ins-note">
          이 화면은 <b>일반 사용자 계정에게 공개되는 유일한 화면</b>입니다. 요청 원문 · 사번 · 에러
          코드 · 내부 노드명은 서버에서 제외되어 내려오지 않습니다.
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

          {/* 기능별 실적 + 절감 효과 추이 — 둘 다 한 줄을 다 쓸 만큼 조밀하지 않아 나란히 둔다 */}
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

            <Card title="절감 효과 추이" sub="월별 FTE (1 FTE = 1인 1년치 업무량)">
              {data.fte ? <FteChart stats={data.fte} /> : <div className="ins-empty">집계 준비 중입니다.</div>}
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
        </div>
      )}
    </div>
  );
}

function Card({
  title, sub, hero, children,
}: {
  title: string;
  sub?: string;
  hero?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={"dash-card" + (hero ? " dash-card-hero" : "")}>
      <div className="dash-card-head">
        <div className="dash-card-title-group">
          <span className="dash-card-title">{title}</span>
          {sub && <span className="dash-card-sub">{sub}</span>}
        </div>
      </div>
      <div className="dash-card-body">{children}</div>
    </section>
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
