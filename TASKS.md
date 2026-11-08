# MySnoozePod.com Execution Queue

Last updated: 2026-11-08 — customer-facing mattress names and comfort vocabulary corrected
Queue state: The four mattress products now use product-led customer names, generic handles, manufacturer-neutral descriptions/media text, and plain-language Dual Comfort choices. Historical manufacturer/model identity remains internal for operations and provenance. Exact Dual Comfort sell-unit mappings, owner content authoring, technical completion, future Snoozer retrieval implementation, and final release acceptance remain gated.

## Readiness classification

| Classification | Current surfaces |
|---|---|
| **KEEP** | Shopify/Dawn page architecture; responsive homepage foundation; standard product variant/form, account, cart, and checkout structures; exact-tag automated collections; two-stage Calendly booking embed; standalone assessment and Snooze Code persistence; Ask Snoozer header shell; backend booking idempotency/session preparation; separate Snooze Control app. |
| **FIX** | M3/M5 complete sell-unit/configuration and assessment mapping; missing repository-level Calendly webhook authentication; failing HUD session-prep route assertion; duplicate Zoho SalesIQ scripts. |
| **IMPROVE** | Authenticated unpublished-theme navigation/catalog acceptance; mobile booking length and iframe ergonomics; remaining hardcoded product benefit text; booking image/alt text after owner approval; accessibility and route verification; deployment documentation. |
| **BUILD** | Approved physical-display-to-online-product/sample mapping; owner-approved content/media; live pricing/fulfillment authority; non-production booking contract acceptance suite; final release smoke checks. |

### Customer-facing mattress naming and comfort language

- **Objective:** Remove BEDGEAR and S7/H6/M3/M5 from customer-facing mattress identity and replace numeric Dual Comfort choices with Soft, Medium Soft, Medium Firm, and Firm.
- **Status:** COMPLETE IN SHOPIFY AND EXISTING UNPUBLISHED THEME — all four mattress titles, handles, descriptions, navigation labels, homepage cards, media alt text, and Product Page v1 surfaces now use generic product-led identities. Old product URLs redirect to their new canonical handles.
- **Commerce safety:** Manufacturer, model, SKU, and provenance remain available in internal Shopify data. Product/variant IDs, prices, status, inventory, collections, and sellability were preserved. Dual Comfort ordering still fails closed until an exact size + left + right sell-unit mapping exists.
- **Validation:** 18 focused naming assertions; 40 product-knowledge assertions; catalog, navigation, website-experience, guided-shopping, Product Page v1, cart, builder-contract, media, route, and storefront-skeleton suites; JavaScript syntax; authenticated unpublished-theme checks of the homepage, product page, comfort controls, media text, and legacy-handle redirect.
- **Safety:** Published theme `139460542525` was not modified. No order, deployment, or theme publication occurred. The completed repository changes were committed and pushed to `origin/main` as directed.
- **Evidence:** `docs/catalog/MATTRESS_CUSTOMER_NAMING_SHOPIFY_READBACK.json`; latest recovery snapshot `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\mattress-customer-naming\2026-11-08T20-44-50-716Z`.

## Phase 0 — completed discovery and control

### P0-001 — Recover and record the source baseline

- **Objective:** Identify the repository, branch, revision, and working-tree state without disturbing existing work.
- **Priority:** P0.
- **Dependencies:** Repository access.
- **Allowed work area:** Read-only Git inspection and repository recovery.
- **Acceptance criteria:** Repository and remote identified; `main` checked out; baseline SHA recorded; no reset, stash, commit, or push.
- **Verification requirements:** `git status`, `git log -1`, `git remote -v`.
- **Status:** COMPLETE — baseline `f5056cf9b3ee3392f0da01064f7171ea7c1ff01b`; no pre-existing tracked changes found.

### P0-002 — Audit public website and Shopify state

- **Objective:** Inventory desktop/mobile pages, navigation, products, collections, cart, account/checkout structures, and theme identity.
- **Priority:** P0.
- **Dependencies:** Read-only storefront and Shopify admin access.
- **Allowed work area:** Browser inspection only; no form submission, cart mutation, or Shopify change.
- **Acceptance criteria:** Major customer surfaces classified KEEP/FIX/IMPROVE/BUILD; catalog state and theme drift recorded.
- **Verification requirements:** Desktop and 390x844 mobile inspection; product/collection/admin checks; source comparison.
- **Status:** COMPLETE — at the Phase 0 inspection, significant findings included 17 active products, empty collections, a broken mattress collection route, and preview/source drift. Ty later confirmed those legacy products were intentionally deleted; P1-002 reverified zero products and zero collections.

### P0-003 — Trace booking, identity, commerce, and website-connected Snoozer flows

- **Objective:** Establish how assessment, Snooze Code, Calendly, booking webhook state, Ask Snoozer, Shopify products/cart, and Snooze Control connect.
- **Priority:** P0.
- **Dependencies:** Relevant source and safe GET endpoints.
- **Allowed work area:** Read-only code/configuration and non-mutating health checks.
- **Acceptance criteria:** Integration map distinguishes confirmed, inferred, and unverified behavior; production records remain unchanged.
- **Verification requirements:** Targeted source inspection; `/health` and `/assessment-questions`; focused automated tests.
- **Status:** COMPLETE — no booking, assessment, cart, checkout, or production configuration was mutated.

### P0-004 — Establish project-control documents

- **Objective:** Preserve the Phase 0 baseline and a resumable execution queue.
- **Priority:** P0.
- **Dependencies:** P0-001 through P0-003.
- **Allowed work area:** `PROJECT_SCOPE.md`, `TASKS.md`, `CONTENT_NEEDED.md`, `DECISIONS.md`, `HANDOFF.md` only.
- **Acceptance criteria:** Five documents exist, agree on status and next action, and contain no secrets or customer records.
- **Verification requirements:** File review, scope check, `git diff --check`, final `git status`.
- **Status:** COMPLETE when final document checks pass.

## Phase 1 — P1-001 and P1-002 complete; remaining sequence requires approval

### P1-001 — Reconcile the canonical theme and deployment baseline

- **Objective:** Determine exactly which Shopify theme is published, which theme contains the most current valid work, how it relates to GitHub `main`, and which artifact Ty selects as the Phase 1 source.
- **Priority:** P0 — prerequisite to all theme changes.
- **Dependencies:** Ty authorizes read-only theme comparison and identifies/approves the canonical result.
- **Allowed work area:** Read-only Shopify theme metadata/export, Git comparison, and an owner-facing diff report. No publish, theme setting change, merge, or deploy.
- **Acceptance criteria:** Published and preview theme IDs/names are recorded; the delta from `f5056cf...` is summarized by customer-facing surface; no valid work is overwritten; Ty selects a canonical baseline; a clean `codex/` implementation branch can then be created from that approved baseline.
- **Verification requirements:** Shopify theme metadata, file-level diff, rendered spot checks, clean Git status, owner signoff.
- **Status:** COMPLETE — inspection and recommendation delivered. `6960546` is an ancestor of `main`; theme `139460542525` is published; the builder is preserved through a later inline refit. Ty approved GitHub `main` at `f5056cf...` as the canonical development baseline in the P1-002 directive.

### P1-002 — Freeze the MVP merchandising contract

- **Objective:** Freeze the approved, selected, provisional, and deferred assortment; define Shopify, Pod Builder, collection, compatibility, fixture, and cart-integrity contracts without creating products.
- **Priority:** P0 — commerce and recommendation dependency.
- **Dependencies:** The contract may complete with unresolved vendor/owner decisions explicitly blocked. Product implementation still depends on final models, variants, prices, availability, compatibility, images, physical coverage, and fulfillment facts.
- **Allowed work area:** Product-data specification and validation only; no Shopify mutation until separately authorized.
- **Acceptance criteria:** Assortment states remain distinct; six positions map to four provisional mattress families; product/variant/custom-field requirements are explicit; collections and historical handles are mapped; the full builder preserves multiple optional accessories and tri-state compatibility; a synthetic fixture validates relationships; P1-006A acceptance is fail closed.
- **Verification requirements:** Decision-record and targeted manufacturer-source extraction; targeted Liquid/JavaScript inspection; synthetic fixture validation; existing canonical builder tests; documentation and Git scope checks. No Shopify import dry run is possible until real variants are approved and product mutation is authorized.
- **Status:** COMPLETE — contract in `docs/p1-002/MVP_MERCHANDISING_AND_POD_BUILDER_CONTRACT.md`; synthetic fixture and validator under `tests/`. Real catalog publication remains blocked.

### P1-003 — Secure and prove the Calendly booking contract

- **Objective:** Authenticate webhook delivery and prove creation, cancellation, duplicate delivery, retry, and reschedule behavior without customer-facing production tests.
- **Priority:** P0 — booking trust and operations.
- **Dependencies:** Approved secret/control owner, non-production Calendly/API environment or authorized replay fixtures, canonical source from P1-001.
- **Allowed work area:** Booking webhook boundary, setup script, tests, and deployment configuration in an approved non-production path. No production appointment changes.
- **Acceptance criteria:** Invalid/missing signatures are rejected; valid events remain idempotent; created/canceled/rescheduled scenarios reach the correct booking/profile/session-prep state; logs contain no secrets or customer data; rollback is documented.
- **Verification requirements:** Unit/route tests, signed fixture replay, subscription inspection, before/after configuration evidence, and owner-approved non-production acceptance.
- **Status:** BLOCKED — authorization and environment required.

### P1-004 — Repair high-impact navigation and CTA routing

- **Objective:** Make every booking, assessment, cart guidance, and approved product-discovery entry point resolve to the correct destination.
- **Priority:** P0 — conversion and trust.
- **Dependencies:** P1-001; Ty approves navigation labels/targets and assessment policy; product discovery target also depends on P1-002.
- **Allowed work area:** Shopify theme navigation/route settings and minimal route-safe code. No copy rewrite or product mutation.
- **Acceptance criteria:** No approved CTA falls back to `/` unintentionally; no approved entry point returns 404; desktop and mobile expose the approved primary navigation; booking and assessment routes preserve Snooze Code context where applicable.
- **Verification requirements:** Automated link scan plus desktop/mobile click-path checks in an unpublished theme; accessibility labels and focus behavior checked.
- **Status:** IMPLEMENTED IN DEVELOPMENT; RELEASE ACCEPTANCE PENDING — cart CTAs and canonical collection references are repaired, dead mattress shopping links fail closed, and the verified nested `main-menu` is installed in the development store. Authenticated unpublished-theme click-path, keyboard/focus, and public-release acceptance remain pending.

### P1-005 — Stage the approved Shopify catalog and collections

- **Objective:** Implement the owner-approved products, variants, collections, publication state, and dropship facts in Shopify while preventing legacy leakage.
- **Priority:** P0 — commerce readiness.
- **Dependencies:** P1-001, P1-002, Ty's explicit authorization for Shopify changes, rollback/export plan.
- **Allowed work area:** Approved Shopify product/collection data only. Do not alter unapproved customer copy or publish without a separate go-live gate.
- **Acceptance criteria:** Every active item matches the approved contract; legacy items follow Ty's disposition decision; collections resolve; variant selection and price/availability are Shopify-sourced; each item has physical experience coverage; rollback evidence exists.
- **Verification requirements:** Pre-change export, dry run, change log, Shopify admin review, storefront preview, variant/cart fixture checks, owner signoff.
- **Status:** SUBSTANTIALLY COMPLETE IN DRAFT — 43 products, 274 variants, and 18 collections are durably manifested and read back from Shopify. All products are Draft/publication-blocked. The four Ty-approved BEDGEAR mattress families are staged; M3/M5 complete sell-unit identifiers and allowed left/right combinations remain blocked. The Cooling Blanket awaits an exact owner selection; every live price, sample, content, fulfillment, and release decision remains blocked.

#### P1-005A — Shopify catalog foundation and first draft product

- **Objective:** Establish the canonical pillow collection foundation and create one verified Malouf draft product without publishing it.
- **Shopify resources:** `pillows` collection `302090780733`; `filled-pillows` collection `302090813501`; Gelled Microfiber Pillow product `8099363094589` (`gelled-microfiber-pillow`).
- **Variants:** Queen `44049793777725`, SKU `ZZQQ00GM`, draft reference price `$59.99`; King `44049793810493`, SKU `ZZKK00GM`, draft reference price `$69.99`.
- **Status:** COMPLETE — Shopify Admin shows exactly one product and two collections. The product is **DRAFT**, belongs to both collections, uses vendor `Malouf`, type `Pillow`, native size variants, and the default product template. Inventory is not tracked; no description, media, tags, custom metafields, fulfillment promise, publication, theme change, deployment, commit, or push was added.
- **Remaining gate:** Reference prices require current selling-price authorization; content, shipping facts, inventory/availability, builder role/readiness metadata, and storefront/Ajax Cart acceptance remain pending.

#### P1-005B — Approved Malouf pillow assortment

- **Status:** COMPLETE IN DRAFT — all 16 approved models, 43 variants, and five pillow collections are verified in the manifest/readback. Existing Gelled Microfiber IDs were preserved; no duplicate product was created.

#### P1-005C — Approved BEDGEAR bases, bedding, protection, comforters, and selected accessories

- **Status:** COMPLETE IN DRAFT WITH ONE OWNER DEPENDENCY — 16 products and 146 variants are verified across five collection mappings. The Cooling Blanket remains excluded pending Navy-versus-Grey selection and physical sample confirmation.

#### P1-005D — Approved Malouf furniture and selected topper

- **Status:** COMPLETE IN DRAFT — six furniture products and the selected topper, totaling 48 variants, are verified. Furniture remains outside the builder; cross-brand base clearance remains pending.

#### P1-005E — Approved BEDGEAR mattress catalog

- **Status:** COMPLETE IN DRAFT TO VERIFIED SOURCE LIMIT — S7 `12" Memory Foam` (10 variants), H6 `12" Hybrid` (10), M3 `12" Dual Comfort` (8), and M5 `14" Dual Comfort` (9) are verified in Shopify under automated mattress/family collections. All now use Product Page v1 (`snoozepod-v1`), remain Draft/publication-blocked, and preserve the approved one/one/two/two showroom display counts with locations unassigned.
- **Dual Comfort gate:** M3/M5 expose independent 0.0, 1.0, 2.0, and 3.0 selectors, persist both values as line properties, and fail closed because no verified sell-unit mapping exists. Add to Cart becomes available only for an exact size + left + right mapping backed by actual Shopify variant metafields. M3 Split King remains excluded because the current sheet only reuses the Twin XL chassis SKU with an `Order 2` instruction.
- **Verification:** Mattress manifest/readback validator passes; final plan-only Admin API preflight reports zero missing products, collections, variants, or contract fields.

#### P1-005UX — Product and collection experience v1

- **Status:** IMPLEMENTED AND LOCALLY VALIDATED — reusable templates, responsive styling, Product Feel fail-closed behavior, showroom fields, booking/cart/Ask Snoozer actions, collection navigation, and deterministic previews pass 61 contract assertions and width/overflow checks. Shopify theme deployment and authenticated real-product storefront acceptance were not performed.

#### P1-005F — Full storefront visual QA, integration, and polish

- **Status:** COMPLETE TO THE AUTHORIZED DRAFT-CATALOG LIMIT — the 36-file targeted theme set is uploaded and hash/semantic-verified on unpublished theme `139216420925`. The actual authenticated preview passes desktop/mobile homepage, eight representative collection routes, desktop dropdown, nested 390px mobile menu, Ask Snoozer activation, empty-cart shell, footer, and console checks. All 18 approved collection shells are available for preview, while all 43 products remain Draft. This checkpoint originally used product fixtures; the later Catalog Restructure checkpoint directly verified real S7/H6/M3/M5 Draft-product routes through Shopify's temporary preview URLs. The retired Pod Builder remains contract-tested only.
- **Corrections:** Shopify schema-length validation, homepage disabled-section ordering, upload dependency coverage, safe unpublished-theme backup/rollback, and collection-shell preview availability were corrected. The published theme `139460542525` remained unchanged.
- **Remaining acceptance:** The Booking and Snooze Assessment pages still use Shopify's default page template. Their intended `landing-booking` and `landing-assessment` template assignments are global store state and require a separate production-impact authorization. Complete-bundle Ajax Cart acceptance, Ty-approved collection/product media and copy, verified Warranty content, and all commerce publication gates remain pending. Real Draft-product rendering is no longer pending; actual S7/H6/M3/M5 routes were verified later.

### P1-006 — Remove legacy catalog assumptions from customer journeys

- **Objective:** Replace hardcoded legacy handles, benefits, pairings, assessment mappings, and recommendation routes with approved Shopify-authoritative references.
- **Priority:** P1.
- **Dependencies:** P1-002 and P1-005; Ty-approved copy/content; canonical source from P1-001.
- **Allowed work area:** Theme catalog/assessment/Ask Snoozer mapping code and approved configuration only.
- **Acceptance criteria:** No customer-facing path references obsolete handles or unapproved benefits; missing Shopify data fails closed; assessment and Ask Snoozer cannot invent product, price, availability, or compatibility truth.
- **Verification requirements:** Repository search gate, frozen authoritative fixture, semantic recommendation checks, route tests, rendered theme preview.
- **Status:** PARTIALLY IMPLEMENTED — canonical collection/role discovery, fail-closed variants, contextual Ask Snoozer, cart/booking routes, and inactive legacy shelf handling are complete locally. The mattress lineup is approved and staged as Draft, but internal assessment identifiers cannot be replaced until Ty approves the recommendation mapping and vendor-supported M3/M5 configurations.

### P1-006A — Make Pod Builder cart submission fail closed

- **Objective:** Preserve complete selected-build integrity when Shopify rejects or partially fulfills a multi-item add.
- **Priority:** P0 — required before any builder-enabled product can publish.
- **Dependencies:** Canonical baseline is approved; P1-002 fixture is complete; Ty authorized P1-006A. A recoverable snapshot of the current published theme `139460542525`, including theme files and Shopify-managed configuration, is mandatory before code changes.
- **Allowed work area:** Pod Builder cart construction/submission, focused tests, and owner-approved error presentation only. No catalog mutation, copy rewrite, publish, or deploy.
- **Acceptance criteria:** Meet all 16 requirements in the P1-002 cart-integrity acceptance contract, including immutable requested items, bundle operation IDs, pre/post cart reconciliation, partial-state detection, missing-item-only retry, duplicate prevention, accessible errors, retained selections, and no mattress-only fallback.
- **Verification requirements:** State-machine unit tests; DOM error/recovery tests; complete success, 422/no mutation, 422/partial mutation, timeout/full mutation, timeout/partial mutation, duplicate retry, pre-existing identical line, unavailable add-on, and changed-selection cases; authorized non-production Shopify Ajax Cart evidence.
- **Status:** IMPLEMENTED — AVAILABLE-ENVIRONMENT E2E COMPLETE; COMPLETE-BUNDLE SHOPIFY ACCEPTANCE PENDING. Twenty-one focused cart scenarios, six canonical cases, 34 contract assertion groups, and the existing cart regression pass. The store now has 43 Draft products including four approved mattress families, but no publication-ready complete bundle; products were not activated merely to force an Ajax Cart test.

### P1-007-HUD — Resolve the booking HUD regression (legacy identifier retained)

- **Objective:** Restore the expected HUD answer from stored session preparation without weakening the shared Snoozer truth path.
- **Priority:** P1.
- **Dependencies:** P1-001; agreement on intended HUD/session-prep behavior.
- **Allowed work area:** Relevant route/service/test path only; no broad Snoozer redesign.
- **Acceptance criteria:** `tests/runBookingWebhookRouteTests.js` passes; the eight currently passing focused suites remain green; stored session preparation is used only when identity and freshness rules allow it.
- **Verification requirements:** Focused before/after test output and regression suite; no claim of performance improvement without comparable workloads.
- **Status:** READY AFTER AUTHORIZATION — current assertion fails at line 361.

### P1-007 — Complete visual merchandising and product presentation

- **Objective:** Source exact manufacturer media, organize the durable product-media contract, stage approved media on the existing Draft catalog, complete collection imagery, and verify the unpublished storefront presentation without publishing merchandise or a theme.
- **Priority:** P1 merchandising completion.
- **Dependencies:** Existing 43-product Draft catalog, 18 collections, unpublished theme `139216420925`, manufacturer media authority, and the P1-005UX/P1-005F storefront foundation.
- **Acceptance criteria:** Exact source provenance; deterministic primary/supporting order; appropriate variant image associations; all available product/collection imagery staged; responsive homepage and collection presentation; missing exact media fails closed; all products remain Draft; published theme remains unchanged.
- **Verification requirements:** Shopify Admin readback, focused media-contract validator, authenticated desktop/mobile preview, existing storefront and Pod Builder regressions, syntax checks, and current handoff.
- **Status:** IMPLEMENTED — REVIEW READY; FIVE EXACT MEDIA GAPS REMAIN. Shopify readback confirms 43 Draft products, 147 `READY` media records across 38 products, 48 variant images, and images on all 18 collections. Authenticated 1440×1000 and 390×844 previews show real collection imagery, working homepage routes, and no horizontal overflow. The five unresolved exact assets are `flex-sh-adjustable-base`, `cooling-performance-throw`, `react-pro-performance-topper`, `weekender-gel-memory-foam-pillow`, and `bamboo-charcoal-pillow-cooling-cover`; no substitutes were used. Published theme `139460542525` was unchanged.

### Catalog & Shopping Experience Restructure

- **Objective:** Tag the complete Draft catalog, replace manual collections with exact-tag automated collections, remove the Pod Builder from active customer surfaces, restore Product Page v1/standard Shopify forms, and add independent fail-closed M3/M5 Dual Comfort selection.
- **Status:** COMPLETE IN DEVELOPMENT — 43/43 products tagged, 274 variants preserved, 25/25 required collections automated, original 18 collection handles preserved, seven family routes added, and all 43 products assigned `snoozepod-v1`. The active homepage and assigned product templates contain no Pod Builder. M3/M5 selectors retain Left/Right `0.0`–`3.0` values and enable Add to Cart only for an exact verified variant mapping; current mappings are zero, so unsupported commerce remains disabled. A private refreshable index now exposes all 43 real Shopify Draft-product pages against unpublished theme `139216420925` without publishing them.
- **Validation:** 10/10 restructure assertions; standard/unsupported/mapped fixture shopping flows; 61 Product Page v1 assertions; 19 media assertion groups; storefront route/skeleton and Ask Snoozer regressions; 34 builder-contract groups, 21 cart-integrity scenarios, and canonical dormant-code regressions. Authenticated preview verified homepage, expanded family menu, `/collections/mattresses`, `/collections/m3`, and the actual S7/H6/M3/M5 Draft-product routes. S7/H6 show native size/Add to Cart behavior; M3/M5 show the live independent controls and fail-closed unavailable state.
- **Safety:** Products remain Draft; unpublished theme `139216420925` remains unpublished; published theme `139460542525` remains `main`; no order, deployment, commit, or push occurred.
- **Report:** `docs/catalog/CATALOG_SHOPPING_RESTRUCTURE.md`.
- **Next gate:** Verify and stage the authoritative M3/M5 size + left + right sell-unit/fulfillment mapping; do not publish until it passes exact-mapping and cart-property acceptance.

### Content Education Library & Sharp Logo Release

- **Objective:** Publish 50 manufacturer-neutral educational pages using the approved page format, add appropriate editorial imagery, replace active storefront logo rendering with the sharper approved MySnoozePod asset, and place the library strategically in navigation.
- **Status:** COMPLETE AND LIVE IN SHOPIFY — 50/50 guides plus the `/pages/sleep-guides` hub are published, body-hash/readback verified, internally linked, and rendered by the live default page template. The primary menu exposes seven focused destinations with strategic guide links; the footer exposes the hub and core service/policy routes. Every guide has a deterministic topic-appropriate image assignment from a ten-image original, unbranded editorial library. Published and development themes both use the image assets and `assets/mysnoozepod-logo-sharp.png`. The store-level password remains enabled.
- **Language contract:** Customer comfort language is Soft, Medium Soft, Medium Firm, and Firm. The page library contains no BEDGEAR references and no numeric comfort scale.
- **Navigation and conversion contract:** The hub lists every guide exactly once in six groups. Product and showroom menu branches expose relevant guides contextually. The responsive booking/Ask Snoozer conversion band and guide-discovery links render inside the main page content before the global “Stay In The Loop” newsletter; managed page bodies no longer carry a duplicate inline CTA.
- **Snoozer follow-up:** Implement product retrieval through Shopify's native product/variant fields, exact namespaced tags, collections, and verified metafields. Missing or conflicting commerce data must remain unknown; editorial content is not product authority.
- **Validation:** 51 published content-page readbacks; 51/51 image mappings; 10/10 image assets SHA-256-verified on both themes; actual published-theme rendering for all ten visual groups; 51 protected content routes; 50 guides exactly once on the hub; the current expanded navigation contains 72 nested primary-menu items and 12 footer items; desktop and 390px mobile visual checks; related-guide navigation; idempotent page/image/navigation plans; focused content-page, navigation, catalog, Product Page v1, and storefront-route regressions.
- **Safety:** Existing nine pages were preserved. Content and theme backups were created before mutations. No product status, price, variant, collection, order, AWS configuration, Calendly configuration, or storefront-password setting changed.
- **Report:** `docs/content-pages/CONTENT_PAGES_RELEASE.md`.

### Guided Shopping Experience

- **Objective:** Connect the homepage and collection pages to a dedicated Sleep Tools hub, a planning-first Build Your SnoozePod page, and focused tools for mattress discovery, compatibility, comparison, Snooze Session preparation, Dual Comfort, pillows, cooling/bedding, and room/delivery planning.
- **Status:** COMPLETE AND LIVE BEHIND THE EXISTING STOREFRONT PASSWORD — ten published pages remain available. The 2026-11-06 booking-first refinement deliberately moved homepage tools below mattress/category discovery and collection guidance below the native product grid; this supersedes the earlier tools-first placement without changing the tool inventory or commerce boundary.
- **Commerce boundary:** The tools consume Shopify-rendered product, variant, collection, tag, and verified metafield data. They save planning choices locally, make no Ajax cart mutation, do not claim unknown compatibility, and route unresolved decisions to the product page, Ask Snoozer, or a Snooze Session.
- **Filter contract:** Customer-facing dimensions are Size, Comfort, Construction, Sleep Position, Cooling, Geometry, Material, Pillow Loft, Color, and Availability. Existing exact namespaced tags power curated collection links without exposing internal taxonomy values as a raw storefront filter. Verified metafield-backed filters remain a later data task.
- **Validation:** Focused guided-shopping and navigation tests, live builder saved-plan flow, explicit incompatibility flow, independent Soft/Firm Dual Comfort flow, homepage/collection placement, 390px mobile rendering, clean browser console, and idempotent Shopify page/theme/menu plans.
- **Safety:** No cart, order, product, variant, price, inventory, product-status, collection-rule, AWS, Calendly, or storefront-password mutation occurred. The development theme remains unpublished.
- **Report:** `docs/guided-shopping/GUIDED_SHOPPING_RELEASE.md`.

### Direct Product Navigation and BEDGEAR Product-Copy Correction

- **Objective:** Replace one-product collection detours with direct product routes and add exact, current manufacturer product information from BEDGEAR.com.
- **Status:** COMPLETE AND LIVE BEHIND THE EXISTING STOREFRONT PASSWORD — S7, H6, M3, M5, Flex L, Flex LSX, and Flex SH now link directly to their product pages from both the main menu and parent collection navigation. Their seven single-product collections remain recoverable in Admin but are unpublished from Online Store.
- **Product-copy result:** 18 of 20 BEDGEAR products have an exact official BEDGEAR product-page match and now show a concise `Product Overview` and `Key Features` block ahead of the existing `About BEDGEAR` block. The Solid White and Light Grey Racetrack duvet/sham products remain brand-copy-only because no exact current product page was verified.
- **Validation:** Shopify readback verifies seven PRODUCT menu destinations, seven unpublished obsolete collection routes, 18 exact manufacturer-source mappings, 20/20 BEDGEAR descriptions, 27/27 bounded assets on both themes, and unchanged product identity/status/tags/templates/variants/SKUs/prices/options. Live browser checks verified all parent-page cards and Flex quick links use `/products/...`, and a menu click opened the Flex L product page with its official overview.
- **Recovery:** Private pre-change snapshots are referenced by `docs/catalog/BEDGEAR_PRODUCT_DESCRIPTIONS_SHOPIFY_READBACK.json`, `docs/catalog/SINGLE_PRODUCT_COLLECTION_CLEANUP_READBACK.json`, `docs/content-pages/CONTENT_NAVIGATION_SHOPIFY_READBACK.json`, and `docs/guided-shopping/GUIDED_SHOPPING_SHOPIFY_READBACK.json`.
- **Report:** `docs/catalog/BEDGEAR_PRODUCT_DESCRIPTIONS.md`.

### Website Experience Completion — booking-first refinement

- **Objective:** Unite the existing homepage, navigation, collections, products, booking, tools, cart, checkout, policies/footer, and responsive layouts around Book a Snooze Session as the primary conversion.
- **Status:** IMPLEMENTED ON EXISTING UNPUBLISHED THEME — READY FOR TY REVIEW. Theme `139216420925` contains the bounded 10-asset refinement; the same 10 corresponding assets on published theme `139460542525` were hash-verified unchanged. Booking and assessment suffixes were already correctly assigned and were read back unchanged. A conservative Warranty Support page structure is published.
- **Material result:** Booking now leads the homepage/header/footer; the real S7/H6/M3/M5 products have an editor-managed homepage showcase; merchandise precedes optional tools on collections; product recommendations were restored; direct Calendly booking precedes the optional mini assessment; the mobile header is compact without the redundant horizontal category strip; standard Shopify cart/checkout behavior remains authoritative.
- **Actual validation:** Authenticated desktop/mobile preview; direct booking and both Calendly embeds; four-product mattress collection; S7 variant Add to Cart; cart variant/quantity/price/total; native checkout order summary and branding; M3 independent left/right selection with unsupported combination disabled; Ask Snoozer panel; guest Check In access; Sleep Tools; warranty route; no horizontal overflow at the 390px acceptance viewport.
- **Automated validation:** 35 website-experience assertions; 10/10 catalog restructure groups; guided-shopping regression; 62 Product Page v1 assertions; cart-integrity regression; 34 P1-002 contract groups; 19 media groups; storefront route and skeleton suites; JavaScript syntax; clean diff; idempotent Shopify plan.
- **Safety:** Existing product status, prices, SKUs, variants, imagery, menus, collection rules, Calendly configuration, AWS, payments, tax, shipping, fulfillment, password protection, theme roles, and published-theme assets were not changed. One S7 Twin was added to the isolated preview browser cart for validation; no order was submitted.
- **Evidence:** `docs/website-experience/WEBSITE_EXPERIENCE_COMPLETION.md`, `docs/website-experience/WEBSITE_EXPERIENCE_SHOPIFY_READBACK.json`, and `docs/website-experience/screenshots/`.
- **Next gate:** Ty reviews copy and visuals in the actual preview, then authorizes a separately scoped launch-configuration/test-order task. Do not publish the theme or change commercial settings automatically.

### Product Knowledge & Content Architecture

- **Objective:** Make Shopify the authoritative, structured source for owner-authored product content, verified technical facts, category-specific presentation, and a future Snoozer knowledge feed.
- **Status:** COMPLETE ON EXISTING DEVELOPMENT STORE AND UNPUBLISHED THEME — all 43 products map to one of eight contracts; 79 product and four variant definitions were created; the seven Ty-authored fields plus workflow/authority fields are pinned; 324 bounded metafield writes initialized schema/provenance and migrated the legacy workflow; no conflicting merchant value was overwritten.
- **Editing result:** Ty can open any product, select View all under Product metafields, write in the pinned `Content |` fields, and move `01 Content workflow` through `NOT_STARTED`, `DRAFT`, `READY_FOR_REVIEW`, and `APPROVED`. Shopify cannot conditionally hide unrelated definitions by product type, so category fields use clear prefixes and `custom.product_contract` selects the relevant fields for Liquid/API consumers.
- **Rendering result:** Product Page v1 now renders approved owner content, populated universal technical facts, and the correct category section while suppressing empty/unapproved fields. Existing gallery, variants, price, booking, Add to Cart, Ask Snoozer, description, policies, recommendations, and Dual Comfort controls remain intact.
- **Data result:** `schemas/product-knowledge.v1.schema.json`, a 43-product normalized feed, eight-category fixture, exporter, and validator separate approved owner copy, technical facts/provenance, dynamic Shopify commerce, and compatibility. No AWS/Snoozer backend was changed.
- **Actual validation:** Native Shopify editor showed the pinned workflow and Ty writing fields. Actual unpublished-theme product pages for all eight contracts exposed the expected category heading, standard Add to Cart where applicable, and no desktop overflow. Published-theme hashes were unchanged.
- **Automated validation:** Product knowledge contract 40 assertions; idempotent Shopify plan with zero pending mutations; catalog, Product Page v1, cart, media, guided-shopping, route, storefront-skeleton, and website-experience regression suites all passed.
- **Evidence:** `docs/product-knowledge/PRODUCT_KNOWLEDGE_ARCHITECTURE.md`, `OWNER_CONTENT_CHECKLIST.md`, inventory/readback/feed JSON, representative fixture, and screenshots.
- **Next gate:** Ty authors and approves product copy. Begin with the four mattresses and three adjustable bases, then complete the remaining categories without changing technical verification or commerce state.

### P1-008 — Resolve customer-chat and analytics ownership

- **Objective:** Retain one approved SalesIQ widget and document/implement the owner-approved MVP analytics/pixel set.
- **Priority:** P1.
- **Dependencies:** Ty identifies account owners and approves tracking requirements; P1-001.
- **Allowed work area:** Theme integration tags and Shopify customer-events/pixel configuration in an approved test/publish workflow.
- **Acceptance criteria:** One intended chat widget initializes once; analytics events have documented purpose/owner/consent behavior; no duplicate events or secrets in source.
- **Verification requirements:** Network/tag inspection in preview, event test plan, privacy/content review, owner signoff.
- **Status:** BLOCKED — ownership and requirements unknown.

### P1-009 — Mobile and accessibility acceptance pass

- **Objective:** Validate and refine the approved booking-first journey on common mobile and desktop viewports.
- **Priority:** P1.
- **Dependencies:** P1-004 and approved booking image/content; product checks depend on P1-005/P1-006.
- **Allowed work area:** Minimal approved presentation/accessibility changes in the canonical unpublished theme.
- **Acceptance criteria:** Keyboard navigation, focus, labels, headings, contrast, image alternatives, iframe behavior, responsive layout, and reduced-motion behavior meet the approved acceptance checklist; no content is rewritten without Ty.
- **Verification requirements:** Automated accessibility scan plus manual keyboard and viewport checks; screenshots of approved unpublished theme.
- **Status:** SUBSTANTIALLY COMPLETE FOR THE WEBSITE-EXPERIENCE PASS — authenticated 390px checks cover homepage, header/menu access, booking/Calendly, collections, products, M3 controls, cart, checkout, tools, and footer with no horizontal page overflow. Semantic controls/live regions were manually verified and focused regressions pass. A dedicated automated accessibility scan and owner/device acceptance remain a release task.

### P1-010 — Commerce and booking release gate

- **Objective:** Prove the complete MVP conversion paths before publication.
- **Priority:** P0 release gate.
- **Dependencies:** P1-003 through P1-009 and explicit authorization for controlled test records/orders.
- **Allowed work area:** Approved non-production or controlled test environment; no uncontrolled production transactions.
- **Acceptance criteria:** Visitor-to-booking, booking cancellation/reschedule, assessment-to-code-to-booking, product discovery-to-variant-to-cart-to-checkout, account/check-in handoff, and failure recovery meet documented criteria; customer data cleanup and rollback are complete.
- **Verification requirements:** Evidence log with environment, timestamps, inputs, outputs, cleanup, and owner/operations acceptance.
- **Status:** PARTIALLY VALIDATED — actual preview proves homepage-to-booking/Calendly, collection-to-S7-variant-to-cart-to-native-checkout, M3 fail-closed handling, Ask Snoozer access, and Check In access. No booking was submitted, no test order was completed, and payment/tax/shipping/fulfillment configuration remains owner-controlled. Full release acceptance is still pending.

## Phase 2 — post-MVP hardening, not scoped for execution

### P2-001 — Automate ongoing website integrity checks

- **Objective:** Prevent broken routes, unapproved catalog leakage, duplicate tags, and booking-contract regressions.
- **Priority:** P2.
- **Dependencies:** Stable MVP contracts and release workflow.
- **Allowed work area:** CI and non-production monitoring approved by Ty.
- **Acceptance criteria:** Checks fail closed on broken critical links, missing approved handles/variants, unknown active products, booking signature regressions, and duplicate customer scripts.
- **Verification requirements:** Deliberate negative fixtures, CI evidence, alert ownership and runbook.
- **Status:** BACKLOG.
