# Unified Truth + Remnant Consolidation Report

## Scope

This pass followed `SESSION_CART_TRUTH_AUDIT.md` and consolidated frontend ownership for shopper/session/cart/recommendation state without changing cart, checkout, recommendation scoring, backend identity logic, or customer-facing routes.

Baseline at resume:

- Branch: `main`
- Previous commit: `3a73ff5 Add session cart truth audit`
- Existing dirty worktree included unrelated prior files and generated/debug artifacts. Those were left alone unless they were part of the consolidation path.

## Files Changed

Frontend state/API ownership:

- `omnia-journey/src/state/sessionStore.js`
- `omnia-journey/src/lib/session/shopifyCartState.js`
- `omnia-journey/src/lib/useStore.js`
- `omnia-journey/src/lib/api.js`
- `omnia-journey/src/lib/apiBase.js`
- `omnia-journey/src/lib/useSnoozerSession.js`
- `omnia-journey/src/lib/snoozer/askSnoozerPage.js`

Frontend consumers:

- `omnia-journey/src/Layout.jsx`
- `omnia-journey/src/pages/Welcome.jsx`
- `omnia-journey/src/pages/WhatToExpect.jsx`
- `omnia-journey/src/pages/Assessment.jsx`
- `omnia-journey/src/pages/Results.jsx`
- `omnia-journey/src/pages/Pod.jsx`
- `omnia-journey/src/pages/Cart.jsx`
- `omnia-journey/src/pages/Checkout.jsx`
- `omnia-journey/src/pages/ProductDetail.jsx`
- `omnia-journey/src/components/PodBuilder.jsx`
- `omnia-journey/src/components/SnoozerPanel.jsx`

Backend:

- `index.js`

Artifacts:

- `omnia-journey/snoozer-ui.zip`
- `snoozer-backend.zip`

## Files Added

- `omnia-journey/src/lib/apiBase.js`
- `UNIFIED_TRUTH_REMNANT_CONSOLIDATION_REPORT.md`

## Files Removed Or Quarantined

No files were deleted or quarantined in this pass. Removal was intentionally deferred because several route and artifact files were already dirty before this pass, and the safer move was to consolidate active ownership without deleting potentially active remnants.

## Shopper And Session Identity

`sessionStore.js` is now the primary adapter for shopper/session identity in the React showroom app.

- Added canonical helpers for `shopperId`, `accessCode`, and `sessionId`.
- Preserved legacy storage mirrors so existing flows still hydrate after refresh.
- Updated Welcome, Assessment, Pod, Cart, Checkout, Product Detail, Pod Builder, Layout, and Snoozer session/page helpers to read identity through the shared store/helpers instead of directly owning raw keys.

Remaining compatibility reads:

- Some page-level raw storage reads remain only as refresh/backward-compatibility fallbacks for existing deployed users.
- These should be retired after one stable deployment cycle.

## Cart Identity

`shopifyCartState.js` is now the primary frontend adapter for Shopify cart ID and checkout URL persistence.

- `useStore.js` delegates cart persistence and cleanup to `shopifyCartState.js`.
- `api.js`, `Cart.jsx`, `Checkout.jsx`, `ProductDetail.jsx`, and `SnoozerPanel.jsx` use the shared cart adapter instead of duplicating cart ID persistence.
- Shopify/backend remain the commerce truth path.

## Assessment And Recommendation Context

`useStore.js` now owns the in-app assessment and recommendation cache.

- `Assessment.jsx` no longer duplicates assessment writes after using store setters.
- `Results.jsx` writes generated canonical/local recommendations into store through `setRecommendations`.
- `Pod.jsx`, `Cart.jsx`, `ProductDetail.jsx`, and `askSnoozerPage.js` prefer store recommendation context, with raw storage fallback for refresh compatibility.

## Ask Snoozer And HUD Context

`askSnoozerPage.js` now builds identity/context from shared frontend adapters first:

- Identity comes from `sessionStore.js`.
- Cart identity comes from `shopifyCartState.js`.
- Assessment/recommendation context comes from `useStore.js`.

No `/ask-snoozer` or `/hud/ask` routing behavior was changed in this pass.

## Backend Remnant Cleanup

`index.js` had local HUD response contract logic duplicated from `utils/responseContract.js`.

- Updated `index.js` to import and use `enforceHudContract` from `utils/responseContract.js`.
- Removed duplicate local HUD action sanitization/contract logic.
- Removed the now-unused local numeric helper left behind by that cleanup.

No backend endpoint behavior was intentionally changed.

## Validation

Passed:

- `npm run build` in `omnia-journey`
- `node --check index.js`
- `node tests/runRecommendationResolverTests.js`
- `node tests/runHudAskCanonicalSmoke.js`
- `node tests/runHudKnowledgeVoiceTests.js`
- `node tests/runAskSnoozerCanonicalTests.js`
- `node tests/runAskSnoozerGoldenTests.js`

Known non-failing warnings:

- Vite chunk-size warning.
- Browserslist/caniuse-lite age warning.
- Some HUD tests logged S3 timeout warnings for fast test fallbacks, but assertions passed.
- Ask Snoozer canonical tests log missing `OPENAI_API_KEY` in local mode, but deterministic/mock coverage passed.

## Remaining Known Remnants

- Raw storage fallback reads remain in selected pages for refresh compatibility.
- Older dirty files not part of this pass remain in the worktree, including prior HUD/voice/booking/debug artifact changes.
- Generated screenshot/debug folders under `_out/` remain untracked.
- No stale route or component files were deleted in this pass.

## Recommended Next Pass

1. Deploy backend and frontend artifacts from this pass.
2. Smoke test `/welcome`, `/assessment`, `/results`, `/pod/:podId`, `/ask-snoozer`, `/cart`, `/checkout/guest`, and `/checkout/:id`.
3. After one stable deployment, remove raw storage fallback reads that are no longer needed.
4. Do a separate stale-file quarantine pass with a clean worktree so deletions are safe and reviewable.
