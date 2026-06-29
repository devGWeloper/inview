import { TokenDimStat } from "@/lib/types";

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

// 노드별 / 모델별 토큰 분포. 막대는 totalTokens 비중, 그 아래 input/output 적층.
export function TokenBreakdown({
  items,
  emptyText,
  onSelect,
  selected,
}: {
  items: TokenDimStat[];
  emptyText: string;
  onSelect?: (key: string) => void;
  selected?: string;
}) {
  if (items.length === 0) {
    return <div className="top-empty">{emptyText}</div>;
  }
  const maxTotal = Math.max(1, ...items.map((i) => i.totalTokens));
  const grandTotal = items.reduce((a, b) => a + b.totalTokens, 0);

  return (
    <ul className="dim-list">
      {items.map((it) => {
        const promptPct = it.totalTokens > 0 ? (it.inputTokens / it.totalTokens) * 100 : 0;
        const complPct = it.totalTokens > 0 ? (it.outputTokens / it.totalTokens) * 100 : 0;
        const share = grandTotal > 0 ? (it.totalTokens / grandTotal) * 100 : 0;
        const wBar = (it.totalTokens / maxTotal) * 100;
        const active = selected === it.key;
        const isNone = it.key === "(none)";
        const interactive = !!onSelect && !isNone;
        return (
          <li
            key={it.key}
            className={"dim-row" + (active ? " active" : "") + (isNone ? " dim-none" : "")}
            onClick={interactive ? () => onSelect!(it.key) : undefined}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            title={interactive ? (active ? `클릭하여 ${it.key} 필터 해제` : `클릭하여 ${it.key} 로 필터링`) : it.key}
          >
            <div className="dim-row-head">
              <span className="dim-key">{it.key}</span>
              <span className="dim-stats">
                <span className="dim-total">{fmtCompact(it.totalTokens)}</span>
                <span className="dim-share">{share.toFixed(1)}%</span>
              </span>
            </div>
            <div className="dim-track" aria-hidden>
              <div className="dim-track-fill" style={{ width: `${wBar}%` }} />
            </div>
            <div className="dim-stack" aria-hidden>
              {promptPct > 0 && <span className="tks prompt" style={{ width: `${promptPct}%` }} title={`INPUT ${it.inputTokens}`} />}
              {complPct > 0 && <span className="tks compl" style={{ width: `${complPct}%` }} title={`OUTPUT ${it.outputTokens}`} />}
            </div>
            <div className="dim-legend">
              <span className="tks-l prompt">IN {fmtCompact(it.inputTokens)}</span>
              <span className="tks-l compl">OUT {fmtCompact(it.outputTokens)}</span>
              <span className="tks-l calls">{it.calls.toLocaleString()} calls</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
