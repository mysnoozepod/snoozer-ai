# Frontend Component Ownership

## Major ownership map

| File | Current responsibility | Used by | Shared? | Overloaded? | Next-pass action | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `omnia-journey/src/Layout.jsx` | app shell, HUD/provider mount, rewards drawer, explore-only legacy bars | all routed pages | yes | yes | preserve as shell, simplify ownership boundaries | high |
| `omnia-journey/src/components/showroom/ShowroomPrimitives.jsx` | shared visual shell, panel, footer dock, brand/cart UI | welcome/what-to-expect/assessment/results/pod/ask-snoozer/cart | yes | moderate | keep shared; expand carefully | medium |
| `omnia-journey/src/pages/Pod.jsx` | pod hero, stage routing, rest test, learn, build, HUD voice, cart feedback | `/pod/:podId` | no | yes | decompose first | very high |
| `omnia-journey/src/components/PodBuilder.jsx` | build-your-pod interaction layer embedded inside `Pod.jsx` | `/pod/:podId` | probably route-scoped | yes | split behind smaller route-stage container | high |
| `omnia-journey/src/pages/Assessment.jsx` | question fetch, canonical question ordering, answer persistence, HUD narration, results handoff | `/assessment` | no | yes | keep page, extract question-flow and sidebar pieces later | high |
| `omnia-journey/src/pages/Results.jsx` | recommendation adapter, image hydration, voice intro, CTA layout | `/results` | no | yes | extract recommendation view pieces later | high |
| `omnia-journey/src/pages/AskSnoozer.jsx` | chat page layout, transcript UI, chips/actions rendering, CTA side effects | `/ask-snoozer` | no | moderate | simplify into chat-first page | high |
| `omnia-journey/src/lib/snoozer/askSnoozerPage.js` | request payload builder, conversation persistence, backend response normalization | `/ask-snoozer` | yes | moderate | keep, but treat as frontend truth for ask route | medium |
| `omnia-journey/src/components/SnoozerHUD.jsx` | thin adapter around `SnoozerPanel` for page/pod/result modes | layout and legacy explore path | yes | low | keep as wrapper | medium |
| `omnia-journey/src/components/SnoozerPanel.jsx` | actual HUD/chat renderer, transcript toggle, input, caption bubble | layout HUD + legacy surfaces | yes | yes | inspect carefully before any HUD redesign | high |
| `omnia-journey/src/lib/snoozer/hud/useShowroomHud.js` | voice queue + HUD action orchestration | layout and guided pages | yes | yes | keep as control point; validate persistence | high |
| `omnia-journey/src/pages/Cart.jsx` | cart review, checkout reuse, local/store identity repair | `/cart` | no | moderate | keep active, validate truth boundaries | high |
| `omnia-journey/src/pages/Checkout.jsx` | checkout redirect/create route | `/checkout/*` | no | moderate | keep active, align with cart truth | medium |
| `omnia-journey/src/pages/SnoozePod.jsx` | staged pod-plan review and Shopify cart sync | `/snoozepod` | no | moderate | inspect before touching; likely transitional | high |
| `omnia-journey/src/pages/ProductDetail.jsx` | standalone PDP/checkout-now path | `/products/:slug` | no | moderate | leave stable unless commerce pass needs it | medium |
| `omnia-journey/src/components/RewardsDrawer.jsx` | rewards overlay and catalog fetch | layout | yes | moderate | keep active but visually legacy | medium |
| `omnia-journey/src/components/HeaderContextBar.jsx` | legacy sticky header bar | only `explore-dev` via `Layout.jsx` | no | low | legacy; isolate | low |
| `omnia-journey/src/components/FooterControlBar.jsx` | legacy fixed footer controls | only `explore-dev` via `Layout.jsx` | no | low | legacy; isolate | low |
| `omnia-journey/src/layouts/ShowroomLayout.jsx` | older layout wrapper | not used by live router | no | low | likely stale | medium |
| `omnia-journey/src/components/DecisionBar.jsx` | old explore comparison footer | `Explore.jsx` only | no | low | legacy/dev-only | low |
| `omnia-journey/src/components/SnoozerCue.jsx` | old explore cue card | `Explore.jsx` only | no | low | legacy/dev-only | low |
| `omnia-journey/src/components/PodChapters.jsx` | chapter/accordion helper | not referenced by live routes | unclear | low | inspect before deletion | medium |
| `omnia-journey/src/lib/api.js` | main frontend API surface | many pages | yes | yes | keep as primary client for now | high |
| `omnia-journey/src/lib/apiClient.ts` | alternate ask-only fetch wrapper | unclear | no | low | likely duplicate/stale | medium |
| `omnia-journey/src/lib/useStore.js` | Zustand app/cart/assessment/recommendations store | many active pages | yes | yes | keep but narrow ownership | very high |
| `omnia-journey/src/state/sessionStore.js` | parallel session/thread/cart persistence layer | cart/checkout/ask helpers | yes | yes | keep but reconcile with Zustand | very high |

## Ownership takeaways

- The app shell is not the main problem; ownership drift is.
- The two biggest overloaded files are `Pod.jsx` and `Assessment.jsx`.
- The two biggest truth-overlap files are `useStore.js` and `sessionStore.js`.
- `api.js` is the actual primary frontend API client; `apiClient.ts` is the clearest duplicate candidate.
- Several legacy pieces still exist because `explore-dev` remains wired in the live router.
