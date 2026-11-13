# Curated Sleep Systems

Status: implemented on published theme `139216420925`; the 2026-11-12 configurator correction is Shopify-readback-verified and locally browser-interaction-verified.

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

The map is stored in the existing `custom.showroom_representation` JSON contract. Customer-facing mattress cards and Product Page v1 render only the concise Pod label; size, base, and comfort demonstration details remain internal structured data. Manufacturer model codes remain internal provenance and do not become customer-facing mattress names.

## Standalone mattress boundary

System-only split mattress variants are not offered in the standalone mattress picker or standalone Shop by Size routes. Direct split-variant product URLs fall back to a safe available standard variant, and a short product-page message routes split shoppers to Sleep Systems. This restriction does not remove valid split sheets, protectors, or other non-mattress products from size shopping.

## Presentation refinements

- Dual Comfort systems expose independent premium Soft, Medium Soft, Medium Firm, and Firm buttons for both sides, with explicit `aria-pressed` state and an accessible selected-pair summary. Add to Cart remains disabled until both sides are selected; the mattress cart line receives the exact left/right values.
- Size and base also use visible stateful buttons. Standard and Split King expose their actual Flex L and Flex LSX choices. Split Head alone is constrained to Flex SH.
- Cotton, Dri-Tec, and Ver-Tex Sheet Set galleries lead with clean existing lifestyle photography. Text-heavy graphics remain available as secondary media; nothing was deleted.
- Mobile system paths use horizontal snap behavior while desktop preserves the three-card hierarchy.
- The page contains no internal Shopify implementation language and no unrelated bedding catalog.

## Structured data and Snoozer boundary

`CURATED_BUNDLE_MANIFEST.json` remains the deterministic component relationship record. The product-knowledge feed preserves product/variant IDs, SKUs, prices, size, geometry, compatibility, and bundle relationships for future retrieval. Live Shopify remains authoritative for price, availability, cart, and checkout. No Snoozer backend, AWS, or recommendation-engine work occurred.

## Validation evidence

- Curated bundle contract: 1,680 assertions.
- Storefront strategy contract: 25 assertions.
- Cart integrity: 21 scenarios plus legacy regression, canonical, and discovery checks.
- Storewide Shop by Size: 965 assertions; Shop by Size: 33 assertions.
- Product Page v2: 28; Product Page/collection: 69; website experience: 46; product knowledge: 43; catalog/shopping: 10/10; P1-002: 34 groups.
- JavaScript syntax checks passed.
- The focused headless browser fixture uses real button clicks and confirms changeable size/base controls, Flex L/Flex LSX availability for Standard and Split King, Flex SH-only Split Head behavior, concise Pod labels, and independent Dual Comfort selections. Actual live clicks confirmed the same behavior on all three system pathways.
- Shopify readback confirms the four bounded source assets match published theme `139216420925`; rollback theme `139460542525` is unchanged and no catalog mutation occurred.

Live route: `https://mysnoozepod.com/pages/sleep-systems`

Latest private recovery snapshot: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\sleep-system-configurator-fix\2026-11-13T02-13-39-448Z`

Exact next task: perform controlled live-cart acceptance for one Standard, one Dual Comfort, one Split Head, and one Split King system, verifying exact variant IDs, quantities, comfort properties, totals, reconciliation, and selection recovery without submitting checkout or an order.
