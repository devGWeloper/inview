// 대한민국 공휴일 표. 순수 데이터 — 서버·클라이언트 공용이라 Node 전용 모듈을 쓰지 않는다.
// 갱신 방법은 docs/screens/roadmap.md '공휴일' 절에.

const H2025: Record<string, string> = {
  "01-01": "신정",
  "01-27": "임시공휴일",
  "01-28": "설날 연휴",
  "01-29": "설날",
  "01-30": "설날 연휴",
  "03-01": "삼일절",
  "03-03": "대체공휴일",
  "05-05": "어린이날·부처님오신날",
  "05-06": "대체공휴일",
  "06-03": "대통령선거일",
  "06-06": "현충일",
  "08-15": "광복절",
  "10-03": "개천절",
  "10-05": "추석 연휴",
  "10-06": "추석",
  "10-07": "추석 연휴",
  "10-08": "대체공휴일",
  "10-09": "한글날",
  "12-25": "성탄절",
};

const H2026: Record<string, string> = {
  "01-01": "신정",
  "02-16": "설날 연휴",
  "02-17": "설날",
  "02-18": "설날 연휴",
  "03-01": "삼일절",
  "03-02": "대체공휴일",
  "05-01": "노동절",
  "05-05": "어린이날",
  "05-24": "부처님오신날",
  "05-25": "대체공휴일",
  "06-03": "지방선거일",
  "06-06": "현충일",
  "07-17": "제헌절",
  "08-15": "광복절",
  "08-17": "대체공휴일",
  "09-24": "추석 연휴",
  "09-25": "추석",
  "09-26": "추석 연휴",
  "10-03": "개천절",
  "10-05": "대체공휴일",
  "10-09": "한글날",
  "12-25": "성탄절",
};

const H2027: Record<string, string> = {
  "01-01": "신정",
  "02-06": "설날 연휴",
  "02-07": "설날",
  "02-08": "설날 연휴",
  "02-09": "대체공휴일",
  "03-01": "삼일절",
  "05-01": "노동절",
  "05-03": "대체공휴일",
  "05-05": "어린이날",
  "05-13": "부처님오신날",
  "06-06": "현충일",
  "07-17": "제헌절",
  "07-19": "대체공휴일",
  "08-15": "광복절",
  "08-16": "대체공휴일",
  "09-14": "추석 연휴",
  "09-15": "추석",
  "09-16": "추석 연휴",
  "10-03": "개천절",
  "10-04": "대체공휴일",
  "10-09": "한글날",
  "10-11": "대체공휴일",
  "12-25": "성탄절",
  "12-27": "대체공휴일",
};

const TABLE: Record<number, Record<string, string>> = {
  2025: H2025,
  2026: H2026,
  2027: H2027,
};

export const HOLIDAY_YEARS: number[] = Object.keys(TABLE)
  .map(Number)
  .sort((a, b) => a - b);

export function hasHolidayTable(year: number): boolean {
  return year in TABLE;
}

/** 운영자가 넣은 임시공휴일. `YYYY-MM-DD` → 이름. 내장 표보다 우선한다. */
export type HolidayOverlay = Record<string, string>;

/** dayKey 는 `YYYY-MM-DD`(`dayKeyOf()` 의 출력). */
export function holidayOf(dayKey: string, extra?: HolidayOverlay): string | null {
  const own = extra?.[dayKey];
  if (own) return own;
  const year = Number(dayKey.slice(0, 4));
  return TABLE[year]?.[dayKey.slice(5)] ?? null;
}

/** 그 해 내장 공휴일 목록 — 팝업이 "이미 등록된 날" 을 보여 주는 데 쓴다. */
export function builtinHolidays(year: number): { date: string; name: string }[] {
  const t = TABLE[year];
  if (!t) return [];
  return Object.entries(t).map(([md, name]) => ({ date: `${year}-${md}`, name }));
}
