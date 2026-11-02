# P1-005F Storefront Visual QA

Date: 2026-11-01

Store: `mysnoozepodtest.myshopify.com`

Branch/starting commit: `main` / `f5056cf9b3ee3392f0da01064f7171ea7c1ff01b`

## Review target

- Unpublished theme: `139216420925` — `snoozer-ai/main` — role `unpublished`.
- Published theme preserved: `139460542525` — `snoozer-ai/main` — role `main`.
- Preview URL: <https://mysnoozepodtest.myshopify.com/?preview_theme_id=139216420925>
- Published-theme recovery snapshot: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\theme-139460542525\2026-10-30\theme-139460542525-snoozer-ai-main-2026-10-30-1458.zip`.
- Target-theme pre-upload backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\theme-139216420925\p1-005f-2026-11-01T13-56-57-064Z`.

## Actual Shopify-rendered validation

- Homepage: desktop and 390x844 mobile layouts render the uploaded header, navigation, hero, booking/assessment routes, Ask Snoozer entry, category content, and footer.
- Navigation: desktop dropdown structure is present. The 390px mobile drawer opens, exposes all primary items, and the Mattresses nested menu opens to `Shop All Mattresses`.
- Collections: Mattresses, Adjustable Bases, Pillows, Sheets, Mattress Protectors, Comforters, Cooling & Bedding, and Bedroom Furniture all render the expected collection title, navigation shell, filter/sort controls, and deliberate `0 products` / `No products found` state. This is expected while all products remain Draft.
- Ask Snoozer: the homepage/collection entry point opens the existing header interaction and exposes the Snooze Code/check-in controls. Product and selected-variant context remain fixture/contract-tested because Draft product routes are not publicly renderable.
- Cart: the empty cart shell renders its assessment, booking, guidance, and trust components. No cart mutation was performed.
- Console: no warning or error entries were returned after the homepage, collection, cart, booking, and assessment route sweep.
- Booking/assessment blocker: `/pages/book-a-snooze-session` and `/pages/snooze-assessment` currently render the default Shopify page content instead of `page.landing-booking` and `page.landing-assessment`. The intended templates exist in theme source, but assigning a page template suffix is global Shopify resource state and would change the published storefront. That production-affecting assignment was not made in P1-005F.

## Corrections made during integration

- Added a bounded unpublished-theme staging tool with preflight, remote backup, rollback, dependency checking, content verification, and main/unpublished role rechecks.
- Corrected the `Details & specifications` section-schema label to Shopify's 25-character limit.
- Preserved the legacy homepage shelf as disabled configuration while keeping it in template order, as Shopify requires.
- Included the directly referenced booking, trust, cart guidance, sleep facts, and header/footer dependencies in the targeted upload set.
- Added a bounded collection-shell publication tool so the approved collection routes can be reviewed while every product remains Draft.
- Published all 18 collection shells to the development store's Online Store channel; no product was activated.
- Regenerated deterministic 1440px and 390px product/collection fixtures; all captures report matching client/scroll width with no horizontal overflow.

## Screenshot classification

Actual authenticated unpublished-theme captures:

- `docs/p1-005f/shopify-preview/actual-homepage-desktop.png`
- `docs/p1-005f/shopify-preview/actual-homepage-mobile.png`
- `docs/p1-005f/shopify-preview/actual-collection-desktop.png`
- `docs/p1-005f/shopify-preview/actual-collection-mobile.png`
- `docs/p1-005f/shopify-preview/actual-mobile-menu-nested.png`

Local fixture-backed Draft product captures, not Shopify-rendered product pages:

- `docs/p1-005f/shopify-preview/fixture-product-desktop.png`
- `docs/p1-005f/shopify-preview/fixture-product-mobile.png`

## Validation results

- Unpublished-theme plan: 36 unchanged assets; zero creates, updates, or missing dependencies.
- Preview collection plan: all 18 collection shells published; zero pending; 43 products remain `DRAFT`.
- Storefront/catalog plans: 43 products, 18 collections, zero pending resource changes, zero missing contract fields.
- P1-005UX theme contract: 61 assertions pass.
- P1-006A cart integrity: 21 scenarios pass; canonical builder, discovery, P1-002 contract, and legacy cart regression checks pass.
- Storefront skeleton, route, and Ask Snoozer context contracts pass.
- Malouf pillow, BEDGEAR accessory, Malouf furniture/topper, and BEDGEAR mattress manifest/readback validators pass.
- JavaScript syntax: 13 targeted files pass.
- Theme JSON parsing: 29 files pass.
- Shopify CLI and Theme Check are not installed; no CLI Liquid-validation claim is made.
- Complete-bundle Ajax Cart acceptance remains pending because no publication-ready complete bundle is available and products were not activated merely to force a test.

## Production safety

- Published theme `139460542525` remained `main` and was not modified.
- Target theme `139216420925` remained `unpublished`.
- All 43 products remain Draft; no inventory, live price, order, checkout, deployment, commit, or Git push occurred.
- Collection-shell publication enabled route review only and did not activate Draft merchandise.
