"use client";

import { useEffect, useState } from "react";
import { holidayOf } from "@/lib/holidays";
import { HolidayDay } from "@/lib/types";
import { WEEKDAY_KO } from "@/lib/roadmapTime";

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function label(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}. ${String(m).padStart(2, "0")}. ${String(d).padStart(2, "0")} (${WEEKDAY_KO[new Date(y, m - 1, d).getDay()]})`;
}

export function HolidayDialog({
  days,
  defaultDay,
  saving,
  error,
  onSave,
  onClose,
}: {
  days: HolidayDay[];
  defaultDay: string;
  saving: boolean;
  error: string;
  onSave: (days: HolidayDay[]) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<HolidayDay[]>(days);
  const [date, setDate] = useState(defaultDay);
  const [name, setName] = useState("임시공휴일");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const already = DATE_RE.test(date) ? holidayOf(date) : null;
  const dupe = list.some((d) => d.date === date);
  const canAdd = DATE_RE.test(date) && name.trim() !== "" && !dupe && !already;

  function add() {
    if (!canAdd) return;
    setList([...list, { date, name: name.trim() }].sort((a, b) => a.date.localeCompare(b.date)));
    setName("임시공휴일");
  }

  return (
    <div className="rm-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="rm-modal" role="dialog" aria-modal="true" aria-label="임시공휴일">
        <div className="rm-modal-head">
          <h2 className="rm-modal-title">임시공휴일</h2>
          <button type="button" className="rm-modal-x" onClick={onClose} disabled={saving} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="rm-modal-body">
          <div className="rm-f">
            <span className="rm-f-l">추가</span>
            <div className="rm-hol-add">
              <input
                className="rm-f-in rm-f-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="날짜"
              />
              <input
                className="rm-f-in"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름"
                maxLength={30}
                aria-label="이름"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              />
              <button type="button" className="btn" onClick={add} disabled={!canAdd}>
                추가
              </button>
            </div>
            {already && <p className="rm-f-note warn">이미 {already} 입니다.</p>}
            {!already && dupe && <p className="rm-f-note warn">이미 목록에 있습니다.</p>}
          </div>

          <div className="rm-f">
            <span className="rm-f-l">등록된 날 {list.length > 0 && <span className="rm-f-opt">{list.length}</span>}</span>
            {list.length === 0 ? (
              <p className="rm-f-note">아직 없습니다. 내장 공휴일 표만 쓰입니다.</p>
            ) : (
              <ul className="rm-hol-list">
                {list.map((d) => (
                  <li key={d.date} className="rm-hol-row">
                    <span className="rm-hol-d">{label(d.date)}</span>
                    <span className="rm-hol-n">{d.name}</span>
                    <button
                      type="button"
                      className="rm-hol-x"
                      onClick={() => setList(list.filter((x) => x.date !== d.date))}
                      aria-label={`${d.date} 삭제`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="rm-modal-err">{error}</p>}
        </div>

        <div className="rm-modal-foot">
          <span className="rm-modal-gap" />
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn primary" onClick={() => onSave(list)} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
