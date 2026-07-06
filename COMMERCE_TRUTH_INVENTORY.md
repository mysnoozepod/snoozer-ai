# Commerce Truth Inventory

Commerce standard in the current backend:

- **Shopify Storefront API owns** live prices, availability, cart state, checkout URL, product/variant IDs.
- **Canon / catalog / showroom manifest own** curated showroom assortment, recommendation mapping, pod-to-product mapping, and allowed option combinations.

| File / Location | Route / Helper | Commerce value touched | Current source of truth | Shopify Storefront involvement | Canon / catalog involvement | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [routes/shopifyRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\shopifyRoutes.js) | `handleShopifyRoute(...)` | route dispatch for product/cart operations | Shopify Storefront API | yes | no | high | Thin controller around live commerce mutations/reads. |
| [routes/shopifyRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\shopifyRoutes.js) | `listProducts` | product list, handles, summaries | Shopify Storefront API | yes | no | medium | Customer-facing live list/read path. |
| [routes/shopifyRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\shopifyRoutes.js) | `getProduct` | product detail, variants, availability, price ranges | Shopify Storefront API | yes | no | medium | Product/variant truth route. |
| [routes/shopifyRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\shopifyRoutes.js) | `createCartRoute` | cart creation, checkout URL | Shopify Storefront API | yes | no | high | Live cart bootstrap. |
| [routes/shopifyRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\shopifyRoutes.js) | `getCartRoute` | cart lines, totals, checkout URL | Shopify Storefront API | yes | no | high | Live cart read. |
| [routes/shopifyRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\shopifyRoutes.js) | `addCartLinesRoute` | line add, variant IDs, quantities | Shopify Storefront API | yes | no | high | Live cart mutation. |
| [routes/shopifyRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\shopifyRoutes.js) | `updateCartLinesRoute` | line update, quantities | Shopify Storefront API | yes | no | high | Live cart mutation. |
| [routes/shopifyRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\shopifyRoutes.js) | `removeCartLinesRoute` | line removal | Shopify Storefront API | yes | no | high | Live cart mutation. |
| [services/shopify.js](C:\Users\14342\Desktop\snoozer-ai\services\shopify.js) | Storefront helpers | prices, availability, product handles, product IDs, variant IDs, cart, checkout | Shopify Storefront API | yes | no | high | This is the real commerce truth layer. |
| [services/tools.js](C:\Users\14342\Desktop\snoozer-ai\services\tools.js) | legacy deterministic tools | live product price lookup, variant resolution, cart / checkout tool calls | Shopify Storefront API | yes | no | high | Still used by legacy OpenAI orchestration; should not drift from `services/shopify.js`. |
| [routes/recommendationRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\recommendationRoutes.js) | `/recommendations/resolve` | top pod, mattress handle, base handle, motion mapping | canon / catalog | no | yes | low | No live pricing here by design. |
| [services/recommendationResolver.js](C:\Users\14342\Desktop\snoozer-ai\services\recommendationResolver.js) | `resolveRecommendation(...)` | pod ranking, mattress/base selection, motion normalization | canon / catalog | no | yes | low | Primary canonical recommendation logic. |
| [services/showroomManifest.js](C:\Users\14342\Desktop\snoozer-ai\services\showroomManifest.js) | manifest loader/validator | curated products, pod mapping, allowed motion/base schema | canon / catalog | no | yes | low | Canonical showroom assortment loader. |
| [data/showroom-manifest.v1.json](C:\Users\14342\Desktop\snoozer-ai\data\showroom-manifest.v1.json) | static manifest | product handles, pod mapping, allowed motion/base rules | canon / catalog | no | yes | medium | Canonical for assortment/recommendation mapping only; intentionally not live price truth. |
| [index.js](C:\Users\14342\Desktop\snoozer-ai\index.js) | `/ask-snoozer` | recommendation explanation, optional product/cart handoff via legacy model/tool path | mixed | indirect | yes | high | Conversational path can reference commerce; should keep deferring actual live values to Shopify/tool layer. |
| [services/openai.js](C:\Users\14342\Desktop\snoozer-ai\services\openai.js) | constrained fallback/model helper with legacy commerce-aware tooling | product lookup, cart intents, checkout guidance, tool access | mixed with Shopify as truth | yes | yes | medium | Still active, but no longer treated as primary product truth. Live values must continue to defer to Shopify helpers. |
| [products.json](C:\Users\14342\Desktop\snoozer-ai\products.json) | quarantined legacy bundled product data | static prices, features, FAQ copy | none for deployed backend | no | no | low | No active runtime imports were found. This file is retained in-repo only for audit/history and is no longer packaged into Lambda. |
| [routes/rewardsRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\rewardsRoutes.js) | rewards debug + balance/redemption | reward balances, optional Shopify price-rule debug | DynamoDB Customer Profile OS, Zoho, Shopify debug | partial | no | medium | Commerce-adjacent but not the checkout/cart truth lane. |

## Commerce boundary summary

### Safe current boundary

- Use [services/shopify.js](C:\Users\14342\Desktop\snoozer-ai\services\shopify.js) and [routes/shopifyRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\shopifyRoutes.js) for anything live:
  - price
  - availability
  - variant IDs
  - cart lines
  - checkout URLs

- Use [services/recommendationResolver.js](C:\Users\14342\Desktop\snoozer-ai\services\recommendationResolver.js) and [data/showroom-manifest.v1.json](C:\Users\14342\Desktop\snoozer-ai\data\showroom-manifest.v1.json) for curated showroom decisions:
  - which pod to test first
  - which mattress family fits
  - which base/motion combinations are allowed

### Current risk areas

1. [services/openai.js](C:\Users\14342\Desktop\snoozer-ai\services\openai.js) still spans both conversation and commerce-aware tool access, so future narrowing is still worthwhile even though its fallback-only role is now explicit.
2. [products.json](C:\Users\14342\Desktop\snoozer-ai\products.json) still exists in the repo and looks commerce-like, but it is now quarantined from the Lambda artifact to reduce mistaken live-truth usage.
3. Rewards flows touch commerce-adjacent state, but they are not the live cart/checkout source of truth and should stay documented separately.
