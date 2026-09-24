# MySnoozePod Frontend Visual System Contract

**Pass:** 0 — audit and contract definition
**Scope:** `omnia-journey` customer-facing frontend
**Status:** Contract proposed for review; no production visual or behavioral changes were made
**Next pass:** Do not begin Pass 1 until this contract and the stale Welcome test assumptions are approved

## 1. Executive Summary

MySnoozePod already has a recognizable showroom system. Its strongest implementation is the combination of:

- the icy blue radial/linear page field in `src/components/showroom/ShowroomPrimitives.jsx`;
- large white/frosted frames and panels with blue-tinted elevation;
- slate typography with very heavy, compact headings;
- blue semantic emphasis centered most consistently on `#2f57e8`;
- centered MySnoozePod branding at entry screens and the three-region downstream header for task screens;
- generous rounded geometry, large touch controls, Snoozer presence, and explicit human-assistance affordances;
- hardware-specific, measurable layout constraints in `src/lib/podLayoutContract.js` and the Pod Playwright suites.

`ShowroomPrimitives.jsx` should become the primary visual foundation. It already supplies the right structural vocabulary, is used across all principal modern routes, and is the clearest point at which raw styling can later be replaced by semantic tokens without redesigning screens.

The largest sources of inconsistency are not the overall art direction; they are incomplete consolidation:

1. Four overlapping blue systems are in use: `#2f57e8`, `#1A66D2`, Tailwind `indigo-*`, and several `#315c...` values. The dark Ask Snoozer navy is a valid task-specific contrast color, while `omniaPurple`, `omniaGold`, and much of generic indigo are older vocabulary.
2. Poppins is configured and externally loaded only at weight 600, but `font-heading` is not used. The rendered product currently relies on Tailwind's default system sans stack while frequently requesting weights 700–900.
3. Radius and shadow choices are repeated as raw arbitrary values. The source contains many near-duplicates rather than a small elevation/shape system.
4. Active pages mix showroom primitives, generic UI controls, local Tailwind recipes, raw hex values, and some inline styles. `Layout.jsx`, Rewards, Assessment, and Snoozer presentation code are the clearest mixed-system areas.
5. Checkout is the most important active outlier: it is still a narrow generic ecommerce card and does not use the showroom shell, frame, panel, header, type hierarchy, or touch-oriented layout.

The repository is structurally ready to begin Pass 1: Welcome after this contract is accepted. Welcome is already mostly aligned, so Pass 1 should be a token/conformance and resilience pass, not a redesign. Before treating Pass 1 validation as authoritative, the four-digit Welcome tests must be updated to the current six-digit product contract. Product behavior must not be reverted to satisfy those stale assertions.

## 2. Current Visual Language

### 2.1 Styling architecture and precedence

Current styling comes from six layers:

| Layer | Current role | Audit finding |
|---|---|---|
| `tailwind.config.js` | Four old brand colors and a `heading` font family | Too small to describe the live system; `omniaPurple`, `omniaGold`, `omniaDark`, and `omniaGray` are not the dominant modern showroom vocabulary. |
| `src/styles/index.css` | Tailwind directives, Snoozer states, Rest Test motion, and short-viewport Pod overrides | Necessary special-purpose layer, but it contains product-specific layout overrides as well as global presentation behavior. |
| `ShowroomPrimitives.jsx` | Page field, frames, panels, headers, badges, tiles, dock/actions | De facto design system and strongest implementation. Values are still embedded directly in classes. |
| `src/components/ui/*` | Generic Button/Card/Input/ProductCard vocabulary | Older generic web/ecommerce system. It uses `indigo-*`, `gray-*`, small radii, and 40px controls that do not consistently meet showroom expectations. |
| Local Tailwind recipes | Most page and Pod component details | Necessary for composition, but currently responsible for color, type, radius, and elevation drift. |
| Inline styles/local constants | Dynamic values plus legacy layout and controls | Dynamic progress widths are appropriate; static color/layout recipes in `Layout.jsx`, `RewardsDrawer.jsx`, and legacy bars are not canonical. |

`src/index.css` is only a compatibility wrapper; `src/main.jsx` imports `src/styles/index.css` directly. `src/layouts/ShowroomLayout.jsx` is not part of the active route tree and imports a non-existent legacy Snoozer path, so it must not be treated as a current visual authority.

### 2.2 Color

The strongest current language is a cool showroom field, white/frosted surfaces, slate content, and a clear electric-blue action/accent.

| Existing value/family | Current use | Interpretation |
|---|---|---|
| `#2f57e8` | Eyebrows, icons, links, active accents, Welcome, Results, primitives | Best-supported canonical brand primary. It appears throughout the modern showroom implementation. |
| `#2749cb`, `#2340b8` | Hover/strong active states | Intentional darker companions to `#2f57e8`; consolidate under one strong/hover token. |
| `#eef3ff`, `#eef4ff`, `#f2f6ff`, `#f4f7ff` | Icon wells, selected/soft backgrounds, guidance surfaces | One semantic soft-brand family with too many raw variants. |
| `#dbe5ff`, `#d7e3ff`, `#d9e4ff`, `#cfe0ff` | Subtle borders and separators | One subtle brand-border family with page-specific drift. |
| `#1A66D2`, `#1550A0` | Assessment constant, Cart actions, older layout color constant, Snoozer animation glow | Coherent older blue lane, but less aligned with the modern primitives. Map to primary/strong during migration; do not mass-replace without contrast review. |
| Tailwind `indigo-*` | Generic Button/Input/Card flows, focus/hover states, Snoozer status, some primitive borders | Mixed. Status/focus usage can remain semantically mapped; generic action usage is historical drift. |
| `#315cf6`, `#315df3`, `#355ff1` | Pod/Rest/Sleep Essentials actions and progress | A saturated task-control lane very close to brand primary. Consolidate under primary unless a tested device-state distinction is required. |
| `#16315F`, `#102749` | Ask Snoozer user messages and commerce actions | Intentional dark conversational/commerce contrast. Preserve as a special-purpose `ink-action` token, not a competing global primary. |
| `slate-*` | Primary, secondary, and muted text; neutral borders | Strongest and most coherent neutral family. Prefer it over mixed `gray-*`. |
| `gray-*` | Generic UI, Snoozer presentation, Product Detail, Checkout | Older neutral vocabulary. Migrate gradually to semantic text/surface tokens. |
| `omniaPurple`, `omniaGold` | Tailwind theme only; occasional rewards use separate violet classes | Historical/unused as global brand colors. Gold may remain a rewards-only semantic accent if product intent is confirmed. |
| Emerald/amber/red | Success, warning, error | Intentional semantic variation; preserve but standardize tone pairs and contrast. |
| `#ff8f1f` and related pale orange values | Pod hardware/motion highlights | Intentional special-purpose physical-feature accent, not a global call-to-action color. |

### 2.3 Typography

- `index.html` loads Poppins only at weight 600.
- `tailwind.config.js` defines `fontFamily.heading = ["Poppins", "sans-serif"]`.
- No active source uses `font-heading`, and no global `font-family` applies Poppins.
- The actual rendered family is Tailwind's default `ui-sans-serif` system stack.
- The modern showroom voice is created by `font-black`/`font-extrabold`, tight tracking, and tight heading line heights—not by Poppins.
- Large page headings range from roughly 35px to 71px; task headings commonly land between 27px and 42px. Body copy is mostly 14–17px with 20–28px line heights.
- Eyebrows consistently use uppercase, weight 900, 11–14px sizing, and `0.16em`–`0.22em` tracking.
- Arbitrary sizes are frequent, but the hierarchy itself is recognizable. The incoherence is mostly implementation-level: near-identical sizes are expressed repeatedly, and older routes use generic 24/30px headings with 14px gray body text.

Until a deliberate typography decision is made, the canonical family should be the currently rendered system sans stack. Poppins should not be declared canonical on the evidence of an unused config entry and one incomplete font load. If Poppins is later adopted, load every required weight locally or reliably and migrate in a measured typography-only pass.

### 2.4 Radius

The modern shape language is deliberately soft and rounded. Natural categories already exist:

- outer frame: 34px;
- major panel: 28px;
- feature/card: usually 20–26px;
- controls: usually 14–18px;
- inputs: 18–20px on modern routes;
- pills/avatars: fully rounded.

Drift comes from repetition rather than lack of direction: the source uses 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32, and 34px arbitrary radii, plus Tailwind `md`, `lg`, `xl`, `2xl`, and `3xl`. The Pod layout contract's 16px card and 12px button radii are measurable compact-mode constraints and must remain valid as a density exception.

### 2.5 Shadows

The live system has four recognizable elevations:

- neutral subtle shadow (`shadow-sm`) for controls and small cards;
- low blue-tinted card shadow around `0 8–18px 18–40px` at 0.08–0.14 alpha;
- panel shadow around `0 16px 42px rgba(45,71,136,0.10)`;
- frame/dock shadow around `0 18–26px 42–74px` at 0.16 alpha.

These are visually coherent but expressed through dozens of one-off arbitrary shadows. Generic `shadow`, `shadow-md`, `shadow-lg`, and black rewards shadows form the competing older system.

### 2.6 Spacing

The most stable spacing rules are already captured by the Pod contract:

- 24px outer horizontal padding;
- 16px card padding;
- 12px main gap;
- 16px section gap.

Modern pages generally use 16px mobile/24px desktop gutters, 12–20px panel padding, 12–16px grid gaps, and 8–12px control gaps. Larger entry screens add 24–40px breathing room. Drift comes from unconstrained half-steps and page-local viewport compression rather than a fundamentally inconsistent rhythm.

### 2.7 Motion

Current intentional motion includes:

- Framer Motion page/section entrances: 250–420ms, usually opacity plus 10–18px vertical movement, `easeOut`;
- Snoozer states: speaking 420ms, warning 320ms, celebrate 550ms, thinking 1.1–1.2s, idle breathing 3.2s;
- Rest Test entrance 480ms and ambient breathing 6s;
- hover/focus transitions, generally using Tailwind's default transition duration;
- loading spinners and Snoozer streaming/type progression.

`prefers-reduced-motion` currently disables Rest Test visual animation only. Snoozer's infinite state animations and Framer Motion entrances do not yet share a complete reduced-motion contract.

## 3. Visual-System Drift

The following drift should be addressed incrementally, not by global search-and-replace:

1. **Tokens are implicit.** The strongest values live inside component class strings, so pages copy raw values instead of consuming semantic roles.
2. **Color lanes overlap.** `#2f57e8`, `#1A66D2`, `#315cf6`, and `indigo-600` often mean the same thing. Dark navy and orange are valid special-purpose colors; purple/gold are not evidence of the main showroom identity.
3. **Typography configuration does not match runtime.** Poppins appears configured but is not actually applied, while 900-weight system typography defines the live look.
4. **Generic UI defaults are undersized.** Generic Button and Input default to 40px height; the hardware contract requires at least 44px touch targets and identifies 48px as the standard button minimum.
5. **Static inline style systems remain.** `Layout.jsx`, `RewardsDrawer.jsx`, Header/Footer bars, and Settings use local color/layout objects. Dynamic progress widths are legitimate inline styles and should not be removed merely for purity.
6. **Rewards has two visual modes.** Its inline pill fits the new system; its floating purple gradient and fully inline-styled drawer belong to an older layer.
7. **Snoozer presentation is coherent but isolated.** It uses `gray-*`, `indigo-*`, and its own chrome/radius rules. It should remain special-purpose while consuming shared semantic color, type, focus, and motion tokens.
8. **Pod styling is distributed.** Its shell is canonical and its layout is highly tested, but its header, footer, Rest Test, Learn, and Builder components contain many raw values. Consolidation must preserve exact viewport budgets.
9. **Secondary routes remain generic or placeholder-only.** Product Detail, `/snoozepod`, Financing, FAQs, and developer Explore surfaces are outside the modern visual system.

## 4. Proposed Canonical Tokens

These tokens describe the existing strongest implementation. Names are semantic; implementation may later use CSS custom properties, Tailwind theme entries, or both.

### 4.1 Color tokens

| Token | Proposed value | Existing values mapped here | Use |
|---|---:|---|---|
| `color-brand-primary` | `#2f57e8` | `#2f57e8`, most `#315cf6`/`#315df3`, action uses of `indigo-600` | Primary actions, active icons, links, eyebrows. |
| `color-brand-strong` | `#2749cb` | `#2749cb`, `#2340b8`, `#1550A0` after contrast review | Hover, pressed, selected text. |
| `color-brand-soft` | `#eef3ff` | `#eef3ff`, `#eef4ff`, `#f2f6ff`, `#f4f7ff` | Icon wells, selected/quiet surfaces. |
| `color-brand-border` | `#dbe5ff` | `#dbe5ff`, `#d7e3ff`, `#d9e4ff`, `#cfe0ff` | Quiet dividers and blue-tinted borders. |
| `color-page` | gradient based on `#eef4ff`, `#f7faff`, `#f9fbff` | Current `ShowroomPageShell` background | Showroom page field only. |
| `color-text-primary` | Tailwind `slate-900` / `#0f172a` | `slate-900`, `slate-950`, older dark gray | Headlines and primary content. |
| `color-text-secondary` | Tailwind `slate-700` / `#334155` | `slate-700`, selected gray uses | Supporting task content. |
| `color-text-muted` | Tailwind `slate-500` / `#64748b` | `slate-400`–`600`, older gray uses | Labels, metadata, noncritical help. |
| `color-surface` | `#ffffff` | `white`, `#fff` | Opaque controls/cards. |
| `color-surface-elevated` | `rgba(255,255,255,0.94)` | `bg-white/88`–`bg-white/98` | Frosted frame/header/dock surfaces. |
| `color-ink-action` | `#16315F` | `#16315F`, `#102749` | Ask Snoozer user messages and approved high-contrast commerce actions only. |
| `color-success` | Tailwind `emerald-700` | current emerald states, `#12805c` | Confirmed completion/in-cart state. |
| `color-warning` | Tailwind `amber-700` | current amber states | Recoverable warnings and attention. |
| `color-error` | Tailwind `red-600` | current red states | Errors and destructive actions. |
| `color-hardware-accent` | `#ff8f1f` | orange Pod highlights | Physical/motion feature emphasis only. |

`#1A66D2` should be treated as a migration alias for `color-brand-primary`, not immediately replaced. `omniaPurple` and `omniaGold` should not be used for new general-purpose showroom UI. A rewards-specific violet/gold token may be approved separately.

### 4.2 Typography tokens

All tokens use the current Tailwind/system sans stack unless a separate Poppins decision is approved.

| Token | Weight | Size | Line height | Tracking | Typical use |
|---|---:|---:|---:|---:|---|
| `type-display` | 900 | `clamp(44px, 5vw, 68px)` | 0.92 | `-0.025em` | Welcome-only dominant statement. |
| `type-h1` | 900 | `clamp(32px, 4vw, 48px)` | 0.98 | `-0.025em` | Primary screen title. |
| `type-h2` | 900 | `clamp(28px, 3vw, 34px)` | 1.08 | `-0.02em` | Major task section. |
| `type-h3` | 800–900 | 20–24px | 1.2 | `-0.01em` | Section heading. |
| `type-card-heading` | 800–900 | 18–20px | 1.25 | `-0.01em` | Product/choice/card title. |
| `type-body-large` | 600 | 17–18px | 1.5 | normal | Lead/supporting explanation. |
| `type-body` | 400–600 | 16px | 1.5 | normal | Default readable content and inputs. |
| `type-supporting` | 500–600 | 14px | 1.45 | normal | Secondary descriptions and state copy. |
| `type-label` | 700–800 | 13–15px | 1.2 | normal | Controls, tabs, prices, short labels. |
| `type-eyebrow` | 900 | 11–13px | 1.2 | `0.18em` | Uppercase section context. |
| `type-microcopy` | 500–700 | 11–12px | 1.4 | 0–`0.08em` | Metadata, helper text, status. |

### 4.3 Spacing tokens

Use one 4px-based scale and prefer the following named steps:

| Token | Value | Use |
|---|---:|---|
| `space-1` | 4px | Fine internal separation only. |
| `space-2` | 8px | Tight control/internal gap. |
| `space-3` | 12px | Canonical main/card gap. |
| `space-4` | 16px | Canonical card padding and section gap. |
| `space-5` | 20px | Comfortable panel padding. |
| `space-6` | 24px | Desktop page gutter and major panel padding. |
| `space-8` | 32px | Major section separation. |
| `space-10` | 40px | Hero/entry separation. |
| `space-12` | 48px | Exceptional large-screen breathing room. |

Half-step values may remain where required by the locked Pod viewport budget, but new general-purpose components should use this scale.

### 4.4 Radius tokens

| Token | Value | Notes |
|---|---:|---|
| `radius-frame` | 34px | Current `ShowroomFrame`. |
| `radius-panel` | 28px | Current `ShowroomPanel` and major content groups. |
| `radius-card` | 20px | Default cards/tiles; compact Pod cards may use the tested 16px contract. |
| `radius-control` | 16px | Default button/tab; compact Pod controls may use the tested 12px contract. |
| `radius-input` | 18px | Text/code/select surfaces. |
| `radius-pill` | 9999px | Status pills, avatars, compact badges. |

### 4.5 Shadow tokens

| Token | Value | Use |
|---|---|---|
| `shadow-subtle` | `0 1px 2px rgba(15,23,42,0.08)` | Small controls and quiet cards. |
| `shadow-card` | `0 8px 18px rgba(40,63,126,0.08)` | Cards/tiles. |
| `shadow-panel` | `0 16px 42px rgba(45,71,136,0.10)` | Major panels. |
| `shadow-frame` | `0 26px 74px rgba(40,63,126,0.16)` | Outer frame and major floating dock. |
| `shadow-active` | `0 10px 24px rgba(47,87,232,0.14)` | Selected control only. |
| `ring-focus` | `0 0 0 4px rgba(47,87,232,0.18)` | Keyboard/touch focus; never communicate state by shadow alone. |

### 4.6 Motion tokens

| Token | Value | Use |
|---|---:|---|
| `motion-fast` | 160ms `ease-out` | Hover, focus, press, small state change. |
| `motion-standard` | 260ms `ease-out` | Tabs, panels, selection confirmation. |
| `motion-page-enter` | 360ms `ease-out` | Opacity plus at most 12px vertical movement. |
| `motion-celebrate` | 550ms `ease-out` | Existing Snoozer success pop. |
| `motion-ambient-snoozer` | 3.2s `ease-in-out` | Existing idle breathing only. |
| `motion-ambient-rest` | 6s `ease-in-out` | Existing Rest Test breathing only. |

Reduced motion must remove nonessential translation/scale, disable infinite breathing/pulsing, avoid smooth auto-scroll, and render final visible states immediately. Loading feedback may continue with a non-disorienting opacity change or static status.

## 5. Canonical Component Classification

| Component | Classification | Contract / cleanup boundary |
|---|---|---|
| `ShowroomPageShell` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative page field and text base. Replace embedded gradient colors with semantic tokens; keep full-height behavior configurable. |
| `ShowroomFrame` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative outer content frame. Tokenize 34px radius, border, surface, and frame shadow. |
| `ShowroomPanel` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative major surface with white/soft/frost tones. Tokenize tone recipes and radius/elevation. |
| `ShowroomEyebrow` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative eyebrow. Consume type/color tokens and avoid page overrides except density. |
| `ShowroomTopRail` | **CANONICAL** | Authoritative top gutter/max-width composition for entry and non-downstream pages. |
| `ShowroomDownstreamHeader` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative task header for Pod, Sleep Essentials, Ask Snoozer, and future Cart/Checkout convergence. Preserve three-region balance. |
| `ShowroomCartBadge` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative compact cart status/action. Enforce 44px minimum target and semantic count states. |
| `ShowroomModeButton` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative mode/tab control; currently embeds color, radius, and shadow recipes. |
| `ShowroomFooterDock` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative sticky decision/action dock where viewport tests permit it. Must not overlap primary content. |
| `ShowroomFooterAction` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative secondary dock action; its current 40px minimum conflicts with the 44px touch contract. |
| `ShowroomImageCard` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative image presentation with failure fallback. Align nested radius with card token. |
| `ShowroomTopicTile` | **CANONICAL BUT NEEDS CLEANUP** | Authoritative showroom topic/card link. Add focus-visible parity with hover. |
| generic `Button` | **LEGACY / GENERIC** | Useful internal primitive but not authoritative visually. Default 40px size, `rounded-md`, and `indigo-*` styling do not satisfy the showroom contract without overrides. |
| generic `Card` | **LEGACY / GENERIC** | Generic 8px gray card; do not use for new showroom surfaces. |
| generic `Input` | **LEGACY / GENERIC** | Generic 40px/`rounded-md` input with unresolved semantic class names; do not use for new showroom screens until restyled. |
| generic `ProductCard` | **SHOULD EVENTUALLY BE REPLACED** | Ecommerce-era gray/indigo card. Replace with a showroom product-card primitive when an active route needs it; preserve Shopify payload behavior. |
| `RewardsPill` | **CANONICAL BUT NEEDS CLEANUP** | Inline mode belongs in the showroom header; floating purple-gradient mode is legacy and should be retired after caller verification. |
| `RewardsDrawer` | **SPECIAL-PURPOSE** | Preserve rewards behavior and states, but migrate its static inline styles to showroom tokens/components. |
| `HumanAssistanceControl` | **SPECIAL-PURPOSE** | Authoritative human-presence control. Preserve Brandy identity and device signaling; tokenization only. |
| `SnoozerHUD` / implementation in `SnoozerPanel.jsx` | **SPECIAL-PURPOSE** | Authoritative reusable Snoozer presentation/state machine. Consume shared tokens without flattening state-specific presentation. |
| `SnoozerCue` | **LEGACY / GENERIC** | Older indigo/gray cue recipe using generic Button. Verify callers before replacement or removal. |
| `SnoozerPanel` default export alias | **SHOULD EVENTUALLY BE REPLACED** | Compatibility alias around the HUD implementation; consolidate naming only after caller/reachability proof. |
| `PodHeader` | **SPECIAL-PURPOSE** | Hardware-constrained Pod header. Align colors/type while preserving the 72px measured contract. |
| `PodFooterNav` | **SPECIAL-PURPOSE** | Hardware-constrained Pod navigation. Preserve 64px budget and active Rest Test controls. |
| `PodLearnPanel` | **SPECIAL-PURPOSE** | Uses canonical Panel but needs semantic feature colors and type tokens. |
| `PodRestPanels` | **SPECIAL-PURPOSE** | Preserve stage, audio, hardware, and fit contracts. Tokenize only inside existing measurable bounds. |
| `BuildYourPodPanel` / Pod builder presentation | **SPECIAL-PURPOSE** | Preserve Shopify resolution and step/layout contracts; gradually adopt semantic tokens. |

## 6. Screen-by-Screen Drift Inventory

Counts below are source indicators, not quality scores. “Arbitrary” refers to arbitrary Tailwind values found in the page file; nested components can add more.

| Screen / route | Shared primitives | Generic UI | Drift evidence and one-off rules | Classification |
|---|---|---|---|---|
| Welcome `/welcome` | PageShell, TopRail, BrandMark, Frame, Panel | None | 8 local hex values; 47 arbitrary values; 34/28/26/24/22/20/18px local radius recipes; bespoke two-column hero; 420ms Framer entrance; no inline styles. The six code fields and touch sizing are intentionally local. | **Mostly aligned** |
| What To Expect `/what-to-expect` | PageShell, TopRail, BrandMark, Frame | None | 8 local hex values; 23 arbitrary values; local StepCard surface/elevation recipe; 300ms entrance. Layout is a strong extension of the showroom system but copies token values. | **Mostly aligned** |
| Assessment `/assessment` | PageShell, TopRail, BrandMark, Frame, Eyebrow | Button | 13 local hex values including `#1A66D2`; 28 arbitrary values; 6 inline styles (dynamic progress plus static action colors/cursors); local brand constant; generic Button overridden per use; several local card/control recipes. | **Partially aligned** |
| Results `/results` | PageShell, TopRail, BrandMark, Frame, Panel, Eyebrow | None | 3 local hex values; 17 arbitrary values; three inline animation-delay values; local image and recommendation tile recipes. Strong shell/type hierarchy; repeated card recipes should become primitives. | **Mostly aligned** |
| Pod Experience `/pod/:podId` | PageShell, DownstreamHeader, CartBadge, Frame, Panel | None in page; legacy Button exists in older builder code | Canonical shell plus a large special-purpose subsystem. Page has little raw color, but PodHeader/Footer/Learn/Rest contain numerous local colors, radii, and exact height/padding values. One-off rules are justified by 72/116/64px region budgets and short-viewport tests. | **Partially aligned** |
| Sleep Essentials `/sleep-essentials` | PageShell, DownstreamHeader, CartBadge, Panel | None | 11 local hex values; 18 arbitrary values; local category tabs and product cards; saturated `#315df3` lane; sticky action panel; short-viewport CSS also targets embedded essentials cards. | **Partially aligned** |
| Cart `/cart` | PageShell, TopRail, BrandMark, Frame, Panel, Eyebrow | None | 5 local hex values; 30 arbitrary values; bespoke product rows, quantity control, totals, and confirmations; `#1A66D2` action lane; violet rewards island; TopRail rather than DownstreamHeader. Functionally resilient but visually split. | **Partially aligned** |
| Checkout `/checkout/*` | None | Button | Generic `max-w-3xl` white card, 8/16px radii, gray/indigo palette, 64px thumbnails, mouse/web density, no brand/header/Snoozer/human presence. Reads as a generic ecommerce review page. | **Significant drift** |
| Ask Snoozer `/ask-snoozer` | PageShell, TopRail, DownstreamHeader, CartBadge, Frame, Panel, Eyebrow | None | 8 local hex values; 44 arbitrary values; dedicated chat transcript/composer/product-card recipes. Dark navy is an intentional conversational contrast; numerous blue border variants and local radii remain token drift. | **Partially aligned** |
| Product Detail `/products/:slug` | None | None | Generic gray/indigo two-column ecommerce layout with 8px cards/controls; no showroom shell or downstream header. | **Significant drift** |
| SnoozePod plan `/snoozepod` | None | Button | Older gray/indigo account/cart layout; local rewards/coupon cards; overlaps conceptually with modern Pod builder and Cart. | **Significant drift** |
| Financing `/financing` and FAQs `/faqs` | None | None | Plain centered “Coming Soon” placeholders. Routed customer surfaces without showroom presentation. | **Significant drift** |
| Explore `/explore-dev` | None | Button/ProductCard-era patterns | Explicit legacy/developer route; generic layout and controls. `/explore` redirects to Pod and is not an active customer visual surface. | **Significant drift, low migration priority** |

The most important outliers are Checkout first, then Product Detail and `/snoozepod`. Cart is not a generic ecommerce page anymore; it is substantially modernized but still has rewards/header/action vocabulary that differs from the downstream system.

## 7. Frontend Polish 100-Point Scorecard

Every reviewed screen receives 0–10 points in each category, for 100 total. Scores must cite observed evidence at the target viewport(s); they must not be inferred from source appearance alone.

### 7.1 Purpose

- **0–3:** The screen's task is absent, misleading, or discoverable only after exploration; primary action is unclear.
- **4–6:** The task can be understood, but competing messages/actions or vague copy delay orientation.
- **7–8:** Most shoppers can identify purpose and next action within a few seconds; minor ambiguity remains.
- **9–10:** Purpose, state, and next action are immediately unmistakable, including loading/empty/error branches.

### 7.2 Visual Hierarchy

- **0–3:** No clear focal point; key action competes with decoration or secondary content.
- **4–6:** A focal point exists, but weight, grouping, or ordering is inconsistent.
- **7–8:** Primary, secondary, and supporting layers are clear at the target viewport.
- **9–10:** Hierarchy remains clear across responsive, error, loading, long-copy, and selected states.

### 7.3 System Consistency

- **0–3:** Mostly one-off colors, type, spacing, radii, shadows, or generic web components.
- **4–6:** Uses some canonical structure but visibly mixes systems or duplicates token recipes.
- **7–8:** Uses canonical primitives/tokens with only bounded special-purpose exceptions.
- **9–10:** Fully conforms; any exception is documented, reusable, and tested.

### 7.4 Showroom Ergonomics

- **0–3:** Mouse-scale targets, dense controls, difficult reach, or interactions inappropriate at arm's length.
- **4–6:** Main actions are usable by touch, but secondary controls or spacing are inconsistent.
- **7–8:** Targets meet minimums, grouping supports reach and scanning, and common tasks are comfortable.
- **9–10:** All states and controls are confidently usable at arm's length, including error recovery and assistive controls.

### 7.5 Viewport Fit

- **0–3:** Critical clipping, overlap, page overflow, buried primary action, or accidental scrolling.
- **4–6:** Main state fits but some supported viewport/state combinations overflow or require avoidable scrolling.
- **7–8:** Critical content/actions fit all declared target viewports; only intentional bounded scrolling remains.
- **9–10:** Automated measurements verify no overflow/overlap/text escape and full action visibility across all supported states.

### 7.6 Interaction Clarity

- **0–3:** Controls look like content, selection/disabled state is ambiguous, or feedback is missing.
- **4–6:** Primary interaction is understandable but secondary, selected, disabled, or response states are weak.
- **7–8:** Affordances and state changes are obvious, prompt, and consistent.
- **9–10:** Keyboard/touch/focus/pressed/disabled/loading/success/error behaviors are all explicit and tested.

### 7.7 Content Density

- **0–3:** Website-like density, excessive choices, redundant content, or large unused areas hide the task.
- **4–6:** Content is usable but one or more areas are crowded, repetitive, or under-prioritized.
- **7–8:** Most visible elements earn space and the kiosk task can be scanned quickly.
- **9–10:** Density remains disciplined across real data extremes without sacrificing comprehension or recovery.

### 7.8 Brand Continuity

- **0–3:** Screen could belong to an unrelated generic site/app.
- **4–6:** Some brand elements appear, but page field, structure, color, type, or transitions break continuity.
- **7–8:** Clearly belongs to MySnoozePod and connects naturally to adjacent journey screens.
- **9–10:** Brand continuity survives all responsive and exceptional states without decorative excess.

### 7.9 Snoozer / Human Presence

- **0–3:** Required help/presence is missing, duplicated, obstructive, or competes with the task.
- **4–6:** Presence exists but placement, timing, voice, or escalation level is inconsistent.
- **7–8:** Snoozer and human assistance appear at the correct level and preserve task focus.
- **9–10:** Presence adapts appropriately to route/device/state, remains accessible, and is validated without duplication or overlap.

### 7.10 Finish & Resilience

- **0–3:** Missing or broken loading, empty, error, success, image failure, focus, touch, or transition states.
- **4–6:** Happy path is finished but multiple realistic exceptional states fall back to generic or fragile UI.
- **7–8:** Key exceptional states are intentional, readable, recoverable, and visually aligned.
- **9–10:** Full state matrix is polished, accessible, device-tested, reduced-motion safe, and resilient to real content extremes.

Scores of 90+ should be rare and require runtime evidence. A high visual score cannot offset a failing hardware acceptance gate; any P0 overflow, overlap, touch-target, or checkout-authority regression blocks acceptance regardless of total.

## 8. Device and Layout Acceptance Standards

The existing technical standards are part of this contract and must not be weakened for visual convenience.

### 8.1 Declared Pod viewports

- Primary: **1180×820**.
- Additional full-state coverage: **1024×768**, **1366×768**, **1600×900**, **1920×899**, **1920×860**.
- Short-height text-route coverage: **1280×585** and **1280×560**.

### 8.2 Pod region budgets

At 1180×820:

- header: 72px;
- navigation: 64px;
- product hero: 116px;
- outer vertical allowance: 24px;
- section gaps: 36px;
- active content budget: 508px;
- active content top: no lower than 288px;
- minimum visible active content: 490px.

At 768px height, minimum visible active content is 430px. At 585px, the nominal active-content budget is 273px with a 253px visible minimum. For heights at or below 640px, the helper recalculates an active budget with a 220px floor and visible minimum with a 210px floor.

### 8.3 Interaction and geometry

- minimum touch target: **44×44px**;
- standard button minimum height: **48px**;
- compact contract card radius: **16px**;
- compact contract button radius: **12px**;
- outer horizontal padding: **24px**;
- card padding: **16px**;
- main gap: **12px**;
- section gap: **16px**.

### 8.4 Automated acceptance behavior

The Pod measurement/strict suite requires:

- required header, navigation, hero, and active-content regions;
- no horizontal or vertical document overflow beyond a 1px tolerance;
- no active-content scroll caused by accidental overflow;
- no measured region/control overlap;
- each primary action at least 95% visible;
- no touch target below 44px;
- header, navigation, and hero heights within 2px of their budgets;
- active content starts no lower than the budget and retains its minimum visible height;
- all hero descendants and mattress images remain contained;
- text cards do not use hidden/clip overflow, do not exceed client height, and do not let text cross card padding or viewport boundaries;
- no unexpected clipped/scrolling shell containers;
- build review, essentials, success, and action rows stay contained and actionable.

The Rest Test suite additionally checks the real Pod route at 1280×585, 1280×560, 1920×899, and 1920×860 across entry, position, recalibration, zero-gravity, snore, final, paused, and completion states. It requires no document/active/panel overflow, no hidden controls, valid assets, persistent audio/session behavior, and visible pose/state transitions.

The Welcome device configuration targets 1180×820 and expects no document scrolling for Welcome-adjacent kiosk screens. That standard remains valid even though parts of the current Welcome test data are stale.

## 9. Stale/Conflicting Tests Identified

| Test | Conflict | Required correction |
|---|---|---|
| `tests/runWelcomeDevicePolishTests.mjs` | Asserts `pastedDigits.length === 4` and `nextCode.length === 4`; production source defines `SNOOZE_CODE_LENGTH = 6`. The test currently fails at the first four-digit assertion. | Assert the shared six-digit contract or, preferably, avoid hard-coding the length independently. Preserve six-digit product behavior. |
| `tests/welcome-device-layout.spec.cjs` | Test name, mocked shopper IDs, field count, paste payload, and expected values all assume four digits. | Convert fixtures/assertions to six digits and continue checking focus, paste, auto-submit, and single request behavior. |
| `tests/welcome-device-layout.spec.cjs` What To Expect copy assertion | Expects “Welcome to your Snooze Session,” while the current source fallback branches are “Let’s start with your Snooze Assessment.” and “Let’s take a look at your recommended pods.” | Assert the branch-appropriate current orientation copy or the semantic destination, not an obsolete welcome phrase. |
| `tests/rest-test-mvp.spec.cjs` | Treats only controls below 36px as short while the shared Pod contract requires 44px minimum touch targets. The stricter Pod measurement may catch this elsewhere, but the Rest-specific assertion is weaker. | Align the Rest Test threshold to 44px; do not lower the shared contract. |
| Poppins configuration | Not a test, but a contract mismatch: HTML loads only weight 600, config defines a heading family, and active source never uses it. | Add a future explicit font-loading/usage test only if Poppins is approved; otherwise remove the dead configuration in a later cleanup pass. |

Validation performed during Pass 0:

- `npm run test:welcome-device` — **failed as expected** on the stale four-digit assertion.
- `npm run build` — **passed**; Vite emitted only the existing CJS deprecation, stale Browserslist data, and large-bundle warnings.

No Playwright behavior was changed and no production behavior was modified to make stale tests pass.

## 10. Recommended Migration Order

1. **Approve this contract and repair test authority.** Update six-digit Welcome expectations and the weaker Rest touch threshold before using those suites as polish acceptance evidence.
2. **Create semantic token definitions without changing rendered output.** Introduce color/type/spacing/radius/shadow/motion tokens mapped to current primitive values. Add visual snapshots or computed-style assertions before migrating callers.
3. **Pass 1: Welcome.** Migrate raw values to tokens, confirm typography/focus/reduced-motion/error states, and validate 1180×820 plus supported compact viewports. Do not redesign the flow.
4. **What To Expect and Results.** These are the closest structural siblings to Welcome and should establish reusable orientation, result-image, and recommendation-tile recipes.
5. **Assessment.** Remove static inline color recipes and generic Button styling while preserving question logic, auto-advance, voice timing, and submission behavior.
6. **Shared headers and presence.** Consolidate TopRail/DownstreamHeader usage, Rewards inline mode, Cart badge, and Human Assistance without changing route/device ownership.
7. **Pod Experience.** Tokenize PodHeader/Footer/Learn/Rest/Builder only behind the existing measurement suite. Never alter measured budgets merely to match a general page token.
8. **Sleep Essentials.** Align tabs/product cards/action dock after Pod embedded essentials styling is stable, preserving Shopify availability and cart authority.
9. **Cart.** Move rewards/header/actions onto canonical components while preserving all cart synchronization, recovery, and Checkout Lounge handoff behavior.
10. **Checkout.** Recompose the generic review card with canonical showroom structure. Preserve Shopify as checkout authority and the device-specific lounge restriction.
11. **Ask Snoozer.** Keep its intentional dark conversational lane; extract reusable chat, product-result, and composer recipes and add reduced-motion/focus rules.
12. **Secondary and legacy surfaces.** Product Detail, `/snoozepod`, Financing, FAQs, Explore developer UI, legacy Snoozer aliases, and unused layouts should be migrated, redirected, or removed only after route/caller reachability decisions.

## 11. Risks / Things We Should Not Change Yet

- Do not mass-replace every blue with `#2f57e8`. Ask Snoozer navy, hardware orange, semantic statuses, and tested selection contrast have distinct roles.
- Do not declare Poppins canonical or apply it globally without loading the needed weights and validating text metrics at every hardware viewport.
- Do not normalize all radii/shadows in one sweep. Pod fit and short-height containment can change from small geometry differences.
- Do not weaken the 44px touch target, 48px standard button, overflow, overlap, containment, or primary-action visibility requirements.
- Do not change the six-digit Snooze Code product contract to satisfy old four-digit tests.
- Do not alter Welcome auto-submit, What To Expect voice-completion routing, Assessment flow, Results ranking, Pod/Rest state, recommendation behavior, rewards logic, or device guards as part of visual migration.
- Do not change Shopify-authoritative product, variant, price, availability, cart, or checkout behavior.
- Do not treat `/explore-dev`, compatibility wrappers, or unused layouts as visual authority merely because they remain in source.
- Do not remove Snoozer components, aliases, or legacy UI primitives without caller and active-route reachability evidence.
- Do not equate a passing build with showroom acceptance. Each polished screen still requires target-viewport runtime evidence, exceptional-state coverage, and physical-device acceptance where applicable.

## Pass 0 Change Record

- Added `FRONTEND_VISUAL_SYSTEM_CONTRACT.md`.
- No files under `omnia-journey/src`, no tests, no routes, no backend contracts, and no production configuration were changed.
- No deployment, commit, or push was performed.
