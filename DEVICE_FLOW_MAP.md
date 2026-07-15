# MySnoozePod Device Flow Map

This document maps the intended physical showroom device flows against the React showroom app that exists today. It is documentation only. No route guards, reset logic, sensor logic, WebSockets, checkout changes, or cart changes are implemented by this document.

## Current Route Spine

Observed in `omnia-journey/src/main.jsx`:

| Route | Current status | Intended device ownership |
| --- | --- | --- |
| `/` | Redirects to `/welcome` | Welcome Kiosk default entry |
| `/start` | Redirects to `/welcome` | Legacy welcome alias |
| `/welcome` | Active | Welcome Kiosk |
| `/what-to-expect` | Active | Welcome Kiosk |
| `/assessment` | Active | Welcome Kiosk |
| `/results` | Active | Welcome Kiosk |
| `/pod/:podId` | Active | Pod iPads |
| `/ask-snoozer` | Active | Ask Snoozer Kiosk, also allowed from Pod iPads |
| `/cart` | Active | Checkout Lounge, Pod iPad cart preview, Sleep Essentials future cart preview |
| `/checkout/:id` | Active | Checkout Lounge only |
| `/checkout/guest` | Active | Checkout Lounge only |

Additional observed routes in `omnia-journey/src/main.jsx` that need device-mode decisions:

| Route | Current status | Device-mode concern |
| --- | --- | --- |
| `/faqs` | Active | Not in locked physical route spine |
| `/financing` | Active | Not in locked physical route spine |
| `/snoozepod` | Active | Cart/build plan route, may conflict with device-mode cart boundaries |
| `/explore` | Redirects to `/pod/1` | Legacy route |
| `/explore-dev` | Active | Likely admin-dev/debug only |
| `/shop-with-snoozer` | Redirects to `/pod/1` | Legacy route |
| `/ask-snoozer/explore` | Redirects to `/pod/1` | Legacy route |
| `/asksnoozer/explore` | Redirects to `/pod/1` | Legacy route |
| `/products/:slug` | Active | Product detail route, not assigned to a locked device mode |

## Shared Architecture Rules

| Area | Contract |
| --- | --- |
| Device identity | Device identity is operational context only. It must never become shopper identity. |
| Shopper identity | Shopper identity remains Snooze Code, Customer Profile OS, and Session Identity. |
| Cart truth | Shopify cart identity and checkout URL remain commerce truth. |
| Checkout truth | Checkout is sacred. Only Checkout Lounge can access checkout routes or handoff. |
| HUD | Snoozer HUD must remain mounted at layout level, persist across route changes, retain current response contract, and keep existing Rive state names. |
| Reset | Device reset must clear only safe local device/session UI state. It must never destroy a Shopify cart. |
| No polling | New device architecture must not introduce browser polling or `setInterval` loops for sensor/device state. Future sensor path remains ESP32 to AWS IoT Core to IoT Rule to Lambda Node 20 to DynamoDB to API Gateway WebSocket to React. |

## Device: Welcome Kiosk

| Field | Contract |
| --- | --- |
| Device Name | Welcome Kiosk |
| Device ID Pattern | `welcome-01` |
| Device Mode | `welcome-kiosk` |
| Hardware | Dell P2424HT, 24-inch touchscreen, Windows 11 Pro Mini PC |
| Purpose | Welcome, orientation, assessment, results, Snooze Code issuance, QR continuity |
| Allowed Routes | `/welcome`, `/what-to-expect`, `/assessment`, `/results` |
| Blocked Routes | `/pod/*`, `/ask-snoozer` unless explicitly routed as help, `/cart`, `/checkout/*`, `/snoozepod`, `/products/*`, `/explore-dev` |
| Default Route | `/welcome` |
| Visible Navigation | Welcome flow actions only: start session, what to expect, assessment, results. No cart, checkout, pod build, or product detail navigation. |
| Shopper Identity Behavior | Can create, read, and continue Snooze Code based shopper identity. Must not store device ID as shopper ID. |
| Cart Visibility | Hidden. |
| Checkout Visibility | Hidden and blocked. |
| HUD Behavior | HUD remains layout-mounted. Page-owned Snoozer visuals can speak through existing voice/HUD context. |
| Talk To Human Behavior | Allowed as a support handoff, but should not navigate to checkout. |
| Inactivity Behavior | 5-minute inactivity reset. |
| Reset Behavior | Return to `/welcome`; preserve backend shopper profile and issued Snooze Code; clear transient assessment UI only when safe. Do not clear QR workflow or active submission. |
| Reset Exceptions | Active assessment submission; active QR workflow. |
| Offline Fallback | Show a simple welcome/offline message and allow retry. If prior cached route exists, still block cart and checkout. |
| Failure Fallback | If device registry fails, default to `welcome-kiosk` only when `VITE_DEVICE_ID=welcome-01`; otherwise fail closed to `/welcome` without cart/checkout. |

## Device: Pod iPads

| Field | Contract |
| --- | --- |
| Device Name | Pod iPads |
| Device ID Pattern | `pod-1-ipad-01`, `pod-2-ipad-01`, `pod-3-ipad-01`, `pod-4-ipad-01`, `pod-5-ipad-01` |
| Device Mode | `pod-ipad` |
| Hardware | 11-inch Wi-Fi iPads, 128 GB |
| Purpose | Pod Home, Learn, Rest Test, Build Your Pod, Ask Snoozer, Cart Preview |
| Allowed Routes | Device-bound `/pod/:podId`, `/ask-snoozer`, `/cart` |
| Blocked Routes | `/welcome`, `/what-to-expect`, `/assessment`, `/results`, `/checkout/*`, `/products/*` unless explicitly approved, `/explore-dev` |
| Default Route | Device-bound pod route, for example `/pod/3` or `/pod/pod-3` depending on final route normalization |
| Visible Navigation | Pod Home, Rest Test, Learn, Build, Ask Snoozer, Talk to Human, Cart Preview. |
| Shopper Identity Behavior | Reads active Snooze Code/session context if available. Does not create shopper identity from device identity. Pod device remains permanently bound to `deviceId`, `zoneId`, and `podId`. |
| Cart Visibility | Visible as cart preview and cart review only. Cart mutation from build is permitted. |
| Checkout Visibility | Hidden and blocked. Checkout buttons from `/cart` must be disabled, redirected, or replaced on pod devices. |
| HUD Behavior | HUD remains layout-mounted. Pod page may own its Snoozer visual. Ask Snoozer route may be opened from pod context with `podId` and `zoneId`. |
| Talk To Human Behavior | Allowed. Should include pod/device context. |
| Inactivity Behavior | 15-minute reset only when all reset conditions are safe. |
| Reset Behavior | Return to the bound pod route. Keep Shopify cart intact. Clear only transient pod UI state when safe. |
| Reset Conditions | No touch activity; no occupancy; no active Rest Test; no active TTS; no cart mutation in progress. |
| Offline Fallback | Stay on cached bound pod page if available. Block checkout. Allow Talk to Human fallback if configured. |
| Failure Fallback | If registry fails for a pod iPad, fail closed to the specific pod route only if a valid local `VITE_DEVICE_ID` maps to a pod. Otherwise show device setup error. |

## Device: Ask Snoozer Kiosk

| Field | Contract |
| --- | --- |
| Device Name | Ask Snoozer Kiosk |
| Device ID Pattern | `ask-snoozer-01` |
| Device Mode | `ask-snoozer-kiosk` |
| Hardware | Acer UT272 27-inch IPS touchscreen, Windows 11 Pro Mini PC |
| Purpose | Premium Snoozer experience, mattress education, sleep education, comparisons, human assistance, future voice support |
| Allowed Routes | `/ask-snoozer` |
| Blocked Routes | `/cart`, `/checkout/*`, `/pod/*` unless opened as readonly product guidance, `/assessment`, `/results`, `/snoozepod`, `/products/*` unless explicitly approved |
| Default Route | `/ask-snoozer` |
| Visible Navigation | Ask input, full response transcript, suggested prompts, Talk to Human, optional View Results if tied to a valid Snooze Code. No checkout navigation. |
| Shopper Identity Behavior | Can read Snooze Code/session context if a shopper checks in. Cannot use device identity as shopper identity. |
| Cart Visibility | Hidden in MVP. Current `/ask-snoozer` cart badge conflicts with this and needs device-aware handling. |
| Checkout Visibility | Hidden and blocked. |
| HUD Behavior | This is a Snoozer character-led experience, not a generic chatbot. HUD/voice context remains layout-level, but the page owns the main visual chat surface. |
| Talk To Human Behavior | Prominent and always available. |
| Inactivity Behavior | 5-minute reset. |
| Reset Behavior | Return to `/ask-snoozer`; clear local chat transcript only if no active response/TTS/help request. |
| Reset Exceptions | Active response; active TTS; help requested. |
| Offline Fallback | Show offline Snoozer message and basic static help topics if available. |
| Failure Fallback | If answer endpoint fails, use existing deterministic fallback copy. If device config fails, remain on `/ask-snoozer` and block commerce actions. |

## Device: Sleep Essentials Kiosk

| Field | Contract |
| --- | --- |
| Device Name | Sleep Essentials Kiosk |
| Device ID Pattern | `sleep-essentials-01` |
| Device Mode | `sleep-essentials-kiosk` |
| Hardware | Dell P2424HT, 24-inch touchscreen, Windows 11 Pro Mini PC |
| Zone | `accessories-zone` |
| Purpose | Curated accessories, sleep environment completion, product discovery, cart additions |
| Allowed Routes | Future `/sleep-essentials`, `/cart` if cart preview is approved |
| Blocked Routes | `/checkout/*`, `/assessment`, `/results`, `/pod/*`, `/explore-dev` |
| Default Route | Future `/sleep-essentials` |
| Visible Navigation | Accessory browse, product education, add to cart, Ask Snoozer or Talk to Human if approved. |
| Shopper Identity Behavior | Reads active Snooze Code/session if available. Does not create shopper identity from device identity. |
| Cart Visibility | May be permitted. |
| Checkout Visibility | Hidden and blocked. |
| HUD Behavior | HUD remains layout-mounted. Snoozer may explain accessory fit, but product truth must come from Shopify. |
| Talk To Human Behavior | Allowed. |
| Inactivity Behavior | 8-minute reset. |
| Reset Behavior | Return to future `/sleep-essentials`; preserve Shopify cart. |
| Reset Exceptions | Product interaction; cart mutation. |
| Offline Fallback | Static unavailable message. Do not invent products, collections, handles, variant IDs, pricing, or availability. |
| Failure Fallback | If Shopify collection/product loading fails, show retry and Talk to Human. Do not fabricate product inventory. |

## Device: Checkout Lounge

| Field | Contract |
| --- | --- |
| Device Name | Checkout Lounge |
| Device ID Pattern | `checkout-01` |
| Device Mode | `checkout-kiosk` |
| Hardware | Dell P2424HT, 24-inch touchscreen, Windows 11 Pro Mini PC |
| Purpose | Cart review, checkout, delivery expectations, QR continuation, Shopify checkout handoff |
| Allowed Routes | `/cart`, `/checkout/:id`, `/checkout/guest` |
| Blocked Routes | `/welcome`, `/assessment`, `/results`, `/pod/*` unless explicitly linked as back-to-product, `/ask-snoozer` unless help overlay is allowed, `/explore-dev` |
| Default Route | `/cart` |
| Visible Navigation | Cart review, checkout handoff, QR continuation, Talk to Human. |
| Shopper Identity Behavior | Reads active shopper/session/cart context. Must never replace shopper identity with device identity. |
| Cart Visibility | Full cart visibility. |
| Checkout Visibility | Full checkout authority. |
| HUD Behavior | HUD remains layout-mounted if used for help, but must not interrupt checkout handoff. |
| Talk To Human Behavior | Allowed and should preserve cart/session context. |
| Inactivity Behavior | No standard timeout. |
| Reset Behavior | Controlled abandonment flow only. Never destroy Shopify cart. |
| Reset Requirements | Abandonment warning, session recovery, QR continuation, never destroy Shopify cart. |
| Offline Fallback | Preserve visible cart/session state if cached. Show recovery instructions and QR continuation if possible. |
| Failure Fallback | If checkout handoff fails, keep cart available and show safe retry/Talk to Human. |

## Device: Admin Dev

| Field | Contract |
| --- | --- |
| Device Name | Admin Dev |
| Device ID Pattern | `admin-dev`, local unset device ID, or explicit development override |
| Device Mode | `admin-dev` |
| Hardware | Developer browser |
| Purpose | Development, QA, route previews, test harnesses |
| Allowed Routes | All routes by default in development, including `/explore-dev` |
| Blocked Routes | None by route guard, but checkout must still use real commerce safeguards |
| Default Route | `/welcome` unless overridden |
| Visible Navigation | Developer/default navigation only |
| Shopper Identity Behavior | Can simulate shopper identity. Must not ship as production fallback. |
| Cart Visibility | Allowed for testing. |
| Checkout Visibility | Allowed for testing only when using real checkout safeguards. |
| HUD Behavior | Current layout behavior. |
| Talk To Human Behavior | Current behavior. |
| Inactivity Behavior | Disabled unless testing device reset. |
| Reset Behavior | Manual only. |
| Offline Fallback | Developer error surface. |
| Failure Fallback | Developer error surface with diagnostics. |

## Current Route Conflicts

1. `omnia-journey/src/main.jsx` currently exposes all routes globally. There is no device-mode route guard.
2. `/checkout/:id` and `/checkout/guest` are reachable from any browser/device. This conflicts with Checkout Lounge-only authority.
3. `/cart` currently contains checkout actions. Pod iPads are supposed to access cart preview but not checkout, so `/cart` needs future device-aware action gating.
4. `/ask-snoozer` currently includes cart affordances in the page/component stack. Ask Snoozer Kiosk is locked as no cart/checkout authority in MVP.
5. `/pod/:podId` accepts any pod ID on any device. Pod iPads must be permanently bound to their configured pod ID and zone ID.
6. `/welcome`, `/assessment`, and `/results` are reachable from any device. They should be Welcome Kiosk only unless admin-dev is active.
7. `/snoozepod`, `/products/:slug`, `/faqs`, `/financing`, and `/explore-dev` are outside the locked physical route spine and need explicit mode ownership or blocking.

## Current Persistent State Boundaries

Observed storage/session files:

| File | Current role |
| --- | --- |
| `omnia-journey/src/state/sessionStore.js` | Primary session adapter for thread ID, session ID, shopper ID, access code, cart ID, and checkout URL. Also writes legacy keys. |
| `omnia-journey/src/lib/session/shopifyCartState.js` | Shopify cart identity bridge. Reads/writes cart ID and checkout URL and syncs to `sessionStore.js`. |
| `omnia-journey/src/lib/CartContext.jsx` | UI cart item state and server cart sync. Stores `snooze.cartItems.v1`. |
| `omnia-journey/src/lib/useStore.js` | Zustand state for UI cart, recommendations, assessment, rewards, SnoozePod plan, and legacy storage keys. Still overlaps with cart/session ownership. |
| `omnia-journey/src/pages/Welcome.jsx` | Uses access code helpers and clears `snooze.snapshot` / `snooze.shopperState` before continuing. |
| `omnia-journey/src/pages/WhatToExpect.jsx` | Reads/writes `snooze.snapshot` and `snooze.shopperState`. |
| `omnia-journey/src/pages/Results.jsx` | Reads `snooze.assessment`; writes SnoozePod recommendation state and reward flags. |
| `omnia-journey/src/pages/Pod.jsx` | Reads assessment/recommendation context and pod-scoped storage. |
| `omnia-journey/src/pages/Cart.jsx` | Reads cart/session/recommendation state and can initiate checkout handoff. |
| `omnia-journey/src/pages/Checkout.jsx` | Owns checkout handoff flow and validates/reuses existing cart identity. |

## HUD Placement Finding

Observed in `omnia-journey/src/Layout.jsx`:

| Behavior | Current state |
| --- | --- |
| Layout-level mount | `VoiceQueueProvider` and `SnoozerHUD` are mounted at layout level. |
| Route persistence | Layout wraps all routed pages, so HUD/voice context persists across route changes. |
| Page-owned visuals | `/welcome`, `/what-to-expect`, `/assessment`, `/results`, `/pod/*`, and `/ask-snoozer` suppress the floating overlay because each page owns Snoozer visual space. |
| Response contract | Existing `SnoozerHUD` props and voice queue should remain unchanged during device implementation. |

## Reset Logic Finding

Observed reset/timer related files:

| File | Current state |
| --- | --- |
| `omnia-journey/src/hooks/useSessionTimer.js` | Uses `setInterval` for a generic 60-minute countdown. It is imported by `HeaderContextBar.jsx`, which appears tied to `/explore-dev` bars. This must not be reused as device reset architecture because new device state must avoid polling. |
| `omnia-journey/src/components/HeaderContextBar.jsx` | Displays timer and cart link when `showBars` is active for `/explore-dev`. |

No production-ready device inactivity reset controller was observed.

## Amplify SPA Assumptions

Observed files:

| File | Current state |
| --- | --- |
| `omnia-journey/amplify.yml` | Builds with `npm ci` and `npm run build`, publishes `dist`. |
| `omnia-journey/vite.config.js` | Uses `base: "/"`, outputs a single `app.js` plus root-level assets. |
| `omnia-journey/src/main.jsx` | Uses `BrowserRouter`, so hosting must rewrite deep links to `index.html`. |

## Device Flow Implementation Risks

1. A route guard that clears session state too broadly could destroy checkout continuity or cart recovery.
2. A pod device guard that simply redirects `/pod/:podId` could break current pod navigation if pod ID normalization differs between `1`, `pod-1`, and canonical IDs.
3. Blocking `/cart` for pod devices would break the expected cart preview. The guard must block checkout authority, not cart preview.
4. Using device identity as shopper identity would corrupt Customer Profile OS continuity.
5. Reusing `useSessionTimer.js` for device reset would conflict with the no-polling requirement.
6. Hiding checkout buttons only in CSS is insufficient. Blocked checkout actions need route and action-level protection.
7. Persistent HUD suppression via `pageOwnsSnoozerVisual` is intentional and should not be mistaken for HUD being unmounted.
