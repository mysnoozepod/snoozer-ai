# Calendly Booking Spine Audit

## Scope
- Primary files inspected:
  - `C:\Users\14342\Desktop\snoozer-ai\services\bookingSession.js`
  - `C:\Users\14342\Desktop\snoozer-ai\services\snoozeIdentity.js`
  - `C:\Users\14342\Desktop\snoozer-ai\index.js`

## Webhook endpoints
- `POST /booking/calendly-webhook` in `index.js`
- `POST /calendly/webhook` in `index.js`

## Event types observed
- `invitee.created`
- `invitee.canceled`
- There is no dedicated reschedule branch; reschedules would currently depend on whatever Calendly event payload is forwarded.

## Snooze Code extraction path
- Booking identity is normalized in `services/bookingSession.js`.
- Snooze Code sources checked:
  - payload `snoozeCode`
  - payload `accessCode`
  - payload `shopperId`
  - question-and-answer fields
  - URL query params
  - UTM content/term
  - alias lookups by invitee/event/email/phone

## Existing-code booking behavior
- Existing code resolves to the canonical `shopper#<code>` record.
- Session prep is generated from canonical recommendation + stored assessment data.
- Zoho sync uses the canonical shopper id.

## No-code booking behavior
- Legitimate `invitee.created` payloads can issue a new Snooze Code through `issueSnoozeCode(...)`.
- This pass added a safety gate in `services/bookingSession.js` so malformed `invitee.created` payloads do not issue a new code without basic booking evidence.

## Cancellation behavior
- This pass hardened canceled bookings so stored `sessionPrep.status` becomes `canceled` instead of looking active.
- Booking history remains on the canonical profile with `bookingStatus = canceled`.

## Zoho behavior
- Booking flow calls Zoho after profile upsert.
- Zoho failures are soft and do not break the webhook response.
- Duplicate prevention remains anchored on Zoho lookup by shopper id.

## Risks and blockers
- There is still no separate webhook-delivery idempotency table. Current protection comes from stable canonical profile keys and alias keys.
- Reschedule-specific semantics are not broken out as a first-class path yet.

## Tests covering this area
- Existing:
  - `tests/runBookingSessionTests.js`
  - `tests/runBookingWebhookRouteTests.js`
- Added in this pass:
  - `tests/runPhase3CalendlyWebhookTests.js`

## Findings fixed in this pass
- Alias-based booking resolution now follows `aliasOfProfileId` back to the canonical shopper profile before building session prep.
- Malformed `invitee.created` payloads no longer qualify for auto-issued Snooze Codes without basic identity evidence.
