// 임시공휴일 오버레이 (data/holidays.json). 내장 표(holidays.ts) 위에 얹는다.
// 폐쇄망이라 공휴일 API 를 부를 수 없어, 연중 지정되는 임시공휴일은 운영자가 여기에 넣는다.

import fs from "fs";
import path from "path";
import { HolidayOverlay } from "./holidays";
import { EMPTY_HOLIDAYS, HolidayDay, HolidayDoc } from "./types";
import { logger } from "./logger";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "holidays.json");

const MAX_NAME = 30;
const MAX_DAYS = 200;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function realDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function normalizeHolidays(raw: unknown): HolidayDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.days) ? r.days : [];

  const seen = new Set<string>();
  const days: HolidayDay[] = [];
  for (const item of list) {
    if (days.length >= MAX_DAYS) break;
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const date = typeof d.date === "string" ? d.date.trim() : "";
    const name = typeof d.name === "string" ? d.name.trim().slice(0, MAX_NAME) : "";
    if (!realDate(date) || !name || seen.has(date)) continue;
    seen.add(date);
    days.push({ date, name });
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  const updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : EMPTY_HOLIDAYS.updatedAt;
  return { days, updatedAt };
}

export function overlayOf(doc: HolidayDoc): HolidayOverlay {
  const out: HolidayOverlay = {};
  for (const d of doc.days) out[d.date] = d.name;
  return out;
}

export function readHolidays(): HolidayDoc {
  try {
    if (!fs.existsSync(FILE)) return { ...EMPTY_HOLIDAYS };
    return normalizeHolidays(JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch (e) {
    logger.error("holidays read failed", { file: FILE, err: String(e) });
    return { ...EMPTY_HOLIDAYS };
  }
}

export function writeHolidays(raw: unknown): HolidayDoc {
  const doc: HolidayDoc = { ...normalizeHolidays(raw), updatedAt: new Date().toISOString() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 2), "utf8");
  logger.info("holidays saved", { file: FILE, count: doc.days.length });
  return doc;
}
