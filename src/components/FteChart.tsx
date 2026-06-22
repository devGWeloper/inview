import { FteStats } from "@/lib/types";

/**
 * 월별 FTE 추세 (연환산). 카드 안에 들어가는 컴팩트 막대 차트.
 * 가장 최근 월을 강조하고, 막대에 마우스를 올리면 상세값을 보여준다.
 */
export function FteChart({ stats }: { stats: FteStats }) {
  const { months } = stats;
  const maxFte = Math.max(0.0001, ...months.map((m) => m.fte));
  const lastIdx = months.length - 1;

  return (
    <div className="fte-chart">
      <div className="fte-chart-head">
        <span className="fte-chart-title">월별 FTE 추세</span>
        <span className="fte-chart-sub">월 환산 · 누적 {stats.totalCount.toLocaleString()}건</span>
      </div>
      <div className="fte-bars">
        {months.map((m, i) => {
          const mon = Number(m.ym.slice(5, 7));
          const h = Math.max(6, Math.round((m.fte / maxFte) * 100));
          return (
            <div
              className={"fte-bar-col" + (i === lastIdx ? " is-last" : "")}
              key={m.ym}
              title={`${m.ym} · FTE ${m.fte.toFixed(2)} (성공 ${m.count.toLocaleString()}건)`}
            >
              <div className="fte-bar-track">
                <span className="fte-bar-val">{m.fte.toFixed(2)}</span>
                <div className="fte-bar-fill" style={{ height: `${h}%` }} />
              </div>
              <span className="fte-bar-label">{mon}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
