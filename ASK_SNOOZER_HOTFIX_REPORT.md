# Ask Snoozer SafeNumber Hotfix Report

## Root Cause

The Unified Truth + Remnant Consolidation cleanup removed the local `safeNumber` helper from `index.js`, but `index.js` still passed `safeNumber` into `routes/askSnoozerRoutes.js` through the route dependency bag. In Lambda this caused `POST /ask-snoozer` to fail immediately with `safeNumber is not defined`.

Validation also exposed the same dependency-bag issue for `S3_RETRIEVAL_TIMEOUT_MS`: `routes/askSnoozerRoutes.js` used the timeout constant for policy source loading, but the route did not receive it from `index.js`.

## Files Changed

- `index.js`
- `routes/askSnoozerRoutes.js`
- `utils/responseContract.js`
- `tests/runAskSnoozerRouteSmokeTests.js`
- `ASK_SNOOZER_HOTFIX_REPORT.md`
- `snoozer-backend.zip`

## Where `safeNumber` Was Referenced

- `index.js` passed `safeNumber` into `routes/askSnoozerRoutes.js`.
- `routes/askSnoozerRoutes.js` uses `safeNumber` when shaping Ask Snoozer response metrics.

## Helper Location

`safeNumber` already existed in `utils/responseContract.js`. It is now exported from that shared utility and imported by `index.js`, avoiding another duplicate helper definition.

## Tests Added Or Updated

Added:

- `tests/runAskSnoozerRouteSmokeTests.js`

Coverage:

- `POST /ask-snoozer`
- `POST /ask` alias
- simple `hello` message
- representative `shopperId` / `accessCode` of `1234`
- no thrown `ReferenceError`
- HTTP 200
- valid JSON response
- at least one renderable text field

## Validation Commands Run

- `node --check index.js`
- `node --check routes/askSnoozerRoutes.js`
- `node --check utils/responseContract.js`
- `node --check tests/runAskSnoozerRouteSmokeTests.js`
- `node tests/runAskSnoozerRouteSmokeTests.js`
- `node tests/runAskSnoozerCanonicalTests.js`
- `node tests/runAskSnoozerGoldenTests.js`
- `node tests/runAskSnoozerPolicyFallbackTests.js`
- `node tests/runHudAskCanonicalSmoke.js`
- `node tests/runHudKnowledgeVoiceTests.js`

## Validation Results

Passed:

- Syntax checks
- Ask Snoozer route smoke tests
- Ask Snoozer canonical tests
- Ask Snoozer golden tests
- Ask Snoozer policy fallback tests
- HUD ask canonical smoke tests
- HUD knowledge and voice tests

Known non-failing local warnings:

- `OPENAI_API_KEY is missing` appears in local tests because the OpenAI path is mocked or deterministic.
- Some S3 calls log timeout warnings during fast local tests, but fallbacks and assertions pass.

## Backend Package

Backend Lambda package rebuilt: yes.

## Unrelated Dirty Files Left Alone

Existing unrelated worktree changes and debug artifacts were not staged or committed, including prior frontend/HUD/voice/booking files and `_out/` screenshots/artifacts.
