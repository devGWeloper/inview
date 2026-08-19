"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { LAYER_COLOR, LAYER_LABEL, LAYER_ORDER, LayerKey, TraceRow } from "@/lib/types";

const COL_MIN_FR = 0.25;
const SPLITTER_PX = 6;

type StartColResize = (
  e: React.PointerEvent,
  body: HTMLElement,
  index: number,
  fracs: number[],
  setter: (next: number[]) => void
) => void;

function useColResize(): StartColResize {
  const dragRef = useRef<{
    body: HTMLElement;
    index: number;
    splitter: HTMLElement;
    setter: (next: number[]) => void;
    fracs: number[];
    total: number;
    fixedLeft: number;
    pair: number;
  } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      const rect = d.body.getBoundingClientRect();
      const numSplitters = d.fracs.length - 1;
      const usable = rect.width - SPLITTER_PX * numSplitters;
      if (usable <= 0) return;
      const x = e.clientX - rect.left;
      const ratioCum = ((x - SPLITTER_PX * d.index - SPLITTER_PX / 2) / usable) * d.total;
      let newLeft = ratioCum - d.fixedLeft;
      let newRight = d.pair - newLeft;
      if (newLeft < COL_MIN_FR) { newLeft = COL_MIN_FR; newRight = d.pair - newLeft; }
      if (newRight < COL_MIN_FR) { newRight = COL_MIN_FR; newLeft = d.pair - newRight; }
      const next = [...d.fracs];
      next[d.index] = newLeft;
      next[d.index + 1] = newRight;
      d.fracs = next;
      d.setter(next);
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      d.splitter.classList.remove("dragging");
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return (e, body, index, fracs, setter) => {
    const splitter = e.currentTarget as HTMLElement;
    splitter.classList.add("dragging");
    const total = fracs.reduce((a, b) => a + b, 0);
    const fixedLeft = fracs.slice(0, index).reduce((a, b) => a + b, 0);
    const pair = fracs[index] + fracs[index + 1];
    dragRef.current = { body, index, splitter, setter, fracs: [...fracs], total, fixedLeft, pair };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
}

function colsStyle(fracs: number[]): CSSProperties {
  const out: Record<string, string> = {};
  fracs.forEach((f, i) => { out[`--c${i + 1}`] = `${f}fr`; });
  return out as CSSProperties;
}

function tryFormat(raw: string | null): { ok: boolean; text: string; lines: number } {
  if (!raw) return { ok: false, text: "", lines: 0 };
  try {
    const text = JSON.stringify(JSON.parse(raw), null, 2);
    return { ok: true, text, lines: text.split("\n").length };
  } catch {
    return { ok: false, text: raw, lines: raw.split("\n").length };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightJson(text: string): string {
  const esc = escapeHtml(text);
  return esc
    .replace(/("(?:\\.|[^"\\])*")(\s*:)/g, '<span class="jk">$1</span>$2')
    .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="js">$1</span>')
    .replace(/:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, ': <span class="jn">$1</span>')
    .replace(/:\s*(true|false|null)\b/g, ': <span class="jb">$1</span>');
}

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").replace("Z", "").slice(0, 23);
}

function fmtTsShort(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").replace("Z", "").slice(11, 23);
}

function diffMs(a: string | null, b: string | null): string {
  if (!a || !b) return "—";
  const d = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(d)) return "—";
  if (Math.abs(d) >= 1000) return `${(d / 1000).toFixed(2)}s`;
  return `${d} ms`;
}

// HTTP 상태 코드 → 색상 클래스 (2xx ok, 3xx warn, 4xx/5xx err)
function httpStsClass(code: string | null): "ok" | "warn" | "err" | "muted" {
  if (!code) return "muted";
  const n = Number(code);
  if (!Number.isFinite(n)) return "muted";
  if (n >= 200 && n < 300) return "ok";
  if (n >= 300 && n < 400) return "warn";
  if (n >= 400) return "err";
  return "muted";
}

function HttpStsBadge({ code }: { code: string | null }) {
  if (!code) return null;
  return <span className={`http-sts ${httpStsClass(code)}`} title={`HTTP ${code}`}>{code}</span>;
}

type JsonKind = "recv" | "send" | "resp";

const KIND_LABEL: Record<JsonKind, string> = { recv: "RECV", send: "SEND", resp: "RESP" };

// ── 송수신 순번(seq) ──────────────────────────────────────────────────────────
// 한 트레이스는 요청이 상위→하위로 내려갔다가(recv/send) 응답이 하위→상위로 올라온다(resp).
//   ① CUBE RECV → ② CUBE SEND → ③ GAIA RECV → ④ GAIA SEND → … → ⑧ GAIA RESP → ⑨ CUBE RESP
// 레이어 카드는 이 순서대로 나열되지 않으므로(레이어별로 묶여 있음) 각 칼럼에 순번을 찍는다.
// 순서는 **기록된 시각 오름차순**으로 매긴다 — 화면에 함께 표시되는 시각과 어긋나지 않고,
// GAIA→MCP 를 두 번 호출하는 multi-call 도 자연스럽게 끼워 넣어진다.
// 시각이 완전히 같을 때만 구조 순서(요청은 상위 먼저, 응답은 하위 먼저)로 가른다.
type SeqMap = Map<string, number>;

function seqKey(row: TraceRow, kind: JsonKind): string {
  return `${row.layer}|${row.timekey}|${kind}`;
}

function buildSeqMap(rows: TraceRow[]): SeqMap {
  const layerRank = new Map(LAYER_ORDER.map((l, i) => [l, i] as const));
  const evs: { key: string; t: number; tie: number }[] = [];
  for (const r of rows) {
    const li = layerRank.get(r.layer) ?? 0;
    const push = (kind: JsonKind, ts: string | null, tie: number) => {
      if (!ts) return;
      const t = Date.parse(ts);
      if (!Number.isFinite(t)) return;
      evs.push({ key: seqKey(r, kind), t, tie });
    };
    push("recv", r.recvTm, li * 2);      // 요청(하강): 상위 레이어가 먼저
    push("send", r.sendTm, li * 2 + 1);
    push("resp", r.respTm, 1000 - li);   // 응답(상승): 하위 레이어가 먼저
  }
  evs.sort((a, b) => a.t - b.t || a.tie - b.tie);
  return new Map(evs.map((e, i) => [e.key, i + 1] as const));
}

function SeqBadge({ n, kind, layer }: { n?: number; kind: JsonKind; layer: LayerKey }) {
  if (!n) {
    return <span className="seq none" title="시각이 기록되지 않아 순서를 알 수 없습니다">·</span>;
  }
  const up = kind === "resp";
  return (
    <span
      className={`seq ${up ? "up" : "down"}`}
      title={`${n}번째 · ${layer} ${KIND_LABEL[kind]} — ${up ? "응답(하위 → 상위)" : "요청(상위 → 하위)"}`}
    >
      {n}
    </span>
  );
}

// recv/send/resp 칼럼 머리 — 순번 배지 + 상대 시스템 + 시각
function ColHead({ kind, seq, row, peer, ts }: {
  kind: JsonKind;
  seq: SeqMap;
  row: TraceRow;
  peer: string | null;
  ts: string | null;
}) {
  return (
    <div className="tl-col-head">
      <span className="ch-label">
        <SeqBadge n={seq.get(seqKey(row, kind))} kind={kind} layer={row.layer} />
        {KIND_LABEL[kind]}
      </span>
      <span className="peer">
        {kind === "send" ? "→" : "←"} {peer ?? "-"} · {fmtTsShort(ts)}
      </span>
    </div>
  );
}

function showToast(message: string) {
  if (typeof document === "undefined") return;
  const el = document.createElement("div");
  el.className = "app-toast";
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  window.setTimeout(() => {
    el.classList.remove("show");
    window.setTimeout(() => el.remove(), 200);
  }, 1200);
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fallback below */ }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    const sel = document.getSelection();
    const prevRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (prevRange && sel) {
      sel.removeAllRanges();
      sel.addRange(prevRange);
    }
    return ok;
  } catch {
    return false;
  }
}

function JsonBlock({ raw, kind }: { raw: string | null; kind: JsonKind }) {
  const { ok, text, lines } = useMemo(() => tryFormat(raw), [raw]);
  const long = lines > 14 || text.length > 700;
  const [expanded, setExpanded] = useState(false);

  if (!raw) {
    return (
      <div className="json-block">
        <div className="json-toolbar">
          <span className="info">{KIND_LABEL[kind]} · no payload</span>
        </div>
        <pre className="json-content empty">기록되지 않았습니다.</pre>
      </div>
    );
  }

  const html = ok ? highlightJson(text) : escapeHtml(text);

  const copy = async () => {
    const success = await copyToClipboard(ok ? text : raw);
    if (success) showToast("클립보드에 복사되었습니다");
  };

  return (
    <div className="json-block">
      <div className="json-toolbar">
        <span className="info">{ok ? "JSON" : "TEXT"} · {lines} lines</span>
        <span className="tools">
          {long && (
            <button className="btn ghost xs" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "접기" : "펼치기"}
            </button>
          )}
          <button className="btn ghost xs" onClick={copy}>복사</button>
        </span>
      </div>
      <pre
        className={"json-content" + (expanded ? " expanded" : "")}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

type LayerGroup = { layer: LayerKey; rows: TraceRow[] };

// ERR_CD 컨벤션: FAIL_* = 비즈니스 validation 실패, ERROR_* = 인프라/통신 에러.
// 알 수 없는 prefix는 안전하게 err 로 취급.
function rowErrKind(errCd: string | null): "fail" | "err" | null {
  if (!errCd) return null;
  if (errCd.startsWith("FAIL_")) return "fail";
  return "err";
}

function groupStatus(rows: TraceRow[]): "ok" | "err" | "fail" | "warn" | "skip" {
  if (rows.length === 0) return "skip";
  const kinds = rows.map((r) => rowErrKind(r.errCd)).filter((k): k is "fail" | "err" => !!k);
  if (kinds.includes("err")) return "err";
  if (kinds.length > 0) return "fail";
  if (rows.every((r) => r.sendCompltYn === "Y")) return "ok";
  return "warn";
}

function Stepper({ groups }: { groups: LayerGroup[] }) {
  const byLayer = Object.fromEntries(groups.map((g) => [g.layer, g])) as Record<LayerKey, LayerGroup | undefined>;
  const gridStyle: CSSProperties = { gridTemplateColumns: `repeat(${LAYER_ORDER.length}, minmax(0, 1fr))` };

  return (
    <div className="stepper" style={gridStyle}>
      {LAYER_ORDER.map((l, i) => {
        const g = byLayer[l];
        const status = groupStatus(g?.rows ?? []);
        const row = g?.rows[0];
        const callCount = g?.rows.length ?? 0;
        const statusLabel =
          status === "err" ? "ERROR"
          : status === "fail" ? "FAIL"
          : status === "ok" ? "OK"
          : status === "warn" ? "WAIT"
          : "—";
        const isErrRow = status === "err" || status === "fail";
        const errRow = g?.rows.find((r) => !!r.errCd);
        return (
          <div key={l} className={`step ${status}`}>
            <span className="step-num">{i + 1}</span>
            <div className="step-body">
              <div className="step-top">
                <span className="name">
                  <span className="layer-chip" style={{ background: LAYER_COLOR[l] }} />
                  {l}
                </span>
                {status !== "skip" && (
                  <span className={`pill xs ${status}`}>
                    {statusLabel}
                  </span>
                )}
              </div>
              <div className="step-sub">
                {!row ? (
                  <span className="muted">기록 없음</span>
                ) : isErrRow ? (
                  <span className="mono">{errRow?.errCd ?? "-"}</span>
                ) : (
                  <>
                    <span className="mono">{fmtTsShort(row.recvTm)}</span>
                    {callCount > 1 && <span className="step-calls">{callCount} calls</span>}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 단일 호출 카드 (recv | send | resp 3컬럼) ─────────────────────────────────
function SingleCallCard({ row, seq, frac3, setFrac3, startResize }: {
  row: TraceRow;
  seq: SeqMap;
  frac3: number[];
  setFrac3: (next: number[]) => void;
  startResize: StartColResize;
}) {
  const errKind = rowErrKind(row.errCd);
  const status: "ok" | "err" | "fail" | "warn" =
    errKind ? errKind : row.sendCompltYn === "Y" ? "ok" : "warn";
  const statusLabel =
    status === "err" ? "ERROR"
    : status === "fail" ? "FAIL"
    : status === "ok" ? "OK"
    : "PENDING";
  const dur = diffMs(row.recvTm, row.respTm ?? row.sendTm);
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <div className="tl-card">
      <div className="tl-card-head">
        <div className="left">
          <span className="tl-layer-tag" style={{ background: LAYER_COLOR[row.layer] }}>{row.layer}</span>
          <span className="route" title={LAYER_LABEL[row.layer]}>
            <span className="hop">{row.recvSysId ?? "-"}</span>
            <span className="arrow">→</span>
            <span className="hop">{row.sysId ?? row.layer}</span>
            <span className="arrow">⇄</span>
            <span className="hop">{row.sendSysId ?? "-"}</span>
          </span>
          <HttpStsBadge code={row.httpStsCd} />
        </div>
        <div className="right">
          <span className="dur">{dur}</span>
          <span className={`pill ${status}`}><span className="dot" />{statusLabel}</span>
        </div>
      </div>

      <div ref={bodyRef} className="tl-body tl-body-3" style={colsStyle(frac3)}>
        <div className="tl-col">
          <ColHead kind="recv" seq={seq} row={row} peer={row.recvSysId} ts={row.recvTm} />
          <JsonBlock raw={row.recvMsgCtn} kind="recv" />
        </div>
        <div
          className="json-splitter"
          role="separator"
          aria-orientation="vertical"
          title="드래그하여 너비 조절"
          onPointerDown={(e) => bodyRef.current && startResize(e, bodyRef.current, 0, frac3, setFrac3)}
          onDoubleClick={() => setFrac3([1, 1, 1])}
        />
        <div className="tl-col">
          <ColHead kind="send" seq={seq} row={row} peer={row.sendSysId} ts={row.sendTm} />
          <JsonBlock raw={row.sendMsgCtn} kind="send" />
        </div>
        <div
          className="json-splitter"
          role="separator"
          aria-orientation="vertical"
          title="드래그하여 너비 조절"
          onPointerDown={(e) => bodyRef.current && startResize(e, bodyRef.current, 1, frac3, setFrac3)}
          onDoubleClick={() => setFrac3([1, 1, 1])}
        />
        <div className="tl-col">
          <ColHead kind="resp" seq={seq} row={row} peer={row.sendSysId} ts={row.respTm} />
          <JsonBlock raw={row.respMsgCtn} kind="resp" />
        </div>
      </div>

      {row.errCd && (
        <div className={`tl-error ${errKind ?? ""}`}>
          <code>{row.errCd}</code>
          <span>{row.errDescCtn ?? "에러 상세가 기록되지 않았습니다."}</span>
        </div>
      )}
    </div>
  );
}

// ── 복수 호출 카드 ────────────────────────────────────────────────────────────
// recv는 첫 번째 row(upstream 요청)를 상단에 전체 폭으로 표시
// 각 call은 번호 붙여 send | resp 2컬럼으로 표시
function MultiCallCard({ group, seq, frac2, setFrac2, startResize }: {
  group: LayerGroup;
  seq: SeqMap;
  frac2: number[];
  setFrac2: (next: number[]) => void;
  startResize: StartColResize;
}) {
  const { layer, rows } = group;
  const status = groupStatus(rows);
  const statusLabel =
    status === "err" ? "ERROR"
    : status === "fail" ? "FAIL"
    : status === "ok" ? "OK"
    : "PENDING";
  const firstRecv = rows.find((r) => r.recvTm)?.recvTm ?? null;
  const lastResp = [...rows].sort((a, b) => (b.respTm ?? "").localeCompare(a.respTm ?? ""))[0]?.respTm ?? null;
  const dur = diffMs(firstRecv, lastResp);
  const firstRow = rows[0];

  return (
    <div className="tl-card">
      <div className="tl-card-head">
        <div className="left">
          <span className="tl-layer-tag" style={{ background: LAYER_COLOR[layer] }}>{layer}</span>
          <span className="route" title={LAYER_LABEL[layer]}>
            <span className="hop">{firstRow.recvSysId ?? "-"}</span>
            <span className="arrow">→</span>
            <span className="hop">{firstRow.sysId ?? layer}</span>
          </span>
          <span className="tl-multicall-badge">{rows.length} calls</span>
        </div>
        <div className="right">
          <span className="dur">{dur}</span>
          <span className={`pill ${status}`}><span className="dot" />{statusLabel}</span>
        </div>
      </div>

      {/* upstream recv — 전체 폭 */}
      <div className="tl-recv-section">
        <ColHead kind="recv" seq={seq} row={firstRow} peer={firstRow.recvSysId} ts={firstRow.recvTm} />
        <JsonBlock raw={firstRow.recvMsgCtn} kind="recv" />
      </div>

      {/* 각 call: send | resp */}
      <div className="tl-calls-section">
        {rows.map((row, ci) => (
          <CallItem
            key={row.timekey}
            row={row}
            ci={ci}
            seq={seq}
            frac2={frac2}
            setFrac2={setFrac2}
            startResize={startResize}
          />
        ))}
      </div>
    </div>
  );
}

function CallItem({ row, ci, seq, frac2, setFrac2, startResize }: {
  row: TraceRow;
  ci: number;
  seq: SeqMap;
  frac2: number[];
  setFrac2: (next: number[]) => void;
  startResize: StartColResize;
}) {
  const errKind = rowErrKind(row.errCd);
  const callStatus: "ok" | "err" | "fail" | "warn" =
    errKind ? errKind : row.sendCompltYn === "Y" ? "ok" : "warn";
  const callDur = diffMs(row.sendTm, row.respTm);
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <div className={`tl-call-item ${ci > 0 ? "tl-call-item-border" : ""}`}>
      <div className="tl-call-header">
        <span className="tl-call-num">Call #{ci + 1}</span>
        <span className="tl-call-meta">
          <span className="hop mono">{row.sendSysId ?? "-"}</span>
          <HttpStsBadge code={row.httpStsCd} />
          <span className="dur-inline">{callDur}</span>
          {row.errCd && <span className={`pill ${errKind} xs`}><span className="dot" />{row.errCd}</span>}
          {!row.errCd && <span className={`pill ${callStatus} xs`}><span className="dot" />{callStatus.toUpperCase()}</span>}
        </span>
      </div>
      <div ref={bodyRef} className="tl-call-body" style={colsStyle(frac2)}>
        <div className="tl-col">
          <ColHead kind="send" seq={seq} row={row} peer={row.sendSysId} ts={row.sendTm} />
          <JsonBlock raw={row.sendMsgCtn} kind="send" />
        </div>
        <div
          className="json-splitter"
          role="separator"
          aria-orientation="vertical"
          title="드래그하여 너비 조절"
          onPointerDown={(e) => bodyRef.current && startResize(e, bodyRef.current, 0, frac2, setFrac2)}
          onDoubleClick={() => setFrac2([1, 1])}
        />
        <div className="tl-col">
          <ColHead kind="resp" seq={seq} row={row} peer={row.sendSysId} ts={row.respTm} />
          <JsonBlock raw={row.respMsgCtn} kind="resp" />
        </div>
      </div>
      {row.errCd && (
        <div className={`tl-error ${errKind ?? ""}`} style={{ margin: "0 14px 10px" }}>
          <code>{row.errCd}</code>
          <span>{row.errDescCtn ?? "에러 상세가 기록되지 않았습니다."}</span>
        </div>
      )}
    </div>
  );
}

export function TraceTimeline({ traceId, rows, loading }: {
  traceId: string | null;
  rows: TraceRow[];
  loading: boolean;
}) {
  const [frac3, setFrac3] = useState<number[]>([1, 1, 1]);
  const [frac2, setFrac2] = useState<number[]>([1, 1]);
  const startResize = useColResize();

  if (!traceId) {
    return (
      <div className="empty">
        좌측 TRACE 목록에서 항목을 선택하면<br />
        전체 레이어({LAYER_ORDER.join(" → ")}) 송수신 내역이 표시됩니다.
      </div>
    );
  }
  if (loading) return <div className="loading">불러오는 중…</div>;
  if (rows.length === 0) return <div className="empty">이 TRACE 에 기록된 레이어가 없습니다.</div>;

  const userId = rows.find((r) => r.userId)?.userId ?? "—";

  const allTimes = rows.flatMap((r) => [r.recvTm, r.sendTm, r.respTm]).filter((v): v is string => !!v).sort();
  const first = rows.map((r) => r.recvTm).filter((v): v is string => !!v).sort()[0] ?? null;
  const last = allTimes[allTimes.length - 1] ?? null;
  const totalLatency = diffMs(first, last);

  const groups: LayerGroup[] = LAYER_ORDER
    .map((l) => ({ layer: l, rows: rows.filter((r) => r.layer === l) }))
    .filter((g) => g.rows.length > 0);

  const seq = buildSeqMap(rows);

  return (
    <>
      <div className="detail-head">
        <div className="detail-id">
          <span className="label">TRACE</span>
          <span className="val">{traceId}</span>
        </div>
        <div className="detail-meta">
          <div className="cell"><span className="k">User</span><span className="v sans">{userId}</span></div>
          <div className="cell"><span className="k">First Recv</span><span className="v">{fmtTs(first)}</span></div>
          <div className="cell"><span className="k">Last Activity</span><span className="v">{fmtTs(last)}</span></div>
          <div className="cell"><span className="k">Total Latency</span><span className="v">{totalLatency}</span></div>
        </div>
        <Stepper groups={groups} />
      </div>

      <div className="timeline">
        {groups.map((g) =>
          g.rows.length === 1
            ? <SingleCallCard key={g.layer} row={g.rows[0]} seq={seq} frac3={frac3} setFrac3={setFrac3} startResize={startResize} />
            : <MultiCallCard key={g.layer} group={g} seq={seq} frac2={frac2} setFrac2={setFrac2} startResize={startResize} />
        )}
      </div>
    </>
  );
}
