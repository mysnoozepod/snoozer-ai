# MySnoozePod.com Website Completion Scope

Last updated: 2026-11-02 — guided shopping experience live and validated
Owner: Ty  
Current phase: Phase 1 storefront implementation complete to current owner/manufacturer decision limits

## Mission

Complete the existing MySnoozePod.com business asset so its primary conversion path is a booked and attended Snooze Session. Online purchasing is the secondary conversion path. Preserve existing design, components, integrations, and workflows when they remain appropriate.

## Evidence labels

- **VERIFIED** — confirmed in repository code, a safe live/admin inspection, or a completed check.
- **INFERRED** — supported by evidence but not confirmed end to end.
- **UNVERIFIED** — requires access, authorization, configuration evidence, or a safe end-to-end test not available in Phase 0.

## Architecture baseline

| Area | Baseline | Evidence/status |
|---|---|---|
| Public website | Customized Shopify Liquid theme based on Dawn conventions (`layout`, `templates`, `sections`, `snippets`, `assets`, `config`, `locales`). Shopify renders the public pages, product forms, cart, account, and checkout handoff. | **VERIFIED** in repository and live preview. |
| Website theme source | Repository `mysnoozepod/snoozer-ai`, branch `main`, approved baseline `f5056cf9b3ee3392f0da01064f7171ea7c1ff01b`. | **OWNER APPROVED** in P1-002; **VERIFIED** by Git. |
| Shopify theme state | Published theme ID `139460542525`, name `snoozer-ai/main`, role `main`, on store `mysnoozepodtest`. A recoverable October 30 export is privately stored and checksum verified. The bounded content-page, imagery, navigation, and sharp-logo changes were deployed to the published theme under later owner authorization; broader repository-to-theme equality is not claimed. | **VERIFIED BOUNDED DEPLOYMENT**; store password protection remains enabled. |
| Snoozer backend | Node.js 20 Lambda-style application with API Gateway routing in `index.js`; public website base URL is configured in `layout/theme.liquid:461`. Relevant routes include assessment, identity, booking webhook, Ask Snoozer, Shopify product/cart operations, recommendations, and rewards. | **VERIFIED** in code. `/health` and `/assessment-questions` returned HTTP 200 on 2026-10-30. |
| Snooze Control | Separate React 18/Vite application under `omnia-journey/`, with showroom routes in `omnia-journey/src/main.jsx` and an Amplify build manifest in `omnia-journey/amplify.yml`. It is not the public Shopify theme. | **VERIFIED** in code and build. |
| Shopify commerce service | Storefront API is the required product/cart authority; Admin API is optional and separately credentialed. API versions are centralized in `services/shopifyApiConfig.js`; secrets are resolved through environment/Secrets Manager boundaries in `services/integrationSecrets.js`. | **VERIFIED** in code; no secrets inspected or recorded. |
| Booking | `sections/snoozer-landing-booking.liquid` embeds a Calendly routing form followed by a Calendly event. Snooze Code values can be propagated through query parameters and browser storage. Backend webhook processing is in `routes/bookingRoutes.js` and `services/bookingSession.js`. | **VERIFIED** in code and live mobile inspection; live webhook subscription state is **UNVERIFIED**. |
| Assessment and identity | The standalone assessment posts to `/assessment`; the backend issues/resolves a six-digit Snooze Code and associates assessment/profile state. The theme persists identity in session/local storage. | **VERIFIED** in code. No production assessment was submitted. |
| Ask Snoozer | Header interface posts to `/ask-snoozer`, carrying available identity context. Backend response composition and Shopify hydration remain behind the API boundary. Product answers must be hydrated from Shopify-authoritative native fields, variants, tags, collections, and verified metafields; missing commerce facts fail closed. | **VERIFIED** in code and presentation; the expanded retrieval contract is an owner-approved rule, not a completed backend implementation. |
| Guided shopping | The homepage, collection template, and ten published planning pages provide a connected route from education to product discovery and Snooze Session preparation. Tools read Shopify-rendered product/variant/collection data, preserve unknown compatibility, save customer planning choices locally, and do not mutate the cart. | **VERIFIED** by theme/API readback, focused tests, and live desktop/mobile browser checks. |
| Customer chat | Two Zoho SalesIQ widget scripts with different widget identifiers are included at `layout/theme.liquid:540-543`. | **VERIFIED** in code; intended widget/account is **UNVERIFIED**. |
| Analytics | No explicit Google Analytics or Meta Pixel implementation was found in the targeted repository search. Shopify-admin pixels/custom events were not verified. | **VERIFIED** repository finding; **UNVERIFIED** admin configuration. |
| Deployment | `omnia-journey/amplify.yml` builds the React app. The only GitHub workflow found refreshes living documentation and is not a theme deployment workflow. Theme publication mechanism and backend deployment pipeline were not proven from available evidence. | **VERIFIED** manifests; deployment relationships **UNVERIFIED**. |

## System boundaries

- **MySnoozePod.com** — public education, booking, customer account, product discovery, cart, and Shopify checkout.
- **Snoozer** — backend intelligence, API, identity, recommendation, booking-session preparation, and related AWS services.
- **Snooze Control** — customer-facing React showroom experience under `omnia-journey/`.
- **Shopify** — canonical approved products, variants, prices, availability, cart, and checkout.
- **Snoozer product retrieval** — consumes Shopify-authoritative product/variant fields, exact namespaced tags, collection membership, and verified metafields through the commerce service. Editorial content can explain concepts but cannot establish product, price, availability, compatibility, or fulfillment truth.
- **Calendly** — retained scheduling system; no replacement platform is in scope.
- **Ty** — authority for all customer-facing language and final merchandising approval.

## Approved business constraints

- Online products must have a representative physical showroom experience or sample.
- Fulfillment is intended to be manufacturer dropship; sellable inventory is not intended to be stocked on site.
- Six mattress positions do not necessarily mean six unique mattress products.
- Working mattress models are provisional until exact products, variants, compatibility, availability, and retail prices are approved.
- Existing design and functionality should be preserved unless evidence shows a defect or an owner-approved change is required.

## Phase 0 authorized work

- Inspect repository, configuration, documentation, live website, and Shopify in read-only mode.
- Run safe, relevant, non-destructive checks.
- Trace the website's Shopify, Calendly, assessment, Snooze Code, and Snoozer connections.
- Prepare only `PROJECT_SCOPE.md`, `TASKS.md`, `CONTENT_NEEDED.md`, `DECISIONS.md`, and `HANDOFF.md`.

## Explicit exclusions until separately authorized

- No customer-facing copy changes or invented replacement copy.
- No product, collection, price, inventory, metafield, or metaobject changes.
- No theme setting changes, publishing, production configuration, deployment, commit, or push.
- No real booking, assessment submission, cart mutation, or checkout.
- No Calendly appointment/configuration changes.
- No AWS, Snoozer retrieval, model instruction, or backend infrastructure changes.
- No scheduling-platform replacement, architecture replacement, catalog import, or exhaustive vendor-catalog processing.
- No Phase 1 work without Ty's task-specific authorization. P1-001 and P1-002 were subsequently authorized and are complete; later tasks remain excluded.

The later comprehensive storefront directive superseded the Phase 0 implementation exclusion for scoped local storefront changes and approved Draft catalog staging. It did not authorize public launch, unapproved merchandise activation, live price claims, destructive catalog changes, theme publication, deployment, Git push, or unrelated backend/infrastructure work.

## Phase 0 completion statement

The architecture, live customer surfaces, booking/identity flow, commerce state, and website-connected Snoozer surfaces have been traced to the limit of safe read-only evidence. Significant gaps, decisions, content dependencies, test results, and the proposed Phase 1 sequence are recorded in the companion control documents.
