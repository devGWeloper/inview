"use client";

import { useMemo, useState } from "react";
import { LAYER_LABEL, LAYER_ORDER, LayerKey, TraceRow } from "@/lib/types";

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

function diffMs(a: string | null, b: string | null): string {
  if (!a || !b) return "—";
  const d = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(d)) return "—";
  if (Math.abs(d) >= 1000) return `${(d / 1000).toFixed(2)}s`;
  return `${d} ms`;
}

function JsonBlock({ raw, kind }: {
  raw: string | null;
  kind: "recv" | "send";
}) {
  const { ok, text, lines } = useMemo(() => tryFormat(raw), [raw]);
  const long = lines > 14 || text.length > 700;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!raw) {
    return (
      <div className="json-block">
        <div className="json-toolbar">
          <span className="info">{kind === "recv" ? "RECV" : "SEND"} · no payload</span>
        </div>
        <pre className="json-content empty">전문이 기록되지 않았습니다.</pre>
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
        <span className="info">
          {ok ? "JSON" : "TEXT"} · {lines} lines
        </span>
        <span className="tools">
          {long && (
            <button
              className="btn ghost xs"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "접기" : "펼치기"}
            >
              {expanded ? "접기" : "펼치기"}
            </button>
          )}
          <button className="btn ghost xs" onClick={copy}>
            {copied ? "복사됨" : "복사"}
          </button>
        </span>
      </div>
      <pre
        className={"json-content" + (expanded ? " expanded" : "")}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function layerStatus(row: TraceRow | undefined): "ok" | "err" | "warn" | "skip" {
  if (!row) return "skip";
  if (row.errCd) return "err";
  if (row.sendCompltYn !== "Y") return "warn";
  return "ok";
}

function Stepper({ rowsByLayer }: { rowsByLayer: Record<LayerKey, TraceRow | undefined> }) {
  return (
    <div className="stepper">
      {LAYER_ORDER.map((l) => {
        const row = rowsByLayer[l];
        const status = layerStatus(row);
        return (
          <div key={l} className={`step ${status}`}>
            <span className="idx" />
            <span className="name">{l}</span>
            <span className="sub">
              {row
                ? (status === "err"
                    ? `err · ${row.errCd ?? "-"}`
                    : fmtTs(row.recvTm).slice(11, 19))
                : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function TraceTimeline({ traceId, rows, loading }: {
  traceId: string | null;
  rows: TraceRow[];
  loading: boolean;
}) {
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
  const sortedRecv = rows.map((r) => r.recvTm).filter((v): v is string => !!v).sort();
  const sortedSend = rows.map((r) => r.sendTm).filter((v): v is string => !!v).sort();
  const first = sortedRecv[0] ?? null;
  const last = sortedSend.length ? sortedSend[sortedSend.length - 1] : null;
  const totalLatency = diffMs(first, last);

  const byLayer: Record<LayerKey, TraceRow | undefined> = {
    CUBE: undefined, GAIA: undefined, MCP: undefined, ONEOIS: undefined, LEGACY: undefined
  };
  for (const r of rows) {
    if (!byLayer[r.layer]) byLayer[r.layer] = r;
  }

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
          <div className="cell"><span className="k">Last Send</span><span className="v">{fmtTs(last)}</span></div>
          <div className="cell"><span className="k">Total Latency</span><span className="v">{totalLatency}</span></div>
          <div className="cell"><span className="k">Layers</span><span className="v">{new Set(rows.map((r) => r.layer)).size} / 5</span></div>
        </div>

        <Stepper rowsByLayer={byLayer} />
      </div>

      <div className="timeline">
        {rows.map((r, idx) => {
          const dur = diffMs(r.recvTm, r.sendTm);
          const status: "ok" | "err" | "warn" =
            r.errCd ? "err" : r.sendCompltYn === "Y" ? "ok" : "warn";
          const statusLabel = status === "err" ? "ERROR" : status === "ok" ? "OK" : "PENDING";

          return (
            <div key={`${r.layer}-${r.timekey}-${idx}`} className="tl-card">
              <div className="tl-card-head">
                <div className="left">
                  <span className={`tl-layer-tag ${r.layer}`}>{r.layer}</span>
                  <span className="route" title={LAYER_LABEL[r.layer]}>
                    <span className="hop">{r.recvSysId ?? "-"}</span>
                    <span className="arrow">→</span>
                    <span className="hop">{r.sysId ?? r.layer}</span>
                    <span className="arrow">→</span>
                    <span className="hop">{r.sendSysId ?? "-"}</span>
                  </span>
                </div>
                <div className="right">
                  <span className="dur">{dur}</span>
                  <span className={`pill ${status}`}>
                    <span className="dot" />
                    {statusLabel}
                  </span>
                </div>
              </div>

              <div className="tl-body">
                <div className="tl-col">
                  <div className="tl-col-head">
                    <span>RECV · {fmtTs(r.recvTm)}</span>
                    <span className="peer">← {r.recvSysId ?? "-"}</span>
                  </div>
                  <JsonBlock raw={r.recvMsgCtn} kind="recv" />
                </div>
                <div className="tl-col">
                  <div className="tl-col-head">
                    <span>SEND · {fmtTs(r.sendTm)}</span>
                    <span className="peer">→ {r.sendSysId ?? "-"}</span>
                  </div>
                  <JsonBlock raw={r.sendMsgTm} kind="send" />
                </div>
              </div>

              {r.errCd && (
                <div className="tl-error">
                  <code>{r.errCd}</code>
                  <span>{r.errDescCtn ?? "에러 상세가 기록되지 않았습니다."}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
