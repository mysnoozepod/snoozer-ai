# Frontend Remnant Cleanup List

Captured after the Frontend Showroom Cleanup Pass on `2026-07-06`.

## 1. Pre-existing dirty files that were not part of this pass

These were already dirty before this cleanup pass and should be reviewed separately before any broad frontend squash commit:

- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\Layout.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\RewardsDrawer.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\lib\api.js`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\lib\apiClient.ts`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\lib\snoozer\hud\fetchHudScript.js`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\lib\snoozer\voice\fetchHudAudio.js`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\lib\voice.js`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\Cart.jsx`
- backend files under `services\` and `tests\` unrelated to this frontend pass

## 2. Legacy or supporting routes still registered

These remain live or aliased in `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\main.jsx` and should be reviewed in a later route-pruning pass:

- `/explore-dev` -> `Explore.jsx`
- `/explore` redirect alias
- `/shop-with-snoozer` redirect alias
- `/ask-snoozer/explore` redirect alias
- `/asksnoozer/explore` redirect alias
- `/faqs`
- `/financing`

## 3. Unregistered or stale page files

These are still present in `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages` or adjacent legacy app roots but are not part of the main live router:

- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\WelcomeScreen.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\ExploreScreen.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\TalkToHuman.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\OmniaApp.jsx`

## 4. Pod Experience follow-up cleanup

`C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\Pod.jsx` is materially cleaner than before, but it is still the heaviest active customer-facing route.

Remaining cleanup targets:

- extract rest-test state/timers into a dedicated `useRestTest.js`
- extract build/setup orchestration into a dedicated `usePodBuildState.js`
- extract pod data loading into a dedicated pod data hook
- reduce remaining helper density in `Pod.jsx`
- consider moving copied formatting/normalization helpers into `lib/` or `components/pod/utils`

## 5. Ask Snoozer follow-up cleanup

`C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\AskSnoozer.jsx` now behaves like a focused chat page, but it still owns all transcript rendering inline.

Next split candidates:

- `components/ask-snoozer/AskSnoozerShell.jsx`
- `components/ask-snoozer/AskSnoozerTranscript.jsx`
- `components/ask-snoozer/AskSnoozerMessage.jsx`
- `components/ask-snoozer/AskSnoozerComposer.jsx`
- `components/ask-snoozer/AskSnoozerStarterChips.jsx`

## 6. HUD ownership remnants

The current layout-level HUD ownership is correct, but the following areas still deserve cleanup:

- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\Layout.jsx` still owns HUD state, rewards state, shopper session reads, and some storage writes together
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\SnoozerPanel.jsx` still contains transcript/input concepts that conceptually overlap with full-page `/ask-snoozer`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\Explore.jsx` still carries older HUD patterns

## 7. Cart/session truth remnants

Direct storage paths still remain spread across the frontend. The highest-risk files are:

- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\lib\api.js`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\lib\useStore.js`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\state\sessionStore.js`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\PodBuilder.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\SnoozerPanel.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\ProductDetail.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\Welcome.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\WhatToExpect.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\Results.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\Cart.jsx`

Recommended next-pass rule:

- keep `sessionStore.js` as the session/cart identity adapter
- keep canonical recommendation truth in backend resolver paths
- progressively retire raw page-level `sessionStorage` writes where a shared helper already exists

## 8. Duplicate or stale API helpers

These are still remnant candidates:

- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\lib\apiClient.ts`
  - duplicate Ask Snoozer client layer
- raw `fetch()` inside `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\Welcome.jsx`
  - bypasses `api.js`
- local recommendation fallback logic in results utilities
  - should stay documented until a separate removal pass validates canonical-only behavior

## 9. Generated artifacts and debug outputs

These should not be treated as live product code:

- `C:\Users\14342\Desktop\snoozer-ai\_out\`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\phase5d-*.png`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\phase5e-*.png`
- `C:\Users\14342\Desktop\snoozer-ai\phase4-audit\`
- `C:\Users\14342\Desktop\snoozer-ai\s3-audit\`
- temp JSON/debug files at repo root

## 10. Safe next cleanup pass

Best next remnant cleanup order:

1. route/alias audit in `main.jsx`
2. cart/session truth consolidation
3. Ask Snoozer component split
4. Pod rest/build hook extraction
5. stale page and legacy HUD cleanup
