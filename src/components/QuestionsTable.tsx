"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { TokenQuestion, TokenRow } from "@/lib/types";

const PAGE_SIZE = 20; // 한 페이지에 보여줄 질문 수

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").slice(0, 19);
}
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}

type SortKey = "total" | "time";

// 질문(TRACE_ID) 단위 토큰 사용량 표.
//  - TOTAL 정렬(기본)로 "토큰 많이 먹은 질문" 위로
//  - 검색창으로 TRACE_ID/USER/NODE 즉시 필터 (로드된 상위 질문 범위 내)
//  - 호출이 여러 건인 질문은 행을 펼쳐 호출별 내역 확인 (onExpand 로 on-demand 조회)
export function QuestionsTable({
  questions,
  onExpand,
}: {
  questions: TokenQuestion[];
  /** 질문(traceId)의 호출별 행을 가져온다 (행 펼침). */
  onExpand: (traceId: string) => Promise<TokenRow[]>;
}) {
  const [sort, setSort] = useState<SortKey>("total");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [cache, setCache] = useState<Record<string, TokenRow[] | "loading">>({});

  const rows = useMemo(() => {
    let list = questions;
    const t = q.trim().toLowerCase();
    if (t) {
      list = list.filter(
        (x) =>
          (x.traceId ?? "").toLowerCase().includes(t) ||
          (x.userId ?? "").toLowerCase().includes(t) ||
          (x.nodeNm ?? "").toLowerCase().includes(t)
      );
    }
    return [...list].sort((a, b) =>
      sort === "total"
        ? b.totalTokens - a.totalTokens
        : (b.lastTm ?? "").localeCompare(a.lastTm ?? "")
    );
  }, [questions, q, sort]);

  // 검색/정렬/데이터가 바뀌면 첫 페이지로
  useEffect(() => { setPage(0); }, [q, sort, questions]);

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

  if (questions.length === 0) return <div className="top-empty">질문 없음</div>;

  return (
    <div className="qtable-wrap">
      <div className="qtable-controls">
        <input
          type="text"
          className="qtable-search"
          placeholder="🔍 TRACE_ID / USER / NODE 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="qtable-sort">
          <button
            type="button"
            className={"qsort-btn" + (sort === "total" ? " active" : "")}
            onClick={() => setSort("total")}
          >
            토큰순
          </button>
          <button
            type="button"
            className={"qsort-btn" + (sort === "time" ? " active" : "")}
            onClick={() => setSort("time")}
          >
            시간순
          </button>
        </div>
        <span className="qtable-meta">{rows.length.toLocaleString()} 질문</span>
      </div>

      <div className="token-recent-wrap">
        <table className="token-recent qtable">
          <thead>
            <tr>
              <th className="qcell-exp" aria-label="expand" />
              <th>LAST_TM</th>
              <th>TRACE_ID (질문)</th>
              <th>NODE</th>
              <th>MODEL</th>
              <th className="num">IN</th>
              <th className="num">OUT</th>
              <th className="num">TOTAL</th>
              <th className="num">CALLS</th>
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
                    <td className="mono strong">{r.traceId ?? <span className="muted">(no trace)</span>}</td>
                    <td><span className="qnode">{r.nodeNm ?? "—"}</span></td>
                    <td className="mono">{r.modelNm ?? "—"}</td>
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
                      <td colSpan={8} className="qsub">
                        {sub === "loading" || sub === undefined ? (
                          <span className="muted">불러오는 중…</span>
                        ) : sub.length === 0 ? (
                          <span className="muted">호출 내역 없음</span>
                        ) : (
                          <table className="qsub-table">
                            <tbody>
                              {sub.map((c) => (
                                <Fragment key={c.tokenId}>
                                  <tr>
                                    <td className="mono">{fmtTs(c.callTm)}</td>
                                    <td><span className="qnode">{c.nodeNm ?? "—"}</span></td>
                                    <td className="mono">{c.modelNm ?? "—"}</td>
                                    <td className="num mono">IN {fmtInt(c.inputTokens)}</td>
                                    <td className="num mono">OUT {fmtInt(c.outputTokens)}</td>
                                    <td className="num mono strong">{fmtInt(c.totalTokens)}</td>
                                  </tr>
                                  <tr className="qquery-row">
                                    <td />
                                    <td colSpan={5}>
                                      {c.queryCtn ? (
                                        <pre className="qquery">{c.queryCtn}</pre>
                                      ) : (
                                        <span className="muted">쿼리 미기록</span>
                                      )}
                                    </td>
                                  </tr>
                                </Fragment>
                              ))}
                            </tbody>
                          </table>
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
