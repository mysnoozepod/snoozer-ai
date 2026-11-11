# Product Page Refinement v2

Date: 2026-11-11
Store: `mysnoozepodtest.myshopify.com`
Unpublished review theme: `139216420925`
Published theme preserved: `139460542525`

## Implemented product-page contract

Mattress products assigned to `snoozepod-v1` now use a dedicated, Shopify-driven information renderer. Its approved top-level order is:

1. Product Details
2. Sleep Trial
3. Delivery
4. Warranty
5. Feel

Product Details supports Construction, Features & Benefits, Showroom Location, and Manufacturer's Model Name. Empty or unverified subsections remain hidden. The shared non-mattress renderer remains in place for adjustable bases, pillows, sheets/bedding, protection, accessories, toppers, and furniture.

The customer-facing manufacturer identity is assembled from Shopify's native `product.vendor` plus the existing `custom.model` field only inside Manufacturer's Model Name. It does not compete with the MySnoozePod title. Construction, verified features, materials, showroom representation, warranty, and approval status reuse the existing product-knowledge contract.

## Shopify fields and sources

| Information | Source | Result |
|---|---|---|
| MySnoozePod name | Shopify product title | Existing source retained |
| Manufacturer | Native `product.vendor` | Reused |
| Manufacturer model | `custom.model` | Reused |
| Manufacturer SKU | Native variant SKU | Preserved; not duplicated in theme data |
| Construction | `snoozepod_mattress.construction` and `overall_height_inches` | Reused |
| Features and materials | `snoozepod_technical.verified_features` and `materials` | Reused |
| Owner benefits | `snoozepod_content.key_benefits` gated by `custom.owner_content_status=APPROVED` | Reused; currently hidden |
| Showroom location | `custom.showroom_representation` | Reused; hidden until READY/VERIFIED with a location |
| Warranty | `snoozepod_technical.warranty_information` | Reused; product-specific terms currently empty |
| Sleep Trial | Shopify page `90-day-sleep-trial` | Reused dynamically when populated |
| Delivery | Shopify page `shipping-policy` | Reused dynamically when populated |
| Feel | `custom.feel_label` | Added as a constrained product field: Plush, Medium Plush, Medium Firm, Firm |

No metaobject was added. The normalized product-knowledge feed now exposes `feelLabel` for future retrieval while live price, availability, variants, cart, and checkout remain Shopify-authoritative.

## Verified current values

- `12" Memory Foam Mattress`: Plush
- `12" Hybrid Mattress`: Plush
- `12" Dual Comfort Mattress`: no single verified product-level Feel; independent side configuration remains a separate control
- `14" Dual Comfort Mattress`: no single verified product-level Feel; independent side configuration remains a separate control

All four titles, descriptions, main-menu labels, and media alt text use the inch-symbol convention. Canonical handles retain `-inch-` because URLs are internal routing identifiers, not displayed product names.

## Responsive refinement

- Mobile gallery items occupy one full-width swipe position and retain compact thumbnails.
- Mobile pill selectors use a two-column grid with consistent 48px minimum targets and wrapped long labels.
- Mattress accordions use tighter mobile spacing and stack definition rows for readability.
- Related products use a horizontal scroll-snap carousel on mobile while retaining the approved desktop grid.
- Desktop hero structure, native variant picker, native product form, Add to Cart, and Ask Snoozer integration are preserved.
- The lower CTA now makes Book a Snooze Session primary and Ask Snoozer secondary.

## Ty content dependencies

1. Assign verified showroom Pod/display locations for all four mattresses. Current `custom.showroom_representation` values are pending and therefore hidden.
2. Supply verified product-specific manufacturer warranty length, coverage, support/foundation requirements, and care requirements in `snoozepod_technical.warranty_information`.
3. Approve owner-authored benefits if additional customer-facing benefits should render beyond the current verified feature tags.
4. Assign a product-level Feel to either Dual Comfort mattress only if one classification accurately describes the whole product; independent left/right choices must not be collapsed into an invented single value.
5. Review the existing Sleep Trial and Delivery Shopify pages as the global policy authorities before public launch.

## Validation and safety

- Focused Product Page v2: 28 assertions passed.
- Product knowledge: 40 assertions passed.
- Product Page v1/collection contract: 67 assertions passed.
- Website experience: 44 assertions passed.
- Catalog/shopping restructure: 10/10 passed.
- Mattress naming: 18 assertion groups passed.
- Shopify readback: 43 products, 274 variants, 82 product definitions, four variant definitions, and 84 contract definitions.
- Published-theme hashes: all ten bounded product-page assets verified unchanged.
- Unpublished-theme staging: complete on theme `139216420925`.
- Browser visual QA: not executed in this session because the storefront is password-protected, the available browser was not authenticated to Shopify Admin, and no Shopify CLI session is installed. No credential was guessed or requested through automation.

Recovery snapshots:

- `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\product-knowledge-architecture\2026-11-11T15-44-23-852Z`
- `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\mattress-customer-naming\2026-11-11T15-43-24-478Z`

No theme was published. No price, inventory, fulfillment, cart, checkout, order, AWS, or Snoozer backend change occurred.
