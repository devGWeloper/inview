
// 실적 리포트 텍스트. 입력은 InsightsResponse 하나뿐이다 — 다른 API 를 끌어오면
// "화면에 보이는 것 = 복사되는 것" 관계가 깨진다. docs/screens/insights.md

import { DailyRow } from "@/lib/dailyRows";
import { InsightsResponse } from "./types";

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const RULE = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

function ratio(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "—";
}

function duration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")} (${DAY_KO[dt.getDay()]})`;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface InsightsReportInput {
  data: InsightsResponse;
  rangeLabel: string;
  dailyRows: DailyRow[];
  actionLabel: (key: string) => string;
}

export function buildInsightsReport({
  data, rangeLabel, dailyRows, actionLabel,
}: InsightsReportInput): string {
  const L: string[] = [];
  const t = data.totals;

  L.push(RULE);
  L.push(`■ ${data.agent.name} 실적`);
  L.push(`■ 기간: ${rangeLabel}`);
  L.push(RULE);
  L.push("");

  L.push("[업무 실적]");
  L.push(`  · 처리 건수      ${t.total.toLocaleString()}건`);
  L.push(`  · 성공          ${t.ok.toLocaleString()}건 (${ratio(t.ok, t.total)})`);
  L.push(`  · 실패          ${t.fail.toLocaleString()}건 (${ratio(t.fail, t.total)})`);
  if (t.pending > 0) L.push(`  · 진행중        ${t.pending.toLocaleString()}건`);
  L.push(`  · 평균 응답 속도 ${duration(data.avgResponseMs)} (요청→응답 전 구간)`);
  L.push(`  · 사용 인원      ${data.uniqueUsers.toLocaleString()}명`);
  if (data.fte) {
    L.push(`  · 누적 절감 효과 ${data.fte.annualFte.toFixed(2)} FTE (${data.fte.totalCount.toLocaleString()}건 처리, 연 환산)`);
  }

  if (dailyRows.length >= 2) {
    L.push("");
    L.push("[일별 현황]");
    for (const d of dailyRows) {
      if (d.total === 0 && d.tokens === 0) {
        L.push(`  · ${dayLabel(d.date)}: -`);
        continue;
      }
      const parts = [`처리 ${d.total.toLocaleString()}`, `성공 ${d.ok.toLocaleString()}`];
      if (d.fail > 0) parts.push(`실패 ${d.fail.toLocaleString()}`);
      if (d.pending > 0) parts.push(`진행중 ${d.pending.toLocaleString()}`);
      parts.push(`사용자 ${d.users.toLocaleString()}명`);
      if (d.tokens > 0) parts.push(`토큰 ${d.tokens.toLocaleString()}`);
      L.push(`  · ${dayLabel(d.date)}: ${parts.join(" · ")}`);
      const acts = d.byAction.filter((a) => a.total > 0);
      if (acts.length > 0) {
        L.push(
          `      └ 기능: ` +
            acts
              .map((a) => `${actionLabel(a.key)} ${a.total.toLocaleString()}${a.fail > 0 ? `(실패 ${a.fail})` : ""}`)
              .join(", ")
        );
      }
    }
  }

  if (data.byAction.length > 0) {
    L.push("");
    L.push("[기능별 실적]");
    for (const a of data.byAction) {
      const detail = [`성공 ${a.ok.toLocaleString()}`, `실패 ${a.fail.toLocaleString()}`];
      if (a.pending > 0) detail.push(`진행중 ${a.pending.toLocaleString()}`);
      L.push(`  · ${actionLabel(a.key)}: ${a.total.toLocaleString()}건 (${detail.join(" · ")})`);
    }
  }

  if (data.topErrors.length > 0) {
    L.push("");
    L.push("[주요 실패 원인]");
    for (const e of data.topErrors) {
      L.push(`  · ${e.label}: ${e.count.toLocaleString()}건${e.described ? ` (${e.code})` : ""}`);
    }
  }

  const facTop = data.byFac.filter((f) => f.key !== "(none)").slice(0, 5);
  if (facTop.length > 0) {
    L.push("");
    L.push("[FAB별 TOP]");
    for (const f of facTop) L.push(`  · ${f.key}: ${f.total.toLocaleString()}건`);
  }

  L.push("");
  L.push("[AI 운영 현황]");
  const tok = data.tokens;
  if (!tok || tok.totals.calls === 0) {
    L.push("  · LLM 사용 내역 없음");
  } else {
    const tt = tok.totals;
    L.push(`  · LLM 호출       ${tt.calls.toLocaleString()}회`);
    L.push(`  · 토큰 사용량    ${tt.totalTokens.toLocaleString()} (입력 ${tt.inputTokens.toLocaleString()} / 출력 ${tt.outputTokens.toLocaleString()})`);
    if (tok.avgTotalPerCall != null) {
      L.push(`  · 호출당 평균    ${Math.round(tok.avgTotalPerCall).toLocaleString()} tok`);
    }
    L.push(`  · 평균 LLM 속도  ${duration(tok.avgLatencyMs)} (성공 호출 기준)`);
    if (tok.byModel.length > 0) {
      L.push("");
      L.push("[모델별]");
      for (const m of tok.byModel) {
        L.push(
          `  · ${m.key}: ${m.totalTokens.toLocaleString()} tok (${ratio(m.totalTokens, tt.totalTokens)})` +
            ` · 호출 ${m.calls.toLocaleString()} · 속도 ${duration(m.avgLatencyMs)}`
        );
      }
    }
  }

  const tmo = data.timeouts;
  if (tmo) {
    L.push("");
    if (!tmo.available) {
      L.push("[타임아웃] 집계 준비 중 (적재 전)");
    } else {
      L.push(
        `[타임아웃] ${tmo.timeoutCalls.toLocaleString()}건` +
          ` (전체 호출 ${tmo.totalCalls.toLocaleString()} 중 ${ratio(tmo.timeoutCalls, tmo.totalCalls)})` +
          ` · 영향 질문 ${tmo.affectedTraces.toLocaleString()}건`
      );
    }
  }

  L.push("");
  L.push(RULE);
  L.push(`(TraceX 실적 · 생성 ${stamp()})`);
  return L.join("\n");
}
