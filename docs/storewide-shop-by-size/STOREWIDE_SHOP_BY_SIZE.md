# Storewide Shop by Size

Status: implemented and verified on the existing Shopify development store and unpublished theme `139216420925`; strategy boundary updated and preview-verified on 2026-11-12.

## Authority and derivation

The source is the current Shopify catalog: 43 products and 274 variants. Collection membership is generated only from variants where `availableForSale` is true and a native `Size` option exists. Product, variant, SKU, price, availability, media, and product status are unchanged.

Derived product tags:

- `shop-by-size:true` marks products with at least one meaningful available size.
- `shop-size:<normalized-slug>` marks each shopping size supported by an available variant.
- Existing collection and product taxonomy tags remain intact.

Deterministic normalization does not change native Shopify options. `Cal King` is displayed as `California King`; `(2pc)` is removed from the shopping label; compound values such as `Full/Queen` support both exact destinations; `Twin XL x 2` remains distinct. `One Size` is excluded because it does not narrow a shopping result.

## Supported categories and actual sizes

| Category | Actual Shop by Size destinations |
|---|---|
| Mattresses | Twin; Twin XL; Full; Queen; King; California King. Split-head and Split King mattress variants are reserved for Sleep Systems. |
| Adjustable Bases | Twin XL; Queen; King; California King; Split Head Queen; Split Head King; Split Head California King; Split California King |
| Sheets | Twin; Twin XL; Full; Queen; King; California King; Texas King; Split Head Queen; Split Head King; Split Head California King; Split King; Split California King |
| Comforters & Duvets | Full; Queen; King; California King |
| Cooling & Bedding | Queen |
| Mattress Protectors | Twin; Twin XL; Full; Full XL; Queen; King; California King; Split Head Queen; Split Head King; Split Head California King; Split King; Split California King |
| Pillows | Standard; Queen; King |
| Mattress Toppers | Twin; Twin XL; Full; Queen; King; California King |
| Bedroom Furniture | Queen; King; California King |

The updated generated contract contains one master collection, 14 storewide size collections, and 55 category-size collections: 70 managed automated collections total. Eighteen non-shopping/system-only records are explicitly excluded: One Size plus 17 split mattress geometry entries. The durable handle pattern is:

- `/collections/shop-by-size`
- `/collections/shop-by-size-<size>`
- `/collections/<category>-size-<size>`

## Storefront behavior

The main menu contains Shop by Size after Mattresses, with direct links for Twin, Twin XL, Full, Queen, King, and California King. The master page exposes all 15 actual destinations. Canonical category collections expose only that category's supported sizes.

On a size collection, each product card resolves the matching available Shopify variant, shows its exact variant price, and deep-links to the product with both `variant=<id>` and the normalized `size` context. Native collection filters and sorting remain available. Product Page v2 and the standard Shopify product form remain authoritative for selection and cart submission. The concise size heading and products render first, Shop by Category follows, and unfinished Find Your Fit content is absent.

## Snoozer-ready contract

The product-knowledge feed retains product and variant IDs, SKU, price, native options, Feel, geometry, compatibility, and showroom fields. `shopSizeKeys` is a deterministic derived array beside `standardizedSize`; it is not a Shopify metafield. Live Shopify remains authoritative for price, availability, cart, and checkout. Unknown compatibility remains unknown.

## Validation evidence

- `STOREWIDE_SIZE_COLLECTIONS_MANIFEST.json`: deterministic expected tags, memberships, rules, handles, and exclusions.
- `SHOPIFY_READBACK.json`: final Shopify product-status, collection, navigation, theme, and backup evidence.
- `tests/runStorewideShopBySizeTests.mjs`: 965 catalog-derived assertions.
- `tests/runShopBySizeTests.js`: 33 storefront and feed assertions.
- Actual preview: Queen returned 41 products and exact per-card Queen prices; the Queen memory-foam deep link selected variant `44128361971773` at `$1,599.99`; Add to Cart confirmed `Size: Queen`.
- Actual category-specific preview: Split Head King Adjustable Bases returned only Flex SH at `$2,799.00`.
- Desktop and responsive 390×844 inspection preserved the existing design and fit the generated controls.
- Published theme `139460542525` remained unchanged. No checkout or order was submitted.

Preview: `https://mysnoozepodtest.myshopify.com/collections/shop-by-size?preview_theme_id=139216420925`

Private recovery snapshot: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\storewide-shop-by-size\2026-11-12T06-11-08-630Z`
