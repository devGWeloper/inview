import { NextRequest, NextResponse } from "next/server";
import { fetchAllRows } from "@/lib/db";
import {
  DailyStat,
  DimensionStats,
  LAYER_ORDER,
  LayerKey,
  ROUTING_FAIL_LABEL,
  StatsResponse,
  TimeBucket,
  TopItem,
  TraceFilter,
  TraceRow,
} from "@/lib/types";
import { logger, reqContext } from "@/lib/logger";
import { classifyPendingByCubeResp, matchedActionFailCodes } from "@/lib/tempStatus"; // TEMP: ONEOIS 미연결 대응
import { requireBiz } from "@/lib/auth/current";
import {
  enumerateBucketStarts,
  floorToBucket,
  isoNoTz,
  parseTs,
  pickGranularity,
} from "@/lib/timeBuckets";

export const dynamic = "force-dynamic";

// 대시보드 집계는 ERROR/FAIL 구분 없이 fail 로 통합한다 (트레이스 목록 쪽 classify 와 의도적으로 다름).
type DashStatus = "ok" | "fail" | "pending";

function classify(rows: TraceRow[], allComplete: boolean): DashStatus {
  const hasErr = rows.some((r) => !!r.errCd);
  // TEMP(ONEOIS 미연결): pending 대신 CUBE RESP 로 ok/fail 판정 — tempStatus.ts 참고
  if (!hasErr) {
    if (allComplete) return "ok";
    const t = classifyPendingByCubeResp(rows);
    return t === "ok" ? "ok" : "fail";
  }
  return "fail";
}

/**
 * 트레이스의 대표 사용자 — 진입 레이어(CUBE) 우선으로 첫 non-null USER_ID 를 고른다.
 * USER_ID 는 전 레이어가 INSERT 시 기록하므로 행 순서에 따라 하위 레이어 값(시스템 계정 등)이
 * 잡히면 사용자 수가 부풀 수 있다. 공백/빈 문자열도 정규화해 같은 사용자가 두 번 세어지지 않게 한다.
 * (uniqueUsers = 이 대표 사용자의 distinct 수 — 한 사용자가 100번 요청해도 1명)
 */
function traceUserId(list: TraceRow[]): string | null {
  for (const layer of LAYER_ORDER) {
    for (const r of list) {
      if (r.layer !== layer) continue;
      const u = r.userId?.trim();
      if (u) return u;
    }
  }
  return null;
}

function topN(map: Map<string, number>, n: number): TopItem[] {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

/** 액션 타입별 정렬: 실행수 desc. 단 '라우팅 실패'(표기 라벨, 실제 액션 아님)는 항상 맨 아래로 내려 실제 액션들과 구분. */
function sortActions<T extends { key: string; total: number }>(arr: T[]): T[] {
  return arr.sort((a, b) => {
    const ar = a.key === ROUTING_FAIL_LABEL ? 1 : 0;
    const br = b.key === ROUTING_FAIL_LABEL ? 1 : 0;
    if (ar !== br) return ar - br;
    return b.total - a.total;
  });
}

export async function GET(req: NextRequest) {
  // ⚠️ BIZ_AIACTIONTXN_HIS 는 기본 에이전트 전용이다. 다른 팀 에이전트 소속 계정은
  //    URL 을 직접 쳐도 여기서 끊는다 (미들웨어 리다이렉트는 UX, 권위는 이 판정).
  const bizGuard = await requireBiz();
  if (!bizGuard.ok) return NextResponse.json({ error: bizGuard.error }, { status: bizGuard.status });

  const t0 = Date.now();
  const ctx = reqContext(req);
  const sp = req.nextUrl.searchParams;

  const now = Date.now();
  const dateFrom = sp.get("dateFrom") || undefined;
  const dateTo = sp.get("dateTo") || undefined;
  const userId = sp.get("userId") || undefined;
  const actionTyp = sp.get("actionTyp") || undefined;

  // 집계 제외 에러 코드 (CSV). 해당 코드를 가진 trace 는 모든 집계에서 통째로 빠진다.
  const excludeErrCds = (sp.get("excludeErrCds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const excludeSet = new Set(excludeErrCds);

  // 기본: 최근 24시간
  const effectiveFromMs = dateFrom ? Date.parse(dateFrom) : now - 24 * 3_600_000;
  const effectiveToMs = dateTo ? Date.parse(dateTo) : now;

  // ⚠️ 집계용 필터: 날짜 범위만 SQL 로 내린다.
  //  - limit 없음 → db.ts 가 FETCH FIRST 를 안 붙여 기간 내 전체 행을 가져온다(집계는 다 봐야 함).
  //  - userId/actionTyp 는 일부 레이어에만 기록되는 컬럼이라 행 단위(per-layer) SQL 필터로 걸면
  //    해당 컬럼이 빈 다른 레이어 행이 통째로 빠져 트레이스가 깨진다. → 아래에서 트레이스 단위로 필터링한다.
  const filter: TraceFilter = {
    dateFrom: dateFrom ?? isoNoTz(effectiveFromMs),
    dateTo: dateTo ?? isoNoTz(effectiveToMs),
  };

  logger.info("GET /api/stats", { ...ctx, filter, userId, actionTyp, excludeErrCds });

  try {
    const rows = await fetchAllRows(filter);

    // ── 트레이스 단위 그룹핑
    const byTrace = new Map<string, TraceRow[]>();
    for (const r of rows) {
      if (!byTrace.has(r.traceId)) byTrace.set(r.traceId, []);
      byTrace.get(r.traceId)!.push(r);
    }

    // ── 트레이스 단위 필터 (userId/actionTyp)
    //   ACTION_TYP/USER_ID 는 일부 레이어 행에만 채워지므로, "트레이스 내 어느 한 행이라도 일치"하면
    //   그 트레이스의 전체 레이어 행을 유지한다. (행 단위로 거르면 다른 레이어 행이 사라져 FAC/AREA·
    //   레이어바·액션 실패(시즈닝/AutoQual 취소·실행) 판정이 모두 깨진다.)
    if (userId || actionTyp) {
      for (const [traceId, list] of byTrace) {
        const matchUser = !userId || list.some((r) => r.userId === userId);
        const matchAction = !actionTyp || list.some((r) => r.actionTyp === actionTyp);
        if (!matchUser || !matchAction) byTrace.delete(traceId);
      }
    }

    // 제외 trace 집합: 제외 코드 셋과 매칭되는 errCd 를 가진 trace + (가상)액션 실패(시즈닝/AutoQual 취소·실행) trace
    const excludedTraces = new Set<string>();
    if (excludeSet.size > 0) {
      for (const [traceId, list] of byTrace) {
        const hitErr = list.some((r) => r.errCd && excludeSet.has(r.errCd));
        const hitAction = matchedActionFailCodes(list).some((code) => excludeSet.has(code));
        if (hitErr || hitAction) excludedTraces.add(traceId);
      }
    }

    const totals = { total: 0, ok: 0, fail: 0, pending: 0 };
    const userCount = new Map<string, number>();
    const errCount = new Map<string, number>();
    const actionAcc = new Map<string, DimensionStats>();
    const facAcc = new Map<string, DimensionStats>();
    const areaAcc = new Map<string, DimensionStats>();
    const NONE = "(none)";
    const dimBump = (acc: Map<string, DimensionStats>, key: string, status: DashStatus) => {
      let s = acc.get(key);
      if (!s) {
        s = { key, total: 0, ok: 0, fail: 0, pending: 0 };
        acc.set(key, s);
      }
      s.total += 1;
      s[status] += 1;
    };

    const g = pickGranularity(effectiveFromMs, effectiveToMs);
    const buckets = new Map<number, TimeBucket>();

    let latencySum = 0;
    let latencyN = 0;

    // Action 전체 응답 지연: CUBE(진입 레이어) send→resp 를 버킷별 집계 — 대시보드 "평균 응답 속도" 차트용.
    // Tokens 탭의 LLM 호출 지연(1콜 단위, LATENCY_MS)과는 별개의 정규 지표(전 구간 왕복시간).
    const cubeLat = new Map<number, { sum: number; n: number }>();
    let cubeLatSum = 0;
    let cubeLatN = 0;

    // ── 레이어별 자체 소요시간(self time) 분해 ────────────────────────────────
    // 행의 SEND_TM→RESP_TM 은 "하위 레이어를 기다린 시간" 이라 위로 갈수록 아래 것을 통째로 품는다
    // (CUBE ⊃ GAIA ⊃ MCP ⊃ ONEOIS). 그대로 비교하면 언제나 진입 레이어가 1등이라 의미가 없다.
    // 그래서 각 레이어의 몫에서 바로 아래 레이어의 대기시간을 빼 self time 으로 분해한다:
    //
    //   wait_i    = Σ(RESP_TM − SEND_TM)   i 가 하위를 기다린 시간 (멀티콜은 호출별 합)
    //   outer_0   = 진입 레이어 RECV→RESP   트레이스 전체 관측 구간
    //   outer_i   = wait_(i−1)              부모가 i 에게 내준 구간
    //   self_i    = outer_i − wait_i        i 자신의 처리 + 전송 지연
    //   self_last = outer_last              최하위는 외부 시스템 호출까지가 제 몫(그 아래는 미기록)
    //
    // 텔레스코핑되어 Σ self_i = outer_0 이므로 그대로 "시간 비중 100%" 로 읽을 수 있다.
    // GAIA 의 LLM 호출처럼 실제로 시간을 쓴 레이어가 드러난다.
    const selfMs = new Map<LayerKey, number>();
    for (const l of LAYER_ORDER) selfMs.set(l, 0);
    let selfTimeTraces = 0;
    // 실패 발생 레이어: errCd 를 가진 "가장 깊은" 레이어로 귀속.
    // 에러가 상위로 전파돼 여러 레이어에 errCd 가 찍혀도 최초 발생지 1곳만 센다.
    const failOrigin = new Map<LayerKey, number>();
    for (const l of LAYER_ORDER) failOrigin.set(l, 0);

    // 일별 브레이크다운 (리포트 "일별 현황"): buckets 와 별개로 항상 "일" 단위로 집계.
    // 사용자 수는 하루 안에서 distinct 라 Set 이 필요해 buckets 에 얹지 않고 따로 둔다.
    const dailyAcc = new Map<
      number,
      {
        total: number;
        ok: number;
        fail: number;
        pending: number;
        users: Set<string>;
        latSum: number;
        latN: number;
        // 하루 안의 기능(ACTION_TYP)별 세부 — 어떤 기능이 얼마나 돌았는지
        actions: Map<string, { total: number; ok: number; fail: number }>;
      }
    >();

    for (const [traceId, list] of byTrace) {
      if (excludedTraces.has(traceId)) continue;

      totals.total += 1;
      const layerSet = new Set(list.map((r) => r.layer));
      const allComplete =
        layerSet.size === LAYER_ORDER.length && list.every((r) => r.sendCompltYn === "Y");
      const status = classify(list, allComplete);
      totals[status] += 1;

      // user — CUBE(진입 레이어) 우선 대표 사용자 (traceUserId 참고)
      const u = traceUserId(list);
      if (u) userCount.set(u, (userCount.get(u) ?? 0) + 1);

      // action: 트레이스 내 첫 번째 비어있지 않은 값을 채택 (상위 레이어가 INSERT 시 기록).
      // ACTION_TYP 이 없으면 = 라우터에서 튕긴 라우팅 실패(반드시 errCd 동반 → 이미 fail 집계). (none) 대신 명시 라벨.
      const at = list.find((r) => r.actionTyp)?.actionTyp ?? ROUTING_FAIL_LABEL;
      dimBump(actionAcc, at, status);

      // FAC / AREA: MCP send update 에서만 기록되므로 트레이스 내 첫 non-null 값 채택. MCP 미도달 트레이스는 (none)
      const fac = list.find((r) => r.facId)?.facId ?? NONE;
      dimBump(facAcc, fac, status);
      const area = list.find((r) => r.areaId)?.areaId ?? NONE;
      dimBump(areaAcc, area, status);

      // top errors (FAIL/ERROR 모두 포함, 단 에러 코드 기준)
      for (const r of list) {
        if (!r.errCd) continue;
        errCount.set(r.errCd, (errCount.get(r.errCd) ?? 0) + 1);
      }
      // TEMP(ONEOIS 미연결): 액션 실패(시즈닝/AutoQual 취소·실행)는 실제 errCd 가 없으므로 가상 코드로 topErrors 에 반영
      for (const code of matchedActionFailCodes(list)) {
        errCount.set(code, (errCount.get(code) ?? 0) + 1);
      }

      // 실패 발생 레이어 = errCd 를 가진 가장 깊은 레이어 (전파돼 올라온 상위 errCd 는 세지 않음)
      let deepestErr = -1;
      for (const r of list) {
        if (!r.errCd) continue;
        const li = LAYER_ORDER.indexOf(r.layer);
        if (li > deepestErr) deepestErr = li;
      }
      if (deepestErr >= 0) {
        const l = LAYER_ORDER[deepestErr];
        failOrigin.set(l, (failOrigin.get(l) ?? 0) + 1);
      }

      // 레이어별 self time 분해 (위 주석의 wait/outer/self 정의 참고)
      const entryRows = list.filter((r) => r.layer === LAYER_ORDER[0]);
      const entryRecv = entryRows.map((r) => parseTs(r.recvTm)).filter((v): v is number => v !== null);
      const entryResp = entryRows.map((r) => parseTs(r.respTm)).filter((v): v is number => v !== null);
      if (entryRecv.length > 0 && entryResp.length > 0) {
        const outer0 = Math.max(...entryResp) - Math.min(...entryRecv);
        if (outer0 >= 0 && outer0 < 24 * 3_600_000) {
          // wait_i: 레이어별 (resp − send) 합. 멀티콜은 호출별로 더한다.
          const waitOf = (l: LayerKey) => {
            let sum = 0;
            for (const r of list) {
              if (r.layer !== l) continue;
              const s = parseTs(r.sendTm);
              const e = parseTs(r.respTm);
              if (s !== null && e !== null && e >= s) sum += e - s;
            }
            return sum;
          };
          // ⚠️ 행이 없는 레이어는 체인에서 통째로 빼야 한다. 넣어두면 그 레이어의 wait 가 0 이라
          // 부모가 기다린 시간이 통째로 "존재하지도 않는 레이어" 의 몫으로 잡힌다
          // (예: MCP 미도달 트레이스인데 MCP 가 2.7s 를 쓴 것처럼 보임).
          const present = LAYER_ORDER.filter((l) => list.some((r) => r.layer === l));
          let outer = outer0;
          present.forEach((l, k) => {
            // 가장 깊은 레이어는 자신의 하위(미기록 외부 시스템 / 미연결 레이어) 대기까지 제 몫으로 본다.
            // clamp: 레이어 간 시계 편차로 wait > outer 가 되는 경우의 안전장치.
            const w = waitOf(l);
            const self = k === present.length - 1 ? outer : Math.max(0, outer - w);
            selfMs.set(l, (selfMs.get(l) ?? 0) + self);
            outer = w;
          });
          selfTimeTraces += 1;
        }
      }

      // 트레이스 시작 시각 → 버킷
      const recvTimes = list
        .map((r) => parseTs(r.recvTm))
        .filter((v): v is number => v !== null);
      const respTimes = list
        .flatMap((r) => [parseTs(r.respTm), parseTs(r.sendTm)])
        .filter((v): v is number => v !== null);

      if (recvTimes.length > 0) {
        const start = Math.min(...recvTimes);
        const key = floorToBucket(start, g);
        let b = buckets.get(key);
        if (!b) {
          b = { ts: isoNoTz(key), ok: 0, fail: 0, pending: 0 };
          buckets.set(key, b);
        }
        b[status] += 1;

        // 일별 브레이크다운 — 버킷과 동일한 귀속 기준(트레이스 시작 시각), 단위만 항상 "일"
        const dayKey = floorToBucket(start, "1d");
        let day = dailyAcc.get(dayKey);
        if (!day) {
          day = { total: 0, ok: 0, fail: 0, pending: 0, users: new Set(), latSum: 0, latN: 0, actions: new Map() };
          dailyAcc.set(dayKey, day);
        }
        day.total += 1;
        day[status] += 1;
        if (u) day.users.add(u);

        // 하루 안의 기능별 세부 — at/status 는 위에서 트레이스 단위로 이미 판정됨(byAction 과 동일 기준)
        let da = day.actions.get(at);
        if (!da) {
          da = { total: 0, ok: 0, fail: 0 };
          day.actions.set(at, da);
        }
        da.total += 1;
        if (status === "ok") da.ok += 1;
        else if (status === "fail") da.fail += 1;

        // 트레이스 latency: 첫 recv → 마지막 resp/send
        if (respTimes.length > 0) {
          const end = Math.max(...respTimes);
          const dur = end - start;
          if (dur >= 0 && dur < 24 * 3_600_000) {
            latencySum += dur;
            latencyN += 1;
          }
        }

        // CUBE 가 하위로 요청 보낸 시각(send)→응답 받은 시각(resp) 지연 = Action end-to-end 응답시간
        const cubeSends = list
          .filter((r) => r.layer === "CUBE")
          .map((r) => parseTs(r.sendTm))
          .filter((v): v is number => v !== null);
        const cubeResps = list
          .filter((r) => r.layer === "CUBE")
          .map((r) => parseTs(r.respTm))
          .filter((v): v is number => v !== null);
        if (cubeSends.length > 0 && cubeResps.length > 0) {
          const d = Math.max(...cubeResps) - Math.min(...cubeSends);
          if (d >= 0 && d < 24 * 3_600_000) {
            let cl = cubeLat.get(key);
            if (!cl) {
              cl = { sum: 0, n: 0 };
              cubeLat.set(key, cl);
            }
            cl.sum += d;
            cl.n += 1;
            cubeLatSum += d;
            cubeLatN += 1;
            day.latSum += d;
            day.latN += 1;
          }
        }
      }
    }

    // 빈 버킷 채우기 (시계열 차트가 균일하게 보이도록)
    const bucketArr: TimeBucket[] = enumerateBucketStarts(effectiveFromMs, effectiveToMs, g).map(
      (k) => {
        const b = buckets.get(k) ?? { ts: isoNoTz(k), ok: 0, fail: 0, pending: 0 };
        // 버킷별 CUBE send→resp 평균 지연(=Action 응답 지연) 부착
        const cl = cubeLat.get(k);
        b.avgCubeLatencyMs = cl ? cl.sum / cl.n : null;
        b.cubeLatencyTraces = cl?.n ?? 0;
        return b;
      }
    );

    // 일별 브레이크다운 배열 (빈 날은 0으로 채움).
    // to 는 상한 경계(다음날/다음주 자정)라 -1ms 로 마지막 빈 날이 붙는 것을 막는다.
    const daily: DailyStat[] = enumerateBucketStarts(
      effectiveFromMs,
      Math.max(effectiveFromMs, effectiveToMs - 1),
      "1d"
    ).map((k) => {
      const d = dailyAcc.get(k);
      return {
        date: isoNoTz(k).slice(0, 10),
        total: d?.total ?? 0,
        ok: d?.ok ?? 0,
        fail: d?.fail ?? 0,
        pending: d?.pending ?? 0,
        users: d?.users.size ?? 0,
        avgCubeLatencyMs: d && d.latN > 0 ? d.latSum / d.latN : null,
        byAction: d
          ? sortActions(Array.from(d.actions.entries()).map(([key, v]) => ({ key, ...v })))
          : [],
      };
    });

    // ── 레이어별 행 단위 집계 (ERROR/FAIL 구분 없이 fail 로 통합) — 제외 trace 의 행은 빠짐
    const layerAcc = new Map<LayerKey, { total: number; fail: number; ok: number; rt: number[] }>();
    for (const l of LAYER_ORDER) layerAcc.set(l, { total: 0, fail: 0, ok: 0, rt: [] });
    let includedRowCount = 0;
    for (const r of rows) {
      // 트레이스 단위 필터(byTrace 에서 제거)된 행과 제외 trace 행은 모두 건너뛴다.
      if (!byTrace.has(r.traceId) || excludedTraces.has(r.traceId)) continue;
      includedRowCount += 1;
      const a = layerAcc.get(r.layer);
      if (!a) continue;
      a.total += 1;
      if (r.errCd) a.fail += 1;
      if (r.sendCompltYn === "Y" && !r.errCd) a.ok += 1;
      const s = parseTs(r.sendTm);
      const e = parseTs(r.respTm);
      if (s !== null && e !== null) {
        const d = e - s;
        if (d >= 0 && d < 60 * 60_000) a.rt.push(d);
      }
    }
    const layers = LAYER_ORDER.map((l) => {
      const a = layerAcc.get(l)!;
      const avg = a.rt.length > 0 ? a.rt.reduce((x, y) => x + y, 0) / a.rt.length : null;
      const st = selfMs.get(l) ?? 0;
      return {
        layer: l,
        total: a.total,
        failCount: a.fail,
        okRows: a.ok,
        avgRespMs: avg,
        avgSelfMs: selfTimeTraces > 0 ? st / selfTimeTraces : null,
        selfMsTotal: st,
        failOriginTraces: failOrigin.get(l) ?? 0,
      };
    });

    const resp: StatsResponse = {
      range: { from: filter.dateFrom ?? null, to: filter.dateTo ?? null },
      totals,
      avgLatencyMs: latencyN > 0 ? latencySum / latencyN : null,
      // Action 전체 응답 지연 평균 (CUBE send→resp)
      cubeAvgLatencyMs: cubeLatN > 0 ? cubeLatSum / cubeLatN : null,
      granularity: g,
      buckets: bucketArr,
      layers,
      selfTimeTraces,
      topUsers: topN(userCount, 8),
      uniqueUsers: userCount.size,
      daily,
      topErrors: topN(errCount, 8),
      byAction: sortActions(Array.from(actionAcc.values())),
      byFac: Array.from(facAcc.values()).sort((a, b) => b.total - a.total),
      byArea: Array.from(areaAcc.values()).sort((a, b) => b.total - a.total),
      rowCount: includedRowCount,
      excludeErrCds: excludeErrCds,
      excludedTraceCount: excludedTraces.size,
    };

    logger.info("GET /api/stats done", {
      ...ctx,
      rows: rows.length,
      includedRows: includedRowCount,
      traces: totals.total,
      excludedTraces: excludedTraces.size,
      ms: Date.now() - t0,
      status: 200,
    });

    return NextResponse.json(resp);
  } catch (e) {
    logger.error("GET /api/stats failed", { ...ctx, status: 500, ms: Date.now() - t0, err: String(e) });
    throw e;
  }
}
