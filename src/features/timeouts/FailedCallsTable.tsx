"use client";

import { useEffect, useMemo, useState } from "react";
import { TimeoutItem } from "@/lib/types";
import { callStatus } from "@/lib/tokenStatus";
import { fmtDuration } from "@/lib/format";

function fmtTs(ts: string | null): string {
  return ts ? ts.slice(0, 19).replace("T", " ") : "—";
}

export const PAGE_SIZE = 25;
export type SortKey = "time" | "wait";
export type SortDir = "asc" | "desc";
export type Result = "" | "timeout" | "error";

export function FailedCallsTable({ items }: { items: TimeoutItem[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "time", dir: "desc" });
  const [fResult, setFResult] = useState<Result>("");
  const [fNode, setFNode] = useState("");
  const [fModel, setFModel] = useState("");
  const [fUser, setFUser] = useState("");
  const [fText, setFText] = useState("");
  const [page, setPage] = useState(0);

  const opts = (pick: (it: TimeoutItem) => string | null) =>
    Array.from(new Set(items.map((it) => pick(it) ?? "(없음)"))).sort((a, b) => a.localeCompare(b));
  const nodeOptions = useMemo(() => opts((it) => it.nodeNm), [items]);
  const modelOptions = useMemo(() => opts((it) => it.modelNm), [items]);

  const hasFilter = !!(fResult || fNode || fModel || fUser.trim() || fText.trim());
  const clearFilters = () => {
    setFResult("");
    setFNode("");
    setFModel("");
    setFUser("");
    setFText("");
  };

  const rows = useMemo(() => {
    const u = fUser.trim().toLowerCase();
    const t = fText.trim().toLowerCase();
    let list = items;
    if (fResult) list = list.filter((it) => (callStatus(it.statCd, it.errCtn) === "timeout") === (fResult === "timeout"));
    if (fNode) list = list.filter((it) => (it.nodeNm ?? "(없음)") === fNode);
    if (fModel) list = list.filter((it) => (it.modelNm ?? "(없음)") === fModel);
    if (u) list = list.filter((it) => (it.userId ?? "").toLowerCase().includes(u));
    if (t)
      list = list.filter(
        (it) =>
          (it.queryCtn ?? "").toLowerCase().includes(t) ||
          (it.errCtn ?? "").toLowerCase().includes(t) ||
          (it.traceId ?? "").toLowerCase().includes(t)
      );
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort.key === "wait") return ((a.latencyMs ?? -1) - (b.latencyMs ?? -1)) * mul;
      return (a.callTm ?? "").localeCompare(b.callTm ?? "") * mul;
    });
  }, [items, fResult, fNode, fModel, fUser, fText, sort]);

  useEffect(() => { setPage(0); }, [fResult, fNode, fModel, fUser, fText, sort, items]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const paged = rows.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const SortTh = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <th
      className={num ? "num" : undefined}
      aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button type="button" className={"qth-sort" + (sort.key === k ? " active" : "")} onClick={() => onSort(k)}>
        {label}
        <span className="qth-arrow" aria-hidden>{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  if (items.length === 0) return <div className="top-empty">없음</div>;

  return (
    <div className="qtable-wrap">
      <div className="qtable-controls">
        <span className="qtable-meta">
          {rows.length.toLocaleString()}
          {hasFilter && ` / ${items.length.toLocaleString()}`} 건
        </span>
        {hasFilter && (
          <button type="button" className="qfilter-clear" onClick={clearFilters}>
            컬럼 필터 초기화 ✕
          </button>
        )}
      </div>

      <div className="token-recent-wrap">
        <table className="token-recent to-table">
          <thead>
            <tr>
              <SortTh k="time" label="호출 시각" />
              <th>결과</th>
              <th>노드</th>
              <th>모델</th>
              <SortTh k="wait" label="대기" num />
              <th>사용자</th>
              <th className="to-col-q">질의</th>
              <th className="to-col-q">사유</th>
              <th>TRACE_ID</th>
            </tr>
            <tr className="qfilter-row">
              <th />
              <th>
                <select
                  className="qft-select"
                  value={fResult}
                  onChange={(e) => setFResult(e.target.value as Result)}
                  aria-label="결과 필터"
                >
                  <option value="">전체</option>
                  <option value="timeout">타임아웃</option>
                  <option value="error">LLM 오류</option>
                </select>
              </th>
              <th>
                <select className="qft-select" value={fNode} onChange={(e) => setFNode(e.target.value)} aria-label="노드 필터">
                  <option value="">전체</option>
                  {nodeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th>
                <select className="qft-select" value={fModel} onChange={(e) => setFModel(e.target.value)} aria-label="모델 필터">
                  <option value="">전체</option>
                  {modelOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th />
              <th>
                <input
                  type="text"
                  className="qft-input"
                  placeholder="검색"
                  value={fUser}
                  onChange={(e) => setFUser(e.target.value)}
                  aria-label="사용자 필터"
                />
              </th>
              <th colSpan={3}>
                <input
                  type="text"
                  className="qft-input"
                  placeholder="질의 / 사유 / TRACE_ID 검색"
                  value={fText}
                  onChange={(e) => setFText(e.target.value)}
                  aria-label="질의·사유 필터"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((it) => {
              const st = callStatus(it.statCd, it.errCtn);
              return (
                <tr key={it.tokenId}>
                  <td className="mono">{fmtTs(it.callTm)}</td>
                  <td>
                    <span className={"to-st" + (st === "timeout" ? " is-timeout" : "")}>
                      {st === "timeout" ? "타임아웃" : "LLM 오류"}
                    </span>
                  </td>
                  <td>{it.nodeNm ? <span className="qnode">{it.nodeNm}</span> : "—"}</td>
                  <td>{it.modelNm ? <span className="qmodel">{it.modelNm}</span> : "—"}</td>
                  <td className="num mono">{fmtDuration(it.latencyMs)}</td>
                  <td className="mono">{it.userId ?? "—"}</td>
                  <td className="to-col-q">
                    <span className="to-q" title={it.queryCtn ?? undefined}>{it.queryCtn ?? "—"}</span>
                  </td>
                  <td className="to-col-q">
                    <span className="to-q to-err" title={it.errCtn ?? undefined}>{it.errCtn ?? "—"}</span>
                  </td>
                  <td className="to-trace mono">{it.traceId ?? "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="top-empty">조건에 맞는 호출이 없습니다</div>
                </td>
              </tr>
            )}
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
