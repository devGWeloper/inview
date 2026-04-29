# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Next.js dev server on **port 5174**
- `npm run build` — production build
- `npm run start` — serve the built app on port 5174
- `npm run lint` — `next lint`

There is no test runner configured.

## Big picture

TraceX is a single-page **AI Action Transaction trace viewer** built on Next.js 14 (App Router, React 18, TypeScript strict). It reads the `BIZ_AIACTIONTXN_HIS` table that is replicated across **five Oracle databases** — one per layer in the request path: `CUBE → GAIA → MCP → ONEOIS → LEGACY` (see `LAYER_ORDER` in `src/lib/types.ts` and `sql/create_tables.sql`). The UI reconstructs a single end-to-end trace by joining rows from all five layers on `TRACE_ID`.

### Layer labels

| Key | Display name |
|-----|-------------|
| `CUBE` | Cube / Cube Bot |
| `GAIA` | Gaia Agent |
| `MCP` | MCP Server |
| `ONEOIS` | OneOIS |
| `LEGACY` | Legacy (MES/EWORKS) |

### Data flow

1. Browser (`src/app/page.tsx`, client component) calls the two API routes:
   - `GET /api/traces` — list view, returns per-trace summaries
   - `GET /api/traces/[traceId]` — detail view, returns the raw rows across layers
2. Route handlers in `src/app/api/traces/` delegate to `src/lib/db.ts`.
3. `db.ts` fans out **one query per layer** in parallel (`Promise.all` over `LAYER_ORDER`), each using its own connection config read from env vars (see Environment variables below).
4. `/api/traces` groups rows by `TRACE_ID` and computes `allComplete` (requires all 5 layers with `SEND_COMPLT_YN='Y'`) and `hasError`. `lastSendTm` in `TraceSummary` is the max of all `sendTm` and `respTm` values.
5. `TraceTimeline` groups rows by layer and renders them. Single-call layers show **recv | send | resp** in a 3-column layout; multi-call layers show the upstream recv once at the top, then numbered `Call #N` items each with a **send | resp** pair.

Both API routes export `dynamic = "force-dynamic"` — they are never statically cached.

### Row lifecycle — 3-phase write pattern

Each layer records **one row per call cycle** using three DML operations in `sql/`:

| Phase | File | When | What changes |
|-------|------|------|--------------|
| 1 | `dml_insert_recv.sql` | Message received from upstream | INSERT with `RECV_*` filled, `SEND_COMPLT_YN='N'` |
| 2 | `dml_update_send.sql` | Message forwarded to downstream | UPDATE `SEND_SYS_ID`, `SEND_MSG_CTN`, `SEND_TM` |
| 3 | `dml_update_resp.sql` | Response received from downstream | UPDATE `RESP_MSG_CTN`, `RESP_TM`, `SEND_COMPLT_YN='Y'` |
| (opt) | `dml_update_error.sql` | Error occurs | UPDATE `ERR_CD`, `ERR_DESC_CTN`, `SEND_COMPLT_YN='N'` |

`SEND_COMPLT_YN='Y'` is only set in phase 3 (response received), not on send. A row with `SEND_COMPLT_YN='N'` and a non-null `SEND_TM` means "sent but awaiting response". An error update explicitly sets `SEND_COMPLT_YN='N'`, meaning no further downstream send occurred.

### Schema key columns (`BIZ_AIACTIONTXN_HIS`)

PK is `(TRACE_ID, TIMEKEY)`, which allows **multiple rows per layer per trace** (e.g. GAIA calling MCP twice). Each row captures one full round-trip to the downstream system:

- `TRACE_ID` — shared identifier across all five databases
- `TIMEKEY` — row-level unique key (format: `YYYYMMDDHH24MISSFF3`)
- `USER_ID`, `SYS_ID` — who initiated and which system owns this row
- `RECV_SYS_ID` / `RECV_MSG_CTN` / `RECV_TM` — upstream request received by this layer
- `SEND_SYS_ID` / `SEND_MSG_CTN` / `SEND_TM` — request forwarded to downstream
- `RESP_MSG_CTN` / `RESP_TM` — response received **back from** the downstream system
- `SEND_COMPLT_YN` — `'Y'` only after response received (full round-trip complete)
- `ERR_CD` / `ERR_DESC_CTN` — optional error code and description

For layers that make multiple downstream calls in one trace (e.g. GAIA → MCP twice), only the first row has `RECV_MSG_CTN` populated; subsequent rows leave it null.

Three indexes exist on the table: `RECV_TM`, `(USER_ID, RECV_TM)`, and `(RECV_SYS_ID, SEND_SYS_ID)`.

### Multi-call handling in the UI

`TraceTimeline.tsx` groups `TraceRow[]` by layer before rendering. `SingleCallCard` handles the `rows.length === 1` case (3-col). `MultiCallCard` handles `rows.length > 1`: it reads `recvMsgCtn` from the first row and renders each row's `send`/`resp` as a numbered call. The `Stepper` shows call count (`N calls`) in the subtitle when a layer has multiple rows.

### Behaviour with no DB configured

When a layer has no DB credentials (or the Oracle native driver is unavailable), `queryLayer()` returns `[]` for that layer. The list and detail APIs simply return fewer (or zero) rows — there is no built-in mock data fallback in the current codebase. The topbar badge shows **CONNECTED · N LAYERS** where N is the count of layers with a complete DB config (`connectedLayerCount()` in `db.ts`). When N = 0 the badge shows "CONNECTED · 0 LAYERS".

The `.env.example` includes a `USE_MOCK=true` comment entry but this variable is **not currently consumed** by any code. Do not rely on it.

### Oracle integration notes

- `oracledb` is listed in `next.config.mjs` under `experimental.serverComponentsExternalPackages` — it must not be bundled.
- Import is done lazily via `await import("oracledb")` inside `getOracle()` and **swallows the error** if the native driver is unavailable. Keep this pattern when touching DB code so the app still runs on machines without the Oracle Instant Client.
- Timestamps are selected with `TO_CHAR(..., 'YYYY-MM-DD"T"HH24:MI:SS.FF3')` so that the app receives ISO-like strings and never has to deal with Oracle date objects.
- Rows in `queryLayer` are fetched with `outFormat: oracle.OBJECT` and column names come back uppercased. `rowFrom()` tries both cases (`COLUMN_NAME` and `column_name`) for safety.
- The SQL assembles a `WHERE` clause from `TraceFilter` using bind variables — preserve the bind-variable style when adding filters.
- The physical column for the outbound message is `SEND_MSG_CTN` (not `SEND_MSG_TM` — the old name was a legacy spec artifact that has since been corrected).
- `queryLayer` limits results via `FETCH FIRST N ROWS ONLY` — default 200 (set in the route), hard-capped at 500.

### Environment variables

`getAppEnv()` returns `"dev"` or `"prd"` based on `APP_ENV`. `readConfig(layer)` resolves credentials by trying the prefixed form first then falling back to the unprefixed form:

```
{ENV}_{LAYER}_DB_USER        e.g. DEV_CUBE_DB_USER
{ENV}_{LAYER}_DB_PASSWORD
{ENV}_{LAYER}_DB_CONNECT_STRING   format: host:port/service
```

Fallback (no prefix):

```
{LAYER}_DB_USER
{LAYER}_DB_PASSWORD
{LAYER}_DB_CONNECT_STRING
```

Copy `.env.example` to `.env.local` and fill in credentials before running against a real database.

### Logging

`src/lib/logger.ts` writes JSON-structured log lines. `INFO`/`WARN` go to stdout, `ERROR` to stderr. All timestamps use KST (UTC+09:00). Route handlers call `reqContext(req)` to include `ip`, `method`, `path`, `ua`, and `referer` in every log entry.

### Summary computation (`/api/traces`)

The `summarize()` function inside `src/app/api/traces/route.ts` computes per-trace fields:

| Field | Logic |
|-------|-------|
| `firstRecvTm` | min of all `recvTm` values |
| `lastSendTm` | max of all `sendTm` and `respTm` values |
| `layerCount` | count of distinct layers |
| `hasError` | any row has a non-null `errCd` |
| `allComplete` | exactly 5 distinct layers **and** every row has `sendCompltYn === "Y"` |

Summaries are sorted descending by `firstRecvTm`.

### Detail sort order (`/api/traces/[traceId]`)

`fetchByTraceId()` sorts rows by `LAYER_ORDER` index first, then by `recvTm ?? timekey` within the same layer — preserving the physical call sequence when a layer makes multiple downstream calls.

### UI components

| File | Role |
|------|------|
| `src/app/page.tsx` | Root client component — filter form, trace list table, panel splitter, state management |
| `src/components/TraceTimeline.tsx` | Timeline visualization — Stepper, SingleCallCard, MultiCallCard, JsonBlock |
| `src/app/layout.tsx` | Root layout — sets `lang="ko"`, page metadata |
| `src/app/globals.css` | All styles — layout grid, timeline cards, JSON syntax highlighting, status pills, layer accent colours |

#### Column resizing

`useColResize()` in `TraceTimeline.tsx` implements pointer-based column drag. Columns are sized using fractional CSS custom properties (`--c1`, `--c2`, `--c3`). Double-clicking a splitter resets to equal widths. `COL_MIN_FR = 0.25` is the minimum fractional size per column.

#### JsonBlock

Renders `RECV_MSG_CTN`, `SEND_MSG_CTN`, and `RESP_MSG_CTN` payloads. Parses as JSON (pretty-prints if valid), falls back to raw text. Content > 14 lines or > 700 characters is collapsed by default with an expand/collapse toggle. Syntax highlighting uses `dangerouslySetInnerHTML` with HTML-escaped strings — do not bypass `escapeHtml` when changing this code.

### Path alias

`@/*` → `./src/*` (configured in `tsconfig.json`).

## File map

```
src/
  app/
    api/
      traces/
        route.ts              GET /api/traces — list + summarize
        [traceId]/
          route.ts            GET /api/traces/:id — detail rows
    page.tsx                  SPA root (client component)
    layout.tsx                HTML shell
    globals.css               All styles
  components/
    TraceTimeline.tsx          Timeline + cards
  lib/
    db.ts                     Oracle connection, query fanout
    logger.ts                 JSON structured logging (KST)
    types.ts                  Shared TypeScript types
  types/
    oracledb.d.ts             Module declaration stub for oracledb
sql/
  create_tables.sql           DDL for BIZ_AIACTIONTXN_HIS
  create_public_synonym.sql   Oracle synonym
  dml_insert_recv.sql         Phase 1 INSERT
  dml_update_send.sql         Phase 2 UPDATE
  dml_update_resp.sql         Phase 3 UPDATE
  dml_update_error.sql        Error UPDATE
  dml_layer_mapping.sql       Layer → SYS_ID mapping reference
```
