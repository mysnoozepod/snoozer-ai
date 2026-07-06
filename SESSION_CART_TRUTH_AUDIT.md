# Session + Cart Truth Audit

Repo: `mysnoozepod/snoozer-ai`  
Scope: frontend-only audit of shopper/session/cart/recommendation identity paths in the React showroom app.  
Date: 2026-07-06

This document is audit-only. It records the current state observed in the repo and recommends a consolidation target for the next implementation pass.

## 1. Current state owners

| File | Value owned/read/written | Storage mechanism | Route/component using it | Risk | Notes |
| --- | --- | --- | --- | --- | --- |
| `omnia-journey/src/state/sessionStore.js` | canonical-ish session state: `shopperId`, `threadId`, `cartId`, `checkoutUrl`, `context`, `contextPatch`, mirrored legacy cart/access code fields | `sessionStorage` via `snooze.sessionState.v1`, `snooze.cartSession.v1`, plus legacy mirror keys | shared adapter | Medium | This is the best current candidate for primary shopper/session identity ownership, but it does not yet own all call sites. |
| `omnia-journey/src/lib/session/shopifyCartState.js` | Shopify cart GID + checkout URL persistence/normalization | `sessionStorage` legacy keys + `sessionStore` bridge | shared cart helper | Low | Cleanest current home for Shopify cart persistence. |
| `omnia-journey/src/lib/api.js` | `sessionId`, cart/checkout persistence, assessment question cache, API request boundary | `sessionStorage`, `localStorage`, backend API | shared API layer | High | Good API boundary, but still directly owns persistence for `snooze.sessionId`, cart keys, and question cache. |
| `omnia-journey/src/lib/useStore.js` | cart items, Shopify cart meta, assessment, assessment summary, recommended products, recommended product handles | Zustand + `sessionStorage` | shared app store | High | Owns major UI state, but also duplicates cart persistence and recommendation persistence that overlap with `sessionStore` and page-level writes. |
| `omnia-journey/src/pages/Welcome.jsx` | `snooze.accessCode`, `snooze.shopperId`, clears `snooze.snapshot`, `snooze.shopperState` | direct `sessionStorage` writes | `/welcome` | High | Current shopper identity bootstrap happens here in page code instead of through a shared adapter. |
| `omnia-journey/src/pages/WhatToExpect.jsx` | reads `snooze.accessCode` / `snooze.shopperId`, reads/writes `snooze.snapshot`, `snooze.shopperState` | direct `sessionStorage` writes + `getAssessment()` | `/what-to-expect` | High | Owns snapshot hydration state directly. |
| `omnia-journey/src/pages/Assessment.jsx` | reads `snooze.accessCode`, writes `snooze.assessment`, `snooze.assessmentSummary`, also updates Zustand assessment state | direct `sessionStorage` + `useStore` + backend `saveAssessment()` | `/assessment` | High | Same values are written both to store and raw storage. |
| `omnia-journey/src/pages/Results.jsx` | reads `snooze.accessCode`, `snooze.assessment`; writes `snooze.recommendations`, `snooze.recommendedProductHandles`, resets `snooze.snoozepod`, `snooze.snoozepod.meta` | direct `sessionStorage` | `/results` | High | Recommendation/result context is page-owned here instead of going through a shared result/session adapter. |
| `omnia-journey/src/pages/Pod.jsx` | reads `snooze.accessCode`, `snooze.assessment`, `snooze.recommendations`; writes regenerated `snooze.recommendations` | direct `sessionStorage` | `/pod/:podId` | High | Pod route consumes recommendation context from raw storage and can overwrite it. |
| `omnia-journey/src/pages/Cart.jsx` | reads `snooze.accessCode`, consumes Zustand cart meta, also falls back to `getSessionState()` legacy cart identity | Zustand + `sessionStore` + direct read | `/cart` | Medium | Better than some routes, but still resolves shopper identity directly from raw storage. |
| `omnia-journey/src/pages/Checkout.jsx` | reads `snooze.accessCode`, consumes Zustand cart meta, also falls back to `getSessionState()` | Zustand + `sessionStore` + direct read | `/checkout` | Medium | Similar split as Cart. |
| `omnia-journey/src/pages/ProductDetail.jsx` | persists checkout/cart identity to Zustand, `sessionStore`, and raw legacy session keys | Zustand + `sessionStore` + direct `sessionStorage` | `/products/:handle` style route | High | Triple-write pattern keeps legacy readers alive but creates duplicate ownership. |
| `omnia-journey/src/components/SnoozerPanel.jsx` | reads checkout URL from raw legacy keys, writes checkout URL back to legacy keys | direct `sessionStorage` | shared Snoozer panel | High | HUD/assistant surface still bypasses cart/session helpers. |
| `omnia-journey/src/components/PodBuilder.jsx` | pod-specific build selection context, shopper key fallback | direct `sessionStorage` | build/customize surfaces | Medium | Pod selection context is intentionally local, but shopper identity fallback is still raw. |
| `omnia-journey/src/lib/snoozer/askSnoozerPage.js` | ask-snoozer conversation ID, shopper/access code fallback, assessment read, cart ID fallback | direct `sessionStorage` + `getSessionState()` | `/ask-snoozer` page helper | High | Reads across both new and legacy owners. |
| `omnia-journey/src/lib/useSnoozerSession.js` | `threadId`, `sessionId`, transcript, last mode, last context, shopper identity fallback | direct `sessionStorage` | Snoozer session hook | High | This is a second session owner parallel to `sessionStore` and `api.js`. |
| `omnia-journey/src/Layout.jsx` | reads `snooze.accessCode` / `snooze.shopperId` for global shopper context, writes `snooze.hudMuted`, `snooze.points` | direct `sessionStorage` | app shell | Low for cart/session, Medium for shopper read | Not a primary owner, but still reads shopper identity outside shared adapter. |
| `omnia-journey/src/pages/Explore.jsx` | legacy recommendation/cart writes: `snooze.assessment`, `snooze.cartId`, `snooze.checkoutUrl`, `snooze.shopify.checkoutUrl`, `snooze.contextPatch` | direct `sessionStorage` | legacy explore route | High | Legacy route still mutates cart/recommendation state directly and should be treated carefully in consolidation. |

## 2. Direct storage writes

Observed direct `sessionStorage` / `localStorage` writes related to shopper/session/cart/recommendation state:

### Shopper identity / access code

- `omnia-journey/src/pages/Welcome.jsx`
  - writes `snooze.accessCode`
  - writes `snooze.shopperId`
  - removes `snooze.snapshot`
  - removes `snooze.shopperState`
- `omnia-journey/src/state/sessionStore.js`
  - mirrors legacy `snooze.accessCode` through canonical state persistence

### Session identity / thread / conversation

- `omnia-journey/src/lib/api.js`
  - writes `snooze.sessionId` to `sessionStorage`
  - writes `snooze.sessionId` to `localStorage`
- `omnia-journey/src/lib/useSnoozerSession.js`
  - writes `snooze.sessionId`
  - writes `snooze.threadId`
  - writes `snooze.chatTranscript`
  - writes `snooze.mode`
  - writes `snooze.lastContext`
  - removes `snooze.chatTranscript`
  - removes `snooze.lastContext`
- `omnia-journey/src/lib/snoozer/askSnoozerPage.js`
  - writes `snooze.askSnoozer.conversationId`
- `omnia-journey/src/state/sessionStore.js`
  - writes canonical `snooze.sessionState.v1`
  - writes `snooze.cartSession.v1`
  - mirrors `snooze.threadId`

### Assessment / recommendation / result context

- `omnia-journey/src/pages/Assessment.jsx`
  - writes `snooze.assessment`
  - writes `snooze.assessmentSummary`
- `omnia-journey/src/pages/WhatToExpect.jsx`
  - writes `snooze.snapshot`
  - writes `snooze.shopperState`
- `omnia-journey/src/pages/Results.jsx`
  - writes `snooze.recommendations`
  - writes `snooze.recommendedProductHandles`
  - resets `snooze.snoozepod`
  - resets `snooze.snoozepod.meta`
- `omnia-journey/src/pages/Pod.jsx`
  - writes `snooze.recommendations`
- `omnia-journey/src/pages/Explore.jsx`
  - writes `snooze.contextPatch`
  - writes cart/checkout legacy keys after Snoozer checkout creation
- `omnia-journey/src/lib/useStore.js`
  - writes `snooze.assessment`
  - writes `snooze.assessmentSummary`
  - writes `snooze.recommendedProducts`
  - writes `snooze.recommendedProductHandles`
- `omnia-journey/src/lib/api.js`
  - writes assessment question cache:
    - `snooze.assessmentQuestions.etag`
    - `snooze.assessmentQuestions.body`

### Cart / checkout identity

- `omnia-journey/src/lib/api.js`
  - writes `snooze.shopify.cartId`
  - writes `snooze.cartId`
  - writes `snooze.shopify.checkoutUrl`
  - writes `snooze.checkoutUrl`
- `omnia-journey/src/lib/useStore.js`
  - writes `snooze.shopify.cartId`
  - writes `snooze.cartId`
  - writes `snooze.shopify.checkoutUrl`
  - writes `snooze.checkoutUrl`
  - removes the same on clear
- `omnia-journey/src/lib/session/shopifyCartState.js`
  - writes/removes legacy cart keys
  - also routes through `setCartIdentity()`
- `omnia-journey/src/state/sessionStore.js`
  - writes canonical cart identity into `snooze.sessionState.v1`
  - mirrors legacy `snooze.cartId`, `snooze.checkoutUrl`, `snooze.shopify.cartId`, `snooze.shopify.checkoutUrl`
- `omnia-journey/src/pages/ProductDetail.jsx`
  - writes `snooze.checkoutUrl`
  - writes `snooze.shopify.checkoutUrl`
  - writes `snooze.cartId`
  - writes `snooze.shopify.cartId`
- `omnia-journey/src/components/SnoozerPanel.jsx`
  - writes `snooze.checkoutUrl`
  - writes `snooze.shopify.checkoutUrl`
- `omnia-journey/src/pages/Explore.jsx`
  - writes `snooze.cartId`
  - writes `snooze.checkoutUrl`
  - writes `snooze.shopify.checkoutUrl`

### Pod/build selection context

- `omnia-journey/src/components/PodBuilder.jsx`
  - writes pod-specific builder state via `storageKeyForPod(pod)`

## 3. Direct storage reads

Observed direct reads related to shopper/session/cart/recommendation state:

### Shopper identity

- `omnia-journey/src/pages/Welcome.jsx`
  - reads `snooze.accessCode`
- `omnia-journey/src/pages/WhatToExpect.jsx`
  - reads `snooze.accessCode`
  - reads `snooze.shopperId`
- `omnia-journey/src/pages/Assessment.jsx`
  - reads `snooze.accessCode`
- `omnia-journey/src/pages/Results.jsx`
  - reads `snooze.accessCode`
- `omnia-journey/src/pages/Pod.jsx`
  - reads `snooze.accessCode`
- `omnia-journey/src/pages/Cart.jsx`
  - reads `snooze.accessCode`
- `omnia-journey/src/pages/Checkout.jsx`
  - reads `snooze.accessCode`
- `omnia-journey/src/components/PodBuilder.jsx`
  - reads `snooze.shopperId`
  - reads `snooze.accessCode`
- `omnia-journey/src/lib/snoozer/askSnoozerPage.js`
  - reads `snooze.accessCode`
  - reads `snooze.shopperId`
- `omnia-journey/src/lib/useSnoozerSession.js`
  - reads `snooze.accessCode`
- `omnia-journey/src/Layout.jsx`
  - reads `snooze.accessCode`
  - reads `snooze.shopperId`

### Session identity / conversation

- `omnia-journey/src/lib/api.js`
  - reads `snooze.sessionId` from `sessionStorage`
  - reads `snooze.sessionId` from `localStorage`
  - also checks `getSessionState()`
- `omnia-journey/src/lib/useSnoozerSession.js`
  - reads `snooze.sessionId`
  - reads `snooze.threadId`
  - reads `snooze.chatTranscript`
  - reads `snooze.mode`
  - reads `snooze.lastContext`
- `omnia-journey/src/lib/snoozer/askSnoozerPage.js`
  - reads `snooze.askSnoozer.conversationId`

### Assessment / recommendations / results

- `omnia-journey/src/pages/WhatToExpect.jsx`
  - reads `snooze.snapshot`
- `omnia-journey/src/pages/Assessment.jsx`
  - reads shopper identity only, then stores in both Zustand and raw storage
- `omnia-journey/src/pages/Results.jsx`
  - reads `snooze.assessment`
- `omnia-journey/src/pages/Pod.jsx`
  - reads `snooze.assessment`
  - reads `snooze.recommendations`
- `omnia-journey/src/pages/Explore.jsx`
  - reads `snooze.assessment`
- `omnia-journey/src/lib/snoozer/askSnoozerPage.js`
  - reads `snooze.assessment`
- `omnia-journey/src/lib/useStore.js`
  - reads `snooze.assessment`
  - reads `snooze.assessmentSummary`
  - reads `snooze.recommendedProducts`
  - reads `snooze.recommendedProductHandles`

### Cart / checkout identity

- `omnia-journey/src/lib/session/shopifyCartState.js`
  - reads `snooze.cartId`
  - reads `snooze.checkoutUrl`
  - reads `snooze.shopify.cartId`
  - reads `snooze.shopify.checkoutUrl`
  - also reads `getSessionState()`
- `omnia-journey/src/lib/api.js`
  - reads cart key candidates from legacy keys
- `omnia-journey/src/lib/useStore.js`
  - reads `snooze.shopify.cartId`
  - reads `snooze.cartId`
  - reads `snooze.shopify.checkoutUrl`
  - reads `snooze.checkoutUrl`
- `omnia-journey/src/pages/Cart.jsx`
  - reads Zustand cart identity
  - falls back to `getSessionState()`
- `omnia-journey/src/pages/Checkout.jsx`
  - reads Zustand cart identity
  - falls back to `getSessionState()`
- `omnia-journey/src/pages/ProductDetail.jsx`
  - relies on store cart identity but also keeps legacy readers warm
- `omnia-journey/src/components/SnoozerPanel.jsx`
  - reads `snooze.shopify.checkoutUrl`
  - reads `snooze.checkoutUrl`
- `omnia-journey/src/lib/snoozer/askSnoozerPage.js`
  - reads `snooze.shopify.cartId`
  - reads `snooze.cartId`

### Pod/build context

- `omnia-journey/src/components/PodBuilder.jsx`
  - reads pod-specific builder state from `storageKeyForPod(pod)`

## 4. Duplicate ownership risks

### A. Shopper identity is not single-owned

The same logical shopper identity is currently spread across:

- `snooze.accessCode`
- `snooze.shopperId`
- `sessionStore().shopperId`

Primary duplicate owners:

- `Welcome.jsx`
- `WhatToExpect.jsx`
- `Assessment.jsx`
- `Results.jsx`
- `Pod.jsx`
- `Cart.jsx`
- `Checkout.jsx`
- `PodBuilder.jsx`
- `Layout.jsx`
- `askSnoozerPage.js`
- `useSnoozerSession.js`

Risk:

- new routes can read stale identity if one key updates and another does not
- shopper bootstrap logic is page-owned instead of centralized
- next consolidation pass could break routing if raw readers are missed

### B. Session identity is split between two systems

Current parallel systems:

- `api.js` owns `snooze.sessionId`
- `useSnoozerSession.js` also owns `snooze.sessionId`
- `sessionStore.js` owns `threadId` and related canonical state, but not all `sessionId` usage
- `askSnoozerPage.js` owns its own `snooze.askSnoozer.conversationId`

Risk:

- frontend session lineage can drift between API session, Snoozer thread, and page conversation
- difficult to reason about which ID should be sent to backend when resuming a flow

### C. Cart identity has four overlapping owners

Current overlapping owners:

- `sessionStore.js`
- `shopifyCartState.js`
- `useStore.js`
- `api.js`

Additional direct writers:

- `ProductDetail.jsx`
- `SnoozerPanel.jsx`
- `Explore.jsx`

Risk:

- cart GID / checkout URL can stay alive in legacy keys even after one layer thinks it was cleared
- difficult to know whether Zustand or session canonical state is the final source
- old routes can keep rehydrating stale cart identity back into the app

### D. Recommendation/result context is fragmented

Current overlapping owners:

- `Assessment.jsx` raw write
- `useStore.js`
- `Results.jsx`
- `Pod.jsx`
- `Explore.jsx`
- `askSnoozerPage.js` read path

Keys involved:

- `snooze.assessment`
- `snooze.assessmentSummary`
- `snooze.recommendations`
- `snooze.recommendedProducts`
- `snooze.recommendedProductHandles`

Risk:

- results and pod pages can rely on different snapshots of the same assessment/recommendation session
- a refresh on one route may not match route state or store state from another route

### E. Pod/build context is semi-isolated but still identity-coupled

`PodBuilder.jsx` appropriately stores pod-specific local configuration, but it still derives shopper identity directly from raw storage.

Risk:

- build state itself is okay to stay local
- identity coupling should still move behind a shared adapter

## 5. Proposed consolidation target

### Observed current state

- `sessionStore.js` is already the closest thing to a canonical shopper/session adapter.
- `shopifyCartState.js` is already the cleanest cart-specific helper.
- `api.js` is already the backend boundary, but still contains persistence behavior that leaks into state ownership.
- `useStore.js` is useful for UI state and cached data, but it is too stateful to be the identity source of truth.

### Proposed change

Preferred ownership model for the next implementation pass:

#### Primary shopper/session identity owner

- `omnia-journey/src/state/sessionStore.js`

Own:

- shopper identity
  - `shopperId`
  - `accessCode` compatibility mirror only if needed
- frontend thread/session linkage
  - `threadId`
  - shared context patch metadata

Should become the only supported write path for:

- Snooze Code bootstrap
- shopper ID updates
- assistant context patch persistence

#### Primary Shopify cart persistence owner

- `omnia-journey/src/lib/session/shopifyCartState.js`

Own:

- Shopify cart GID persistence
- checkout URL persistence
- normalization/extraction of cart IDs

All cart identity writes should route through this helper or through `sessionStore` helper methods that delegate to it.

#### Backend boundary

- `omnia-journey/src/lib/api.js`

Keep:

- request construction
- backend calls
- response normalization

Reduce over time:

- direct ownership of `snooze.sessionId`
- direct cart mirror writes

#### UI state/cache owner

- `omnia-journey/src/lib/useStore.js`

Keep:

- cart line items
- visual state
- cached recommended product lists if still useful for UI rendering

Retire progressively:

- raw cart identity persistence responsibilities
- duplicated ownership of recommendation state where page/session helpers already exist

#### Route/page behavior

Pages should stop writing raw identity/cart keys directly when a shared helper exists.

## 6. Safe next implementation order

### Order 1: shopper identity bootstrap

Change first:

- `omnia-journey/src/pages/Welcome.jsx`
- `omnia-journey/src/pages/WhatToExpect.jsx`
- `omnia-journey/src/Layout.jsx`

Why first:

- these files define and fan out shopper identity very early in the journey
- consolidating them first lowers risk for all downstream pages

Replace first:

- raw `snooze.accessCode` / `snooze.shopperId` writes in `Welcome.jsx`
- raw shopper reads in `WhatToExpect.jsx` and `Layout.jsx`

### Order 2: assessment and recommendation state handoff

Change next:

- `omnia-journey/src/pages/Assessment.jsx`
- `omnia-journey/src/pages/Results.jsx`
- `omnia-journey/src/pages/Pod.jsx`

Why next:

- these three routes own the main showroom recommendation chain
- they currently duplicate assessment and recommendation persistence

Replace next:

- page-level raw writes of `snooze.assessment`
- page-level raw writes of `snooze.assessmentSummary`
- page-level raw writes of `snooze.recommendations`
- page-level raw writes of `snooze.recommendedProductHandles`

### Order 3: Shopify cart identity consolidation

Change next:

- `omnia-journey/src/lib/api.js`
- `omnia-journey/src/lib/useStore.js`
- `omnia-journey/src/lib/session/shopifyCartState.js`
- `omnia-journey/src/pages/ProductDetail.jsx`
- `omnia-journey/src/components/SnoozerPanel.jsx`
- `omnia-journey/src/pages/Cart.jsx`
- `omnia-journey/src/pages/Checkout.jsx`

Why next:

- cart identity is currently duplicated the most heavily
- Product Detail and SnoozerPanel still write raw keys after helper-based writes already occur elsewhere

Replace next:

- raw legacy cart writes in `ProductDetail.jsx`
- raw checkout URL writes in `SnoozerPanel.jsx`
- duplicated cart persistence in `api.js` and `useStore.js`

### Order 4: Snoozer session lineage cleanup

Change after the above:

- `omnia-journey/src/lib/useSnoozerSession.js`
- `omnia-journey/src/lib/snoozer/askSnoozerPage.js`

Why later:

- these are higher risk because they affect conversational continuity
- safer to unify shopper/cart identity first so these hooks can consume a stable base

### Order 5: legacy/edge routes last

Leave until later:

- `omnia-journey/src/pages/Explore.jsx`
- any old page-specific legacy storage consumers not in the active showroom flow

Why later:

- lower-value route compared with Welcome → Assessment → Results → Pod → Cart/Checkout
- higher chance of hidden regressions if changed too early

## 7. Validation checklist for next pass

After the consolidation pass, validate in this exact order:

### Welcome / shopper bootstrap

- `/welcome`
  - enter Snooze Code
  - confirm shopper identity persists
  - confirm no duplicate stale shopper values remain after refresh

### Pre-assessment routing

- `/what-to-expect`
  - confirm snapshot hydrate still works
  - confirm assessment-complete branch still behaves correctly

### Assessment chain

- `/assessment`
  - answer questions
  - confirm progress and save still work
  - confirm `Finish & View Results` still routes correctly

### Results chain

- `/results`
  - confirm top recommendation still renders
  - confirm compare-next pods still render
  - refresh and confirm recommendation context still resolves consistently

### Pod context

- `/pod/:podId`
  - confirm pod page still receives correct recommendation/assessment context
  - confirm Rest Test, Learn, and Build still load the right pod

### Cart chain

- add products from Product Detail / Build / Snoozer flow
- `/cart`
  - confirm cart line items persist
  - confirm checkout URL/cart GID stay valid after refresh

### Checkout handoff

- `/checkout`
  - confirm cart reuse logic still works
  - confirm checkout handoff opens the correct Shopify checkout

### Ask Snoozer / session continuity

- `/ask-snoozer`
  - confirm shopper identity is present
  - confirm conversation/session continuity still works
  - confirm cart-aware assistant actions still see current cart identity

## Summary findings

### Observed in repo

- The codebase already has the right direction for consolidation:
  - `sessionStore.js` for shopper/session identity
  - `shopifyCartState.js` for Shopify cart persistence
  - `api.js` for backend calls
- The main issue is not missing architecture. It is duplicated live ownership.
- The highest-risk duplication areas are:
  1. shopper identity bootstrap
  2. cart identity persistence
  3. assessment/recommendation state handoff
  4. Snoozer session lineage

### Recommended next pass

Do the next implementation pass as a narrow consolidation pass, not a redesign:

1. unify shopper identity writes behind `sessionStore.js`
2. unify cart identity writes behind `shopifyCartState.js` / `sessionStore.js`
3. move Results/Pod recommendation persistence off raw page writes
4. only then fold Snoozer session helpers into the same truth path
