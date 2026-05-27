import { TopItem } from "@/lib/types";

export function TopList({
  items, totalForPct, emptyText, tone,
}: {
  items: TopItem[];
  totalForPct: number;
  emptyText: string;
  tone: "neutral" | "err";
}) {
  if (items.length === 0) {
    return <div className="top-empty">{emptyText}</div>;
  }
  const maxCount = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="top-list">
      {items.map((it) => {
        const w = (it.count / maxCount) * 100;
        const p = totalForPct > 0 ? (it.count / totalForPct) * 100 : 0;
        return (
          <li key={it.key} className={`top-row tone-${tone}`}>
            <span className="top-key" title={it.key}>{it.key}</span>
            <div className="top-bar">
              <div className="top-bar-fill" style={{ width: `${w}%` }} />
            </div>
            <span className="top-count">{it.count.toLocaleString()}</span>
            <span className="top-pct">{p.toFixed(1)}%</span>
          </li>
        );
      })}
    </ul>
  );
}
