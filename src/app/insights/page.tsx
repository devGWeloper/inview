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
import { buildInsightsReport } from "@/lib/insightsReport";
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

// 기간 선택은 두 갈래다.
//  ① 최근 구간 — "지금까지" 를 본다 (오늘 / 최근 7일 / 최근 30일 / 이번 달)
//  ② 주간      — **월~일 한 주를 통째로** 본다. 이번 주/지난주는 버튼 한 번, 그 이전은 ◀ 로
//                계속 거슬러 올라간다 (몇 주 전이든).
// ⚠️ "최근 7일"(오늘 포함 7일, 창이 매일 밀림)과 "지난주"(고정된 월~일)는 다른 구간이다.
//    주 단위 보고는 ②를 써야 매주 같은 기준으로 비교된다.
type RecentKey = "today" | "7d" | "30d" | "month";

/**
 * 선택 상태. week 의 offset 은 0 = 이번 주, -1 = 지난주, -2 = 2주 전 …
 * custom 의 from/to 는 `datetime-local` 문자열("YYYY-MM-DDTHH:mm") 그대로다.
 */
type Sel =
  | { kind: "recent"; key: RecentKey }
  | { kind: "week"; offset: number }
  | { kind: "custom"; from: string; to: string };

const RECENT_PRESETS: { key: RecentKey; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
  { key: "month", label: "이번 달" },
];

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** 주 뱃지 */
function weekBadge(offset: number): string {
  if (offset === 0) return "이번 주";
  if (offset === -1) return "지난주";
  return `${-offset}주 전`;
}

/** 프리셋 버튼의 활성 여부 판정 (custom 은 비교 대상이 아니라 자기 버튼으로만 표시한다). */
function sameSel(a: Sel, b: Sel): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "recent" && b.kind === "recent") return a.key === b.key;
  if (a.kind === "week" && b.kind === "week") return a.offset === b.offset;
  return false;
}

function isoNoTz(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * offset 주의 [월요일 00:00, 다음 월요일 00:00).
 * ⚠️ 두 화면이 "지난주" 를 다르게 자르면 같은 주인데 숫자가 갈린다. 정의를 바꾸려면 양쪽 다.
 */
function weekRange(offset: number): { from: Date; to: Date } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7); // (getDay()+6)%7 = 월요일까지의 일수
  const from = new Date(d);
  const to = new Date(d);
  to.setDate(to.getDate() + 7);
  return { from, to };
}

/**
 * 선택 → 조회 구간 (Date). `to` 는 **배타적 상한**이다 (주간이면 다음 월요일 00:00).
 * ⚠️ 지나간 주의 상한을 '지금' 으로 줄이지 말 것 — 그러면 매번 다른 구간이 되어 비교가 깨진다.
 *    아직 끝나지 않은 이번 주만 '지금' 으로 줄인다(빈 미래 날짜가 붙지 않게).
 */
function rangeDates(sel: Sel): { from: Date; to: Date } {
  const now = new Date();
  if (sel.kind === "custom") {
    // 사용자가 찍은 시각 그대로. 뒤집혀 있으면 바로잡는다(빈 결과보다 낫다).
    const a = new Date(sel.from);
    const b = new Date(sel.to);
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  if (sel.kind === "week") {
    const { from, to } = weekRange(sel.offset);
    return { from, to: to > now ? now : to };
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (sel.key === "7d") start.setDate(start.getDate() - 6);
  else if (sel.key === "30d") start.setDate(start.getDate() - 29);
  else if (sel.key === "month") start.setDate(1);
  return { from: start, to: now };
}

function rangeOf(sel: Sel): { from: string; to: string } {
  const { from, to } = rangeDates(sel);
  return { from: isoNoTz(from), to: isoNoTz(to) };
}

/** 조회 구간을 사람이 읽는 한 줄로 — 어느 구간을 보고 있는지 화면에 밝힌다. */
function rangeLabel(sel: Sel): string {
  const { from, to } = rangeDates(sel);
  const d = (x: Date) => `${String(x.getMonth() + 1).padStart(2, "0")}/${String(x.getDate()).padStart(2, "0")} (${DAY_KO[x.getDay()]})`;
  // ⚠️ 직접 설정은 사용자가 찍은 상한을 그대로 쓴다 — 아래 -1ms 를 적용하면 8/10 을 골랐는데
  //    8/9 로 보여 "왜 하루가 빠지냐" 가 된다. 프리셋의 상한만 배타적이다.
  if (sel.kind === "custom") {
    const hm = (x: Date) => `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
    return `${d(from)} ${hm(from)} ~ ${d(to)} ${hm(to)}`;
  }
  // 상한이 배타적이라 표시용으로 1ms 당겨 **실제 마지막 날**을 가리킨다
  // (안 그러면 8/3~8/10 처럼 하루가 더 있는 것처럼 읽힌다).
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
  const [sel, setSel] = useState<Sel>({ kind: "recent", key: "30d" });
  // 직접 설정 입력값 — 적용(submit) 전까지는 조회에 반영하지 않는다(타이핑 중 재조회 방지).
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 리포트 복사 — 복사 직후 2초간 버튼 문구를 바꿔 성공을 알린다.
  const [copied, setCopied] = useState(false);
  // 미리보기는 **기본 접힘**이다. 항상 펼쳐 두면 화면 끝에 텍스트 덩어리가 붙어
  // 실적을 훑는 흐름을 끊는다 — 내용을 확인하고 싶을 때만 연다.
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

  // 주간 모드가 아니면 ◀ 는 "지난주" 부터 시작한다 (최근 구간에서 곧장 거슬러 올라갈 수 있게).
  const weekOffset = sel.kind === "week" ? sel.offset : 0;
  const goWeek = (offset: number) => setSel({ kind: "week", offset: Math.min(0, offset) });

  /** 직접 설정 진입 — 지금 보고 있는 구간을 그대로 채워 시작한다(빈 칸부터 찍게 하지 않는다). */
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
  const tokens = data?.tokens ?? null;
  const timeouts = data?.timeouts ?? null;

  // 일별 표는 하루짜리 조회에선 KPI 와 동어반복이라 2일 이상일 때만 노출한다.
  const showDaily = daily.length > 1;
  // 표와 리포트 텍스트가 **같은 행**을 공유한다. 토큰 열은 tokens 가 없으면 자연히 0("-")이 된다.
  const dailyRows = useMemo(() => mergeDailyRows(data, tokens), [data, tokens]);
  const maxAction = useMemo(
    () => Math.max(1, ...byAction.map((a) => a.total)),
    [byAction]
  );
  // 막대는 **1위 대비 상대 길이**다. topErrors 의 분모(행 수 vs 트레이스 수)가 실제 코드와
  // TEMP 가상 코드에서 서로 달라 "전체 대비 %" 로는 읽을 수 없기 때문 — 건수와 순위만 보여준다.
  const maxError = useMemo(
    () => Math.max(1, ...topErrors.map((e) => e.count)),
    [topErrors]
  );

  // 보고용 텍스트 — 화면에 그린 것과 **같은 데이터·같은 라벨**로 조립한다.
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
      // 사내 배포가 HTTP 라 clipboard API 가 막히는 경우가 있다 — 구형 경로로 폴백.
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
            {/* 주 단위 이동 — 월~일 한 주를 통째로 본다. ◀ 로 몇 주 전이든 거슬러 올라가고
                ▶ 는 이번 주에서 멈춘다(미래는 볼 것이 없다).
                ⚠️ 이번 주/지난주 버튼을 따로 두지 않는다 — 화살표가 그 역할을 겸한다. */}
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

          {/* 절감 효과 추이 — 12개월 막대라 폭을 다 쓰는 편이 읽기 좋다 */}
          <Card title="절감 효과 추이" sub="월별 FTE (1 FTE = 1인 1년치 업무량)">
            {data.fte ? <FteChart stats={data.fte} /> : <div className="ins-empty">집계 준비 중입니다.</div>}
          </Card>

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

          {/* ═══ 리포트 미리보기 ═════════════════════════════════════
              복사될 텍스트 전문. 기본은 접혀 있고, 무엇이 복사되는지 확인하고 싶을 때만 연다.
              ⚠️ 복사 버튼(툴바)과 **같은 reportText** 를 쓴다 — 두 벌로 만들면 어긋난다. */}
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
