# Product and Collection Page v1

Status: Implemented locally; local structural and responsive validation complete; Shopify theme upload and storefront rendering not yet performed.

## Product page

`templates/product.json` and `templates/product.snoozepod-v1.json` use the reusable `snoozepod-product-hero` and `snoozepod-product-information-v1` sections. The hero retains Dawn's native gallery, selected-variant price, variant picker, product form, media modal, and structured product data. It adds the booking-first action order, contextual Ask Snoozer trigger, optional Product Feel, and optional showroom representation.

The two existing Pod Builder templates keep `snoozepod-pod-builder-hero` and the shared `snoozepod-guided-pod-builder-core`. They add the reusable information section without replacing builder discovery or P1-006A cart submission.

The information section adapts its blocks by product category and hides empty live content. Theme-editor placeholders identify missing content without presenting it to shoppers.

## Collection page

`templates/collection.snoozepod-v1.json` composes the existing collection hero, real-collection category navigation, Dawn filters/sorting/product grid, optional feel/showroom card data, and the closing booking/Ask Snoozer actions.

Shop by Category reads `collection.metafields.custom.category_navigation` when available and otherwise uses section blocks that reference real Shopify collections. It does not create placeholder routes or infer collections from text. The initial template references the existing `pillows` and `filled-pillows` handles.

## Data mapping

Native Shopify fields remain authoritative for title, vendor, type, description, media, options, variants, selected-variant price, availability, product URL, collections, and store policies.

Optional custom data used by the presentation layer:

| Field | Type | Rule |
|---|---|---|
| `custom.feel_label` | Product or variant single-line text | Descriptive, manufacturer-verified or owner-approved label. Variant value overrides product value. |
| `custom.feel_position` | Product or variant integer | Presentation position from 0 through 100. It is not a fabricated customer score. The bar renders only when this and `feel_label` are both present and approved. |
| `custom.showroom_representation` | Product JSON | Existing P1-002 contract. Renders only when readiness/status is `READY` and a customer-safe station/sample label exists. |
| `custom.category_navigation` | Collection list of collection references | Optional ordered list of real category collections for Shop by Category. |

No metafield definitions or values were created by this theme implementation.

## Snoozer context

The existing header request continues to use the established `/ask-snoozer` endpoint. Product and collection triggers now merge available Shopify product ID, product handle, currently selected variant ID, product type, collection handle, trigger source, page path, and page type into the existing frontend request context. No endpoint or AWS service was added or changed; backend use of the additional optional fields remains a separate integration concern.

## Validation

- `tests/runP1_005UXThemeContractTests.js` validates section schemas, field fail-closed behavior, product and collection composition, real draft fixture data, accessibility markers, and Pod Builder preservation.
- `tests/captureP1_005UXPreviews.js` captures deterministic 1440px and 390px previews through Chrome DevTools and fails on horizontal overflow.
- `docs/p1-005ux/previews/p1-005ux-preview.html` is a local structural review harness. It is explicitly not Shopify rendering and cannot validate live Liquid, cart, theme settings, apps, or Shopify navigation.
- Fixture product `8099363094589` and collection IDs `302090780733` / `302090813501` provide deterministic pillow examples. The wider Shopify development catalog now contains 39 Draft products and 13 collections. Missing media, feel, showroom, and approved description content remain intentionally hidden or review-only.

## Remaining acceptance

Upload to an unpublished development theme, assign the intended templates, render the real Draft product and Pillows collection in Shopify preview, and repeat desktop/mobile keyboard, variant, filter, booking, Ask Snoozer, and cart checks. Do not publish the theme or product as part of that acceptance step.
