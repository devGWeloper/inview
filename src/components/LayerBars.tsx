import { LAYER_COLOR, LAYER_LABEL, StatsResponse } from "@/lib/types";

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function LayerBars({ stats }: { stats: StatsResponse }) {
  const maxTotal = Math.max(1, ...stats.layers.map((l) => l.total));
  return (
    <div className="layer-bars">
      {stats.layers.map((l) => {
        const okPct   = l.total > 0 ? (l.okRows   / l.total) * 100 : 0;
        const failPct = l.total > 0 ? (l.failCount / l.total) * 100 : 0;
        const errPct  = l.total > 0 ? (l.errCount  / l.total) * 100 : 0;
        const barW    = (l.total / maxTotal) * 100;
        return (
          <div key={l.layer} className="layer-bar-row">
            <div className="layer-bar-head">
              <span className="layer-bar-name">
                <span className="layer-bar-chip" style={{ background: LAYER_COLOR[l.layer] }} />
                {LAYER_LABEL[l.layer]}
              </span>
              <span className="layer-bar-stats">
                <span className="layer-bar-total">{l.total.toLocaleString()}</span>
                <span className="layer-bar-sep">·</span>
                <span className="layer-bar-rt">avg {fmtMs(l.avgRespMs)}</span>
              </span>
            </div>
            <div className="layer-bar-track" title={`${l.total} rows`}>
              <div className="layer-bar-fill" style={{ width: `${barW}%`, background: LAYER_COLOR[l.layer] }} />
            </div>
            <div className="layer-bar-stack" aria-hidden>
              {okPct > 0   && <span className="lbs ok"   style={{ width: `${okPct}%` }}   title={`OK ${l.okRows} (${okPct.toFixed(1)}%)`} />}
              {failPct > 0 && <span className="lbs fail" style={{ width: `${failPct}%` }} title={`FAIL ${l.failCount} (${failPct.toFixed(1)}%)`} />}
              {errPct > 0  && <span className="lbs err"  style={{ width: `${errPct}%` }}  title={`ERROR ${l.errCount} (${errPct.toFixed(1)}%)`} />}
            </div>
            <div className="layer-bar-legend">
              <span className="lbs-l ok">OK {l.okRows} <em>({okPct.toFixed(1)}%)</em></span>
              <span className="lbs-l fail">FAIL {l.failCount} <em>({failPct.toFixed(1)}%)</em></span>
              <span className="lbs-l err">ERR {l.errCount} <em>({errPct.toFixed(1)}%)</em></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
