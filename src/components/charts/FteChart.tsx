import { FteStats } from "@/lib/types";

const WINDOW = 12;

export function FteChart({ stats }: { stats: FteStats }) {
  const months = stats.months.slice(-WINDOW);
  const capped = stats.months.length > WINDOW;
  const maxFte = Math.max(0.0001, ...months.map((m) => m.fte));
  const lastIdx = months.length - 1;

  return (
    <div className="fte-chart">
      <div className="fte-chart-head">
        <span className="fte-chart-title">월별 FTE 추세{capped ? " · 최근 12개월" : ""}</span>
        <span className="fte-chart-sub">월 환산 · 누적 {stats.totalCount.toLocaleString()}건</span>
      </div>
      <div className="fte-bars">
        {months.map((m, i) => {
          const [yy, mm] = m.ym.split("-");
          const mon = Number(mm);
          const label = i === 0 || mon === 1 ? `${yy.slice(2)}.${mon}` : `${mon}`;
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
              <span className="fte-bar-label">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
