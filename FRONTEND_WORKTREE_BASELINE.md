# Frontend Worktree Baseline

Captured on `2026-07-06` from `C:\Users\14342\Desktop\snoozer-ai`.

## Git

- Branch: `main`
- HEAD: `54c7dc7b892e393260e527b6eee051415cec24f1`
- Staged files: none

## Current status summary

### Unstaged tracked files

- `omnia-journey/src/Layout.jsx`
- `omnia-journey/src/components/RewardsDrawer.jsx`
- `omnia-journey/src/lib/api.js`
- `omnia-journey/src/lib/apiClient.ts`
- `omnia-journey/src/lib/snoozer/hud/fetchHudScript.js`
- `omnia-journey/src/lib/snoozer/voice/fetchHudAudio.js`
- `omnia-journey/src/lib/voice.js`
- `omnia-journey/src/pages/Cart.jsx`
- `omnia-journey/src/pages/SnoozePod.jsx`
- `services/bookingSession.js`
- `services/calendlyWebhookIdempotency.js`
- `tests/runPhase3CalendlyIdempotencyTests.js`

### Untracked files and folders

- `_out/` screenshot/debug artifacts
- `business planning/`
- `omnia-journey/phase5d-*.png`
- `omnia-journey/phase5e-*.png`
- `omnia-journey/src/lib/apiBase.js`
- `phase4-audit/`
- `s3-audit/`
- `s3 files/snoozerassetsprod/scripts/hud/what_to_expect/assessment_complete.json`
- `tests/runPhase4ConsistencyFixTests.js`
- `tests/runPhase4SnoozerTraceHarness.js`
- `tmp-cw-idem-window.json`
- `tmp-idempotency-item.json`
- `tmp-idempotency-key.json`

## Raw `git status --short`

```text
 M omnia-journey/src/Layout.jsx
 M omnia-journey/src/components/RewardsDrawer.jsx
 M omnia-journey/src/lib/api.js
 M omnia-journey/src/lib/apiClient.ts
 M omnia-journey/src/lib/snoozer/hud/fetchHudScript.js
 M omnia-journey/src/lib/snoozer/voice/fetchHudAudio.js
 M omnia-journey/src/lib/voice.js
 M omnia-journey/src/pages/Cart.jsx
 M omnia-journey/src/pages/SnoozePod.jsx
 M services/bookingSession.js
 M services/calendlyWebhookIdempotency.js
 M tests/runPhase3CalendlyIdempotencyTests.js
 ?? _out/...
 ?? business planning/
 ?? omnia-journey/phase5d-*.png
 ?? omnia-journey/phase5e-*.png
 ?? omnia-journey/src/lib/apiBase.js
 ?? phase4-audit/
 ?? s3 files/snoozerassetsprod/scripts/hud/what_to_expect/assessment_complete.json
 ?? s3-audit/
 ?? tests/runPhase4ConsistencyFixTests.js
 ?? tests/runPhase4SnoozerTraceHarness.js
 ?? tmp-cw-idem-window.json
 ?? tmp-idempotency-item.json
 ?? tmp-idempotency-key.json
```

## Dirty-file recommendations

| Path | Type | Recommendation | Why |
| --- | --- | --- | --- |
| `omnia-journey/src/Layout.jsx` | frontend tracked | inspect before touching | layout owns HUD mount and legacy fixed bars |
| `omnia-journey/src/components/RewardsDrawer.jsx` | frontend tracked | inspect before touching | active but visually legacy |
| `omnia-journey/src/lib/api.js` | frontend tracked | inspect before touching | main frontend API truth layer |
| `omnia-journey/src/lib/apiClient.ts` | frontend tracked | likely duplicate/stale | second API client only for `/ask-snoozer` retry wrapper |
| `omnia-journey/src/lib/snoozer/hud/fetchHudScript.js` | frontend tracked | inspect before touching | HUD script truth path |
| `omnia-journey/src/lib/snoozer/voice/fetchHudAudio.js` | frontend tracked | inspect before touching | HUD TTS truth path |
| `omnia-journey/src/lib/voice.js` | frontend tracked | inspect before touching | older voice runtime still present |
| `omnia-journey/src/pages/Cart.jsx` | frontend tracked | keep for next frontend pass | active commerce route with cart/session overlap |
| `omnia-journey/src/pages/SnoozePod.jsx` | frontend tracked | inspect before touching | active secondary cart/setup page |
| `services/bookingSession.js` | backend tracked | safe to ignore for frontend pass | backend-only |
| `services/calendlyWebhookIdempotency.js` | backend tracked | safe to ignore for frontend pass | backend-only |
| `tests/runPhase3CalendlyIdempotencyTests.js` | backend tracked | safe to ignore for frontend pass | backend-only |
| `_out/` | untracked generated | safe to ignore for now | debug screenshots and temp patches |
| `omnia-journey/phase5d-*.png`, `phase5e-*.png` | untracked generated | safe to ignore for now | visual reference/check screenshots |
| `omnia-journey/src/lib/apiBase.js` | frontend untracked | keep for next frontend pass | active API base resolver used by current app |
| `phase4-audit/`, `s3-audit/` | untracked docs | safe to ignore for now | prior audit outputs |
| `business planning/` | unrelated folder | needs Ty decision | non-frontend working material |
| temp `.json` files | temp/debug | safe to ignore for now | point-in-time CloudWatch/idempotency debugging |

## Preflight takeaway

The next big frontend pass should not start until the editor consciously ignores existing backend dirt and screenshot artifacts. The most important pre-existing frontend files already dirty are `Layout.jsx`, `api.js`, `Cart.jsx`, `SnoozePod.jsx`, and the HUD/voice helpers.
