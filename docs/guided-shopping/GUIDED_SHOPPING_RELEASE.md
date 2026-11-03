# Guided Shopping Experience Release

Date: 2026-11-02  
Store: `mysnoozepodtest.myshopify.com`  
Published theme: `139460542525` (`main`)  
Development theme: `139216420925` (`unpublished`)

## Outcome

MySnoozePod now has a connected guided-shopping path across the homepage, collection pages, navigation, education, booking, Ask Snoozer, and standard Shopify product pages. The new tools help customers narrow choices and preserve a plan without inventing compatibility or bypassing Shopify's commerce authority.

The historical product-page bundle-cart Pod Builder remains inactive. `/pages/build-your-snoozepod` is a new planning-first tool that covers mattress, base, protection, pillows, and bedding while keeping every accessory optional. It makes no cart mutation.

## Live routes

- [Sleep Tools](https://mysnoozepod.com/pages/sleep-tools)
- [Build Your SnoozePod](https://mysnoozepod.com/pages/build-your-snoozepod)
- [Mattress Finder](https://mysnoozepod.com/pages/mattress-finder)
- [Compatibility Checker](https://mysnoozepod.com/pages/compatibility-checker)
- [Compare Sleep Systems](https://mysnoozepod.com/pages/compare-sleep-systems)
- [Snooze Session Planner](https://mysnoozepod.com/pages/snooze-session-planner)
- [Dual Comfort Planner](https://mysnoozepod.com/pages/dual-comfort-planner)
- [Pillow Finder](https://mysnoozepod.com/pages/pillow-finder)
- [Cooling & Bedding Finder](https://mysnoozepod.com/pages/cooling-bedding-finder)
- [Room & Delivery Planner](https://mysnoozepod.com/pages/room-delivery-planner)

The store password remains enabled. Published pages render in the authenticated storefront preview; opening the storefront remains an owner-controlled release action.

## Experience contract

- Homepage guidance appears before collection exploration and routes to the builder, mattress finder, and Snooze Session planner.
- Collection guidance appears before the native Shopify product grid and filter/sort area.
- Curated quick links use exact catalog tags without exposing internal namespaced taxonomy as a raw customer-facing filter list.
- Tools hydrate product cards from Shopify-rendered collection/product/variant data. Titles, prices, availability, handles, tags, and verified metafields remain Shopify-authoritative.
- Compatibility has three meaningful outcomes: aligned but pending product-level verification, explicit mismatch, or insufficient information. Unknown never becomes compatible.
- Plans use browser-local storage for recoverability. They do not submit an Ajax cart request.
- Book a Snooze Session and Ask Snoozer remain the primary recovery and guidance actions.
- Dual Comfort planning uses Soft, Medium Soft, Medium Firm, and Firm. It records independent preferences but does not create an unsupported sellable configuration.

## Organization and filtering

Existing product organization remains based on exact namespaced tags:

- `collection:`
- `category:`
- `subcategory:`
- `type:`
- `feature:`
- `material:`
- `comfort:`

The approved customer-facing filter contract is:

1. Size — Shopify variant option.
2. Comfort — verified `custom.comfort_feel` product metafield.
3. Construction — verified `custom.construction` product metafield.
4. Sleep Position — verified `custom.sleep_positions` product metafield.
5. Cooling — verified `custom.cooling_level` product metafield.
6. Geometry — verified `custom.geometry` product metafield.
7. Material — verified `custom.materials` product metafield.
8. Pillow Loft — verified `custom.pillow_loft` product metafield.
9. Color — Shopify variant option.
10. Availability — Shopify native variant availability.

Raw organization tags are intentionally not exposed as a global filter because doing so would surface internal labels and mix unrelated product-category values. Verified metafield population and Shopify Search & Discovery configuration are the next bounded data task.

## Navigation

- Primary menu: seven top-level destinations, 72 nested items.
- Footer: 12 items.
- `Guides & Tools` routes to the Sleep Tools hub.
- Relevant tool links also appear under Mattresses, Adjustable Bases, and Sleep Essentials.
- The complete 50-guide education library remains reachable through the Sleep Guides hub.

Exact Shopify menu readback: `../content-pages/CONTENT_NAVIGATION_SHOPIFY_READBACK.json`.

## Validation evidence

- `tests/runGuidedShoppingTests.mjs`: PASS — ten tools, shared Shopify data contract, homepage/collection routing, fail-closed compatibility, saved-plan accessibility.
- `tests/runContentNavigationTests.mjs`: PASS.
- `tests/runContentPageTests.mjs`: PASS.
- `tests/runCatalogShoppingRestructureTests.js`: 10/10 PASS.
- `tests/runP1_005UXThemeContractTests.js`: 62 assertions PASS.
- `tests/runStorefrontRouteContractTests.js`: PASS.
- `tests/runStorefrontSkeletonTests.js`: PASS.
- Live complete-system plan: Dual Comfort, King, Split Head, base, protection, pillows, and bedding produced M3/M5 suggestions, preserved pending compatibility, and confirmed no automatic cart addition.
- Live mismatch: Queen Standard mattress versus King Split Head base produced `Configuration mismatch found` and a do-not-proceed result.
- Live Dual Comfort: Soft left / Firm right / King produced `Independent comfort directions saved` with orderable mapping explicitly unverified.
- Live homepage: `Start With A Guided Tool` renders before `More Than A Mattress`.
- Live mattress collection: category navigation, guided tools, quick tag links, native filtering/sorting, and four product cards render in the intended order.
- Mobile: 390×844 rendering exposes the compact header, category navigation, builder controls, and responsive result layout.
- Browser console: zero warnings or errors during the final mobile check.
- Shopify readback: ten published tool pages and 25 verified assets on each target theme.
- Idempotent plan: ten pages unchanged and 50 cross-theme assets unchanged.

## Recovery and safety

- Guided-shopping backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\guided-shopping\2026-11-03T00-07-14-924Z`
- Navigation backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-navigation\2026-11-03T00-06-04-708Z`
- Shopify readback: `GUIDED_SHOPPING_SHOPIFY_READBACK.json`

No cart, order, product, variant, SKU, price, inventory, product status, collection rule, AWS, Calendly, storefront-password, or theme-role mutation occurred. The existing visual system, product photography, booking actions, Ask Snoozer integration, newsletter placement, and Product Page v1 purchasing flow were preserved.

## Remaining verified dependencies

- The 43 catalog products remain Draft. Authenticated previews can render them, but public commerce remains release-gated.
- M3/M5 exact size + left + right sell-unit mappings remain unverified and therefore unavailable for purchase.
- Manufacturer-level pairwise compatibility is incomplete; the tools keep those outcomes pending.
- The ten customer-facing filter dimensions still require verified product data and Search & Discovery configuration. Missing values must remain blank.
- Snoozer's backend retrieval implementation remains separately scoped; it must use Shopify-native fields, exact tags, collections, and verified metafields rather than page prose or model inference.

## Next bounded task

`GUIDED-FILTER-DATA`: populate only verified values for the ten customer-facing filter dimensions across the 43 Draft products, configure Shopify Search & Discovery without exposing raw internal tags, and validate desktop/mobile filter counts while preserving all existing commerce and publication gates.
