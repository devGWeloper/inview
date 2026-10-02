"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LinkItem, allTags, groupLinks, matchesQuery } from "@/lib/types";

// 사내 주소는 대부분 IP(10.x)라 호스트로 칩을 만들면 전부 "1" 이 된다 — 이름에서 만든다.
function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function initialsOf(title: string): string {
  const words = title.trim().split(/[\s_\-·/]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const latin = /^[A-Za-z0-9]/;
  if (words.length > 1 && latin.test(words[0]) && latin.test(words[1])) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return Array.from(words[0])[0].toUpperCase();
}

export function LinkPanel({
  links,
  pins,
  loading,
  error,
  canEdit,
  onTogglePin,
  onCreate,
  onEdit,
  onClose,
}: {
  links: LinkItem[];
  pins: string[];
  loading: boolean;
  error: string;
  canEdit: boolean;
  onTogglePin: (id: string) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [tagSel, setTagSel] = useState<string[]>([]);

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const tags = useMemo(() => allTags(links), [links]);
  const shown = useMemo(
    () => links.filter((l) => matchesQuery(l, query) && tagSel.every((t) => l.tags.includes(t))),
    [links, query, tagSel]
  );
  const pinned = useMemo(() => shown.filter((l) => pins.includes(l.id)), [shown, pins]);
  // 핀된 항목은 위 즐겨찾기 줄로 옮겨 간다 — 좁은 패널에서 같은 줄이 두 번 보이지 않게.
  const groups = useMemo(() => groupLinks(shown.filter((l) => !pins.includes(l.id))), [shown, pins]);

  function toggleTag(tag: string) {
    setTagSel((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function row(link: LinkItem) {
    const pinnedNow = pins.includes(link.id);
    return (
      <div key={link.id} className="lb-row">
        <a
          className="lb-row-go"
          href={link.url}
          target="_blank"
          rel="noreferrer noopener"
          title={link.desc ? `${link.desc}\n${link.url}` : link.url}
          onClick={onClose}
        >
          <span className="lb-mark" style={{ ["--lb-h" as string]: hueOf(link.title) }} aria-hidden>
            {initialsOf(link.title)}
          </span>
          <span className="lb-row-title">{link.title}</span>
          <svg className="lb-row-out" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 3.5h6.5V10M12.5 3.5 4 12" />
          </svg>
        </a>
        {canEdit && (
          <button type="button" className="lb-row-btn" onClick={() => onEdit(link.id)} title="수정" aria-label={`${link.title} 수정`}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                 strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10.5 2.8l2.7 2.7-7.4 7.4H3.1v-2.7z" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className={"lb-row-btn lb-pin" + (pinnedNow ? " on" : "")}
          onClick={() => onTogglePin(link.id)}
          aria-pressed={pinnedNow}
          title={pinnedNow ? "즐겨찾기에서 빼기 (나에게만 적용)" : "즐겨찾기에 담기 (나에게만 적용)"}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden
               fill={pinnedNow ? "currentColor" : "none"} stroke="currentColor"
               strokeWidth="1.4" strokeLinejoin="round">
            <path d="M8 2.4l1.75 3.55 3.9.57-2.82 2.75.66 3.9L8 11.5l-3.49 1.67.66-3.9L2.35 6.52l3.9-.57z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="lb-panel-head">
        <div className="lb-search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            <circle cx="7" cy="7" r="4.4" />
            <path d="M10.4 10.4 14 14" />
          </svg>
          <input
            ref={searchRef}
            className="lb-search-in"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="링크 검색"
            aria-label="링크 검색"
          />
          {query && (
            <button type="button" className="lb-search-x" onClick={() => setQuery("")} aria-label="검색어 지우기">✕</button>
          )}
        </div>
        {canEdit && (
          <button type="button" className="lb-add" onClick={onCreate} title="링크 추가">＋</button>
        )}
      </div>

      {tags.length > 0 && (
        <div className="lb-tagbar" role="group" aria-label="태그 필터">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className={"lb-tag" + (tagSel.includes(t) ? " on" : "")}
              aria-pressed={tagSel.includes(t)}
              onClick={() => toggleTag(t)}
            >
              {t}
            </button>
          ))}
          {tagSel.length > 0 && (
            <button type="button" className="lb-tag-clear" onClick={() => setTagSel([])}>해제</button>
          )}
        </div>
      )}

      <div className="lb-panel-body">
        {error && <p className="lb-note err">{error}</p>}

        {loading ? (
          <p className="lb-note">불러오는 중…</p>
        ) : links.length === 0 ? (
          <p className="lb-note">
            아직 등록된 링크가 없습니다.
            {canEdit ? " ＋ 로 첫 링크를 담아 보세요." : " 운영자가 등록하면 여기에 표시됩니다."}
          </p>
        ) : shown.length === 0 ? (
          <p className="lb-note">
            조건에 맞는 링크가 없습니다.
            {tagSel.length > 1 && " 고른 태그를 모두 가진 링크만 보입니다."}
          </p>
        ) : (
          <>
            {pinned.length > 0 && (
              <section className="lb-sect">
                <h3 className="lb-sect-t">
                  <span className="lb-sect-star" aria-hidden>★</span>
                  <span className="lb-sect-name">즐겨찾기</span>
                  <span className="lb-sect-n">{pinned.length}</span>
                </h3>
                {pinned.map(row)}
              </section>
            )}
            {groups.map((g) => (
              <section key={g.category} className="lb-sect">
                <h3 className="lb-sect-t">
                  <span className="lb-sect-name">{g.category}</span>
                  <span className="lb-sect-n">{g.links.length}</span>
                </h3>
                {g.links.map(row)}
              </section>
            ))}
          </>
        )}
      </div>
    </>
  );
}
