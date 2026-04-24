import { LAYER_ORDER, LayerKey, TraceRow } from "./types";

const BASE_MS = Date.parse("2026-04-20T09:00:00Z");

function iso(offsetSec: number): string {
  return new Date(BASE_MS + offsetSec * 1000).toISOString();
}

function timekey(d: string): string {
  return d.replace(/[-:TZ.]/g, "").slice(0, 17);
}

type Scenario = {
  traceId: string;
  userId: string;
  prompt: string;
  errorAt?: LayerKey;
  stopAt?: LayerKey;
};

const SCENARIOS: Scenario[] = [
  { traceId: "TRC-20260420-0001", userId: "hong.gildong",  prompt: "현재 라인 A의 진행중 WO 목록 알려줘" },
  { traceId: "TRC-20260420-0002", userId: "kim.chulsoo",   prompt: "설비 EQ-101 의 오늘 가동률은?" },
  { traceId: "TRC-20260420-0003", userId: "lee.younghee",  prompt: "불량 코드 D-07 집계 보여줘", errorAt: "ONEOIS" },
  { traceId: "TRC-20260420-0004", userId: "park.minsu",    prompt: "신규 작업지시 등록해줘 (LINE-B / WO-99887)", stopAt: "MCP" },
  { traceId: "TRC-20260420-0005", userId: "choi.sumin",    prompt: "eworks 결재 대기 건 목록" },
];

const PAIRS: Array<{ layer: LayerKey; recv: string; send: string }> = [
  { layer: "CUBE",   recv: "USER",   send: "GAIA"   },
  { layer: "GAIA",   recv: "CUBE",   send: "MCP"    },
  { layer: "MCP",    recv: "GAIA",   send: "ONEOIS" },
  { layer: "ONEOIS", recv: "MCP",    send: "LEGACY" },
  { layer: "LEGACY", recv: "ONEOIS", send: "MES"    },
];

function buildRecvPayload(layer: LayerKey, from: string, s: Scenario): object {
  if (layer === "CUBE") {
    return {
      traceId: s.traceId, channel: "cube-web",
      user: { id: s.userId, locale: "ko-KR", department: "PROD-A" },
      prompt: s.prompt,
      context: { site: "PYEONGTAEK-P3", sessionId: `sess-${s.traceId.slice(-8)}`, previousMessages: 2 },
    };
  }
  if (layer === "GAIA") {
    return {
      traceId: s.traceId, from, kind: "user.prompt", user: s.userId, prompt: s.prompt,
      hints: { domain: "MES", intentCandidates: ["WO.SEARCH", "EQ.STATUS", "DEFECT.SUMMARY"] },
    };
  }
  if (layer === "MCP") {
    return {
      traceId: s.traceId, from,
      envelope: { version: "1.1", messageType: "TOOL_INVOKE", correlationId: `corr-${s.traceId.slice(-6)}` },
      tool: "mes.workOrder.search",
      args: { line: "LINE-A", status: ["RUNNING", "PAUSED"], limit: 50 },
    };
  }
  if (layer === "ONEOIS") {
    return {
      traceId: s.traceId, from,
      header: { interfaceId: "IF-MES-0187", protocol: "HTTPS/JSON", retryCount: 0 },
      body: { service: "MES.WO.SEARCH", params: { plant: "P3", line: "LINE-A" } },
    };
  }
  return {
    traceId: s.traceId, from, system: "MES", module: "WorkOrder", action: "search",
    parameters: { plantCode: "P3", lineCode: "LINE-A", statusList: ["RUNNING", "PAUSED"], pageNo: 1, pageSize: 50 },
  };
}

function buildSendPayload(layer: LayerKey, to: string, s: Scenario): object {
  if (layer === "CUBE") {
    return { traceId: s.traceId, to, type: "forward.prompt", user: s.userId, text: s.prompt };
  }
  if (layer === "GAIA") {
    return {
      traceId: s.traceId, to, intent: "MES.WO.SEARCH", confidence: 0.94,
      parameters: { line: "LINE-A", period: "today", status: ["RUNNING", "PAUSED"] },
      modelMeta: { name: "claude-opus-4-7", tokensIn: 824, tokensOut: 142, latencyMs: 712 },
    };
  }
  if (layer === "MCP") {
    return {
      traceId: s.traceId, to,
      envelope: { version: "1.1", messageType: "TOOL_RESULT" },
      result: { tool: "mes.workOrder.search", status: "OK", durationMs: 238,
        data: Array.from({ length: 3 }, (_, i) => ({
          workOrderId: `WO-2026-${1000 + i}`, line: "LINE-A", product: "SKU-8821",
          status: i === 1 ? "PAUSED" : "RUNNING", progress: 0.42 + i * 0.15,
        })) },
    };
  }
  if (layer === "ONEOIS") {
    return {
      traceId: s.traceId, to,
      header: { responseCode: "0000", responseMsg: "SUCCESS" },
      body: { total: 3, rows: Array.from({ length: 3 }, (_, i) => ({
        WO_ID: `WO-2026-${1000 + i}`, LINE_CD: "LINE-A", STATUS: i === 1 ? "PAUSED" : "RUNNING",
      })) },
    };
  }
  return { traceId: s.traceId, to, ack: true, persisted: true };
}

function buildRespPayload(layer: LayerKey, fromDownstream: string, s: Scenario): object {
  if (layer === "CUBE") {
    return {
      traceId: s.traceId, from: fromDownstream, type: "answer",
      content: { format: "markdown", text: `${s.prompt}에 대한 결과입니다.`, cardCount: 1 },
      modelMeta: { name: "claude-opus-4-7", tokensIn: 1240, tokensOut: 380, latencyMs: 1250 },
    };
  }
  if (layer === "GAIA") {
    return {
      traceId: s.traceId, from: fromDownstream,
      envelope: { version: "1.1", messageType: "TOOL_RESULT" },
      result: { tool: "mes.workOrder.search", status: "OK", durationMs: 312,
        data: Array.from({ length: 3 }, (_, i) => ({
          workOrderId: `WO-2026-${1000 + i}`, line: "LINE-A",
          status: i === 1 ? "PAUSED" : "RUNNING", progress: 0.42 + i * 0.15,
        })) },
    };
  }
  if (layer === "MCP") {
    return {
      traceId: s.traceId, from: fromDownstream,
      header: { responseCode: "0000", responseMsg: "SUCCESS" },
      body: { total: 3, rows: Array.from({ length: 3 }, (_, i) => ({
        WO_ID: `WO-2026-${1000 + i}`, LINE_CD: "LINE-A",
        STATUS: i === 1 ? "PAUSED" : "RUNNING", PROGRESS_RT: 0.42 + i * 0.15,
      })) },
    };
  }
  if (layer === "ONEOIS") {
    return {
      traceId: s.traceId, from: fromDownstream, resultCode: "0000", resultMessage: "SUCCESS",
      data: Array.from({ length: 3 }, (_, i) => ({
        WO_ID: `WO-2026-${1000 + i}`, LINE_CD: "LINE-A",
        STATUS_CD: i === 1 ? "PAS" : "RUN", PROG_RT: 42 + i * 15,
      })),
    };
  }
  return {
    traceId: s.traceId, from: fromDownstream, returnCode: "S", message: "정상 처리", rowCount: 3,
    rows: Array.from({ length: 3 }, (_, i) => ({
      WO_NO: `WO-2026-${1000 + i}`, LINE_NO: "LINE-A",
      STAT_CD: i === 1 ? "P" : "R", PROG_QTY: Math.floor((0.42 + i * 0.15) * 100),
    })),
  };
}

function buildRows(s: Scenario): TraceRow[] {
  const out: TraceRow[] = [];
  let offset = 0;

  for (const p of PAIRS) {
    if (s.stopAt && LAYER_ORDER.indexOf(p.layer) > LAYER_ORDER.indexOf(s.stopAt)) break;

    const recvTm = iso(offset);
    const sendTm = iso(offset + 1);
    const respTm = iso(offset + 2);
    offset += 4;

    const isErr = s.errorAt === p.layer;

    out.push({
      layer: p.layer,
      traceId: s.traceId,
      timekey: timekey(recvTm),
      userId: s.userId,
      sysId: p.layer,
      recvSysId: p.recv,
      recvMsgCtn: JSON.stringify(buildRecvPayload(p.layer, p.recv, s)),
      recvTm,
      sendSysId: isErr ? null : p.send,
      sendMsgCtn: isErr ? null : JSON.stringify(buildSendPayload(p.layer, p.send, s)),
      sendTm: isErr ? null : sendTm,
      sendCompltYn: isErr ? "N" : "Y",
      respMsgCtn: isErr ? null : JSON.stringify(buildRespPayload(p.layer, p.send, s)),
      respTm: isErr ? null : respTm,
      errCd: isErr ? "E-5001" : null,
      errDescCtn: isErr ? "downstream timeout" : null,
    });
  }

  return out;
}

// ── 복수 호출 시나리오 (TRC-20260420-0006) ───────────────────────────────────
// GAIA가 한 요청에 대해 MCP를 2번 호출 (WO 조회 + EQ 상태 조회)
function buildMultiCallRows(): TraceRow[] {
  const traceId = "TRC-20260420-0006";
  const userId = "jang.hyunwoo";
  const prompt = "라인 A WO 목록이랑 설비 EQ-101 오늘 가동률 같이 알려줘";
  let offset = 200;

  const rows: TraceRow[] = [];

  // CUBE: 1 row
  const cubeRecv = iso(offset);
  rows.push({
    layer: "CUBE", traceId, timekey: timekey(cubeRecv), userId, sysId: "CUBE",
    recvSysId: "USER",
    recvMsgCtn: JSON.stringify({ traceId, channel: "cube-web", user: { id: userId }, prompt }),
    recvTm: cubeRecv,
    sendSysId: "GAIA",
    sendMsgCtn: JSON.stringify({ traceId, to: "GAIA", type: "forward.prompt", user: userId, text: prompt }),
    sendTm: iso(offset + 1),
    sendCompltYn: "Y",
    respMsgCtn: JSON.stringify({
      traceId, from: "GAIA", type: "answer",
      content: { format: "markdown", text: "라인 A WO 목록 및 EQ-101 가동률 조회 결과입니다.", cardCount: 2 },
    }),
    respTm: iso(offset + 28),
    errCd: null, errDescCtn: null,
  });
  offset += 2;

  const mcpRows: TraceRow[] = [];
  const oneoisRows: TraceRow[] = [];
  const legacyRows: TraceRow[] = [];

  const calls = [
    {
      tool: "mes.workOrder.search",
      args: { line: "LINE-A", status: ["RUNNING", "PAUSED"], limit: 50 },
      result: Array.from({ length: 3 }, (_, i) => ({
        workOrderId: `WO-2026-${1000 + i}`, line: "LINE-A",
        status: i === 1 ? "PAUSED" : "RUNNING", progress: 0.42 + i * 0.15,
      })),
    },
    {
      tool: "mes.equipment.status",
      args: { equipmentId: "EQ-101", date: "2026-04-20" },
      result: { equipmentId: "EQ-101", availability: 0.87, status: "RUNNING", totalRunSec: 28800, totalIdleSec: 4320 },
    },
  ];

  for (let ci = 0; ci < calls.length; ci++) {
    const call = calls[ci];
    const gaiaTimekey = timekey(iso(offset + 1));

    // GAIA row: 첫 번째만 recvMsgCtn 채움 (upstream 요청은 동일)
    rows.push({
      layer: "GAIA", traceId, timekey: gaiaTimekey + String(ci), userId, sysId: "GAIA",
      recvSysId: ci === 0 ? "CUBE" : null,
      recvMsgCtn: ci === 0
        ? JSON.stringify({ traceId, from: "CUBE", kind: "user.prompt", user: userId, prompt })
        : null,
      recvTm: ci === 0 ? iso(offset) : null,
      sendSysId: "MCP",
      sendMsgCtn: JSON.stringify({
        traceId, to: "MCP",
        envelope: { version: "1.1", messageType: "TOOL_INVOKE" },
        tool: call.tool, args: call.args,
      }),
      sendTm: iso(offset + 1),
      sendCompltYn: "Y",
      respMsgCtn: JSON.stringify({
        traceId, from: "MCP",
        envelope: { version: "1.1", messageType: "TOOL_RESULT" },
        result: { tool: call.tool, status: "OK", data: call.result },
      }),
      respTm: iso(offset + 10),
      errCd: null, errDescCtn: null,
    });

    mcpRows.push({
      layer: "MCP", traceId, timekey: timekey(iso(offset + 2)) + String(ci), userId, sysId: "MCP",
      recvSysId: "GAIA",
      recvMsgCtn: JSON.stringify({ traceId, from: "GAIA", tool: call.tool, args: call.args }),
      recvTm: iso(offset + 2),
      sendSysId: "ONEOIS",
      sendMsgCtn: JSON.stringify({
        traceId, to: "ONEOIS",
        header: { interfaceId: "IF-MES-0187", protocol: "HTTPS/JSON" },
        body: { service: call.tool.toUpperCase().replace(/\./g, "_"), params: call.args },
      }),
      sendTm: iso(offset + 3),
      sendCompltYn: "Y",
      respMsgCtn: JSON.stringify({
        traceId, from: "ONEOIS",
        header: { responseCode: "0000", responseMsg: "SUCCESS" },
        body: { result: call.result },
      }),
      respTm: iso(offset + 8),
      errCd: null, errDescCtn: null,
    });

    oneoisRows.push({
      layer: "ONEOIS", traceId, timekey: timekey(iso(offset + 4)) + String(ci), userId, sysId: "ONEOIS",
      recvSysId: "MCP",
      recvMsgCtn: JSON.stringify({ traceId, from: "MCP", service: call.tool, params: call.args }),
      recvTm: iso(offset + 4),
      sendSysId: "LEGACY",
      sendMsgCtn: JSON.stringify({ traceId, to: "LEGACY", system: "MES", params: call.args }),
      sendTm: iso(offset + 5),
      sendCompltYn: "Y",
      respMsgCtn: JSON.stringify({ traceId, from: "LEGACY", resultCode: "0000", data: call.result }),
      respTm: iso(offset + 7),
      errCd: null, errDescCtn: null,
    });

    legacyRows.push({
      layer: "LEGACY", traceId, timekey: timekey(iso(offset + 5)) + String(ci), userId, sysId: "LEGACY",
      recvSysId: "ONEOIS",
      recvMsgCtn: JSON.stringify({ traceId, from: "ONEOIS", action: call.tool.split(".").pop(), params: call.args }),
      recvTm: iso(offset + 5),
      sendSysId: "MES",
      sendMsgCtn: JSON.stringify({ traceId, to: "MES", query: call.tool }),
      sendTm: iso(offset + 6),
      sendCompltYn: "Y",
      respMsgCtn: JSON.stringify({ traceId, from: "MES", returnCode: "S", rowCount: 3, data: call.result }),
      respTm: iso(offset + 6),
      errCd: null, errDescCtn: null,
    });

    offset += 13;
  }

  return [...rows, ...mcpRows, ...oneoisRows, ...legacyRows];
}

const ALL_ROWS: TraceRow[] = [
  ...SCENARIOS.flatMap(buildRows),
  ...buildMultiCallRows(),
];

export function mockRowsForLayer(layer: LayerKey): TraceRow[] {
  return ALL_ROWS.filter((r) => r.layer === layer);
}

export function mockAllRows(): TraceRow[] {
  return ALL_ROWS;
}
