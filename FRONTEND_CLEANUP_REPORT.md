# Frontend Cleanup Report

Completed on `2026-07-06` for the React showroom app in:

- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey`

## 1. Summary of what changed

This pass focused on the active showroom frontend without changing the backend contracts or the customer journey routing.

Main outcomes:

- `Pod.jsx` now routes through extracted pod-owned components and hooks instead of carrying all display responsibility inline
- `/ask-snoozer` was reshaped into a premium chat-first interface with a single centered transcript flow
- shared showroom shell sizing was loosened to reduce clipped/stuck full-height layouts
- pod/cart identity logic was partially centralized through a shared Shopify cart identity helper
- HUD ownership remained layout-level rather than being moved into page-owned duplicate UI

## 2. Files intentionally changed in this pass

- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\showroom\ShowroomPrimitives.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\AskSnoozer.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\Pod.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\SnoozePod.jsx`

## 3. Files added in this pass

- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\pod\BuildYourPodPanel.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\pod\PodFooterNav.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\pod\PodHeader.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\pod\PodHome.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\pod\PodLearnPanel.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\components\pod\PodRestPanels.jsx`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\hooks\usePodCart.js`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\hooks\usePodExperience.js`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\hooks\usePodHudGuidance.js`
- `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\lib\session\shopifyCartState.js`
- `C:\Users\14342\Desktop\snoozer-ai\FRONTEND_REMNANT_CLEANUP_LIST.md`
- `C:\Users\14342\Desktop\snoozer-ai\FRONTEND_CLEANUP_REPORT.md`

## 4. Components extracted

Pod experience extraction now includes:

- `PodRouteHeroHeader` from `components/pod/PodHeader.jsx`
- `PodHome` from `components/pod/PodHome.jsx`
- `PodLearnPanel` from `components/pod/PodLearnPanel.jsx`
- `GuidedRestTest` and rest helpers from `components/pod/PodRestPanels.jsx`
- `PodFooterNav` from `components/pod/PodFooterNav.jsx`
- `BuildYourPodPanel` wrapper from `components/pod/BuildYourPodPanel.jsx`

## 5. Hooks extracted

- `usePodExperience.js`
  - owns pod stage/rest chooser/test state
- `usePodCart.js`
  - owns pod cart pulse/notice behavior
- `usePodHudGuidance.js`
  - owns pod-level voice dedupe, speak, and interrupt behavior

## 6. Route ownership changes

No live route paths were changed in `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\main.jsx`.

The active showroom journey remains:

- `/welcome`
- `/what-to-expect`
- `/assessment`
- `/results`
- `/pod/:podId`
- `/ask-snoozer`
- `/cart`
- `/checkout/:id`
- `/checkout/guest`

What changed is route responsibility:

- `Pod.jsx` is now closer to a route container
- `/ask-snoozer` now behaves as a page-level chat surface instead of a cluttered support/dashboard hybrid

## 7. Ask Snoozer UI changes

`C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\AskSnoozer.jsx` was reorganized to a chat-first structure:

1. header
2. input/composer near the top
3. five starter chips
4. transcript/output directly below
5. compact bottom action row

Behavior kept:

- send uses the existing `/ask-snoozer` helper
- response fields still support `answer`, `reply`, `speech`, `captions`, and `message`
- local visible failure fallback remains
- pod footer handoff can prefill and auto-send “I need human help.”

## 8. HUD persistence findings

Current HUD ownership remains correct:

- layout-level voice/HUD owner: `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\Layout.jsx`
- route pages consume HUD behavior without owning a competing global overlay

Important findings:

- guided pages remain marked as page-owned Snoozer visual routes
- fixed overlay HUD only renders on routes that do not own the visual experience
- `/ask-snoozer` remains a consumer of layout voice state, not a second independent HUD system

## 9. Cart/session state cleanup performed

This pass did not attempt a risky full consolidation.

Performed:

- added `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\lib\session\shopifyCartState.js`
- reused that helper from `C:\Users\14342\Desktop\snoozer-ai\omnia-journey\src\pages\SnoozePod.jsx` to normalize Shopify cart ID persistence

Not yet performed:

- broader retirement of page-level raw `sessionStorage` writes
- consolidation of `api.js`, `useStore.js`, `sessionStore.js`, and cart pages into a single cart/session truth layer

## 10. Remaining frontend remnants

See:

- `C:\Users\14342\Desktop\snoozer-ai\FRONTEND_REMNANT_CLEANUP_LIST.md`

Highest-priority remnants:

- `Pod.jsx` still owns too many helper functions
- `AskSnoozer.jsx` still deserves a second component split
- cart/session identity still has duplicated storage paths
- route alias sprawl remains in `main.jsx`
- stale page files still exist in `src/pages`

## 11. Tests/build commands run

From `C:\Users\14342\Desktop\snoozer-ai\omnia-journey`:

```bash
npm run build
```

Result:

- pass

Notes:

- Vite build passed successfully
- existing large-chunk warning remains
- existing Browserslist staleness warning remains

## 12. Validation results

Validated in this pass:

- build passes after pod decomposition cleanup
- `Pod.jsx` still compiles after legacy inline block removal
- `/ask-snoozer` frontend response handling still supports the current backend fields
- pod footer “Talk to Human” handoff now pre-fills and can auto-send into `/ask-snoozer`
- showroom shell no longer forces a strict fixed-height wrapper at the page-shell level

## 13. Manual validation notes

Source/build validation notes for key routes:

- `/pod/4`
  - shared pod route now renders through extracted pod components/hooks
- `/pod/3`
  - inherits the same shared pod route/component structure
- `/ask-snoozer`
  - source now matches the intended chat-first structure with transcript below the composer
- `/cart`
  - route was not functionally changed in this pass

Browser-based manual route walkthrough was not re-run in this pass; the main validation completed here was structural review plus a passing production build.

## 14. Recommended next pass

Best next follow-up order:

1. full cart/session truth consolidation
2. second-stage `Pod.jsx` hook extraction (`useRestTest`, `usePodBuildState`, data loader)
3. dedicated Ask Snoozer component split
4. route alias cleanup in `main.jsx`
5. stale page and HUD remnant removal

## 15. Baseline note

`C:\Users\14342\Desktop\snoozer-ai\FRONTEND_WORKTREE_BASELINE.md` recorded an older HEAD (`54c7dc7...`), but the live repo HEAD at the start of implementation was `c10147f`. The worktree-dirt inventory in that baseline was still useful, but the exact commit hash was already stale by one commit.
