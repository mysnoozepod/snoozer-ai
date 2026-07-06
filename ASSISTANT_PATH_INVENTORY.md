# Assistant Path Inventory

## Current primary governed Snoozer answer path

The current primary governed Snoozer path is:

1. `/ask-snoozer` in [routes/askSnoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\askSnoozerRoutes.js), dispatched from [index.js](C:\Users\14342\Desktop\snoozer-ai\index.js)
2. deterministic intent / policy / recommendation shaping in:
   - [services/askSnoozerAnswerEngine.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerAnswerEngine.js)
   - [services/askSnoozerPolicy.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerPolicy.js)
   - [services/askSnoozerQualityGate.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerQualityGate.js)
3. constrained model fallback through [services/openai.js](C:\Users\14342\Desktop\snoozer-ai\services\openai.js) only when the deterministic lane does not fully answer

`/hud/ask` is not the same assistant path. It is a deterministic HUD/website assistant lane with a strict HUD contract.

| Path / Module | Current role | Surface using it | Primary or legacy | Source of truth | Response shape | Duplicate behavior risk | Recommended later cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/hud/ask` in [routes/hudRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\hudRoutes.js) | Deterministic HUD answer routing for showroom / website help | HUD, product-page HUD, website HUD | primary for HUD | S3 curated knowledge, canon, catalog, Shopify Storefront API, DynamoDB Customer Profile OS, static fallback | strict HUD JSON: `speech`, `captions`, `state`, `priority`, `ttlMs`, `actions` | medium | Keep deterministic; do not merge with `/ask-snoozer` until shared presenter + trace model are cleaner. |
| `/hud/script` in [routes/hudRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\hudRoutes.js) | Script pack resolver for narrated HUD states | HUD narration / page guidance | primary for scripted HUD | S3 curated knowledge, static fallback | strict HUD JSON | low | Good candidate to stay separate; only clarify naming and script inventory later. |
| `/ask-snoozer` and `/ask` in [routes/askSnoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\routes\askSnoozerRoutes.js) | Full conversational Snoozer lane with canonical recommendation context, quality gate, policy fallback, deterministic FAQ/policy/commerce lanes, and constrained model fallback | React Ask Snoozer page and any direct backend chat client | primary for conversational Snoozer | canon, catalog, S3 curated knowledge, DynamoDB Customer Profile OS, OpenAI constrained generation, static fallback | normalized chat JSON envelope, HUD JSON when `wantHud`/showroom mode is requested | medium | Route ownership is now correct. Remaining risk is helper injection breadth, not competing HTTP handlers. |
| [services/askSnoozerAnswerEngine.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerAnswerEngine.js) | Builds shopper-facing deterministic answers and voice-safe copy from classified intent + facts | `/ask-snoozer` | primary | canon, catalog, knowledge manifest, policy facts | answer fragments / normalized answer object pieces | medium | Keep as core answer engine; reduce overlap with `services/openai.js`. |
| [services/askSnoozerPolicy.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerPolicy.js) | Deterministic policy / FAQ retrieval with S3 and local mirror fallback | `/ask-snoozer` policy lane | primary | S3 curated knowledge, local mirror fallback, static fallback | policy answer object + supporting source metadata | low | Good shape; continue isolating policy answers here instead of generic model replies. |
| [services/askSnoozerQualityGate.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerQualityGate.js) | Contract / voice / no-guess enforcement | `/ask-snoozer` | primary | internal guardrail logic | validated / repaired answer object | low | Keep centralized; use for every conversational path if more lanes are added. |
| [services/openai.js](C:\Users\14342\Desktop\snoozer-ai\services\openai.js) | Active low-level fallback/model helper plus legacy orchestration surface retained for tests and the final constrained generation lane | `/ask-snoozer` fallback path, trace harnesses, and booking/session-prep tests that stub model behavior | supporting helper with legacy overlap | S3 curated knowledge, Shopify Storefront API, OpenAI constrained generation | chat envelope with reply/actions/products/meta/cart data | medium | Kept in this pass. Final role is explicit: it is not product truth, policy truth, or the primary answer brain. |
| [services/hudScripts.js](C:\Users\14342\Desktop\snoozer-ai\services\hudScripts.js) | Deterministic S3 script retrieval with contract validation | `/hud/script` | primary | S3 curated knowledge, static fallback | strict HUD JSON payloads plus script metadata | low | Keep; it already encapsulates the right concern. |
| [services/askSnoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerRoutes.js) | HUD internal href allowlist / route sanitation helper | HUD and Ask Snoozer presentation helpers | legacy naming risk | static fallback | helper exports only | medium | Rename later; despite the name, this is not an HTTP route module. |
| `buildHudFromAny(...)` in [index.js](C:\Users\14342\Desktop\snoozer-ai\index.js) | Adapter that converts normalized answers into HUD contract output | `/ask-snoozer` showroom/HUD modes | active adapter | internal presenter logic | strict HUD JSON | medium | Move to a shared presenter/helper module in a later pass. |

## Duplicate / legacy path risks

1. [services/openai.js](C:\Users\14342\Desktop\snoozer-ai\services\openai.js) still carries some older orchestration shape, but it is now clearly classified as the constrained fallback/model helper rather than a competing governed route.
2. [services/askSnoozerRoutes.js](C:\Users\14342\Desktop\snoozer-ai\services\askSnoozerRoutes.js) is named like a controller, but is really an href safety helper.
3. `/ask` remains as a compatibility alias to `/ask-snoozer`, which is fine operationally but should stay explicitly documented as legacy.
