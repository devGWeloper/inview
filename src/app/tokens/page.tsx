"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TokenChart } from "@/components/TokenChart";
import { TokenLatencyChart, fmtDuration } from "@/components/TokenLatencyChart";
import { TokenBreakdown } from "@/components/TokenBreakdown";
import { TokenStatsCards } from "@/components/TokenStatsCards";
import { QuestionsTable } from "@/components/QuestionsTable";
import { TopList } from "@/components/TopList";
import { TickMonitor, TickWindowMin } from "@/components/TickMonitor";
import { TickStatsResponse, TokenFilter, TokenRow, TokenStatsResponse } from "@/lib/types";
import { apiJson, asArray, errMessage } from "@/lib/apiClient";
import { useAgentScope } from "@/components/agents/AgentScopeProvider";

// "1tick" 은 다른 프리셋과 성격이 다르다 — 기간을 고르는 게 아니라 화면 자체를
// 분당 TPM/RPM 모니터로 바꾼다(격자도 응답 형태도 다르므로 /api/tokens/tick 을 쓴다).
type Preset = "1h" | "6h" | "24h" | "7d" | "30d" | "custom" | "1tick";

const PRESETS: { key: Preset; label: string; hours: number }[] = [
  { key: "1h",  label: "1H",  hours: 1   },
  { key: "6h",  label: "6H",  hours: 6   },
  { key: "24h", label: "24H", hours: 24  },
  { key: "7d",  label: "7D",  hours: 168 },
  { key: "30d", label: "30D", hours: 720 },
];

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 초까지 살린 로컬 시각 문자열.
 * ⚠️ 1TICK 은 toLocalInput(분 정밀) + ":00" 를 쓰면 안 된다 — 현재 분이 통째로 잘려
 *    방금 난 버스트가 화면에 안 잡힌다.
 */
function toLocalSec(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtRange(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return `${from.replace("T", " ").slice(0, 16)}  →  ${to.replace("T", " ").slice(0, 16)}`;
}

export default function TokensPage() {
  const { agentId, agent, isDefault, ready } = useAgentScope();
  const [preset, setPreset] = useState<Preset>("30d");
  const [userId, setUserId] = useState("");
  const [nodeNm, setNodeNm] = useState("");
  const [modelNm, setModelNm] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [stats, setStats] = useState<TokenStatsResponse | null>(null);
  // 1TICK 모니터 전용 상태 (창 길이 / 자동 새로고침 / 응답 (한도는 config 의 agents[] 에서 온다))
  const [tickWin, setTickWin] = useState<TickWindowMin>(60);
  const [tickAuto, setTickAuto] = useState(false);
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
    const base: TokenFilter = {
      userId: userId || undefined,
      nodeNm: nodeNm || undefined,
      modelNm: modelNm || undefined,
    };
    if (preset === "custom") {
      return { ...base, dateFrom: customFrom || undefined, dateTo: customTo || undefined };
    }
    const p = PRESETS.find((x) => x.key === preset)!;
    const now = Date.now();
    return {
      ...base,
      dateFrom: toLocalInput(now - p.hours * 3_600_000) + ":00",
      dateTo: toLocalInput(now) + ":00",
    };
  }, [preset, customFrom, customTo, userId, nodeNm, modelNm]);

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

  // 1TICK 조회 — 창 길이(분)만큼 "지금까지" 를 초 정밀로 잡아 /api/tokens/tick 을 부른다.
  // over 로 방금 바뀐 필터 값을 넘길 수 있다(상태 반영 전 클릭/선택 대응).
  const loadTick = useCallback(
    async (win: TickWindowMin, over?: { userId?: string; nodeNm?: string; modelNm?: string }) => {
      const requestFor = agentId;
      setLoading(true);
      setErr(null);
      try {
        const now = Date.now();
        const q = new URLSearchParams({
          dateFrom: toLocalSec(now - win * 60_000),
          dateTo: toLocalSec(now),
        });
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
      } catch (e) {
        if (agentIdRef.current !== requestFor) return;
        setErr(errMessage(e, "1TICK 모니터를 불러오지 못했습니다."));
        setTick(null);
      } finally {
        if (agentIdRef.current === requestFor) setLoading(false);
      }
    },
    [userId, nodeNm, modelNm, agentId]
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
    if (!ready) return;
    setUserId("");
    setNodeNm("");
    setModelNm("");
    setNodeOptions([]);
    setModelOptions([]);
    setStats(null);
    setTick(null);
    if (preset === "1tick") {
      loadTick(tickWin, { userId: undefined, nodeNm: undefined, modelNm: undefined });
    } else {
      load({ ...computeFilter(), userId: undefined, nodeNm: undefined, modelNm: undefined });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ready, agentId]);

  // 자동 새로고침 (1TICK 모드에서만). 창이 계속 앞으로 밀리므로 매번 새로 계산해 부른다.
  useEffect(() => {
    if (preset !== "1tick" || !tickAuto) return;
    const id = setInterval(() => loadTick(tickWin), 30_000);
    return () => clearInterval(id);
  }, [preset, tickAuto, tickWin, loadTick]);

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

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (preset === "1tick") loadTick(tickWin);
    else load(computeFilter());
  };

  const onPresetClick = (k: Preset) => {
    setPreset(k);
    if (k === "1tick") {
      loadTick(tickWin);
      return;
    }
    if (k !== "custom") {
      const p = PRESETS.find((x) => x.key === k)!;
      const now = Date.now();
      load({
        dateFrom: toLocalInput(now - p.hours * 3_600_000) + ":00",
        dateTo: toLocalInput(now) + ":00",
        userId: userId || undefined,
        nodeNm: nodeNm || undefined,
        modelNm: modelNm || undefined,
      });
    }
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
    if (preset === "1tick") loadTick(tickWin, over);
    else load({ ...computeFilter(), ...over });
  };

  const onTickWin = (w: TickWindowMin) => {
    setTickWin(w);
    loadTick(w);
  };

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
            {preset === "1tick"
              ? tick ? fmtRange(tick.range.from, tick.range.to) : "—"
              : stats ? fmtRange(stats.range.from, stats.range.to) : "—"}
            <span className="dash-title-note">
              {preset === "1tick" ? " · TPM/RPM" : " · LLM 호출 기준"}
              {!isDefault && agent ? ` · ${agent.name}` : ""}
            </span>
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
              className={"preset-btn tick" + (preset === "1tick" ? " active" : "")}
              onClick={() => onPresetClick("1tick")}
              title="분당 TPM/RPM 모니터"
            >
              1TICK
            </button>
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

      {preset === "1tick" && tick && (
        <TickMonitor
          stats={tick}
          tpmLimit={agent?.tpmLimit ?? 0}
          rpmLimit={agent?.rpmLimit ?? 0}
          windowMin={tickWin}
          onWindowMin={onTickWin}
          auto={tickAuto}
          onAuto={setTickAuto}
          loading={loading}
          onRefresh={() => loadTick(tickWin)}
        />
      )}

      {preset !== "1tick" && stats && (
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
