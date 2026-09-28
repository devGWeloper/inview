"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LinkBoard, LinkItem, allCategories } from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { useAuth } from "@/components/auth/AuthProvider";
import { LinkPanel } from "@/components/shell/link-board/LinkPanel";
import { LinkEditor } from "@/components/shell/link-board/LinkEditor";

// 즐겨찾기는 이 브라우저에만 남는다 — 보드 내용(공용)과 달리 개인 설정이다.
const PIN_KEY = "tracex.linkPins";

const PANEL_W = 330;
const PANEL_MAX_H = 560;

type Dialog = { mode: "create" } | { mode: "edit"; id: string } | null;

interface Anchor {
  left: number;
  bottom: number;
  maxHeight: number;
}

/** 버튼 오른쪽에 붙이고, 버튼 밑선을 기준으로 위로 자란다 (도구 그룹은 사이드바 맨 아래다). */
function anchorOf(el: HTMLElement): Anchor {
  const r = el.getBoundingClientRect();
  const left = Math.min(r.right + 10, window.innerWidth - PANEL_W - 12);
  const bottom = Math.max(12, window.innerHeight - r.bottom - 6);
  return {
    left: Math.max(12, left),
    bottom,
    maxHeight: Math.min(PANEL_MAX_H, window.innerHeight - bottom - 16),
  };
}

export function LinkBoardNav({ folded }: { folded: boolean }) {
  const { user } = useAuth();
  const canEdit = !!user && user.role === "ADMIN" && user.global === true;

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const [links, setLinks] = useState<LinkItem[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const loaded = useRef(false);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIN_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) setPins(list.filter((v): v is string => typeof v === "string"));
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const d = await apiJson<{ board: LinkBoard }>("/api/link-board", { cache: "no-store" });
      setLinks(asArray<LinkItem>(d.board?.links));
      loaded.current = true;
    } catch (e) {
      setLoadError(errMessage(e, "링크를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, []);

  const openPanel = useCallback(() => {
    if (btnRef.current) setAnchor(anchorOf(btnRef.current));
    setOpen(true);
    if (!loaded.current) load();
  }, [load]);

  const close = useCallback(() => {
    setOpen(false);
    setDialog(null);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) close();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      if (dialog) return; // 편집 창이 떠 있으면 바깥 클릭은 그 창이 처리한다
      close();
    };
    const reposition = () => {
      if (btnRef.current) setAnchor(anchorOf(btnRef.current));
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", reposition);
    };
  }, [open, dialog, saving, close]);

  function togglePin(id: string) {
    setPins((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  async function commit(next: LinkItem[]) {
    setSaving(true);
    setSaveError("");
    try {
      const d = await apiJson<{ board: LinkBoard }>("/api/link-board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: next }),
      });
      setLinks(asArray<LinkItem>(d.board?.links));
      setDialog(null);
    } catch (e) {
      setSaveError(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const editing = dialog?.mode === "edit" ? links.find((l) => l.id === dialog.id) ?? null : null;
  const dialogOpen = dialog?.mode === "create" || (dialog?.mode === "edit" && editing !== null);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={"sidenav-item lb-trigger" + (open ? " active" : "")}
        onClick={() => (open ? close() : openPanel())}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={folded ? "Link Board" : undefined}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
             strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1" />
          <path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1" />
        </svg>
        <span className="sidenav-text">Link Board</span>
        <svg className="lb-trigger-caret" width="12" height="12" viewBox="0 0 16 16" fill="none"
             stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </button>

      {open && anchor && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          className="lb-panel"
          role="dialog"
          aria-label="Link Board"
          style={{ left: anchor.left, bottom: anchor.bottom, width: PANEL_W, maxHeight: anchor.maxHeight }}
        >
          <LinkPanel
            links={links}
            pins={pins}
            loading={loading}
            error={loadError}
            canEdit={canEdit}
            onTogglePin={togglePin}
            onCreate={() => { setSaveError(""); setDialog({ mode: "create" }); }}
            onEdit={(id) => { setSaveError(""); setDialog({ mode: "edit", id }); }}
            onClose={close}
          />
        </div>,
        document.body
      )}

      {dialogOpen && typeof document !== "undefined" && createPortal(
        <LinkEditor
          initial={editing}
          categories={allCategories(links)}
          saving={saving}
          error={saveError}
          onSave={(link) => {
            const exists = links.some((l) => l.id === link.id);
            commit(exists ? links.map((l) => (l.id === link.id ? link : l)) : [...links, link]);
          }}
          onDelete={editing ? () => commit(links.filter((l) => l.id !== editing.id)) : null}
          onClose={() => { if (!saving) setDialog(null); }}
        />,
        document.body
      )}
    </>
  );
}
