
// 로드맵 저장 (data/roadmap.json). 앱 전체에 1벌 — 에이전트별로 나누지 않는다.

import fs from "fs";
import path from "path";
import { DEFAULT_ROADMAP, Milestone, MilestoneStatus, MILESTONE_STATUSES, Roadmap } from "./types";
import { logger } from "./logger";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "roadmap.json");

const MAX_NAME = 80;
const MAX_WHEN = 20;
const MAX_DESC = 200;
const MAX_ITEMS = 300;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function status(v: unknown): MilestoneStatus {
  return MILESTONE_STATUSES.includes(v as MilestoneStatus) ? (v as MilestoneStatus) : "planned";
}

export function normalizeRoadmap(raw: unknown): Roadmap {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.milestones) ? r.milestones : [];

  const seen = new Set<string>();
  const milestones: Milestone[] = [];
  for (const item of list) {
    if (milestones.length >= MAX_ITEMS) break;
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const name = str(m.name, MAX_NAME);
    if (!name) continue;

    let id = str(m.id, 40).replace(/[^A-Za-z0-9_-]/g, "");
    if (!id || seen.has(id)) id = newId(seen);
    seen.add(id);

    milestones.push({
      id,
      name,
      status: status(m.status),
      when: str(m.when, MAX_WHEN),
      desc: str(m.desc, MAX_DESC),
    });
  }

  const updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : DEFAULT_ROADMAP.updatedAt;
  return { milestones, updatedAt };
}

function newId(taken: Set<string>): string {
  let id = "";
  do {
    id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.has(id));
  return id;
}

export function readRoadmap(): Roadmap {
  try {
    if (!fs.existsSync(FILE)) return { ...DEFAULT_ROADMAP };
    return normalizeRoadmap(JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch (e) {
    logger.error("roadmap read failed", { file: FILE, err: String(e) });
    return { ...DEFAULT_ROADMAP };
  }
}

export function writeRoadmap(raw: unknown): Roadmap {
  const normalized: Roadmap = { ...normalizeRoadmap(raw), updatedAt: new Date().toISOString() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(normalized, null, 2), "utf8");
  logger.info("roadmap saved", { file: FILE, count: normalized.milestones.length });
  return normalized;
}
