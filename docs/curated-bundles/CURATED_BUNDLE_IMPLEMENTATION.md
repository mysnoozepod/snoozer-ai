# Sleep Systems and Curated Bundles

Status: implemented and staged on unpublished theme `139216420925`; owner content/assortment review and mattress-to-base compatibility verification remain required.

## Storefront result

- `/pages/sleep-systems` presents three bounded categories: Sleep Systems, Bedding Sets, and Complete Sleep Packages.
- Five bedding sets are configurable and shoppable. They use only existing available variants whose normalized size and sleep geometry align.
- Four mattress/base system candidates and two complete-package candidates are visible for review but cannot be purchased. Matching size and geometry are treated only as candidate filters, never as mechanical compatibility proof.
- Main navigation includes Sleep Systems with direct anchors to all three page groups.
- Desktop and 390×844 responsive rendering passed on the existing password-protected development preview.

## Bundle architecture

No parent bundle product, artificial SKU, discount, promotion, new collection, or duplicated inventory was created. A curated set submits its real component variants as one multi-item Shopify Ajax Cart operation. Each component remains a separate cart/order line with its native variant ID, SKU, price, availability check, and fulfillment identity.

The curated UI reuses the existing operation-tagged cart integrity layer in `assets/snoozepod-pod-builder.js`: live product readiness checks, pre/post cart snapshots, deterministic line identity, duplicate-submission protection, partial-result detection, and fail-closed ambiguous-response behavior.

## Curated assortment

| Category | Curated record | Storefront state | Actual shared size destinations |
|---|---|---|---|
| Bedding Set | Dri-Tec Bedding + Protection Set | Staged purchasable | Queen, King, California King, Twin, Twin XL, Full, Split Head Queen, Split Head King, Split Head California King, Split King, Split California King |
| Bedding Set | Ver-Tex Bedding + Protection Set | Staged purchasable | Queen, King, California King, Split Head Queen, Split Head King, Split Head California King, Split King, Split California King |
| Bedding Set | Cotton + Light Weight Bedding Set | Staged purchasable | Queen, King, California King, Full |
| Bedding Set | Dri-Tec + Medium Weight Bedding Set | Staged purchasable | Queen, King, California King, Full |
| Bedding Set | Ver-Tex + Light Weight Bedding Set | Staged purchasable | Queen, King, California King |
| Sleep System | 12-inch Memory Foam + Flex L | Blocked pending compatibility | Queen, King, California King, Twin XL candidates |
| Sleep System | 12-inch Hybrid + Flex LSX | Blocked pending compatibility | Queen, King, California King, Twin XL candidates |
| Sleep System | 12-inch Dual Comfort + Flex SH | Blocked pending compatibility | Split Head Queen, Split Head King, Split Head California King candidates |
| Sleep System | 14-inch Dual Comfort + Flex LSX | Blocked pending compatibility | Queen, King, California King, Twin XL, Split California King candidates |
| Complete Package | Queen Complete Sleep Package | Blocked pending compatibility | Queen, King, California King, Twin XL candidates |
| Complete Package | Split Head Queen Complete Sleep Package | Blocked pending compatibility | Split Head Queen, Split Head King, Split Head California King candidates |

Candidate sizes are not compatibility claims. The record names and customer-facing language are `READY_FOR_REVIEW`, not owner-approved final copy.

## Structured data

`CURATED_BUNDLE_MANIFEST.json` is the deterministic source artifact. It records bundle ID/category/status, curation basis, component product IDs/handles/quantities, exact variant IDs/SKUs/prices/options, shared size/geometry records, price ranges, verified attributes, and the pending showroom relationship.

The product-knowledge feed and schema now expose the bounded bundle relationships for future Snoozer retrieval. Live Shopify remains authoritative for current price, availability, cart, and checkout. No Snoozer backend, AWS, API, or recommendation-engine change occurred.

## Validation evidence

- Curated contract: 1,564 assertions.
- Cart-integrity regression: 21 scenarios plus the legacy cart-integrity suite.
- Canonical Pod Builder, P1-002 fixture, product knowledge, Storewide Shop by Size, Shop by Size, Product Page v2, catalog/shopping, guided shopping, website experience, and route tests passed.
- Actual preview cart: existing cart count increased from six to eight. Queen Ver-Tex Sheet Set at `$299.99` and Full/Queen Light Weight Comforter at `$199.99` appeared as separate lines with `Curated Set`, `Set Component`, and `Set Size` properties. Total was `$499.98`. No checkout or order was created.
- Shopify readback confirms 43 products, 274 variants, zero products created, unpublished-theme asset match, and published theme `139460542525` unchanged.

## Remaining owner/manufacturer decisions

1. Approve or revise the five bedding-set names, composition, and minimal customer wording.
2. Provide explicit pairwise mattress/base compatibility evidence, including size and geometry restrictions, before any Sleep System or Complete Sleep Package becomes purchasable.
3. Confirm showroom relationships for curated components if they should be presented to Snoozer or customers.

Exact next task: verify and encode approved pairwise mattress/base compatibility records, then enable only the proven Sleep System configurations and rerun the same cart acceptance. Theme publication remains separately gated.
