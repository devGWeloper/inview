"use client";

import { useMemo } from "react";
import { LAYER_COLOR, LAYER_LABEL, LAYER_ORDER, LayerKey, StatsResponse } from "@/lib/types";

// 레이어별 "소요 비중" — 어느 레이어가 실제로 시간을 썼고 어디서 실패가 시작됐나.
//
// ⚠️ 행의 SEND_TM→RESP_TM(=avgRespMs)은 하위 레이어 대기를 통째로 품는 포함(inclusive) 시간이라
// 언제나 진입 레이어가 1등으로 나온다. 여기서는 서버가 분해한 self time(avgSelfMs/selfMsTotal)을 쓴다.
// 분해 규칙은 src/app/api/stats/route.ts 의 self time 주석 참고 — Σ = 전체 응답시간이라 100% 비중이 된다.

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

type Seg = {
  layer: LayerKey;
  name: string;
  color: string;
  value: number;
  share: number;
  /** 세그먼트에 직접 얹을 값 (시간 스트립 = 평균 속도, 실패 스트립 = 건수) */
  label: string;
};

// 100% 스택 스트립 — 세그먼트 사이 2px 서피스 갭, 양끝만 라운드.
// 폭이 충분한 세그먼트에만 직접 라벨을 얹고, 나머지 값은 아래 표가 책임진다.
function ShareStrip({ segs }: { segs: Seg[] }) {
  const shown = segs.filter((s) => s.value > 0);
  if (shown.length === 0) return null;
  return (
    <div className="lb-strip">
      {shown.map((s) => (
        <div
          key={s.layer}
          className="lb-seg"
          style={{ flexGrow: s.value, background: s.color }}
          title={`${s.name} · ${s.label} (${fmtPct(s.share)})`}
        >
          {s.share >= 8 && (
            <span className="lb-seg-label">
              <span className="lb-seg-name">{s.layer}</span>
              {s.share >= 15 && <span className="lb-seg-val">{s.label}</span>}
              <span className="lb-seg-pct">{fmtPct(s.share)}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function LayerBudget({ stats }: { stats: StatsResponse }) {
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

  const timeSegs: Seg[] = rows.map((r) => ({
    layer: r.layer,
    name: r.name,
    color: r.color,
    value: r.selfTotal,
    share: pct(r.selfTotal, timeTotal),
    label: fmtMs(r.avgSelf),
  }));
  const failSegs: Seg[] = rows.map((r) => ({
    layer: r.layer,
    name: r.name,
    color: r.color,
    value: r.failOrigin,
    share: pct(r.failOrigin, failTotal),
    label: `${r.failOrigin.toLocaleString()}건`,
  }));

  if (traces === 0 || timeTotal === 0) {
    return (
      <div className="lb-empty">
        소요 비중을 계산할 수 있는 완료 트레이스가 없습니다.
        <span>진입 레이어({LAYER_ORDER[0]})의 수신·응답 시각이 모두 기록된 트레이스가 필요합니다.</span>
      </div>
    );
  }

  return (
    <div className="lb">
      <div className="lb-hero">
        <span className="lb-hero-k">평균 응답</span>
        <span className="lb-hero-v">{fmtMs(timeTotal / traces)}</span>
        <span className="lb-hero-note">
          완료 트레이스 {traces.toLocaleString()}건 · 아래 레이어별 평균의 합
        </span>
      </div>

      <div className="lb-block">
        <div className="lb-block-head">
          <span className="lb-block-title">시간 비중</span>
          <span className="lb-block-note">각 레이어가 스스로 쓴 평균 소요시간의 몫</span>
        </div>
        <ShareStrip segs={timeSegs} />
      </div>

      <div className="lb-block">
        <div className="lb-block-head">
          <span className="lb-block-title">실패 발생 비중</span>
          <span className="lb-block-note">에러가 처음 발생한 레이어 기준 · 총 {failTotal.toLocaleString()}건</span>
        </div>
        {failTotal > 0 ? (
          <ShareStrip segs={failSegs} />
        ) : (
          <div className="lb-strip-empty">기간 내 에러 코드가 기록된 트레이스가 없습니다.</div>
        )}
      </div>

      <table className="lb-table">
        <thead>
          <tr>
            <th>레이어</th>
            <th className="num">자체 소요 (평균)</th>
            <th className="num">시간 비중</th>
            <th className="num">실패 발생</th>
            <th className="num">호출 행</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.layer} className={r.layer === maxTimeLayer ? "peak" : ""}>
              <td>
                <span className="lb-chip" style={{ background: r.color }} />
                <span className="lb-name">{r.name}</span>
                <span className="lb-key">{r.layer}</span>
              </td>
              <td className="num strong">
                {fmtMs(r.avgSelf)}
                {r.layer === maxTimeLayer && <span className="lb-tag">최다</span>}
              </td>
              <td className="num">{fmtPct(pct(r.selfTotal, timeTotal))}</td>
              <td className="num">
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
  );
}
