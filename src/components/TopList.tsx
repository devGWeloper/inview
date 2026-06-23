import { TopItem } from "@/lib/types";

interface Props {
  items: TopItem[];
  totalForPct: number;
  emptyText: string;
  tone: "neutral" | "err";
  /** 항목 클릭 시 호출 (예: 에러 코드를 클릭해서 집계에서 제외). 지정 시 row 가 클릭 가능하게 표시됨 */
  onItemClick?: (key: string) => void;
  /** 행 호버 시 보여줄 안내 문구 (onItemClick 가 있을 때만 의미) */
  itemActionLabel?: string;
  /** key(에러 코드) → 의미 매핑. 있으면 호버 툴팁에 의미를 함께 노출 */
  descriptions?: Record<string, string>;
}

export function TopList({
  items, totalForPct, emptyText, tone, onItemClick, itemActionLabel, descriptions,
}: Props) {
  if (items.length === 0) {
    return <div className="top-empty">{emptyText}</div>;
  }
  const maxCount = Math.max(1, ...items.map((i) => i.count));
  const interactive = !!onItemClick;
  return (
    <ul className={"top-list" + (interactive ? " interactive" : "")}>
      {items.map((it) => {
        const w = (it.count / maxCount) * 100;
        const p = totalForPct > 0 ? (it.count / totalForPct) * 100 : 0;
        const handleClick = onItemClick ? () => onItemClick(it.key) : undefined;
        const desc = descriptions?.[it.key];
        const base = desc ? `${it.key} — ${desc}` : it.key;
        const title = interactive ? `${base} · ${itemActionLabel ?? "클릭"}` : base;
        return (
          <li
            key={it.key}
            className={`top-row tone-${tone}`}
            onClick={handleClick}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleClick?.();
                    }
                  }
                : undefined
            }
            title={title}
          >
            <span className="top-key">{it.key}</span>
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
