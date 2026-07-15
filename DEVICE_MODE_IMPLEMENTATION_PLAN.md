# MySnoozePod Device Mode Implementation Plan

This document is an implementation plan only. It does not implement device modes, route guards, reset logic, sensors, AWS IoT, WebSockets, checkout changes, or cart changes.

## Implementation Objective

Add a device-mode layer that lets the same React showroom app run safely on different physical devices without changing shopper identity, Shopify cart truth, checkout handoff, Snoozer HUD contracts, or product truth.

The device layer should answer four questions before a page or action runs:

1. Which physical device is this?
2. Which device mode is allowed?
3. Which routes and actions are allowed?
4. What reset behavior is safe for this mode?

## Observed Current Architecture

| Area | Finding |
| --- | --- |
| Router | `omnia-journey/src/main.jsx` defines all app routes under a single `Layout`. No device guard exists. |
| Layout | `omnia-journey/src/Layout.jsx` mounts `VoiceQueueProvider`, `SnoozerHUD`, and the routed `Outlet`. HUD/voice context persists across route changes. |
| HUD visibility | `Layout.jsx` suppresses floating HUD overlay on pages that own the Snoozer visual: `/welcome`, `/what-to-expect`, `/assessment`, `/results`, `/pod/*`, `/ask-snoozer`. |
| Session identity | `omnia-journey/src/state/sessionStore.js` owns current session ID, thread ID, shopper ID, access code, cart ID, and checkout URL, while also maintaining legacy keys. |
| Cart identity | `omnia-journey/src/lib/session/shopifyCartState.js` bridges Shopify cart ID and checkout URL into session state. |
| Cart UI state | `omnia-journey/src/lib/CartContext.jsx` owns local cart item UI state and server cart sync. |
| Legacy state | `omnia-journey/src/lib/useStore.js` still owns or mirrors cart, checkout URL, recommendations, assessment, rewards, and SnoozePod plan state. |
| Checkout | `omnia-journey/src/pages/Checkout.jsx` validates existing cart identity, creates Shopify cart when needed, and redirects to checkout URL. This must stay sacred. |
| Cart page | `omnia-journey/src/pages/Cart.jsx` can initiate checkout handoff. Future device mode must allow cart preview on pod devices while blocking checkout handoff. |
| Reset | No device reset controller exists. `useSessionTimer.js` is a simple `setInterval` countdown for `HeaderContextBar.jsx` and should not be reused for production device reset. |
| Kiosk configuration | No device registry, device mode loader, device enrollment, config cache, or stale config handling was observed. |
| Amplify SPA | `BrowserRouter` is used, so all deep device routes require SPA rewrite support to `index.html`. |

## Device Modes

### `welcome-kiosk`

| Field | Plan |
| --- | --- |
| Route permissions | Allow `/welcome`, `/what-to-expect`, `/assessment`, `/results`. Redirect other routes to `/welcome` or a safe support screen. |
| Visible navigation | Welcome flow only. No cart, checkout, pod build, or product detail links. |
| Allowed actions | Snooze Code entry/issuance, assessment, recommendation results, QR continuity, Talk to Human. |
| Blocked actions | Cart mutation, checkout handoff, pod build, direct product checkout, admin/debug routes. |
| Session behavior | Can create/read/update shopper session via Snooze Code and assessment. |
| Local storage behavior | May store Snooze Code/session/profile hints through `sessionStore.js`. Reset only transient welcome/assessment state when safe. |
| Shopper identity behavior | Uses Snooze Code/access code/shopper ID only. Never uses `deviceId` as shopper ID. |
| Route guards | Block `/cart`, `/checkout/*`, `/pod/*`, `/snoozepod`, `/products/*`, `/explore-dev`. |
| Reset rules | 5-minute reset, except active assessment submission or active QR workflow. |
| Offline behavior | Show retry/offline state. Do not expose cart/checkout. |
| Environment configuration | `VITE_DEVICE_ID=welcome-01`; optional `VITE_DEVICE_MODE=welcome-kiosk` only as bootstrap fallback. |
| Device registry requirements | Enabled device record with mode `welcome-kiosk`, store ID, default route, allowed routes, blocked routes, config version. |
| Device enrollment | One-time pairing or fixed env configuration for the physical mini PC. |
| Device identity loading | Load registry by `deviceId` before route guard evaluates. |
| Stale config handling | Use cached config for display, but fail closed for cart/checkout if config is stale. |
| Config caching | Cache last valid registry response locally with config version and timestamp. |
| HUD behavior | HUD remains layout-mounted. Page-owned Snoozer visuals may use existing voice queue. |

### `pod-ipad`

| Field | Plan |
| --- | --- |
| Route permissions | Allow only the bound pod route, `/ask-snoozer`, and `/cart`. |
| Visible navigation | Pod Home, Rest Test, Learn, Build, Ask Snoozer, Talk to Human, Cart Preview. |
| Allowed actions | Pod education, Rest Test, build setup, add to cart, cart preview, Ask Snoozer, Talk to Human. |
| Blocked actions | Checkout handoff, other pod routes, welcome/assessment/results routes, direct product checkout. |
| Session behavior | Reads active shopper/session context if present; does not own shopper identity. |
| Local storage behavior | May keep pod-scoped UI state such as rest test status. Must preserve cart identity during reset. |
| Shopper identity behavior | Shopper identity remains Snooze Code/session. Device registry supplies only `deviceId`, `zoneId`, and bound `podId`. |
| Route guards | If a pod iPad tries `/pod/:otherPodId`, redirect to its bound pod. If it tries checkout, redirect to `/cart` or safe blocked screen. |
| Reset rules | 15-minute reset only when no touch activity, no occupancy, no active Rest Test, no active TTS, and no cart mutation. |
| Offline behavior | Stay on cached bound pod if possible. Disable checkout. Keep cart safe. |
| Environment configuration | `VITE_DEVICE_ID=pod-3-ipad-01` style. |
| Device registry requirements | Bound `podId`, `zoneId`, allowed route patterns, blocked checkout patterns, enabled flag. |
| Device enrollment | Each iPad must be enrolled to a single pod and zone. |
| Device identity loading | Load registry before route guard; route to bound pod by default. |
| Stale config handling | Continue on cached bound pod only if cache has matching `deviceId`; otherwise device setup error. |
| Config caching | Cache last valid registry response with pod ID and version. |
| HUD behavior | HUD remains layout-mounted. Pod page owns main Snoozer/pod visual; `/ask-snoozer` can receive pod context. |

### `ask-snoozer-kiosk`

| Field | Plan |
| --- | --- |
| Route permissions | Allow `/ask-snoozer` only for MVP. |
| Visible navigation | Ask input, full response transcript, suggested questions, Talk to Human, optional Snooze Code support. |
| Allowed actions | Ask Snoozer, policy/product/session guidance, Talk to Human, future TTS/Polly. |
| Blocked actions | Cart, checkout, add to cart, pod build, direct product checkout. |
| Session behavior | Can attach to shopper/session if Snooze Code exists, but works safely without it. |
| Local storage behavior | May keep chat transcript and active session hints. Reset clears transcript only when safe. |
| Shopper identity behavior | Uses Snooze Code/session only. Device ID never becomes shopper ID. |
| Route guards | Block `/cart`, `/checkout/*`, `/pod/*`, `/assessment`, `/results`, `/snoozepod`, and unrelated commerce routes. |
| Reset rules | 5-minute reset except active response, TTS active, or help requested. |
| Offline behavior | Show offline Snoozer state and static safe help topics. |
| Environment configuration | `VITE_DEVICE_ID=ask-snoozer-01`. |
| Device registry requirements | Mode `ask-snoozer-kiosk`, default route `/ask-snoozer`, no cart/checkout authority. |
| Device enrollment | One-time pairing or fixed env configuration for the 27-inch kiosk. |
| Device identity loading | Load registry before page actions. |
| Stale config handling | Allow `/ask-snoozer` with no commerce actions if registry cache is stale. |
| Config caching | Cache last valid config; fail closed for commerce. |
| HUD behavior | Character-led Snoozer experience. Do not turn into a generic chatbot. Keep response contract and Rive state names. |

### `sleep-essentials-kiosk`

| Field | Plan |
| --- | --- |
| Route permissions | Future `/sleep-essentials`; `/cart` if cart preview is approved. |
| Visible navigation | Accessory discovery, add to cart, Ask Snoozer or Talk to Human if approved. |
| Allowed actions | Shopify-backed accessory browse and add to cart. |
| Blocked actions | Checkout handoff, invented products, invented collections, invented handles, invented prices, direct checkout. |
| Session behavior | Reads active shopper/session context if present. |
| Local storage behavior | May use cart/session state; must preserve Shopify cart identity during reset. |
| Shopper identity behavior | Uses Snooze Code/session only. |
| Route guards | Block `/checkout/*`, `/assessment`, `/results`, `/pod/*`, `/explore-dev`. |
| Reset rules | 8-minute reset except product interaction or cart mutation. |
| Offline behavior | Show retry/offline state. No fabricated product data. |
| Environment configuration | `VITE_DEVICE_ID=sleep-essentials-01`. |
| Device registry requirements | Zone `accessories-zone`; route pending until `/sleep-essentials` exists. |
| Device enrollment | One-time pairing or fixed env configuration. |
| Device identity loading | Load registry before future route renders. |
| Stale config handling | Fail closed to static unavailable state if route/config is missing. |
| Config caching | Cache last valid config; block checkout even if cache exists. |
| HUD behavior | HUD remains layout-mounted. Product truth must come from Shopify. |

### `checkout-kiosk`

| Field | Plan |
| --- | --- |
| Route permissions | Allow `/cart`, `/checkout/:id`, `/checkout/guest`. |
| Visible navigation | Cart review, checkout handoff, QR continuation, Talk to Human. |
| Allowed actions | Cart review, Shopify checkout handoff, recovery, QR continuation. |
| Blocked actions | Standard inactivity reset that destroys cart, unsafe cart clearing, unrelated kiosk flows. |
| Session behavior | Reads active shopper/session/cart context. Must preserve checkout continuity. |
| Local storage behavior | Preserve cart ID, checkout URL, and recovery state. Never clear Shopify cart identity automatically. |
| Shopper identity behavior | Uses Snooze Code/session only. Device ID never becomes shopper ID. |
| Route guards | Only checkout-kiosk gets checkout routes. Other modes hitting checkout should redirect safely without destroying cart. |
| Reset rules | No standard timeout. Use controlled abandonment warning, session recovery, and QR continuation. |
| Offline behavior | Show recovery instructions and retry. Preserve any cached cart/session identifiers. |
| Environment configuration | `VITE_DEVICE_ID=checkout-01`. |
| Device registry requirements | Checkout authority flag; default `/cart`; allowed checkout routes. |
| Device enrollment | One-time pairing or fixed env configuration. |
| Device identity loading | Load registry before checkout route renders; if unavailable, fail safe but do not clear cart. |
| Stale config handling | Preserve checkout state; block destructive reset. |
| Config caching | Cache last valid checkout config, but require enabled checkout authority for handoff. |
| HUD behavior | Optional support only. Must not interrupt checkout handoff or change response contract. |

### `admin-dev`

| Field | Plan |
| --- | --- |
| Route permissions | Allow all routes in development. |
| Visible navigation | Current developer/default navigation. |
| Allowed actions | QA, preview, route testing, route guard testing. |
| Blocked actions | None by device guard, but checkout safety still applies. |
| Session behavior | Can simulate shopper/session state. |
| Local storage behavior | Can expose diagnostics and manual reset. |
| Shopper identity behavior | Must not ship as production fallback. |
| Route guards | Bypass or diagnostic-only guard. |
| Reset rules | Disabled unless explicitly testing. |
| Offline behavior | Developer error state. |
| Environment configuration | `VITE_DEVICE_MODE=admin-dev` or local development env. |
| Device registry requirements | Optional. |
| Device enrollment | Not required. |
| Device identity loading | Optional. |
| Stale config handling | Warn only. |
| Config caching | Optional. |
| HUD behavior | Current behavior. |

## Required Device Registry Contract

The registry should be treated as configuration, not shopper/session data.

```json
{
  "deviceId": "pod-3-ipad-01",
  "deviceMode": "pod-ipad",
  "env": "dev",
  "storeId": "severn-pilot",
  "zoneId": "pod-3",
  "podId": "pod-3",
  "defaultRoute": "/pod/pod-3",
  "allowedRoutePatterns": ["/pod/pod-3", "/ask-snoozer", "/cart"],
  "blockedRoutePatterns": ["/welcome", "/assessment", "/checkout/*"],
  "enabled": true,
  "configVersion": 1,
  "checkoutAuthority": false,
  "cartAuthority": "preview",
  "resetPolicy": {
    "timeoutMs": 900000,
    "requiresNoTouch": true,
    "requiresNoOccupancy": true,
    "requiresNoActiveRestTest": true,
    "requiresNoActiveTts": true,
    "requiresNoCartMutation": true
  }
}
```

Minimum fields:

| Field | Required | Notes |
| --- | --- | --- |
| `deviceId` | Yes | Physical device identifier. |
| `deviceMode` | Yes | One of the approved modes. |
| `env` | Yes | `dev`, `staging`, or `prod`. |
| `storeId` | Yes | Showroom/store deployment identifier. |
| `zoneId` | Mode-specific | Required for pod and accessory zones. |
| `podId` | Pod only | Permanent pod binding. |
| `defaultRoute` | Yes | Safe default route for the mode. |
| `allowedRoutePatterns` | Yes | Route allowlist. |
| `blockedRoutePatterns` | Yes | Route blocklist, especially checkout. |
| `enabled` | Yes | Disabled devices fail closed. |
| `configVersion` | Yes | Used for stale config detection and migration. |
| `checkoutAuthority` | Recommended | Explicit true only for Checkout Lounge. |
| `cartAuthority` | Recommended | `none`, `preview`, or `full`. |
| `resetPolicy` | Recommended | Mode-specific reset contract. |

## Proposed Files To Add During Implementation

These are recommended future files, not created in this pass:

| File | Purpose |
| --- | --- |
| `omnia-journey/src/device/deviceModes.js` | Defines approved mode names and mode-level defaults. |
| `omnia-journey/src/device/deviceRegistry.js` | Loads, validates, caches, and normalizes device registry config. |
| `omnia-journey/src/device/DeviceModeProvider.jsx` | Provides device config and guard state to routes/components. |
| `omnia-journey/src/device/DeviceRouteGuard.jsx` | Enforces allowed/blocked route patterns and safe redirects. |
| `omnia-journey/src/device/useDeviceInactivityReset.js` | Future reset orchestration without polling-based sensor state. |
| `omnia-journey/src/device/deviceActionGuards.js` | Action-level guards for checkout, cart mutation, add-to-cart, Talk to Human, etc. |
| `omnia-journey/src/device/deviceRoutePatterns.js` | Shared route pattern matcher. |
| `omnia-journey/src/device/deviceConfigCache.js` | Local cache helpers with config version and timestamp. |

## Existing Files Likely Touched During Implementation

| File | Expected implementation role |
| --- | --- |
| `omnia-journey/src/main.jsx` | Wrap routed pages with `DeviceModeProvider` and route guard once device layer is approved. |
| `omnia-journey/src/Layout.jsx` | Inject device context into HUD/page layout while keeping HUD mounted. |
| `omnia-journey/src/state/sessionStore.js` | Keep shopper/session identity separate from device identity. Add only device-safe read helpers if needed. |
| `omnia-journey/src/lib/session/shopifyCartState.js` | Preserve cart identity and checkout URL during resets. |
| `omnia-journey/src/lib/CartContext.jsx` | Expose cart mutation-in-progress state for reset exceptions if needed. |
| `omnia-journey/src/lib/useStore.js` | Avoid new device identity ownership here; may need compatibility with action guards. |
| `omnia-journey/src/pages/Welcome.jsx` | Welcome mode route behavior and reset-safe state boundaries. |
| `omnia-journey/src/pages/WhatToExpect.jsx` | Welcome mode route behavior. |
| `omnia-journey/src/pages/Assessment.jsx` | Assessment active-submission reset exception. |
| `omnia-journey/src/pages/Results.jsx` | Results route ownership and QR continuity. |
| `omnia-journey/src/pages/Pod.jsx` | Pod ID binding, Rest Test reset exceptions, pod context for Ask Snoozer. |
| `omnia-journey/src/pages/AskSnoozer.jsx` | Ask Snoozer Kiosk cart removal/blocking in MVP and transcript reset boundaries. |
| `omnia-journey/src/pages/Cart.jsx` | Device-aware checkout action guard while preserving cart preview. |
| `omnia-journey/src/pages/Checkout.jsx` | Checkout Lounge-only route guard. Do not change checkout handoff logic except adding guard boundary. |
| `omnia-journey/src/pages/ProductDetail.jsx` | Decide whether product detail is blocked, readonly, or admin-dev only. |
| `omnia-journey/src/components/HeaderContextBar.jsx` | Current dev-only timer/cart link should not become production device reset. |
| `omnia-journey/src/hooks/useSessionTimer.js` | Do not reuse for production device reset because it uses `setInterval`. |
| `omnia-journey/src/components/SnoozerHUD.jsx` | Preserve response contract and Rive state names. |
| `omnia-journey/src/components/SnoozerPanel.jsx` | Action-level cart/checkout affordances may need device-aware guards. |
| `omnia-journey/src/lib/snoozer/hud/useShowroomHud.js` | HUD action mapping may need device-safe action filtering. |
| `omnia-journey/src/lib/api.js` | Backend boundary for future registry lookup if config comes from API. |

## Backend/Infrastructure Likely Needed Later

No backend changes are made by this pass. Future implementation may need:

| Area | Purpose |
| --- | --- |
| Device registry endpoint or static manifest | Serve device config by `deviceId`. |
| DynamoDB device registry table | Store enabled devices, route permissions, zone/pod binding, config version. |
| API Gateway WebSocket | Future sensor/device event delivery to React. |
| AWS IoT Core and IoT Rule | Future ESP32 occupancy/touch sensor ingestion. |
| Lambda Node 20 event handler | Translate IoT events into session/device state updates. |

## Implementation Sequence

1. Add the frontend device-mode constants and route pattern matcher.
2. Add a registry loader that can read local env config first and optionally fetch remote registry later.
3. Add config validation and cached last-known-good config.
4. Add `DeviceModeProvider` above routes without enforcing redirects yet.
5. Add read-only diagnostics in development/admin-dev to confirm current mode, device ID, allowed routes, and blocked routes.
6. Add route guard in report-only mode and run the regression matrix.
7. Enforce route guard for checkout routes first, because checkout authority is the highest-risk boundary.
8. Add pod binding enforcement for `/pod/:podId`.
9. Add visible navigation filtering by device mode.
10. Add action-level guards for checkout buttons and cart mutations where mode requires it.
11. Add reset controller shell that can observe existing app activity flags.
12. Add reset exceptions for assessment submission, QR workflow, active Rest Test, active TTS, help requested, occupancy, and cart mutation.
13. Add future event-driven sensor integration only after route/action guards are stable.

## Validation Checklist For Implementation

### Welcome Kiosk

| Check | Expected |
| --- | --- |
| `/welcome` | Loads. |
| `/what-to-expect` | Loads. |
| `/assessment` | Loads. |
| `/results` | Loads. |
| `/cart` | Blocked or redirected safely. |
| `/checkout/guest` | Blocked. |
| Active assessment submission | Reset does not interrupt. |
| QR workflow | Reset does not interrupt. |

### Pod iPad

| Check | Expected |
| --- | --- |
| Bound `/pod/:podId` | Loads. |
| Other pod route | Redirects to bound pod. |
| `/ask-snoozer` | Loads with pod/device context. |
| `/cart` | Preview/review allowed. |
| Checkout action | Blocked or transferred to Checkout Lounge flow. |
| Active Rest Test | Reset blocked. |
| Active TTS | Reset blocked. |
| Cart mutation | Reset blocked. |

### Ask Snoozer Kiosk

| Check | Expected |
| --- | --- |
| `/ask-snoozer` | Loads premium Snoozer chat. |
| Cart badge/action | Hidden or blocked in MVP. |
| `/checkout/*` | Blocked. |
| Active response | Reset blocked. |
| TTS active | Reset blocked. |
| Talk to Human | Available. |

### Sleep Essentials Kiosk

| Check | Expected |
| --- | --- |
| `/sleep-essentials` | Future route only. |
| Shopify truth | Products/prices/availability come from Shopify. |
| `/cart` | Allowed only if cart preview approved. |
| `/checkout/*` | Blocked. |
| Product interaction | Reset blocked. |
| Cart mutation | Reset blocked. |

### Checkout Lounge

| Check | Expected |
| --- | --- |
| `/cart` | Loads full cart review. |
| `/checkout/:id` | Allowed. |
| `/checkout/guest` | Allowed. |
| Abandonment | Warning/recovery, not destructive reset. |
| Shopify cart ID | Preserved. |
| Checkout URL | Preserved. |

## Missing Requirements

1. Final registry storage location: static JSON, backend endpoint, DynamoDB, or hybrid.
2. Device enrollment method for Windows kiosks and iPads.
3. Exact local env variable names for device bootstrap.
4. Pod ID route canonical form: `/pod/3` versus `/pod/pod-3`.
5. How pod devices transfer checkout intent to Checkout Lounge.
6. Whether `/products/:slug`, `/faqs`, `/financing`, and `/snoozepod` are blocked, admin-dev only, or assigned to a mode.
7. Whether Ask Snoozer Kiosk can view results by Snooze Code in MVP.
8. Whether Sleep Essentials Kiosk is included in MVP or held until product/collection truth is available.
9. Exact reset state clearing list per mode.
10. Sensor event schema for occupancy/no occupancy once IoT work begins.
11. WebSocket authentication/authorization for device event delivery.
12. Error UX for disabled, unknown, or stale devices.

## Route Guard Rules

The route guard should evaluate in this order:

1. If `admin-dev`, allow route and log diagnostics.
2. If device config is missing or disabled, fail closed to the safest route for known env config or show setup error.
3. If route matches blocked patterns, redirect to `defaultRoute` or a safe blocked-action screen.
4. If route does not match allowed patterns, redirect to `defaultRoute`.
5. If route is checkout and device lacks `checkoutAuthority`, redirect to `/cart` only when `/cart` is allowed; otherwise default route.
6. If route is pod route on `pod-ipad`, normalize route pod ID and enforce configured pod ID.
7. Never clear cart/session state during route guard redirects.

## Reset Rules

The reset controller should evaluate safety before resetting:

| Signal | Source |
| --- | --- |
| Touch activity | App-level pointer/touch/keyboard listener |
| Occupancy | Future WebSocket device event |
| Active Rest Test | Pod page state |
| Active TTS | Voice queue state in `Layout.jsx` / `VoiceQueueProvider` |
| Cart mutation | `CartContext.jsx` or action guard state |
| Assessment submission | `Assessment.jsx` submit state |
| QR workflow | Welcome/results QR state |
| Active response | Ask Snoozer page request state |
| Help requested | Talk to Human state |

The reset controller must not rely on browser polling for sensors. Timeouts for local inactivity are acceptable, but sensor state should arrive through the future WebSocket path.

## Decisions Still Required

1. Should device registry be served by Lambda/API Gateway or bundled as a signed static manifest for MVP?
2. Should unknown devices default to `admin-dev` in local development only, and fail closed in staging/production?
3. Should pod routes use numeric IDs (`/pod/3`) or canonical pod IDs (`/pod/pod-3`) in registry?
4. What exact experience should a pod iPad show when shopper taps checkout from cart preview?
5. Should Ask Snoozer Kiosk ever allow cart viewing after a shopper checks in, or remain no-commerce in MVP?
6. Is Sleep Essentials included in the first device-mode implementation or deferred until Shopify accessory collections are defined?
7. What state must be preserved across Welcome reset for QR continuity?
8. What is the abandonment warning design for Checkout Lounge?
9. What diagnostics are acceptable on physical devices versus admin-dev only?

## Recommended First Implementation Sprint

1. Implement local-only device mode config with `VITE_DEVICE_ID` and a small validated registry manifest.
2. Add `DeviceModeProvider` and diagnostics without enforcement.
3. Add route guard enforcement for checkout routes only.
4. Add pod binding enforcement for pod iPads.
5. Add visible navigation/action filtering for cart and checkout authority.
6. Add reset controller skeleton with no sensor integration.
7. Add mode regression tests for route permissions.
8. Defer IoT/WebSockets until the route/action layer is proven stable.

## Non-Goals For First Implementation

1. Do not modify Shopify product truth.
2. Do not change pricing, variant IDs, availability, inventory, cart behavior, or checkout handoff.
3. Do not add Sleep Essentials product data until Shopify source of truth is confirmed.
4. Do not change Snoozer HUD response contracts or Rive state names.
5. Do not implement ESP32, IoT Core, DynamoDB sensor state, or WebSockets until after device guard foundation is stable.
