"use client";

import { useEffect, useState } from "react";
import {
  TICK_WINDOWS,
  TickWindowMin,
  tickWindowLabel,
  toLocalMin,
  useTick,
} from "@/components/tick/TickProvider";

// 실시간 뷰의 조회 툴바 — 창 길이 프리셋 + 직접 설정 + 자동 갱신 + 새로고침.
//
// ⚠️ 이 툴바는 기간 프리셋 줄과 **같은 자리**에 들어간다(뷰에 따라 통째로 교체).
//    두 줄을 같이 띄우면 "기간을 골랐는데 왜 안 바뀌지" 가 다시 생긴다.
// ⚠️ 자동 갱신은 live 에서만 — 고정된 과거 구간을 주기적으로 다시 부를 이유가 없을
//    뿐 아니라, 라이브 갱신은 매번 '지금' 으로 창을 다시 잡아 사용자가 지정한 구간을
//    덮어쓴다.

export function TickToolbar({
  loading, onSubmit,
}: {
  loading: boolean;
  /** 조회 실행 — 호출부가 현재 공유 상태를 풀어서 부른다 */
  onSubmit: () => void;
}) {
  const { sel, setWin, setCustom, setAuto } = useTick();
  // 직접 설정 입력은 로컬 초안이고 '조회' 를 눌렀을 때만 공유 상태에 커밋된다.
  const [open, setOpen] = useState(sel.mode === "custom");
  const [from, setFrom] = useState(sel.from);
  const [to, setTo] = useState(sel.to);
  const [error, setError] = useState<string | null>(null);

  // 공유 상태가 바뀌면(다른 화면에서 고쳤거나 복원됐거나) 초안을 맞춰 둔다.
  useEffect(() => {
    if (sel.mode === "custom") {
      setOpen(true);
      if (sel.from) setFrom(sel.from);
      if (sel.to) setTo(sel.to);
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
    // TickProvider.persist 가 ref 를 동기 갱신하므로 곧바로 조회해도 새 창이 반영된다.
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
      <div className="preset-group" role="tablist" aria-label="실시간 조회 창">
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

      <label className={"tick-auto" + (custom ? " off" : "")}>
        <input
          type="checkbox"
          checked={sel.auto && !custom}
          disabled={custom}
          onChange={(e) => setAuto(e.target.checked)}
        />
        자동 갱신
      </label>
      <button type="button" className="btn ghost" onClick={onSubmit} disabled={loading}>
        {loading ? "조회 중…" : "새로고침"}
      </button>

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
