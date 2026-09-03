"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TickCall, TickMetricDef, TickMinute, TickStatsResponse, TickTrace, TICK_WINDOW_SEC } from "@/lib/types";
import { callStatus } from "@/lib/tokenStatus";
import { TickSlot, TickMonitorChart, fmtCompact, windowLabel } from "@/components/tick/TickMonitorChart";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";


const TOP_MOMENTS = 5;


interface Moment {
  startTs: string;
  minuteCount: number;
  peak: number;
  peakAt: string | null;
}

const rollOf = (m: TickMinute, slot: TickSlot) => (slot === "a" ? m.rollA : m.rollB);
const rollAtOf = (m: TickMinute, slot: TickSlot) => (slot === "a" ? m.rollAAt : m.rollBAt);

function buildSegments(minutes: TickMinute[], slot: TickSlot, limit: number): Moment[] {
  if (limit <= 0) return [];
  const out: Moment[] = [];
  let cur: Moment | null = null;
  for (const m of minutes) {
    const v = rollOf(m, slot);
    if (v > limit) {
      if (!cur) {
        cur = { startTs: m.ts, minuteCount: 1, peak: v, peakAt: rollAtOf(m, slot) };
      } else {
        cur.minuteCount += 1;
        if (v > cur.peak) {
          cur.peak = v;
          cur.peakAt = rollAtOf(m, slot);
        }
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.reverse();
}

function topMoments(minutes: TickMinute[], slot: TickSlot): Moment[] {
  const cands = minutes
    .map((m) => ({ ts: m.ts, v: rollOf(m, slot), at: rollAtOf(m, slot) }))
    .filter((c) => c.v > 0)
    .sort((a, b) => b.v - a.v);

  const out: Moment[] = [];
  const chosen: number[] = [];
  for (const c of cands) {
    if (out.length >= TOP_MOMENTS) break;
    const at = c.at ? Date.parse(c.at) : NaN;
    if (Number.isFinite(at) && chosen.some((x) => Math.abs(x - at) < TICK_WINDOW_SEC * 1000)) continue;
    if (Number.isFinite(at)) chosen.push(at);
    out.push({ startTs: c.ts, minuteCount: 1, peak: c.v, peakAt: c.at });
  }
  return out;
}

function inWindow<T>(items: T[], tsOf: (x: T) => string | null, startTs: string | null): T[] {
  if (!startTs) return [];
  const from = Date.parse(startTs);
  if (!Number.isFinite(from)) return [];
  const to = from + TICK_WINDOW_SEC * 1000;
  return items.filter((it) => {
    const raw = tsOf(it);
    if (!raw) return false;
    const t = Date.parse(raw);
    return Number.isFinite(t) && t >= from && t < to;
  });
}

const fmtInt = (n: number) => Math.round(n).toLocaleString();

export function TickMonitor({
  stats, metrics, title, rowsLabel, limitHref, headSlot, variant = "gauge",
}: {
  stats: TickStatsResponse;
  metrics: [TickMetricDef, TickMetricDef];
  // 집계 보기의 카드 제목을 그대로 받는다 — 제목까지 바뀌면 전환이 화면 교체로 보인다.
  title: string;
  rowsLabel: string;
  limitHref?: string;
  // 단위 선택은 차트 카드 머리 안에 있다 — 집계 보기와 같은 자리를 쓴다.
  headSlot?: React.ReactNode;
  // "status" = 집계와 같은 성공/실패 적층 차트(대시보드). 한도가 없는 BIZ 지표라 A/B 게이지가
  //   뜻이 없고, 색이 달라지면 보기를 바꿀 때 다른 차트로 읽힌다.
  // "gauge"  = A/B 단일 시리즈 + 한도 대비 게이지(Tokens·Timeout). 분당 한도 판정이 목적이다.
  variant?: "gauge" | "status";
}) {
  const status = variant === "status";
  const [slotState, setSlot] = useState<TickSlot>("a");
  const slot: TickSlot = status ? "a" : slotState;
  const [openMoment, setOpenMoment] = useState<string | null>(null);

  const def = slot === "a" ? metrics[0] : metrics[1];
  const limit = def.limit;
  const peak = slot === "a" ? stats.peakA : stats.peakB;

  const segA = useMemo(() => buildSegments(stats.minutes, "a", metrics[0].limit), [stats.minutes, metrics]);
  const segB = useMemo(() => buildSegments(stats.minutes, "b", metrics[1].limit), [stats.minutes, metrics]);
  const overCount = slot === "a" ? segA.length : segB.length;

  const moments = useMemo(
    () => (limit > 0 ? (slot === "a" ? segA : segB) : topMoments(stats.minutes, slot)),
    [limit, slot, segA, segB, stats.minutes]
  );

  const noLimit = metrics[0].limit <= 0 && metrics[1].limit <= 0;

  // A = 요청/분, B = 실패/분 → 집계 차트와 같은 {ok, fail} 모양으로 옮긴다.
  const statusBuckets = useMemo(
    () =>
      stats.minutes.map((m) => ({
        ts: m.ts,
        ok: Math.max(0, m.rollA - m.rollB),
        fail: m.rollB,
        pending: 0,
      })),
    [stats.minutes]
  );

  const pick = (s: TickSlot) => {
    setSlot(s);
    setOpenMoment(null);
  };

  return (
    <>
      {/* ⚠️ 차트 카드가 **맨 위**다. 집계 보기와 같은 자리·같은 제목·같은 머리 슬롯을 써서
          단위를 바꿔도 카드가 제자리에 있는 것처럼 보이게 한다. 게이지·순간 목록을 차트 위로
          올리지 말 것 — 차트가 아래로 밀려 화면이 통째로 갈린 것처럼 보인다. */}
      <section className="dash-card dash-card-hero">
        <div className="dash-card-head">
          <div className="dash-card-title-group">
            <span className="dash-card-title">{title}</span>
            <span className="dash-card-sub">
              {status ? "상태별 적층" : def.name} · 롤링 60초 · {rowsLabel}{" "}
              {fmtInt(stats.totals.rows)}건
            </span>
          </div>
          <div className="dash-card-aux">
            {headSlot}
            <span className={"aux-pill" + (limit > 0 && peak.value > limit ? " err" : "")}>
              <span className="aux-pill-key">최고</span>
              <span className="aux-pill-val">{fmtInt(peak.value)}</span>
            </span>
          </div>
        </div>
        <div className="dash-card-body">
          {status ? (
            <TimeSeriesChart stats={{ buckets: statusBuckets }} unitLabel="롤링 60초" />
          ) : (
            <TickMonitorChart
              minutes={stats.minutes}
              slot={slot}
              label={def.name}
              unit={def.unit}
              limit={limit}
            />
          )}
        </div>
      </section>

      {stats.statusAvailable === false && (
        <div className="tick-notice warn">
          실패 정보(STAT_CD / ERR_CTN)가 아직 적재되지 않았습니다 — 0 건이 아니라 <b>측정 불가</b>입니다.
        </div>
      )}

      {noLimit && limitHref && (
        <div className="tick-notice">
          한도 미설정 · <Link href={limitHref} prefetch={false}>관리자 페이지</Link>에서 설정
        </div>
      )}

      {/* 게이지는 차트 **아래**. 클릭이 위 차트의 A/B 를 바꾼다. */}
      {!status && (
      <div className="tick-gauges">
        <Gauge
          def={metrics[0]}
          peak={stats.peakA.value}
          overCount={segA.length}
          selected={slot === "a"}
          onSelect={() => pick("a")}
        />
        <Gauge
          def={metrics[1]}
          peak={stats.peakB.value}
          overCount={segB.length}
          selected={slot === "b"}
          onSelect={() => pick("b")}
        />
      </div>
      )}

      <section className="dash-card">
        <div className="dash-card-head">
          <div className="dash-card-title-group">
            <span className="dash-card-title">
              {def.name} {limit > 0 ? "초과한 순간" : "가장 몰린 순간"}
            </span>
          </div>
          {limit > 0 && overCount > 0 && (
            <div className="dash-card-aux">
              <span className="aux-pill err">
                <span className="aux-pill-val">{overCount}회</span>
              </span>
            </div>
          )}
        </div>
        <div className="dash-card-body">
          {moments.length === 0 ? (
            <div className={"tick-empty" + (limit > 0 ? " ok" : "")}>
              {limit > 0 ? "✓ 초과 없음" : "기록 없음"}
            </div>
          ) : (
            <div className="tick-seg-list">
              {moments.map((m) => (
                <MomentRow
                  key={m.startTs}
                  moment={m}
                  limit={limit}
                  unit={def.unit}
                  open={openMoment === m.startTs}
                  onToggle={() => setOpenMoment(openMoment === m.startTs ? null : m.startTs)}
                  stats={stats}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {stats.truncated && (
        <div className="tick-notice warn">행이 많아 최근 것만 표시됩니다.</div>
      )}
    </>
  );
}

function MomentRow({
  moment, limit, unit, open, onToggle, stats,
}: {
  moment: Moment;
  limit: number;
  unit: string;
  open: boolean;
  onToggle: () => void;
  stats: TickStatsResponse;
}) {
  const calls = open && stats.kind === "llm"
    ? inWindow(stats.calls, (c) => c.callTm, moment.peakAt)
    : [];
  const traces = open && stats.kind === "biz"
    ? inWindow(stats.traces, (t) => t.recvTm, moment.peakAt)
    : [];
  const rowCount = stats.kind === "llm" ? calls.length : traces.length;

  return (
    <div className={"tick-seg-item" + (open ? " open" : "") + (limit > 0 ? "" : " neutral")}>
      <button type="button" className="tick-seg-head" onClick={onToggle} aria-expanded={open}>
        <span className="tick-seg-caret">{open ? "▾" : "▸"}</span>
        <span className="tick-seg-time">{windowLabel(moment.peakAt) ?? "—"}</span>
        {moment.minuteCount > 1 && <span className="tick-seg-dur">{moment.minuteCount}분간</span>}
        <span className="tick-seg-peak">
          <b>{fmtInt(moment.peak)}</b>
          {limit > 0 ? (
            <span className="tick-seg-slash">/ {fmtInt(limit)}</span>
          ) : (
            <span className="tick-seg-slash">{unit}</span>
          )}
        </span>
        {limit > 0 && (
          <span className="tick-seg-over">{Math.round((moment.peak / limit) * 100)}%</span>
        )}
      </button>
      {open && (
        <div className="tick-seg-body">
          {rowCount === 0 ? (
            <div className="tick-empty">—</div>
          ) : stats.kind === "llm" ? (
            <>
              <div className="tick-win-sum">
                호출 <b>{calls.length}</b>건 ·{" "}
                <b>{fmtInt(calls.reduce((a, c) => a + c.totalTokens, 0))}</b> 토큰
              </div>
              <CallsTable calls={calls} />
            </>
          ) : (
            <>
              <div className="tick-win-sum">
                요청 <b>{traces.length}</b>건 · 실패 <b>{traces.filter((t) => t.failed).length}</b>건
              </div>
              <TracesTable traces={traces} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Gauge({
  def, peak, overCount, selected, onSelect,
}: {
  def: TickMetricDef;
  peak: number;
  overCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const has = def.limit > 0;
  const pct = has ? Math.round((peak / def.limit) * 100) : null;
  const over = has && peak > def.limit;
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
        <span className="tick-gauge-name">{def.name}</span>
        {has && <span className="tick-gauge-state">{over ? "한도 초과" : "정상"}</span>}
      </div>
      <div className="tick-gauge-val">
        {fmtCompact(peak)}
        <span className="tick-gauge-unit">{def.unitText}</span>
      </div>
      {has ? (
        <>
          <div className="tick-gauge-bar">
            <i style={{ width: `${fill}%` }} />
          </div>
          <div className="tick-gauge-foot">
            <span className="tick-gauge-pct">{pct}%</span>
            <span>한도 {fmtInt(def.limit)}</span>
            {overCount > 0 && <span className="tick-gauge-cnt">{overCount}번 초과</span>}
          </div>
        </>
      ) : (
        <div className="tick-gauge-foot">
          <span className="tick-gauge-quiet">기간 내 최고 60초</span>
        </div>
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
                <td className="num">{fmtInt(c.totalTokens)}</td>
                <td className="num">{c.latencyMs == null ? "—" : `${fmtInt(c.latencyMs)}ms`}</td>
                <td className="mono trace">{c.traceId ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TracesTable({ traces }: { traces: TickTrace[] }) {
  return (
    <div className="token-recent-wrap">
      <table className="token-recent tick-calls">
        <thead>
          <tr>
            <th>수신 시각</th>
            <th>사용자</th>
            <th>상태</th>
            <th>에러 코드</th>
            <th>TRACE_ID</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((t, i) => (
            <tr key={i}>
              <td className="mono">{t.recvTm ? t.recvTm.slice(11, 19) : "—"}</td>
              <td>{t.userId ?? "—"}</td>
              <td>
                {t.failed ? (
                  <span className="tick-call-flag error">실패</span>
                ) : (
                  <span className="tick-ok-mark">정상</span>
                )}
              </td>
              <td className="mono">{t.errCd ?? "—"}</td>
              <td className="mono trace">{t.traceId ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
