# Snoozer Live Acceptance Recovery — 2026-10-28

## Outcome

The corrected build is deployed to the designated development/test backend and published as immutable Lambda version 19. The Lambda remains on `nodejs24.x` with handler `index.lambdaHandler`. Academy, Trusted Advisor, and Active Journey each passed twice against the final deployed package.

This supports controlled MIC Lab software testing. It is not a production-readiness or physical-hardware acceptance declaration.

## A. Root causes

| Failure | Responsible code | Root cause |
| --- | --- | --- |
| Academy turn 9 `claim_source_missing:product` | `services/askSnoozerModelCore.js` (`repairClaimSourceMetadata`, prepared evidence) and `services/askSnoozerConversationContracts.js` (`validateConversationResponse`) | A supported recap could arrive with missing or mismatched provenance metadata. Correction depended on another model response and did not reliably correlate claim kind, successful tool, and exact source key. |
| Trusted Advisor compatibility fallback | `services/askSnoozerConversationState.js` (`applyConversationState`) and `services/askSnoozerConversationContracts.js` (`claimSourceMatchesResult`) | The exact validated mattress/base/size/motion quote was not fully projected into conversation state, while compatibility validation correctly required exact `quote_configuration` provenance. The answer therefore lacked a valid correlated source even when the quote evidence existed. |
| Active Journey lost King | `services/askSnoozerConversationState.js` (`applyConversationState`) and `routes/askSnoozerRoutes.js` | Validated size and quote fields were not consistently projected into `activeConfiguration`; the route also omitted the current message when applying explicit mattress-only scope. King could remain in retained preferences without appearing at the response field asserted by the live journey. |
| Local Trusted Advisor chose 14-inch Hybrid instead of 12-inch All Foam | `tests/askSnoozerPlannerFixture.js` | The test fixture forced every utterance to `asserted`, so a question was incorrectly treated as acceptance and changed the selected product. Production modality inference correctly classified the utterance as a question. The expected All Foam product was retained; no product expectation was changed. |

Additional live findings were corrected in the same existing architecture:

- Historical canonical recall now prepares facts for the rejected original product without reactivating it.
- Explicit mattress-only scope clears base/motion, invalidates the stale bundle quote, and produces a verified mattress-only quote/action.
- Repeated recap cards remain suppressed unless the turn has explicit commerce intent or fresh commerce evidence.
- The internal-language guard now blocks explicit AI implementation phrases while allowing normal retail wording such as “product model.”

## B. Corrections

Changed source and tests:

- `services/askSnoozerConversationContracts.js`: claim kind-to-tool allow-list and exact result/source correlation.
- `services/askSnoozerModelCore.js`: request-scoped deterministic provenance normalization, historical canonical evidence hydration, mattress-only quote preparation, and recap-card policy.
- `services/askSnoozerConversationState.js`: validated size/configuration projection, quote invalidation, and mattress-only state.
- `routes/askSnoozerRoutes.js`: pass the shopper message into state projection.
- `services/askSnoozerConversationOrchestrator.js`: distinguish actual implementation language from ordinary retail “model” terminology.
- `tests/askSnoozerPlannerFixture.js`: use production modality inference.
- `tests/runAskSnoozerConversationCoreTests.js` and `tests/runAskSnoozerTrustedAdvisorTests.js`: focused regression coverage.
- `scripts/runActiveJourneyLiveAcceptance.js`: wait for Welcome hydration and locate the exact server-provided typed action label. Product, size, continuity, and cart assertions were not weakened.

No checkout/payment behavior, product lineup, model family, product truth, or architecture was changed.

## C. Validation

### Local

- Conversation Core, route, continuity, truth lanes, budget/recovery, reliability, semantic integrity/authority/cutover, typed actions, surface parity, legacy excision, configuration quote, Active Journey, shopper feedback, Shopify API versions, Rewards foundation/configuration/identity/production, integration secrets, and Trusted Advisor: passed.
- Active Journey: 22/22; Active Journey route contract: 15/15.
- Trusted Advisor: 10 exact turns, 12 commerce turns, 12 planner/depth cases.
- Realistic evaluations: 60/60 across all 16 quality dimensions.
- Node 24 compatibility: passed on Node v24.13.0; async handler, CommonJS behavior, and bundled AWS SDK v3 clients resolved.
- `npm ci`: 0 vulnerabilities.

### Performance

Equivalent V2 benchmark, 30 iterations:

| Metric | V2 baseline | Corrected build |
| --- | ---: | ---: |
| P50 | 49 ms | 47 ms |
| P95 | 62 ms | 59 ms |
| Model calls/turn | 2 | 2 |
| Tool proposals/turn | 1 | 1 |
| Tool executions/turn | 1 | 1 |
| Duplicate calls avoided/turn | 1 | 1 |
| Input/output tokens | 500 / 80 | 500 / 80 |

### Final live package: `A7S7Rsh8kq/NJBCOhC9jA9E9p90KYnYUFb7lmo10lJQ=`

- Academy run 1: 9/9, P50 7,534 ms, P95 11,100 ms, 13 model calls, 4 tool calls, 0 fallbacks, 0 validation recoveries.
- Academy run 2: 9/9, P50 7,716 ms, P95 11,242 ms, 13 model calls, 4 tool calls, 0 fallbacks, 0 validation recoveries.
- Trusted Advisor run 1: 10/10 plus cross-device continuity, average 8,360 ms, P95 12,315 ms.
- Trusted Advisor run 2: 10/10 plus cross-device continuity, average 8,700 ms, P95 14,983 ms.
- Active Journey run 1: passed across two browsers; King, mattress-only scope, rejection history, exact selected product in cart, and original/current recommendation distinction all verified.
- Active Journey run 2: passed with the same assertions on fresh state.
- Endpoint checks: `/health` 200; assessment metadata 200; Shopify showroom catalog 200 with 59 products and zero missing; assessment/identity issuance 200; Rewards offers 200 with four offers.
- Final CloudWatch window: 0 Conversation Core fallbacks, 0 claim-source errors, 0 transport failures, and 0 Lambda timeouts. One 401 Rewards log was caused by an initial malformed verification probe that omitted the wrapped Snooze Code; the corrected probe returned 200.

## D. Deployment

- Starting V2 branch tip: `7fab438c71acabb519abcef1c3cc2fdfcd660dfb`.
- Prior V2 deployment source: `35fb062f83c1164b89e4a9c25a992a638730bfe7` (verified ancestor).
- Recovery branch: `codex/snoozer-live-acceptance-recovery-20261028`.
- Deployed source commit: `e76dfe9`.
- Deployment-package commit: `ece490d`.
- Lambda: `snoozer-backend`, `us-east-1`, `$LATEST` integration target.
- Immutable corrected version: 19.
- Runtime/handler: `nodejs24.x` / `index.lambdaHandler`.
- Package SHA-256: `03b4bb46c87c92afcd24108e842f6303d13da7dd0a62761415bee59a8d749494`.
- Lambda `CodeSha256`: `A7S7Rsh8kq/NJBCOhC9jA9E9p90KYnYUFb7lmo10lJQ=`.
- Healthy rollback: version 18, Node 24 V2, hash `k0LOzXjfTfn25ZKdBIDb6XEzptwTcWlG6Ict7AjDtoA=`; downloaded rollback artifact hash verified.
- Pre-V2 rollback remains version 17 on Node 20.
- API Gateway integrations remain unqualified `snoozer-backend` ARNs, so the designated test stage continues to invoke `$LATEST`.

## E. Remaining issues and risk

- No acceptance failure remains in the three required live scenarios or the existing Trusted Advisor fixture.
- The AWS account currently has concurrency 10 and no function-level reserved concurrency. Earlier parallel Welcome hydration produced an API Gateway 503 before Lambda invocation. The acceptance harness now waits for hydration before injecting feedback, but the low account concurrency remains a capacity risk for broader concurrent testing.
- Live latency remains model-dominated; functional acceptance passed, but the second Trusted Advisor P95 was 14.983 seconds.
- Development-process note: the earlier broad AWS CLI configuration output incident remains recorded. This recovery used field-scoped queries and did not print secret-bearing environment values; no credential-rotation workstream was opened.
- Physical device acceptance and production-readiness remain outside this mission.

The corrected backend is ready for controlled MIC Lab testing, subject to the concurrency and latency risks above.
