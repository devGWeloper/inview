"use client";

import { useMemo, useState } from "react";
import { LAYER_COLOR, LAYER_LABEL, LAYER_ORDER, LayerKey, StatsResponse } from "@/lib/types";

function fmtMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function pct(v: number, total: number): number {
  return total > 0 ? (v / total) * 100 : 0;
}

function fmtPct(v: number): string {
  if (v === 0) return "0%";
  if (v < 0.1) return "<0.1%";
  return `${v.toFixed(1)}%`;
}

type Mode = "time" | "fail";

type Seg = {
  layer: LayerKey;
  name: string;
  color: string;
  value: number;
  share: number;
  label: string;
};

const BOX = 190;       // viewBox 한 변
const C = BOX / 2;
const R_OUT = 84;
const R_IN = 56;
const LIFT = 5;        // hover 시 바깥으로 밀어내는 양
const PAD = 0.018;     // 세그먼트 사이 간격(rad)

function arcPath(r1: number, r2: number, a0: number, a1: number): string {
  const at = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M${at(r2, a0)}`,
    `A${r2} ${r2} 0 ${large} 1 ${at(r2, a1)}`,
    `L${at(r1, a1)}`,
    `A${r1} ${r1} 0 ${large} 0 ${at(r1, a0)}`,
    "Z",
  ].join(" ");
}

function ShareDonut({
  segs,
  hover,
  onHover,
}: {
  segs: Seg[];
  hover: LayerKey | null;
  onHover: (l: LayerKey | null) => void;
}) {
  const shown = segs.filter((s) => s.value > 0);
  const total = shown.reduce((a, s) => a + s.value, 0);

  const gap = shown.length > 1 ? PAD : 0;
  let cursor = -Math.PI / 2;
  const arcs = shown.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = cursor + gap / 2;
    const a1 = cursor + Math.max(sweep - gap / 2, gap / 2 + 0.004);
    cursor += sweep;
    return { seg: s, a0, a1 };
  });

  return (
    <svg className="lb-donut" viewBox={`0 0 ${BOX} ${BOX}`} role="img" aria-label="레이어별 비중">
      <circle cx={C} cy={C} r={(R_OUT + R_IN) / 2} fill="none" stroke="var(--surface-3)" strokeWidth={R_OUT - R_IN} />
      {/* 100% 한 조각(예: 실패가 한 레이어에서만)은 시작점=끝점이라 arc 가 사라진다 → 온전한 링으로 */}
      {arcs.length === 1 ? (
        <circle
          className="lb-arc"
          cx={C}
          cy={C}
          r={(R_OUT + R_IN) / 2}
          fill="none"
          stroke={arcs[0].seg.color}
          strokeWidth={R_OUT - R_IN}
          onMouseEnter={() => onHover(arcs[0].seg.layer)}
          onMouseLeave={() => onHover(null)}
        >
          <title>{`${arcs[0].seg.name} · ${arcs[0].seg.label} (${fmtPct(arcs[0].seg.share)})`}</title>
        </circle>
      ) : arcs.map(({ seg, a0, a1 }) => {
        const on = hover === seg.layer;
        const dim = hover !== null && !on;
        return (
          <path
            key={seg.layer}
            className={"lb-arc" + (dim ? " dim" : "")}
            d={arcPath(R_IN, R_OUT + (on ? LIFT : 0), a0, a1)}
            fill={seg.color}
            onMouseEnter={() => onHover(seg.layer)}
            onMouseLeave={() => onHover(null)}
          >
            <title>{`${seg.name} · ${seg.label} (${fmtPct(seg.share)})`}</title>
          </path>
        );
      })}
    </svg>
  );
}

export function LayerBudget({ stats }: { stats: StatsResponse }) {
  const [mode, setMode] = useState<Mode>("time");
  const [hover, setHover] = useState<LayerKey | null>(null);

  const { rows, timeTotal, failTotal, maxTimeLayer, maxFailLayer, traces } = useMemo(() => {
    const byLayer = new Map(stats.layers.map((l) => [l.layer, l]));
    const rows = LAYER_ORDER.map((l) => {
      const s = byLayer.get(l);
      return {
        layer: l,
        name: LAYER_LABEL[l],
        color: LAYER_COLOR[l],
        selfTotal: s?.selfMsTotal ?? 0,
        avgSelf: s?.avgSelfMs ?? null,
        failOrigin: s?.failOriginTraces ?? 0,
        failRows: s?.failCount ?? 0,
        totalRows: s?.total ?? 0,
      };
    });
    const timeTotal = rows.reduce((a, r) => a + r.selfTotal, 0);
    const failTotal = rows.reduce((a, r) => a + r.failOrigin, 0);
    const maxTime = Math.max(...rows.map((r) => r.selfTotal));
    const maxFail = Math.max(...rows.map((r) => r.failOrigin));
    return {
      rows,
      timeTotal,
      failTotal,
      maxTimeLayer: maxTime > 0 ? rows.find((r) => r.selfTotal === maxTime)!.layer : null,
      maxFailLayer: maxFail > 0 ? rows.find((r) => r.failOrigin === maxFail)!.layer : null,
      traces: stats.selfTimeTraces ?? 0,
    };
  }, [stats.layers, stats.selfTimeTraces]);

  const segs: Seg[] = rows.map((r) => {
    const v = mode === "time" ? r.selfTotal : r.failOrigin;
    return {
      layer: r.layer,
      name: r.name,
      color: r.color,
      value: v,
      share: pct(v, mode === "time" ? timeTotal : failTotal),
      label: mode === "time" ? fmtMs(r.avgSelf) : `${r.failOrigin.toLocaleString()}건`,
    };
  });

  if (traces === 0 || timeTotal === 0) {
    return (
      <div className="lb-empty">
        소요 비중을 계산할 수 있는 완료 트레이스가 없습니다.
        <span>진입 레이어({LAYER_ORDER[0]})의 수신·응답 시각이 모두 기록된 트레이스가 필요합니다.</span>
      </div>
    );
  }

  const hovered = hover ? segs.find((s) => s.layer === hover) ?? null : null;
  const empty = mode === "fail" && failTotal === 0;

  const center = hovered
    ? { k: hovered.layer, v: hovered.label, note: `${fmtPct(hovered.share)} 비중` }
    : mode === "time"
      ? { k: "평균 응답", v: fmtMs(timeTotal / traces), note: `완료 ${traces.toLocaleString()}건` }
      : { k: "실패 발생", v: `${failTotal.toLocaleString()}건`, note: empty ? "기간 내 없음" : "최초 발생 레이어 기준" };

  return (
    <div className="lb">
      <div className="lb-viz">
        <div className="lb-modes" role="tablist" aria-label="비중 기준">
          {(["time", "fail"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={"lb-mode" + (mode === m ? " on" : "")}
              onClick={() => setMode(m)}
            >
              {m === "time" ? "시간" : "실패"}
            </button>
          ))}
        </div>

        <div className={"lb-donut-wrap" + (empty ? " empty" : "")}>
          <ShareDonut segs={segs} hover={hover} onHover={setHover} />
          <div className="lb-center" aria-hidden>
            <span className="lb-center-k">{center.k}</span>
            <span className="lb-center-v">{center.v}</span>
            <span className="lb-center-note">{center.note}</span>
          </div>
        </div>

        <p className="lb-legendnote">
          {mode === "time"
            ? "각 레이어가 스스로 쓴 소요시간의 몫"
            : "에러가 처음 발생한 레이어의 몫"}
        </p>
      </div>

      <div className="lb-detail">
        <table className="lb-table">
          <thead>
            <tr>
              <th>레이어</th>
              <th className="num">자체 소요</th>
              <th className={"num" + (mode === "time" ? " on" : "")}>시간 비중</th>
              <th className={"num" + (mode === "fail" ? " on" : "")}>실패 발생</th>
              <th className="num">행</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.layer}
                className={hover === r.layer ? "on" : hover !== null ? "dim" : ""}
                onMouseEnter={() => setHover(r.layer)}
                onMouseLeave={() => setHover(null)}
              >
                <td>
                  <span className="lb-chip" style={{ background: r.color }} />
                  <span className="lb-name">{r.name}</span>
                  <span className="lb-key">{r.layer}</span>
                </td>
                <td className="num strong">
                  {fmtMs(r.avgSelf)}
                  {r.layer === maxTimeLayer && <span className="lb-tag">최다</span>}
                </td>
                <td className={"num" + (mode === "time" ? " on" : "")}>{fmtPct(pct(r.selfTotal, timeTotal))}</td>
                <td className={"num" + (mode === "fail" ? " on" : "")}>
                  {r.failOrigin > 0 ? (
                    <span className="lb-fail">{r.failOrigin.toLocaleString()}건</span>
                  ) : (
                    <span className="lb-zero">0</span>
                  )}
                  {r.layer === maxFailLayer && <span className="lb-tag fail">최다</span>}
                </td>
                <td className="num dim">{r.totalRows.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="lb-foot">
          자체 소요 = 이 레이어의 <code>SEND→RESP</code> 에서 바로 아래 레이어의 대기시간을 뺀 값(전송 지연·자체 처리 포함).
          최하위 {LAYER_ORDER[LAYER_ORDER.length - 1]} 는 외부 시스템 호출까지가 제 몫이다.
        </p>
      </div>
    </div>
  );
}
