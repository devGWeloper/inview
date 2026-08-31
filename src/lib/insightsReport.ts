// ─────────────────────────────────────────────────────────────────────────────
// 실적 화면(/insights)의 "리포트 복사" 텍스트 조립.
//
// 매주 수기로 옮겨 적던 실적을 한 번의 복사로 대체한다. 예전엔 `/report` 전용 화면이
// 같은 일을 했지만 실적 화면과 내용이 겹쳐 화면을 없앴고, 복사 기능만 여기로 옮겼다.
//
// ⚠️ **입력은 `InsightsResponse` 하나뿐이다.** 다른 API 를 끌어오지 말 것 —
//    그러면 "화면에 보이는 것 = 복사되는 것" 이라는 관계가 깨지고, 일반 사용자(FIELD)
//    세션에는 애초에 없는 데이터(사번·내부 노드명·AREA)를 리포트에만 싣게 된다.
//    `/report` 에 있던 [Top 사용자]·[AREA별]·[노드별 토큰] 세 섹션이 사라진 이유가 이것이다.
//
// ⚠️ 라벨은 **화면과 같은 것을 쓴다** — 기능 코드는 `actionLabel`, 실패 사유는 서버가
//    붙여 준 `topErrors[].label`(코드 아님). 화면과 복사본의 표기가 갈리면 안 된다.
// ─────────────────────────────────────────────────────────────────────────────

import { DailyRow } from "@/components/DailyTable";
import { InsightsResponse } from "./types";

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const RULE = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

function ratio(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "—";
}

/** ms → 사람이 읽는 소요시간. TokenLatencyChart 의 fmtDuration 과 같은 규칙. */
function duration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** "08/24 (월)" — 일별 현황 표와 같은 표기 */
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
  /** 화면 우측 `ins-range` 와 같은 구간 문구 */
  rangeLabel: string;
  /** 화면의 일별 현황 표와 **같은 행**을 넘긴다 (mergeDailyRows 결과) */
  dailyRows: DailyRow[];
  /** 기능(ACTION_TYP) 코드 → 화면 표기 */
  actionLabel: (key: string) => string;
}

/** 실적 화면의 내용을 보고용 플레인 텍스트로. */
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

  // ── ① 업무 실적 ──────────────────────────────────────────────
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

  // 하루짜리 조회에선 위 합계와 동어반복이라 싣지 않는다 (화면의 일별 표와 같은 규칙).
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
    // label 은 서버가 붙인 사유 설명이다. 설명이 없으면 label 이 곧 코드라 중복 병기하지 않는다.
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

  // ── ② AI 운영 현황 ───────────────────────────────────────────
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
    // ⚠️ available=false 는 "0 건" 이 아니라 "아직 적재 전" 이다. 0 으로 적으면
    //    "문제 없음" 으로 오독되므로 문구를 구분한다.
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
