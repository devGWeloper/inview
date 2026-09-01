// ─────────────────────────────────────────────────────────────────────────────
// Action 오픈 로드맵의 영속 저장 계층 — data/roadmap.json (앱 전체에 1벌).
//
// DB 를 쓰지 않는다: 이 표는 트랜잭션 데이터가 아니라 운영자가 손으로 적는 계획표이고,
// 항목이 수십 건 규모라 프로필과 같은 JSON 파일 저장이면 충분하다(src/lib/profile.ts).
//
// ⚠️ 에이전트별로 나누지 않는다 — 로드맵은 Action Agent 의 기능 오픈 일정 하나뿐이고,
//    쓰기 권한도 **전역 ADMIN** 하나다. 에이전트별로 나눠야 할 날이 오면 profile.ts 의
//    파일명 규칙(<name>.<agentId>.json)을 그대로 따르면 된다.
//
// ※ server-only. fs 를 쓰므로 클라이언트 컴포넌트에서 import 하지 말 것.
//   (타입은 @/lib/types, 시점 해석은 @/lib/roadmapTime — 둘 다 클라이언트에서도 안전)
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { DEFAULT_ROADMAP, Milestone, MilestoneStatus, MILESTONE_STATUSES, Roadmap } from "./types";
import { logger } from "./logger";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "roadmap.json");

/** 한 항목의 글자 상한. 화면이 한 줄로 그리는 자리라 폭주를 저장 단계에서 막는다. */
const MAX_NAME = 80;
const MAX_WHEN = 20;
const MAX_DESC = 200;
/** 항목 수 상한 — 실수로 거대한 배열이 들어와 파일/화면이 망가지는 걸 막는다. */
const MAX_ITEMS = 300;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function status(v: unknown): MilestoneStatus {
  return MILESTONE_STATUSES.includes(v as MilestoneStatus) ? (v as MilestoneStatus) : "planned";
}

/**
 * 부분/깨진 입력을 항상 완전한 Roadmap 으로 보정한다 (normalizeProfile 과 같은 규칙).
 *
 * - id 가 없거나 중복이면 새로 만든다. 화면의 React key 이자 편집 중 행 식별자라
 *   중복되면 엉뚱한 행이 수정된다.
 * - 이름이 빈 항목은 버린다 — 축에 이름 없는 마커만 남아 읽을 수 없다.
 * - `when` 은 형식 검증을 하지 않고 문자열 그대로 둔다. 해석은 화면(roadmapTime)이
 *   하고, 해석 못 하는 값은 "일정 미정" 으로 표시된다. 운영자가 적다 만 값을
 *   저장 단계에서 지워 버리면 입력하던 내용을 잃는다.
 */
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

/** 충돌하지 않는 새 id. 시간 기반이라 정렬해도 입력 순서가 대략 보존된다. */
function newId(taken: Set<string>): string {
  let id = "";
  do {
    id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.has(id));
  return id;
}

/** 파일이 없거나 깨졌으면 빈 로드맵. 화면은 그걸 "아직 등록된 일정이 없습니다" 로 그린다. */
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
