# Frontend API Truth Map

## Primary client layers

- Primary API client: `omnia-journey/src/lib/api.js`
- API base resolver: `omnia-journey/src/lib/apiBase.js`
- Secondary/duplicate client: `omnia-journey/src/lib/apiClient.ts`

## Endpoint ownership map

| Frontend file | Function / pattern | Endpoint | Used by | Truth source | Risk |
| --- | --- | --- | --- | --- | --- |
| `src/lib/api.js` | `ensureSession()` | `/session/start` | bootstrap, cart/checkout helpers, ask helper | backend session identity | medium |
| `src/pages/Welcome.jsx` | raw `fetch()` | `/assessment/:shopperId` | welcome | backend assessment/profile presence | medium |
| `src/lib/api.js` | `getAssessmentQuestions()` | `/assessment-questions` | assessment | backend question set | low |
| `src/lib/api.js` | `saveAssessment()` | `/assessment` | assessment | backend assessment save + profile write | high |
| `src/lib/api.js` | `getAssessment()` | `/assessment/:shopperId` | what-to-expect, hydrate flows | backend assessment/profile snapshot | medium |
| `src/lib/utils/resultsRecommendations.js` + `src/lib/api.js` | `resolveRecommendations()` | `/recommendations/resolve` | results | canonical backend resolver | high |
| `src/lib/utils/resultsRecommendations.js` | local fallback generator | no HTTP | results | local duplicate logic fallback | high |
| `src/lib/api.js` | `getProductsIndexByHandle()` | `/shopify/listProducts` | results, pod | Shopify product proxy | medium |
| `src/lib/api.js` | `getProductById()` | `/shopify/getProduct` | pod, explore-dev, PDP | Shopify product proxy | medium |
| `src/lib/snoozer/askSnoozerPage.js` | `sendAskSnoozerMessage()` | `/ask-snoozer` | ask-snoozer page | backend assistant orchestration | high |
| `src/lib/api.js` | `askSnoozer()` | `/ask-snoozer` | HUD/panel and other callers | backend assistant orchestration | high |
| `src/lib/apiClient.ts` | `askSnoozer()` | `/ask-snoozer` | unclear | duplicate ask wrapper | high |
| `src/lib/snoozer/hud/fetchHudScript.js` | `fetchHudScript()` | `/hud/script` | layout HUD / guided pages | backend HUD script routing/S3 truth | high |
| `src/lib/snoozer/voice/fetchHudAudio.js` | `fetchHudAudio()` | `/hud/tts` | layout HUD / guided pages | backend TTS/audio truth | medium |
| `src/lib/api.js` | `createCart()` | `/shopify/createCart` | cart, checkout, snoozepod, PDP | Shopify cart proxy | high |
| `src/lib/api.js` | `getCart()` | `/shopify/cart/get` | cart, checkout, snoozepod | Shopify cart proxy | high |
| `src/lib/api.js` | `addLinesToCart()` | `/shopify/cart/addLines` | snoozepod | Shopify cart proxy | medium |
| `src/lib/api.js` | `updateCartLines()` / `removeCartLines()` | `/shopify/cart/updateLines`, `/shopify/cart/removeLines` | cart flows | Shopify cart proxy | medium |
| `src/lib/api.js` | rewards helpers | `/rewards/*` | rewards drawer/pill | backend rewards layer | low |

## Truth overlaps to watch

- results still preserve local recommendation generation as fallback truth
- welcome does its own direct fetch instead of using `api.js`
- ask-snoozer has both `api.js` and `apiClient.ts`
- cart identity is persisted by both Zustand (`useStore.js`) and `sessionStore.js`
- some pages still touch legacy `sessionStorage` keys directly even when a store/helper exists

## Next-pass rule

Do not invent new frontend truth. Reuse:

- canonical resolver for recommendations
- Shopify proxy endpoints for product/cart data
- `sessionStore.js` or `useStore.js` deliberately, not both ad hoc in the same feature
