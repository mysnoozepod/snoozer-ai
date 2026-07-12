# Snoozer Product Logic + Policy Copy Microfix Report

## 1. Starting Branch / Latest Commit

- Branch: `main`
- Baseline commit before this microfix: `f5f3482 Patch Snoozer answer copy precision`
- Scope: backend answer-quality microfix only.

## 2. Dirty Worktree Baseline

The repo already had unrelated dirty and untracked files before this pass. They were intentionally left alone and were not staged.

Unrelated tracked dirty files left alone:

- `omnia-journey/src/components/RewardsDrawer.jsx`
- `omnia-journey/src/lib/apiClient.ts`
- `omnia-journey/src/lib/snoozer/hud/fetchHudScript.js`
- `omnia-journey/src/lib/snoozer/voice/fetchHudAudio.js`
- `omnia-journey/src/lib/voice.js`
- `services/bookingSession.js`
- `services/calendlyWebhookIdempotency.js`
- `tests/runPhase3CalendlyIdempotencyTests.js`

Unrelated untracked artifacts left alone:

- `_out/`
- `phase4-audit/`
- `s3-audit/`
- screenshot/debug artifacts
- prior temporary CloudWatch/idempotency JSON files
- prior phase test harness files not part of this microfix

## 3. Files Changed

- `services/askSnoozerAnswerEngine.js`
- `services/askSnoozerPolicy.js`
- `services/askSnoozerResponsePresenter.js`
- `services/snoozerVoice.js`
- `tests/askSnoozerGoldenSet.json`
- `tests/runAskSnoozerCanonicalTests.js`
- `tests/runAskSnoozerGoldenTests.js`
- `tests/runAskSnoozerRouteSmokeTests.js`
- `snoozer-backend.zip`

## 4. Files Added

- `SNOOZER_PRODUCT_LOGIC_POLICY_COPY_MICROFIX_REPORT.md`

## 5. Exact Defects Fixed

- Removed internal customer-facing phrases from Ask Snoozer answers: `exact mattress match`, `matched setup`, `back or stomach sleeper support`, `No Base`, and `No Motion`.
- Fixed couple-conflict answers so different-firmness guidance points to `12-dual-comfort-hybrid` instead of assigning split-feel benefits to `14-hybrid`.
- Deduped return-policy language so the answer no longer repeats the same return/exchange idea.
- Strengthened help-me-decide answers with practical test criteria: lower-back support, shoulder/hip pressure, and best/worst comparison.
- Shortened deterministic side-sleeper guidance to avoid backend ellipsis/truncation while preserving pressure-relief guidance.

## 6. Partner Movement / Dual Comfort Logic Correction

- Couple-conflict response building now looks beyond the primary mattress handle and uses available candidate/product truth for `12-dual-comfort-hybrid`.
- Partner movement now leads with motion separation or in-person movement comparison.
- Different firmness now uses `12-inch Dual Comfort Hybrid` language when available.
- Guardrails now fail if a response claims `14-inch Hybrid` gives each partner separate firmness.

## 7. Internal Phrase Cleanup

- Canonical reason labels were changed from internal labels to customer-facing language.
- Golden and route smoke tests now ban the internal phrases listed above.
- Recommendation explanation now says the product is the `strongest fit from your assessment` instead of an internal match label.

## 8. Return Policy Dedupe Fix

- Policy answers now use one concise return/exchange sentence.
- Removed the awkward opener `Yes, that falls under the return policy.`
- Kept final-sale language source-safe and did not add unsupported categories.

## 9. Help-Me-Decide Improvement

- Help-me-decide answers now use actual top pod IDs when available.
- The answer tells the shopper what to notice while testing: lower-back support, shoulder/hip pressure, and which pod feels best or worst.
- The answer no longer only restates the top recommendation.

## 10. Side-Sleeper Truncation Finding

- Backend truncation: yes, possible in deterministic voice shaping when answers exceed the compact response limit.
- Fix applied: shortened the side-sleeper deterministic answer so tested Ask Snoozer responses no longer end with ellipsis.
- Frontend truncation: not changed in this pass. A frontend chat-display review may still be useful separately, but the tested backend side-sleeper answer is no longer backend-truncated.

## 11. Delivery Source Truth Status

- Delivery behavior was left source-safe.
- Repo/S3 mirror contains approved delivery knowledge under `s3 files/snoozerknowledgeprod/policies/delivery.md` with aliases such as `policies/delivery-policy.md` and `faq/delivery.md`.
- Existing source-safe delivery answer remains grounded in approved delivery details such as trusted local carriers, 3 to 7 business days, white-glove setup, old mattress removal, and fee caveats where available.
- No unsupported UPS, 7-10 day, price, inventory, availability, or checkout claims were added.

## 12. Tests Added / Updated

- Route smoke tests now cover internal phrase bans, partner movement, return policy dedupe, help-me-decide criteria, and side-sleeper truncation.
- Canonical tests now assert recommendation answers avoid internal setup terms while still mentioning the canonical pod/product.
- Golden tests now include global guardrails for internal phrases.
- Golden fixture expectations were updated to match the deduped return-policy sentence.

## 13. Commands Run and Results

- `node --check index.js`
- `node --check routes/askSnoozerRoutes.js`
- `node --check services/askSnoozerAnswerEngine.js`
- `node --check services/askSnoozerIntents.js`
- `node --check services/askSnoozerPolicy.js`
- `node --check services/askSnoozerResponsePresenter.js`
- `node --check services/snoozerVoice.js`
- `node --check services/openai.js`
- `node --check tests/runAskSnoozerRouteSmokeTests.js`
- `node --check tests/runAskSnoozerCanonicalTests.js`
- `node --check tests/runAskSnoozerGoldenTests.js`
- `node --check tests/runHudKnowledgeVoiceTests.js`
- Result: passed for 12 files.

- `node tests/runAskSnoozerRouteSmokeTests.js`
- Result: passed, 34 route smoke cases.

- `node tests/runAskSnoozerCanonicalTests.js`
- Result: passed, 4 canonical tests.

- `node tests/runAskSnoozerGoldenTests.js`
- Result: passed, 141/141 golden tests.

- `node tests/runRecommendationResolverTests.js`
- Result: passed, 5 fixture tests plus route smoke.

- `node tests/runHudAskCanonicalSmoke.js`
- Result: passed.

- `node tests/runHudKnowledgeVoiceTests.js`
- Result: passed.

- `npm run package:lambda`
- Result: passed and rebuilt `snoozer-backend.zip`.

## 14. Backend Zip Rebuilt

- Backend zip rebuilt: yes
- Artifact: `snoozer-backend.zip`
- Frontend/theme zip rebuilt: no

## 15. Remaining Risks

- Local test logs still show expected environment warnings when optional services are not configured, including missing `OPENAI_API_KEY`, missing Polly client, `CUSTOMER_PROFILE_TABLE_NOT_CONFIGURED`, and `ZOHO_NOT_CONFIGURED`.
- HUD knowledge tests can still log short S3 timeout fallbacks for catalog/canon retrieval, but tests pass and this was not part of the microfix scope.
- CloudWatch previously showed Zoho/profile sync can add roughly 1.1 to 1.3 seconds of latency to some Ask Snoozer responses. This pass did not change Zoho behavior.
- Unrelated dirty worktree files remain unstaged by design.

## 16. Recommended Next Step

- Run a separate async/deferred Zoho/profile sync pass to reduce customer-facing Ask Snoozer latency.
- Separately review the frontend Ask Snoozer chat display if UI cards still visually clip long answers, but do not mix that with backend answer logic.
