# Phase 3 Spine Report

## 1. Executive summary
- Phase 3 validation passed after two narrow backend hardenings in booking/session prep flow.
- Identity spine is holding on one canonical Snooze Code / one canonical profile record.
- Zoho remains a mirror keyed by `Snoozer_Shopper_ID`, not the identity authority.
- Calendly existing-code, no-code, cancellation, and session-prep paths are now covered more explicitly.

## 2. What passed
- Phase 3A identity spine
- Phase 3B Zoho duplicate prevention
- Phase 3C existing-code booking
- Phase 3C no-code booking
- Phase 3C cancellation handling
- Phase 3D sessionPrep generation and deterministic Ask Snoozer guidance
- Showroom check-in route resolves canonical profiles correctly

## 3. What failed during validation
- Initial Phase 3 validation exposed two booking-side gaps:
  - malformed `invitee.created` payloads could issue a new Snooze Code with weak evidence
  - alias-based booking resolution could build session prep from the alias profile instead of the canonical shopper profile

## 4. What was fixed
- Added booking identity evidence gating in `services/bookingSession.js` before issuing a new Snooze Code from `invitee.created`.
- Hardened alias-based booking resolution in `services/bookingSession.js` so `aliasOfProfileId` wins when rebuilding canonical identity.
- Hardened canceled booking session prep so stored `sessionPrep.status` becomes `canceled`.
- Expanded `buildCheckInSummary(...)` in `index.js` to expose `sessionPrepStatus` and `sessionPrep`.

## 5. What was intentionally not touched
- Checkout
- Cart
- Shopify theme files
- Broad React/UI work
- S3 objects
- Zoho schema

## 6. Customer Profile OS status
- Canonical profile key remains `shopper#<SnoozeCode>`.
- Assessment, Ask Snoozer, HUD, check-in, and booking routes all enrich the same profile spine when a canonical code exists.

## 7. Snooze Code status
- 4-digit legacy codes and 6-digit issued codes both resolve cleanly.
- Temporary Shopify assessment ids remain aliases after code issuance.

## 8. Alias handling status
- Session/thread/shopper aliases are working.
- Booking invitee/event/email/phone aliases are working.
- Booking alias resolution now follows back to the canonical shopper profile correctly.

## 9. Zoho duplicate-prevention status
- Lookup-first by `Snoozer_Shopper_ID` is working.
- Repeated syncs update existing contacts.
- Multiple-match cases update one contact and avoid creating a third duplicate.

## 10. Calendly existing-code booking status
- Passing.
- Existing code updates the canonical shopper profile and produces ready session prep.

## 11. Calendly no-code booking status
- Passing.
- Legitimate no-code bookings can issue a new Snooze Code safely.
- Malformed no-code bookings now skip instead of minting a bogus new code.

## 12. Calendly cancellation status
- Passing.
- `bookingStatus` becomes `canceled`.
- Stored `sessionPrep.status` now also becomes `canceled`.

## 13. SessionPrep contract status
- Stronger than before this pass.
- Deterministic session prep now includes canonical shopper identifiers plus booking timing context.
- Still no dedicated expired-state lifecycle.

## 14. Showroom check-in status
- Check-in resolves canonical Snooze Code correctly.
- Check-in now returns deterministic session prep alongside recommendation summary.

## 15. Ask Snoozer / session guidance status
- Passing.
- Stored session prep answers “Which pod should I try first?” without OpenAI.
- Canonical recommendation fallback still works when session prep is missing.

## 16. Tests added or updated
- Added:
  - `tests/runPhase3IdentitySpineTests.js`
  - `tests/runPhase3CalendlyWebhookTests.js`
  - `tests/runPhase3SessionPrepTests.js`
- Existing suites reused:
  - `tests/runSnoozeIdentityTests.js`
  - `tests/runSnoozeCodeRouteTests.js`
  - `tests/runCustomerProfileTests.js`
  - `tests/runCustomerProfileZohoSyncTests.js`
  - `tests/runCustomerProfileInteractionEnrichmentTests.js`
  - `tests/runCustomerProfileRouteSkipSmoke.js`
  - `tests/runBookingSessionTests.js`
  - `tests/runBookingWebhookRouteTests.js`
  - `tests/runAskSnoozerCanonicalTests.js`
  - `tests/runHudAskCanonicalSmoke.js`
  - `tests/runHudKnowledgeVoiceTests.js`

## 17. Validation commands run
- `npm run validate:ask-snoozer-knowledge -- --check-s3`
- `node tests/runHudKnowledgeVoiceTests.js`
- `node tests/runHudAskCanonicalSmoke.js`
- `node tests/runAskSnoozerCanonicalTests.js`
- `npm run test:ask-snoozer-copy`
- `npm run test:ask-snoozer`
- `node tests/runCustomerProfileTests.js`
- `node tests/runCustomerProfileZohoSyncTests.js`
- `node tests/runCustomerProfileInteractionEnrichmentTests.js`
- `node tests/runCustomerProfileRouteSkipSmoke.js`
- `node tests/runSnoozeIdentityTests.js`
- `node tests/runSnoozeCodeRouteTests.js`
- `node tests/runBookingSessionTests.js`
- `node tests/runBookingWebhookRouteTests.js`
- `node tests/runPhase3IdentitySpineTests.js`
- `node tests/runPhase3CalendlyWebhookTests.js`
- `node tests/runPhase3SessionPrepTests.js`

## 18. Backend zip update status
- Updated in place:
  - `C:\Users\14342\Desktop\snoozer-ai\snoozer-backend.zip`

## 19. React zip update status
- Not touched.

## 20. S3 changes
- None.

## 21. Remaining blockers
- Local environment still shows an IAM denial for `dynamodb:GetItem` on `snoozer_sessions` during one route smoke. Customer-facing flow still falls back safely, but the local/operator IAM policy is incomplete.
- There is still no separate webhook idempotency ledger beyond stable upsert keys and Zoho lookup-by-shopper-id.

## 22. Recommended next phase
- Add a lightweight webhook idempotency record keyed by Calendly event/invitee uri.
- Decide whether showroom consumers should treat `sessionPrep` from `/identity/check-in` as the primary contract or perform a dedicated profile fetch.
