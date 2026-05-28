import { DimensionStats } from "@/lib/types";

export function DimensionBreakdown({
  items,
  emptyText,
  onSelect,
  selected,
}: {
  items: DimensionStats[];
  emptyText: string;
  onSelect?: (key: string) => void;
  selected?: string;
}) {
  if (items.length === 0) {
    return <div className="top-empty">{emptyText}</div>;
  }
  const maxTotal = Math.max(1, ...items.map((i) => i.total));
  const grandTotal = items.reduce((a, b) => a + b.total, 0);

  return (
    <ul className="dim-list">
      {items.map((it) => {
        const okPct   = it.total > 0 ? (it.ok    / it.total) * 100 : 0;
        const failPct = it.total > 0 ? (it.fail  / it.total) * 100 : 0;
        const pendPct = it.total > 0 ? (it.pending / it.total) * 100 : 0;
        const share   = grandTotal > 0 ? (it.total / grandTotal) * 100 : 0;
        const wBar    = (it.total / maxTotal) * 100;
        const active  = selected === it.key;
        const isNone  = it.key === "(none)";
        return (
          <li
            key={it.key}
            className={"dim-row" + (active ? " active" : "") + (isNone ? " dim-none" : "")}
            onClick={onSelect && !isNone ? () => onSelect(it.key) : undefined}
            role={onSelect && !isNone ? "button" : undefined}
            tabIndex={onSelect && !isNone ? 0 : undefined}
            title={onSelect && !isNone ? (active ? `클릭하여 ${it.key} 필터 해제` : `클릭하여 ${it.key} 로 필터링`) : it.key}
          >
            <div className="dim-row-head">
              <span className="dim-key">{it.key}</span>
              <span className="dim-stats">
                <span className="dim-total">{it.total.toLocaleString()}</span>
                <span className="dim-share">{share.toFixed(1)}%</span>
              </span>
            </div>
            <div className="dim-track" aria-hidden>
              <div className="dim-track-fill" style={{ width: `${wBar}%` }} />
            </div>
            <div className="dim-stack" aria-hidden>
              {okPct > 0   && <span className="lbs ok"   style={{ width: `${okPct}%` }}   title={`OK ${it.ok}`} />}
              {failPct > 0 && <span className="lbs fail" style={{ width: `${failPct}%` }} title={`FAIL ${it.fail}`} />}
              {pendPct > 0 && <span className="lbs pend" style={{ width: `${pendPct}%` }} title={`PENDING ${it.pending}`} />}
            </div>
            <div className="dim-legend">
              <span className="lbs-l ok">OK {it.ok}</span>
              <span className="lbs-l fail">FAIL {it.fail}</span>
              {it.pending > 0 && <span className="lbs-l pend">PND {it.pending}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
