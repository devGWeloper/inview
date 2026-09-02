"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { TokenQuestion, TokenRow } from "@/lib/types";
import { fmtDuration } from "@/lib/format";
import { callStatus, isFailedCall } from "@/lib/tokenStatus";

const PAGE_SIZE = 20; // 한 페이지에 보여줄 질문 수

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").slice(0, 19);
}
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}

type SortKey = "time" | "in" | "out" | "total" | "calls";
type SortDir = "asc" | "desc";

const sortVal = (r: TokenQuestion, k: SortKey): number | string =>
  k === "time" ? r.lastTm ?? "" :
  k === "in" ? r.inputTokens :
  k === "out" ? r.outputTokens :
  k === "calls" ? r.calls :
  r.totalTokens;

export function QuestionsTable({
  questions,
  onExpand,
}: {
  questions: TokenQuestion[];
  onExpand: (traceId: string) => Promise<TokenRow[]>;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "time", dir: "desc" });
  const [fTrace, setFTrace] = useState("");
  const [fUser, setFUser] = useState("");
  const [fNode, setFNode] = useState("");
  const [fModel, setFModel] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [cache, setCache] = useState<Record<string, TokenRow[] | "loading">>({});

  const nodeOptions = useMemo(
    () => Array.from(new Set(questions.flatMap((x) => x.nodes))).sort((a, b) => a.localeCompare(b)),
    [questions]
  );
  const modelOptions = useMemo(
    () => Array.from(new Set(questions.flatMap((x) => x.models))).sort((a, b) => a.localeCompare(b)),
    [questions]
  );

  const hasFilter = !!(fTrace.trim() || fUser.trim() || fNode || fModel);
  const clearFilters = () => {
    setFTrace("");
    setFUser("");
    setFNode("");
    setFModel("");
  };

  const rows = useMemo(() => {
    let list = questions;
    const t = fTrace.trim().toLowerCase();
    const u = fUser.trim().toLowerCase();
    if (t)
      list = list.filter(
        (x) => (x.traceId ?? "").toLowerCase().includes(t) || (x.queryCtn ?? "").toLowerCase().includes(t)
      );
    if (u) list = list.filter((x) => (x.userId ?? "").toLowerCase().includes(u));
    if (fNode) list = list.filter((x) => x.nodes.includes(fNode));
    if (fModel) list = list.filter((x) => x.models.includes(fModel));
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortVal(a, sort.key);
      const vb = sortVal(b, sort.key);
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return c * mul;
    });
  }, [questions, fTrace, fUser, fNode, fModel, sort]);

  useEffect(() => { setPage(0); }, [fTrace, fUser, fNode, fModel, sort, questions]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const paged = rows.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);

  const maxTotal = Math.max(1, ...questions.map((x) => x.totalTokens));

  const toggle = async (row: TokenQuestion) => {
    if (!row.traceId) return; // trace_id 없는(개별) 호출은 펼쳐서 조회할 대상이 없음
    const key = row.qKey;
    const next = new Set(open);
    if (next.has(key)) {
      next.delete(key);
      setOpen(next);
      return;
    }
    next.add(key);
    setOpen(next);
    if (!cache[key]) {
      setCache((c) => ({ ...c, [key]: "loading" }));
      try {
        const calls = await onExpand(row.traceId);
        setCache((c) => ({ ...c, [key]: calls }));
      } catch {
        setCache((c) => ({ ...c, [key]: [] }));
      }
    }
  };

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const SortTh = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <th className={num ? "num" : undefined} aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" className={"qth-sort" + (sort.key === k ? " active" : "")} onClick={() => onSort(k)}>
        {label}
        <span className="qth-arrow" aria-hidden>{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  if (questions.length === 0) return <div className="top-empty">질문 없음</div>;

  return (
    <div className="qtable-wrap">
      <div className="qtable-controls">
        <span className="qtable-meta">
          {rows.length.toLocaleString()}
          {hasFilter && ` / ${questions.length.toLocaleString()}`} 질문
        </span>
        {hasFilter && (
          <button type="button" className="qfilter-clear" onClick={clearFilters}>
            컬럼 필터 초기화 ✕
          </button>
        )}
      </div>

      <div className="token-recent-wrap">
        <table className="token-recent qtable">
          <thead>
            <tr>
              <th className="qcell-exp" aria-label="expand" />
              <SortTh k="time" label="LAST_TM" />
              <th>질문 (원본 질의 · TRACE_ID)</th>
              <th>USER</th>
              <th>NODE</th>
              <th>MODEL</th>
              <SortTh k="in" label="IN" num />
              <SortTh k="out" label="OUT" num />
              <SortTh k="total" label="TOTAL" num />
              <SortTh k="calls" label="CALLS" num />
            </tr>
            <tr className="qfilter-row">
              <th />
              <th />
              <th>
                <input
                  type="text"
                  className="qft-input"
                  placeholder="질의 / TRACE_ID 검색"
                  value={fTrace}
                  onChange={(e) => setFTrace(e.target.value)}
                  aria-label="질문 필터"
                />
              </th>
              <th>
                <input
                  type="text"
                  className="qft-input"
                  placeholder="검색"
                  value={fUser}
                  onChange={(e) => setFUser(e.target.value)}
                  aria-label="USER 필터"
                />
              </th>
              <th>
                <select className="qft-select" value={fNode} onChange={(e) => setFNode(e.target.value)} aria-label="NODE 필터">
                  <option value="">전체</option>
                  {nodeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th>
                <select className="qft-select" value={fModel} onChange={(e) => setFModel(e.target.value)} aria-label="MODEL 필터">
                  <option value="">전체</option>
                  {modelOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th colSpan={4} />
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => {
              const expandable = !!r.traceId; // trace_id 있으면 호출 1건이어도 펼쳐서 실제 쿼리 확인
              const isOpen = open.has(r.qKey);
              const w = (r.totalTokens / maxTotal) * 100;
              const sub = cache[r.qKey];
              return (
                <Fragment key={r.qKey}>
                  <tr
                    className={"qrow" + (expandable ? " expandable" : "") + (isOpen ? " open" : "")}
                    onClick={expandable ? () => toggle(r) : undefined}
                  >
                    <td className="qcell-exp">{expandable ? (isOpen ? "▾" : "▸") : ""}</td>
                    <td className="mono">{fmtTs(r.lastTm)}</td>
                    <td className="qcell-q">
                      {r.queryCtn ? (
                        <>
                          <span className="qq-text" title={r.queryCtn}>{r.queryCtn}</span>
                          <span className="qq-trace mono">{r.traceId ?? "(no trace)"}</span>
                        </>
                      ) : (
                        <>
                          <span className="qq-text mono">{r.traceId ?? <span className="muted">(no trace)</span>}</span>
                          <span className="qq-trace muted">질의 미기록</span>
                        </>
                      )}
                    </td>
                    <td className="mono">{r.userId ?? "—"}</td>
                    <td>
                      {/* LLM 호출이 타임아웃/실패한 노드는 그 칩만 빨갛게 — 어디서 끊겼는지 표시 */}
                      <span className="qchips">
                        {r.nodes.length === 0
                          ? "—"
                          : r.nodes.map((n) => (
                              <span
                                key={n}
                                className={"qnode" + (r.errorNodes.includes(n) ? " is-err" : "")}
                                title={r.errorNodes.includes(n) ? "이 노드에서 LLM 호출 타임아웃" : undefined}
                              >
                                {n}
                              </span>
                            ))}
                      </span>
                    </td>
                    <td>
                      <span className="qchips">
                        {r.models.length === 0 ? "—" : r.models.map((m) => <span key={m} className="qmodel">{m}</span>)}
                      </span>
                    </td>
                    <td className="num mono">{fmtInt(r.inputTokens)}</td>
                    <td className="num mono">{fmtInt(r.outputTokens)}</td>
                    <td className="num mono strong qtotal">
                      <span className="qtotal-bar" style={{ width: `${w}%` }} aria-hidden />
                      <span className="qtotal-val">{fmtInt(r.totalTokens)}</span>
                    </td>
                    <td className="num mono">{r.calls.toLocaleString()}</td>
                  </tr>
                  {isOpen && (
                    <tr className="qsubrow">
                      <td />
                      <td colSpan={9} className="qsub">
                        {sub === "loading" || sub === undefined ? (
                          <span className="muted">불러오는 중…</span>
                        ) : sub.length === 0 ? (
                          <span className="muted">호출 내역 없음</span>
                        ) : (
                          <CallsDetail calls={sub} originQuery={r.queryCtn} rowCalls={r.calls} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE_SIZE && (
        <div className="qpager">
          <button
            type="button"
            className="qpage-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={curPage === 0}
          >
            ‹ 이전
          </button>
          <span className="qpage-info">
            {curPage + 1} / {pageCount}
            <span className="qpage-range">
              {" "}· {(curPage * PAGE_SIZE + 1).toLocaleString()}–
              {Math.min(rows.length, curPage * PAGE_SIZE + PAGE_SIZE).toLocaleString()}
              {" / "}
              {rows.length.toLocaleString()}
            </span>
          </span>
          <button
            type="button"
            className="qpage-btn"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={curPage >= pageCount - 1}
          >
            다음 ›
          </button>
        </div>
      )}
    </div>
  );
}

const parseMs = (ts: string | null): number | null => {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
};

const normQ = (s: string | null): string => (s ?? "").replace(/\s+/g, " ").trim();

const LONG_QUERY = 280; // 이보다 길면 접어서(3줄) 보여주고 "더 보기"

function QueryText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > LONG_QUERY;
  return (
    <>
      <div className={"qtext" + (long && !expanded ? " clamped" : "")}>{text}</div>
      {long && (
        <button type="button" className="qtext-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "접기 ▴" : "더 보기 ▾"}
        </button>
      )}
    </>
  );
}

function CallsDetail({
  calls,
  originQuery,
  rowCalls,
}: {
  calls: TokenRow[];
  originQuery: string | null;
  rowCalls: number;
}) {
  const ordered = useMemo(() => [...calls].reverse(), [calls]); // API 는 최신순 → 시간순으로
  const maxTok = Math.max(1, ...ordered.map((c) => c.totalTokens));
  const totalTok = ordered.reduce((a, c) => a + c.totalTokens, 0);

  const origin = originQuery ?? ordered.find((c) => c.queryCtn)?.queryCtn ?? null;
  const originNorm = normQ(origin);

  const failedNodes = new Set(
    ordered.filter((c) => isFailedCall(c.statCd, c.errCtn)).map((c) => c.nodeNm ?? "—")
  );

  const flow: string[] = [];
  for (const c of ordered) {
    const n = c.nodeNm ?? "—";
    if (flow[flow.length - 1] !== n) flow.push(n);
  }
  const firstMs = parseMs(ordered[0]?.callTm ?? null);
  const lastMs = parseMs(ordered[ordered.length - 1]?.callTm ?? null);
  const spanMs = ordered.length > 1 && firstMs != null && lastMs != null && lastMs >= firstMs ? lastMs - firstMs : null;

  return (
    <div className="qcalls">
      {origin ? (
        <div className="qorigin">
          <span className="qorigin-label">원본 질의</span>
          <QueryText text={origin} />
        </div>
      ) : (
        <div className="qorigin none">
          <span className="qorigin-label">원본 질의</span>
          <span className="muted">질의 미기록</span>
        </div>
      )}

      <div className="qcalls-summary">
        <span className="qcalls-count">호출 {ordered.length}건</span>
        {ordered.length > rowCalls && (
          <span className="qcalls-note" title="상세는 조회 조건과 무관하게 이 질문의 호출 전부를 보여줍니다">
            조회 조건 밖 {ordered.length - rowCalls}건 포함
          </span>
        )}
        <span className="qcalls-flow">
          {flow.map((n, i) => (
            <Fragment key={`${n}-${i}`}>
              {i > 0 && <span className="qcall-arrow" aria-hidden>→</span>}
              <span className={"qnode" + (failedNodes.has(n) ? " is-err" : "")}>{n}</span>
            </Fragment>
          ))}
        </span>
        <span className="qcalls-aux mono">총 {fmtInt(totalTok)} tok</span>
        {spanMs != null && <span className="qcalls-aux mono">첫→마지막 호출 {fmtDuration(spanMs)}</span>}
      </div>

      <ol className="qcall-list">
        {ordered.map((c, i) => {
          const prevMs = i > 0 ? parseMs(ordered[i - 1].callTm) : null;
          const curMs = parseMs(c.callTm);
          const gap = prevMs != null && curMs != null && curMs >= prevMs ? curMs - prevMs : null;
          const differs = !!c.queryCtn && normQ(c.queryCtn) !== originNorm;
          const st = callStatus(c.statCd, c.errCtn);
          const isFail = st !== "ok";
          return (
            <li className="qcall" key={c.tokenId}>
              <span className="qcall-rail" aria-hidden>
                <span className="qcall-dot">{i + 1}</span>
              </span>
              <div className={"qcall-body" + (isFail ? " is-err" : "")}>
                <div className="qcall-head">
                  <span className={"qnode" + (isFail ? " is-err" : "")}>{c.nodeNm ?? "—"}</span>
                  <span className="qcall-arrow" aria-hidden>→</span>
                  <span className="qmodel">{c.modelNm ?? "—"}</span>
                  {isFail && (
                    <span className="qcall-status" title={c.errCtn ?? undefined}>
                      {st === "timeout" ? "타임아웃" : "실패"}
                    </span>
                  )}
                  {c.latencyMs != null && (
                    <span className="qcall-lat mono" title="LLM 요청→응답 소요시간">
                      ⏱ {fmtDuration(c.latencyMs)}
                    </span>
                  )}
                  <span className="qcall-time mono">
                    {fmtTs(c.callTm)}
                    {gap != null && gap > 0 && <span className="qcall-gap" title="직전 호출과의 간격"> (+{fmtDuration(gap)})</span>}
                  </span>
                </div>
                {isFail ? (
                  <div className="qcall-reason">{c.errCtn || "사유 미기록"}</div>
                ) : (
                  <div className="qcall-tok">
                    <span className="qcall-tokbar" aria-hidden>
                      <span style={{ width: `${(c.totalTokens / maxTok) * 100}%` }} />
                    </span>
                    <span className="qcall-toknum mono">
                      IN {fmtInt(c.inputTokens)} · OUT {fmtInt(c.outputTokens)} · <b>{fmtInt(c.totalTokens)} tok</b>
                    </span>
                  </div>
                )}
                {differs && (
                  <div className="qcall-qdiff">
                    <span className="qcall-qdiff-label">이 호출의 쿼리 (원본과 다름)</span>
                    <QueryText text={c.queryCtn!} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
