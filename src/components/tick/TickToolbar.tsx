"use client";

import { useEffect, useState } from "react";
import {
  TICK_WINDOWS,
  TickWindowMin,
  tickWindowLabel,
  toLocalMin,
  useTick,
} from "@/components/tick/TickProvider";

export function TickPresets({
  loading, onSubmit,
}: {
  loading: boolean;
  onSubmit: () => void;
}) {
  const { sel, setWin, setCustom } = useTick();
  const [open, setOpen] = useState(sel.mode === "custom");
  const [from, setFrom] = useState(sel.from);
  const [to, setTo] = useState(sel.to);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sel.mode === "custom") {
      setOpen(true);
      if (sel.from) setFrom(sel.from);
      if (sel.to) setTo(sel.to);
    } else {
      setOpen(false);
    }
  }, [sel.mode, sel.from, sel.to]);

  const enterCustom = () => {
    if (!from || !to) {
      const now = Date.now();
      setFrom(toLocalMin(now - sel.win * 60_000));
      setTo(toLocalMin(now));
    }
    setOpen(true);
  };

  const pickWin = (w: TickWindowMin) => {
    setOpen(false);
    setError(null);
    setWin(w);
    onSubmit();
  };

  const applyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!from || !to) {
      setError("시작·끝 시각을 모두 입력하세요.");
      return;
    }
    if (Date.parse(from) >= Date.parse(to)) {
      setError("시작 시각이 끝 시각보다 앞서야 합니다.");
      return;
    }
    setError(null);
    setCustom(from, to);
    onSubmit();
  };

  const custom = sel.mode === "custom";

  return (
    <>
      <div className="preset-group" role="tablist" aria-label="틱 조회 창">
        {TICK_WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            className={"preset-btn" + (!custom && sel.win === w ? " active" : "")}
            onClick={() => pickWin(w)}
          >
            {tickWindowLabel(w)}
          </button>
        ))}
        <button
          type="button"
          className={"preset-btn" + (custom ? " active" : "")}
          onClick={enterCustom}
          title="과거 구간을 직접 지정해 조회"
        >
          직접 설정
        </button>
      </div>

      {open && (
        <form className="custom-range" onSubmit={applyCustom}>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="from"
          />
          <span className="range-arrow">→</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="to"
          />
          <button type="submit" className="btn primary" disabled={loading}>
            조회
          </button>
          <span className="tick-range-hint">최대 24시간</span>
        </form>
      )}
      {error && <span className="tick-range-err">{error}</span>}
    </>
  );
}

export function TickActions({
  loading, onSubmit,
}: {
  loading: boolean;
  onSubmit: () => void;
}) {
  const { sel, setAuto } = useTick();
  const custom = sel.mode === "custom";

  return (
    <>
      <label className={"tick-auto" + (custom ? " off" : "")}>
        <input
          type="checkbox"
          checked={sel.auto && !custom}
          disabled={custom}
          onChange={(e) => setAuto(e.target.checked)}
        />
        자동 갱신
      </label>
      <button type="button" className="btn primary" onClick={onSubmit} disabled={loading}>
        {loading ? "조회 중…" : "새로고침"}
      </button>
    </>
  );
}
