"use client";

import { useMemo } from "react";
import {
  CalendarDay,
  ResolvedMilestone,
  STATE_CLASS,
  STATE_LABEL,
  WEEKDAY_KO,
  assignLanes,
  buildMonthGrid,
  dayKeyOf,
  isSpanEnd,
  isSpanStart,
  miniDateLabel,
  monthLabel,
  spanDayKeys,
  spanTouchesMonth,
  spanTouchesYear,
} from "@/lib/roadmapTime";
import { HOLIDAY_YEARS, HolidayOverlay, hasHolidayTable } from "@/lib/holidays";


export type CalMode = "month" | "year";

function weekendClass(weekday: number): string {
  return weekday === 0 ? " sun" : weekday === 6 ? " sat" : "";
}

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
  extra,
  onMove,
  onToday,
  onMode,
  onOpenMonth,
  onPick,
  onHolidays,
}: {
  items: ResolvedMilestone[];
  mode: CalMode;
  year: number;
  monthIdx: number;
  now: number;
  selectedId: string | null;
  extra: HolidayOverlay;
  onMove: (delta: number) => void;
  onToday: () => void;
  onMode: (m: CalMode) => void;
  onOpenMonth: (monthIdx: number) => void;
  onPick: (id: string) => void;
  onHolidays: (() => void) | null;
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

        {!hasHolidayTable(year) && (
          <span
            className="rm-cal-nohol"
            title={`공휴일 표는 ${HOLIDAY_YEARS[0]}~${HOLIDAY_YEARS[HOLIDAY_YEARS.length - 1]}년만 등록돼 있습니다.`}
          >
            {year}년 공휴일 미등록
          </span>
        )}

        {onHolidays && (
          <button type="button" className="rm-cal-hol-btn" onClick={onHolidays}>
            임시공휴일
          </button>
        )}

        <button type="button" className="rm-cal-today" onClick={onToday}>
          오늘
        </button>
      </header>

      {isYear ? (
        <YearGrid items={items} year={year} now={now} selectedId={selectedId} extra={extra} onOpenMonth={onOpenMonth} onPick={onPick} />
      ) : (
        <MonthGrid items={items} year={year} monthIdx={monthIdx} now={now} selectedId={selectedId} extra={extra} onPick={onPick} />
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
  extra,
  onOpenMonth,
  onPick,
}: {
  items: ResolvedMilestone[];
  year: number;
  now: number;
  selectedId: string | null;
  extra: HolidayOverlay;
  onOpenMonth: (monthIdx: number) => void;
  onPick: (id: string) => void;
}) {
  const total = useMemo(
    () => items.filter((i) => i.span && spanTouchesYear(i.span, year)).length,
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
            extra={extra}
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
  extra,
  onOpenMonth,
  onPick,
}: {
  items: ResolvedMilestone[];
  year: number;
  monthIdx: number;
  now: number;
  selectedId: string | null;
  extra: HolidayOverlay;
  onOpenMonth: (monthIdx: number) => void;
  onPick: (id: string) => void;
}) {
  const weeks = useMemo(() => buildMonthGrid(year, monthIdx, now, 6, extra), [year, monthIdx, now, extra]);
  const mine = useMemo(
    () => items.filter((i) => i.span && spanTouchesMonth(i.span, year, monthIdx)),
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
          {WEEKDAY_KO.map((w, i) => (
            <span key={w} className={"rm-mini-wd" + weekendClass(i)} role="columnheader">
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
    weekendClass(d.weekday) +
    (d.holiday ? " hol" : "");

  if (items.length === 0) {
    return (
      <span className={cls} role="gridcell" title={d.holiday ?? undefined}>
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
      title={[...(d.holiday ? [d.holiday] : []), ...items.map((i) => `${i.milestone.name} · ${STATE_LABEL[i.state]}`)].join("\n")}
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
  extra,
  onPick,
}: {
  items: ResolvedMilestone[];
  year: number;
  monthIdx: number;
  now: number;
  selectedId: string | null;
  extra: HolidayOverlay;
  onPick: (id: string) => void;
}) {
  const weeks = useMemo(() => buildMonthGrid(year, monthIdx, now, 0, extra), [year, monthIdx, now, extra]);
  const byDay = useMemo(() => groupByDay(items), [items]);
  const lanes = useMemo(() => assignLanes(items), [items]);
  const monthOnly = useMemo(
    () => items.filter((it) => it.span?.precision === "month" && it.span.year === year && it.span.monthIdx === monthIdx),
    [items, year, monthIdx]
  );
  const inMonth = useMemo(
    () => items.filter((it) => it.span && spanTouchesMonth(it.span, year, monthIdx)).length,
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
          {WEEKDAY_KO.map((w, i) => (
            <span key={w} className={"rm-cal-wd" + weekendClass(i)} role="columnheader">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div className="rm-cal-week" role="row" key={wi}>
            {week.map((d) => (
              <Cell
                key={d.ms}
                d={d}
                items={byDay.get(dayKeyOf(d.ms)) ?? []}
                lanes={lanes}
                selectedId={selectedId}
                onPick={onPick}
              />
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
  lanes,
  selectedId,
  onPick,
}: {
  d: CalendarDay;
  items: ResolvedMilestone[];
  lanes: Map<string, number>;
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const cls =
    "rm-cal-day" +
    (d.inMonth ? "" : " out") +
    (d.isToday ? " today" : "") +
    weekendClass(d.weekday) +
    (d.holiday ? " hol" : "");
  return (
    <div className={cls} role="gridcell">
      <span className="rm-cal-hd">
        <span className="rm-cal-n">{d.day}</span>
        {d.holiday && <span className="rm-cal-hol">{d.holiday}</span>}
      </span>
      {items.length > 0 && (
        <div className="rm-cal-items">
          {slotsOf(items, lanes).map((it, lane) =>
            it === null ? (
              <span key={"gap" + lane} className="rm-cal-lane" aria-hidden />
            ) : (
              (() => {
                const first = isSpanStart(it.span!, d.ms);
                return (
                  <Chip
                    key={it.milestone.id}
                    it={it}
                    selected={selectedId === it.milestone.id}
                    onPick={onPick}
                    big
                    bar={{ first, last: isSpanEnd(it.span!, d.ms) }}
                    hideName={!first && d.weekday !== 0}
                  />
                );
              })()
            )
          )}
          {items
            .filter((it) => it.span?.precision !== "range")
            .map((it) => (
              <Chip key={it.milestone.id} it={it} selected={selectedId === it.milestone.id} onPick={onPick} big />
            ))}
        </div>
      )}
    </div>
  );
}


/** 이 칸의 기간 막대를 줄 번호 자리에 앉히고, 빈 줄은 자리만 채운다. */
function slotsOf(items: ResolvedMilestone[], lanes: Map<string, number>): (ResolvedMilestone | null)[] {
  const ranges = items.filter((it) => it.span?.precision === "range");
  if (ranges.length === 0) return [];
  const top = Math.max(...ranges.map((it) => lanes.get(it.milestone.id) ?? 0));
  const slots: (ResolvedMilestone | null)[] = Array.from({ length: top + 1 }, () => null);
  for (const it of ranges) slots[lanes.get(it.milestone.id) ?? 0] = it;
  return slots;
}

function groupByDay(items: ResolvedMilestone[]): Map<string, ResolvedMilestone[]> {
  const map = new Map<string, ResolvedMilestone[]>();
  for (const it of items) {
    if (!it.span) continue;
    for (const k of spanDayKeys(it.span)) {
      const list = map.get(k);
      if (list) list.push(it);
      else map.set(k, [it]);
    }
  }
  return map;
}

function Chip({
  it,
  selected,
  onPick,
  showDate,
  big,
  bar,
  hideName,
}: {
  it: ResolvedMilestone;
  selected: boolean;
  onPick: (id: string) => void;
  showDate?: boolean;
  big?: boolean;
  bar?: { first: boolean; last: boolean };
  hideName?: boolean;
}) {
  const { milestone: m, span, state, lateDays } = it;
  return (
    <button
      type="button"
      className={
        "rm-chip is-" +
        STATE_CLASS[state] +
        (selected ? " sel" : "") +
        (big ? " big" : "") +
        (bar ? " span" + (bar.first ? " s" : "") + (bar.last ? " e" : "") : "")
      }
      onClick={() => onPick(m.id)}
      title={
        `${m.name} · ${STATE_LABEL[state]}` +
        (span ? ` · ${span.longLabel}` : "") +
        (state === "overdue" ? ` (${lateDays}일 초과)` : "") +
        (m.desc ? `\n${m.desc}` : "")
      }
    >
      {showDate ? (
        <span className="rm-chip-d">{span ? miniDateLabel(span) : "–"}</span>
      ) : bar ? null : (
        <span className="rm-chip-dot" aria-hidden />
      )}
      {!hideName && <span className="rm-chip-name">{m.name}</span>}
      {state === "overdue" && !hideName && <span className="rm-chip-late">지연</span>}
    </button>
  );
}
