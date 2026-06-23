# Customer Profile Spine Audit

## Scope
- Repo: `C:\Users\14342\Desktop\snoozer-ai`
- Primary files inspected:
  - `C:\Users\14342\Desktop\snoozer-ai\services\snoozeIdentity.js`
  - `C:\Users\14342\Desktop\snoozer-ai\services\customerProfile.js`
  - `C:\Users\14342\Desktop\snoozer-ai\services\bookingSession.js`
  - `C:\Users\14342\Desktop\snoozer-ai\index.js`

## Canonical identity rules observed
- Snooze Codes normalize to 4-digit or 6-digit numeric codes in `services/snoozeIdentity.js`.
- Canonical shopper identity is the Snooze Code itself.
- Canonical profile key format is `shopper#<SnoozeCode>` in `services/snoozeIdentity.js` and `services/customerProfile.js`.
- Temporary Shopify assessment ids stay temporary until `issueSnoozeCode(...)` qualifies them for promotion.
- Alias records are written with `alias#shopper:...`, `alias#visitor:...`, `alias#session:...`, and `alias#thread:...` in `services/snoozeIdentity.js`.
- Booking aliases also use `alias#booking_invitee:...`, `alias#booking_event:...`, `alias#email:...`, and `alias#phone:...` in `services/bookingSession.js`.

## Routes that read profile data
- `POST /ask-snoozer` in `index.js`
- `POST /hud/ask` in `index.js`
- `POST /identity/check-in` in `index.js`
- `POST /booking/calendly-webhook` and `POST /calendly/webhook` in `index.js`
- Booking alias/canonical resolution in `services/bookingSession.js`

## Routes that write or enrich profile data
- `POST /assessment` in `index.js`
- `POST /ask-snoozer` in `index.js`
- `POST /hud/ask` in `index.js`
- `POST /identity/check-in` in `index.js`
- `POST /booking/calendly-webhook` and `POST /calendly/webhook` in `index.js`

## Alias behavior observed
- Session and thread aliases are created during Ask Snoozer, HUD, assessment, and check-in flows.
- Temporary Shopify assessment ids are preserved as aliases after Snooze Code issuance.
- Booking invitee/event/email/phone aliases are written during Calendly ingestion.
- Alias profiles point back to `aliasOfShopperId` and `aliasOfProfileId`.

## Validation result for known code `1234`
- `1234` resolves as shopperId `1234`.
- `1234` resolves as profileId `shopper#1234`.
- `POST /ask-snoozer` session aliases point back to `shopper#1234`.
- Repeated assessment/ask flows for `1234` did not create competing `shopper#...` records.

## Risks found
- Before this pass, malformed `invitee.created` payloads could issue a brand-new Snooze Code with weak booking evidence. Fixed in `services/bookingSession.js`.
- Before this pass, booking alias resolution could keep using the alias record instead of following `aliasOfProfileId` back to the canonical shopper profile. Fixed in `services/bookingSession.js`.
- `GET /recommendations/:shopperId` in `index.js` is still legacy recommendations plumbing and is not the canonical profile authority.

## Missing or thin areas
- There is still no separate idempotency ledger for duplicate webhook deliveries. Current safety comes from stable profile keys plus Zoho lookup-by-shopper-id.
- Local route smoke still logs a `session.load.error` IAM denial for `snoozer_sessions` in one environment, but the customer-facing response falls back safely.

## Tests covering this area
- Existing:
  - `tests/runSnoozeIdentityTests.js`
  - `tests/runSnoozeCodeRouteTests.js`
  - `tests/runCustomerProfileTests.js`
- Added in this pass:
  - `tests/runPhase3IdentitySpineTests.js`
