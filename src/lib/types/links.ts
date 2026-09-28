// Link Board — 개발하며 자주 여는 사이트 모음. 앱 전체에 1벌 (에이전트별로 나누지 않는다).

export interface LinkItem {
  id: string;
  title: string;
  url: string;
  category: string;
  tags: string[];
  desc: string;
}

export interface LinkBoard {
  links: LinkItem[];
  updatedAt: string;
}

export const EMPTY_LINK_BOARD: LinkBoard = { links: [], updatedAt: "" };

export const UNCATEGORIZED = "미분류";

export interface LinkGroup {
  category: string;
  links: LinkItem[];
}

/** 카테고리 목록은 따로 저장하지 않는다 — links 의 첫 등장 순서가 곧 그룹 순서다. */
export function groupLinks(links: LinkItem[]): LinkGroup[] {
  const groups: LinkGroup[] = [];
  const index = new Map<string, LinkGroup>();
  for (const link of links) {
    const category = link.category || UNCATEGORIZED;
    let g = index.get(category);
    if (!g) {
      g = { category, links: [] };
      index.set(category, g);
      groups.push(g);
    }
    g.links.push(link);
  }
  return groups;
}

export function allTags(links: LinkItem[]): string[] {
  const seen = new Set<string>();
  for (const l of links) for (const t of l.tags) seen.add(t);
  return [...seen].sort((a, b) => a.localeCompare(b, "ko"));
}

export function allCategories(links: LinkItem[]): string[] {
  const seen = new Set<string>();
  for (const l of links) if (l.category) seen.add(l.category);
  return [...seen];
}

export function matchesQuery(link: LinkItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    link.title.toLowerCase().includes(q) ||
    link.url.toLowerCase().includes(q) ||
    link.desc.toLowerCase().includes(q) ||
    link.category.toLowerCase().includes(q) ||
    link.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
  }
}
