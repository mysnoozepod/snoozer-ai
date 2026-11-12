# MySnoozePod.com Operational Handoff

Last updated: 2026-11-12 — Curated Sleep Systems, six-Pod showroom map, and product-first size shopping staged and preview-verified
Owner: Ty  
Implementer: Codi  
Current phase: The approved storefront strategy is implemented on the existing unpublished theme; publication and controlled cart acceptance remain separately gated

## Curated storefront strategy implementation — 2026-11-12

- Continued on existing `main` from starting commit `ea2d1db8`; no reset, branch switch, new store, new theme, backend work, or infrastructure work occurred.
- Collections now render `title → filters/products → Shop by Category`. The unfinished Find Your Fit block is removed until its guides are configured. Storewide size pages use concise headings such as `King Size`; products remain the primary content.
- Split-head and Split King mattress variants are hidden from standalone mattress shopping and direct split-variant URLs fall back to a safe standard variant. A short product-page link sends those shoppers to Sleep Systems. Split bedding/protection configurations remain available where the catalog supports them.
- Sleep Systems now starts with Standard, featured Split Head, and Split King pathways. Split Head exposes only Flex SH. Split King is two real Twin XL mattress variants plus two real Twin XL Flex L/LSX variants. Split Queen remains unsupported. Bedding sets no longer compete on this page.
- The structured showroom map is live in `custom.showroom_representation`: Pod 1 = 12-inch Memory Foam / Queen / Flex L; Pod 2 = 12-inch Hybrid / Half-Split Queen / Flex SH; Pod 3 = 12-inch Dual Comfort / Half-Split King / Flex SH / Soft-Firm; Pod 4 = 12-inch Dual Comfort / Split King / Flex LSX / Medium Soft-Medium Firm; Pod 5 = 14-inch Dual Comfort / King / Flex LSX / Soft-Firm; Pod 6 = 14-inch Dual Comfort / Queen / Flex LSX / Medium Soft-Medium Firm. Mattress cards and Product Page v1 render these as customer-facing Pod badges/details.
- Dual Comfort selectors use aligned two-column premium tiles, clear selected states, and a persistent left/right summary. All existing 16 approved comfort pairs remain orderable; incomplete selection remains fail closed.
- Existing clean lifestyle media now leads Cotton, Dri-Tec, and Ver-Tex Sheet Set galleries. Text-heavy graphics remain secondary media; no image was deleted.
- Shopify readback: 43 products, 274 variants, zero products created; 70 managed size collections and 14 storewide size destinations; unpublished theme `139216420925` only; published theme `139460542525` unchanged. Latest recovery backups: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\storewide-shop-by-size\2026-11-12T06-11-08-630Z` and `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\curated-bundles\2026-11-12T06-25-50-566Z`.
- Authenticated preview QA passed for the Split Head and Split King pathways, standalone Dual Comfort PDP, structured Pod information, King size collection ordering/prices, clean sheet lead media, and the absence of Find Your Fit. One raw JSON rendering defect in the lower showroom details was found during preview QA, corrected, restaged, and re-verified.
- Tests passed: storefront strategy 23; curated bundles 1,662; Storewide Shop by Size 965; Shop by Size 33; Product Page v2 28; Product Page/collection contract 69; website experience 46; product knowledge 43; catalog/shopping 10/10; P1-002 34 groups; cart integrity 21 scenarios plus legacy regression; canonical/discovery; JavaScript syntax.
- Preview URLs: `https://mysnoozepodtest.myshopify.com/pages/sleep-systems?preview_theme_id=139216420925` and `https://mysnoozepodtest.myshopify.com/collections/shop-by-size-king?preview_theme_id=139216420925`.
- No theme publication, checkout/order, product/variant creation, discount, Snoozer backend, AWS, or Git deployment occurred during implementation.
- Exact next action: perform a controlled development-cart acceptance for one Standard, one Split Head, and one Split King system, verifying exact variant IDs, quantities, line properties, totals, reconciliation, and selection recovery before publication.

## Collection hierarchy and Sleep Systems correction — 2026-11-11

- Continued on existing `main` from `cd51e99c`; no reset, branch switch, new store, new theme, or catalog rebuild.
- Collection templates now render the collection title, native filters/product grid, Shop by Category, then Find Your Fit. The custom collection hero, collection Ask Snoozer CTA, closing CTA, and visible pre-product Shop by Size panel are gone. Exact size-price and variant-deep-link behavior remains active invisibly on size collections.
- Sleep Systems now render four mattress cards. Standard sizes offer exact-size Flex L/Flex LSX; split-head sizes offer only exact-size Flex SH; Split King resolves to quantity two of the actual Twin XL mattress variant plus quantity two of the actual Twin XL base variant. Split Queen is explicitly excluded.
- The manifest/feed contain 17 relationships: 12 owner-approved mattress/base options and five existing bedding sets. The obsolete Complete Sleep Packages review group and menu link were removed.
- Authenticated preview evidence: `/collections/mattresses` showed four products before Shop by Category and Find Your Fit; `/collections/shop-by-size-king` showed 38 products with exact King prices before those bottom sections; 390×844 Sleep Systems showed four responsive system cards, `2 ×` Twin XL pricing for Split King, and Flex SH for Split Head Queen.
- Tests passed: curated bundles 1,658 assertions; Product Page/collection contract 70; Shop by Size 31; product knowledge 43; website experience 46; guided shopping; storefront skeleton; JavaScript syntax; whitespace.
- Shopify readback: 43 products, 274 variants, zero products created; unpublished theme `139216420925` only; published theme `139460542525` unchanged. Latest private recovery backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\curated-bundles\2026-11-12T02-11-50-224Z`.
- No checkout/order, theme publication, product/catalog mutation, Snoozer backend, or AWS work occurred.
- Exact next action: controlled development-cart acceptance for one standard system, one split-head system, and one Split King system, verifying line variants, quantities, properties, totals, and reconciliation before publication.

## Sleep Systems and curated bundles checkpoint — 2026-11-11

- Continued on existing `main` from starting commit `571b866634567cbe665d92451e49b0389929b320`; preserved completed work with no reset, branch switch, new store, new theme, or catalog rebuild.
- Added `/pages/sleep-systems` with primary navigation and three groups: Sleep Systems, Bedding Sets, and Complete Sleep Packages. Desktop and 390×844 preview QA passed after correcting theme-global image bleed and default size ordering.
- The deterministic manifest contains 11 bounded records: five shoppable bedding sets, four blocked mattress/base system candidates, and two blocked complete-package candidates. Matching size/geometry never becomes compatibility proof.
- Shoppable sets use actual available component variants and the hardened operation-tagged cart layer. Each line preserves native variant ID, SKU, price, availability check, product handle, quantity, and separate fulfillment identity. No parent product, artificial SKU, discount, promotion, duplicated inventory, or new collection exists.
- Actual Shopify Ajax Cart acceptance passed. The existing preview cart moved from six to eight items and contained Queen Ver-Tex Sheet Set `$299.99` plus Full/Queen Light Weight Comforter `$199.99`, each with exact variant/options and `Curated Set`, `Set Component`, and `Set Size` properties. Combined total matched `$499.98`. No checkout or order was created.
- Product-knowledge feed/schema now expose bundle IDs, categories, statuses, component product IDs, exact variant IDs/SKUs/prices, size/geometry records, and curation/showroom status for future Snoozer retrieval. No Snoozer backend, AWS, API, or recommendation change occurred.
- Shopify readback: 43 products, 274 variants, zero products created; page ID `gid://shopify/Page/109195460669`; six exact assets on unpublished theme `139216420925`; published theme `139460542525` unchanged.
- Latest private recovery backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\curated-bundles\2026-11-12T01-07-15-066Z` (UTC timestamp; work date 2026-11-11 America/New_York).
- Tests passed: curated bundles 1,564 assertions; cart integrity 21 scenarios plus legacy regression; canonical Pod Builder; P1-002 34 groups; product knowledge 42; Storewide Shop by Size 1,049; Shop by Size 30; Product Page v2 28; catalog/shopping 10/10; guided shopping; website experience; route; syntax; whitespace.
- Changed implementation/data surfaces: `assets/snoozepod-pod-builder.js`, `assets/snoozepod-curated-bundle-*`, `sections/snoozepod-curated-bundles.liquid`, `templates/page.sleep-systems.json`, manifest/generator/stager, product-knowledge feed/schema/exporter, focused tests, and project-control documents.
- Remaining material dependencies: Ty approval of names/composition/wording; explicit manufacturer/owner mattress-to-base pairwise compatibility; showroom relationship confirmation. All affected system/package records remain fail closed.
- Exact next action: verify and encode pairwise mattress/base compatibility records, enable only proven configurations, and rerun the same real-cart acceptance. Do not publish the theme without separate authorization.

## Storewide Shop by Size checkpoint — 2026-11-11

- Continued on existing `main` at `815bef9d5ec2d0f637dcd70b4dd86fd9479d54f6`; preserved all completed work and did not reset, switch branches, create a store, or create a theme.
- Re-inventoried the actual Shopify development catalog: 43 products, 274 variants, 25 pre-existing automated collections, and four menus. Product identities, statuses, variants, SKUs, prices, availability, media, and existing taxonomy were held immutable.
- Derived `shop-by-size:true` plus exact `shop-size:<slug>` tags for 42 products with meaningful available Size variants. The One Size-only cooling throw is intentionally excluded. Native compound values map deterministically to their supported destinations; no size or configuration was invented.
- Created and verified 77 nonempty automated collections: one master Shop by Size, 15 storewide size destinations, and 61 category-size destinations across nine categories. All use exact tag rules and the existing `snoozepod-v1` collection template.
- Added Shop by Size to the existing main menu after Mattresses with direct Twin, Twin XL, Full, Queen, King, and California King children. The master and category pages expose all other actual configurations without crowding the primary navigation.
- Generalized the existing collection-card implementation. Size routes show exact variant-specific prices and product links preserve `variant=<id>` plus size context. Existing native filters, product pages, Add to Cart, booking, and Ask Snoozer remain intact.
- Extended the product-knowledge feed with deterministic `shopSizeKeys`; Shopify remains authoritative for live price, availability, cart, and checkout. No Snoozer backend or AWS work occurred.
- Actual preview acceptance passed: Queen collection exact prices; Queen memory-foam variant `44128361971773` at `$1,599.99`; Add to Cart confirmed `Size: Queen`; Split Head King Adjustable Bases returned only Flex SH at `$2,799.00`; desktop and 390×844 responsive rendering remained usable.
- Tests passed: Storewide Shop by Size 1,049 assertions; Shop by Size 30; product knowledge 40; Product Page v2 28; catalog/shopping 10/10; JavaScript syntax; whitespace checks.
- Unpublished theme `139216420925` contains the four bounded storefront assets. Published theme `139460542525` was hash-verified unchanged. Latest private backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\storewide-shop-by-size\2026-11-11T20-26-50-012Z`.
- Durable evidence: `docs/storewide-shop-by-size/STOREWIDE_SHOP_BY_SIZE.md`, manifest, and `SHOPIFY_READBACK.json`.
- Exact next action: perform a bounded keyboard/focus/accessibility and launch-readiness audit on the unpublished theme. Do not publish without Ty's separate authorization.

## Shop by Size checkpoint — 2026-11-11

- Continued on existing branch `main` from starting commit `7516049218fc7bb64e5175fef1892f020e476cf2`; no reset, branch switch, new store, or new theme occurred.
- Added a mattress-only Shop Mattresses by Size panel for Twin, Twin XL, Full, Queen, King, and California King. It uses actual Liquid `variant.available`, exact Shopify variant IDs/prices, a clear action, accessible pressed/status states, and preserves compatible sort/filter parameters.
- Product-card links now carry the matching native `?variant=` ID. Actual Product Page v2 acceptance preselected Twin and `$1,799.00`; native Add to Cart added variant `44128362201149`, and the cart confirmed `Size: Twin`, quantity one, and `$1,799.00`. No checkout or order was submitted.
- Actual collection acceptance: Queen returned four products with exact prices; Twin returned only Hybrid and Memory Foam. Both Dual Comfort mattresses were correctly absent for Twin. Desktop and 390×844 mobile displayed all six controls with no horizontal overflow.
- Reused native variant Size, ID, SKU, price, and availability plus existing `custom.feel_label`, `custom.sleep_geometry`, `custom.compatibility_key`, verified compatibility fields, and `custom.showroom_representation`. Added only derived feed field `standardizedSize`; no Shopify metafield, product, variant, collection, price, inventory, or status changed.
- Unpublished theme `139216420925` received exactly `assets/snoozepod-shop-by-size.js`, `sections/main-collection-product-grid.liquid`, and `snippets/card-product.liquid`. Published theme `139460542525` was hash-verified unchanged. Latest private recovery snapshot: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\shop-by-size\2026-11-11T19-17-48-087Z`.
- Tests passed: Shop by Size 37; product knowledge 40; Product Page v2 28; Product Page v1 67; website experience 44; mattress naming 18 groups; guided shopping 10; catalog/shopping 10/10; storefront routes; JavaScript syntax; whitespace checks; Shopify three-asset readback.
- Remaining truth gaps: exact physical showroom Pod/display locations; verified mattress/base compatibility relationships; whole-product Feel for Dual Comfort remains intentionally null. No Snoozer backend/API/AWS work was performed.
- Exact next action: complete a bounded accessibility and release-readiness audit of the unpublished theme, including keyboard/focus review of Shop by Size and the remaining payment/tax/shipping/fulfillment/policy gates. Do not publish without Ty's separate authorization.

## Product Page Refinement v2 checkpoint — 2026-11-11

- Continued on existing branch `main` from starting commit `3556be8d6ccbb484f9dad9feac28baf65a3f2eaf`; no reset or branch switch occurred.
- Mattress pages now use the dedicated five-section information renderer in the approved order: Product Details, Sleep Trial, Delivery, Warranty, and Feel. Product Details implements Construction, Features & Benefits, Showroom Location, and Manufacturer's Model Name. Unverified subsections stay hidden.
- Non-mattress pages retain the existing category-specific product-knowledge renderer. Native gallery, variant selection, price updates, product form/Add to Cart, Ask Snoozer, and Dual Comfort controls are preserved.
- Added only `custom.feel_label`, constrained to Plush, Medium Plush, Medium Firm, and Firm. Existing Shopify vendor/model, construction, verified features/materials, showroom JSON, warranty, policy pages, variant IDs, and SKUs remain authoritative. Product-knowledge feed/schema now expose `feelLabel`.
- Verified Plush values were applied to the `12" Memory Foam Mattress` and `12" Hybrid Mattress`. No product-level Feel was invented for either Dual Comfort mattress.
- Mattress customer-facing descriptions, navigation labels, and media alt text now consistently use inch symbols; internal canonical handles remain unchanged.
- Mobile refinements: one full-width swipe position per gallery image, compact thumbnails, two-column pill options, tighter accordions, and a horizontal related-product carousel. Desktop hero structure remains intact.
- Lower CTA hierarchy is Book a Snooze Session primary and Ask Snoozer secondary; hero Add to Cart remains immediately after variant selection.
- Shopify staging/readback: unpublished theme `139216420925`; 43 products; 274 variants; 82 product definitions; four variant definitions; 84 contract definitions; published theme `139460542525` hash-verified unchanged across ten bounded assets. No theme publication, order, price, inventory, fulfillment, AWS, or Snoozer backend change occurred.
- Recovery snapshots: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\product-knowledge-architecture\2026-11-11T15-44-23-852Z` and `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\mattress-customer-naming\2026-11-11T15-43-24-478Z`.
- Tests passed: Product Page v2 28 assertions; product knowledge 40; Product Page v1 67; website experience 44; catalog/shopping 10/10; mattress naming 18 groups; JavaScript syntax and whitespace checks.
- Visual limitation: actual authenticated desktop/mobile preview QA could not run because the storefront is password-protected, the available browser was not authenticated to Shopify Admin, and Shopify CLI is not installed. Do not claim render verification from this checkpoint.
- Missing content for Ty: exact showroom Pod/display locations; verified product-specific warranty length/coverage/foundation/care facts; approved benefit copy; optional whole-product Feel for Dual Comfort only if accurate; final review of global Sleep Trial and Delivery policies.
- Exact next action: run authenticated desktop and 390×844 unpublished-theme preview acceptance across one mattress, adjustable base, pillow, and sheet product, then correct only observed responsive defects. Do not publish the theme.

## Header simplification checkpoint — 2026-11-09

- Removed the customer-facing Check In/Snooze Code controls from both desktop and mobile headers, including their styles and unused `/identity/check-in` submission code.
- Preserved Ask Snoozer on desktop/mobile, account, cart, navigation, and the separate assessment-issued Snooze Code continuity data used by Snoozer.
- Increased the mobile logo maximum width from `14rem` to `18rem` and changed the mobile tools row to a single full-width Snoozer column.
- Focused validation passed: website experience 42 assertions, Snooze Code theme UI, Product Page v1 66 assertions, storefront route contract, and whitespace checks.
- Published theme `139460542525` and unpublished theme `139216420925` both received the bounded header update. Final deployment readback verified 54/54 allowlisted assets; latest private backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\storefront-polish\2026-11-09T23-58-40-392Z`.
- Actual desktop and 390×844 rendering confirmed no Check In text/form; the mobile logo renders at 180×60px, Menu/account/cart/Ask Snoozer remain available, and document width stays within the viewport.
- Exact next action: continue the remaining bounded release-readiness checks; no additional header work is required.

## Dual Comfort all-pairs checkpoint — 2026-11-08

- Ty explicitly confirmed that customers may choose any comfort for either side. The orderable set is the full 4×4 matrix: Soft, Medium Soft, Medium Firm, and Firm on the left independently paired with the same four choices on the right.
- The existing Shopify size variant remains the sellable variant. `Left Side Comfort` and `Right Side Comfort` are required Shopify line-item properties so the exact selection persists into cart and order data without creating 16 duplicate variants per size.
- Add to Cart enables only after size, left comfort, and right comfort are complete and the selected Shopify size variant is available. Missing selections and unavailable sizes remain fail closed.
- The obsolete requirement for per-pair `custom.left_comfort` and `custom.right_comfort` variant metafields is removed from the active product-page contract.
- Automated coverage iterates all 16 pairings against an available size and verifies rejection for unavailable size, missing size, and invalid comfort values.
- Published theme `139460542525` and unpublished theme `139216420925` both received the exact two-asset implementation. Final deployment readback verified 54/54 allowlisted assets; latest private backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\storefront-polish\2026-11-09T03-37-07-485Z`.
- Actual Shopify cart acceptance passed on the development storefront: Queen + Left Medium Soft + Right Firm enabled Add to Cart, added variant `44128362561597`, and rendered `Size: Queen`, `Left Side Comfort: Medium Soft`, and `Right Side Comfort: Firm` in both the add confirmation and cart page. No checkout or order was submitted.
- This checkpoint supersedes the older unresolved-combination notes below; those entries remain as historical task evidence.

## Storefront commerce and mobile polish checkpoint — 2026-11-08

- Continued on the existing `main` branch, integrated nine Shopify-generated remote commits without resetting either side, and pushed the final implementation commit `f470e0eeae9df017e2c349711225abaff278e8e3` to `origin/main`.
- Removed the redundant header booking CTA while preserving the announcement-bar booking link. Product pages now place native Add to Cart immediately after variants as the focal navy action; booking appears only once in a secondary page-tail comparison CTA.
- Size and Dual Comfort controls now have visible blue-gray unselected states and navy selected states. Dual Comfort keeps the button text `Add to cart` and correctly recognizes the currently selected Shopify size.
- Collection pages are merchandise-first and no longer repeat the global booking banner. The primary Ask Snoozer action now opens the actual Snoozer panel instead of falling back to `/collections/all`.
- The homepage `More Than A Mattress` section contains only bases, pillows, bedding, protection, toppers, and furniture. Mattress and collection rows become horizontal snap carousels at the mobile breakpoint; verified at 390×844 with no document-level overflow.
- The booking page contains one Calendly embed followed by an optional assessment link and no self-referential pre-footer booking banner. Duplicate Zoho SalesIQ initialization was removed; the existing Ask Snoozer surface remains.
- Published theme `139460542525` and unpublished theme `139216420925` were updated through the exact bounded allowlist. Final readback verified 54/54 assets. Latest private recovery backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\storefront-polish\2026-11-09T01-55-12-954Z`.
- Durable deployment evidence: `docs/storefront-polish/SHOPIFY_READBACK.json`. Store password protection remains intentionally enabled for development.
- Automated validation passed: Product Page v1 66 assertions; website experience 42; catalog/shopping 10/10; storefront routes; guided shopping; media 19 groups; mattress naming 18 groups; product knowledge 40 groups; JavaScript syntax; and `git diff --check`.
- Live visual checks passed on the homepage, standard mattress product, Dual Comfort product, mattresses collection, booking page, and 390×844 mobile homepage/product. No order, checkout, product, variant, price, inventory, navigation, customer, Calendly, or AWS mutation occurred.
- Exact next action: deploy the all-pairs contract, add a representative selection to an isolated development cart, and verify size plus both comfort properties in Shopify's actual cart response.

## Customer-facing mattress naming checkpoint — 2026-11-08

- Continued on existing `main`; preserved and completed the existing working-tree changes. No reset, branch switch, deployment, or theme publication occurred. The completed repository changes were committed and pushed to `origin/main` as directed.
- Four Shopify mattress identities are now customer-facing and product-led: `12\" Memory Foam Mattress`, `12\" Hybrid Mattress`, `12\" Dual Comfort Mattress`, and `14\" Dual Comfort Mattress`.
- Canonical handles are `12-inch-memory-foam-mattress`, `12-inch-hybrid-mattress`, `12-inch-dual-comfort-mattress`, and `14-inch-dual-comfort-mattress`. Shopify redirects from the four former model-based handles were created and verified in the storefront.
- Customer-visible titles, descriptions, navigation, homepage cards, collection/product vendor treatment, media alt text, and related-product surfaces no longer use BEDGEAR or S7/H6/M3/M5 for these mattresses. Internal manufacturer/model, SKU, source provenance, and operational mappings were preserved.
- Dual Comfort now exposes independent left/right choices of Soft, Medium Soft, Medium Firm, and Firm. Legacy 0.0–3.0 evidence is mapped internally and is not rendered or sent as customer-facing comfort values.
- Add to Cart remains fail closed for unresolved left/right combinations. This task did not invent sell-unit mappings or change product IDs, variant IDs, SKU, price, inventory, collection membership, or product status.
- Existing unpublished theme `139216420925` reconciles eleven bounded customer-facing assets. This includes mattress vendor suppression on product cards, cart/drawer, add-to-cart notification, and predictive search. Published theme `139460542525` was hash-verified unchanged.
- Authenticated storefront preview verified the homepage, the `12\" Dual Comfort Mattress` product page, all eight independent comfort controls, generic media alt text, and redirect from the former M3 product URL.
- Regression results: focused naming 18; product knowledge 40; website experience 35; Product Page v1 62; catalog/shopping 10/10; P1-002 contract 34 groups; media 19 groups; content navigation, BEDGEAR description safety, guided shopping, cart integrity, storefront route, storefront skeleton, and JavaScript syntax all passed.
- Shopify readback: `docs/catalog/MATTRESS_CUSTOMER_NAMING_SHOPIFY_READBACK.json`.
- Latest recovery snapshot: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\mattress-customer-naming\2026-11-08T20-44-50-716Z`.
- Product-knowledge readback/feed was refreshed without additional Shopify writes. Latest supporting snapshot: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\product-knowledge-architecture\2026-11-08T20-39-24-009Z`.
- Exact next action: obtain and validate the manufacturer/owner-approved size + left comfort + right comfort sell-unit and fulfillment mapping for the two Dual Comfort products; keep unsupported combinations unpurchasable.

## Product knowledge architecture checkpoint — 2026-11-07

- Continued on existing `main` and preserved all prior website-experience working-tree changes.
- Live inventory before implementation: 43 Active products, 274 variants, 1,280 existing `custom` metafield values, two Shopify product definitions, zero custom variant definitions, and three Shopify-provided metaobject definitions.
- Created 79 product and four variant definitions. Fourteen workflow/content fields are pinned in Shopify. No new custom metaobjects were needed; existing Shopify taxonomy metaobjects were preserved.
- Applied 324 bounded metafield writes: 43 exact `PENDING` to `NOT_STARTED` workflow migrations and 281 category/schema/provenance initializations. No existing merchant value conflicted or was overwritten.
- Category mapping is exact: four mattresses, three adjustable bases, 16 pillows, three sheet products, three protectors, six comforter/duvet/accessories, two toppers, and six furniture products.
- Product Page v1 now calls `snippets/snoozepod-product-knowledge.liquid`. Approved owner content and populated category fields render without filler; unapproved/empty fields stay hidden.
- Actual Shopify admin showed Ty's seven `Content |` fields at the top of the product metafield editor, followed by workflow and authority fields.
- Actual unpublished-theme checks covered one product from every category contract and confirmed the correct category heading, standard purchase action where applicable, preserved booking/Ask Snoozer, and no desktop overflow.
- Final validation passed: 40 product-knowledge assertions, an idempotent live Shopify plan with zero pending mutations, website-experience (35), catalog/shopping (10/10), guided-shopping, Product Page v1 (62), cart integrity, builder contract (34), media (19), route, and storefront-skeleton regressions.
- Native commerce fingerprint across product/variant identity, status, descriptions, tags, collections, templates, prices, inventory, and media was unchanged. All 43 products remain in their pre-existing Active state.
- Published theme `139460542525` was not modified; both affected published assets were hash-verified unchanged. Unpublished theme `139216420925` contains the renderer.
- Versioned integration artifacts: `schemas/product-knowledge.v1.schema.json`, `docs/product-knowledge/PRODUCT_KNOWLEDGE_FEED.v1.json`, `tests/fixtures/product-knowledge-categories.v1.json`, and `scripts/export-product-knowledge.mjs`.
- Documentation: `docs/product-knowledge/PRODUCT_KNOWLEDGE_ARCHITECTURE.md` and `docs/product-knowledge/OWNER_CONTENT_CHECKLIST.md`.
- Shopify readback: `docs/product-knowledge/PRODUCT_KNOWLEDGE_SHOPIFY_READBACK.json`; audit: `PRODUCT_KNOWLEDGE_INVENTORY.json`; screenshots: `docs/product-knowledge/screenshots/`.
- Latest recovery snapshot: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\product-knowledge-architecture\2026-11-08T04-58-16-640Z` (UTC timestamp; work date 2026-11-07 America/New_York).
- No Snoozer/AWS backend, product/variant identity, price, inventory, media, collection, navigation, Calendly, theme role, published theme, cart, checkout, order, deployment, commit, or push change occurred.

## Website experience completion checkpoint — 2026-11-06

- Continued on existing branch `main` from starting HEAD `aba289e76b6aca8635869131d4b00c704623a5df`; no reset, branch switch, commit, push, or deployment occurred during this checkpoint.
- Existing unpublished review theme `139216420925` received ten bounded theme-asset updates. Published theme `139460542525` was not targeted, and its corresponding asset hashes were verified unchanged.
- Preview: `https://mysnoozepodtest.myshopify.com/?preview_theme_id=139216420925`.
- Homepage hierarchy is now booking first: Book a Snooze Session, private-session explanation, direct S7/H6/M3/M5 product showcase, complete-system categories, Meet Snoozer, optional tools, and closing booking action.
- Header/navigation now preserve direct shopping, Ask Snoozer, Snooze Code, account/cart, and check-in while making booking prominent. Mobile exposes Guest Check In through a compact disclosure and removes the redundant horizontal category strip at phone widths.
- Collection Page v1 now places the native product grid and filters before optional guided tools. Product Page v1 preserves native Shopify variant/cart behavior and adds related products. The retired bundle-cart Pod Builder remains absent from active customer templates.
- Direct booking is first on `/pages/book-a-snooze-session`; the mini assessment is explicitly optional and second. Shopify readback confirms the booking and assessment template suffixes. Both existing Calendly widgets loaded in the authenticated preview.
- Footer navigation now groups Shop, Visit & Guidance, and Customer Support above the existing newsletter. A conservative `/pages/warranty-support` page was created without inventing coverage promises.
- Actual preview validation covered desktop and mobile homepage, booking, mattresses collection, S7 product, M3 Dual Comfort, cart, checkout, Sleep Tools, Ask Snoozer, Guest Check In, and warranty support. One S7 Twin was added to the isolated preview-browser cart; no customer information was entered and no order was placed.
- M3/M5 independent left/right controls still fail closed because exact sell-unit configuration mappings are unverified. Actual Left `0.0` / Right `3.0` selection updated the summary while Add to Cart remained unavailable.
- Existing catalog state was preserved: 43 products remain in their pre-existing Active state; products, variants, SKUs, prices, media, tags, collections, navigation resources, and inventory were not changed.
- Automated validation passed: website-experience contract (35 assertions), catalog/shopping restructure (10/10), guided shopping, Product Page v1/collection contract (62 assertions), cart integrity, P1-002 contract (34 groups), P1-007 media (19 groups), storefront routes, storefront skeleton, JavaScript syntax, and idempotent Shopify staging plan.
- Actual screenshots are in `docs/website-experience/screenshots/`; the complete report is `docs/website-experience/WEBSITE_EXPERIENCE_COMPLETION.md`; bounded Shopify readback is `docs/website-experience/WEBSITE_EXPERIENCE_SHOPIFY_READBACK.json`.
- Latest recoverable private theme backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\website-experience-completion\2026-11-06T13-15-47-646Z`.
- Launch dependencies remain: Ty approval of final copy/imagery, exact M3/M5 sell-unit mappings, verified payment/tax/shipping/fulfillment and policy configuration, a controlled test order, accessibility/analytics review, and explicit publication authorization.

## Current task and authority

The latest owner request rejected the model-level collection detours and directed use of BEDGEAR.com for actual manufacturer information. S7, H6, M3, M5, Flex L, Flex LSX, and Flex SH now resolve directly to canonical Shopify products from the main menu, parent collection cards, and adjustable-base quick links. The seven obsolete one-product collections were not deleted; they were unpublished from Online Store after exact membership and replacement routes were verified.

Official BEDGEAR product pages were matched by exact identity to 18 of the 20 BEDGEAR products. Those 18 now carry concise source-bound `Product Overview` and `Key Features` blocks before the existing `About BEDGEAR` block. No exact current BEDGEAR.com product page was verified for the Solid White or Light Grey Racetrack duvet/sham sets, so those two retain only the company boilerplate. Current Shopify readback still reports all 43 products Active; product identity, status, tags, template, variant, SKU, price, option, media, inventory, and collection membership were preserved.

M3/M5 product-page independent Left/Right 0.0–3.0 selection remains fail closed. The new customer-facing Dual Comfort Planner uses the approved Soft, Medium Soft, Medium Firm, and Firm language and records preference only. No exact sell-unit mapping is currently verified, so Add to Cart remains disabled for unresolved M3/M5 combinations. No product was activated, the development theme remains unpublished, and no cart, order, backend deployment, Calendly change, or AWS mutation occurred.

## Canonical baseline

- Repository: `https://github.com/mysnoozepod/snoozer-ai.git`
- Branch: `main`
- Approved historical starting commit: `f5056cf9b3ee3392f0da01064f7171ea7c1ff01b`; start-of-this-correction HEAD: `e0bad6b75b2214760a6eee05efa3d084ede46e3e`.
- Owner decision: GitHub `main` is the canonical development baseline; do not reset it to the historical builder commit.
- Published Shopify theme: ID `139460542525`, name `snoozer-ai/main`, role `main`.
- Shopify catalog at this checkpoint: 43 Active products, 274 variants, and 25 automated collections; durable IDs are recorded in the catalog manifests/readbacks. The status change from the earlier Draft checkpoint occurred outside the BEDGEAR description task.
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
- The primary menu has seven focused top-level destinations: Mattresses, Adjustable Bases, Sleep Essentials, Bedroom Furniture, Guides & Tools, Your Showroom Visit, and Our Story. The home logo remains the Home route. Strategic guide and tool links sit beneath relevant commerce and showroom branches instead of creating a flat directory.
- The footer now exposes Sleep Tools, Build Your SnoozePod, Sleep Guides, booking, assessment, story, contact, delivery, trial, support, privacy, and terms. Exact readback is `docs/content-pages/CONTENT_NAVIGATION_SHOPIFY_READBACK.json`.
- `sections/main-page.liquid` adds a responsive guide directory, contextual guide-discovery pills, and a blue Book a Snooze Session / Ask Snoozer conversion band. The conversion band and supporting article assets render before the global “Stay In The Loop” newsletter. The duplicate inline CTA was removed from all managed page bodies.
- Live published-theme checks passed for the homepage navigation, expanded Sleep Guides dropdown, the hub, a representative article, the CTA/newsletter order, and the footer. At 390×844 the mobile navigation exposed all seven destinations, no horizontal overflow was present, and the CTA buttons expanded to the available width.
- Shopify readback: 51/51 content pages published, 51/51 image mappings, 50 guide pages on the guide hub, ten guided-shopping pages, two verified menus, 72 nested primary-menu items, and 12 footer items.
- Final regression results: content pages PASS; content navigation PASS; guided shopping PASS; catalog restructure 10/10 PASS; Product Page v1/collection contract 62 assertions PASS; storefront route contract PASS; storefront skeleton PASS; JavaScript syntax PASS; content, image, navigation, and guided-shopping plan-only runs report zero changes.
- Private recoverable backups: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-pages\2026-11-02T23-05-11-071Z`, `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-page-images\2026-11-02T23-06-34-425Z`, and `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-navigation\2026-11-02T23-07-00-347Z`.
- Product, variant, collection, price, inventory, order, AWS, Calendly, and storefront-password state were not changed. Published theme changes were bounded to the authorized content-page renderer/assets; development theme `139216420925` remains unpublished.

### Snoozer product-information rule

Snoozer must retrieve product information through the Shopify-authoritative commerce boundary using native product/variant fields, exact namespaced tags, collection membership, and verified metafields/metadata. Editorial page prose can support education but cannot establish product, price, availability, variant, compatibility, or fulfillment truth. Missing or conflicting values must remain unknown. This rule is documented for future development; no Snoozer backend or AWS change was made in this checkpoint.

## Guided shopping checkpoint — 2026-11-02

- Ten pages are published: `/pages/sleep-tools`, `/pages/build-your-snoozepod`, `/pages/mattress-finder`, `/pages/compatibility-checker`, `/pages/compare-sleep-systems`, `/pages/snooze-session-planner`, `/pages/dual-comfort-planner`, `/pages/pillow-finder`, `/pages/cooling-bedding-finder`, and `/pages/room-delivery-planner`.
- `content/guided-shopping.mjs` is the durable page, route, customer-filter, and tag-organization contract. `sections/snoozepod-guided-tools.liquid`, its nine field snippets, and `assets/snoozepod-guided-tools.{js,css}` provide the shared implementation.
- The homepage routes customers into Build Your SnoozePod, Mattress Finder, and Snooze Session Planner before collection exploration. The collection template adds contextual tools and curated exact-tag links before the native Shopify grid/filter area.
- The dedicated Build Your SnoozePod page plans mattress direction, size, geometry, base, protection, pillows, and bedding. Every accessory is optional. Submission stores a recoverable local plan and performs no cart request.
- Live published-theme validation verified: M3/M5 suggestions for a Dual Comfort / King / Split Head plan; explicit pending compatibility; Queen Standard versus King Split Head mismatch rejection; independent Soft-left/Firm-right preference storage; homepage placement; `/collections/mattresses` guidance, quick links, and four product cards; 390×844 mobile rendering; and zero browser console warnings/errors.
- Shopify readback confirms 10/10 published pages and 27/27 assets on each of themes `139460542525` and `139216420925`. The added bounded assets provide direct product cards for the mattress and adjustable-base parent collections.
- Shopify menu readback confirms 72 nested primary-menu items and 12 footer items. `Guides & Tools` now routes through the Sleep Tools hub while strategic tools also appear beneath relevant commerce branches.
- Private backups: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\guided-shopping\2026-11-03T00-07-14-924Z` and `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-navigation\2026-11-03T00-06-04-708Z`.
- Durable readbacks: `docs/guided-shopping/GUIDED_SHOPPING_SHOPIFY_READBACK.json` and `docs/content-pages/CONTENT_NAVIGATION_SHOPIFY_READBACK.json`.
- No cart, order, product, variant, price, inventory, status, collection rule, AWS, Calendly, password, deployment, or theme-role mutation occurred. The store remains password protected and the development theme remains unpublished.

## Direct product navigation and BEDGEAR product-copy checkpoint — 2026-11-02

- Owner source: `https://bedgear.pxm.pattern.com/share/RWlH0Qhcsk`.
- The PXM share contains `BEDGEAR Boilerplate - Updated January 2026-.docx`, uploaded January 22, 2026. It remains the source for the separate `About BEDGEAR` block.
- `content/bedgear-brand-description.mjs` now also maps 18 exact Shopify handles to current official BEDGEAR.com product pages, a concise overview, and verified key features. Each mapping retains its manufacturer source URL and an idempotent product-copy marker.
- `scripts/stage-bedgear-product-descriptions.mjs` performs bounded plan/apply/readback, requires the exact 43-product catalog and exact 20-product vendor set, backs up current descriptions, and fingerprints every non-description product/variant field before and after mutation.
- All 20 BEDGEAR descriptions are live and verified. Eighteen include exact product-level copy; the two unmatched duvet/sham products retain only the brand block. The final idempotent plan reports zero creates, zero refreshes, and 20 unchanged products.
- Actual Flex L storefront rendering verifies direct menu navigation, the Product Details accordion, Product Overview, four Key Features, the About BEDGEAR block, price, size selector, booking, Add to Cart, Ask Snoozer, media, and footer.
- Shopify currently reports all 43 products as Active. That state existed before the description write and was preserved exactly; this task did not activate or deactivate merchandise.
- Readback: `docs/catalog/BEDGEAR_PRODUCT_DESCRIPTIONS_SHOPIFY_READBACK.json`.
- Recovery backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\bedgear-product-descriptions\2026-11-03T03-14-37-785Z`.
- Navigation recovery/readback: `docs/content-pages/CONTENT_NAVIGATION_SHOPIFY_READBACK.json`, `docs/guided-shopping/GUIDED_SHOPPING_SHOPIFY_READBACK.json`, and `docs/catalog/SINGLE_PRODUCT_COLLECTION_CLEANUP_READBACK.json`. The seven old collections were unpublished, not deleted.
- Remaining content dependency: exact current manufacturer product pages for `solid-white-duvet-sham-set` and `light-grey-racetrack-duvet-sham-set`. Do not infer product claims from similarly named bedding.

## Exact next action

**OWNER-CONTENT-ROUND-1 — Ty authors and approves the four mattresses and three adjustable bases using the Shopify workflow.**

For S7, H6, M3, M5, Flex L, Flex LSX, and Flex SH, Ty fills the seven pinned `Content |` fields, uses `DRAFT` and `READY_FOR_REVIEW`, approves the exact copy, and sets `01 Content workflow` to `APPROVED`. Then re-export the feed and verify approved copy renders in the correct Product Page v1 sections. Do not use content approval to authorize M3/M5 sell units, compatibility, price, fulfillment, inventory, or publication.

## Resume rule

On resume, first recheck Git status/HEAD; read this checkpoint, `docs/product-knowledge/PRODUCT_KNOWLEDGE_ARCHITECTURE.md`, `OWNER_CONTENT_CHECKLIST.md`, and the Shopify readback; then run `node scripts/stage-product-knowledge-architecture.mjs` and `node tests/runProductKnowledgeContractTests.mjs`. Preserve all current working-tree changes, 1,280 legacy values, 83 new definitions, category assignments, workflow values, unpublished theme `139216420925`, and published theme `139460542525`. Never classify manufacturer prose as owner approved, expose non-approved content to Snoozer, infer missing compatibility, enable unresolved M3/M5 combinations, or let a cached feed override live Shopify commerce. Do not publish, deploy, commit, push, or modify AWS without explicit authority.
