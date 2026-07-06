# Pod Experience Decomposition Plan

Primary file: `omnia-journey/src/pages/Pod.jsx`

## What `Pod.jsx` currently owns

- route param parsing for `podId`
- loading and normalizing stored recommendation context
- product fetches for mattress/base display
- pod hero/header rendering
- stage switching between pod home, rest test, learn, and build
- rest-test mode chooser, timer, steps, feedback, and completion flow
- HUD voice/caption guidance for pod stages
- build/setup selection state
- cart/add-to-plan feedback and footer CTA behavior
- compare/back/results/ask-snoozer navigation

## Major state groups inside `Pod.jsx`

- data/loading: `loading`, `recs`, `activePod`, `mattressProduct`, `baseProduct`
- build/setup: `selectedMattressHandle`, `selectedBaseHandle`, `buildPreviewData`, `buildSelectionState`, `buildStepKey`
- stage/navigation: `openStage`, `detailsActionId`, `showCheckoutOptions`
- rest flow: `restModeId`, `restStepIndex`, `timerRemaining`, `timerRunning`, `selectedRestInstructionId`, `restPanelPhase`, `showRestChooser`
- completion/feedback: `testComplete`, `feelChoice`, `restCompletionStage`, `cue`, `cueType`
- cart feedback: `cartNotice`, `cartPulse`
- voice bookkeeping refs: `lastPodVoiceKeyRef`, `lastRestVoiceKeyRef`, timer refs

## Backend/API dependencies

- `api.getProductsIndexByHandle({ limit: 250, lite: true })`
- `api.getProductById(handle)` for mattress and base hydration
- stored assessment/recommendation truth from sessionStorage
- Zustand `snoozepod` plan/cart state
- HUD scripts/audio through `useShowroomHud()`

## Risk areas

- one route file mixes orchestration, fetch, persistence, voice, and four distinct page modes
- rest-test timing logic is intertwined with voice and navigation state
- build logic and learn logic live next to pod-home layout concerns
- footer/action behavior depends on stage and cart state inside the same file
- local sessionStorage and Zustand are both touched from the route

## Practical target split

Keep `omnia-journey/src/pages/Pod.jsx` as the route container only.

Recommended next structure:

- `omnia-journey/src/components/pod/PodRouteShell.jsx`
- `omnia-journey/src/components/pod/PodHero.jsx`
- `omnia-journey/src/components/pod/PodStageNav.jsx`
- `omnia-journey/src/components/pod/PodHomeStage.jsx`
- `omnia-journey/src/components/pod/PodLearnStage.jsx`
- `omnia-journey/src/components/pod/PodBuildStage.jsx`
- `omnia-journey/src/components/pod/RestTestChooser.jsx`
- `omnia-journey/src/components/pod/RestTestActive.jsx`
- `omnia-journey/src/components/pod/RestTestCompletion.jsx`
- `omnia-journey/src/components/pod/PodFooterDock.jsx`
- `omnia-journey/src/hooks/usePodExperience.js`
- `omnia-journey/src/hooks/useRestTest.js`
- `omnia-journey/src/hooks/usePodHudGuidance.js`
- `omnia-journey/src/hooks/usePodBuildState.js`

## Safe decomposition order

1. Extract pure display pieces first: hero, stage nav, footer dock.
2. Extract rest-test state/handlers into `useRestTest.js`.
3. Extract build/setup state into `usePodBuildState.js`.
4. Move HUD narration triggers into `usePodHudGuidance.js`.
5. Leave the route-level file responsible only for data load + high-level stage switching.

## Next-pass acceptance target

After decomposition, `Pod.jsx` should mostly:

- read route + session context
- load pod/product truth
- call pod hooks
- render stage components
- pass compact callbacks downward
