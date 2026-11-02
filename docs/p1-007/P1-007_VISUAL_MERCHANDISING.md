# P1-007 Visual Merchandising and Product Presentation

Date: 2026-11-01  
Store: `mysnoozepodtest.myshopify.com`  
Working branch/baseline: `main` / `f5056cf9b3ee3392f0da01064f7171ea7c1ff01b`  
Target theme: `139216420925` (`snoozer-ai/main`, unpublished)  
Published theme: `139460542525` (`snoozer-ai/main`, unchanged)

## Outcome

P1-007 is implemented to the exact-media limit of the available manufacturer sources.

- 43 Shopify products inspected; all 43 remain **Draft**.
- 38 products now have exact, manufacturer-authorized primary media.
- 147 product images are uploaded and Shopify reports every media record `READY`.
- 48 variants have exact image associations.
- All 18 collections have an image and descriptive alt text.
- The nine homepage collection cards use Shopify collection imagery, link to stable collection routes, and render responsively.
- The Mattress collection hero and nine-category navigation use the same Shopify-authoritative collection media.
- Five products remain deliberately without media because no clean exact asset could be verified. No generic image, promotional overlay, or invented substitute was used.

## Source and archive contract

BEDGEAR media came from the authenticated BEDGEAR Pattern PXM dealer library. Malouf media came from exact manufacturer product records on `maloufhome.com`. The durable selection record is `PRODUCT_MEDIA_LIBRARY.json`; source URLs, authorization, selected order, dimensions, alt text, local path, byte count, and SHA-256 are recorded per asset.

The non-public archive is:

`C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Assets\Shopify\P1-007`

Archive result: 147 files, 395,672,247 bytes, with SHA-256 recorded for every selected asset. Shopify and theme pre-mutation backups are under:

- `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\catalog-media-p1-007\`
- `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\theme-139216420925\p1-005f-2026-11-01T16-44-37-313Z\`

No credentials, customer records, or storefront password are recorded in project files.

## Coverage by merchandise family

| Family | Product media result | Variant media result |
|---|---:|---:|
| Mattresses | 4 of 4 complete | Not required by available exact media |
| Adjustable bases | Flex L and Flex LSX complete; Flex SH pending | No exact variant imagery assigned |
| Pillows | 14 of 16 complete | 6 exact pillow variant associations |
| Sheets | 3 of 3 complete | Not required by available exact media |
| Mattress protection | 3 of 3 complete | Not required by available exact media |
| Comforters | 3 of 3 complete | Not required by available exact media |
| Duvet sets | 2 of 2 complete | Not required by available exact media |
| Toppers | Malouf 2.5-inch complete; React Pro pending | No exact variant imagery assigned |
| Furniture | 4 headboards and 2 platform bases complete | 42 exact color/size associations |
| Cooling throw | Pending exact clean asset | No exact variant imagery assigned |

## Exact media gaps

| Product handle | Required evidence before upload |
|---|---|
| `flex-sh-adjustable-base` | Clean Flex SH/split-head product or lifestyle image explicitly identified by the manufacturer. Generic adjustable-base campaign imagery is insufficient. |
| `cooling-performance-throw` | Clean product or lifestyle image identified to the approved catalog item/SKU. Promotional graphics with pricing or campaign overlays are not accepted. |
| `react-pro-performance-topper` | Clean exact product image suitable for a gallery primary. Campaign graphics are not accepted. |
| `weekender-gel-memory-foam-pillow` | Exact manufacturer product media; the current exact manufacturer record contains no images. |
| `bamboo-charcoal-pillow-cooling-cover` | Authorized downloadable media for the exact Cooling Cover configuration. Press coverage alone is not image authorization. |

## Shopify and theme changes

The Shopify media operation was bounded to product media, exact variant image associations, and collection images. Product identity, handles, vendors, types, variant IDs, SKUs, selected options, prices, templates, and Draft statuses were not changed.

The only P1-007 theme presentation change is `sections/snoozepod-environment.liquid` on unpublished theme `139216420925`:

- collection imagery replaces generic placeholders when Shopify supplies it;
- images use responsive widths through 900px and `object-fit: cover`;
- Draft-only collection cards receive an explicit `/collections/{handle}` fallback when Shopify returns a blank `collection.url` in preview;
- all nine cards remain usable links.

The published theme was not edited, synchronized, or published.

### Presentation improvements

- **Homepage:** all nine shopping-category cards now show real Shopify collection photography, preserve the existing complete-sleep-system language, and route to the correct collection shells.
- **Product pages:** Product Page v1 remains the shared foundation. The Shopify galleries now receive ordered exact media for 38 products, factual alt text, and 48 exact variant-image associations. Existing gallery sizing, thumbnails, product/price hierarchy, booking, cart, Ask Snoozer, Product Feel fail-closed behavior, and mobile stacking remain covered by the 61-assertion theme contract. No unverified compatibility or content was added.
- **Collection pages:** all 18 collections have authoritative thumbnails; major collection heroes and nine-category navigation use those images with consistent cover cropping. Product-card imagery will populate from the same product media when products are deliberately activated; current empty grids remain an intentional Draft-catalog state.
- **Performance/accessibility:** homepage sources are responsive through 900px, below-the-fold collection media is lazy loaded, aspect ratios/cropping are stable, image alt text is present, and both tested widths have no horizontal overflow.

## Visual QA

Authenticated Shopify preview checks used explicit 1440×1000 and 390×844 viewport overrides. DOM readback confirmed nine collection cards, nine image URLs, stable collection hrefs, and no horizontal overflow at either width. The preview bar visibly identifies `snoozer-ai/main` as **Draft**.

Actual authenticated Shopify captures:

- `shopify-preview/homepage-desktop.jpg`
- `shopify-preview/homepage-merchandising-desktop.jpg`
- `shopify-preview/homepage-mobile.jpg`
- `shopify-preview/homepage-merchandising-mobile.jpg`
- `shopify-preview/mattresses-collection-desktop.jpg`
- `shopify-preview/mattresses-collection-mobile.jpg`

Draft products cannot render as normal product routes. Representative product-page captures under `fixture-preview/` use the exact four-image Gelled Microfiber Pillow media set and are explicitly fixture-backed theme evidence, not live Shopify product-route evidence.

## Validation

`node tests/runP1_007MediaTests.js` passes 19 assertion groups covering:

- exact catalog/media counts;
- the five fail-closed gaps;
- source, resolution, alt text, byte, SHA-256, and archive fields;
- local archive presence and recorded file sizes;
- 48 variant-media associations;
- Shopify readback: 43 Draft products, 147 `READY` media records, 274 variants, 48 variant images, and 18 collection images;
- preserved product/variant commerce identity;
- homepage imagery and route contract;
- desktop/mobile authenticated screenshots and exact-media product-fixture evidence.

Existing storefront, Pod Builder, and merchandising regressions are recorded in `HANDOFF.md`. The fresh headless screenshot helper cannot enter this password-protected store without an authenticated preview session; actual screenshots were therefore captured from the existing authenticated development browser. This is a capture-environment limitation, not a storefront failure.

## Publication boundary and remaining decisions

The visual-media pass does not authorize product publication. Prices, availability, fulfillment, compatibility, warranty/returns, physical showroom representation, M3/M5 complete configurations, and Ty-owned customer copy remain separate publication gates.

The exact next task is a five-product manufacturer-media acquisition pass. Obtain and approve only the five exact missing asset sets above, add them through the existing idempotent media manifest/staging path, rerun the 19-group media validator and authenticated preview checks, and stop. Do not activate products, publish a theme, or change commercial fields as part of that task.
