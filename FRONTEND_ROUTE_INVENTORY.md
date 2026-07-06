# Frontend Route Inventory

Primary router file: `omnia-journey/src/main.jsx`

## Intended showroom journey

`/welcome` -> `/what-to-expect` -> `/assessment` -> `/results` -> `/pod/:podId` -> `/cart` -> `/checkout/guest`

## Registered routes

| Route | Component | Status | Purpose | Backend/API dependencies | State/HUD/cart notes | Risks |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | redirect to `/welcome` | active | showroom entry | none | no cart/HUD logic here | none |
| `/start` | redirect to `/welcome` | active alias | legacy entry alias | none | no cart/HUD logic here | alias sprawl |
| `/welcome` | `src/pages/Welcome.jsx` | active | Snooze Code entry/start session | raw `fetch(${apiBase}/assessment/:shopperId)` background hydrate | uses `useShowroomHud`; writes `snooze.accessCode`, `snooze.shopperId` directly to sessionStorage; no cart | bypasses `api.js` for hydrate call |
| `/what-to-expect` | `src/pages/WhatToExpect.jsx` | active | assessment/results fork page | `getAssessment()` -> `GET /assessment/:shopperId` | uses `useShowroomHud`; reads `snooze.snapshot`; no cart | another page-specific snapshot truth layer |
| `/faqs` | `src/pages/Faqs.jsx` | placeholder | support stub | none | no HUD/cart | customer-facing placeholder |
| `/financing` | `src/pages/Financing.jsx` | placeholder | support stub | none | no HUD/cart | customer-facing placeholder |
| `/assessment` | `src/pages/Assessment.jsx` | active | guided assessment flow | `getAssessmentQuestions()` -> `GET /assessment-questions`; `saveAssessment()` -> `POST /assessment` | uses Zustand assessment state + sessionStorage + `useShowroomHud`; cart badge reads `snoozepod` | large single file; local canonical question rewriting |
| `/results` | `src/pages/Results.jsx` | active | recommendation handoff to pods | canonical path `POST /recommendations/resolve`; fallback local generator; `getProductsIndexByHandle()` / `getProductById()` for images | uses `useShowroomHud`; no cart shown by current UI intent; reads recommendations/assessment from storage | mixes data adaptation, image hydration, voice, and UI |
| `/pod/:podId` | `src/pages/Pod.jsx` | active | pod home/rest/learn/build experience | `getProductsIndexByHandle()` and `getProductById()` for mattress/base | heavy `useShowroomHud`; heavy Zustand cart/plan use; reads assessment/recommendations from storage | most overloaded route in app |
| `/snoozepod` | `src/pages/SnoozePod.jsx` | active but transitional | review staged pod plan before cart | `createCart()`, `addLinesToCart()`, `getCart()` | Zustand `snoozepod` + direct sessionStorage cart identity writes | naming is confusing; overlaps with `/cart` |
| `/explore` | redirect to `/pod/1` | active alias | old showroom entry alias | none | no direct HUD/cart | alias sprawl |
| `/explore-dev` | `src/pages/Explore.jsx` | legacy/dev | old exploratory showroom page | `getProductById()` plus local recommendation generation | uses old `DecisionBar`, `SnoozerCue`, `SnoozerHUD`; local cart add | parallel legacy journey still exists |
| `/shop-with-snoozer` | redirect to `/pod/1` | legacy alias | old CTA alias | none | none | alias sprawl |
| `/ask-snoozer/explore` | redirect to `/pod/1` | legacy alias | old ask/explore alias | none | none | alias sprawl |
| `/asksnoozer/explore` | redirect to `/pod/1` | legacy typo alias | typo support | none | none | alias sprawl |
| `/ask-snoozer` | `src/pages/AskSnoozer.jsx` | active | dedicated chat page | `sendAskSnoozerMessage()` -> `POST /ask-snoozer` | reads Zustand `snoozepod`; disables global widget; local transcript state; footer CTAs | current chat layout and transcript sizing are fragile |
| `/cart` | `src/pages/Cart.jsx` | active | final in-app cart review | `ensureSession()`, `getCart()`, `createCart()` | Zustand cart + `sessionStore` cart identity + legacy sessionStorage | duplicate cart truth and checkout reuse logic |
| `/checkout/guest` | `src/pages/Checkout.jsx` | active | checkout redirect/create route | `ensureSession()`, `getCart()`, `createCart()` | Zustand cart + `sessionStore` cart identity | duplicate cart reuse logic with `/cart` |
| `/checkout/:id` | `src/pages/Checkout.jsx` | compatibility | route compatibility wrapper | same as above | `:id` is effectively ignored | likely legacy compatibility only |
| `/products/:slug` | `src/pages/ProductDetail.jsx` | active support | direct product detail/commerce page | `getProductById()`, `createCart()` | Zustand cart + `sessionStore` cart identity | separate commerce path outside showroom journey |
| `*` | `src/pages/NotFound.jsx` or inline import target from router | active fallback | 404 | none | none | low |

## Other page files not registered in the live router

| File | Status | Notes |
| --- | --- | --- |
| `omnia-journey/src/pages/WelcomeScreen.jsx` | legacy/stub | older starter screen, not routed |
| `omnia-journey/src/pages/ExploreScreen.jsx` | legacy/stub | older stub, not routed |
| `omnia-journey/src/pages/TalkToHuman.jsx` | legacy/placeholder | not registered in live router |
| `omnia-journey/src/OmniaApp.jsx` | legacy | points to `views/WelcomeView.jsx`, not used by `main.jsx` |

## Route-level preflight takeaways

- The intended customer journey is clean in the router, but several legacy aliases and dev routes are still live.
- `/pod/:podId` and `/ask-snoozer` are the highest-risk customer-facing routes for the next pass.
- `/cart`, `/checkout`, `/product/:slug`, and `/snoozepod` share overlapping commerce identity logic that should be treated carefully.
