"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TickCall, TickMetricDef, TickMinute, TickStatsResponse, TickTrace, TICK_WINDOW_SEC } from "@/lib/types";
import { callStatus } from "@/lib/tokenStatus";
import { TickSlot, TickMonitorChart, fmtCompact, windowLabel } from "@/components/TickMonitorChart";

// 틱 모니터 본문 (집계 ↔ 틱 토글의 "틱" 쪽) — Dashboard / Tokens / Timeout 이 공유한다.
//
// 화면은 위에서 아래로 세 가지만 답한다:
//   ① 지금 얼마나?  → 게이지 2장. 한도가 있으면 대비 %, 없으면 값과 피크 시각.
//   ② 언제 몰렸나?  → 추이 차트 (게이지를 클릭해 지표 전환 — 별도 토글을 두지 않는다)
//   ③ 왜 그랬나?    → 순간 목록. 행을 열면 그 60초의 원본 행이 전부 나온다.
//
// 표시되는 값은 전부 "그 분 안에서 값이 가장 큰 연속 60초" 다(서버 rollupTick 계산).
// 정각 분 합계는 판정에 안 쓰이므로 화면에 그리지 않는다.
//
// ⚠️ 조회 툴바(창 길이·직접 설정·자동 갱신)는 여기 없다 — 페이지 헤더의 TickToolbar 가
//    기간 프리셋 줄 자리에서 담당한다. 두 줄로 나뉘어 있으면 어느 쪽이 지금 조회 조건인지
//    읽는 사람이 헷갈린다.
// ⚠️ 지표가 무엇인지(TPM / 타임아웃 / 요청…)는 이 컴포넌트가 모른다 — metrics 로 받는다.

/** 목록에 세울 "몰린 순간" 최대 개수 (한도가 없는 화면에서 쓴다) */
const TOP_MOMENTS = 5;

/** 'YYYY-MM-DDTHH:MM:SS' 두 개 → 'MM/DD HH:MM → HH:MM' (날이 다르면 뒤쪽에도 날짜) */
function fmtSpan(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  const day = (v: string) => v.slice(5, 10).replace("-", "/");
  const hm = (v: string) => v.slice(11, 16);
  return from.slice(0, 10) === to.slice(0, 10)
    ? `${day(from)} ${hm(from)} → ${hm(to)}`
    : `${day(from)} ${hm(from)} → ${day(to)} ${hm(to)}`;
}

/** 목록 1줄 — 한도 초과 구간이거나(한도 있음) 가장 몰린 순간이거나(한도 없음) */
interface Moment {
  /** 그 구간이 시작된 분 (목록 key) */
  startTs: string;
  /** 연속 초과가 몇 분간 이어졌나 (한도 없는 화면은 항상 1) */
  minuteCount: number;
  peak: number;
  /** 피크를 만든 60초 구간의 시작 시각 (드릴다운 기준) */
  peakAt: string | null;
}

const rollOf = (m: TickMinute, slot: TickSlot) => (slot === "a" ? m.rollA : m.rollB);
const rollAtOf = (m: TickMinute, slot: TickSlot) => (slot === "a" ? m.rollAAt : m.rollBAt);

/** 한도를 넘은 분들을 연속 구간으로 병합 (한도가 있을 때) */
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
  // 최근 것을 먼저 본다
  return out.reverse();
}

/**
 * 한도가 없는 화면용 — 값이 가장 큰 순간 TOP N.
 * ⚠️ 같은 버스트의 이웃한 분들이 목록을 채우지 않도록, 이미 고른 순간과 60초 안에서
 *    겹치는 후보는 건너뛴다. 안 그러면 "가장 몰린 5개" 가 사실상 한 사건이 된다.
 */
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

/** peakAt 부터 60초 안에 들어간 행만 추린다 (= 그 순간을 만든 행들) */
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
  stats, metrics, rowsLabel, clamped, limitHref,
}: {
  stats: TickStatsResponse;
  /** [A, B] — 게이지 순서 그대로. 의미·단위·한도를 화면이 정한다. */
  metrics: [TickMetricDef, TickMetricDef];
  /** 요약 줄의 행 단위 문구 ("호출" | "요청") */
  rowsLabel: string;
  /** 서버가 24시간으로 잘랐는가 */
  clamped: boolean;
  /** 한도를 설정하러 갈 곳. 없으면 "한도 미설정" 안내를 띄우지 않는다. */
  limitHref?: string;
}) {
  const [slot, setSlot] = useState<TickSlot>("a");
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

  const pick = (s: TickSlot) => {
    setSlot(s);
    setOpenMoment(null);
  };

  return (
    <>
      <div className="tick-summary">
        <span className="tick-summary-range">{fmtSpan(stats.range.from, stats.range.to)}</span>
        <span className="tick-summary-sep">·</span>
        <span>
          {rowsLabel} <b>{fmtInt(stats.totals.rows)}</b>건
        </span>
      </div>

      {clamped && (
        <div className="tick-notice warn">
          틱 조회는 한 번에 최대 24시간까지 집계합니다 — 지정한 구간 중 <b>뒤쪽 24시간</b>만 표시됩니다.
        </div>
      )}

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

      <section className="dash-card dash-card-hero">
        <div className="dash-card-head">
          <div className="dash-card-title-group">
            <span className="dash-card-title">{def.name} 추이</span>
          </div>
          <div className="dash-card-aux">
            <span className={"aux-pill" + (limit > 0 && peak.value > limit ? " err" : "")}>
              <span className="aux-pill-key">최고</span>
              <span className="aux-pill-val">{fmtInt(peak.value)}</span>
            </span>
          </div>
        </div>
        <div className="dash-card-body">
          <TickMonitorChart
            minutes={stats.minutes}
            slot={slot}
            label={def.name}
            unit={def.unit}
            limit={limit}
          />
        </div>
      </section>

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

/** 목록 1줄 + 펼쳤을 때의 원본 행 (소스에 따라 호출 표 / 요청 표) */
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

/**
 * 지표 1개의 게이지.
 * 클릭하면 아래 차트/목록이 그 지표로 바뀐다 — 별도 토글을 두지 않고 카드가 곧 선택지다.
 * 한도가 없으면(limit=0) 막대 대신 피크 시각을 적는다 — 채울 기준이 없는 막대는 뜻이 없다.
 */
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

/**
 * BIZ 요청 표 (kind="biz").
 * ⚠️ 진입 레이어 행만 읽으므로 액션/FAB 열이 없다 — 둘 다 다른 레이어가 기록하는 값이라
 *    여기서는 항상 비어 있다. 자세한 내용은 TRACE_ID 로 Traces 화면에서 본다.
 */
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
