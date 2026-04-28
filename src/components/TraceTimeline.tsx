"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { LAYER_LABEL, LAYER_ORDER, LayerKey, TraceRow } from "@/lib/types";

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

type JsonKind = "recv" | "send" | "resp";

const KIND_LABEL: Record<JsonKind, string> = { recv: "RECV", send: "SEND", resp: "RESP" };

function JsonBlock({ raw, kind }: { raw: string | null; kind: JsonKind }) {
  const { ok, text, lines } = useMemo(() => tryFormat(raw), [raw]);
  const long = lines > 14 || text.length > 700;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

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
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* noop */ }
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
          <button className="btn ghost xs" onClick={copy}>{copied ? "복사됨" : "복사"}</button>
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

function groupStatus(rows: TraceRow[]): "ok" | "err" | "warn" | "skip" {
  if (rows.length === 0) return "skip";
  if (rows.some((r) => !!r.errCd)) return "err";
  if (rows.every((r) => r.sendCompltYn === "Y")) return "ok";
  return "warn";
}

function Stepper({ groups }: { groups: LayerGroup[] }) {
  const byLayer = Object.fromEntries(groups.map((g) => [g.layer, g])) as Record<LayerKey, LayerGroup | undefined>;

  return (
    <div className="stepper">
      {LAYER_ORDER.map((l) => {
        const g = byLayer[l];
        const status = groupStatus(g?.rows ?? []);
        const row = g?.rows[0];
        const callCount = g?.rows.length ?? 0;
        return (
          <div key={l} className={`step ${status}`}>
            <span className="idx" />
            <span className="name">{l}</span>
            <span className="sub">
              {!row ? "—" : status === "err"
                ? `err · ${row.errCd ?? "-"}`
                : callCount > 1
                ? `${callCount} calls · ${fmtTsShort(row.recvTm)}`
                : fmtTsShort(row.recvTm)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── 단일 호출 카드 (recv | send | resp 3컬럼) ─────────────────────────────────
function SingleCallCard({ row, frac3, setFrac3, startResize }: {
  row: TraceRow;
  frac3: number[];
  setFrac3: (next: number[]) => void;
  startResize: StartColResize;
}) {
  const status: "ok" | "err" | "warn" =
    row.errCd ? "err" : row.sendCompltYn === "Y" ? "ok" : "warn";
  const statusLabel = status === "err" ? "ERROR" : status === "ok" ? "OK" : "PENDING";
  const dur = diffMs(row.recvTm, row.respTm ?? row.sendTm);
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <div className="tl-card">
      <div className="tl-card-head">
        <div className="left">
          <span className={`tl-layer-tag ${row.layer}`}>{row.layer}</span>
          <span className="route" title={LAYER_LABEL[row.layer]}>
            <span className="hop">{row.recvSysId ?? "-"}</span>
            <span className="arrow">→</span>
            <span className="hop">{row.sysId ?? row.layer}</span>
            <span className="arrow">⇄</span>
            <span className="hop">{row.sendSysId ?? "-"}</span>
          </span>
        </div>
        <div className="right">
          <span className="dur">{dur}</span>
          <span className={`pill ${status}`}><span className="dot" />{statusLabel}</span>
        </div>
      </div>

      <div ref={bodyRef} className="tl-body tl-body-3" style={colsStyle(frac3)}>
        <div className="tl-col">
          <div className="tl-col-head">
            <span>RECV</span>
            <span className="peer">← {row.recvSysId ?? "-"} · {fmtTsShort(row.recvTm)}</span>
          </div>
          <JsonBlock raw={row.recvMsgCtn} kind="recv" />
        </div>
        <div
          className="json-splitter"
          role="separator"
          aria-orientation="vertical"
          title="드래그하여 너비 조절"
          onPointerDown={(e) => bodyRef.current && startResize(e, bodyRef.current, 0, frac3, setFrac3)}
        />
        <div className="tl-col">
          <div className="tl-col-head">
            <span>SEND</span>
            <span className="peer">→ {row.sendSysId ?? "-"} · {fmtTsShort(row.sendTm)}</span>
          </div>
          <JsonBlock raw={row.sendMsgCtn} kind="send" />
        </div>
        <div
          className="json-splitter"
          role="separator"
          aria-orientation="vertical"
          title="드래그하여 너비 조절"
          onPointerDown={(e) => bodyRef.current && startResize(e, bodyRef.current, 1, frac3, setFrac3)}
        />
        <div className="tl-col">
          <div className="tl-col-head">
            <span>RESP</span>
            <span className="peer">← {row.sendSysId ?? "-"} · {fmtTsShort(row.respTm)}</span>
          </div>
          <JsonBlock raw={row.respMsgCtn} kind="resp" />
        </div>
      </div>

      {row.errCd && (
        <div className="tl-error">
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
function MultiCallCard({ group, frac2, setFrac2, startResize }: {
  group: LayerGroup;
  frac2: number[];
  setFrac2: (next: number[]) => void;
  startResize: StartColResize;
}) {
  const { layer, rows } = group;
  const status = groupStatus(rows);
  const statusLabel = status === "err" ? "ERROR" : status === "ok" ? "OK" : "PENDING";
  const firstRecv = rows.find((r) => r.recvTm)?.recvTm ?? null;
  const lastResp = [...rows].sort((a, b) => (b.respTm ?? "").localeCompare(a.respTm ?? ""))[0]?.respTm ?? null;
  const dur = diffMs(firstRecv, lastResp);
  const firstRow = rows[0];

  return (
    <div className="tl-card">
      <div className="tl-card-head">
        <div className="left">
          <span className={`tl-layer-tag ${layer}`}>{layer}</span>
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
        <div className="tl-col-head">
          <span>RECV</span>
          <span className="peer">← {firstRow.recvSysId ?? "-"} · {fmtTsShort(firstRow.recvTm)}</span>
        </div>
        <JsonBlock raw={firstRow.recvMsgCtn} kind="recv" />
      </div>

      {/* 각 call: send | resp */}
      <div className="tl-calls-section">
        {rows.map((row, ci) => (
          <CallItem
            key={row.timekey}
            row={row}
            ci={ci}
            frac2={frac2}
            setFrac2={setFrac2}
            startResize={startResize}
          />
        ))}
      </div>
    </div>
  );
}

function CallItem({ row, ci, frac2, setFrac2, startResize }: {
  row: TraceRow;
  ci: number;
  frac2: number[];
  setFrac2: (next: number[]) => void;
  startResize: StartColResize;
}) {
  const callStatus: "ok" | "err" | "warn" =
    row.errCd ? "err" : row.sendCompltYn === "Y" ? "ok" : "warn";
  const callDur = diffMs(row.sendTm, row.respTm);
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <div className={`tl-call-item ${ci > 0 ? "tl-call-item-border" : ""}`}>
      <div className="tl-call-header">
        <span className="tl-call-num">Call #{ci + 1}</span>
        <span className="tl-call-meta">
          <span className="hop mono">{row.sendSysId ?? "-"}</span>
          <span className="dur-inline">{callDur}</span>
          {row.errCd && <span className={`pill err xs`}><span className="dot" />{row.errCd}</span>}
          {!row.errCd && <span className={`pill ${callStatus} xs`}><span className="dot" />{callStatus.toUpperCase()}</span>}
        </span>
      </div>
      <div ref={bodyRef} className="tl-call-body" style={colsStyle(frac2)}>
        <div className="tl-col">
          <div className="tl-col-head">
            <span>SEND</span>
            <span className="peer">→ {row.sendSysId ?? "-"} · {fmtTsShort(row.sendTm)}</span>
          </div>
          <JsonBlock raw={row.sendMsgCtn} kind="send" />
        </div>
        <div
          className="json-splitter"
          role="separator"
          aria-orientation="vertical"
          title="드래그하여 너비 조절"
          onPointerDown={(e) => bodyRef.current && startResize(e, bodyRef.current, 0, frac2, setFrac2)}
        />
        <div className="tl-col">
          <div className="tl-col-head">
            <span>RESP</span>
            <span className="peer">← {row.sendSysId ?? "-"} · {fmtTsShort(row.respTm)}</span>
          </div>
          <JsonBlock raw={row.respMsgCtn} kind="resp" />
        </div>
      </div>
      {row.errCd && (
        <div className="tl-error" style={{ margin: "0 14px 10px" }}>
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
        전체 레이어(CUBE → GAIA → MCP → ONEOIS → LEGACY) 송수신 내역이 표시됩니다.
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
          <div className="cell"><span className="k">Layers</span><span className="v">{groups.length} / 5</span></div>
        </div>
        <Stepper groups={groups} />
      </div>

      <div className="timeline">
        {groups.map((g) =>
          g.rows.length === 1
            ? <SingleCallCard key={g.layer} row={g.rows[0]} frac3={frac3} setFrac3={setFrac3} startResize={startResize} />
            : <MultiCallCard key={g.layer} group={g} frac2={frac2} setFrac2={setFrac2} startResize={startResize} />
        )}
      </div>
    </>
  );
}
