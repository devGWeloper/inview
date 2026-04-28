# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Next.js dev server (App Router)
- `npm run build` — production build
- `npm run start` — serve the built app
- `npm run lint` — `next lint`

There is no test runner configured.

## Big picture

TraceX is a single-page **AI Action Transaction trace viewer** built on Next.js 14 (App Router, React 18, TypeScript strict). It reads the `BIZ_AIACTIONTXN_HIS` table that is replicated across **five Oracle databases** — one per layer in the request path: `CUBE → GAIA → MCP → ONEOIS → LEGACY` (see `LAYER_ORDER` in `src/lib/types.ts` and `sql/create_tables.sql`). The UI reconstructs a single end-to-end trace by joining rows from all five layers on `TRACE_ID`.

### Data flow

1. Browser (`src/app/page.tsx`, client component) calls the two API routes:
   - `GET /api/traces` — list view, returns per-trace summaries
   - `GET /api/traces/[traceId]` — detail view, returns the raw rows across layers
2. Route handlers in `src/app/api/traces/` delegate to `src/lib/db.ts`.
3. `db.ts` fans out **one query per layer** in parallel (`Promise.all` over `LAYER_ORDER`), each using its own connection config read from `${LAYER}_DB_USER` / `_PASSWORD` / `_CONNECT_STRING` env vars.
4. `/api/traces` groups rows by `TRACE_ID` and computes `allComplete` (requires all 5 layers with `SEND_COMPLT_YN='Y'`) and `hasError`. `lastSendTm` in `TraceSummary` is the max of all `sendTm` and `respTm` values.
5. `TraceTimeline` groups rows by layer and renders them. Single-call layers show **recv | send | resp** in a 3-column layout; multi-call layers show the upstream recv once at the top, then numbered `Call #N` items each with a **send | resp** pair.

### Row lifecycle — 3-phase write pattern

Each layer records **one row per call cycle** using three DML operations in `sql/`:

| Phase | File | When | What changes |
|-------|------|------|--------------|
| 1 | `dml_insert_recv.sql` | Message received from upstream | INSERT with `RECV_*` filled, `SEND_COMPLT_YN='N'` |
| 2 | `dml_update_send.sql` | Message forwarded to downstream | UPDATE `SEND_SYS_ID`, `SEND_MSG_CTN`, `SEND_TM` |
| 3 | `dml_update_resp.sql` | Response received from downstream | UPDATE `RESP_MSG_CTN`, `RESP_TM`, `SEND_COMPLT_YN='Y'` |

`SEND_COMPLT_YN='Y'` is only set in phase 3 (response received), not on send. This means a row with `SEND_COMPLT_YN='N'` and a non-null `SEND_TM` indicates "sent but awaiting response".

### Schema key columns (`BIZ_AIACTIONTXN_HIS`)

PK is `(TRACE_ID, TIMEKEY)`, which allows **multiple rows per layer per trace** (e.g. GAIA calling MCP twice). Each row captures one full round-trip to the downstream system:

- `RECV_SYS_ID` / `RECV_MSG_CTN` / `RECV_TM` — upstream request received by this layer
- `SEND_SYS_ID` / `SEND_MSG_CTN` / `SEND_TM` — request forwarded to downstream
- `RESP_MSG_CTN` / `RESP_TM` — response received **back from** the downstream system
- `SEND_COMPLT_YN` — `'Y'` only after response received (full round-trip complete)

For layers that make multiple downstream calls in one trace (e.g. GAIA → MCP twice), only the first row has `RECV_MSG_CTN` populated; subsequent rows leave it null.

### Multi-call handling in the UI

`TraceTimeline.tsx` groups `TraceRow[]` by layer before rendering. `SingleCallCard` handles the `rows.length === 1` case (3-col). `MultiCallCard` handles `rows.length > 1`: it reads `recvMsgCtn` from the first row and renders each row's `send`/`resp` as a numbered call. The `Stepper` shows call count (`N calls`) in the subtitle when a layer has multiple rows.

### Mock vs. live mode

`isMockMode()` in `src/lib/db.ts` returns true when `USE_MOCK=true` **or** when no layer has a complete DB config. Mock data lives in `src/lib/mock.ts` and includes:
- 5 single-call scenarios exercising success, mid-chain stop (`stopAt`), and error (`errorAt`) paths
- 1 multi-call scenario (`TRC-20260420-0006`) where GAIA makes 2 MCP calls (WO search + EQ status)

Every data-fetching code path must keep working in mock mode — do not add logic that assumes a live DB.

The UI surfaces the mode via a `usedMock` flag returned from `/api/traces` (rendered as the `MOCK DATA` vs `CONNECTED · 5 LAYERS` badge in the topbar).

### Oracle integration notes

- `oracledb` is listed in `next.config.mjs` under `experimental.serverComponentsExternalPackages` — it must not be bundled.
- Import is done lazily via `await import("oracledb")` inside `getOracle()` and **swallows the error** if the native driver is unavailable, falling back to mock. Keep this pattern when touching DB code so the app still runs on machines without the Oracle Instant Client.
- Timestamps are selected with `TO_CHAR(..., 'YYYY-MM-DD"T"HH24:MI:SS.FF3')` so that the app receives ISO-like strings and never has to deal with Oracle date objects.
- The SQL assembles a `WHERE` clause from `TraceFilter` using bind variables — preserve the bind-variable style when adding filters.
- The physical column for the outbound message is `SEND_MSG_CTN` (not `SEND_MSG_TM` — the old name was a legacy spec artifact that has since been corrected).

### Path alias

`@/*` → `./src/*` (configured in `tsconfig.json`).
