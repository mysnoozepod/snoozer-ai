# Showroom Regression Matrix

Date: 2026-07-07

Scope: verification pass after the Unified Truth consolidation (`f336c5e`) and Ask Snoozer hotfix (`8b84968`), with one surgical backend fix found during the pass.

## Frontend Routes

| Area | Route | Expected behavior | Verification performed | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| Welcome | `/`, `/welcome` | Redirect/root entry renders Welcome screen with Snooze Code input and start action. | Production preview route smoke. | Pass | Root redirected to `/welcome`; input and start button rendered. |
| What to Expect | `/what-to-expect` | Guided showroom path renders with step cards and assessment CTA. | Production preview route smoke. | Pass | Page rendered; no blank-screen crash. |
| Assessment | `/assessment` | Assessment shell renders, questions remain reachable, fallback works if API question fetch fails. | Production preview route smoke plus DOM inspection. | Pass with note | Local preview logged API fetch failures because the static preview could not reach backend API, but fallback question content rendered. |
| Results | `/results` | Results route should not blank-screen before recommendation context is available. | Production preview route smoke. | Pass with note | Rendered `Preparing your pod matches`; full result data requires assessment/session context. |
| Pod Experience | `/pod/3`, `/pod/4` | Pod pages render hero, rest-test choices, footer actions, and cart badge. | Production preview route smoke. | Pass | Both pod routes rendered without route crash. |
| Ask Snoozer | `/ask-snoozer` | Chat page renders textarea, send button, prompt chips, and footer actions. | Production preview route smoke. | Pass | Textarea and Send button rendered. |
| Cart | `/cart` | Empty cart route renders controlled empty state and checkout/back actions. | Production preview route smoke. | Pass | Empty cart state rendered. |
| Checkout | `/checkout/guest` | Guest checkout route renders controlled cart review state without blank-screen crash. | Production preview route smoke. | Pass | Empty cart review rendered. |

## Backend Routes

| Area | Endpoint | Expected behavior | Verification performed | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| Ask Snoozer | `POST /ask-snoozer` | Returns HTTP 200, JSON, renderable text, no runtime reference leak, no invented checkout/cart truth for common prompts. | `node tests/runAskSnoozerRouteSmokeTests.js` | Pass | Expanded to 5-prompt matrix. |
| Ask Snoozer alias | `POST /ask` | Same smoke coverage as `/ask-snoozer` alias. | `node tests/runAskSnoozerRouteSmokeTests.js` | Pass | Covers all five prompts. |
| Recommendations | `POST /recommendations/resolve` | Canonical resolver returns fixture outputs. | `node tests/runRecommendationResolverTests.js` | Pass | 5 fixture tests plus route smoke passed. |
| HUD Ask | `POST /hud/ask` | Canonical/contextual HUD answer paths remain stable. | `node tests/runHudAskCanonicalSmoke.js` | Pass with note | Response remained grounded; intermittent S3 timeout logs observed locally. |
| HUD Knowledge/Voice | `POST /hud/ask` knowledge and voice paths | Product-fit, couple-conflict, policy, and voice-friendly answer checks pass. | `node tests/runHudKnowledgeVoiceTests.js` | Pass with note | S3 timeout fallback observed for catalog/canon in one case; answer stayed grounded. |
| Snooze Code / Identity | `/assessment`, `/identity/check-in`, `/ask-snoozer`, rewards balance | Snooze Code identity and canonical profile continuity remain stable. | `node tests/runSnoozeCodeRouteTests.js` | Pass | 7 route tests passed. |
| Customer Profile Skip | `/assessment`, `/hud/ask`, `/ask-snoozer` | Missing `CUSTOMER_PROFILE_TABLE` skips cleanly without customer-facing failures. | `node tests/runCustomerProfileRouteSkipSmoke.js` | Pass with note | Local `.env` contained Zoho credentials; one test synced/created a Zoho test contact. |

## Ask Snoozer Prompt Matrix

| Prompt | `/ask-snoozer` | `/ask` alias | Expected guardrails |
| --- | --- | --- | --- |
| `hello` | Pass | Pass | Renderable text, no runtime leak. |
| `Do I need a firmer mattress?` | Pass | Pass | Deterministic/product-fit path allowed; no crash. |
| `Compare my top pods` | Pass | Pass | Deterministic comparison path allowed; no crash. |
| `What is the best value option?` | Pass after fix | Pass after fix | Commerce path must not throw and must not invent checkout/cart IDs. |
| `Why do I wake up tired?` | Pass | Pass | Safe answer path, no unsupported medical/product claim required by test. |

## Validation Commands

```powershell
node --check index.js
node --check routes/askSnoozerRoutes.js
node --check tests/runAskSnoozerRouteSmokeTests.js
node tests/runAskSnoozerRouteSmokeTests.js
node tests/runRecommendationResolverTests.js
node tests/runAskSnoozerCanonicalTests.js
node tests/runAskSnoozerGoldenTests.js
node tests/runHudAskCanonicalSmoke.js
node tests/runHudKnowledgeVoiceTests.js
node tests/runSnoozeCodeRouteTests.js
node tests/runCustomerProfileRouteSkipSmoke.js
cd omnia-journey
npm run build
```

## Route Smoke Caveats

- Local static preview used `http://127.0.0.1:4173`; backend-dependent browser calls can log `Failed to fetch` if the API base is unavailable from that preview environment.
- This pass did not perform live deployed browser testing or checkout/cart side effects.
- Existing dirty/untracked repo files outside this pass were intentionally left untouched.
