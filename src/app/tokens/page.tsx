"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TokenChart } from "@/components/TokenChart";
import { TokenLatencyChart, fmtDuration } from "@/components/TokenLatencyChart";
import { TokenBreakdown } from "@/components/TokenBreakdown";
import { TokenStatsCards } from "@/components/TokenStatsCards";
import { QuestionsTable } from "@/components/QuestionsTable";
import { TopList } from "@/components/TopList";
import { TickMonitor } from "@/components/TickMonitor";
import { TickMetricDef, TickStatsResponse, TokenFilter, TokenRow, TokenStatsResponse } from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { useAgentScope } from "@/components/agents/AgentScopeProvider";
import {
  CUSTOM_LABEL,
  RANGE_PRESETS,
  RangePreset,
  resolveRange,
  useTimeRange,
} from "@/components/TimeRangeProvider";
import {
  TickRange,
  resolveTickRange,
  tickRefreshMs,
  useTick,
  useTickView,
} from "@/components/tick/TickProvider";
import { TickActions, TickPresets } from "@/components/tick/TickToolbar";
import { analysisMinutesForTickWin, spanMinutes, tickSelFor } from "@/components/tick/rangeSync";
import { ViewToggle } from "@/components/tick/ViewToggle";

// 조회 기간(프리셋/직접 설정)은 Timeout 탭과 **공유**한다 — TimeRangeProvider 참고.
// 여기에 프리셋 배열이나 기간 state 를 다시 두지 말 것(두 탭의 구성이 또 갈린다).
//
// 틱 뷰는 기간이 아니라 **보기 자체**를 바꾸는 조작이라 ViewToggle 이 담당하고,
// 조회 창(길이·직접 설정·자동 갱신)은 TickProvider 가 Dashboard/Timeout 과 공유한다.
// 뷰 on/off 만 화면별로 기억한다(useTickView) — 대시보드를 틱으로 띄워 두고 여기는
// 기간 분석으로 보는 조합이 정상이기 때문이다.

/**
 * 틱 뷰의 게이지/차트 정의.
 * ⚠️ 한도는 프로필과 config.yml 을 병합한 /api/agents 값(= agent.tpmLimit/rpmLimit)이다 —
 *    서버 집계는 그 병합을 모르므로 화면에서 붙인다.
 */
function tokenMetrics(tpmLimit: number, rpmLimit: number): [TickMetricDef, TickMetricDef] {
  return [
    { name: "TPM", unitText: "토큰/분", unit: "토큰", limit: tpmLimit },
    { name: "RPM", unitText: "호출/분", unit: "호출", limit: rpmLimit },
  ];
}

function fmtRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return `${from.replace("T", " ").slice(0, 16)}  →  ${to.replace("T", " ").slice(0, 16)}`;
}

export default function TokensPage() {
  const { agentId, agent, isDefault, ready } = useAgentScope();
  const { sel, ready: rangeReady, setPreset, setCustom } = useTimeRange();
  const [userId, setUserId] = useState("");
  const [nodeNm, setNodeNm] = useState("");
  const [modelNm, setModelNm] = useState("");
  // 직접 설정 입력은 로컬 초안이고 '조회' 를 눌렀을 때 공유 상태에 커밋된다.
  // draftCustom = 패널만 열린 상태(아직 적용 전).
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [draftCustom, setDraftCustom] = useState(false);
  /** 틱 뷰인가 (화면별로 기억 — 공유 상태가 아니다) */
  const [tickView, setTickView, tickViewReady] = useTickView("tokens");
  // 틱 조회 창(길이/모드/구간/자동)은 Dashboard·Timeout 과 공유한다.
  const { sel: tickSel, ready: tickReady, resolve: resolveTick, apply: applyTick } = useTick();

  const [stats, setStats] = useState<TokenStatsResponse | null>(null);
  // 서버가 24시간(TICK_MAX_MINUTES)으로 잘랐는지 — 잘린 걸 안 알리면 앞 구간이
  // "그 시간엔 호출이 없었다" 로 오독된다.
  const [tickClamped, setTickClamped] = useState(false);
  const [tick, setTick] = useState<TickStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 셀렉트 옵션은 첫 응답의 byNode/byModel 에서 도출(필터로 좁혀져도 옵션은 유지)
  const [nodeOptions, setNodeOptions] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  // 응답 도착 시점의 "현재 선택된 에이전트" 를 읽기 위한 ref. state 는 비동기라 클로저에 갇힌
  // 값(요청을 보낼 때의 agentId)과 다를 수 있다 — 응답이 늦게 도착했을 때 그 사이 에이전트가
  // 바뀌었는지는 이 ref 로만 정확히 판정된다.
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  const computeFilter = useCallback((): TokenFilter => {
    // 프리셋은 항상 '지금' 기준이라 호출 시점에 푼다 (TimeRangeProvider.resolveRange 참고)
    const r = resolveRange(sel);
    return {
      userId: userId || undefined,
      nodeNm: nodeNm || undefined,
      modelNm: modelNm || undefined,
      dateFrom: r.from,
      dateTo: r.to,
    };
  }, [sel, userId, nodeNm, modelNm]);

  const load = useCallback(async (f: TokenFilter) => {
    const requestFor = agentId; // 이 요청이 향한 에이전트 (응답 도착 시점의 선택과 비교할 기준)
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams();
      if (agentId) q.set("agent", agentId);
      if (f.dateFrom) q.set("dateFrom", f.dateFrom);
      if (f.dateTo) q.set("dateTo", f.dateTo);
      if (f.userId) q.set("userId", f.userId);
      if (f.nodeNm) q.set("nodeNm", f.nodeNm);
      if (f.modelNm) q.set("modelNm", f.modelNm);
      const data = await apiJson<TokenStatsResponse>(`/api/tokens?${q.toString()}`, { cache: "no-store" });
      // ⚠️ 응답이 도착했을 때 이미 다른 에이전트로 전환돼 있으면 폐기한다 — 그대로 반영하면
      //    방금 바뀐 이름 아래 이전 에이전트의 수치가 얹히는 오귀속이 된다. 서버가 echo 한
      //    agentId 로 판정한다 (스펙 §3).
      //    ⚠️ 양쪽 다 "모름" 은 불일치가 아니라 통과다 — data.agentId 가 없으면(구버전 라우트가
      //    echo 를 안 하는 경우) 이 요청이 향했던 agentId(requestFor)로 대신 채우고,
      //    agentIdRef.current 자체가 비어 있으면(/api/agents 조회 실패로 agentId="" 인 상태)
      //    비교할 "현재 선택"이 없으니 무조건 통과시킨다. 엄격 비교만 쓰면 이 두 경우에
      //    매번 폐기돼 화면이 설명 없이 빈다 — 고치려던 버그보다 더 나쁜 회귀였다.
      const echoed = data.agentId ?? requestFor;
      if (agentIdRef.current && echoed !== agentIdRef.current) return;
      setStats(data);
      // 옵션 누적: 현재 응답의 차원 키를 합집합으로 유지 ('(none)' 제외)
      setNodeOptions((prev) => unionKeys(prev, asArray<{ key: string }>(data.byNode).map((d) => d.key)));
      setModelOptions((prev) => unionKeys(prev, asArray<{ key: string }>(data.byModel).map((d) => d.key)));
    } catch (e) {
      if (agentIdRef.current !== requestFor) return; // 이미 전환된 뒤의 실패는 화면에 반영하지 않는다
      setErr(errMessage(e, "토큰 통계를 불러오지 못했습니다."));
      setStats(null);
    } finally {
      // 최신 선택을 향한 요청일 때만 로딩을 내린다 — 아니면 전환 직후 새로 나간 요청이
      // 아직 진행 중인데 배너가 먼저 꺼지는 깜빡임이 생긴다.
      if (agentIdRef.current === requestFor) setLoading(false);
    }
  }, [agentId]);

  // 틱 조회 — 구간은 호출부가 resolveTickRange 로 풀어서 넘긴다(창은 '지금' 기준이라
  // 상태에 굳혀 두면 안 된다). over 로 방금 바뀐 필터 값을 넘길 수 있다.
  const loadTick = useCallback(
    async (range: TickRange, over?: { userId?: string; nodeNm?: string; modelNm?: string }) => {
      const requestFor = agentId;
      setLoading(true);
      setErr(null);
      try {
        const dateFrom = range.from;
        const dateTo = range.to;
        const q = new URLSearchParams({ dateFrom, dateTo });
        if (agentId) q.set("agent", agentId);
        const u = over && "userId" in over ? over.userId : userId;
        const n = over && "nodeNm" in over ? over.nodeNm : nodeNm;
        const m = over && "modelNm" in over ? over.modelNm : modelNm;
        if (u) q.set("userId", u);
        if (n) q.set("nodeNm", n);
        if (m) q.set("modelNm", m);
        const data = await apiJson<TickStatsResponse>(`/api/tokens/tick?${q.toString()}`, { cache: "no-store" });
        // ⚠️ /api/tokens 의 load() 와 동일 — 응답 도착 시점에 이미 다른 에이전트로 전환됐으면 폐기.
        //    단, 양쪽 다 "모름" 은 통과 (data.agentId 없으면 requestFor 로 대체, 현재 선택
        //    자체가 비어 있으면 무조건 통과) — 엄격 비교만 쓰면 /api/agents 조회 실패나 구버전
        //    응답에서 화면이 설명 없이 계속 빈다.
        const echoed = data.agentId ?? requestFor;
        if (agentIdRef.current && echoed !== agentIdRef.current) return;
        setTick(data);
        // 요청한 시작 시각보다 응답의 시작이 뒤면 서버가 24시간으로 자른 것이다.
        // (1분 여유 — 초 정규화 차이를 잘림으로 오인하지 않도록)
        const want = Date.parse(dateFrom);
        const got = data.range.from ? Date.parse(data.range.from) : NaN;
        setTickClamped(Number.isFinite(want) && Number.isFinite(got) && got - want > 60_000);
      } catch (e) {
        if (agentIdRef.current !== requestFor) return;
        setErr(errMessage(e, "틱 조회를 불러오지 못했습니다."));
        setTick(null);
        setTickClamped(false);
      } finally {
        if (agentIdRef.current === requestFor) setLoading(false);
      }
    },
    [userId, nodeNm, modelNm, agentId]
  );

  /**
   * 틱 재조회 — 화면의 모든 틱 조회(툴바 / 필터 변경 / 에이전트 전환 / 자동 갱신)는
   * 이 한 곳을 지난다. "현재 창을 호출 시점에 다시 푼다" 를 한 군데로 모으기 위한 것이다.
   */
  const submitTick = useCallback(
    (over?: { userId?: string; nodeNm?: string; modelNm?: string }) => {
      loadTick(resolveTick(), over);
    },
    [loadTick, resolveTick]
  );

  // 최초 조회 + 에이전트 전환 시 재조회. ready 이전에는 agentId 가 비어 있어 조회하지 않는다.
  // ⚠️ 에이전트가 바뀌면 필터(NODE/MODEL/USER)·드롭다운 옵션·렌더된 데이터를 모두 비운다:
  //    - 필터를 안 비우면 이전 에이전트에서만 유효하던 값이 새 에이전트에 그대로 걸려
  //      "이 에이전트는 사용량이 없다" 로 오독된다(Fix 3).
  //    - 데이터를 안 비우면 새 이름이 붙은 헤더 아래 이전 에이전트의 수치가 잠깐이라도
  //      그대로 남아 보인다(Fix 2) — "집계 중…" 배너만으론 부족하다.
  //    setUserId 등은 상태 갱신이 비동기라 이번 tick 의 필터 인자엔 반영되지 않으므로
  //    load/loadTick 에는 override 로 명시해서 넘긴다.
  useEffect(() => {
    if (!ready || !rangeReady || !tickReady || !tickViewReady) return;
    setUserId("");
    setNodeNm("");
    setModelNm("");
    setNodeOptions([]);
    setModelOptions([]);
    setStats(null);
    setTick(null);
    if (tickView) {
      submitTick({ userId: undefined, nodeNm: undefined, modelNm: undefined });
    } else {
      load({ ...computeFilter(), userId: undefined, nodeNm: undefined, modelNm: undefined });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ready, rangeReady, tickReady, tickViewReady, agentId]);

  // 직접 설정 초안은 공유된 값으로 채워 둔다 — 탭을 옮겼다 와도 다시 입력할 필요가 없다.
  useEffect(() => {
    if (sel.preset === "custom" && sel.customFrom && sel.customTo) {
      setCustomFrom(sel.customFrom);
      setCustomTo(sel.customTo);
    }
  }, [sel.preset, sel.customFrom, sel.customTo]);

  // 자동 갱신 (틱 뷰의 live 모드에서만). 창이 계속 앞으로 밀리므로 매번 새로 계산해 부른다.
  // ⚠️ custom 에서는 돌리지 않는다 — 고정된 과거 구간을 다시 부를 이유가 없고,
  //    라이브 갱신은 '지금' 으로 창을 다시 잡아 사용자가 지정한 구간을 덮어쓴다.
  // 주기는 창 길이에 맞춘다(tickRefreshMs) — 1분 창을 30초마다 갱신하면 반쯤 죽어 보인다.
  useEffect(() => {
    if (!tickView || tickSel.mode !== "live" || !tickSel.auto) return;
    const id = setInterval(() => loadTick(resolveTickRange(tickSel)), tickRefreshMs(tickSel.win));
    return () => clearInterval(id);
  }, [tickView, tickSel, loadTick]);

  // 질문 행 펼침: traceId 로만 그 질문의 호출별 행을 가져온다.
  // 화면 필터(기간/노드/모델)를 같이 보내지 않는 이유: 한 질문을 펼치면 그 질문이 거친 호출
  // 전부가 보여야 한다. 특히 프리셋 기간은 호출 시점의 Date.now() 로 계산되므로, 같이 보내면
  // 화면을 띄운 뒤 시간이 흐른 만큼 창이 밀려 같은 질문의 호출이 잘려 보였다.
  const fetchCalls = useCallback(async (traceId: string): Promise<TokenRow[]> => {
    const query = new URLSearchParams({ traceId });
    if (agentId) query.set("agent", agentId);
    const data = await apiJson<TokenStatsResponse>(`/api/tokens?${query.toString()}`, { cache: "no-store" });
    return asArray<TokenRow>(data.calls);
  }, [agentId]);

  /**
   * '조회' — 직접 설정 패널이 열려 있으면 초안을 공유 상태에 커밋하고 그 구간으로 조회한다.
   * (초안 커밋 지점은 여기 한 곳뿐이다 — 입력할 때마다 커밋하면 옆 탭까지 반쯤 입력된
   *  구간으로 흔들린다.)
   */
  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (tickView) {
      submitTick();
      return;
    }

    if (draftCustom) {
      if (!customFrom || !customTo) {
        setErr("시작·끝 시각을 모두 입력하세요.");
        return;
      }
      setCustom(customFrom, customTo);
      setDraftCustom(false);
      // ⚠️ resolveRange 는 {from,to} 이고 TokenFilter 는 {dateFrom,dateTo} 다 — 펼쳐 넣지 말 것.
      //    둘 다 옵셔널이라 타입 검사에 안 걸리고, 기간이 조용히 빠져 서버 기본(24h)으로 조회된다.
      const r = resolveRange({ preset: "custom", customFrom, customTo });
      load({
        dateFrom: r.from,
        dateTo: r.to,
        userId: userId || undefined,
        nodeNm: nodeNm || undefined,
        modelNm: modelNm || undefined,
      });
      return;
    }
    load(computeFilter());
  };

  const onPresetClick = (k: RangePreset) => {
    // setPreset 은 비동기라 sel 이 아직 옛 값이다 — 방금 고른 프리셋으로 직접 풀어서 조회한다.
    const r = resolveRange({ ...sel, preset: k });
    setPreset(k);
    setDraftCustom(false);
    setTickView(false);
    load({
      dateFrom: r.from,
      dateTo: r.to,
      userId: userId || undefined,
      nodeNm: nodeNm || undefined,
      modelNm: modelNm || undefined,
    });
  };

  /**
   * 보기 전환. 켜는 즉시 조회한다 — 토글을 눌렀는데 빈 화면이 남아 있으면 켜진 건지 알 수 없다.
   *
   * ⚠️ **조회 구간을 서로 물려준다** (rangeSync.ts). 두 뷰의 구간 후보가 겹치지 않아 정확히
   *    같을 수는 없지만, 토글할 때마다 무관한 구간으로 튀면 매번 기간을 다시 골라야 한다.
   */
  const onView = (live: boolean) => {
    setTickView(live);
    setDraftCustom(false);
    if (live) {
      const cur = sel.preset === "custom" && sel.customFrom && sel.customTo
        ? { from: sel.customFrom, to: sel.customTo }
        : null;
      const mins = cur
        ? spanMinutes(cur.from, cur.to) ?? 60
        : (RANGE_PRESETS.find((p) => p.key === sel.preset) ?? RANGE_PRESETS[0]).hours * 60;
      applyTick(tickSelFor(mins, cur));
      submitTick();
    } else {
      if (tickSel.mode === "custom" && tickSel.from && tickSel.to) {
        setCustom(tickSel.from, tickSel.to);
        const r = resolveRange({ preset: "custom", customFrom: tickSel.from, customTo: tickSel.to });
        load({
          dateFrom: r.from, dateTo: r.to,
          userId: userId || undefined, nodeNm: nodeNm || undefined, modelNm: modelNm || undefined,
        });
        return;
      }
      // 틱 창(≤180분)을 덮는 가장 짧은 집계 프리셋으로 옮긴다.
      const need = analysisMinutesForTickWin(tickSel.win);
      const p = RANGE_PRESETS.find((x) => x.hours * 60 >= need) ?? RANGE_PRESETS[0];
      setPreset(p.key);
      const r = resolveRange({ ...sel, preset: p.key });
      load({
        dateFrom: r.from, dateTo: r.to,
        userId: userId || undefined, nodeNm: nodeNm || undefined, modelNm: modelNm || undefined,
      });
    }
  };

  /** '직접 설정' 진입 — 초안만 채워 두고 조회는 '조회' 를 눌렀을 때 한다. */
  const onCustomClick = () => {
    setTickView(false);
    if (!customFrom || !customTo) {
      const r = resolveRange(sel);
      setCustomFrom(r.from.slice(0, 16));
      setCustomTo(r.to.slice(0, 16));
    }
    setDraftCustom(true);
  };

  const onSelectNode = (k: string) => {
    const next = nodeNm === k ? "" : k;
    setNodeNm(next);
    load({ ...computeFilter(), nodeNm: next || undefined });
  };

  const onSelectModel = (k: string) => {
    const next = modelNm === k ? "" : k;
    setModelNm(next);
    load({ ...computeFilter(), modelNm: next || undefined });
  };

  /** NODE/MODEL/USER 필터 변경 — 현재 모드에 맞는 쪽을 다시 조회한다 */
  const reloadWith = (over: { userId?: string; nodeNm?: string; modelNm?: string }) => {
    if (tickView) submitTick(over);
    else load({ ...computeFilter(), ...over });
  };


  const customOpen = draftCustom || sel.preset === "custom";
  const hasFilter = !!(userId || nodeNm || modelNm);
  const clearFilters = () => {
    setUserId("");
    setNodeNm("");
    setModelNm("");
    reloadWith({ userId: undefined, nodeNm: undefined, modelNm: undefined });
  };

  return (
    <div className="dash">
      <div className="dash-header">
        <div className="dash-title">
          <div className="dash-title-main">Token Usage</div>
          <div className="dash-title-sub">
            {tickView
              ? tick ? fmtRange(tick.range.from, tick.range.to) : "—"
              : stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
            <span className="dash-title-note">
              {tickView ? " · TPM/RPM" : " · LLM 호출 기준"}
              {!isDefault && agent ? ` · ${agent.name}` : ""}
            </span>
          </div>
        </div>
        <form className="dash-filter" onSubmit={onApply}>
          {/* ⚠️ 보기 전환은 기간 프리셋 줄 **밖**에 둔다 — 예전엔 줄 안의 1TICK 버튼이라
              기간을 고른 줄 알고 눌렀다가 화면이 통째로 바뀌는 일이 있었다. */}
          <ViewToggle
            live={tickView}
            onChange={onView}
            pulsing={tickSel.auto && tickSel.mode === "live"}
          />
          {/* 프리셋 줄 자리는 보기에 따라 통째로 교체된다 (두 줄을 같이 띄우지 않는다).
              ⚠️ .preset-slot 은 두 세트 중 넓은 쪽 폭을 확보한다 — 없으면 토글할 때마다
                 뒤따르는 USER/NODE/MODEL 이 좌우로 밀린다. */}
          <div className="preset-slot">
          {tickView ? (
            <TickPresets loading={loading} onSubmit={() => submitTick()} />
          ) : (
            <>
              <div className="preset-group" role="tablist" aria-label="time preset">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={"preset-btn" + (!customOpen && sel.preset === p.key ? " active" : "")}
                    onClick={() => onPresetClick(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={"preset-btn" + (customOpen ? " active" : "")}
                  onClick={onCustomClick}
                >
                  {CUSTOM_LABEL}
                </button>
              </div>
              {customOpen && (
                <div className="custom-range">
                  <input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="from" />
                  <span className="range-arrow">→</span>
                  <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="to" />
                </div>
              )}
            </>
          )}
          </div>
          <input
            type="text"
            className="user-input"
            placeholder="USER_ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <select
            className="user-input user-select"
            value={nodeNm}
            onChange={(e) => { const v = e.target.value; setNodeNm(v); reloadWith({ nodeNm: v || undefined }); }}
            aria-label="NODE"
          >
            <option value="">NODE (전체)</option>
            {nodeOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <select
            className="user-input user-select"
            value={modelNm}
            onChange={(e) => { const v = e.target.value; setModelNm(v); reloadWith({ modelNm: v || undefined }); }}
            aria-label="MODEL"
          >
            <option value="">MODEL (전체)</option>
            {modelOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          {hasFilter && (
            <button type="button" className="btn ghost" onClick={clearFilters}>필터 초기화</button>
          )}
          {/* 동작 버튼은 두 보기가 **같은 자리**를 쓴다 (조회 ↔ 새로고침) */}
          {tickView
            ? <TickActions loading={loading} onSubmit={() => submitTick()} />
            : <button type="submit" className="btn primary">조회</button>}
        </form>
      </div>

      {loading && <div className="dash-banner loading">집계 중…</div>}
      {err && <div className="dash-banner err">불러오기 실패: {err}</div>}
      {agent && !agent.dbConfigured && (
        <div className="dash-banner err">
          {/* config.yml 에 agents: 섹션이 없으면 config.ts 가 layers.GAIA 로 기본 에이전트 1개를
              합성한다 — 이 경우 고칠 곳은 "agents 항목"이 아니라 layers.GAIA 라 두 경우를 모두
              가리키는 문구로 안내한다. */}
          {agent.name} 의 DB 접속 정보가 설정되지 않았습니다 — config.yml 에서 agents 섹션이 있다면
          해당 에이전트의 db 항목을, 없다면 layers.GAIA 를 확인하세요.
          (빈 화면은 &ldquo;사용량 0&rdquo; 이 아닙니다)
        </div>
      )}

      {tickView && tick && (
        <TickMonitor
          stats={tick}
          metrics={tokenMetrics(agent?.tpmLimit ?? 0, agent?.rpmLimit ?? 0)}
          rowsLabel="호출"
          clamped={tickClamped}
          limitHref="/admin"
        />
      )}

      {!tickView && stats && (
        <>
          <TokenStatsCards stats={stats} />

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">토큰 사용 추이</span>
                <span className="dash-card-sub">input / output 적층 · {granText(stats.granularity)} 단위</span>
              </div>
              <div className="dash-card-aux">
                <span className="aux-pill">
                  <span className="aux-pill-key">총 토큰</span>
                  <span className="aux-pill-val">{stats.totals.totalTokens.toLocaleString()}</span>
                </span>
                <span className="aux-pill">
                  <span className="aux-pill-key">호출</span>
                  <span className="aux-pill-val">{stats.totals.calls.toLocaleString()}</span>
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <TokenChart stats={stats} />
            </div>
          </section>

          <section className="dash-card dash-card-hero">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">LLM 속도 추이</span>
                <span className="dash-card-sub">호출당 평균 소요시간 · {granText(stats.granularity)} 단위 · 어느 시점이 느렸는지</span>
              </div>
              <div className="dash-card-aux">
                <span className="aux-pill">
                  <span className="aux-pill-key">평균 속도</span>
                  <span className="aux-pill-val">{fmtDuration(stats.avgLatencyMs)}</span>
                </span>
              </div>
            </div>
            <div className="dash-card-body">
              <TokenLatencyChart stats={stats} />
            </div>
          </section>

          <TokenBreakdown
            stats={stats}
            emptyText="데이터 없음"
            onSelectNode={onSelectNode}
            onSelectModel={onSelectModel}
            selectedNode={nodeNm || undefined}
            selectedModel={modelNm || undefined}
          />

          <section className="dash-card">
            <div className="dash-card-head">
              <div className="dash-card-title-group">
                <span className="dash-card-title">질문별 토큰</span>
              </div>
            </div>
            <div className="dash-card-body">
              <QuestionsTable questions={stats.questions} onExpand={fetchCalls} />
            </div>
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Top 사용자</span>
              <span className="dash-card-sub">총 토큰 기준</span>
            </div>
            <div className="dash-card-body">
              <TopList items={stats.topUsers} totalForPct={stats.totals.totalTokens} emptyText="데이터 없음" tone="neutral" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function unionKeys(prev: string[], next: string[]): string[] {
  const set = new Set(prev);
  for (const k of next) if (k && k !== "(none)") set.add(k);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function granText(g: TokenStatsResponse["granularity"]): string {
  return g === "5m" ? "5분" : g === "1h" ? "시간" : "일";
}
