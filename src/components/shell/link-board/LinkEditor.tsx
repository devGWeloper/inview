"use client";

import { useEffect, useRef, useState } from "react";
import { LinkItem } from "@/lib/types";

const CATEGORY_LIST_ID = "lb-category-options";

function parseTags(raw: string): string[] {
  const out: string[] = [];
  for (const piece of raw.split(/[,\n]/)) {
    const t = piece.trim().slice(0, 24);
    if (t && !out.includes(t) && out.length < 8) out.push(t);
  }
  return out;
}

export function LinkEditor({
  initial,
  categories,
  saving,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  initial: LinkItem | null;
  categories: string[];
  saving: boolean;
  error: string;
  onSave: (link: LinkItem) => void;
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const isNew = initial === null;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [tagText, setTagText] = useState((initial?.tags ?? []).join(", "));
  const [desc, setDesc] = useState(initial?.desc ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || saving) return;
      e.stopPropagation(); // 패널까지 닫히지 않게 — 편집 창만 닫는다
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, saving]);

  const urlTrim = url.trim();
  const canSave = title.trim() !== "" && urlTrim !== "" && !saving;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    onSave({
      id: initial?.id ?? `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim(),
      // 스킴 없이 적어도 되게 한다 — 서버(normalizeLinkBoard)도 같은 보정을 한다.
      url: /^[a-z][a-z0-9+.-]*:/i.test(urlTrim) ? urlTrim : `https://${urlTrim}`,
      category: category.trim(),
      tags: parseTags(tagText),
      desc: desc.trim(),
    });
  }

  return (
    <div
      className="lb-modal-back"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <form
        className="lb-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "링크 추가" : "링크 수정"}
        onSubmit={submit}
      >
        <div className="lb-modal-head">
          <h2 className="lb-modal-title">{isNew ? "링크 추가" : "링크 수정"}</h2>
          <button type="button" className="lb-modal-x" onClick={onClose} disabled={saving} aria-label="닫기">✕</button>
        </div>

        <div className="lb-modal-body">
          <label className="lb-f">
            <span className="lb-f-l">이름</span>
            <input
              ref={titleRef}
              className="lb-f-in"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: GAIA 운영 콘솔"
              maxLength={80}
              required
            />
          </label>

          <label className="lb-f">
            <span className="lb-f-l">주소</span>
            <input
              className="lb-f-in"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              maxLength={500}
              required
            />
          </label>

          <label className="lb-f">
            <span className="lb-f-l">카테고리 <span className="lb-f-opt">선택 · 비우면 미분류</span></span>
            <input
              className="lb-f-in"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="예: GAIA · 사내 위키 · 모니터링"
              maxLength={40}
              list={CATEGORY_LIST_ID}
            />
            <datalist id={CATEGORY_LIST_ID}>
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>

          <label className="lb-f">
            <span className="lb-f-l">태그 <span className="lb-f-opt">쉼표로 구분 · 최대 8개</span></span>
            <input
              className="lb-f-in"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="예: 운영, 로그, 자주"
            />
          </label>

          <label className="lb-f">
            <span className="lb-f-l">설명 <span className="lb-f-opt">선택</span></span>
            <textarea
              className="lb-f-in lb-f-area"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="무엇을 보는 곳인지 한 줄"
              maxLength={200}
              rows={2}
            />
          </label>

          {error && <p className="lb-f-err">{error}</p>}
        </div>

        <div className="lb-modal-foot">
          {onDelete && (
            confirmDelete ? (
              <span className="lb-del-ask">
                <span>삭제할까요?</span>
                <button type="button" className="btn danger-solid xs" onClick={onDelete} disabled={saving}>삭제</button>
                <button type="button" className="btn xs" onClick={() => setConfirmDelete(false)} disabled={saving}>취소</button>
              </span>
            ) : (
              <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)} disabled={saving}>삭제</button>
            )
          )}
          <span className="lb-modal-gap" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>닫기</button>
          <button type="submit" className="btn primary" disabled={!canSave}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </div>
  );
}
