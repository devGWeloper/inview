"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { TopItem } from "@/lib/types";

interface Props {
  items: TopItem[];
  totalForPct: number;
  emptyText: string;
  tone: "neutral" | "err";
  onItemClick?: (key: string) => void;
  itemActionLabel?: string;
  descriptions?: Record<string, string>;
}

type Tip = { main?: string; sub?: string; left: number; top: number; below: boolean };

export function TopList({
  items, totalForPct, emptyText, tone, onItemClick, itemActionLabel, descriptions,
}: Props) {
  const [tip, setTip] = useState<Tip | null>(null);

  if (items.length === 0) {
    return <div className="top-empty">{emptyText}</div>;
  }
  const maxCount = Math.max(1, ...items.map((i) => i.count));
  const interactive = !!onItemClick;

  const showTip = (e: React.MouseEvent<HTMLElement>, main?: string, sub?: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const below = rect.top < 140;
    setTip({
      main,
      sub,
      left: rect.left + rect.width / 2,
      top: below ? rect.bottom + 8 : rect.top - 8,
      below,
    });
  };
  const hideTip = () => setTip(null);

  return (
    <>
      <ul className={"top-list" + (interactive ? " interactive" : "")}>
        {items.map((it) => {
          const w = (it.count / maxCount) * 100;
          const p = totalForPct > 0 ? (it.count / totalForPct) * 100 : 0;
          const desc = descriptions?.[it.key];
          const hint = interactive ? (itemActionLabel ?? "클릭") : undefined;
          const hasTip = !!(desc || hint);
          const handleClick = onItemClick
            ? () => { hideTip(); onItemClick(it.key); }
            : undefined;
          return (
            <li
              key={it.key}
              className={`top-row tone-${tone}`}
              onClick={handleClick}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={desc ? `${it.key}: ${desc}` : undefined}
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
              onMouseEnter={hasTip ? (e) => showTip(e, desc, hint) : undefined}
              onMouseLeave={hasTip ? hideTip : undefined}
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
      {tip && typeof document !== "undefined" && createPortal(
        <div
          className={"ttip" + (tip.below ? " below" : "")}
          style={{ left: tip.left, top: tip.top }}
          role="tooltip"
        >
          {tip.main && <div className="ttip-main">{tip.main}</div>}
          {tip.sub && <div className="ttip-sub">{tip.sub}</div>}
        </div>,
        document.body
      )}
    </>
  );
}
