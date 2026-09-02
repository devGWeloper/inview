"use client";

import { useMemo } from "react";
import {
  CalendarDay,
  ResolvedMilestone,
  STATE_CLASS,
  STATE_LABEL,
  WEEK_HEADER_KO,
  buildMonthGrid,
  dayKeyOf,
  monthLabel,
} from "@/lib/roadmapTime";


export type CalMode = "month" | "year";

const STATE_RANK = ["overdue", "in_progress", "planned", "released", "hold"] as const;
function dominant(items: ResolvedMilestone[]): ResolvedMilestone {
  return [...items].sort((a, b) => STATE_RANK.indexOf(a.state) - STATE_RANK.indexOf(b.state))[0];
}

export function RoadmapCalendar({
  items,
  mode,
  year,
  monthIdx,
  now,
  selectedId,
  onMove,
  onToday,
  onMode,
  onOpenMonth,
  onPick,
}: {
  items: ResolvedMilestone[];
  mode: CalMode;
  year: number;
  monthIdx: number;
  now: number;
  selectedId: string | null;
  onMove: (delta: number) => void;
  onToday: () => void;
  onMode: (m: CalMode) => void;
  onOpenMonth: (monthIdx: number) => void;
  onPick: (id: string) => void;
}) {
  const isYear = mode === "year";

  const undated = useMemo(() => items.filter((it) => !it.span), [items]);

  return (
    <section className="rm-cal" aria-label="오픈 달력">
      <header className="rm-cal-bar">
        <button type="button" className="rm-cal-nav" onClick={() => onMove(-1)} aria-label={isYear ? "이전 해" : "이전 달"}>
          ‹
        </button>
        <h2 className="rm-cal-month">{isYear ? `${year}년` : monthLabel(year, monthIdx)}</h2>
        <button type="button" className="rm-cal-nav" onClick={() => onMove(1)} aria-label={isYear ? "다음 해" : "다음 달"}>
          ›
        </button>

        <div className="rm-cal-modes" role="group" aria-label="보기 단위">
          <button type="button" className={"rm-cal-mode" + (isYear ? " on" : "")} aria-pressed={isYear} onClick={() => onMode("year")}>
            년
          </button>
          <button type="button" className={"rm-cal-mode" + (!isYear ? " on" : "")} aria-pressed={!isYear} onClick={() => onMode("month")}>
            월
          </button>
        </div>

        <button type="button" className="rm-cal-today" onClick={onToday}>
          오늘
        </button>
      </header>

      {isYear ? (
        <YearGrid items={items} year={year} now={now} selectedId={selectedId} onOpenMonth={onOpenMonth} onPick={onPick} />
      ) : (
        <MonthGrid items={items} year={year} monthIdx={monthIdx} now={now} selectedId={selectedId} onPick={onPick} />
      )}

      {undated.length > 0 && (
        <div className="rm-cal-loose bottom">
          <span className="rm-cal-loose-l">일정 미정</span>
          <div className="rm-cal-loose-items">
            {undated.map((it) => (
              <Chip key={it.milestone.id} it={it} selected={selectedId === it.milestone.id} onPick={onPick} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}


function YearGrid({
  items,
  year,
  now,
  selectedId,
  onOpenMonth,
  onPick,
}: {
  items: ResolvedMilestone[];
  year: number;
  now: number;
  selectedId: string | null;
  onOpenMonth: (monthIdx: number) => void;
  onPick: (id: string) => void;
}) {
  const total = useMemo(
    () => items.filter((i) => i.span && i.span.year === year).length,
    [items, year]
  );

  return (
    <>
      <div className="rm-year">
        {Array.from({ length: 12 }, (_, m) => (
          <MiniMonth
            key={m}
            items={items}
            year={year}
            monthIdx={m}
            now={now}
            selectedId={selectedId}
            onOpenMonth={onOpenMonth}
            onPick={onPick}
          />
        ))}
      </div>
      {total === 0 && <p className="rm-cal-none">{year}년에 예정된 오픈이 없습니다.</p>}
    </>
  );
}

function MiniMonth({
  items,
  year,
  monthIdx,
  now,
  selectedId,
  onOpenMonth,
  onPick,
}: {
  items: ResolvedMilestone[];
  year: number;
  monthIdx: number;
  now: number;
  selectedId: string | null;
  onOpenMonth: (monthIdx: number) => void;
  onPick: (id: string) => void;
}) {
  const weeks = useMemo(() => buildMonthGrid(year, monthIdx, now, 6), [year, monthIdx, now]);
  const mine = useMemo(
    () => items.filter((i) => i.span && i.span.year === year && i.span.monthIdx === monthIdx),
    [items, year, monthIdx]
  );
  const byDay = useMemo(() => groupByDay(mine), [mine]);
  const isCurrent = useMemo(() => {
    const d = new Date(now);
    return d.getFullYear() === year && d.getMonth() === monthIdx;
  }, [now, year, monthIdx]);

  return (
    <div className={"rm-mini" + (isCurrent ? " now" : "") + (mine.length === 0 ? " blank" : "")}>
      <button type="button" className="rm-mini-h" onClick={() => onOpenMonth(monthIdx)} title={`${monthIdx + 1}월 크게 보기`}>
        <span className="rm-mini-l">{monthIdx + 1}월</span>
        {isCurrent && <span className="rm-mini-now">이번 달</span>}
      </button>

      <div className="rm-mini-grid" role="grid" aria-label={monthLabel(year, monthIdx)}>
        <div className="rm-mini-wk" role="row">
          {WEEK_HEADER_KO.map((w, i) => (
            <span key={w} className={"rm-mini-wd" + (i >= 5 ? " off" : "")} role="columnheader">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div className="rm-mini-row" role="row" key={wi}>
            {week.map((d) => (
              <MiniDay key={d.ms} d={d} items={byDay.get(dayKeyOf(d.ms)) ?? []} selectedId={selectedId} onPick={onPick} />
            ))}
          </div>
        ))}
      </div>

      {mine.length > 0 && (
        <div className="rm-mini-list">
          {mine.map((it) => (
            <Chip key={it.milestone.id} it={it} selected={selectedId === it.milestone.id} onPick={onPick} showDate />
          ))}
        </div>
      )}
    </div>
  );
}

function MiniDay({
  d,
  items,
  selectedId,
  onPick,
}: {
  d: CalendarDay;
  items: ResolvedMilestone[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  if (!d.inMonth) return <span className="rm-mini-d out" role="gridcell" aria-hidden />;

  const cls =
    "rm-mini-d" +
    (d.isToday ? " today" : "") +
    (d.weekday === 0 ? " sun" : d.weekday === 6 ? " sat" : "");

  if (items.length === 0) {
    return (
      <span className={cls} role="gridcell">
        {d.day}
      </span>
    );
  }

  const top = dominant(items);
  const sel = items.some((i) => i.milestone.id === selectedId);
  return (
    <button
      type="button"
      className={cls + " has is-" + STATE_CLASS[top.state] + (sel ? " sel" : "")}
      role="gridcell"
      onClick={() => onPick(top.milestone.id)}
      title={items.map((i) => `${i.milestone.name} · ${STATE_LABEL[i.state]}`).join("\n")}
    >
      {d.day}
      {items.length > 1 && <span className="rm-mini-more">{items.length}</span>}
    </button>
  );
}


function MonthGrid({
  items,
  year,
  monthIdx,
  now,
  selectedId,
  onPick,
}: {
  items: ResolvedMilestone[];
  year: number;
  monthIdx: number;
  now: number;
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const weeks = useMemo(() => buildMonthGrid(year, monthIdx, now), [year, monthIdx, now]);
  const byDay = useMemo(
    () => groupByDay(items.filter((i) => i.span?.precision === "day")),
    [items]
  );
  const monthOnly = useMemo(
    () => items.filter((it) => it.span?.precision === "month" && it.span.year === year && it.span.monthIdx === monthIdx),
    [items, year, monthIdx]
  );
  const inMonth = useMemo(
    () => items.filter((it) => it.span && it.span.year === year && it.span.monthIdx === monthIdx).length,
    [items, year, monthIdx]
  );

  return (
    <>
      {monthOnly.length > 0 && (
        <div className="rm-cal-loose">
          <span className="rm-cal-loose-l">날짜 미정</span>
          <div className="rm-cal-loose-items">
            {monthOnly.map((it) => (
              <Chip key={it.milestone.id} it={it} selected={selectedId === it.milestone.id} onPick={onPick} />
            ))}
          </div>
        </div>
      )}

      <div className="rm-cal-grid" role="grid">
        <div className="rm-cal-head" role="row">
          {WEEK_HEADER_KO.map((w, i) => (
            <span key={w} className={"rm-cal-wd" + (i >= 5 ? " off" : "")} role="columnheader">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div className="rm-cal-week" role="row" key={wi}>
            {week.map((d) => (
              <Cell key={d.ms} d={d} items={byDay.get(dayKeyOf(d.ms)) ?? []} selectedId={selectedId} onPick={onPick} />
            ))}
          </div>
        ))}
      </div>

      {inMonth === 0 && <p className="rm-cal-none">{monthLabel(year, monthIdx)}에 예정된 오픈이 없습니다.</p>}
    </>
  );
}

function Cell({
  d,
  items,
  selectedId,
  onPick,
}: {
  d: CalendarDay;
  items: ResolvedMilestone[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const cls =
    "rm-cal-day" +
    (d.inMonth ? "" : " out") +
    (d.isToday ? " today" : "") +
    (d.weekday === 0 ? " sun" : d.weekday === 6 ? " sat" : "");
  return (
    <div className={cls} role="gridcell">
      <span className="rm-cal-n">{d.day}</span>
      {items.length > 0 && (
        <div className="rm-cal-items">
          {items.map((it) => (
            <Chip key={it.milestone.id} it={it} selected={selectedId === it.milestone.id} onPick={onPick} big />
          ))}
        </div>
      )}
    </div>
  );
}


function groupByDay(items: ResolvedMilestone[]): Map<string, ResolvedMilestone[]> {
  const map = new Map<string, ResolvedMilestone[]>();
  for (const it of items) {
    if (!it.span || it.span.precision !== "day") continue;
    const k = dayKeyOf(it.span.start);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return map;
}

function Chip({
  it,
  selected,
  onPick,
  showDate,
  big,
}: {
  it: ResolvedMilestone;
  selected: boolean;
  onPick: (id: string) => void;
  showDate?: boolean;
  big?: boolean;
}) {
  const { milestone: m, span, state, lateDays } = it;
  return (
    <button
      type="button"
      className={"rm-chip is-" + STATE_CLASS[state] + (selected ? " sel" : "") + (big ? " big" : "")}
      onClick={() => onPick(m.id)}
      title={
        `${m.name} · ${STATE_LABEL[state]}` +
        (span ? ` · ${span.longLabel}` : "") +
        (state === "overdue" ? ` (${lateDays}일 초과)` : "") +
        (m.desc ? `\n${m.desc}` : "")
      }
    >
      {showDate ? (
        <span className="rm-chip-d">{span?.precision === "day" ? span.label.slice(3) : "–"}</span>
      ) : (
        <span className="rm-chip-dot" aria-hidden />
      )}
      <span className="rm-chip-name">{m.name}</span>
      {state === "overdue" && <span className="rm-chip-late">지연</span>}
    </button>
  );
}
