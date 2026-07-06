import { TokenDimStat } from "@/lib/types";
import { fmtDuration } from "@/components/TokenLatencyChart";

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

// 노드별 / 모델별 분포.
//  - 토큰 막대: IN/OUT 적층 + 폭 = 최대 대비 비중 (막대 하나로 총량 + 구성 동시 표현)
//  - 지연 막대: 호출 가중 평균을 중앙선으로 둔 발산(diverging) 막대.
//    평균보다 빠르면 왼쪽(초록)·느리면 오른쪽(빨강)으로 뻗어 "어느 노드/모델이 느린가"가 즉시 보인다.
//    (value/최댓값 비례 막대는 값들이 비슷하면 다 비슷한 길이가 돼 변별력이 없었음)
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

  // 지연 기준선 = 호출 가중 평균(전체 호출의 평균 지연). 각 항목의 편차를 이 선 대비로 표현.
  const latItems = items.filter((i) => i.avgLatencyMs != null);
  const hasLatency = latItems.length > 0;
  const callSum = latItems.reduce((a, b) => a + b.calls, 0);
  const avgLat = !hasLatency
    ? 0
    : callSum > 0
      ? latItems.reduce((a, b) => a + b.avgLatencyMs! * b.calls, 0) / callSum
      : latItems.reduce((a, b) => a + b.avgLatencyMs!, 0) / latItems.length;
  const maxDev = hasLatency ? Math.max(0, ...latItems.map((i) => Math.abs(i.avgLatencyMs! - avgLat))) : 0;

  return (
    <div className="dim-wrap">
      {hasLatency && (
        <div className="dim-lat-ref">
          <span className="dim-lat-ref-lbl">지연 기준선</span>
          <span className="dim-lat-ref-val">{fmtDuration(avgLat)}</span>
          <span className="dim-lat-ref-hint">
            <span className="fast">◀ 빠름</span> · <span className="slow">느림 ▶</span> (호출 가중 평균 대비)
          </span>
        </div>
      )}
      <ul className="dim-list">
        {items.map((it) => {
          const share = grandTotal > 0 ? (it.totalTokens / grandTotal) * 100 : 0;
          const wBar = (it.totalTokens / maxTotal) * 100;
          const avgPerCall = it.calls > 0 ? it.totalTokens / it.calls : 0;
          const active = selected === it.key;
          const isNone = it.key === "(none)";
          const interactive = !!onSelect && !isNone;

          // 지연 발산 막대 계산
          const lat = it.avgLatencyMs;
          const dev = lat != null ? lat - avgLat : 0;
          const mag = lat != null && maxDev > 0 ? Math.min(50, (Math.abs(dev) / maxDev) * 50) : 0;
          const slower = dev > 0;
          const nearAvg = lat == null || Math.abs(dev) < 1 || maxDev === 0;

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
                    {it.inputTokens > 0 && <span className="tks prompt" style={{ flexGrow: it.inputTokens }} title={`INPUT ${it.inputTokens.toLocaleString()}`} />}
                    {it.outputTokens > 0 && <span className="tks compl" style={{ flexGrow: it.outputTokens }} title={`OUTPUT ${it.outputTokens.toLocaleString()}`} />}
                  </div>
                </div>
                <span className="dim-metric-val">
                  <span className="tks-l prompt">IN {fmtCompact(it.inputTokens)}</span>
                  <span className="tks-l compl">OUT {fmtCompact(it.outputTokens)}</span>
                </span>
              </div>

              {/* 지연: 평균(중앙선) 대비 발산 막대 */}
              <div className="dim-metric">
                <span className="dim-metric-lbl">지연</span>
                <div className="dim-bar diverge">
                  <span className="dim-center" aria-hidden />
                  {lat != null && mag > 0 && (
                    <span
                      className={"dim-bar-fill dev " + (slower ? "slow" : "fast")}
                      style={slower ? { left: "50%", width: `${mag}%` } : { left: `${50 - mag}%`, width: `${mag}%` }}
                      aria-hidden
                    />
                  )}
                </div>
                <span className={"dim-metric-val lat" + (lat == null ? " muted" : "")}>
                  {lat == null ? (
                    "측정 없음"
                  ) : (
                    <>
                      <span className="dim-lat-abs">{fmtDuration(lat)}</span>
                      <span className={"dim-delta " + (nearAvg ? "near" : slower ? "slow" : "fast")}>
                        {nearAvg ? "≈ 평균" : `${slower ? "▲ +" : "▼ −"}${fmtDuration(Math.abs(dev))}`}
                      </span>
                    </>
                  )}
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
    </div>
  );
}
