# Showroom Stability Verification Report

Date: 2026-07-07

## Phase Result

Pass with notes. The regression matrix surfaced one real backend route regression in the Ask Snoozer commerce lane. The fix was surgical: pass the already-loaded `shopifySvc` dependency from `index.js` into `routes/askSnoozerRoutes.js`.

## Baseline Commits

- Unified Truth consolidation baseline: `f336c5e`
- Ask Snoozer hotfix baseline: `8b84968`

## Issue Found And Fixed

### Ask Snoozer commerce path crash

Prompt:

```text
What is the best value option?
```

Observed failure before fix:

```text
shopifySvc is not defined
```

Root cause:

- `index.js` still loaded `services/shopify` into `shopifySvc`.
- `routes/askSnoozerRoutes.js` referenced `shopifySvc?.fetchProductsByHandles`.
- The extracted route dependency bag did not include `shopifySvc`, so the commerce branch crashed at runtime.

Fix:

- Add `shopifySvc` to the dependency destructuring in `routes/askSnoozerRoutes.js`.
- Pass `shopifySvc` from `index.js` into `handleAskSnoozerRoutes`.

Result after fix:

- `POST /ask-snoozer` passed all five prompt cases.
- `POST /ask` alias passed all five prompt cases.
- No `ReferenceError` or `safeNumber is not defined` leak.
- No invented checkout URL, cart ID, or Shopify GID in the tested prompts.

## Backend Validation

| Command | Result | Notes |
| --- | --- | --- |
| `node --check index.js` | Pass | Syntax ok. |
| `node --check routes/askSnoozerRoutes.js` | Pass | Syntax ok. |
| `node --check tests/runAskSnoozerRouteSmokeTests.js` | Pass | Syntax ok. |
| `node tests/runAskSnoozerRouteSmokeTests.js` | Pass | 10 cases: 5 prompts across `/ask-snoozer` and `/ask`. |
| `node tests/runRecommendationResolverTests.js` | Pass | 5 fixtures plus route smoke passed. |
| `node tests/runAskSnoozerCanonicalTests.js` | Pass | 4 canonical Ask Snoozer tests passed. |
| `node tests/runAskSnoozerGoldenTests.js` | Pass | 141/141 passed. |
| `node tests/runHudAskCanonicalSmoke.js` | Pass with note | HUD answers stayed grounded; intermittent S3 timeout log for `meta/catalog.json`. |
| `node tests/runHudKnowledgeVoiceTests.js` | Pass with note | HUD tests passed; intermittent S3 timeout logs for `meta/catalog.json` and `meta/canon.json`. |
| `node tests/runSnoozeCodeRouteTests.js` | Pass | 7 tests passed. |
| `node tests/runCustomerProfileRouteSkipSmoke.js` | Pass with note | Missing table skip behavior passed; local `.env` included Zoho credentials and produced a Zoho test sync/create. |

## Frontend Validation

| Command / Check | Result | Notes |
| --- | --- | --- |
| `npm run build` in `omnia-journey` | Pass | Vite build completed. |
| Local production preview route smoke | Pass with notes | `/`, `/welcome`, `/what-to-expect`, `/assessment`, `/results`, `/pod/3`, `/pod/4`, `/ask-snoozer`, `/cart`, `/checkout/guest` mounted without blank-screen crash. |

Frontend preview notes:

- `/assessment` rendered fallback/local question content after API question fetch failed in static preview.
- `/results` rendered `Preparing your pod matches` without seeded assessment context.
- Browser console logged local API fetch failures because static preview was not paired with a reachable backend API base for every request.

## Stability Notes

- Ask Snoozer route extraction is now safer because the commerce path dependency is included in the explicit route dependency bag.
- S3 retrieval fallback behavior is still doing useful work: HUD tests passed despite timeout logs. The timeout logs are worth monitoring, but they did not break this matrix.
- Local tests with real `.env` can hit Zoho. For future pure-local verification, prefer env isolation or mocked Zoho credentials when running smoke tests that are meant to be no-side-effect.

## Packaging

- Backend runtime files changed, so `npm run package:lambda` was run.
- `snoozer-backend.zip` was rebuilt.
- No frontend source changed, so no frontend/theme zip was rebuilt.

## Files Intentionally Changed

- `index.js`
- `routes/askSnoozerRoutes.js`
- `tests/runAskSnoozerRouteSmokeTests.js`
- `snoozer-backend.zip`
- `SHOWROOM_REGRESSION_MATRIX.md`
- `SHOWROOM_STABILITY_VERIFICATION_REPORT.md`

## Existing Dirty Files Not Touched By This Pass

The repo already had unrelated modified and untracked files before this pass, including prior frontend artifacts, screenshots, Phase 3 idempotency files, and Phase 4 audit artifacts. They were not staged for this commit.
