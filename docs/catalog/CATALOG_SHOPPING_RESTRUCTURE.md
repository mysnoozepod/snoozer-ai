# Catalog & Shopping Experience Restructure

Date: 2026-11-01  
Store: `mysnoozepodtest.myshopify.com`  
Unpublished theme: `139216420925` (`snoozer-ai/main`)  
Published theme preserved: `139460542525` (`main`)

## Result

The development catalog now contains 43 tagged Draft products, 274 preserved variants, and 25 automated collections. The 18 existing collection handles were preserved while their manual collections were replaced by exact-tag automated collections; seven model/family routes were added. All 43 products use Product Page v1 (`snoozepod-v1`). No product was activated, no order was submitted, and no theme was published.

The Pod Builder is absent from the active homepage and every assigned product template. Standard Shopify variant/form behavior is restored for products with valid native variants. Historical builder source remains unassigned in the working tree for audit/rollback continuity and is not customer-facing.

M3 and M5 now render independent Left Side Comfort and Right Side Comfort controls for `0.0`, `1.0`, `2.0`, and `3.0`. The selected values are attached to the Shopify product form as line-item properties and summarized accessibly. An exact variant is orderable only when its size and verified `custom.left_comfort` / `custom.right_comfort` variant metafields match the selected combination. The current products have zero such verified mappings, so Add to Cart correctly fails closed.

## Tag taxonomy

| Namespace | Purpose | Example |
|---|---|---|
| `category:` | Top-level department | `category:mattresses` |
| `subcategory:` | Customer-facing subgroup or family | `subcategory:m3` |
| `type:` | Normalized Shopify product type | `type:mattress` |
| `collection:` | Exact automated collection membership driver | `collection:mattresses` |
| `comfort:` | Verified feel/temperature/construction characteristic | `comfort:dual-comfort` |
| `material:` | Verified named material | `material:talalay-latex` |
| `feature:` | Verified construction or functional feature | `feature:split-head` |

Every automated collection has one rule: `TAG EQUALS collection:<handle>`. All 43 products have at least one category, subcategory, type, and collection tag. The final contract averages 7.42 tags per product. Complete product-level coverage is in `CATALOG_SHOPPING_RESTRUCTURE_MANIFEST.json`; live readback is in `catalog-shopping-restructure-shopify-readback.json`.

## Automated collections and routes

| Group | Handles / URLs | Members |
|---|---|---:|
| Mattresses | `/collections/mattresses`, `/collections/s7`, `/collections/h6`, `/collections/m3`, `/collections/m5` | 4 / 1 each |
| Adjustable bases | `/collections/adjustable-bases`, `/collections/flex-l`, `/collections/flex-lsx`, `/collections/flex-sh` | 3 / 1 each |
| Pillows | `/collections/pillows`, `/collections/zoned-pillows`, `/collections/filled-pillows`, `/collections/foam-pillows`, `/collections/temperature-regulating-pillows` | 16 / 4 each |
| Bedding | `/collections/bedding`, `/collections/sheets`, `/collections/sheet-sets`, `/collections/mattress-protectors`, `/collections/comforters`, `/collections/cooling-bedding`, `/collections/mattress-toppers` | 14 / 3 / 3 / 3 / 3 / 3 / 2 |
| Furniture | `/collections/bedroom-furniture`, `/collections/furniture`, `/collections/headboards`, `/collections/platform-bases` | 6 / 6 / 4 / 2 |

All 25 collection shells are available to the development Online Store channel. Their product grids intentionally show zero products in storefront preview because all products remain Draft. Admin API readback confirms the correct underlying automated membership.

The main menu retains the existing hierarchy and adds S7/H6/M3/M5 under Mattresses plus Flex L/Flex LSX/Flex SH under Adjustable Bases. Every parent and leaf collection has a `custom.category_navigation` mapping to the relevant sibling family. Authenticated preview verified the homepage, expanded mattress menu, `/collections/mattresses`, and `/collections/m3`.

## Theme and shopping behavior

- Product Page v1 retains the gallery, title, Shopify price, size/configuration picker, fail-closed Product Feel, Book a Snooze Session, standard Add to Cart, Ask Snoozer, showroom field, and product information.
- Homepage Pod Builder copy/section was replaced by the existing Collection CTA visual pattern. Header, footer, booking CTAs, Ask Snoozer, photography, and collection presentation were preserved.
- The standard-product fixture submitted native variant `7001` successfully.
- The unsupported M3/M5 fixture retained selections and blocked submission.
- A synthetic verified mapping resolved variant `9001`, retained Left `0.0` / Right `3.0`, and submitted both line properties.
- Desktop and 390px fixture renders have no horizontal overflow.

Actual Draft-product acceptance is also complete. Shopify Admin GraphQL `onlineStorePreviewUrl` supplies a temporary Draft-product preview key; combining that key with unpublished theme `139216420925` renders the real product, real variants, real media, and assigned `snoozepod-v1` template without publishing the product. Direct browser inspection verified S7, H6, M3, and M5 on November 2, 2026. S7/H6 expose native size selection and Add to Cart. M3/M5 expose the real independent Left/Right comfort controls and correctly remain unavailable because no approved sell-unit mapping exists.

Fixture screenshots:

- `fixture-preview/standard-product-desktop.png`
- `fixture-preview/dual-comfort-desktop.png`
- `fixture-preview/dual-comfort-mobile.png`
- `fixture-preview/dual-comfort-mobile-controls.png`

Actual unpublished-theme preview:

`https://mysnoozepodtest.myshopify.com/?preview_theme_id=139216420925`

All 43 actual Draft product pages are available through a private, refreshable preview index:

`C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\draft-product-previews\latest\index.html`

Refresh command: `node scripts/generate-draft-product-preview-index.mjs`. The index is intentionally outside the repository because Shopify preview tokens are temporary and must not be committed or placed in public documentation.

## Safety and recovery

The first pre-mutation catalog snapshot is:

`C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\catalog-shopping-restructure\2026-11-02T02-22-44-076Z`

The final theme backup preceding the last homepage correction is:

`C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\theme-139216420925\catalog-shopping-restructure-2026-11-02T02-30-30-173Z`

No credentials or customer records are stored in either backup. The staging scripts enforce the store, API version, exact theme IDs/roles, Draft boundary, immutable product/variant/media identity, targeted collection IDs, readback, and idempotent no-change plans.

## Validation

- Catalog/shopping restructure: 10/10 assertion groups.
- Fixture shopping flow: standard success, unsupported fail-closed, verified mapped success.
- Product Page v1 theme contract: 61 assertions.
- P1-007 media: 19 assertion groups.
- Storefront skeleton and route contracts: pass.
- Ask Snoozer context: pass.
- Dormant builder regressions: 34 contract groups, 21 cart-integrity scenarios, and canonical suite pass.
- JavaScript syntax: pass for all new/modified scripts.
- Targeted `git diff --check`: pass.
- Final Shopify catalog plan: zero product updates, zero collection creates, zero swaps.
- Final theme plan: 37 unchanged assets, zero creates/updates, published theme unchanged.

Shopify CLI/theme-check is not installed. Full-worktree `git diff --check` still reports pre-existing whitespace findings in `sections/header.liquid` and `sections/main-collection-product-grid.liquid`; the task edit set passes.

## Remaining verified dependency

BEDGEAR/Ty must provide the complete sell-unit identity and orderable mapping for each supported M3/M5 size plus every allowed Left/Right comfort combination, including fulfillment component quantities. Until that source is verified and represented by actual Shopify variants with `custom.left_comfort` and `custom.right_comfort`, M3/M5 Add to Cart remains intentionally unavailable. Live prices, availability, warranty/returns content, and publication approval remain separate release gates.

## Exact next task

**M3/M5-SELLABLE-MAPPING — verify and stage the authoritative Dual Comfort sell-unit map.** Obtain the approved size + left comfort + right comfort combinations and complete sell-unit/fulfillment identifiers from BEDGEAR/Ty; create or update only the required Draft Shopify variants; populate the two mapping metafields; rerun the exact-mapping, cart-property, duplicate-combination, unsupported-combination, and fixture/storefront tests; keep unsupported combinations disabled and do not publish products or a theme.
