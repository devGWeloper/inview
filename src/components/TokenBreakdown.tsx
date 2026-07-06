import { TokenDimStat } from "@/lib/types";
import { fmtDuration } from "@/components/TokenLatencyChart";

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

// 노드별 / 모델별 분포.
//  - 토큰 막대: IN/OUT 적층 + 폭 = 최대 대비 비중 (막대 하나로 총량 + 구성 동시 표현)
//  - 지연 막대: 폭 = 가장 느린 항목 대비 (어느 노드/모델이 느린지 눈으로 비교)
export function TokenBreakdown({
  items,
  emptyText,
  onSelect,
  selected,
}: {
  items: TokenDimStat[];
  emptyText: string;
  onSelect?: (key: string) => void;
  selected?: string;
}) {
  if (items.length === 0) {
    return <div className="top-empty">{emptyText}</div>;
  }
  const maxTotal = Math.max(1, ...items.map((i) => i.totalTokens));
  const grandTotal = items.reduce((a, b) => a + b.totalTokens, 0);
  const latencies = items.map((i) => i.avgLatencyMs).filter((v): v is number => v != null);
  const hasLatency = latencies.length > 0;
  const maxLatency = hasLatency ? Math.max(...latencies) : 0;

  return (
    <ul className="dim-list">
      {items.map((it) => {
        const share = grandTotal > 0 ? (it.totalTokens / grandTotal) * 100 : 0;
        const wBar = (it.totalTokens / maxTotal) * 100;
        const inFlex = it.inputTokens;
        const outFlex = it.outputTokens;
        const avgPerCall = it.calls > 0 ? it.totalTokens / it.calls : 0;
        const latPct = hasLatency && it.avgLatencyMs != null && maxLatency > 0
          ? (it.avgLatencyMs / maxLatency) * 100
          : 0;
        const active = selected === it.key;
        const isNone = it.key === "(none)";
        const interactive = !!onSelect && !isNone;
        return (
          <li
            key={it.key}
            className={"dim-row" + (active ? " active" : "") + (isNone ? " dim-none" : "")}
            onClick={interactive ? () => onSelect!(it.key) : undefined}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            title={interactive ? (active ? `클릭하여 ${it.key} 필터 해제` : `클릭하여 ${it.key} 로 필터링`) : it.key}
          >
            <div className="dim-row-head">
              <span className="dim-key">{it.key}</span>
              <span className="dim-stats">
                <span className="dim-total" title={`${it.totalTokens.toLocaleString()} tokens`}>
                  {fmtCompact(it.totalTokens)}
                </span>
                <span className="dim-share">{share.toFixed(1)}%</span>
              </span>
            </div>

            {/* 토큰: 폭=최대 대비, 내부는 IN/OUT 적층 */}
            <div className="dim-metric">
              <span className="dim-metric-lbl">토큰</span>
              <div className="dim-bar">
                <div className="dim-bar-fill tok" style={{ width: `${wBar}%` }}>
                  {inFlex > 0 && <span className="tks prompt" style={{ flexGrow: inFlex }} title={`INPUT ${it.inputTokens.toLocaleString()}`} />}
                  {outFlex > 0 && <span className="tks compl" style={{ flexGrow: outFlex }} title={`OUTPUT ${it.outputTokens.toLocaleString()}`} />}
                </div>
              </div>
              <span className="dim-metric-val">
                <span className="tks-l prompt">IN {fmtCompact(it.inputTokens)}</span>
                <span className="tks-l compl">OUT {fmtCompact(it.outputTokens)}</span>
              </span>
            </div>

            {/* 지연: 폭=가장 느린 항목 대비 */}
            <div className="dim-metric">
              <span className="dim-metric-lbl">지연</span>
              <div className="dim-bar">
                {latPct > 0 && <div className="dim-bar-fill lat" style={{ width: `${latPct}%` }} />}
              </div>
              <span className={"dim-metric-val lat" + (it.avgLatencyMs == null ? " muted" : "")}>
                {it.avgLatencyMs == null ? "측정 없음" : fmtDuration(it.avgLatencyMs)}
              </span>
            </div>

            <div className="dim-legend">
              <span>{it.calls.toLocaleString()} calls</span>
              <span className="dim-legend-sep">·</span>
              <span title="호출당 평균 토큰">{fmtCompact(avgPerCall)}/call</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
