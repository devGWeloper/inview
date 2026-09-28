// Link Board 저장 (data/links.json). 앱 전체에 1벌 — 에이전트별로 나누지 않는다.

import fs from "fs";
import path from "path";
import { EMPTY_LINK_BOARD, LinkBoard, LinkItem } from "./types";
import { logger } from "./logger";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "links.json");

const MAX_TITLE = 80;
const MAX_URL = 500;
const MAX_CATEGORY = 40;
const MAX_TAG = 24;
const MAX_DESC = 200;
const MAX_TAGS = 8;
const MAX_ITEMS = 500;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** http/https 만 통과시킨다 — javascript: 같은 스킴이 앵커에 그대로 실리면 안 된다. */
function safeUrl(v: unknown): string {
  const raw = str(v, MAX_URL);
  if (!raw) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

function tags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const t of list) {
    const tag = str(t, MAX_TAG);
    if (tag && !out.includes(tag) && out.length < MAX_TAGS) out.push(tag);
  }
  return out;
}

export function normalizeLinkBoard(raw: unknown): LinkBoard {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.links) ? r.links : [];

  const seen = new Set<string>();
  const links: LinkItem[] = [];
  for (const item of list) {
    if (links.length >= MAX_ITEMS) break;
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;

    const url = safeUrl(m.url);
    if (!url) continue;
    const title = str(m.title, MAX_TITLE) || url;

    let id = str(m.id, 40).replace(/[^A-Za-z0-9_-]/g, "");
    if (!id || seen.has(id)) id = newId(seen);
    seen.add(id);

    links.push({
      id,
      title,
      url,
      category: str(m.category, MAX_CATEGORY),
      tags: tags(m.tags),
      desc: str(m.desc, MAX_DESC),
    });
  }

  const updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : EMPTY_LINK_BOARD.updatedAt;
  return { links, updatedAt };
}

function newId(taken: Set<string>): string {
  let id = "";
  do {
    id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.has(id));
  return id;
}

export function readLinkBoard(): LinkBoard {
  try {
    if (!fs.existsSync(FILE)) return { ...EMPTY_LINK_BOARD };
    return normalizeLinkBoard(JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch (e) {
    logger.error("link board read failed", { file: FILE, err: String(e) });
    return { ...EMPTY_LINK_BOARD };
  }
}

export function writeLinkBoard(raw: unknown): LinkBoard {
  const normalized: LinkBoard = { ...normalizeLinkBoard(raw), updatedAt: new Date().toISOString() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(normalized, null, 2), "utf8");
  logger.info("link board saved", { file: FILE, count: normalized.links.length });
  return normalized;
}
