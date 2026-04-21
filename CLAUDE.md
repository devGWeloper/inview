# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Next.js dev server (App Router)
- `npm run build` — production build
- `npm run start` — serve the built app
- `npm run lint` — `next lint`

There is no test runner configured.

## Big picture

INVIEW is a single-page **AI Action Transaction trace viewer** built on Next.js 14 (App Router, React 18, TypeScript strict). It reads the `BIZ_AIACTIONTXN_HIS` table that is replicated across **five Oracle databases** — one per layer in the request path: `CUBE → GAIA → MCP → ONEOIS → LEGACY` (see `LAYER_ORDER` in `src/lib/types.ts` and `sql/create_tables.sql`). The UI reconstructs a single end-to-end trace by joining rows from all five layers on `TRACE_ID`.

### Data flow

1. Browser (`src/app/page.tsx`, client component) calls the two API routes:
   - `GET /api/traces` — list view, returns per-trace summaries
   - `GET /api/traces/[traceId]` — detail view, returns the raw rows across layers
2. Route handlers in `src/app/api/traces/` delegate to `src/lib/db.ts`.
3. `db.ts` fans out **one query per layer** in parallel (`Promise.all` over `LAYER_ORDER`), each using its own connection config read from `${LAYER}_DB_USER` / `_PASSWORD` / `_CONNECT_STRING` env vars.
4. `/api/traces` groups rows by `TRACE_ID` and computes `allComplete` (requires all 5 layers with `SEND_COMPLT_YN='Y'`) and `hasError`.
5. `TraceTimeline` renders the ordered layer stages with recv/send JSON payloads.

### Mock vs. live mode

`isMockMode()` in `src/lib/db.ts` returns true when `USE_MOCK=true` **or** when no layer has a complete DB config. Mock data lives in `src/lib/mock.ts` and includes five canned scenarios that exercise success, mid-chain stop (`stopAt`), and error (`errorAt`) paths. Every data-fetching code path must keep working in mock mode — do not add logic that assumes a live DB.

The UI surfaces the mode via a `usedMock` flag returned from `/api/traces` (rendered as the `MOCK DATA` vs `CONNECTED · 5 LAYERS` badge in the topbar).

### Oracle integration notes

- `oracledb` is listed in `next.config.mjs` under `experimental.serverComponentsExternalPackages` — it must not be bundled.
- Import is done lazily via `await import("oracledb")` inside `getOracle()` and **swallows the error** if the native driver is unavailable, falling back to mock. Keep this pattern when touching DB code so the app still runs on machines without the Oracle Instant Client.
- Timestamps are selected with `TO_CHAR(..., 'YYYY-MM-DD"T"HH24:MI:SS.FF3')` so that the app receives ISO-like strings and never has to deal with Oracle date objects.
- The SQL assembles a `WHERE` clause from `TraceFilter` using bind variables — preserve the bind-variable style when adding filters.

### Path alias

`@/*` → `./src/*` (configured in `tsconfig.json`).
