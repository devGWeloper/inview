"use client";

import { useCallback, useEffect, useState } from "react";
import { DimensionBreakdown } from "@/components/DimensionBreakdown";
import { LayerBars } from "@/components/LayerBars";
import { StatsCards } from "@/components/StatsCards";
import { StatusDonut } from "@/components/StatusDonut";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { TopList } from "@/components/TopList";
import { StatsFilter, StatsResponse } from "@/lib/types";

type Preset = "1h" | "6h" | "24h" | "7d" | "custom";

const PRESETS: { key: Preset; label: string; hours: number }[] = [
  { key: "1h",  label: "1H",  hours: 1   },
  { key: "6h",  label: "6H",  hours: 6   },
  { key: "24h", label: "24H", hours: 24  },
  { key: "7d",  label: "7D",  hours: 168 },
];

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return `${from.replace("T", " ").slice(0, 16)}  →  ${to.replace("T", " ").slice(0, 16)}`;
}

export default function DashboardPage() {
  const [preset, setPreset] = useState<Preset>("24h");
  const [userId, setUserId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [actionTyp, setActionTyp] = useState("");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const computeFilter = useCallback((): StatsFilter => {
    const base = {
      userId: userId || undefined,
      channelId: channelId || undefined,
      actionTyp: actionTyp || undefined,
    };
    if (preset === "custom") {
      return {
        ...base,
        dateFrom: customFrom || undefined,
        dateTo: customTo || undefined,
      };
    }
    const p = PRESETS.find((x) => x.key === preset)!;
    const now = Date.now();
    return {
      ...base,
      dateFrom: toLocalInput(now - p.hours * 3_600_000) + ":00",
      dateTo:   toLocalInput(now) + ":00",
    };
  }, [preset, customFrom, customTo, userId, channelId, actionTyp]);

  const load = useCallback(async (f: StatsFilter) => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams();
      if (f.dateFrom)  q.set("dateFrom",  f.dateFrom);
      if (f.dateTo)    q.set("dateTo",    f.dateTo);
      if (f.userId)    q.set("userId",    f.userId);
      if (f.channelId) q.set("channelId", f.channelId);
      if (f.actionTyp) q.set("actionTyp", f.actionTyp);
      const res = await fetch(`/api/stats?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StatsResponse = await res.json();
      setStats(data);
    } catch (e) {
      setErr(String(e));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(computeFilter()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    load(computeFilter());
  };

  const onPresetClick = (k: Preset) => {
    setPreset(k);
    if (k !== "custom") {
      const p = PRESETS.find((x) => x.key === k)!;
      const now = Date.now();
      load({
        dateFrom: toLocalInput(now - p.hours * 3_600_000) + ":00",
        dateTo:   toLocalInput(now) + ":00",
        userId: userId || undefined,
        channelId: channelId || undefined,
        actionTyp: actionTyp || undefined,
      });
    }
  };

  // 차트 클릭으로 채널/액션 필터링
  const onSelectChannel = (k: string) => {
    setChannelId(k);
    load({ ...computeFilter(), channelId: k });
  };
  const onSelectAction = (k: string) => {
    setActionTyp(k);
    load({ ...computeFilter(), actionTyp: k });
  };

  return (
    <div className="dash">
      <div className="dash-header">
        <div className="dash-title">
          <div className="dash-title-main">Usage Dashboard</div>
          <div className="dash-title-sub">
            {stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
          </div>
        </div>
        <form className="dash-filter" onSubmit={onApply}>
          <div className="preset-group" role="tablist" aria-label="time preset">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={"preset-btn" + (preset === p.key ? " active" : "")}
                onClick={() => onPresetClick(p.key)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={"preset-btn" + (preset === "custom" ? " active" : "")}
              onClick={() => setPreset("custom")}
            >
              Custom
            </button>
          </div>
          {preset === "custom" && (
            <div className="custom-range">
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="from"
              />
              <span className="range-arrow">→</span>
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="to"
              />
            </div>
          )}
          <input
            type="text"
            className="user-input"
            placeholder="USER_ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <input
            type="text"
            className="user-input"
            placeholder="CHANNEL_ID"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          />
          <input
            type="text"
            className="user-input"
            placeholder="ACTION_TYP"
            value={actionTyp}
            onChange={(e) => setActionTyp(e.target.value)}
          />
          <button type="submit" className="btn primary">조회</button>
        </form>
      </div>

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}

      {stats && (
        <>
          <StatsCards stats={stats} />

          <div className="dash-row split">
            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">Status Distribution</span>
                <span className="dash-card-sub">trace 단위</span>
              </div>
              <div className="dash-card-body">
                <StatusDonut stats={stats} />
              </div>
            </section>

            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">Top Errors</span>
                <span className="dash-card-sub">ERR_CD 빈도</span>
              </div>
              <div className="dash-card-body">
                <TopList items={stats.topErrors} totalForPct={stats.rowCount} emptyText="에러 없음 ✓" tone="err" />
              </div>
            </section>
          </div>

          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Traces Over Time</span>
              <span className="dash-card-sub">상태별 적층 · {stats.granularity}</span>
            </div>
            <div className="dash-card-body">
              <TimeSeriesChart stats={stats} />
            </div>
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Per-Layer Breakdown</span>
              <span className="dash-card-sub">행 단위 호출량 · 응답 시간</span>
            </div>
            <div className="dash-card-body">
              <LayerBars stats={stats} />
            </div>
          </section>

          <div className="dash-row split">
            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">By Channel</span>
                <span className="dash-card-sub">CHANNEL_ID 별 분포{channelId ? ` · 필터: ${channelId}` : ""}</span>
              </div>
              <div className="dash-card-body">
                <DimensionBreakdown
                  items={stats.byChannel}
                  emptyText="채널 데이터 없음"
                  onSelect={onSelectChannel}
                  selected={channelId || undefined}
                />
              </div>
            </section>

            <section className="dash-card">
              <div className="dash-card-head">
                <span className="dash-card-title">By Action Type</span>
                <span className="dash-card-sub">ACTION_TYP 별 분포{actionTyp ? ` · 필터: ${actionTyp}` : ""}</span>
              </div>
              <div className="dash-card-body">
                <DimensionBreakdown
                  items={stats.byAction}
                  emptyText="액션 데이터 없음"
                  onSelect={onSelectAction}
                  selected={actionTyp || undefined}
                />
              </div>
            </section>
          </div>

          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Top Users</span>
              <span className="dash-card-sub">트레이스 수 기준</span>
            </div>
            <div className="dash-card-body">
              <TopList items={stats.topUsers} totalForPct={stats.totals.total} emptyText="데이터 없음" tone="neutral" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
