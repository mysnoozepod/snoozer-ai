# SessionPrep Contract Audit

## Scope
- Primary files inspected:
  - `C:\Users\14342\Desktop\snoozer-ai\services\bookingSession.js`
  - `C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerAnswerEngine.js`
  - `C:\Users\14342\Desktop\snoozer-ai\index.js`
  - `C:\Users\14342\Desktop\snoozer-ai\services\customerProfile.js`

## Current stored sessionPrep shape observed
- `status`
- `shopperId`
- `profileId`
- `snoozeCode`
- `bookingEventUri`
- `bookingInviteeUri`
- `bookingStartTime`
- `bookingEndTime`
- `recommendedStartingPod`
- `recommendedPodIds`
- `primaryMattressHandle`
- `startingMattressHandle`
- `baseHandle`
- `motionKey`
- `motionLabel`
- `comfortSummary`
- `customerFitSummary`
- `showroomStartingPoint`
- `podsToTry`
- `questionsToAsk`
- `sessionInstructions`
- `riskFlags`
- `openConcerns`
- `partnerNotes`
- `budgetNotes`
- `staffNotes`
- `snoozerOpeningContext`
- `generatedAt`
- `updatedAt`
- `source`

## Desired vs current
- Desired fields already covered:
  - status
  - shopperId
  - profileId
  - snoozeCode
  - bookingStartTime
  - bookingEndTime
  - recommendedStartingPod
  - baseHandle
  - motionKey
  - podsToTry
  - generatedAt
  - updatedAt
- Desired fields partially covered or mapped:
  - startingMattressHandle is currently exposed as `startingMattressHandle` and `primaryMattressHandle`
  - customerFitSummary is currently exposed as `customerFitSummary`
  - sessionInstructions is currently exposed as `sessionInstructions`
  - bookingId/eventId is currently represented as `bookingEventUri` and `bookingInviteeUri`, not a short standalone id
- Still missing:
  - explicit expired-state handling
  - explicit short-form booking id field

## Check-in dependency
- `POST /identity/check-in` in `index.js` now returns:
  - `sessionPrepStatus`
  - `sessionPrep`
- This pass made the check-in summary expose the stored deterministic session prep object instead of only booking status + recommendation summary.

## Ask Snoozer / HUD dependency
- Ask Snoozer deterministic session guidance reads `sessionPrep` in `services/askSnoozerAnswerEngine.js`.
- HUD deterministic guidance can also answer from stored session prep via profile context.
- When session prep is missing, Ask Snoozer still falls back to canonical recommendation context.

## Validation result
- Session prep is generated during booking ingestion.
- Session prep loads by Snooze Code.
- Ask Snoozer answers “Which pod should I try first?” from deterministic session prep without OpenAI.
- Canceled bookings now store `sessionPrep.status = canceled`.

## Remaining risks
- There is no first-class expiration lifecycle yet beyond canceled/not-canceled.
- Showroom-specific UI consumers still need to decide whether to read `sessionPrep` directly from check-in or perform a second profile fetch.

## Tests covering this area
- Existing:
  - `tests/runBookingWebhookRouteTests.js`
  - `tests/runAskSnoozerCanonicalTests.js`
- Added in this pass:
  - `tests/runPhase3SessionPrepTests.js`
