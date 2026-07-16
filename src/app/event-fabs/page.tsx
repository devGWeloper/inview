"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EventFabMapping, FAB_IDS } from "@/lib/types";
import { ADMIN_PASSWORD, ADMIN_PASSWORD_HEADER } from "@/lib/adminAuth";
import { AdminGate } from "@/components/AdminGate";

// 이벤트(액션)별 허용 FAB 편집 화면. 저장하면 MCP DB 의 TRX_EVENT_MAP 에
// 전량 교체로 반영되고, MCP 로직이 요청 FAB 허용 여부 판정에 사용한다.
// (스키마·MCP 연동 예시: sql/create_trx_event_map.sql)

interface EventFabApi {
  available: boolean;
  mappings: EventFabMapping[];
  reason?: string;
}

export default function EventFabPage() {
  return (
    <AdminGate
      title="이벤트-FAB 매핑"
      sub="비밀번호를 입력하면 이벤트별 적용 FAB 을 편집할 수 있습니다."
      icon="🏭"
      backHref="/admin"
    >
      <EventFabEditor />
    </AdminGate>
  );
}

function EventFabEditor() {
  const [rows, setRows] = useState<EventFabMapping[]>([]);
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  // 이벤트 입력 자동완성 후보 — 실제 트레이스에 기록된 ACTION_TYP 목록
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [mapRes, actRes] = await Promise.all([
          fetch("/api/event-fabs", { cache: "no-store" }),
          fetch("/api/action-types", { cache: "no-store" }).catch(() => null),
        ]);
        const data: EventFabApi = await mapRes.json();
        if (!alive) return;
        setRows(data.mappings);
        setAvailable(data.available);
        setReason(data.reason);
        if (actRes?.ok) {
          const acts: { values: string[] } = await actRes.json();
          if (alive) setActionTypes(acts.values ?? []);
        }
      } catch (e) {
        if (alive) setMsg({ kind: "err", text: "불러오기 실패: " + String(e) });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // 매트릭스 컬럼 = 고정 FAB 목록 + DB 에 수동으로 들어간 미지 FAB (저장 시 유실 방지)
  const fabColumns = useMemo(() => {
    const extras = new Set<string>();
    for (const r of rows) for (const f of r.fabs) {
      if (!(FAB_IDS as readonly string[]).includes(f)) extras.add(f);
    }
    return [...FAB_IDS, ...Array.from(extras).sort()];
  }, [rows]);

  function setEventId(idx: number, value: string) {
    setRows((list) => list.map((r, i) => (i === idx ? { ...r, eventId: value } : r)));
  }
  function toggleFab(idx: number, fab: string) {
    setRows((list) =>
      list.map((r, i) => {
        if (i !== idx) return r;
        const fabs = r.fabs.includes(fab) ? r.fabs.filter((f) => f !== fab) : [...r.fabs, fab];
        return { ...r, fabs };
      })
    );
  }
  /** 행의 FAB 전체 토글 — 모두 켜져 있으면 비우고, 아니면 전체 선택 */
  function toggleAll(idx: number) {
    setRows((list) =>
      list.map((r, i) => {
        if (i !== idx) return r;
        const all = fabColumns.every((f) => r.fabs.includes(f));
        return { ...r, fabs: all ? [] : [...fabColumns] };
      })
    );
  }
  function addRow() {
    setRows((list) => [...list, { eventId: "", fabs: [] }]);
  }
  function removeRow(idx: number) {
    setRows((list) => list.filter((_, i) => i !== idx));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/event-fabs", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [ADMIN_PASSWORD_HEADER]: ADMIN_PASSWORD,
        },
        body: JSON.stringify({ mappings: rows }),
      });
      const data = await res.json();
      if (res.status === 401) throw new Error("비밀번호가 올바르지 않습니다.");
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setRows(data.mappings);
      setMsg({ kind: "ok", text: "저장되었습니다. MCP 반영은 캐시 TTL(기본 5분) 이후일 수 있습니다." });
    } catch (e) {
      setMsg({ kind: "err", text: "저장 실패: " + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="admin-page"><div className="dash-banner loading">불러오는 중…</div></div>;

  return (
    <div className="admin-page">
      <form className="admin-form" onSubmit={onSave}>
        <div className="admin-head">
          <div className="admin-titles">
            <div className="admin-title">이벤트-FAB 매핑</div>
            <div className="admin-sub">
              이벤트(액션)별로 기능을 적용할 FAB 을 선택합니다 · 저장 시 MCP DB(TRX_EVENT_MAP)에 반영
            </div>
          </div>
          <div className="admin-actions">
            <Link href="/admin" className="btn ghost" prefetch={false}>프로필 관리자</Link>
            <button type="submit" className="btn primary" disabled={saving || !available}>
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>

        {!available && (
          <div className="dash-banner err">
            MCP DB 를 사용할 수 없어 조회/저장이 불가합니다{reason ? ` — ${reason}` : ""}.
            테이블이 없다면 sql/create_trx_event_map.sql 을 MCP DB 에서 실행하세요.
          </div>
        )}
        {msg && <div className={`dash-banner ${msg.kind === "ok" ? "loading" : "err"}`}>{msg.text}</div>}

        <fieldset className="admin-section">
          <legend>이벤트별 적용 FAB</legend>
          <p className="admin-hint admin-hint-top">
            체크된 FAB 에서만 해당 이벤트가 실행됩니다 (MCP 가 허용 목록 밖의 요청을 팅겨냄).
            이벤트는 DB 의 <b>ACTION_TYP</b> 값(예: SEA, AUTOQUAL_CANCEL, AUTOQUAL_BM)과 일치해야 하며,
            여기에 등록하지 않은 이벤트의 허용 여부는 MCP 정책(기본: 전 FAB 허용)을 따릅니다.
          </p>

          <div className="fabmap-list">
            {rows.length === 0 && (
              <div className="fabmap-empty">
                <span className="fabmap-empty-ico" aria-hidden>🏭</span>
                <span>등록된 매핑이 없습니다. 아래 <b>“+ 이벤트 추가”</b> 로 시작하세요.</span>
              </div>
            )}
            {rows.map((r, i) => (
              <div className="fabmap-card" key={i}>
                <div className="fabmap-card-head">
                  <span className="fabmap-no" aria-hidden>{i + 1}</span>
                  <input
                    className="fabmap-event-input"
                    list="event-fab-suggestions"
                    value={r.eventId}
                    onChange={(e) => setEventId(i, e.target.value)}
                    placeholder="ACTION_TYP (예: AUTOQUAL_BM)"
                    aria-label="이벤트 (ACTION_TYP)"
                  />
                  <span
                    className={"fabmap-count" + (r.fabs.length === 0 ? " zero" : "")}
                    title={r.fabs.length === 0 ? "FAB 을 1개 이상 선택하세요" : `허용 FAB ${r.fabs.length}개`}
                  >
                    {r.fabs.length}<em>/{fabColumns.length}</em>
                  </span>
                  <button type="button" className="btn ghost xs" onClick={() => toggleAll(i)}>전체</button>
                  <button type="button" className="btn ghost xs" onClick={() => removeRow(i)} aria-label="행 삭제">✕</button>
                </div>
                <div className="fabmap-chips" role="group" aria-label={`${r.eventId || "이벤트"} 허용 FAB`}>
                  {fabColumns.map((fab) => {
                    const on = r.fabs.includes(fab);
                    return (
                      <button
                        key={fab}
                        type="button"
                        className={"fabmap-chip" + (on ? " on" : "")}
                        onClick={() => toggleFab(i, fab)}
                        aria-pressed={on}
                        aria-label={`${r.eventId || "이벤트"} — ${fab} 허용`}
                      >
                        <span className="fabmap-chip-check" aria-hidden>✓</span>
                        {fab}
                      </button>
                    );
                  })}
                </div>
                {r.fabs.length === 0 && (
                  <div className="fabmap-warn">허용할 FAB 을 1개 이상 선택하세요 — 0개인 행은 저장할 수 없습니다.</div>
                )}
              </div>
            ))}
          </div>
          <datalist id="event-fab-suggestions">
            {actionTypes.map((v) => <option key={v} value={v} />)}
          </datalist>

          <button type="button" className="btn ghost fabmap-add" onClick={addRow}>+ 이벤트 추가</button>
        </fieldset>

        <div className="admin-footer">
          <button type="submit" className="btn primary" disabled={saving || !available}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
