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
  {
    traceId: "TRC-20260420-0001",
    userId: "hong.gildong",
    prompt: "현재 라인 A의 진행중 WO 목록 알려줘"
  },
  {
    traceId: "TRC-20260420-0002",
    userId: "kim.chulsoo",
    prompt: "설비 EQ-101 의 오늘 가동률은?"
  },
  {
    traceId: "TRC-20260420-0003",
    userId: "lee.younghee",
    prompt: "불량 코드 D-07 집계 보여줘",
    errorAt: "ONEOIS"
  },
  {
    traceId: "TRC-20260420-0004",
    userId: "park.minsu",
    prompt: "신규 작업지시 등록해줘 (LINE-B / WO-99887)",
    stopAt: "MCP"
  },
  {
    traceId: "TRC-20260420-0005",
    userId: "choi.sumin",
    prompt: "eworks 결재 대기 건 목록"
  }
];

const PAIRS: Array<{ layer: LayerKey; recv: string; send: string }> = [
  { layer: "CUBE",   recv: "USER",    send: "GAIA"   },
  { layer: "GAIA",   recv: "CUBE",    send: "MCP"    },
  { layer: "MCP",    recv: "GAIA",    send: "ONEOIS" },
  { layer: "ONEOIS", recv: "MCP",     send: "LEGACY" },
  { layer: "LEGACY", recv: "ONEOIS",  send: "MES"    }
];

function buildRecvPayload(layer: LayerKey, from: string, s: Scenario): object {
  if (layer === "CUBE") {
    return {
      traceId: s.traceId,
      channel: "cube-web",
      user: { id: s.userId, locale: "ko-KR", department: "PROD-A" },
      prompt: s.prompt,
      context: {
        site: "PYEONGTAEK-P3",
        sessionId: `sess-${s.traceId.slice(-8)}`,
        previousMessages: 2
      },
      clientTime: new Date().toISOString()
    };
  }
  if (layer === "GAIA") {
    return {
      traceId: s.traceId,
      from,
      kind: "user.prompt",
      user: s.userId,
      prompt: s.prompt,
      hints: { domain: "MES", intentCandidates: ["WO.SEARCH", "EQ.STATUS", "DEFECT.SUMMARY"] }
    };
  }
  if (layer === "MCP") {
    return {
      traceId: s.traceId,
      from,
      envelope: {
        version: "1.1",
        messageType: "TOOL_INVOKE",
        correlationId: `corr-${s.traceId.slice(-6)}`
      },
      tool: "mes.workOrder.search",
      args: { line: "LINE-A", status: ["RUNNING", "PAUSED"], limit: 50, includeMaterials: true }
    };
  }
  if (layer === "ONEOIS") {
    return {
      traceId: s.traceId,
      from,
      header: {
        interfaceId: "IF-MES-0187",
        protocol: "HTTPS/JSON",
        authToken: "eyJhbGciOiJSUzI1NiJ9.****",
        retryCount: 0
      },
      body: {
        service: "MES.WO.SEARCH",
        params: {
          plant: "P3", line: "LINE-A",
          filters: { status: ["RUNNING", "PAUSED"], from: "2026-04-20", to: "2026-04-21" }
        }
      }
    };
  }
  return {
    traceId: s.traceId,
    from,
    system: "MES",
    module: "WorkOrder",
    action: "search",
    parameters: {
      plantCode: "P3", lineCode: "LINE-A",
      statusList: ["RUNNING", "PAUSED"],
      pageNo: 1, pageSize: 50,
      includeDetail: true, includeMaterialList: true, includeOperatorList: false
    }
  };
}

function buildSendPayload(layer: LayerKey, to: string, s: Scenario): object {
  if (layer === "CUBE") {
    return { traceId: s.traceId, to, type: "forward.prompt", user: s.userId, text: s.prompt };
  }
  if (layer === "GAIA") {
    return {
      traceId: s.traceId, to,
      intent: "MES.WO.SEARCH",
      confidence: 0.94,
      parameters: { line: "LINE-A", period: "today", status: ["RUNNING", "PAUSED"] },
      explanation: "사용자 발화에서 라인 A 진행중 작업지시 조회 의도를 추출",
      modelMeta: { name: "claude-opus-4-7", tokensIn: 824, tokensOut: 142, latencyMs: 712 }
    };
  }
  if (layer === "MCP") {
    return {
      traceId: s.traceId, to,
      envelope: { version: "1.1", messageType: "TOOL_RESULT" },
      result: {
        tool: "mes.workOrder.search",
        status: "OK",
        durationMs: 238,
        data: Array.from({ length: 3 }, (_, i) => ({
          workOrderId: `WO-2026-${1000 + i}`,
          line: "LINE-A", product: "SKU-8821",
          status: i === 1 ? "PAUSED" : "RUNNING",
          progress: 0.42 + i * 0.15,
          assignedOperator: "op-7711",
          startTm: `2026-04-20T07:${10 + i}:00Z`
        }))
      }
    };
  }
  if (layer === "ONEOIS") {
    return {
      traceId: s.traceId, to,
      header: { responseCode: "0000", responseMsg: "SUCCESS" },
      body: {
        total: 3,
        rows: Array.from({ length: 3 }, (_, i) => ({
          WO_ID: `WO-2026-${1000 + i}`,
          LINE_CD: "LINE-A",
          PROD_CD: "SKU-8821",
          STATUS: i === 1 ? "PAUSED" : "RUNNING",
          PROGRESS_RT: 0.42 + i * 0.15
        }))
      }
    };
  }
  return { traceId: s.traceId, to, ack: true, persisted: true };
}

function buildRows(s: Scenario): Record<LayerKey, TraceRow[]> {
  const out: Record<LayerKey, TraceRow[]> = {
    CUBE: [], GAIA: [], MCP: [], ONEOIS: [], LEGACY: []
  };

  let offset = 0;
  for (const p of PAIRS) {
    if (s.stopAt && LAYER_ORDER.indexOf(p.layer) > LAYER_ORDER.indexOf(s.stopAt)) break;

    const recvTm = iso(offset);
    const sendTm = iso(offset + Math.floor(Math.random() * 3) + 1);
    offset += 3;

    const isErr = s.errorAt === p.layer;
    const recvPayload = buildRecvPayload(p.layer, p.recv, s);
    const sendPayload = buildSendPayload(p.layer, p.send, s);

    out[p.layer].push({
      layer: p.layer,
      traceId: s.traceId,
      timekey: timekey(recvTm),
      userId: s.userId,
      sysId: p.layer,
      recvSysId: p.recv,
      recvMsgCtn: JSON.stringify(recvPayload),
      recvTm,
      sendSysId: isErr ? null : p.send,
      sendMsgTm: isErr ? null : JSON.stringify(sendPayload),
      sendTm: isErr ? null : sendTm,
      sendCompltYn: isErr ? "N" : "Y",
      errCd: isErr ? "E-5001" : null,
      errDescCtn: isErr ? "downstream timeout" : null
    });
  }

  return out;
}

const ALL_ROWS: TraceRow[] = SCENARIOS.flatMap((s) => {
  const byLayer = buildRows(s);
  return LAYER_ORDER.flatMap((l) => byLayer[l]);
});

export function mockRowsForLayer(layer: LayerKey): TraceRow[] {
  return ALL_ROWS.filter((r) => r.layer === layer);
}

export function mockAllRows(): TraceRow[] {
  return ALL_ROWS;
}
