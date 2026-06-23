"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
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

// 커스텀 호버 툴팁. 카드 overflow 에 안 잘리도록 portal + fixed 로 띄우고,
// 화면 상단 근처(앵커 top < 140px)면 아래로 자동 플립한다.
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
