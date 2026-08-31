"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TokenChart } from "@/components/TokenChart";
import { TokenLatencyChart, fmtDuration } from "@/components/TokenLatencyChart";
import { TokenBreakdown } from "@/components/TokenBreakdown";
import { TokenStatsCards } from "@/components/TokenStatsCards";
import { QuestionsTable } from "@/components/QuestionsTable";
import { TopList } from "@/components/TopList";
import { TICK_WINDOWS, TickMode, TickMonitor, TickWindowMin } from "@/components/TickMonitor";
import { TickStatsResponse, TokenFilter, TokenRow, TokenStatsResponse } from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { useAgentScope } from "@/components/agents/AgentScopeProvider";
import {
  CUSTOM_LABEL,
  RANGE_PRESETS,
  RangePreset,
  resolveRange,
  toLocalMin,
  toLocalSec,
  useTimeRange,
} from "@/components/TimeRangeProvider";

// 조회 기간(프리셋/직접 설정)은 Timeout 탭과 **공유**한다 — TimeRangeProvider 참고.
// 여기에 프리셋 배열이나 기간 state 를 다시 두지 말 것(두 탭의 구성이 또 갈린다).
//
// 1TICK 만은 공유 대상이 아니다 — 기간을 고르는 게 아니라 화면 자체를 분당 TPM/RPM
// 모니터로 바꾸는 **화면 모드**이고(격자도 응답 형태도 달라 /api/tokens/tick 을 쓴다)
// Timeout 탭에는 대응물이 없다. 대신 "탭을 옮기면 지워진다" 는 같은 불편이 없도록
// 1TICK 의 창 길이·모드·구간은 아래 TICK_STORAGE_KEY 로 이 화면 안에서 보존한다.
//
// ⚠️ 1TICK 의 시각은 toLocalMin(분 정밀) + ":00" 을 쓰면 안 된다 — 현재 분이 통째로 잘려
//    방금 난 버스트가 화면에 안 잡힌다. toLocalSec(초 정밀)을 쓴다.

const TICK_STORAGE_KEY = "tracex.tick";

/**
 * 1TICK 이 조회할 구간.
 *   live   — 지금까지 N분 (창이 계속 앞으로 밀린다)
 *   custom — 사용자가 찍은 고정 구간. **과거 이력을 보는 유일한 경로**다.
 */
type TickReq =
  | { mode: "live"; win: TickWindowMin }
  | { mode: "custom"; from: string; to: string };

/**
 * datetime-local 값('YYYY-MM-DDTHH:MM')에 초를 채운다.
 * 끝 시각엔 ':59' 를 붙여 **그 분을 통째로 포함**시킨다 — 분 격자 화면에서 마지막 칸이
 * 조건상 잘려 비어 보이는 걸 막는다.
 */
function withSec(v: string, sec: "00" | "59"): string {
  return v.length === 16 ? `${v}:${sec}` : v;
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
  /** 1TICK 화면 모드인가 (기간 프리셋이 아니라 화면 전환이라 공유하지 않는다) */
  const [tickView, setTickView] = useState(false);

  const [stats, setStats] = useState<TokenStatsResponse | null>(null);
  // 1TICK 모니터 전용 상태 (창 길이 / 자동 새로고침 / 응답 (한도는 config 의 agents[] 에서 온다))
  const [tickWin, setTickWin] = useState<TickWindowMin>(60);
  const [tickMode, setTickMode] = useState<TickMode>("live");
  const [tickFrom, setTickFrom] = useState("");
  const [tickTo, setTickTo] = useState("");
  // 서버가 24시간(TICK_MAX_MINUTES)으로 잘랐는지 — 잘린 걸 안 알리면 앞 구간이
  // "그 시간엔 호출이 없었다" 로 오독된다.
  const [tickClamped, setTickClamped] = useState(false);
  const [tickAuto, setTickAuto] = useState(false);
  // localStorage 의 1TICK 상태 복원이 끝났는가 — 복원 전에 조회하면 기본값으로 한 번,
  // 복원값으로 한 번 이중 조회가 된다.
  const [tickReady, setTickReady] = useState(false);
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

  // 1TICK 조회 — live 면 창 길이(분)만큼 "지금까지" 를 초 정밀로, custom 이면 지정한 구간 그대로.
  // over 로 방금 바뀐 필터 값을 넘길 수 있다(상태 반영 전 클릭/선택 대응).
  const loadTick = useCallback(
    async (req: TickReq, over?: { userId?: string; nodeNm?: string; modelNm?: string }) => {
      const requestFor = agentId;
      setLoading(true);
      setErr(null);
      try {
        let dateFrom: string;
        let dateTo: string;
        if (req.mode === "live") {
          const now = Date.now();
          dateFrom = toLocalSec(now - req.win * 60_000);
          dateTo = toLocalSec(now);
        } else {
          dateFrom = withSec(req.from, "00");
          dateTo = withSec(req.to, "59");
        }
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
        setErr(errMessage(e, "1TICK 모니터를 불러오지 못했습니다."));
        setTick(null);
        setTickClamped(false);
      } finally {
        if (agentIdRef.current === requestFor) setLoading(false);
      }
    },
    [userId, nodeNm, modelNm, agentId]
  );

  /** 지금 화면이 보고 있는 1TICK 구간 (필터 변경·에이전트 전환 재조회가 모드를 잃지 않도록) */
  const tickReq = useCallback(
    (): TickReq =>
      tickMode === "custom" && tickFrom && tickTo
        ? { mode: "custom", from: tickFrom, to: tickTo }
        : { mode: "live", win: tickWin },
    [tickMode, tickFrom, tickTo, tickWin]
  );

  /** custom 모드 입력 검증. 통과하면 null, 아니면 사용자에게 보일 사유. */
  const tickRangeError = (): string | null => {
    if (tickMode !== "custom") return null;
    if (!tickFrom || !tickTo) return "시작·끝 시각을 모두 입력하세요.";
    if (Date.parse(tickFrom) >= Date.parse(tickTo)) return "시작 시각이 끝 시각보다 앞서야 합니다.";
    return null;
  };

  /**
   * 1TICK 재조회 — 화면의 모든 1TICK 조회(조회 버튼 / 새로고침 / 필터 변경 / 직접 설정)는
   * 이 한 곳을 지난다. 검증과 "현재 모드 유지" 를 한 군데로 모으기 위한 것이다.
   */
  const submitTick = (over?: { userId?: string; nodeNm?: string; modelNm?: string }) => {
    const bad = tickRangeError();
    if (bad) {
      setErr(bad);
      return;
    }
    loadTick(tickReq(), over);
  };

  // 최초 조회 + 에이전트 전환 시 재조회. ready 이전에는 agentId 가 비어 있어 조회하지 않는다.
  // ⚠️ 에이전트가 바뀌면 필터(NODE/MODEL/USER)·드롭다운 옵션·렌더된 데이터를 모두 비운다:
  //    - 필터를 안 비우면 이전 에이전트에서만 유효하던 값이 새 에이전트에 그대로 걸려
  //      "이 에이전트는 사용량이 없다" 로 오독된다(Fix 3).
  //    - 데이터를 안 비우면 새 이름이 붙은 헤더 아래 이전 에이전트의 수치가 잠깐이라도
  //      그대로 남아 보인다(Fix 2) — "집계 중…" 배너만으론 부족하다.
  //    setUserId 등은 상태 갱신이 비동기라 이번 tick 의 필터 인자엔 반영되지 않으므로
  //    load/loadTick 에는 override 로 명시해서 넘긴다.
  useEffect(() => {
    if (!ready || !rangeReady || !tickReady) return;
    setUserId("");
    setNodeNm("");
    setModelNm("");
    setNodeOptions([]);
    setModelOptions([]);
    setStats(null);
    setTick(null);
    if (tickView) {
      loadTick(tickReq(), { userId: undefined, nodeNm: undefined, modelNm: undefined });
    } else {
      load({ ...computeFilter(), userId: undefined, nodeNm: undefined, modelNm: undefined });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ready, rangeReady, tickReady, agentId]);

  // 1TICK 상태 복원 — 탭을 옮겼다 돌아와도 창 길이·직접 설정 구간이 그대로 남는다.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TICK_STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as Partial<{
          view: boolean; win: TickWindowMin; mode: TickMode; from: string; to: string;
        }>;
        if (TICK_WINDOWS.includes(v.win as TickWindowMin)) setTickWin(v.win as TickWindowMin);
        if (v.mode === "live" || v.mode === "custom") setTickMode(v.mode);
        if (typeof v.from === "string") setTickFrom(v.from);
        if (typeof v.to === "string") setTickTo(v.to);
        // custom 인데 구간이 비어 있으면 조회가 불가능하다 — live 로 되돌린다.
        if (v.mode === "custom" && !(v.from && v.to)) setTickMode("live");
        if (v.view === true) setTickView(true);
      }
    } catch {
      /* 복원 실패는 무해 — 기본값(live 60분)으로 시작한다 */
    }
    setTickReady(true);
  }, []);

  // 1TICK 상태 저장. 복원 전에 쓰면 기본값이 저장값을 덮어쓴다.
  useEffect(() => {
    if (!tickReady) return;
    try {
      window.localStorage.setItem(
        TICK_STORAGE_KEY,
        JSON.stringify({ view: tickView, win: tickWin, mode: tickMode, from: tickFrom, to: tickTo })
      );
    } catch {
      /* 저장 실패(프라이빗 모드 등)는 무해 */
    }
  }, [tickReady, tickView, tickWin, tickMode, tickFrom, tickTo]);

  // 직접 설정 초안은 공유된 값으로 채워 둔다 — 탭을 옮겼다 와도 다시 입력할 필요가 없다.
  useEffect(() => {
    if (sel.preset === "custom" && sel.customFrom && sel.customTo) {
      setCustomFrom(sel.customFrom);
      setCustomTo(sel.customTo);
    }
  }, [sel.preset, sel.customFrom, sel.customTo]);

  // 자동 새로고침 (1TICK 의 live 모드에서만). 창이 계속 앞으로 밀리므로 매번 새로 계산해 부른다.
  // ⚠️ custom 에서는 돌리지 않는다 — 고정된 과거 구간을 다시 부를 이유가 없고,
  //    라이브 갱신은 '지금' 으로 창을 다시 잡아 사용자가 지정한 구간을 덮어쓴다.
  useEffect(() => {
    if (!tickView || tickMode !== "live" || !tickAuto) return;
    const id = setInterval(() => loadTick({ mode: "live", win: tickWin }), 30_000);
    return () => clearInterval(id);
  }, [tickView, tickMode, tickAuto, tickWin, loadTick]);

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

  const onTickClick = () => {
    setTickView(true);
    setDraftCustom(false);
    submitTick();
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

  const onTickWin = (w: TickWindowMin) => {
    setTickMode("live");
    setTickWin(w);
    loadTick({ mode: "live", win: w });
  };

  /** '직접 설정' 진입 — 현재 라이브 창을 초깃값으로 채워만 두고, 조회는 사용자가 누를 때 한다. */
  const onTickCustomMode = () => {
    setTickMode("custom");
    if (!tickFrom || !tickTo) {
      const now = Date.now();
      setTickFrom(toLocalMin(now - tickWin * 60_000));
      setTickTo(toLocalMin(now));
    }
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
          <div className="preset-group" role="tablist" aria-label="time preset">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={"preset-btn" + (!tickView && !customOpen && sel.preset === p.key ? " active" : "")}
                onClick={() => onPresetClick(p.key)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={"preset-btn tick" + (tickView ? " active" : "")}
              onClick={onTickClick}
              title="분당 TPM/RPM 모니터"
            >
              1TICK
            </button>
            <button
              type="button"
              className={"preset-btn" + (!tickView && customOpen ? " active" : "")}
              onClick={onCustomClick}
            >
              {CUSTOM_LABEL}
            </button>
          </div>
          {!tickView && customOpen && (
            <div className="custom-range">
              <input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="from" />
              <span className="range-arrow">→</span>
              <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="to" />
            </div>
          )}
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
          <button type="submit" className="btn primary">조회</button>
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
          tpmLimit={agent?.tpmLimit ?? 0}
          rpmLimit={agent?.rpmLimit ?? 0}
          mode={tickMode}
          windowMin={tickWin}
          onWindowMin={onTickWin}
          customFrom={tickFrom}
          customTo={tickTo}
          onCustomFrom={setTickFrom}
          onCustomTo={setTickTo}
          onCustomMode={onTickCustomMode}
          onCustomSubmit={() => submitTick()}
          clamped={tickClamped}
          auto={tickAuto}
          onAuto={setTickAuto}
          loading={loading}
          onRefresh={() => submitTick()}
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
