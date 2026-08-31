"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FAILURE_STATUSES,
  FailureStatus,
  RequestFailure,
  RequestFailureListResponse,
  RequestFailureContextItem,
  RequestFailureContextResponse,
} from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { humanText } from "@/lib/humanText";
import { useAuth } from "@/components/auth/AuthProvider";
import { roleAtLeast } from "@/lib/roles";

// Improvement Center 의 첫 모듈. 에이전트가 라우팅/LLM 단계에서 처리하지 못하고 튕긴
// "실패 요청"(ACTION_TYP IS NULL AND RECV_MSG_CTN IS NOT NULL)을 좌측 리스트로 훑고,
// 우측에서 원본 요청·사용자 요청 흐름을 보며 조치 상태(미조치→조치중→조치완료/무시)를 남긴다.
//
// ⚠️ 조회는 BR 이상, **조치 저장은 ADMIN 전용**이다(PUT 이 requireBiz("ADMIN")). BR 은 같은
//    화면을 열람 전용으로 본다 — 아래 canEdit 가 조치 폼을 잠근다(권위는 서버 판정).

const STATUS_LABEL: Record<FailureStatus, string> = Object.fromEntries(
  FAILURE_STATUSES.map((s) => [s.key, s.label])
) as Record<FailureStatus, string>;

const RANGES = [
  { key: "24h", label: "최근 24시간", hours: 24 },
  { key: "7d", label: "최근 7일", hours: 24 * 7 },
  { key: "30d", label: "최근 30일", hours: 24 * 30 },
  { key: "all", label: "전체", hours: 0 },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

function pad(n: number) { return String(n).padStart(2, "0"); }
function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").slice(0, 19);
}
function timeAgo(ts: string | null): string {
  if (!ts) return "—";
  const t = new Date(ts.replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return fmtTs(ts);
  const diff = Date.now() - t;
  if (diff < 0) return fmtTs(ts).slice(11);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return fmtTs(ts).slice(0, 10);
}
function snippet(s: string | null, n = 140): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

// CUBE 의 SEND/RESP 는 보통 JSON envelope 이다. 대화로 읽히게 사람이 읽는 문장만 뽑고,
// 못 찾으면 원문을 그대로 둔다(말풍선이 pre-wrap 이라 잘리지 않는다). — lib/humanText.ts 공용

export function RequestFailureTracker() {
  const [data, setData] = useState<RequestFailureListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("all");
  const [statusFilter, setStatusFilter] = useState<FailureStatus | "all">("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [errMap, setErrMap] = useState<Record<string, string>>({});
  // 목록 로드 실패 사유 (세션 만료·권한 등) — 빈 목록과 구분해 보여준다
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // 조치 저장은 ADMIN 만. BR 이하는 같은 화면을 열람 전용으로 본다.
  const { user } = useAuth();
  const canEdit = !!user && roleAtLeast(user.role, "ADMIN");

  const load = useCallback(async (rk: RangeKey) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "400" });
      const hours = RANGES.find((r) => r.key === rk)?.hours ?? 0;
      if (hours > 0) params.set("dateFrom", toLocalIso(new Date(Date.now() - hours * 3600_000)));
      const d = await apiJson<RequestFailureListResponse>(
        `/api/request-failures?${params.toString()}`, { cache: "no-store" }
      );
      setData({ ...d, items: asArray<RequestFailure>(d.items) });
      setLoadErr(null);
    } catch (e) {
      setData(null);
      setLoadErr(errMessage(e, "실패 요청을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(range); }, [range, load]);

  useEffect(() => {
    apiJson<{ codes?: Record<string, string> }>("/api/error-codes", { cache: "no-store" })
      .then((d) => setErrMap(d.codes ?? {}))
      .catch(() => setErrMap({}));
  }, []);

  const items = data?.items ?? [];
  const counts = data?.counts ?? { open: 0, investigating: 0, resolved: 0, ignored: 0 };

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (statusFilter !== "all" && it.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        (it.userId ?? "").toLowerCase().includes(needle) ||
        (it.errCd ?? "").toLowerCase().includes(needle) ||
        (it.recvMsgCtn ?? "").toLowerCase().includes(needle) ||
        it.traceId.toLowerCase().includes(needle)
      );
    });
  }, [items, statusFilter, q]);

  // 선택 유지/자동선택
  useEffect(() => {
    if (visible.length === 0) { setSelected(null); return; }
    if (!selected || !visible.some((v) => v.traceId === selected)) {
      setSelected(visible[0].traceId);
    }
  }, [visible, selected]);

  const selectedItem = items.find((it) => it.traceId === selected) ?? null;

  // 조치 저장 후 로컬 반영
  const applyTriage = useCallback((traceId: string, patch: Partial<RequestFailure>) => {
    setData((prev) => {
      if (!prev) return prev;
      const before = prev.items.find((x) => x.traceId === traceId);
      const items = prev.items.map((x) => (x.traceId === traceId ? { ...x, ...patch } : x));
      // 상태 카운트 재계산
      const counts = { open: 0, investigating: 0, resolved: 0, ignored: 0 } as typeof prev.counts;
      for (const it of items) counts[it.status] += 1;
      void before;
      return { ...prev, items, counts };
    });
  }, []);

  return (
    <div className="rft">
      <RftKpis counts={counts} affectedUsers={data?.affectedUsers ?? 0} total={items.length} loading={loading} />

      {data && !data.available && (
        <div className="dash-banner err">
          실패 요청을 조회할 수 없습니다{data.reason ? ` — ${data.reason}` : ""}
        </div>
      )}
      {data && data.available && canEdit && !data.triageAvailable && (
        <div className="dash-banner warn">
          조치 정보 테이블(TRX_REQ_FAILURE_INF)이 아직 없어 <b>조치 저장이 비활성화</b>됩니다.
          목록/흐름 조회는 정상입니다. (sql/create_trx_req_failure_inf.sql 실행 필요)
        </div>
      )}

      <div className="rft-toolbar">
        <div className="rft-ranges" role="tablist" aria-label="조회 기간">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={"rft-range" + (range === r.key ? " active" : "")}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn ghost xs" onClick={() => load(range)} disabled={loading}>
          {loading ? "불러오는 중…" : "↻ 새로고침"}
        </button>
      </div>

      <div className="rft-split">
        <section className="rft-list-panel">
          <div className="rft-chips" role="tablist" aria-label="상태 필터">
            <StatusChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")} label="전체" count={items.length} tone="all" />
            {FAILURE_STATUSES.map((s) => (
              <StatusChip
                key={s.key}
                active={statusFilter === s.key}
                onClick={() => setStatusFilter(s.key)}
                label={s.label}
                count={counts[s.key]}
                tone={s.key}
              />
            ))}
          </div>

          <label className="rft-search">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10.4 10.4 L13.6 13.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="사용자 · 에러코드 · 메시지 검색"
              aria-label="검색"
            />
            {q && <button type="button" className="rft-search-clear" onClick={() => setQ("")} aria-label="검색 지우기">✕</button>}
          </label>

          <div className="rft-list">
            {loading && <div className="rft-empty">불러오는 중…</div>}
            {!loading && loadErr && (
              <div className="load-error" style={{ margin: 10 }}><span aria-hidden>⚠</span>{loadErr}</div>
            )}
            {!loading && !loadErr && visible.length === 0 && (
              <div className="rft-empty">
                {items.length === 0 ? "이 기간에 실패 요청이 없습니다. 🎉" : "조건에 맞는 실패 요청이 없습니다."}
              </div>
            )}
            {!loading && visible.map((it) => (
              <button
                key={it.traceId}
                type="button"
                className={"rft-row" + (selected === it.traceId ? " active" : "")}
                onClick={() => setSelected(it.traceId)}
              >
                <span className={"rft-dot " + it.status} aria-hidden />
                <span className="rft-row-main">
                  <span className="rft-row-top">
                    <span className="rft-row-user">{it.userId ?? "알 수 없음"}</span>
                    <span className="rft-row-time">{timeAgo(it.recvTm)}</span>
                  </span>
                  <span className="rft-row-msg">{snippet(it.recvMsgCtn, 90) || <em>메시지 없음</em>}</span>
                  <span className="rft-row-tags">
                    {it.errCd ? (
                      <span className="rft-tag err" title={errMap[it.errCd] || undefined}>{it.errCd}</span>
                    ) : (
                      <span className="rft-tag route">라우팅 실패</span>
                    )}
                    {it.status !== "open" && <span className={"rft-tag st " + it.status}>{STATUS_LABEL[it.status]}</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rft-detail-panel">
          {selectedItem ? (
            <FailureDetail
              key={selectedItem.traceId}
              item={selectedItem}
              errMap={errMap}
              triageAvailable={!!data?.triageAvailable}
              canEdit={canEdit}
              onSaved={(patch) => applyTriage(selectedItem.traceId, patch)}
            />
          ) : (
            <div className="rft-detail-empty">
              <div className="rft-detail-empty-ico">🛠️</div>
              <div>왼쪽에서 실패 요청을 선택하면 상세와 사용자 흐름이 표시됩니다.</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function RftKpis({
  counts, affectedUsers, total, loading,
}: {
  counts: { open: number; investigating: number; resolved: number; ignored: number };
  affectedUsers: number;
  total: number;
  loading: boolean;
}) {
  const kpis = [
    { key: "open", label: "미조치", value: counts.open, tone: "open", accent: true },
    { key: "investigating", label: "조치중", value: counts.investigating, tone: "investigating" },
    { key: "resolved", label: "조치완료", value: counts.resolved, tone: "resolved" },
    { key: "users", label: "영향 사용자", value: affectedUsers, tone: "users" },
    { key: "total", label: "실패 요청(기간)", value: total, tone: "total" },
  ] as const;
  return (
    <div className={"rft-kpis" + (loading ? " loading" : "")}>
      {kpis.map((k) => (
        <div key={k.key} className={"rft-kpi " + k.tone + (("accent" in k && k.accent) ? " accent" : "")}>
          <div className="rft-kpi-val">{k.value.toLocaleString()}</div>
          <div className="rft-kpi-label">{k.label}</div>
        </div>
      ))}
    </div>
  );
}

function StatusChip({
  active, onClick, label, count, tone,
}: {
  active: boolean; onClick: () => void; label: string; count: number; tone: string;
}) {
  return (
    <button type="button" className={"rft-chip " + tone + (active ? " active" : "")} onClick={onClick} role="tab" aria-selected={active}>
      <span className="rft-chip-label">{label}</span>
      <span className="rft-chip-count">{count}</span>
    </button>
  );
}

// ── 상세 + 조치 + 사용자 흐름 ────────────────────────────────────────────────
function FailureDetail({
  item, errMap, triageAvailable, canEdit, onSaved,
}: {
  item: RequestFailure;
  errMap: Record<string, string>;
  /** 조치 테이블(TRX_REQ_FAILURE_INF)이 존재하는가 */
  triageAvailable: boolean;
  /** 조치를 남길 권한이 있는가 (ADMIN). BR 이하는 열람 전용 */
  canEdit: boolean;
  onSaved: (patch: Partial<RequestFailure>) => void;
}) {
  const [status, setStatus] = useState<FailureStatus>(item.status);
  const [note, setNote] = useState(item.note ?? "");
  const [handler, setHandler] = useState(item.handler ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const dirty = status !== item.status || note !== (item.note ?? "") || handler !== (item.handler ?? "");
  // 저장 가능 = 권한 O + 테이블 O. 두 사유를 나눠 두어 안내가 서로를 가리지 않게 한다.
  const canTriage = triageAvailable && canEdit;

  async function onSave() {
    if (saving || !canTriage) return;
    setSaving(true);
    setMsg(null);
    try {
      const d = await apiJson<{ status: FailureStatus; note: string | null; handler: string | null; triagedAt: string | null }>(
        "/api/request-failures", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ traceId: item.traceId, status, note, handler }),
        }
      );
      onSaved({ status: d.status, note: d.note, handler: d.handler, triagedAt: d.triagedAt });
      setNote(d.note ?? "");
      setHandler(d.handler ?? "");
      setMsg({ kind: "ok", text: "조치 정보를 저장했습니다." });
    } catch (e) {
      setMsg({ kind: "err", text: "저장 실패: " + errMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  function copyId() {
    navigator.clipboard?.writeText(item.traceId).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => {}
    );
  }

  const meaning = item.errCd ? errMap[item.errCd] : undefined;

  return (
    <div className="rft-detail">
      <div className="rft-detail-head">
        <div className="rft-detail-head-top">
          <span className={"rft-badge " + item.status}>{STATUS_LABEL[item.status]}</span>
          <button type="button" className="rft-trace" onClick={copyId} title="TRACE_ID 복사">
            <span className="mono">{item.traceId}</span>
            <span className="rft-copy">{copied ? "✓ 복사됨" : "⧉"}</span>
          </button>
        </div>
        <div className="rft-meta">
          <span><b>사용자</b> {item.userId ?? "—"}</span>
          <span><b>수신</b> {fmtTs(item.recvTm)}</span>
          {item.sysId && <span><b>SYS</b> {item.sysId}</span>}
          {item.channelId && <span><b>채널</b> {item.channelId}</span>}
          {item.httpStsCd && <span><b>HTTP</b> {item.httpStsCd}</span>}
        </div>
        <div className="rft-cause">
          {item.errCd ? (
            <>
              <span className="rft-cause-code">{item.errCd}</span>
              <span className="rft-cause-mean">{meaning || item.errDescCtn || "에러 코드 의미 미등록"}</span>
            </>
          ) : (
            <>
              <span className="rft-cause-code route">라우팅 실패</span>
              <span className="rft-cause-mean">ACTION_TYP 을 붙이지 못함 — 실제 액션 노드로 라우팅되지 못한 요청</span>
            </>
          )}
        </div>
      </div>

      <div className="rft-msg-block">
        <div className="rft-msg-label">요청 내용 (사용자 원본)</div>
        <div className="rft-msg-body">{item.recvMsgCtn || <em>메시지 없음</em>}</div>
      </div>
      {item.respMsgCtn && (
        <div className="rft-msg-block resp">
          <div className="rft-msg-label">응답 / 오류 본문</div>
          <div className="rft-msg-body">{item.respMsgCtn}</div>
        </div>
      )}

      <div className="rft-triage">
        <div className="rft-triage-head">
          <span className="rft-triage-title">조치</span>
          {item.triagedAt && (
            <span className="rft-triage-when">
              최근 조치 {fmtTs(item.triagedAt)}{item.handler ? ` · ${item.handler}` : ""}
            </span>
          )}
        </div>
        <div className="rft-seg" role="radiogroup" aria-label="조치 상태">
          {FAILURE_STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={"rft-seg-btn " + s.key + (status === s.key ? " active" : "")}
              onClick={() => setStatus(s.key)}
              disabled={!canTriage}
              role="radio"
              aria-checked={status === s.key}
              title={s.hint}
            >
              {s.label}
            </button>
          ))}
        </div>
        <textarea
          className="rft-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={canEdit ? "원인 · 정정/조치 내용을 남겨주세요." : "기록된 조치 내용이 없습니다."}
          rows={3}
          disabled={!canTriage}
        />
        <div className="rft-triage-actions">
          <input
            className="rft-handler"
            value={handler}
            onChange={(e) => setHandler(e.target.value)}
            placeholder="담당자"
            aria-label="담당자"
            disabled={!canTriage}
            title="비워 두면 로그인 계정(사번)으로 자동 기록됩니다"
          />
          {canEdit ? (
            <button
              type="button"
              className="btn primary"
              onClick={onSave}
              disabled={!canTriage || !dirty || saving}
            >
              {saving ? "저장 중…" : "조치 저장"}
              {dirty && !saving && canTriage && <span className="rft-dirty-dot" />}
            </button>
          ) : (
            <span className="fm-readonly" title="조치 기록은 운영자(ADMIN)만 남길 수 있습니다">열람 전용</span>
          )}
        </div>
        {msg && <div className={`rft-triage-msg ${msg.kind}`}>{msg.text}</div>}
      </div>

      <UserFlow traceId={item.traceId} errMap={errMap} />
    </div>
  );
}

// ── 사용자 요청 흐름 ─────────────────────────────────────────────────────────
function UserFlow({ traceId, errMap }: { traceId: string; errMap: Record<string, string> }) {
  const [ctx, setCtx] = useState<RequestFailureContextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  // 흐름 조회 실패 사유 (세션 만료·권한·DB 오류) — 빈 흐름과 구분해 보여준다.
  const [flowErr, setFlowErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiJson<RequestFailureContextResponse>(
      `/api/request-failures/${encodeURIComponent(traceId)}/context`, { cache: "no-store" }
    )
      .then((d) => {
        if (!alive) return;
        setCtx(d);
        setFlowErr(d.available ? null : d.reason || "흐름을 조회하지 못했습니다.");
      })
      .catch((e) => {
        if (!alive) return;
        setCtx(null);
        setFlowErr(errMessage(e, "흐름을 조회하지 못했습니다."));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [traceId]);

  const items = asArray<RequestFailureContextItem>(ctx?.items);

  return (
    <div className="rft-flow">
      <div className="rft-flow-head">
        <span className="rft-flow-title">사용자 대화 흐름</span>
        <span className="rft-flow-sub">
          {ctx?.userId ? `${ctx.userId} · 앞뒤 ±12시간` : "같은 사용자의 앞뒤 요청"}
        </span>
      </div>
      {loading && <div className="rft-empty sm">흐름 불러오는 중…</div>}
      {!loading && flowErr && (
        <div className="load-error"><span aria-hidden>⚠</span>{flowErr}</div>
      )}
      {!loading && !flowErr && items.length === 0 && (
        <div className="rft-empty sm">
          {ctx?.reason ? ctx.reason : "이 사용자의 앞뒤 12시간에 다른 요청이 없습니다."}
        </div>
      )}
      {!loading && items.length > 0 && (
        <ol className="rft-chat">
          {items.map((f) => {
            // Q/A = 사용자 I/F(CUBE) 의 SEND/RESP. Q 는 없으면 수신 메시지로 폴백.
            const q = humanText(f.queryCtn) || snippet(f.recvMsgCtn, 400);
            const a = humanText(f.answerCtn);
            const mean = f.errCd ? errMap[f.errCd] : "";
            return (
              <li key={f.traceId} className={"rft-turn" + (f.isCenter ? " center" : "")}>
                <div className="rft-msg q">
                  <div className="rft-msg-meta">
                    <span className="rft-msg-time">{fmtTs(f.recvTm).slice(11) || fmtTs(f.recvTm)}</span>
                    {f.isCenter && <span className="rft-flow-here">이 요청</span>}
                  </div>
                  <div className="rft-bubble q">{q || <em>질의 내용 없음</em>}</div>
                </div>

                <div className="rft-msg a">
                  <div className="rft-msg-meta">
                    {f.isFailure ? (
                      <span className="rft-flow-badge fail">{f.errCd || "라우팅 실패"}</span>
                    ) : (
                      <span className="rft-flow-badge ok">{f.actionTyp}</span>
                    )}
                    {f.httpStsCd && <span className="rft-flow-http">HTTP {f.httpStsCd}</span>}
                  </div>
                  {/* A = CUBE RESP_MSG_CTN(사용자가 받은 최종 응답). 없을 때만 에러 의미
                      → 안내 문구 순으로 내려간다. */}
                  <div className={"rft-bubble a" + (f.isFailure ? " fail" : "")}>
                    {a || mean || (
                      <span className="rft-bubble-none">
                        {f.isFailure ? "응답 없이 실패" : "응답 기록 없음"}
                      </span>
                    )}
                  </div>
                  {a && mean && <span className="rft-msg-mean">{mean}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
