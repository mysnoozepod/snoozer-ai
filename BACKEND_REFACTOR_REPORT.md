# Backend Refactor Report

## 1. Summary of what changed

- `index.js` is thinner than the prior architecture pass and now dispatches `/ask-snoozer` and `/ask` into a dedicated route module.
- Route-specific handling for HUD, identity, assessment, booking, Shopify passthroughs, canonical recommendation resolution, and Ask Snoozer is now owned by route modules.
- The governed Ask Snoozer stack is now explicit:
  - route ownership in [routes/askSnoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\askSnoozerRoutes.js)
  - deterministic answer/policy/quality services in `services/askSnoozer*`
  - constrained model fallback via [services/openai.js](C:\Users\14342\Desktop\snoozer-ai\services\openai.js)
- Legacy product data files were not deleted blindly, but `products.json` and `searchProducts.js` were removed from the Lambda package so stale bundled product truth is no longer deployed.

## 2. Files changed

- [index.js](C:\Users\14342\Desktop\snoozer-ai\index.js)
- [routes/askSnoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\askSnoozerRoutes.js)
- [services/askSnoozerAnswerEngine.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerAnswerEngine.js)
- [services/snoozerVoice.js](C:\Users\14342\Desktop\snoozer-ai\services\snoozerVoice.js)
- [package.json](C:\Users\14342\Desktop\snoozer-ai\package.json)
- [BACKEND_ROUTE_INVENTORY.md](C:\Users\14342\Desktop\snoozer-ai\BACKEND_ROUTE_INVENTORY.md)
- [ASSISTANT_PATH_INVENTORY.md](C:\Users\14342\Desktop\snoozer-ai\ASSISTANT_PATH_INVENTORY.md)
- [COMMERCE_TRUTH_INVENTORY.md](C:\Users\14342\Desktop\snoozer-ai\COMMERCE_TRUTH_INVENTORY.md)
- [BACKEND_REFACTOR_REPORT.md](C:\Users\14342\Desktop\snoozer-ai\BACKEND_REFACTOR_REPORT.md)

## 3. Files added

- [routes/hudRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\hudRoutes.js)
- [routes/identityRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\identityRoutes.js)
- [routes/assessmentRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\assessmentRoutes.js)
- [routes/bookingRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\bookingRoutes.js)
- [routes/recommendationRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\recommendationRoutes.js)
- [routes/askSnoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\askSnoozerRoutes.js)
- [BACKEND_ROUTE_INVENTORY.md](C:\Users\14342\Desktop\snoozer-ai\BACKEND_ROUTE_INVENTORY.md)
- [ASSISTANT_PATH_INVENTORY.md](C:\Users\14342\Desktop\snoozer-ai\ASSISTANT_PATH_INVENTORY.md)
- [COMMERCE_TRUTH_INVENTORY.md](C:\Users\14342\Desktop\snoozer-ai\COMMERCE_TRUTH_INVENTORY.md)
- [BACKEND_REFACTOR_REPORT.md](C:\Users\14342\Desktop\snoozer-ai\BACKEND_REFACTOR_REPORT.md)
- [BACKEND_ASSISTANT_PRODUCT_TRUTH_CLOSURE_REPORT.md](C:\Users\14342\Desktop\snoozer-ai\BACKEND_ASSISTANT_PRODUCT_TRUTH_CLOSURE_REPORT.md)

## 4. Routes moved

- `/hud/ask`
- `/hud/script`
- `/identity/snooze-code`
- `/identity/check-in`
- `/content/assessment`
- `/content/assessment/meta`
- `/assessment-questions`
- `/assessment`
- `/assessment/:shopperId`
- `/booking/calendly-webhook`
- `/calendly/webhook`
- `/shopify/listProducts`
- `/shopify/getProduct`
- `/shopify/createCart`
- `/shopify/cart`
- `/shopify/cart/get`
- `/shopify/cart/addLines`
- `/shopify/cart/updateLines`
- `/shopify/cart/removeLines`
- `/recommendations/:shopperId`
- `/recommendations/resolve`
- `/ask-snoozer`
- `/ask`

## 5. Routes left in `index.js` and why

- `/voice/welcome` and `/hud/tts`
  - still coupled to centralized Polly helpers and response handling
- `/session/start` and `/session/context/:sessionId`
  - still tightly tied to local SCO/session helper logic in `index.js`
- `/admin/reindex`
  - small admin-only route; low cleanup value in this pass
- `/crm/track-event`
  - trivial telemetry route
- `/iot/trigger-scene`
  - operational device route with low benefit from extraction in this pass

## 6. Assistant paths found

- Primary conversational path: `/ask-snoozer` in [routes/askSnoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\askSnoozerRoutes.js)
- Primary deterministic HUD path: `/hud/ask` in [routes/hudRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\hudRoutes.js)
- Primary scripted HUD path: `/hud/script` via [services/hudScripts.js](C:\Users\14342\Desktop\snoozer-ai\services\hudScripts.js)
- Primary answer engine stack:
  - [services/askSnoozerAnswerEngine.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerAnswerEngine.js)
  - [services/askSnoozerPolicy.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerPolicy.js)
  - [services/askSnoozerQualityGate.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerQualityGate.js)
- Supporting constrained fallback/model path:
  - [services/openai.js](C:\Users\14342\Desktop\snoozer-ai\services\openai.js)

## 7. Commerce truth risks found

1. [services/openai.js](C:\Users\14342\Desktop\snoozer-ai\services\openai.js) still contains some legacy orchestration shape, but its live role is now explicitly constrained to fallback/model helper work.
2. [products.json](C:\Users\14342\Desktop\snoozer-ai\products.json) still looks like a product source, so this pass quarantined it from the Lambda zip to reduce live-truth confusion.
3. Rewards flows are adjacent to commerce and customer identity, but should not be confused with cart/checkout truth.

## 8. Legacy / duplicate logic found

- `/ask` is a compatibility alias to `/ask-snoozer`
- `/calendly/webhook` is a compatibility alias to `/booking/calendly-webhook`
- `/shopify/createCart` is a compatibility alias to `/shopify/cart`
- [services/openai.js](C:\Users\14342\Desktop\snoozer-ai\services\openai.js) still overlaps some responsibilities with the newer Ask Snoozer answer-engine stack, but the governed route now uses it only as the constrained fallback/model lane
- [services/askSnoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerRoutes.js) is a helper, not a controller, despite its name
- [routes/snoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\snoozerRoutes.js) is a directory artifact, not an active route module
- [products.json](C:\Users\14342\Desktop\snoozer-ai\products.json) and [searchProducts.js](C:\Users\14342\Desktop\snoozer-ai\searchProducts.js) remain in-repo as legacy artifacts but are no longer bundled into the Lambda package

## 9. Tests run

- `node --check index.js`
- `node --check routes/hudRoutes.js`
- `node --check routes/identityRoutes.js`
- `node --check routes/assessmentRoutes.js`
- `node --check routes/bookingRoutes.js`
- `node --check routes/recommendationRoutes.js`
- `node --check routes/askSnoozerRoutes.js`
- `node tests/runRecommendationResolverTests.js`
- `node tests/runHudAskCanonicalSmoke.js`
- `node tests/runHudKnowledgeVoiceTests.js`
- `node tests/runAskSnoozerCanonicalTests.js`
- `node tests/runBookingWebhookRouteTests.js`
- `node tests/runSnoozeCodeRouteTests.js`
- `node tests/runAskSnoozerGoldenTests.js`
- `npm run package:lambda`

## 10. Test results

- Syntax checks passed for `index.js` and all extracted route modules.
- `runRecommendationResolverTests.js` passed.
- `runHudAskCanonicalSmoke.js` passed.
- `runHudKnowledgeVoiceTests.js` passed.
- `runAskSnoozerCanonicalTests.js` passed.
- `runBookingWebhookRouteTests.js` passed.
- `runSnoozeCodeRouteTests.js` passed.
- `runAskSnoozerGoldenTests.js` passed all `141 / 141`.
- `npm run package:lambda` rebuilt `snoozer-backend.zip` successfully.

## 11. Tests skipped and reason

- No validation commands were skipped in this pass.

## 12. Behavior intentionally preserved because it was unclear

- Rewards stayed in-place because the route family was already modular enough and not the main stabilization target.
- HUD response contract was preserved exactly rather than semantically reshaped.
- Ask Snoozer behavior was preserved structurally; only narrow wording/clarification fixes were made to satisfy the governed golden expectations.

## 13. Confirmation that cart / checkout behavior was preserved

Cart and checkout behavior were preserved. The live cart and checkout boundary still runs through Shopify Storefront-backed routes in [routes/shopifyRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\shopifyRoutes.js) and [services/shopify.js](C:\Users\14342\Desktop\snoozer-ai\services\shopify.js).

## 14. Recommended next backend pass

1. Pull session/SCO routes out of `index.js` into a dedicated session route module.
2. Narrow [services/openai.js](C:\Users\14342\Desktop\snoozer-ai\services\openai.js) further so its public role becomes model transport/fallback only.
3. Decide whether [products.json](C:\Users\14342\Desktop\snoozer-ai\products.json) should be archived or deleted now that it is quarantined from the Lambda artifact.
4. Clean up the misleading helper name [services/askSnoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerRoutes.js) and the stray directory artifact [routes/snoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\snoozerRoutes.js).
