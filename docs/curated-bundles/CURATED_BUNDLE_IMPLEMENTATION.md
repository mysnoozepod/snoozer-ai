# Curated Sleep Systems

Status: implemented, Shopify-readback-verified, and authenticated-preview-verified on unpublished theme `139216420925` on 2026-11-12. Theme publication remains separately gated.

## Storefront result

`/pages/sleep-systems` is a focused mattress-and-adjustable-base decision surface. It begins with three customer paths:

1. Standard — one mattress and one exact-size Flex L or Flex LSX base.
2. Split Head — a shared split-head mattress on the exact-size Flex SH base.
3. Split King — two actual Twin XL mattresses and two actual Twin XL Flex L or Flex LSX bases.

Split Head is the featured pathway because Pods 2 and 3 demonstrate it. Split Queen is unsupported. Bedding sets and complete-package review concepts no longer compete on this page.

Each card resolves existing Shopify component variants and uses the hardened operation-tagged, reconciled multi-line cart layer. No parent bundle product, artificial SKU, duplicated inventory, discount, promotion, or new collection was created.

## Six-Pod showroom map

| Pod | Mattress | Demonstration | Base | Comfort demonstration |
|---|---|---|---|---|
| 1 | 12-inch Memory Foam | Queen | Flex L | — |
| 2 | 12-inch Hybrid | Half-Split Queen | Flex SH | — |
| 3 | 12-inch Dual Comfort | Half-Split King | Flex SH | Soft / Firm |
| 4 | 12-inch Dual Comfort | Split King | Flex LSX | Medium Soft / Medium Firm |
| 5 | 14-inch Dual Comfort | King | Flex LSX | Soft / Firm |
| 6 | 14-inch Dual Comfort | Queen | Flex LSX | Medium Soft / Medium Firm |

The map is stored in the existing `custom.showroom_representation` JSON contract and rendered as customer-facing Pod badges/details on mattress cards and Product Page v1. Manufacturer model codes remain internal provenance and do not become customer-facing mattress names.

## Standalone mattress boundary

System-only split mattress variants are not offered in the standalone mattress picker or standalone Shop by Size routes. Direct split-variant product URLs fall back to a safe available standard variant, and a short product-page message routes split shoppers to Sleep Systems. This restriction does not remove valid split sheets, protectors, or other non-mattress products from size shopping.

## Presentation refinements

- Dual Comfort uses aligned two-column tiles for Soft, Medium Soft, Medium Firm, and Firm on both sides, with a clear selected-pair summary.
- Cotton, Dri-Tec, and Ver-Tex Sheet Set galleries lead with clean existing lifestyle photography. Text-heavy graphics remain available as secondary media; nothing was deleted.
- Mobile system paths use horizontal snap behavior while desktop preserves the three-card hierarchy.
- The page contains no internal Shopify implementation language and no unrelated bedding catalog.

## Structured data and Snoozer boundary

`CURATED_BUNDLE_MANIFEST.json` remains the deterministic component relationship record. The product-knowledge feed preserves product/variant IDs, SKUs, prices, size, geometry, compatibility, and bundle relationships for future retrieval. Live Shopify remains authoritative for price, availability, cart, and checkout. No Snoozer backend, AWS, or recommendation-engine work occurred.

## Validation evidence

- Curated bundle contract: 1,662 assertions.
- Storefront strategy contract: 23 assertions.
- Cart integrity: 21 scenarios plus legacy regression, canonical, and discovery checks.
- Storewide Shop by Size: 965 assertions; Shop by Size: 33 assertions.
- Product Page v2: 28; Product Page/collection: 69; website experience: 46; product knowledge: 43; catalog/shopping: 10/10; P1-002: 34 groups.
- JavaScript syntax checks passed.
- Authenticated preview confirmed the Split Head and Split King pathways, correct base restrictions and component quantities, structured Pod rendering, and the absence of the old bedding-set surface.
- Shopify readback confirms 43 products, 274 variants, zero products created, unpublished-theme asset match, and published theme `139460542525` unchanged.

Preview: `https://mysnoozepodtest.myshopify.com/pages/sleep-systems?preview_theme_id=139216420925`

Latest private recovery snapshot: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\curated-bundles\2026-11-12T06-25-50-566Z`

Exact next task: perform controlled development-cart acceptance for one Standard, one Split Head, and one Split King system, verifying exact variant IDs, quantities, line properties, totals, reconciliation, and selection recovery. Do not publish the theme without separate authorization.
