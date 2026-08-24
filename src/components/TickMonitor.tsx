"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TickCall, TickMinute, TickStatsResponse, TICK_WINDOW_SEC } from "@/lib/types";
import { callStatus } from "@/lib/tokenStatus";
import { TickMetric, TickMonitorChart, fmtCompact, windowLabel } from "@/components/TickMonitorChart";

// 1TICK 모니터 뷰 — Tokens 탭에서 "1TICK" 프리셋을 고르면 본문이 이걸로 바뀐다.
//
// 화면은 위에서 아래로 세 가지만 답한다:
//   ① 지금 넘었나?  → 게이지 2장(TPM/RPM). 한도 대비 몇 %인지 막대로 바로 보인다.
//   ② 언제 넘었나?  → 추이 차트 (게이지를 클릭해 TPM/RPM 전환 — 별도 토글을 두지 않는다)
//   ③ 왜 넘었나?    → 초과한 순간 목록. 행을 열면 그 60초의 호출이 전부 나온다.
//
// 값은 전부 "그 분에서 가장 몰린 연속 60초" 기준이다(서버 tickStats.ts 계산).
// 정각 분 합계는 판정에 안 쓰이므로 화면에 그리지 않는다 — 판정값과 비판정값을
// 나란히 두면 어느 게 기준인지 읽는 사람이 헷갈린다.

export const TICK_WINDOWS = [15, 60, 180] as const;
export type TickWindowMin = typeof TICK_WINDOWS[number];

/** 한도를 넘은 분들을 연속 구간으로 병합한 것 */
interface Segment {
  startTs: string;
  minuteCount: number;
  peak: number;
  /** 피크를 만든 60초 구간의 시작 시각 (드릴다운 기준) */
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
        cur = { startTs: m.ts, minuteCount: 1, peak: v, peakAt: at };
      } else {
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
  // 최근 것을 먼저 본다
  return out.reverse();
}

/** peakAt 부터 60초 안에 들어간 호출만 추린다 (= 초과를 만든 호출들) */
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
  const peak = metric === "tpm" ? stats.peakTpm : stats.peakRpm;

  const tpmSegs = useMemo(() => buildSegments(stats.minutes, "tpm", tpmLimit), [stats.minutes, tpmLimit]);
  const rpmSegs = useMemo(() => buildSegments(stats.minutes, "rpm", rpmLimit), [stats.minutes, rpmLimit]);
  const segments = metric === "tpm" ? tpmSegs : rpmSegs;

  const noLimit = tpmLimit <= 0 && rpmLimit <= 0;
  const winText = windowMin < 60 ? `${windowMin}분` : `${windowMin / 60}시간`;

  const pick = (m: TickMetric) => {
    setMetric(m);
    setOpenSeg(null);
  };

  return (
    <>
      <div className="tick-bar">
        <span className="tick-bar-range">최근 {winText} · 호출 {fmtInt(stats.totals.calls)}건</span>
        <div className="tick-bar-right">
          <div className="tick-seg" role="tablist" aria-label="조회 범위">
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
            자동 새로고침
          </label>
          <button type="button" className="btn ghost" onClick={onRefresh} disabled={loading}>
            {loading ? "조회 중…" : "새로고침"}
          </button>
        </div>
      </div>

      {noLimit && (
        <div className="tick-notice">
          한도가 없어 사용량만 표시합니다.
          {" "}<Link href="/admin" prefetch={false}>관리자 페이지</Link>에서 TPM/RPM 한도를 설정하세요.
        </div>
      )}

      <div className="tick-gauges">
        <Gauge
          name="TPM" unitText="토큰/분"
          peak={stats.peakTpm.value} limit={tpmLimit} overCount={tpmSegs.length}
          selected={metric === "tpm"} onSelect={() => pick("tpm")}
        />
        <Gauge
          name="RPM" unitText="호출/분"
          peak={stats.peakRpm.value} limit={rpmLimit} overCount={rpmSegs.length}
          selected={metric === "rpm"} onSelect={() => pick("rpm")}
        />
      </div>

      <section className="dash-card dash-card-hero">
        <div className="dash-card-head">
          <div className="dash-card-title-group">
            <span className="dash-card-title">{metric.toUpperCase()} 추이</span>
            <span className="dash-card-sub">1분마다 · 그 분에서 가장 몰린 60초 값</span>
          </div>
          <div className="dash-card-aux">
            <span className={"aux-pill" + (limit > 0 && peak.value > limit ? " err" : "")}>
              <span className="aux-pill-key">최고</span>
              <span className="aux-pill-val">{fmtInt(peak.value)}</span>
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
            <span className="dash-card-title">{metric.toUpperCase()} 초과한 순간</span>
            <span className="dash-card-sub">행을 열면 그 60초 안의 호출이 나옵니다</span>
          </div>
        </div>
        <div className="dash-card-body">
          {limit <= 0 ? (
            <div className="tick-empty">{metric.toUpperCase()} 한도가 설정되지 않았습니다.</div>
          ) : segments.length === 0 ? (
            <div className="tick-empty ok">✓ 초과 없음</div>
          ) : (
            <div className="tick-seg-list">
              {segments.map((s) => {
                const open = openSeg === s.startTs;
                const inWin = open ? callsInWindow(stats.calls, s.peakAt) : [];
                const winTokens = inWin.reduce((a, c) => a + c.totalTokens, 0);
                return (
                  <div key={s.startTs} className={"tick-seg-item" + (open ? " open" : "")}>
                    <button
                      type="button"
                      className="tick-seg-head"
                      onClick={() => setOpenSeg(open ? null : s.startTs)}
                      aria-expanded={open}
                    >
                      <span className="tick-seg-caret">{open ? "▾" : "▸"}</span>
                      <span className="tick-seg-time">{windowLabel(s.peakAt) ?? "—"}</span>
                      {s.minuteCount > 1 && <span className="tick-seg-dur">{s.minuteCount}분간</span>}
                      <span className="tick-seg-peak">
                        <b>{fmtInt(s.peak)}</b>
                        <span className="tick-seg-slash">/ {fmtInt(limit)}</span>
                      </span>
                      <span className="tick-seg-over">{Math.round((s.peak / limit) * 100)}%</span>
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

      {stats.truncated && (
        <div className="tick-notice warn">
          호출이 많아 최근 것만 불러왔습니다. 오래된 구간은 호출 목록이 비어 있을 수 있으니
          조회 범위를 좁히거나 필터를 거세요.
        </div>
      )}
    </>
  );
}

/**
 * 한도 대비 사용량 게이지 1장 (TPM 또는 RPM).
 * 클릭하면 아래 차트/목록이 그 지표로 바뀐다 — 별도 토글을 두지 않고 카드가 곧 선택지다.
 */
function Gauge({
  name, unitText, peak, limit, overCount, selected, onSelect,
}: {
  name: string;
  unitText: string;
  peak: number;
  limit: number;
  overCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const has = limit > 0;
  const pct = has ? Math.round((peak / limit) * 100) : null;
  const over = has && peak > limit;
  // 막대는 100% 에서 멈춘다 — 넘친 양은 % 숫자로 읽고, 막대는 "가득 찼다" 만 보이면 된다.
  const fill = pct === null ? 0 : Math.min(100, pct);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "tick-gauge" + (selected ? " selected" : "") + (over ? " over" : has ? " ok" : " none")
      }
      aria-pressed={selected}
    >
      <div className="tick-gauge-top">
        <span className="tick-gauge-name">{name}</span>
        {has && <span className="tick-gauge-state">{over ? "한도 초과" : "정상"}</span>}
      </div>
      <div className="tick-gauge-val">
        {fmtCompact(peak)}
        <span className="tick-gauge-unit">{unitText}</span>
      </div>
      {has ? (
        <>
          <div className="tick-gauge-bar">
            <i style={{ width: `${fill}%` }} />
          </div>
          <div className="tick-gauge-foot">
            <span className="tick-gauge-pct">{pct}%</span>
            <span>한도 {fmtInt(limit)}</span>
            {overCount > 0 && <span className="tick-gauge-cnt">{overCount}번 초과</span>}
          </div>
        </>
      ) : (
        <div className="tick-gauge-foot">한도 미설정</div>
      )}
    </button>
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
                  {c.callTm ? c.callTm.slice(11, 19) : "—"}
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
