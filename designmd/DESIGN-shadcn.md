---
version: alpha
name: shadcn-ui-design-analysis
description: A token-first application design language where nothing is styled directly — every surface, every piece of text, and every border resolves through a semantic CSS variable pair (`--x` / `--x-foreground`) defined twice, once for light and once for dark. The palette is deliberately achromatic: an OKLCH neutral ladder from near-white to near-black carries the entire interface, and the only chromatic events are the destructive red and whatever accents the product adds itself. Depth is refused — a 1px ring at 10% foreground opacity separates a card from the page, and a 3px focus ring is the loudest shadow the system produces. Geist Sans sets everything at 12–14px with tight tracking; Geist Mono carries identifiers. Corner radius is a single `--radius` scalar that every other radius is computed from, so the whole product's softness is one number.

colors:
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.145 0 0)"
  popover: "oklch(1 0 0)"
  popover-foreground: "oklch(0.145 0 0)"
  secondary: "oklch(0.97 0 0)"
  secondary-foreground: "oklch(0.205 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  accent: "oklch(0.97 0 0)"
  accent-foreground: "oklch(0.205 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  border: "oklch(0.922 0 0)"
  input: "oklch(0.922 0 0)"
  ring: "oklch(0.708 0 0)"
  success: "oklch(0.596 0.145 163.2)"
  warning: "oklch(0.706 0.153 70.1)"
  info: "oklch(0.588 0.196 258.3)"
  chart-1: "oklch(0.588 0.196 258.3)"
  chart-2: "oklch(0.596 0.145 163.2)"
  chart-3: "oklch(0.706 0.153 70.1)"
  chart-4: "oklch(0.577 0.245 27.325)"
  chart-5: "oklch(0.556 0.152 300.5)"
  dark-background: "oklch(0.145 0 0)"
  dark-foreground: "oklch(0.985 0 0)"
  dark-card: "oklch(0.205 0 0)"
  dark-primary: "oklch(0.922 0 0)"
  dark-primary-foreground: "oklch(0.205 0 0)"
  dark-muted: "oklch(0.269 0 0)"
  dark-muted-foreground: "oklch(0.708 0 0)"
  dark-destructive: "oklch(0.704 0.191 22.216)"
  dark-border: "oklch(1 0 0 / 10%)"
  dark-input: "oklch(1 0 0 / 15%)"
  dark-ring: "oklch(0.556 0 0)"

typography:
  page-title:
    fontFamily: Geist, ui-sans-serif, system-ui, sans-serif
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.4px
  metric-xl:
    fontFamily: Geist, ui-sans-serif, system-ui, sans-serif
    fontSize: 28px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.6px
  metric-lg:
    fontFamily: Geist, ui-sans-serif, system-ui, sans-serif
    fontSize: 24px
    fontWeight: 600
    lineHeight: 30px
    letterSpacing: -0.4px
  card-title:
    fontFamily: Geist, ui-sans-serif, system-ui, sans-serif
    fontSize: 16px
    fontWeight: 500
    lineHeight: 22px
    letterSpacing: 0
  body-sm:
    fontFamily: Geist, ui-sans-serif, system-ui, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0
  body-xs:
    fontFamily: Geist, ui-sans-serif, system-ui, sans-serif
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
    letterSpacing: 0
  label-eyebrow:
    fontFamily: Geist, ui-sans-serif, system-ui, sans-serif
    fontSize: 11px
    fontWeight: 500
    lineHeight: 14px
    letterSpacing: 0.66px
    textTransform: uppercase
  caption:
    fontFamily: Geist, ui-sans-serif, system-ui, sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0
  mono-id:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0
  mono-badge:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 10px
    fontWeight: 500
    lineHeight: 14px
    letterSpacing: 0.3px

rounded:
  base: 10px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  2xl: 18px
  3xl: 22px
  4xl: 26px
  full: 9999px

spacing:
  px: 1px
  0.5: 2px
  1: 4px
  1.5: 6px
  2: 8px
  2.5: 10px
  3: 12px
  4: 16px
  6: 24px
  8: 32px
  card: 16px
  card-sm: 12px

controls:
  height-xs: 24px
  height-sm: 28px
  height-default: 32px
  height-lg: 36px
  height-badge: 20px
  height-table-head: 40px
  focus-ring-width: 3px

components:
  app-bar:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    borderColor: "{colors.border}"
    height: "56px"
    padding: "0px {spacing.6}"
    backdrop: "blur(12px) / 80% opacity"
  tabs-list:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: "{controls.height-default}"
    padding: "3px"
  tabs-trigger-active:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    shadow: "0 1px 2px 0 oklch(0 0 0 / 0.05)"
  button-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: "{controls.height-default}"
    padding: "0px {spacing.2.5}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    borderColor: "{colors.border}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: "{controls.height-default}"
    padding: "0px {spacing.2.5}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: "{controls.height-default}"
    padding: "0px {spacing.2.5}"
  button-icon:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    height: "{controls.height-default}"
    padding: "0px"
  badge-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    borderColor: "{colors.border}"
    typography: "{typography.caption}"
    rounded: "{rounded.4xl}"
    height: "{controls.height-badge}"
    padding: "0px {spacing.2}"
  badge-status-ok:
    backgroundColor: "{colors.success} @ 10%"
    textColor: "{colors.success}"
    borderColor: "{colors.success} @ 30%"
    typography: "{typography.caption}"
    rounded: "{rounded.4xl}"
    height: "{controls.height-badge}"
    padding: "0px {spacing.2}"
  badge-status-fail:
    backgroundColor: "{colors.destructive} @ 10%"
    textColor: "{colors.destructive}"
    borderColor: "{colors.destructive} @ 30%"
    typography: "{typography.caption}"
    rounded: "{rounded.4xl}"
    height: "{controls.height-badge}"
    padding: "0px {spacing.2}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    ringColor: "{colors.foreground} @ 10%"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card}"
  card-header-divided:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    borderColor: "{colors.border}"
    typography: "{typography.card-title}"
    padding: "0px {spacing.card} {spacing.card}"
  text-input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    borderColor: "{colors.input}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: "{controls.height-default}"
    padding: "0px {spacing.2.5}"
  select-trigger:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    borderColor: "{colors.input}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: "{controls.height-default}"
    padding: "0px {spacing.2} 0px {spacing.2.5}"
  table-head:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    height: "{controls.height-table-head}"
    padding: "0px {spacing.2}"
  table-row-hover:
    backgroundColor: "{colors.muted} @ 50%"
    textColor: "{colors.foreground}"
    borderColor: "{colors.border}"
  tooltip:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "{spacing.1.5} {spacing.3}"
  meter-bar:
    backgroundColor: "{colors.muted}"
    fillColor: "{colors.primary} @ 70%"
    rounded: "{rounded.full}"
    height: "4px"
  footer:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    borderColor: "{colors.border}"
    padding: "{spacing.4} 0px 0px"

---


## Overview

shadcn/ui is not a brand — it is a **token contract**, and that is exactly what makes it worth analyzing next to Apple, Binance, BMW, and Vercel. The other four documents describe how a company wants to be seen. This one describes how an application wants to be *maintained*. The design language's central assertion is that no component should ever name a color, a radius, or a font. It names a **role** — `background`, `card`, `muted`, `destructive`, `ring` — and the role resolves through a CSS variable that is declared twice, once under `:root` and once under `.dark`. Flip the class on `<html>` and the entire product re-themes with no component aware that anything happened.

The palette is aggressively achromatic. Every neutral is an **OKLCH** triplet with **zero chroma** — `oklch(0.145 0 0)` for foreground, `oklch(0.97 0 0)` for muted, `oklch(0.922 0 0)` for border — which means the whole interface is a lightness ladder and nothing else. The single chromatic token shipped by default is `{colors.destructive}` (a red at 0.245 chroma). This is a deliberate vacancy: the system expects the product to supply its own accents, and refuses to guess. In our TraceX study we filled that vacancy with four semantic additions (`{colors.success}`, `{colors.warning}`, `{colors.info}`, plus a five-stop chart ramp), authored in the same OKLCH-with-light-and-dark-pairs idiom so they are indistinguishable from native tokens.

Depth is the other refusal. There is no elevation ladder, no shadow scale, no glass. A card is separated from the page by a **1px ring at 10% foreground opacity** — not a border, a ring, so it never participates in layout. The loudest shadow the system emits is the **3px focus ring** at 50% `{colors.ring}`, and the near-invisible `shadow-sm` under an active tab. Hierarchy comes from three sources only: lightness difference between `{colors.card}` and `{colors.background}`, the hairline that divides a card header from its body, and type weight. Everything else is flat on purpose.

Density is the last signature. Controls sit on a tight ladder — 24 / 28 / **32** / 36px — and the default is 32px, noticeably shorter than most component libraries. Body text runs 14px, secondary text 12–13px, and eyebrow labels 11px uppercase at 0.06em. Combined with a 4px spacing grid, the result is a surface that fits a genuine amount of operational data on one screen without feeling cramped — which is precisely what a trace viewer needs and what a marketing design language (Apple, Vercel) does not optimize for.

**Key Characteristics:**
- Every visual property resolves through a semantic token pair — `{colors.card}` / `{colors.card-foreground}`, `{colors.muted}` / `{colors.muted-foreground}` — so foreground contrast is guaranteed by construction, never chosen per component.
- All neutrals are **OKLCH with chroma 0**; light and dark are two declarations of the same variable names, not two stylesheets. Dark mode is free.
- Depth is refused: cards use `ring-1` at `{colors.foreground}` 10% rather than shadows; the 3px focus ring is the strongest visual lift in the system.
- **One radius scalar.** `{rounded.base}` (10px) is authored; `{rounded.sm}`…`{rounded.4xl}` are all `calc()` multiples of it. Changing one number re-softens the entire product.
- Dense control ladder — `{controls.height-xs}` / `{controls.height-sm}` / `{controls.height-default}` / `{controls.height-lg}` — with 32px as the default, tuned for data-heavy application chrome rather than marketing pages.
- The default palette ships **no success / warning / info** color. That gap is intentional and must be filled by the product in the same token idiom.
- Components are **copied into the repo**, not imported from a package — so the design language is a starting point that the product owns and edits, not a dependency it inherits.
- Geist Sans for all UI text at 11–28px; **Geist Mono for every identifier** (TRACE_ID, 사번, FAB, error code) — monospace is a semantic signal that a string is a key, not prose.

## Colors

> Source analyzed: the shadcn/ui `new-york` registry as generated by `shadcn init` (CLI 4.x, Tailwind v4, `@base-ui/react` primitives), plus the TraceX-specific extension authored for the `.d-sc` block in `public/design-preview.html`.

### Token Pairs — the core idea
Colors are never used alone. They come as **surface + on-surface pairs**, and a component that sets one always sets the other:
- `{colors.background}` / `{colors.foreground}` — the page itself.
- `{colors.card}` / `{colors.card-foreground}` — any raised panel. In light mode `{colors.card}` is pure white on an off-white page; **in dark mode the relationship inverts** — the card (`{colors.dark-card}` — oklch(0.205 0 0)) is *lighter* than the page (`{colors.dark-background}` — oklch(0.145 0 0)).
- `{colors.popover}` / `{colors.popover-foreground}` — floating layers (select menus, dropdowns).
- `{colors.primary}` / `{colors.primary-foreground}` — the one "solid" fill. Note that primary is **near-black in light mode and near-white in dark mode**: the system's emphasis color is maximal contrast, not a hue.
- `{colors.secondary}` / `{colors.secondary-foreground}`, `{colors.muted}` / `{colors.muted-foreground}`, `{colors.accent}` / `{colors.accent-foreground}` — three near-identical low-emphasis pairs kept distinct so a product can diverge them later without touching components.

### Surface
- **Page** (`{colors.background}` — oklch(1 0 0) light / oklch(0.145 0 0) dark).
- **Card** (`{colors.card}`): identical to the page in light mode — cards are distinguished by their **ring**, not their fill. This is why removing the ring makes a shadcn layout collapse into an undifferentiated sheet.
- **Muted wash** (`{colors.muted}` — oklch(0.97 0 0)): table row hover, meter track, tabs list background, ghost-button hover. The only "fill" that appears at scale.
- **Popover** (`{colors.popover}`): same value as card; exists so overlays can be re-tinted independently.

### Text
- **Primary text** (`{colors.foreground}`): headings, metric values, table cells.
- **Secondary text** (`{colors.muted-foreground}` — oklch(0.556 0 0) light / oklch(0.708 0 0) dark): descriptions, axis ticks, captions, eyebrow labels. Roughly a 4.6:1 contrast — legible but decisively subordinate.
- There is **no third text tier** by default. Products that need one (we did, for `{typography.caption}` hints) reach for `{colors.muted-foreground}` at reduced opacity rather than adding a token.

### Borders & Rings
- `{colors.border}` (oklch(0.922 0 0)) — every hairline: card header dividers, table row rules, footer rule.
- `{colors.input}` — form control outlines. Same value as border in light mode, deliberately separate so inputs can be emphasized independently. **In dark mode they diverge**: border is `oklch(1 0 0 / 10%)`, input is `oklch(1 0 0 / 15%)` — form controls stay findable on a dark page.
- `{colors.ring}` — focus only. Applied at **3px width and 50% opacity**, plus the border swapping to `{colors.ring}`. Focus is the single most visually assertive state in the entire language.
- **Card edges use `ring-1` at `{colors.foreground}` 10%, not `{colors.border}`** — a subtle but important distinction: the card edge tracks the text color, so it thins out automatically in dark mode.

### Semantic Status — the required extension
The stock palette has `{colors.destructive}` and nothing else. A trace viewer needs at minimum success / warning / info, so the study adds them following the same rules (OKLCH, light+dark pair, `-foreground` companion):
- **Success** (`{colors.success}` — oklch(0.596 0.145 163.2)): 성공 상태, 레이어 정상 비중 바.
- **Warning** (`{colors.warning}` — oklch(0.706 0.153 70.1)): 미완료(pending), ONEOIS 미연결 배지.
- **Info** (`{colors.info}` — oklch(0.588 0.196 258.3)): 중립 강조, 지연 추이 라인.
- **Destructive** (`{colors.destructive}`): 실패, 에러 코드 리스트.

Status is expressed as a **three-part recipe**, never a solid fill: `bg-{token}/10 text-{token} border-{token}/30`. This keeps status badges legible in both themes without a second set of "on-dark" values, and it keeps a table of 40 rows from turning into a traffic light.

### Chart Ramp
`{colors.chart-1}`…`{colors.chart-5}` ship **achromatic** in the current registry (a grey ladder), which is unusable for status charts. The study replaces them with a five-hue ramp — blue / green / amber / red / violet — chosen so that (a) chart-2/3/4 align exactly with success/warning/destructive, and (b) hues stay distinguishable in both themes. Charts reference them only as `var(--color-chart-N)`, resolved by the `ChartContainer` wrapper.

### Layer Identity
TraceX assigns a hue per layer (`{colors.chart-1}` CUBE → violet GAIA → green MCP → amber ONEOIS) as `--layer-*` tokens. These are **identity**, not status — used as a 3px left rail on the layer cards only, never as fill, so they never compete with the success/fail semantics in the same card.

## Typography

### Font Family
- **Geist Sans** — the entire UI. Loaded via the `geist` package (`GeistSans.variable`), wired to shadcn's `--font-sans` contract.
- **Geist Mono** — identifiers only: TRACE_ID, USER_ID, FAB/AREA codes, error codes, environment badges.

The sans/mono split is **semantic, not decorative**. In this product, monospace means "this string is a key you might copy, search, or paste into a query." Prose never uses it, and identifiers never use anything else.

### Hierarchy
- `{typography.page-title}` — 20px/600 at -0.4px. The page's only h1. Deliberately modest; an application title is a wayfinding label, not a headline.
- `{typography.metric-xl}` — 28px/600. KPI card values. The largest type in the product, and it exists only to make a number scannable.
- `{typography.metric-lg}` — 24px/600. Same role at narrower breakpoints, and the donut center value.
- `{typography.card-title}` — 16px/500. Every card head. Weight 500 rather than 600 — cards are peers, not sections.
- `{typography.body-sm}` — 14px/400. Default body, table cells, control labels.
- `{typography.body-xs}` — 13px/400. Dense list rows (top lists), table content where a column count is high.
- `{typography.caption}` — 12px/400 in `{colors.muted-foreground}`. Card descriptions, footnotes, percentages under a metric.
- `{typography.label-eyebrow}` — 11px/500 uppercase at 0.06em. KPI card labels. The only uppercase in the system.
- `{typography.mono-id}` / `{typography.mono-badge}` — 12px / 10px Geist Mono.

### Principles
- **Numbers are always `tabular-nums`.** Every metric, percentage, count, duration, and axis tick. A dashboard where digits shift width as data refreshes reads as broken.
- **Tight tracking scales with size.** -0.6px at 28px, -0.4px at 20–24px, 0 at ≤16px. Negative tracking below 16px damages Korean glyphs and is never applied.
- **Weight carries hierarchy, size carries importance.** The system uses only 400 / 500 / 600. There is no 700 anywhere.
- **Korean and Latin share the stack.** Geist has no Hangul coverage, so Korean falls through to the system Korean face. Because everything is set at 11–16px with zero or negative tracking, the fallback seam is invisible in practice — but display sizes above 28px would expose it, which is one more reason the type scale stops where it does.

### Note on Font Substitutes
Geist is available on npm (`geist`) and needs no Google Fonts request. If it must be swapped, the constraint is a grotesque with a **tall x-height, unambiguous 1/l/I, and a true tabular figure set**. Inter and Söhne satisfy this; Helvetica and system-ui do not (weak tabular support). The mono replacement must be metrically stable at 10px — JetBrains Mono or IBM Plex Mono work; Courier does not.

## Layout

### Spacing System
Tailwind v4's `--spacing` base is 4px, and every value in the product is a multiple of it. The only named composite is card padding:
- `{spacing.1}` 4px — badge gaps, meter bar spacing
- `{spacing.1.5}` 6px — icon-to-label inside controls
- `{spacing.2}` 8px — table cell padding, badge horizontal
- `{spacing.2.5}` 10px — button/input horizontal padding
- `{spacing.3}` 12px — inline gaps in headers, card padding at `size="sm"`
- `{spacing.4}` 16px — **card padding (`--card-spacing`)**, grid gutter between cards
- `{spacing.6}` 24px — page horizontal padding, section rhythm
- `{spacing.8}` 32px — reserved; rarely needed at this density

The card exposes its padding as a **local custom property** (`--card-spacing`), so `size="sm"` re-tightens the header, body, and footer in one declaration. Never hardcode `px-4` on a card child — read the variable.

### Grid & Container
- Page container: `max-width: 1400px`, centered, `{spacing.6}` horizontal padding (`{spacing.4}` below `sm`).
- Vertical rhythm between blocks: a single `{spacing.4}` gap, uniformly. There is no "section spacing" — the dashboard is one continuous stack of peers.
- Column patterns used, in order of appearance: `5` (KPI) → `1` (usage chart, full-bleed) → `1.35fr / 1fr` (latency + donut) → `1` (layer flow) → `2` (errors + actions) → `3` (FAC / AREA / users) → `1` (recent table).
- The asymmetric `1.35fr / 1fr` pairing is the one deliberate break from equal columns: a time series needs horizontal room, a donut does not.

### Density Philosophy
This language optimizes for **information per screen**, the inverse of the marketing systems in the other four documents. Apple gives a product photo an entire viewport; shadcn gives five KPIs, a 12-point time series, and a status breakdown the same space. The discipline that makes density survivable is uniform gap (`{spacing.4}` everywhere) and a hard cap on type sizes — density fails when spacing *or* type starts varying per block.

## Elevation & Depth

There is no elevation scale. In ascending order, the entire depth vocabulary is:

1. **Ring** — `ring-1` at `{colors.foreground}` 10%. Every card, every panel. Because it is a ring rather than a border it adds no layout box, so a card's padding math is unaffected by its edge.
2. **Hairline** — `1px solid {colors.border}` dividing a card header from its body, rows in a table, the footer from the page.
3. **Muted fill** — `{colors.muted}` at 50–100% for hover states and meter tracks. Recession, not elevation.
4. **`shadow-sm`** — a 1px 5%-black shadow, used in exactly one place: the active tab pill inside a tabs list.
5. **Focus ring** — 3px at `{colors.ring}` 50% plus a border swap. The only element that visually leaves the page plane.
6. **Backdrop blur** — the sticky app bar only: `{colors.background}` at 80% with a 12px blur, so content scrolling underneath is felt but not read.

### Decorative Depth
Charts use vertical **gradient fills** from 55% to 4% opacity of their series color. This is the only gradient in the system, and it exists to let stacked areas overlap legibly rather than to decorate. Everything else is flat fill or flat stroke.

## Shapes

### Border Radius Scale
Authored as a single scalar with computed multiples — the system's most quietly powerful decision:

| Token | Formula | Value | Used by |
|-------|---------|-------|---------|
| `{rounded.sm}` | `--radius × 0.6` | 6px | small inline chips |
| `{rounded.md}` | `--radius × 0.8` | 8px | active tab, tooltip, list row hover |
| `{rounded.lg}` | `--radius` | 10px | **buttons, inputs, selects** |
| `{rounded.xl}` | `--radius × 1.4` | 14px | **cards** |
| `{rounded.2xl}`…`{rounded.4xl}` | `× 1.8 / 2.2 / 2.6` | 18 / 22 / 26px | badges (`4xl` = pill at 20px height) |
| `{rounded.full}` | — | 9999px | meter bars, status dots, avatars |

Changing `--radius` from 0.625rem to 0 produces a coherent brutalist variant of the same product; raising it to 1rem produces a soft consumer variant. **No component hardcodes a radius**, which is what makes that true.

### Geometry
- Controls are rectangles with `{rounded.lg}`; only badges and meters go pill.
- Status is communicated by a **2px dot** (`{rounded.full}`) or a tinted badge — never by a colored panel background.
- The layer cards use a **3px full-height left rail** for identity color. A rail rather than a border keeps the card's own ring intact and reads as a category marker rather than a status.

## Components

### App Bar
Sticky, 56px, `{colors.background}` at 80% with backdrop blur, bottom `1px {colors.border}`. Left: a 28px `{colors.primary}` square holding a 16px icon, the product name at 15px/600, and an environment badge in `{typography.mono-badge}`. Center: the tabs list. Right: filter (ghost), range select, theme toggle (icon button). The bar never grows past 56px and never gains a shadow — it separates by blur and hairline only.

### Tabs
A `{colors.muted}` track at `{rounded.lg}` with 3px inner padding; the active trigger becomes a `{colors.background}` pill at `{rounded.md}` with `shadow-sm`. Inactive labels sit at `{colors.foreground}` 60%. This is navigation, not filtering — it replaces a sidebar entirely at this product's scale.

### Buttons
Six variants, one shape (`{rounded.lg}`), four heights:
- `default` — `{colors.primary}` fill. Reserved for the single most likely action on a screen; the dashboard has **zero** of these, which is correct for a read-only view.
- `outline` — `{colors.border}` on `{colors.background}`. The workhorse ("전체 보기", theme toggle).
- `ghost` — no chrome until hover. Secondary chrome ("필터").
- `secondary` / `destructive` / `link` — available, unused here.

All buttons carry `active:translate-y-px` — a 1px press displacement that is the system's only motion affordance on click.

### Badges
20px tall, `{rounded.4xl}`, 12px text. Three uses in this study, and the distinction matters:
- **Status** — the `bg/10 text/full border/30` recipe on a semantic token.
- **Delta** — same recipe, but the token is chosen by *whether the movement is good*, not by its direction. 실패 -6.1% is green with a down arrow; 지연 +9.3% is red with an up arrow. Encoding direction instead of meaning is the most common failure in KPI design.
- **Metadata** — `outline` or `ghost` variant in mono for environment tags and counts.

### Cards
The dominant container. Structure is `Card > CardHeader (+ CardAction) > CardContent`, with the header carrying `border-b` whenever the body is a chart or table. `CardAction` slots a control into the header's right column via grid placement — no flex wrapper, no absolute positioning. KPI cards omit the divider because their body *is* their header.

### Inputs & Selects
32px tall, `{rounded.lg}`, `1px {colors.input}`, transparent fill (`{colors.input}` at 30% in dark mode so the control reads against the page). Focus swaps the border to `{colors.ring}` and adds the 3px ring. The select trigger is width-fit by default and must be given an explicit width in a toolbar or it will resize as its value changes.

### Tables
Header row 40px, `{colors.foreground}` at weight 500 — **not** muted, because a column header is a label and not a caption. Rows separate with `{colors.border}` and hover to `{colors.muted}` 50%. Numeric columns are right-aligned and tabular; identifier columns are mono; the status column ends the row with a badge. The card wrapping a table drops its horizontal padding (`px-0`) so rules run edge to edge.

### Charts
`ChartContainer` injects a `<style>` block mapping each series key to `var(--color-{key})` from a `ChartConfig`, then wraps Recharts' `ResponsiveContainer`. Consequence: **series colors are theme-reactive for free** — a stacked area re-colors on dark-mode toggle with no JS. Axes drop their lines and ticks (`axisLine={false} tickLine={false}`), grid is horizontal-only dashed at `{colors.border}` 50%, and the tooltip is the shared `ChartTooltipContent`. A reference line at the period mean, dashed in `{colors.muted-foreground}`, gives a single-series chart its baseline.

### Meters
The relative bar under every top-list row: 4px tall, `{rounded.full}`, `{colors.muted}` track, `{colors.primary}` 70% fill (or `{colors.destructive}` 70% for error lists), width as a percentage of the list maximum. This is the system's substitute for a bar chart at list density, and it carries a 700ms width transition so a filter change animates rather than jumps.

### Tooltips
`{colors.foreground}` fill with `{colors.background}` text — a full inversion, the highest-contrast surface in the product. Used for definitions (error-code meanings), never for essential information.

## Do's and Don'ts

### Do
- Define every new color as a **light/dark pair of OKLCH variables** plus a `--color-*` mapping in `@theme inline`. A one-off hex in a component is a bug.
- Express status as `bg-{token}/10 text-{token} border-{token}/30` so it survives both themes without a second palette.
- Use `tabular-nums` on every digit that can change.
- Reach for `{colors.muted-foreground}` for anything secondary before considering opacity.
- Let `CardAction` place header controls; it is a grid slot, not a flex hack.
- Give charts their colors through `ChartConfig` so `ChartContainer` can make them theme-reactive.
- Keep one gap value (`{spacing.4}`) between every block on a page.
- Use mono for identifiers and only for identifiers.

### Don't
- Don't add shadows to create hierarchy. If a panel needs to stand out, it needs a ring and a divider, or it needs to be somewhere else.
- Don't hardcode a radius. `rounded-[12px]` breaks the single-scalar contract that makes the system re-skinnable.
- Don't use `{colors.primary}` as a "brand color" — it is near-black in light and near-white in dark. Anything you want to stay blue must be its own token.
- Don't ship the stock `{colors.chart-1}`…`{colors.chart-5}` for status data; they are a grey ladder and will make failure and success indistinguishable.
- Don't fill a card background with a status color. Tint the badge, not the container.
- Don't color a KPI delta by direction. Color it by whether the movement is good.
- Don't override card padding on children; read `--card-spacing`.
- Don't set negative letter-spacing below 16px — it degrades Hangul.
- Don't treat the copied `components/ui/*` files as vendor code. They are yours; edit them rather than fighting them with wrapper classes.

## Responsive Behavior

### Breakpoints
Tailwind defaults, three of which are actually used: `sm` 640px, `md` 768px, `lg` 1024px. The container caps at 1400px.

### Collapsing Strategy
- **KPI row**: 5 columns at `lg` → 2 columns below, with the fifth card spanning both to avoid an orphan.
- **Latency + donut**: `1.35fr / 1fr` at `lg` → stacked.
- **Layer flow**: horizontal pipeline with chevron connectors at `lg` → vertical stack below, chevrons hidden (a vertical chevron chain reads as a list, not a flow).
- **Top-list grids**: 3 → 1, and 2 → 1, at `lg`.
- **App bar**: tabs hide below `md`, the filter button hides below `lg`; brand, range select, and theme toggle never collapse.

### Touch Targets
The 32px default control height is below the 44px touch guideline. This is an **accepted tradeoff for a desktop operations tool** — the same tradeoff the system makes by default. A mobile-first product on this language must raise the control ladder to `lg` (36px) or larger and re-tune `--card-spacing`; it should not compensate by adding margin.

### Chart Behavior
Charts are given an explicit height (`aspect-auto h-[260px]` / `h-[180px]`) rather than an aspect ratio, so they stay readable when a column narrows. Axis ticks thin out via `minTickGap` instead of rotating — rotated labels are never used.

## Iteration Guide

이 언어는 시안 뷰어의 **두 화면**으로 살아 있다 — `public/design-preview.html` 의 `E · shadcn`(Design System)과 `F · shadcn`(Data Studio):

```
npm run dev     # http://localhost:5174/design-preview.html  →  5 / 6 키
```

두 시안은 `.d-sc` 아래에 **토큰과 컴포넌트를 한 벌로 공유**하고, 변형은 레이아웃과 토큰 기본값만 다르다 — 이 문서의 주장(컴포넌트가 아니라 토큰이 정한다)을 시안 구성 자체가 증명하도록 짠 것이다. E 상단의 두 버튼으로 라이트/다크 × 편안/조밀 네 상태를 직접 전환할 수 있다.

> 이 CSS는 손으로 쓴 **재현**이지 shadcn 패키지를 실행하는 것이 아니다 — A~D 가 Apple/Binance/BMW/Vercel 의 실제 코드가 아닌 것과 같다. 다만 색·반경·컨트롤 높이는 실제 `shadcn init`(CLI 4.x, Tailwind v4, `@base-ui/react`) 산출물에서 뽑은 값이라 눈대중이 아니다. 정적 HTML 한 장이라 React 컴포넌트인 shadcn 을 그대로 실행할 방법은 없다.

To take the language further:
- **Re-skin in one edit**: `.d-sc` 의 `--r` 을 바꾸고 새로고침. 0 이면 BMW 처럼 각지고, 16px 면 소비자용으로 부드러워진다. sm~4xl 이 전부 `calc()` 파생이라 한 줄로 끝난다.
- **Add a hue**: give `{colors.primary}` a chroma and the product gains a brand color everywhere solid emphasis appears — but check the dark-mode value, since primary inverts.
- **Port to the real app**: 진짜 shadcn 을 쓰려면 컴포넌트를 `npx shadcn@latest add <name>` 로 받아 오면 되고, 그 자체는 쉽다. 블로커는 컴포넌트가 아니라 `inview` 가 지금 3,905줄 `globals.css` 와 약 1,243개 시맨틱 클래스 참조를 이고 있다는 점이다 — Tailwind preflight 가 기존 리셋과 충돌하므로 `corePlugins.preflight:false` + 화면 단위 점진 이관이 필요하지, 플래그 하나로 되지 않는다.

## Known Gaps

- **Analysis surface is two screens.** 대시보드(E)와 데이터 스튜디오(F)만 그렸다. 트레이스 **상세**(stepper, 레이어별 recv|send|resp 카드, JSON envelope), Tokens 탭, Improvement Center, 인증 화면은 미검증이다 — 특히 타임라인은 shadcn 에 대응하는 컴포넌트가 없어서 이 언어의 진짜 시험대가 된다.
- **No form-heavy surface was tested.** Validation states, `aria-invalid` styling, and multi-field layout are defined by the tokens but unexercised here.
- **Korean typography is unresolved at display sizes.** Geist has no Hangul; the fallback is invisible at ≤28px and untested above it.
- **The chart ramp is a study choice, not a shadcn standard.** Five hues were selected for this data; a different product would need its own, and this document does not provide a method for deriving them.
- **Touch is out of scope.** 32px controls and hover-dependent affordances (table row hover, tooltip definitions) assume a pointer.
- **`{colors.secondary}`, `{colors.accent}`, and `{colors.muted}` are currently identical.** The system keeps them separate for future divergence, but nothing in this study distinguishes them — a real product should either differentiate or collapse them deliberately.
