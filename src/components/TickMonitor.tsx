"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TickCall, TickMinute, TickStatsResponse, TICK_WINDOW_SEC } from "@/lib/types";
import { callStatus } from "@/lib/tokenStatus";
import { TickMetric, TickMonitorChart, fmtCompact } from "@/components/TickMonitorChart";

// 1TICK 모니터 뷰 — Tokens 탭에서 "1TICK" 프리셋을 고르면 본문이 이걸로 바뀐다.
//
// 이 화면이 답하려는 질문은 하나다: **TPM/RPM 초과가 진짜 났나, 났다면 왜 났나.**
//   - "진짜 났나" → 정각 분이 아니라 슬라이딩 60초 최대(롤링)로 판정한다. 서버(tickStats.ts) 계산.
//   - "왜 났나"   → 초과 구간을 클릭하면 그 피크 60초 창에 들어간 LLM 호출을 전부 나열한다.
// 한도는 프로필(/admin)에서 온다. 미설정(0)이면 기준선 없이 추이만 보여준다.

export const TICK_WINDOWS = [15, 60, 180] as const;
export type TickWindowMin = typeof TICK_WINDOWS[number];

/** 한도를 넘은 분들을 연속 구간으로 병합한 것 */
interface Segment {
  startTs: string;
  /** 마지막 초과 분의 시작 시각 */
  endTs: string;
  minuteCount: number;
  peak: number;
  /** 피크를 만든 60초 창의 시작 시각 (드릴다운 기준) */
  peakAt: string | null;
}

function buildSegments(minutes: TickMinute[], metric: TickMetric, limit: number): Segment[] {
  if (limit <= 0) return [];
  const out: Segment[] = [];
  let cur: Segment | null = null;
  for (const m of minutes) {
    const v = metric === "tpm" ? m.rollTokens : m.rollCalls;
    const at = metric === "tpm" ? m.rollTokensAt : m.rollCallsAt;
    if (v > limit) {
      if (!cur) {
        cur = { startTs: m.ts, endTs: m.ts, minuteCount: 1, peak: v, peakAt: at };
      } else {
        cur.endTs = m.ts;
        cur.minuteCount += 1;
        if (v > cur.peak) {
          cur.peak = v;
          cur.peakAt = at;
        }
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  // 최근 구간을 먼저 본다 (모니터는 방금 난 초과가 우선)
  return out.reverse();
}

/** peakAt 부터 60초 창에 들어간 호출만 추린다 (드릴다운 = "왜 초과났나") */
function callsInWindow(calls: TickCall[], startTs: string | null): TickCall[] {
  if (!startTs) return [];
  const from = Date.parse(startTs);
  if (!Number.isFinite(from)) return [];
  const to = from + TICK_WINDOW_SEC * 1000;
  return calls.filter((c) => {
    if (!c.callTm) return false;
    const t = Date.parse(c.callTm);
    return Number.isFinite(t) && t >= from && t < to;
  });
}

const hhmm = (ts: string) => ts.slice(11, 16);
const hhmmss = (ts: string | null) => (ts ? ts.slice(11, 19) : "—");
const fmtInt = (n: number) => Math.round(n).toLocaleString();

export function TickMonitor({
  stats, tpmLimit, rpmLimit, windowMin, onWindowMin, auto, onAuto, loading, onRefresh,
}: {
  stats: TickStatsResponse;
  tpmLimit: number;
  rpmLimit: number;
  windowMin: TickWindowMin;
  onWindowMin: (w: TickWindowMin) => void;
  auto: boolean;
  onAuto: (v: boolean) => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [metric, setMetric] = useState<TickMetric>("tpm");
  const [openSeg, setOpenSeg] = useState<string | null>(null);

  const limit = metric === "tpm" ? tpmLimit : rpmLimit;
  const unit = metric === "tpm" ? "토큰" : "호출";
  const peak = metric === "tpm" ? stats.peakTpm : stats.peakRpm;

  const segments = useMemo(
    () => buildSegments(stats.minutes, metric, limit),
    [stats.minutes, metric, limit]
  );

  const tpmPct = tpmLimit > 0 ? Math.round((stats.peakTpm.value / tpmLimit) * 100) : null;
  const rpmPct = rpmLimit > 0 ? Math.round((stats.peakRpm.value / rpmLimit) * 100) : null;
  const noLimit = tpmLimit <= 0 && rpmLimit <= 0;

  return (
    <>
      <div className="tick-bar">
        <div className="tick-bar-left">
          <span className="tick-badge">1TICK</span>
          <span className="tick-bar-desc">연속 {TICK_WINDOW_SEC}초 기준</span>
        </div>
        <div className="tick-bar-right">
          <div className="tick-seg" role="tablist" aria-label="metric">
            <button
              type="button"
              className={"tick-seg-btn" + (metric === "tpm" ? " active" : "")}
              onClick={() => { setMetric("tpm"); setOpenSeg(null); }}
            >
              TPM
            </button>
            <button
              type="button"
              className={"tick-seg-btn" + (metric === "rpm" ? " active" : "")}
              onClick={() => { setMetric("rpm"); setOpenSeg(null); }}
            >
              RPM
            </button>
          </div>
          <div className="tick-seg" role="tablist" aria-label="window">
            {TICK_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                className={"tick-seg-btn" + (windowMin === w ? " active" : "")}
                onClick={() => onWindowMin(w)}
              >
                {w < 60 ? `${w}분` : `${w / 60}시간`}
              </button>
            ))}
          </div>
          <label className="tick-auto">
            <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
            자동 30초
          </label>
          <button type="button" className="btn ghost" onClick={onRefresh} disabled={loading}>
            {loading ? "조회 중…" : "새로고침"}
          </button>
        </div>
      </div>

      {noLimit && (
        <div className="tick-notice">
          TPM/RPM 한도가 없어 추이만 표시합니다.
          {" "}<Link href="/admin" prefetch={false}>관리자 페이지</Link>에서 한도를 설정하세요.
        </div>
      )}
      {stats.truncated && (
        <div className="tick-notice warn">
          호출이 너무 많아 최근 것만 불러왔습니다. 오래된 구간은 호출 목록이 비어 있을 수 있으니
          조회 범위를 좁히거나 필터를 거세요.
        </div>
      )}

      <div className="kpi-grid">
        <div className={"kpi-card " + (tpmPct !== null && tpmPct > 100 ? "tone-err" : "tone-default")}>
          <div className="kpi-title">Peak TPM</div>
          <div className="kpi-value">{fmtCompact(stats.peakTpm.value)}</div>
          <div className="kpi-sub">
            {tpmLimit > 0 ? `한도 ${fmtCompact(tpmLimit)} · ${tpmPct}%` : "한도 미설정"}
            {stats.peakTpm.at ? ` · ${hhmmss(stats.peakTpm.at)}~` : ""}
          </div>
        </div>
        <div className={"kpi-card " + (rpmPct !== null && rpmPct > 100 ? "tone-err" : "tone-default")}>
          <div className="kpi-title">Peak RPM</div>
          <div className="kpi-value">{fmtInt(stats.peakRpm.value)}</div>
          <div className="kpi-sub">
            {rpmLimit > 0 ? `한도 ${fmtInt(rpmLimit)} · ${rpmPct}%` : "한도 미설정"}
            {stats.peakRpm.at ? ` · ${hhmmss(stats.peakRpm.at)}~` : ""}
          </div>
        </div>
        <div className={"kpi-card " + (segments.length > 0 ? "tone-err" : "tone-ok")}>
          <div className="kpi-title">{metric.toUpperCase()} 초과 구간</div>
          <div className="kpi-value">{segments.length}</div>
          <div className="kpi-sub">
            {limit > 0
              ? segments.length > 0
                ? `${segments.reduce((a, s) => a + s.minuteCount, 0)}분 · 최고 ${fmtCompact(Math.max(...segments.map((s) => s.peak)))}`
                : "없음"
              : `${metric.toUpperCase()} 한도 미설정`}
          </div>
        </div>
        <div className="kpi-card tone-default">
          <div className="kpi-title">호출</div>
          <div className="kpi-value">{fmtInt(stats.totals.calls)}</div>
          <div className="kpi-sub">{fmtCompact(stats.totals.totalTokens)} 토큰 · 최근 {windowMin}분</div>
        </div>
      </div>

      <section className="dash-card dash-card-hero">
        <div className="dash-card-head">
          <div className="dash-card-title-group">
            <span className="dash-card-title">{metric.toUpperCase()} 추이</span>
            <span className="dash-card-sub">1분 단위</span>
          </div>
          <div className="dash-card-aux">
            <span className={"aux-pill" + (peak.value > limit && limit > 0 ? " err" : "")}>
              <span className="aux-pill-key">피크</span>
              <span className="aux-pill-val">{fmtInt(peak.value)} {unit}</span>
            </span>
            <span className="aux-pill">
              <span className="aux-pill-key">범위</span>
              <span className="aux-pill-val">
                {stats.range.from ? hhmm(stats.range.from) : "—"}~{stats.range.to ? hhmm(stats.range.to) : "—"}
              </span>
            </span>
          </div>
        </div>
        <div className="dash-card-body">
          <TickMonitorChart minutes={stats.minutes} metric={metric} limit={limit} />
        </div>
      </section>

      <section className="dash-card">
        <div className="dash-card-head">
          <div className="dash-card-title-group">
            <span className="dash-card-title">{metric.toUpperCase()} 초과 구간</span>
            <span className="dash-card-sub">행을 열면 해당 {TICK_WINDOW_SEC}초 안의 호출이 나옵니다</span>
          </div>
        </div>
        <div className="dash-card-body">
          {limit <= 0 ? (
            <div className="tick-empty">
              {metric.toUpperCase()} 한도가 설정되지 않았습니다.
            </div>
          ) : segments.length === 0 ? (
            <div className="tick-empty ok">초과 없음</div>
          ) : (
            <div className="tick-seg-list">
              {segments.map((s) => {
                const key = s.startTs;
                const open = openSeg === key;
                const inWin = open ? callsInWindow(stats.calls, s.peakAt) : [];
                const winTokens = inWin.reduce((a, c) => a + c.totalTokens, 0);
                return (
                  <div key={key} className={"tick-seg-item" + (open ? " open" : "")}>
                    <button
                      type="button"
                      className="tick-seg-head"
                      onClick={() => setOpenSeg(open ? null : key)}
                      aria-expanded={open}
                    >
                      <span className="tick-seg-caret">{open ? "▾" : "▸"}</span>
                      <span className="tick-seg-time">
                        {hhmm(s.startTs)}
                        {s.minuteCount > 1 ? ` ~ ${hhmm(s.endTs)}` : ""}
                        <span className="tick-seg-dur">{s.minuteCount}분</span>
                      </span>
                      <span className="tick-seg-peak">
                        <span className="tick-seg-peak-val">{fmtInt(s.peak)}</span>
                        <span className="tick-seg-peak-unit">{unit}/60s</span>
                      </span>
                      <span className="tick-seg-over">한도 {Math.round((s.peak / limit) * 100)}%</span>
                      <span className="tick-seg-at">{hhmmss(s.peakAt)} ~ +{TICK_WINDOW_SEC}s</span>
                    </button>
                    {open && (
                      <div className="tick-seg-body">
                        {inWin.length === 0 ? (
                          <div className="tick-empty">호출 상세를 불러오지 못했습니다.</div>
                        ) : (
                          <>
                            <div className="tick-win-sum">
                              호출 <b>{inWin.length}</b>건 · <b>{fmtInt(winTokens)}</b> 토큰
                            </div>
                            <CallsTable calls={inWin} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function CallsTable({ calls }: { calls: TickCall[] }) {
  return (
    <div className="token-recent-wrap">
      <table className="token-recent tick-calls">
        <thead>
          <tr>
            <th>호출 시각</th>
            <th>노드</th>
            <th>모델</th>
            <th>사용자</th>
            <th className="num">IN</th>
            <th className="num">OUT</th>
            <th className="num">TOTAL</th>
            <th className="num">대기</th>
            <th>TRACE_ID</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => {
            const st = callStatus(c.statCd, c.errCtn);
            return (
              <tr key={i}>
                <td className="mono">
                  {c.callTm ? c.callTm.slice(11, 23) : "—"}
                  {st !== "ok" && (
                    <span className={"tick-call-flag " + st} title={c.errCtn ?? undefined}>
                      {st === "timeout" ? "타임아웃" : "실패"}
                    </span>
                  )}
                </td>
                <td>{c.nodeNm ?? "—"}</td>
                <td>{c.modelNm ?? "—"}</td>
                <td>{c.userId ?? "—"}</td>
                <td className="num">{fmtInt(c.inputTokens)}</td>
                <td className="num">{fmtInt(c.outputTokens)}</td>
                <td className="num strong">{fmtInt(c.totalTokens)}</td>
                <td className="num">{c.latencyMs == null ? "—" : `${(c.latencyMs / 1000).toFixed(1)}s`}</td>
                <td className="mono dim">{c.traceId ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
