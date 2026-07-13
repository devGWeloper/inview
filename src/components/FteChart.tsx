import { FteStats } from "@/lib/types";

// 막대가 무한정 늘어나지 않도록 최근 N개월만 표시 (누적 연간 FTE 는 전체 기간 그대로).
const WINDOW = 12;

/**
 * 월별 FTE 추세 (연환산). 카드 안에 들어가는 컴팩트 막대 차트.
 * 최근 12개월만 보여주고, 가장 최근 월을 강조한다. 막대에 마우스를 올리면 상세값.
 */
export function FteChart({ stats }: { stats: FteStats }) {
  const months = stats.months.slice(-WINDOW);
  const capped = stats.months.length > WINDOW;
  const maxFte = Math.max(0.0001, ...months.map((m) => m.fte));
  const lastIdx = months.length - 1;
  // 당월은 아직 실적이 쌓이는 중 — 점선 막대로 구분
  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const hasLive = months.some((m) => m.ym === curYm);

  return (
    <div className="fte-chart">
      <div className="fte-chart-head">
        <span className="fte-chart-title">월별 FTE 추세{capped ? " · 최근 12개월" : ""}</span>
        <span className="fte-chart-sub">
          월 환산 · 누적 {stats.totalCount.toLocaleString()}건{hasLive ? " · 당월 집계 중" : ""}
        </span>
      </div>
      <div className="fte-bars">
        {months.map((m, i) => {
          const [yy, mm] = m.ym.split("-");
          const mon = Number(mm);
          // 연도가 바뀌는 지점(1월)·첫 막대는 'YY.M' 로 표기해 연 경계를 구분
          const label = i === 0 || mon === 1 ? `${yy.slice(2)}.${mon}` : `${mon}`;
          const h = Math.max(6, Math.round((m.fte / maxFte) * 100));
          const live = m.ym === curYm;
          return (
            <div
              className={"fte-bar-col" + (i === lastIdx ? " is-last" : "") + (live ? " is-live" : "")}
              key={m.ym}
              title={`${m.ym} · FTE ${m.fte.toFixed(2)} (성공 ${m.count.toLocaleString()}건)${live ? " · 집계 중" : ""}`}
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
