"use client";

import { useEffect, useRef, useState } from "react";

export type ErrFilterMode = "include" | "exclude" | null;

interface Props {
  /** 선택 가능한 전체 에러 코드 목록 (서버가 필터 전 상태로 내려준 allErrCds) */
  options: string[];
  /** 현재 모드. null = 전체 포함 */
  mode: ErrFilterMode;
  /** 현재 선택된 코드들 */
  selected: string[];
  /** 변경 시 호출 — 부모가 즉시 API 재조회를 트리거하는 패턴 */
  onChange: (mode: ErrFilterMode, codes: string[]) => void;
}

export function ErrCodeFilter({ options, mode, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const effectiveMode: ErrFilterMode = selected.length > 0 ? mode : null;
  const triggerLabel = summarize(effectiveMode, selected);

  const setMode = (next: ErrFilterMode) => {
    if (next === null) {
      onChange(null, []);
      return;
    }
    onChange(next, selected);
  };

  const toggleCode = (code: string) => {
    const has = selected.includes(code);
    const next = has ? selected.filter((c) => c !== code) : [...selected, code];
    // 코드 하나라도 선택되면 mode 가 null 이었을 경우 'include' 로 자동 진입
    const nextMode: ErrFilterMode =
      next.length === 0 ? null : mode ?? "include";
    onChange(nextMode, next);
  };

  const clearAll = () => onChange(null, []);

  const hasFilter = effectiveMode !== null;

  return (
    <div className="err-filter" ref={wrapRef}>
      <button
        type="button"
        className={"err-filter-trigger" + (hasFilter ? " active" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="err-filter-prefix">에러</span>
        <span className="err-filter-value">{triggerLabel}</span>
        <span className="err-filter-chev" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="err-filter-pop" role="dialog" aria-label="에러 코드 필터">
          <div className="err-filter-modes" role="radiogroup" aria-label="필터 모드">
            <label className={"err-filter-mode" + (effectiveMode === null ? " on" : "")}>
              <input
                type="radio"
                name="errMode"
                checked={effectiveMode === null}
                onChange={() => setMode(null)}
              />
              <span>모두 포함</span>
            </label>
            <label className={"err-filter-mode" + (mode === "include" && selected.length > 0 ? " on" : "")}>
              <input
                type="radio"
                name="errMode"
                checked={mode === "include" && selected.length > 0}
                onChange={() => setMode("include")}
                disabled={selected.length === 0}
              />
              <span>선택만 포함</span>
            </label>
            <label className={"err-filter-mode" + (mode === "exclude" && selected.length > 0 ? " on" : "")}>
              <input
                type="radio"
                name="errMode"
                checked={mode === "exclude" && selected.length > 0}
                onChange={() => setMode("exclude")}
                disabled={selected.length === 0}
              />
              <span>선택 제외</span>
            </label>
          </div>

          <div className="err-filter-hint">
            {effectiveMode === "include" && "체크한 에러만 실패로 카운트합니다."}
            {effectiveMode === "exclude" && "체크한 에러는 집계에서 빠집니다 (OK 로 취급)."}
            {effectiveMode === null && "에러 코드를 체크하면 자동으로 필터가 켜집니다."}
          </div>

          <div className="err-filter-list">
            {options.length === 0 ? (
              <div className="err-filter-empty">현재 기간에 에러 코드가 없습니다.</div>
            ) : (
              options.map((code) => {
                const checked = selected.includes(code);
                return (
                  <label key={code} className={"err-filter-item" + (checked ? " on" : "")}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCode(code)}
                    />
                    <span className="err-filter-code" title={code}>{code}</span>
                  </label>
                );
              })
            )}
          </div>

          <div className="err-filter-foot">
            <button type="button" className="btn ghost" onClick={clearAll} disabled={!hasFilter}>
              초기화
            </button>
            <button type="button" className="btn xs" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function summarize(mode: ErrFilterMode, codes: string[]): string {
  if (mode === null || codes.length === 0) return "모두";
  if (codes.length === 1) {
    return mode === "include" ? `${codes[0]} 만` : `${codes[0]} 제외`;
  }
  return mode === "include" ? `${codes.length}개만` : `${codes.length}개 제외`;
}
