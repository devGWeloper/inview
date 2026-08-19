"use client";

import { useMemo, useState } from "react";
import { TokenRow, TokenStatsResponse } from "@/lib/types";
import { fmtDuration } from "@/components/TokenLatencyChart";
import { CallStatus, callStatus } from "@/lib/tokenStatus";

// "LLM 호출 실패" — 실패(타임아웃 포함) 호출을 최근순으로 나열한다.
// 성공 호출만 적재하던 시절엔 실패한 노드가 화면에서 통째로 사라졌다:
// "actionRouter 27s 통과 → Seasoning 90s 타임아웃" 에서 뒤쪽이 안 보였다.
// 이 섹션은 그 뒤쪽을 "어느 노드 · 얼마 기다리다 · 무슨 사유로" 형태로 되살린다.
//   - 상단: 노드별 실패 수 (byNode.errorCalls — 기간 전체 집계)
//   - 목록: 최근 실패 호출 (fetchTokenStats 의 failures, 최대 50건)

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").slice(0, 19);
}

const LABEL: Record<CallStatus, string> = { ok: "OK", timeout: "⏱ TIMEOUT", error: "⚠ ERROR" };

export function TokenFailures({
  stats,
  onSelectNode,
}: {
  stats: TokenStatsResponse;
  /** 노드 칩 클릭 = 그 노드로 필터 (Tokens 탭에서만 전달, 리포트는 조회 전용) */
  onSelectNode?: (key: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const failNodes = useMemo(
    () =>
      stats.byNode
        .filter((d) => d.errorCalls > 0)
        .map((d) => ({ key: d.key, errorCalls: d.errorCalls, calls: d.calls }))
        .sort((a, b) => b.errorCalls - a.errorCalls),
    [stats.byNode]
  );

  if (!stats.statusAvailable) {
    return (
      <div className="top-empty">
        실패 호출 적재 전입니다 · GAIA 가 call_llm 예외를 STAT_CD=&apos;ERROR&apos; 로 남기면 표시됩니다
      </div>
    );
  }
  if (stats.totals.errorCalls === 0) {
    return <div className="top-empty">기간 내 실패한 LLM 호출이 없습니다</div>;
  }

  return (
    <div className="tfail">
      <div className="tfail-nodes">
        <span className="tfail-nodes-label">노드별 실패</span>
        {failNodes.map((n) => (
          <button
            key={n.key}
            type="button"
            className="tfail-nodechip"
            onClick={onSelectNode ? () => onSelectNode(n.key) : undefined}
            disabled={!onSelectNode}
            title={`${n.key} · 실패 ${n.errorCalls} / 전체 ${n.calls} 호출${onSelectNode ? "\n클릭 = 이 노드로 필터" : ""}`}
          >
            {n.key}
            <em>{n.errorCalls.toLocaleString()}</em>
          </button>
        ))}
      </div>

      <ul className="tfail-list">
        {stats.failures.map((c: TokenRow) => {
          const st = callStatus(c.statCd, c.errCtn);
          const open = openId === c.tokenId;
          return (
            <li className="tfail-item" key={c.tokenId}>
              <div className="tfail-line">
                <span className="tfail-time mono">{fmtTs(c.callTm)}</span>
                <span className={"qnode is-err"}>{c.nodeNm ?? "—"}</span>
                <span className="qcall-arrow" aria-hidden>→</span>
                <span className="qmodel">{c.modelNm ?? "—"}</span>
                <span className={"qcall-status is-" + st}>{LABEL[st]}</span>
                {c.latencyMs != null && (
                  <span className="qcall-lat mono is-err" title="호출 시작 → 예외까지 기다린 시간">
                    ⏱ {fmtDuration(c.latencyMs)}
                  </span>
                )}
                {c.userId && <span className="tfail-user mono">{c.userId}</span>}
              </div>
              <div className="tfail-reason">{c.errCtn || "사유 미기록"}</div>
              <div className="tfail-foot">
                <span className="tfail-trace mono">{c.traceId ?? "(no trace)"}</span>
                {c.queryCtn && (
                  <button
                    type="button"
                    className="tfail-qbtn"
                    onClick={() => setOpenId(open ? null : c.tokenId)}
                  >
                    {open ? "질의 접기 ▴" : "질의 보기 ▾"}
                  </button>
                )}
              </div>
              {open && c.queryCtn && <div className="tfail-query">{c.queryCtn}</div>}
            </li>
          );
        })}
      </ul>

      {stats.totals.errorCalls > stats.failures.length && (
        <div className="tfail-more">
          최근 {stats.failures.length}건만 표시 · 기간 내 실패 {stats.totals.errorCalls.toLocaleString()}건
        </div>
      )}
    </div>
  );
}
