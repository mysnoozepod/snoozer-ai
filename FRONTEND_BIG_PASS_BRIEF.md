# Frontend Big Pass Brief

## 1. Current frontend state summary

The active showroom journey is live and buildable, but ownership is fragmented:

- route flow is mostly correct
- `Pod.jsx` is carrying too much
- `/ask-snoozer` is still layout-fragile
- cart/session identity is duplicated across `useStore.js`, `sessionStore.js`, and direct `sessionStorage`
- legacy `explore-dev`/alias surfaces still exist

## 2. Active customer journey routes

- `/welcome`
- `/what-to-expect`
- `/assessment`
- `/results`
- `/pod/:podId`
- `/ask-snoozer`
- `/cart`
- `/checkout/guest`

## 3. Files most likely to change

- `omnia-journey/src/Layout.jsx`
- `omnia-journey/src/pages/Pod.jsx`
- `omnia-journey/src/pages/AskSnoozer.jsx`
- `omnia-journey/src/pages/Assessment.jsx`
- `omnia-journey/src/pages/Results.jsx`
- `omnia-journey/src/components/showroom/ShowroomPrimitives.jsx`
- `omnia-journey/src/components/SnoozerPanel.jsx`
- `omnia-journey/src/lib/useStore.js`
- `omnia-journey/src/state/sessionStore.js`

## 4. Files to inspect carefully before editing

- `omnia-journey/src/lib/api.js`
- `omnia-journey/src/lib/snoozer/askSnoozerPage.js`
- `omnia-journey/src/lib/snoozer/hud/useShowroomHud.js`
- `omnia-journey/src/lib/snoozer/hud/fetchHudScript.js`
- `omnia-journey/src/lib/snoozer/voice/fetchHudAudio.js`
- `omnia-journey/src/pages/Cart.jsx`
- `omnia-journey/src/pages/SnoozePod.jsx`

## 5. Legacy files to retire or isolate later

- `omnia-journey/src/pages/Explore.jsx`
- `omnia-journey/src/pages/ExploreScreen.jsx`
- `omnia-journey/src/pages/WelcomeScreen.jsx`
- `omnia-journey/src/pages/TalkToHuman.jsx`
- `omnia-journey/src/layouts/ShowroomLayout.jsx`
- `omnia-journey/src/lib/apiClient.ts`

## 6. `Pod.jsx` recommendation

Decompose `Pod.jsx` first. It is the highest-risk file and currently mixes route orchestration, rest-test logic, build logic, education panels, HUD voice, and cart behavior.

## 7. `/ask-snoozer` recommendation

Make `/ask-snoozer` a premium chat-first surface:

- compact header
- input/composer first
- transcript directly below
- no tall layout sections competing with the transcript

## 8. HUD persistence validation needs

- confirm only one visual HUD owner per route
- preserve centralized voice queue ownership in `Layout.jsx`
- avoid page-level and layout-level duplicate guidance

## 9. Cart/session truth validation needs

- choose a primary UI owner for cart identity between Zustand and `sessionStore`
- keep legacy sessionStorage writes only as compatibility, not feature logic

## 10. Frontend build/package commands

- build: `cd omnia-journey && npm run build`
- current manual artifact already present: `omnia-journey/snoozer-ui.zip`
- no package script currently exists to rebuild the zip automatically

## 11. Suggested implementation sequence

1. confirm dirty worktree boundaries
2. stabilize shared shell/footer safe areas
3. decompose `Pod.jsx`
4. fix pod rest-test/layout behaviors
5. simplify `/ask-snoozer`
6. validate results canonical path
7. validate cart/session truth
8. validate HUD persistence
9. rebuild frontend
10. recreate `snoozer-ui.zip`

## 12. Acceptance criteria

- no route-level clipping/overlap on primary showroom screens
- `Pod.jsx` no longer owns every pod concern directly
- `/ask-snoozer` transcript is always visible and usable
- results remain canonical-backed
- cart display and checkout identity stay consistent across routes
