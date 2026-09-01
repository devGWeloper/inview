"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Milestone, MILESTONE_STATUSES, MILESTONE_STATUS_LABEL, MilestoneStatus } from "@/lib/types";
import { STATE_CLASS } from "@/lib/roadmapTime";

/**
 * Action 한 건의 상세 — 운영자에겐 추가/수정 폼, 그 외에겐 읽기 전용 카드.
 *
 * ⚠️ 달력 아래 목록 표를 없앤 뒤로 **설명·상태·정확한 날짜를 볼 수 있는 유일한 자리**다.
 *    그래서 열람 권한만 있는 사람에게도 열린다(readOnly). 필드를 여기서 빼면 그 정보는
 *    화면 어디에도 남지 않는다.
 *
 * 화면 아래에 편집 목록을 늘어놓는 대신 팝업 하나로 모았다 — 로드맵은 읽는 시간이 대부분이고
 * 고치는 건 가끔이라, 편집 폼이 상시 붙어 있으면 읽는 화면이 아니라 관리 화면처럼 보인다.
 *
 * ⚠️ 시점은 **네이티브 date/month 입력**으로 받는다. 자유 입력이면 형식 오류를 사용자가
 *    감당해야 하고, 브라우저 달력 피커도 못 쓴다. 저장되는 문자열은 그대로
 *    `YYYY-MM-DD` / `YYYY-MM` / `""` 이라 lib/roadmapTime.ts 의 parseWhen 과 정확히 맞물린다.
 */

type WhenKind = "day" | "month" | "none";

function splitWhen(when: string): { kind: WhenKind; day: string; month: string } {
  const s = (when ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { kind: "day", day: s, month: s.slice(0, 7) };
  if (/^\d{4}-\d{2}$/.test(s)) return { kind: "month", day: "", month: s };
  return { kind: "none", day: "", month: "" };
}

const WHEN_KINDS: { key: WhenKind; label: string }[] = [
  { key: "day", label: "날짜" },
  { key: "month", label: "월만" },
  { key: "none", label: "미정" },
];

export function MilestoneDialog({
  initial,
  readOnly,
  /** 새로 만들 때 달력이 보고 있던 날 (YYYY-MM-DD). 기본값으로 채운다. */
  defaultDay,
  saving,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  initial: Milestone | null;
  /** 수정 권한이 없을 때 — 같은 팝업을 그대로 보되 입력을 잠그고 저장/삭제를 감춘다 */
  readOnly: boolean;
  defaultDay: string;
  saving: boolean;
  error: string;
  onSave: (m: Milestone) => void;
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const isNew = initial === null;
  const seed = useMemo(() => splitWhen(initial?.when ?? defaultDay), [initial, defaultDay]);

  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(initial?.status ?? "planned");
  const [desc, setDesc] = useState(initial?.desc ?? "");
  const [kind, setKind] = useState<WhenKind>(seed.kind);
  const [day, setDay] = useState(seed.day);
  const [month, setMonth] = useState(seed.month);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!readOnly) nameRef.current?.focus(); }, [readOnly]);

  // Esc 로 닫기 — 팝업이면 당연히 되어야 하는 동작이다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const when = kind === "day" ? day : kind === "month" ? month : "";
  const nameOk = name.trim() !== "";
  const whenOk = kind === "none" || when !== "";
  const canSave = nameOk && whenOk && !saving;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || !canSave) return;
    onSave({
      id: initial?.id ?? `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      status,
      when,
      desc: desc.trim(),
    });
  }

  return (
    <div className="rm-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <form
        className="rm-modal"
        role="dialog"
        aria-modal="true"
        aria-label={readOnly ? "Action 상세" : isNew ? "Action 추가" : "Action 수정"}
        onSubmit={submit}
      >
        <div className="rm-modal-head">
          <h2 className="rm-modal-title">{readOnly ? "Action 상세" : isNew ? "Action 추가" : "Action 수정"}</h2>
          <button type="button" className="rm-modal-x" onClick={onClose} disabled={saving} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="rm-modal-body">
          <label className="rm-f">
            <span className="rm-f-l">Action 이름</span>
            <input
              ref={nameRef}
              className="rm-f-in"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: AutoQual 실행"
              maxLength={80}
              required
              readOnly={readOnly}
            />
          </label>

          <div className="rm-f">
            <span className="rm-f-l">상태</span>
            <div className="rm-seg" role="group" aria-label="상태">
              {MILESTONE_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={"rm-seg-btn is-" + STATE_CLASS[s] + (status === s ? " on" : "")}
                  aria-pressed={status === s}
                  onClick={() => setStatus(s)}
                  disabled={readOnly}
                >
                  {MILESTONE_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="rm-f">
            <span className="rm-f-l">오픈 시점</span>
            <div className="rm-seg rm-seg-sm" role="group" aria-label="시점 종류">
              {WHEN_KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  className={"rm-seg-btn" + (kind === k.key ? " on neutral" : "")}
                  aria-pressed={kind === k.key}
                  onClick={() => setKind(k.key)}
                  disabled={readOnly}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {kind === "day" && (
              <input
                className="rm-f-in rm-f-date"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                aria-label="오픈 날짜"
                required
                readOnly={readOnly}
              />
            )}
            {kind === "month" && (
              <input
                className="rm-f-in rm-f-date"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                aria-label="오픈 월"
                required
                readOnly={readOnly}
              />
            )}
            {kind === "none" && <p className="rm-f-note">달력 칸에는 놓이지 않고 맨 아래 “일정 미정” 줄에 남습니다.</p>}
          </div>

          <label className="rm-f">
            <span className="rm-f-l">설명 <span className="rm-f-opt">선택</span></span>
            <input
              className="rm-f-in"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={readOnly ? "" : "한 줄로"}
              maxLength={200}
              readOnly={readOnly}
            />
          </label>

          {error && <p className="rm-modal-err">{error}</p>}
        </div>

        <div className="rm-modal-foot">
          {readOnly ? (
            <>
              <span className="rm-modal-gap" />
              <button type="button" className="btn" onClick={onClose}>
                닫기
              </button>
            </>
          ) : (
            <>
          {onDelete && (
            confirmDelete ? (
              <span className="rm-del-confirm">
                삭제할까요?
                <button type="button" className="btn danger-solid xs" onClick={onDelete} disabled={saving}>
                  삭제
                </button>
                <button type="button" className="btn xs" onClick={() => setConfirmDelete(false)} disabled={saving}>
                  취소
                </button>
              </span>
            ) : (
              <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                삭제
              </button>
            )
          )}
          <span className="rm-modal-gap" />
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="submit" className="btn primary" disabled={!canSave}>
            {saving ? "저장 중…" : "저장"}
          </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
