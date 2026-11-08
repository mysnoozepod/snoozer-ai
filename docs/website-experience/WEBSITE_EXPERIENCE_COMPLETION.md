# MySnoozePod Website Experience Completion

Date: 2026-11-06

Store: `mysnoozepodtest.myshopify.com`

Unpublished review theme: `139216420925` (`snoozer-ai/main`)

Published theme preserved: `139460542525` (`snoozer-ai/main`)

Preview: <https://mysnoozepodtest.myshopify.com/?preview_theme_id=139216420925>

## Executive result

The existing storefront now presents Book a Snooze Session as the primary conversion while retaining conventional Shopify shopping, Ask Snoozer, optional assessments, and guided tools. Ten bounded theme assets were staged only to the existing unpublished theme and read back successfully. The corresponding ten published-theme assets were hash-verified unchanged.

Existing catalog status, product identity, variants, SKUs, prices, images, tags, collection rules, navigation resources, Calendly configuration, AWS, checkout settings, payments, tax, shipping, fulfillment, theme roles, and storefront password were not changed. A Warranty Support page structure was added without inventing coverage terms.

## 1. Homepage

- Booking is the hero's primary action; Explore Mattresses is secondary.
- The private Snooze Session explanation follows the hero.
- A new editor-managed four-product showcase links directly to the real S7, H6, M3, and M5 products.
- Complete sleep-system categories, Meet Snoozer, optional Sleep Tools, and a final booking invitation follow in that order.
- The disabled legacy hardcoded mattress shelf remains traceable but does not render.

Validation: desktop and 390px authenticated preview, direct route inspection, no document overflow.

## 2. Header and navigation

- A prominent Book a Snooze Session link is present on desktop and mobile.
- Ask Snoozer, account, cart, Snooze Code, and Check In remain available.
- Mobile Guest Check In is directly accessible through a compact disclosure.
- At phone widths, the redundant horizontal category strip is hidden; the full category hierarchy remains in the hamburger menu.
- Direct product and collection destinations were preserved.

Validation: desktop/mobile rendering, Ask Snoozer panel open, mobile Guest Check In field/button, route contracts.

## 3. Collections

- Collection Page v1 now follows: hero, subcategory navigation, filters/product grid, optional guided tools, closing booking action.
- Native filtering, sorting, two-column mobile grid, collection imagery, and direct product-card navigation remain intact.
- Actual `/collections/mattresses` rendering showed S7, H6, M3, and M5 before guided tools.

Validation: actual authenticated collection preview plus collection/theme contract suites.

## 4. Products

- Product Page v1 retains gallery, title, variant-aware price, size/configuration picker, booking, standard Add to Cart, Ask Snoozer, details, delivery/returns, and related Shopify recommendations.
- Actual S7 Twin selection added the exact variant to the cart.
- M3/M5 retain independent left/right `0.0`–`3.0` controls and fail closed without an exact verified sell-unit mapping.
- Actual M3 Left `0.0` / Right `3.0` selection updated the summary while the purchase action remained unavailable.
- The retired bundle-cart Pod Builder remains absent from active customer templates.

Validation: actual S7/M3 preview, standard cart mutation, fail-closed Dual Comfort check, fixture/regression suites.

## 5. Booking, assessment, showroom, and tools

- Shopify readback confirms `book-a-snooze-session` uses `landing-booking` and `snooze-assessment` uses `landing-assessment`.
- Direct Calendly booking renders before the explicitly optional mini assessment.
- Neither an assessment nor an account is required to schedule.
- Both Calendly widgets loaded in the authenticated preview.
- The existing showroom page, Sleep Tools hub, and nine focused tools remain available; the tool inventory was not expanded.
- Homepage/collection tool promotion is subordinate to booking and merchandise discovery.

Validation: homepage-to-booking navigation, both embedded Calendly surfaces, Sleep Tools mobile rendering.

## 6. Cart

- Standard Shopify cart item, size, quantity controls, removal route, price, subtotal, guidance, and checkout transition remain intact.
- One S7 Twin was added to the isolated preview browser cart. Cart title, variant, quantity, and `$1,249.99` price/total agreed with the product selection.
- No obsolete bundle-purchasing language appears in the active cart template.
- No item was removed and no order was submitted.

Validation: actual cart behavior plus cart-integrity regression.

## 7. Checkout

- Native Shopify checkout opened from the actual preview cart.
- The sharp MySnoozePod logo, contact/delivery layout, S7 Twin order summary, subtotal, total, and responsive mobile layout rendered correctly.
- No customer information was entered and no checkout was completed.
- Payment, tax, shipping, delivery, fulfillment, notification, and policy configuration were not changed and remain a launch-operations gate.

## 8. Policies and footer

- A structured footer now groups Shop, Visit & Guidance, and Customer Support above Stay In The Loop.
- Booking, showroom, assessment, tools, guides, contact/order support, shipping, returns, warranty, FAQ, privacy, and terms destinations are connected.
- `/pages/warranty-support` is published with conservative process guidance only. It does not invent product coverage, exclusions, or service promises.
- Owner-approved commercial policy language remains required before launch.

Validation: Admin page readback, actual warranty route, footer order and route assertions.

## 9. Mobile

- Authenticated checks covered homepage, booking/Calendly, collection, S7/M3 product pages, Dual Comfort, tools, cart, and native checkout at the 390px acceptance breakpoint.
- No document-level horizontal overflow was observed.
- Touch targets, mobile booking access, gallery/product controls, footer columns, cart, and checkout remained usable.
- Saved screenshots use the actual unpublished Shopify theme, not fixtures.

## Screenshots

- `screenshots/home-desktop.png`
- `screenshots/booking-desktop.png`
- `screenshots/home-mobile.png`
- `screenshots/m3-dual-comfort-mobile.png`
- `screenshots/cart-mobile.png`
- `screenshots/checkout-mobile.png`

## Automated validation

- Website experience completion: 35 assertions passed.
- Catalog and shopping restructure: 10/10 assertion groups passed.
- Guided shopping regression passed with the new merchandise-first placement.
- Product Page v1: 62 assertions passed.
- Cart integrity regression passed.
- P1-002 contract fixture: 34 assertion groups passed.
- P1-007 media contract: 19 assertion groups passed.
- Storefront route and storefront skeleton suites passed.
- Staging/test JavaScript syntax and targeted `git diff --check` passed.
- Final Shopify plan is idempotent: 10/10 target-theme assets unchanged; both page template suffixes unchanged; Warranty Support unchanged.

## Remaining owner/operations decisions

1. Final copy and imagery approval for the booking-first homepage, booking hero, product card summaries, and support language.
2. Exact M3/M5 size + left + right sell-unit/fulfillment mappings; unsupported combinations must remain unavailable.
3. Current payment, tax, shipping-zone/rate, delivery/assembly, fulfillment, notification, and test-order configuration.
4. Final shipping, returns, warranty-responsibility, service-area, lead-time, financing, and order-support policy language.
5. Existing catalog publication/status review and final theme publication timing.
6. Five previously recorded exact-media gaps and the two unmatched BEDGEAR duvet/sham product-copy sources.
7. Customer-chat ownership, analytics/pixel ownership, consent requirements, and a dedicated automated accessibility scan.

## Recommended next task

**Launch Configuration & Controlled Test Order** — after Ty approves the remaining commercial settings, inspect and configure only the authorized payment/tax/shipping/fulfillment/policy fields, execute one controlled test order through the current unpublished-theme journey, verify notifications and operational handoff, clean up test data, and record rollback evidence. Theme publication remains a separate explicit owner action.
