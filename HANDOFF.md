# MySnoozePod.com Operational Handoff

Last updated: 2026-11-02 — content navigation, guide hub, and conversion placement complete
Owner: Ty  
Implementer: Codi  
Current phase: Tagged Draft catalog and traditional shopping flow retained; educational library, guide hub, strategic navigation, imagery, sharp logo, and conversion placement live behind the existing storefront password

## Current task and authority

The latest owner directive authorized strategic placement of the 50-page educational library, bounded published-theme aesthetic improvements, live Shopify navigation updates, documentation, commit, and push. All 43 products remain tagged and Draft; all 25 required collections remain automated; established collection URLs are preserved; and all products, including S7/H6/M3/M5, continue to use Product Page v1 with standard Shopify forms. The Pod Builder remains absent from active customer surfaces.

M3/M5 independent Left/Right 0.0–3.0 selection remains fail closed. No exact sell-unit mapping is currently verified, so Add to Cart remains disabled for those products. The published theme received only the authorized content-page renderer, imagery/logo, and navigation presentation changes; no product was activated and the development theme remains unpublished. No order, backend deployment, Calendly change, or AWS mutation occurred.

## Canonical baseline

- Repository: `https://github.com/mysnoozepod/snoozer-ai.git`
- Branch: `main`
- Approved historical starting commit: `f5056cf9b3ee3392f0da01064f7171ea7c1ff01b`; start-of-navigation-task HEAD: `30cf6f93f52da9baf6d713dbf90ed037730ac5ce`.
- Owner decision: GitHub `main` is the canonical development baseline; do not reset it to the historical builder commit.
- Published Shopify theme: ID `139460542525`, name `snoozer-ai/main`, role `main`.
- Shopify catalog at this checkpoint: 43 Draft products, 274 variants, and 25 automated collections; durable IDs are recorded in the catalog manifests/readbacks.
- Historical dirty clone at `C:\Users\14342\Desktop\snoozer-ai` remains untouched.

## P1-002 deliverables

Primary contract:

- `docs/p1-002/MVP_MERCHANDISING_AND_POD_BUILDER_CONTRACT.md`

Non-production validation:

- `tests/fixtures/p1-002-pod-builder-contract.fixture.json`
- `tests/runP1_002PodBuilderContractTests.js`

Project controls updated:

- `PROJECT_SCOPE.md`
- `TASKS.md`
- `DECISIONS.md`
- `HANDOFF.md`

## Source documents used

- `C:\Users\1ones\Downloads\MySnoozePod_Product_Lineup_Decisions_October_2026.pdf`
- `C:\Users\1ones\Downloads\Bedgear Master PL Sept 2026.xlsx`
- `C:\Users\1ones\Downloads\MALOUF-PriceList-26.3-MAP.pdf`

The October 30 decision record controls selection/status. Manufacturer documents support exact rows, variants, components, SKUs, warranties, and historical prices but do not authorize publication.

## Historical P1-005A Shopify resources (preserved baseline)

Collections created as manual collections:

- `Pillows` — handle `pillows`, collection ID `302090780733`; canonical future Pod Builder pillow source.
- `Filled Pillows` — handle `filled-pillows`, collection ID `302090813501`; customer/category subgroup for filled pillows, not a separate canonical builder dependency.

First product created:

- Product: `Gelled Microfiber Pillow`
- Product ID: `8099363094589`
- Handle: `gelled-microfiber-pillow`
- Status: **DRAFT**
- Vendor/type/category: `Malouf` / `Pillow` / `Pillows` in `Bedding`
- Collections: `Pillows` and `Filled Pillows`
- Theme template: `Default product`
- Queen variant ID `44049793777725`; SKU `ZZQQ00GM`; draft reference price `$59.99`
- King variant ID `44049793810493`; SKU `ZZKK00GM`; draft reference price `$69.99`

Validation and boundaries:

- At P1-005A completion, the Shopify product index showed exactly one product and two collections. This milestone is superseded by the current 39-product/13-collection checkpoint below; the original IDs remain canonical and were reused.
- Both variants exist with the source-matched manufacturer SKUs and reference prices. Inventory is not tracked; no quantity was invented.
- Description and media remain blank pending Ty-approved content/assets. No tags or custom metafields were created.
- Shipping dimensions, weight, inventory/availability, lead time, returns, warranty, and fulfillment facts remain unverified and must be completed before publication.
- The native parent-product plus `Size` variant structure is supported by the existing default product template. Storefront rendering and live Ajax Cart behavior were not claimed because the product remains draft.
- The current future builder mapping should discover eligible pillows from canonical `pillows`; explicit builder role/readiness data and broader multi-pillow discovery work remain separate tasks. `filled-pillows` is organizational.
- The Malouf MAP prices are recorded only for draft validation and require current authorization before any selling or publication.

## Merchandising state

- **APPROVED footprint:** six mattress display positions.
- **PROVISIONAL mattresses:** S7 (one), H6 (one), M3 (two different comfort configurations), M5 (two different comfort configurations). Six positions remain four working product families.
- **APPROVED bases:** Flex L, Flex LSX, Flex SH. Equal comparable LSX/SH pricing is a working owner principle pending current pricing-policy verification.
- **APPROVED pillows:** the exact 16 Malouf models across Zoned, Filled, Foam, and Temperature Regulating are recorded in the contract. No CBD products.
- **APPROVED sheets/protection/comforters:** BEDGEAR Cotton, Dri-Tec, Ver-Tex; Dri-Tec/Ver-Tex/Stretchwick encasement; Light/Medium/Ultra comforters.
- **SELECTED, not approved for publication:** BEDGEAR Cooling Blanket, Cooling Performance Throw, Solid White Duvet + Sham, Light Grey Racetrack Duvet + Sham; Malouf 2.5-inch Gel Memory Foam Topper; BEDGEAR React Pro Performance Topper.
- **APPROVED furniture:** Hennessy, Carlisle, Scoresby, Blackwell, Eastman, Watson. Furniture remains outside the Pod Builder.
- **DEFERRED/excluded:** Arrowhead duvet, Sherpa Throw, conditional Weekender headboard, CBD pillows, and unlisted products.

No product is publish-ready. The approved/selected Draft structures are staged, but they still need current price authorization, availability, shipping/fulfillment facts, physical sample mapping, warranty/return facts, approved content/media, and storefront/cart acceptance.

## Shopify and collection contract

- One Shopify product per approved model/family, not per showroom slot.
- M3/M5 variants require an approved size/geometry/comfort configuration and a verified fulfillment-component composition when one sell unit ships as several manufacturer parts.
- Native Shopify vendor, product type, SKU, options, price, availability, media, status, and variant IDs remain authoritative where sufficient.
- Minimal custom fields and one pairwise compatibility metaobject are specified in the contract.
- Retain canonical builder sources `adjustable-bases`, `mattress-protectors`, `pillows`, `sheets`, and `bedding`.
- Restore `mattresses` only when final mattresses are ready.
- Do not keep `bases` as a builder source if it would pull Eastman/Watson into the guided flow.
- Historical pillow subtype handles are not canonical builder dependencies. P1-005A explicitly adds `filled-pillows` as a merchandising subgroup, while the builder should continue to use canonical `pillows` plus category/filter data.
- Add `furniture` only when approved furniture products are implemented. No furniture builder step.

## Pod Builder preservation contract

Preserve the current inline architecture:

- `sections/snoozepod-pod-builder-hero.liquid`
- `snippets/snoozepod-guided-pod-builder-core.liquid`
- `assets/snoozepod-pod-builder.js`
- `assets/snoozepod-pod-builder.css`
- both Pod Builder product templates

Completed local discovery changes:

1. Explicit builder roles and product readiness instead of accidental handle/tag behavior.
2. Exact variant geometry and pairwise compatibility instead of size-text inference.
3. All eligible accessories, not `ADDON_STEP_LIMITS` first-item behavior.
4. No first-available variant fallback when size/geometry does not match.
5. `PENDING_VERIFICATION` and missing rules fail closed.
6. Furniture stays outside the builder.
7. P1-006A cart integrity remains the mandatory gate before builder-enabled publication.

## Compatibility boundary

- Standard, split-head, half-split, and full-split are distinct geometries.
- The source documents list many exact geometry SKUs but do not prove every mattress/base/accessory pair.
- M3/M5 component existence is manufacturer verified; allowed left/right comfort combinations remain pending.
- Dri-Tec/Ver-Tex have split-head product rows, but exact pairing rules still need approval.
- Stretchwick has no confirmed split-head variant and cannot appear as compatible for split-head builds.
- Malouf says Eastman works with all Malouf bases and most competitors, and Watson works with zero-clearance bases. Neither statement verifies a specific BEDGEAR pairing. Clearance and drawer/service access remain pending.

## Fixture and validation

The synthetic fixture contains no real SKU, Shopify ID, or price. It covers standard, modular, split-head, protection, sheets, multiple pillows, an explicit incompatible pairing, unknown encasement/platform cases, optional skip choices, and furniture coexistence without a builder role.

Validation results:

- `node tests/runP1_002PodBuilderContractTests.js` — **PASS**, 34 assertion groups.
- `node tests/runPodBuilderCanonicalTests.js` — **PASS**, six existing canonical cases.
- Fixture JSON parse and test-script syntax — **PASS**.
- At P1-002, no live cart request or product/template assignment test was run because Shopify was empty and mutation was not authorized.

## Cart-integrity gate

**IMPLEMENTED — AVAILABLE-ENVIRONMENT E2E COMPLETE; COMPLETE-BUNDLE SHOPIFY ACCEPTANCE PENDING.** The native mattress-form fallback was removed. The builder now:

- creates an immutable item plan with exact IDs, quantities, roles, and a private operation ID on every line;
- revalidates each selected variant through Shopify product JSON before mutation;
- reads `/cart.js` before adding, submits only reconciled missing quantities, then reads `/cart.js` again;
- identifies lines by variant, normalized non-empty properties, selling plan, and operation ID rather than stale line keys;
- treats non-OK, malformed, timeout, and network outcomes as ambiguous until read-back;
- distinguishes complete, failed, partial, uncertain, and concurrent outcomes;
- blocks repeat clicks and same-build cross-tab submissions while an operation is active;
- preserves the review selections and focuses an accessible live status after error;
- redirects only after the complete requested bundle is verified.

Files changed for P1-006A:

- `assets/snoozepod-pod-builder.js`
- `assets/snoozepod-pod-builder.css`
- `snippets/snoozepod-guided-pod-builder-core.liquid`
- `sections/snoozepod-guided-pod-builder.liquid`
- `tests/loadPodBuilderModule.js`
- `tests/runPodBuilderCartIntegrityTests.js`
- `TASKS.md`, `DECISIONS.md`, `HANDOFF.md`

Validation results:

- `node tests/runPodBuilderCartIntegrityTests.js` — **PASS**, 21 scenarios.
- `node tests/runPodBuilderCanonicalTests.js` — **PASS**, six existing canonical cases.
- `node tests/runP1_002PodBuilderContractTests.js` — **PASS**, 34 assertion groups.
- `node tests/runCartIntegrityTests.js` — **PASS**, existing cart regression checks.
- JavaScript syntax checks for the implementation, loader, and focused test — **PASS**.
- `git diff --check` — **PASS**.
- Existing Shopify development store/admin — **CONFIRMED**; the task stayed on `mysnoozepod` and no create-store action was submitted.
- Fresh anonymous `GET /cart.js` — **LIVE LIMIT CONFIRMED**; Shopify returned `302` to `/password`.
- Chrome direct `/cart.js` rendering — **BLOCKED BY CLIENT**; it did not yield an authenticated cart JSON surface.
- Valid-variant Shopify bundle mutation during P1-006A-E2E — **NOT EXECUTABLE AT THAT TIME**; the store was empty and that task prohibited catalog creation. The store now has 43 Draft products including four owner-approved mattress families, but no publication-ready complete bundle; no product was activated merely to run the test.
- Source corrections during P1-006A-E2E — **NONE REQUIRED**; no remaining defect was found in the available checks.

No builder-enabled product may publish before the remaining valid-variant Shopify acceptance cases pass in the current development store.

## Published-theme snapshot status

**COMPLETED AND VERIFIED.** Ty explicitly authorized Shopify's emailed export. Shopify confirmed `Theme files sent`; the export email identified store `mysnoozepod`, theme `mysnoozepod-com-snoozer-ai-main`, date October 30, 2026, time 2:58 pm. No theme state changed.

Current recovery snapshot:

- Private location: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\theme-139460542525\2026-10-30\theme-139460542525-snoozer-ai-main-2026-10-30-1458.zip`
- Recovery method: Shopify Admin > Online Store > published `snoozer-ai/main` > Download theme file > authorized email link > unchanged private copy.
- SHA-256: `1CCB4BF4F5C1092C5EB8B092402BBE61CB461754C54A2B40A1EE14C60E66E7F0`.
- Integrity: source and private-copy hashes match; size 9,596,367 bytes; 416 archive entries.
- Coverage: `config/settings_data.json`, `config/settings_schema.json`, 33 template entries, 94 section entries, 39 snippet entries, and 194 asset entries.
- Safety scan: zero high-confidence private-key/token patterns and zero email-address pattern entries detected in supported text files. No customer data was copied into project documentation.

Read-only filesystem verification found two older private exports:

- `C:\Users\1ones\Downloads\theme_export__mysnoozepod-com-refresh__23APR2026-1027pm.zip` — file timestamp 2026-04-24; 352 entries; includes settings data/schema, 20 template entries, and 55 section entries; SHA-256 `AAC3E2BADC3E01E49242D53844C85085B59E1B06017BAF3AC271B7DBF7CC52F9`.
- `C:\Users\1ones\Downloads\theme_export__mysnoozepod-com-snoozer-ai-main__10MAY2026-1040am.zip` — file timestamp 2026-05-10; 374 entries; includes settings data/schema, 23 template entries, and 69 section entries; SHA-256 `5793288DA8DB9D5D8290AAEAB07B532320CA05A421ACDBA0290D50C0099A268A`.

These older archives remain historical only; the fresh October 30 export above is the controlling recovery snapshot for P1-006A.

Before a later theme implementation, preserve or refresh this snapshot as appropriate and never wholesale sync the ZIP into GitHub or GitHub into Shopify.

## Decisions and facts still required

Ty:

1. Final approve or replace S7, H6, M3, and M5.
2. Approve the two exact M3 and two exact M5 showroom comfort configurations after vendor validation.
3. Approve customer-facing names/content.
4. Approve live prices after current pricing-policy verification.
5. Review the minimal functional cart-status wording before any customer-facing publication.
6. Select the Cooling Blanket color/sample (Navy or Grey).
7. Identify the authoritative Zoho SalesIQ widget/account.
8. Approve product/collection media and physical display/sample/swatches mapping.
9. Approve final public menu activation after the mattress and route gates are satisfied.

Vendor/operations:

- exact supported mattress/base/topology combinations;
- half-split/full-split component definitions;
- allowed M3/M5 comfort combinations;
- final size/color/SKU subset for every category;
- Stretchwick articulation/split-head answer;
- LSX/SH dropship rates, freight, and current price policy;
- Eastman/Watson with exact BEDGEAR base clearance;
- lead time, damage, return/final-sale, and warranty-service rules;
- physical sample availability.

## Storefront MVP implementation checkpoint

### Shopify development catalog and storefront skeleton

- **43 Draft products / 274 variants / 18 collections** are verified by Admin API readback.
- Malouf pillows: 16 products, 43 variants, five collections.
- BEDGEAR bases/bedding/protection/comforters/selected accessories: 16 products, 146 variants, five collection mappings.
- Malouf furniture plus selected topper: seven products, 48 variants, four collection mappings, including reuse of `mattress-toppers`.
- BEDGEAR mattresses: four APPROVED Draft products and 37 variants in `mattresses` collection `302103527485`.
- The product mix is 38 **APPROVED** and five **SELECTED**. No PROVISIONAL product was created.
- Every staged product is `DRAFT`, `publication_readiness=BLOCKED`, and `owner_content_status=PENDING`. Variant price status is `HISTORICAL_REFERENCE`; fulfillment is `PENDING`.
- No inventory quantity, availability promise, dropship promise, compatibility approval, description, or media was invented.
- The Cooling Blanket remains excluded pending Ty's Navy-versus-Grey selection and physical sample confirmation.

Mattress Shopify resources:

- S7 — `12" Memory Foam Mattress` — product `8100282794045`; 10 variants; one showroom display; `product-pod-builder`.
- H6 — `12" Hybrid Mattress` — product `8100282826813`; 10 variants; one showroom display; `product-pod-builder`.
- M3 — `12" Dual Comfort Mattress` — product `8100282892349`; eight size structures; two showroom displays; `product-pod-builder`.
- M5 — `14" Dual Comfort Mattress` — product `8100282925117`; nine size structures; two showroom displays; `product-pod-builder`.
- Exact pod locations remain unassigned. M3/M5 verified component feel labels are 0.0, 1.0, 2.0, and 3.0; complete sell-unit SKUs, allowed left/right combinations, and fulfillment compositions remain pending. M3 Split King is excluded because the current sheet supplies only a reused Twin XL chassis SKU plus an `Order 2` instruction.
- M5 SKU `BGM506W81` retains the workbook's `Twin XL x 2` size label but is explicitly classified `full_split`, supported by the workbook's `M5 MATTRESS SPLIT KING` group heading.

Durable catalog files:

- `docs/catalog/MVP_CATALOG_MANIFEST.json`
- `docs/catalog/shopify-catalog-readback.json`
- `docs/catalog/BEDGEAR_CATALOG_MANIFEST.json`
- `docs/catalog/bedgear-shopify-catalog-readback.json`
- `docs/catalog/MALOUF_FURNITURE_TOPPER_MANIFEST.json`
- `docs/catalog/malouf-furniture-topper-shopify-readback.json`
- `docs/catalog/BEDGEAR_MATTRESS_CATALOG_MANIFEST.json`
- `docs/catalog/bedgear-mattress-shopify-readback.json`
- `docs/catalog/STOREFRONT_SKELETON_MANIFEST.json`
- `docs/catalog/storefront-skeleton-shopify-readback.json`
- `scripts/stage-mvp-catalog.mjs`
- `scripts/stage-storefront-skeleton.mjs`
- `tests/build_bedgear_mattress_manifest.py`
- `tests/runBedgearMattressCatalogManifestTests.js`
- `tests/runStorefrontSkeletonTests.js`

All catalog manifests remain idempotent. The final storefront-skeleton plan reports zero product, collection, membership, template, menu, or category-navigation changes.

Storefront structure:

- All 18 collections use `snoozepod-v1`; the four mattress products retain `product-pod-builder`, and the other 39 products use `snoozepod-v1`.
- `main-menu` ID `189880664125` and `footer` ID `189880696893` match the authorized resource-backed hierarchy.
- The nested main menu is consumed by Dawn's configured desktop dropdown and mobile drawer. The local footer group now exposes the verified footer menu.
- Canonical customer routes use `sheets`, `cooling-bedding`, and `bedroom-furniture`. Legacy `sheet-sets` and `furniture` collections remain available as aliases but are not primary discovery sources.
- Product and collection v1 surfaces include minimal breadcrumbs. The homepage and collection template link the nine top-level shopping categories.
- Per-collection navigation mappings are verified for `pillows`, `bedding`, `bedroom-furniture`, and the retained `furniture` alias.
- No Warranty page exists. `Showroom Information` temporarily targets the verified booking page. Collection copy/media remain pending Ty approval.

### Product and collection experience

- Reusable v1 product and collection templates, shared Product Feel/showroom components, and responsive CSS are implemented locally.
- Product Feel is hidden without verified data and remains informational when present.
- Deterministic 1440px and 390px previews are under `docs/p1-005ux/previews/`; all four captures match the requested width and have no horizontal overflow.
- Sixty-one focused theme-contract assertions pass.
- The storefront-skeleton contract passes exact readback, route, template, menu, breadcrumb, footer, and builder mapping assertions.
- Local structure previews are under `docs/storefront-skeleton/previews/`; desktop navigation, open mobile menu, and collection page captures have no horizontal overflow and are explicitly labeled unpublished.
- Mattress products and the collection have the approved template suffixes in Shopify. The bounded 36-file theme set was uploaded to unpublished theme `139216420925`; published theme `139460542525` was not modified or synchronized.

### Pod Builder and customer journeys

- Builder discovery uses canonical collections (`adjustable-bases`, `mattress-protectors`, `pillows`, `sheets`, `bedding`) and explicit contract roles/readiness.
- Multiple eligible products render; arbitrary first-item and first-variant fallbacks are removed; ambiguous size/geometry resolution fails closed.
- Furniture is excluded from builder discovery, as required.
- P1-006A cart reconciliation remains intact; no mattress-only fallback was reintroduced.
- Ask Snoozer now forwards available page/product/variant/type/collection/source context through the existing frontend request.
- Cart assessment/booking routes are corrected. Absent mattress commerce routes and assessment shop actions fail closed.
- The homepage legacy shelf remains preserved only as inactive Shopify-managed template configuration and is not rendered. Canonical adjustable-base/protector routes replace obsolete product links in the pairing component.
- The Shopify development-store `main-menu` and `footer` are populated with verified resources. This did not publish the local theme or activate Draft products.

### P1-005F unpublished-theme visual QA

- Preview URL: `https://mysnoozepodtest.myshopify.com/?preview_theme_id=139216420925`.
- Target theme: `139216420925`, `snoozer-ai/main`, still `unpublished`.
- Published theme: `139460542525`, `snoozer-ai/main`, still `main`; unchanged during P1-005F.
- Final target-theme backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\theme-139216420925\p1-005f-2026-11-01T13-56-57-064Z`.
- `scripts/stage-unpublished-theme.mjs` provides target verification, pre-upload backup, rollback, dependency validation, and post-upload content/role verification. Final plan: 36 unchanged assets, zero creates/updates, zero missing dependencies.
- `scripts/stage-preview-collections.mjs` made all 18 approved collection shells available to the development store Online Store channel for route review. Final plan: 18 already published, zero pending, 43 products still `DRAFT`.
- Actual authenticated preview checks passed for desktop/mobile homepage, desktop dropdowns, the 390px mobile drawer and nested Mattresses submenu, eight major collection routes, Ask Snoozer activation, the empty-cart shell, footer/navigation links, and console warnings/errors.
- Actual screenshots are in `docs/p1-005f/shopify-preview/`; the four homepage/collection images and nested-menu image are Shopify preview captures. `fixture-product-desktop.png` and `fixture-product-mobile.png` are explicitly local Draft-product fixtures, not Shopify product routes.
- Integration corrections: shortened the product-information schema block name to meet Shopify's 25-character maximum, preserved the disabled legacy homepage section in required template order, and included all direct section dependencies in the bounded upload set.
- Material blocker: `/pages/book-a-snooze-session` and `/pages/snooze-assessment` still use the default page template in Shopify, so the actual preview shows descriptive page content rather than the implemented Calendly and assessment landing experiences. Assigning `landing-booking` / `landing-assessment` is global store state that can affect the published theme; it was not changed without a production-impact authorization.
- Full evidence and classification: `docs/p1-005f/P1-005F_VISUAL_QA.md`.

### Validation at checkpoint

The following pass at the final regression milestone:

- 21 P1-006A cart-integrity scenarios.
- Six canonical Pod Builder cases.
- 34 P1-002 contract assertion groups.
- Pod Builder discovery contract.
- Ask Snoozer context contract.
- Storefront route contract.
- Malouf pillow, BEDGEAR accessory, Malouf furniture/topper, and BEDGEAR mattress manifest/readback validators.
- P1-005UX theme contract and deterministic preview capture.
- Storefront-skeleton exact readback contract and deterministic navigation/collection preview capture.
- JavaScript syntax checks and targeted `git diff --check` for the storefront-skeleton edit set.
- Final plan-only Shopify preflight: 43 products, 18 collections, and zero pending collection, membership, product, menu, or category-navigation updates.

Validation limitations:

- Shopify CLI/theme-check is not installed in the existing environment, so no CLI Liquid validation was claimed.
- The BEDGEAR mattress Python generator could not be re-run because `openpyxl` is absent. The existing durable manifest was updated to the verified Shopify titles, the idempotent Admin API readback completed, and the mattress manifest/readback validator passed.
- Full-worktree `git diff --check` still reports pre-existing line-ending/trailing-whitespace findings in `sections/header.liquid` and `sections/main-collection-product-grid.liquid`; the targeted storefront-skeleton edit set passes.
- Authenticated unpublished-theme rendering is complete for the accessible homepage, collection, cart, header/footer, and integration entry points. This historical checkpoint used Draft-product fixtures; the later Catalog Restructure checkpoint directly verified actual S7/H6/M3/M5 Draft-product routes. The retired Pod Builder remains fixture/contract-based.
- The booking and assessment routes resolve, but their intended landing experiences remain blocked by global Shopify page-template assignments.

Complete-bundle Shopify Ajax Cart acceptance remains unexecuted because all staged products remain Draft and M3/M5 complete configuration identities are unresolved. Products were not activated merely to force a test.

### P1-007 visual merchandising and media

- Existing branch/worktree was preserved: `main`, approved baseline/HEAD `f5056cf9b3ee3392f0da01064f7171ea7c1ff01b`; no reset, switch, commit, or push occurred.
- Shopify final readback: 43 products, all 43 `DRAFT`; 274 variants; 147 product media records, all `READY`; 48 variants with images; 18 collections, all 18 with images and alt text.
- Exact manufacturer media is complete for 38 products. Five products fail closed without media: `flex-sh-adjustable-base`, `cooling-performance-throw`, `react-pro-performance-topper`, `weekender-gel-memory-foam-pillow`, and `bamboo-charcoal-pillow-cooling-cover`.
- The private archive contains 147 selected files / 395,672,247 bytes with source URL, dimensions, alt, order, file size, and SHA-256 recorded in `docs/p1-007/PRODUCT_MEDIA_LIBRARY.json`.
- Private asset root: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Assets\Shopify\P1-007`.
- Catalog pre-mutation backups: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\catalog-media-p1-007\`.
- Latest relevant target-theme backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\theme-139216420925\p1-005f-2026-11-01T16-44-37-313Z`.
- P1-007 changed only `sections/snoozepod-environment.liquid` in unpublished theme `139216420925`: Shopify collection imagery, responsive 900px sources, cover cropping, and a stable collection-handle route fallback for Draft-only preview state.
- Published theme `139460542525` remained `main` and unchanged. Target theme `139216420925` remains unpublished. No product was activated and no order was submitted.
- Authenticated preview checks at 1440×1000 and 390×844 confirm nine homepage collection cards with real images and working hrefs, the Mattress collection hero/category imagery, and no horizontal overflow. Actual captures are under `docs/p1-007/shopify-preview/`; fixture product captures are explicitly labeled under `docs/p1-007/fixture-preview/`.
- `tests/runP1_007MediaTests.js` passes 19 assertion groups covering archive/source proof, exact gaps, Shopify counts/statuses, variant/collection media, preserved commerce identity, homepage media/route behavior, authenticated screenshots, and the exact-media product fixture.
- Full report: `docs/p1-007/P1-007_VISUAL_MERCHANDISING.md`.

### Catalog & Shopping Experience Restructure checkpoint

- Branch/worktree preserved: `main`, HEAD `f5056cf9b3ee3392f0da01064f7171ea7c1ff01b`; no reset, switch, commit, or push.
- Shopify readback: 43 products, all `DRAFT`; 274 variants; 43/43 products tagged; 25 automated collections; zero manual collections.
- Tag namespaces: `category:`, `subcategory:`, `type:`, `collection:`, `comfort:`, `material:`, and `feature:`. Every automated collection uses one exact `TAG EQUALS collection:<handle>` rule.
- The 18 existing customer-facing collection handles were preserved through exact-ID replacement. Seven family routes were added: `s7`, `h6`, `m3`, `m5`, `flex-l`, `flex-lsx`, and `flex-sh`.
- Main-menu family links and all 25 `custom.category_navigation` mappings resolve to the new automated collection IDs. Authenticated preview verified the expanded mattress menu, `/collections/mattresses`, and `/collections/m3` sibling navigation.
- All 43 products use `snoozepod-v1`. The active homepage no longer contains the Pod Builder section/copy. Historical builder source remains unassigned for audit/rollback continuity; no customer-facing product/template route uses it.
- Product Page v1 preserves gallery, title, price, variant selector, fail-closed Product Feel, booking CTA, standard buy buttons, Ask Snoozer, showroom, and product-information sections.
- M3/M5 expose independent Left/Right `0.0`, `1.0`, `2.0`, and `3.0` controls. Values persist as `properties[Left Side Comfort]` and `properties[Right Side Comfort]`. Exact availability is resolved only from size plus verified `custom.left_comfort` / `custom.right_comfort` variant metafields. Current mapping count is zero; Add to Cart therefore remains disabled.
- Actual unpublished-theme preview: `https://mysnoozepodtest.myshopify.com/?preview_theme_id=139216420925`.
- Actual Draft-product acceptance: Shopify `onlineStorePreviewUrl` plus unpublished theme `139216420925` rendered the real S7, H6, M3, and M5 pages on November 2, 2026. S7/H6 display real media, price, size variants, booking, native Add to Cart, and Ask Snoozer. M3/M5 display the same Product Page v1 plus independent Left/Right controls; their submit state correctly remains unavailable because the authoritative sell-unit map is still absent.
- Private all-product preview index: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\draft-product-previews\latest\index.html`. Refresh it with `node scripts/generate-draft-product-preview-index.mjs`. It contains temporary preview tokens and intentionally remains outside the repository.
- Target theme `139216420925` remains `unpublished`; published theme `139460542525` remains `main` and unchanged. Final theme plan: 37 unchanged assets, zero creates/updates.
- First pre-mutation catalog recovery snapshot: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\catalog-shopping-restructure\2026-11-02T02-22-44-076Z`.
- Final relevant target-theme backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\theme-139216420925\catalog-shopping-restructure-2026-11-02T02-30-30-173Z`.
- Durable artifacts: `docs/catalog/CATALOG_SHOPPING_RESTRUCTURE_MANIFEST.json`, `catalog-shopping-restructure-before.json`, `catalog-shopping-restructure-current-inspection.json`, `catalog-shopping-restructure-shopify-readback.json`, and `CATALOG_SHOPPING_RESTRUCTURE.md`.
- Validation: 10/10 restructure assertions; standard/unsupported/mapped fixture shopping flow; 61 Product Page v1 assertions; 19 media groups; storefront skeleton/route and Ask Snoozer regressions; 34 dormant builder-contract groups; 21 cart-integrity scenarios; canonical builder regression; JavaScript syntax; targeted diff check; authenticated homepage/collection preview; and actual S7/H6/M3/M5 Draft-product preview.
- Shopify CLI/theme-check is not installed. Full-worktree diff checking still reports pre-existing whitespace in `sections/header.liquid` and `sections/main-collection-product-grid.liquid`; the task edit set passes.
- Fixture evidence: `docs/catalog/fixture-preview/standard-product-desktop.png`, `dual-comfort-desktop.png`, `dual-comfort-mobile.png`, and `dual-comfort-mobile-controls.png`. These are explicitly non-production Draft-product fixtures; collection/home checks used the actual authenticated Shopify preview.
- Complete report: `docs/catalog/CATALOG_SHOPPING_RESTRUCTURE.md`.

### Security follow-up

An initial read-only AWS CLI configuration inspection returned unrelated environment values in the private tool transcript before the query was restricted to the three required Shopify keys. No secret value is recorded in project files or this handoff, and no AWS mutation occurred. Rotate the potentially exposed Lambda credentials as a precaution through the normal secret-management process.

## Content pages and sharp logo checkpoint — 2026-11-02

- Fifty managed educational pages are published in Shopify. Existing pages were preserved; all new handles, IDs, hashes, statuses, and URLs are in `docs/content-pages/CONTENT_PAGES_SHOPIFY_READBACK.json`.
- Copy is manufacturer-neutral and uses only Soft, Medium Soft, Medium Firm, and Firm for customer-facing comfort descriptions. No numeric comfort scale appears in the content library.
- Every page contains the agreed structure: opening answer, educational sections, practical comparison guidance, considerations, MySnoozePod help, booking/Ask Snoozer actions, FAQs, and three related guides.
- The sharper logo source `omnia-journey/src/assets/mysnoozepod-logo-welcome.png` is deployed as `assets/mysnoozepod-logo-sharp.png` on published theme `139460542525` and development theme `139216420925`. Both plans are idempotent.
- Actual browser validation confirmed the sharp header logo, live page content, booking and Ask Snoozer links, footer, and related-guide navigation on the published theme.
- Storefront password protection remains enabled and was not changed. The 50 pages are published, but unauthenticated visitors continue to reach Shopify's password page until the store is deliberately opened.
- Backups: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-pages\2026-11-02T21-26-28-679Z` and `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\sharp-logo\2026-11-02T21-24-53-134Z`.
- Validation: `node tests/runContentPageTests.mjs`; content plan 50 unchanged; logo plan six unchanged.
- Full report: `docs/content-pages/CONTENT_PAGES_RELEASE.md`.

## Content-page editorial imagery checkpoint — 2026-11-02

- All 50 educational page handles map to one of ten original, manufacturer-neutral editorial images: showroom, virtual session, complete sleep system, comfort comparison, dual comfort, split system, mattress materials, cooling, adjustable base, or bedding essentials.
- The durable mapping is `content/content-page-images.mjs`; the live renderer is `sections/main-page.liquid`; the bounded staging tool is `scripts/stage-content-page-images.mjs`.
- Published theme `139460542525` and development theme `139216420925` each contain all ten SHA-256-verified PNG assets plus the exact page-section mapping. The development theme remains unpublished.
- Shopify readback: `docs/content-pages/CONTENT_PAGE_IMAGES_SHOPIFY_READBACK.json`.
- Private pre-change theme backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-page-images\2026-11-02T22-25-48-361Z`.
- Live browser checks covered one representative page from every visual group; every image completed at 1672×941, used the expected CDN filename, and exposed meaningful alt text. The sharp logo, navigation, article body, booking/Ask Snoozer actions, and footer remained intact.
- Validation passed: `node tests/runContentPageTests.mjs`, `node tests/runP1_005UXThemeContractTests.js`, `node tests/runStorefrontRouteContractTests.js`, staging-script syntax, Shopify theme readback, and live visual inspection.
- Storefront password protection remains enabled. No product, variant, collection, price, order, navigation, AWS, Calendly, or password-setting mutation occurred.

## Content navigation and conversion-placement checkpoint — 2026-11-02

- A new published guide directory is live at `https://mysnoozepod.com/pages/sleep-guides`. It lists all 50 educational guides exactly once in six groups and uses the existing complete-sleep-system editorial image.
- `content/content-navigation.mjs` is the durable page-group and menu contract. `scripts/stage-content-navigation.mjs` performs bounded plan/apply/readback against only Shopify's `main-menu` and `footer` menus.
- The primary menu now has seven focused top-level destinations: Mattresses, Adjustable Bases, Sleep Essentials, Bedroom Furniture, Sleep Guides, Your Showroom Visit, and Our Story. The home logo remains the Home route. Strategic guide links sit beneath relevant commerce and showroom branches instead of creating a flat 50-link navigation.
- The footer now exposes Sleep Guides, booking, assessment, story, contact, delivery, trial, support, privacy, and terms. Exact readback is `docs/content-pages/CONTENT_NAVIGATION_SHOPIFY_READBACK.json`.
- `sections/main-page.liquid` adds a responsive guide directory, contextual guide-discovery pills, and a blue Book a Snooze Session / Ask Snoozer conversion band. The conversion band and supporting article assets render before the global “Stay In The Loop” newsletter. The duplicate inline CTA was removed from all managed page bodies.
- Live published-theme checks passed for the homepage navigation, expanded Sleep Guides dropdown, the hub, a representative article, the CTA/newsletter order, and the footer. At 390×844 the mobile navigation exposed all seven destinations, no horizontal overflow was present, and the CTA buttons expanded to the available width.
- Shopify readback: 51/51 managed pages published, 51/51 image mappings, 50 guide pages on the hub, one hub page, two verified menus, 57 nested primary-menu items, and ten footer items.
- Final regression results: content pages PASS; content navigation PASS; catalog restructure 10/10 PASS; Product Page v1 contract 61 assertions PASS; storefront route contract PASS; storefront skeleton PASS; JavaScript syntax PASS; content, image, and navigation plan-only runs all report zero changes.
- Private recoverable backups: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-pages\2026-11-02T23-05-11-071Z`, `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-page-images\2026-11-02T23-06-34-425Z`, and `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-navigation\2026-11-02T23-07-00-347Z`.
- Product, variant, collection, price, inventory, order, AWS, Calendly, and storefront-password state were not changed. Published theme changes were bounded to the authorized content-page renderer/assets; development theme `139216420925` remains unpublished.

### Snoozer product-information rule

Snoozer must retrieve product information through the Shopify-authoritative commerce boundary using native product/variant fields, exact namespaced tags, collection membership, and verified metafields/metadata. Editorial page prose can support education but cannot establish product, price, availability, variant, compatibility, or fulfillment truth. Missing or conflicting values must remain unknown. This rule is documented for future development; no Snoozer backend or AWS change was made in this checkpoint.

## Exact next action

**M3/M5-SELLABLE-MAPPING — verify and stage the authoritative Dual Comfort sell-unit map.**

Obtain BEDGEAR/Ty approval for every supported size + Left Comfort + Right Comfort combination, complete sell-unit identity, SKU, and fulfillment component quantity. Create or update only the necessary Draft Shopify variants, populate `custom.left_comfort` and `custom.right_comfort`, and rerun exact-mapping, line-property, unsupported-combination, duplicate-combination, standard-cart, and responsive tests. Keep every unsupported combination disabled. Do not activate products, publish a theme, deploy, commit, or push.

## Resume rule

On resume, first recheck Git status/HEAD, `docs/catalog/catalog-shopping-restructure-shopify-readback.json`, `docs/content-pages/CONTENT_NAVIGATION_SHOPIFY_READBACK.json`, and plan-only runs of the content-page, page-image, and content-navigation staging scripts. Preserve unpublished theme `139216420925`, published theme `139460542525`, the 43 tagged Draft products, 274 variants, 25 automated collections/handles/rules, 147 READY product media records, 48 variant images, collection images, 51 published managed pages, the seven-destination primary menu, the ten-link footer, private backups, verified menus/metafields, and all working-tree changes. Do not recreate manual collections, reactivate the Pod Builder, duplicate products/variants, enable an unverified Dual Comfort combination, activate Draft merchandise, remove the content hub, let editorial prose override Shopify commerce truth, publish/synchronize a theme wholesale, change global page-template assignments, or deploy without explicit authority. The five exact-media gaps remain separate unresolved dependencies.
