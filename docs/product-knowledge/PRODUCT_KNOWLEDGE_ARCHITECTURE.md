# MySnoozePod Product Knowledge Architecture

Date: 2026-11-07

Schema: `1.0.0`

Store: `mysnoozepodtest.myshopify.com`

Unpublished review theme: `139216420925`

Preview: <https://mysnoozepodtest.myshopify.com/?preview_theme_id=139216420925>

## Outcome

Shopify now contains one reusable product-knowledge contract across all 43 existing products and 274 variants. Ty can edit the owner-authored content directly in Shopify, move it through a four-state review workflow, and make approved content render through Product Page v1 without code changes. A versioned normalized feed and JSON Schema are ready for a future Snoozer integration; no Snoozer backend, AWS service, duplicate product database, product identity, price, inventory, or publication setting was changed.

The live catalog contained 43 **Active** products when this work began, not Draft products. That pre-existing state was preserved exactly. This task did not activate or deactivate anything.

## Audit and reconciliation

The pre-implementation audit recorded:

- 43 Shopify products and 274 variants.
- 1,280 existing `custom` metafield values: 184 product values and 1,096 variant values.
- Existing product fields: assortment status, publication readiness, builder roles, owner content status, model/configuration data, and showroom representation.
- Existing variant fields: geometry, price verification status, fulfillment readiness, and compatibility key.
- Two Shopify taxonomy definitions, zero custom variant definitions, and three Shopify-provided metaobject definitions.

All 1,280 values were preserved. The legacy owner status `PENDING` had one unambiguous workflow meaning and was migrated to `NOT_STARTED`. Existing manufacturer descriptions were not copied into owner-authored fields and were not classified as Ty-approved content.

Durable evidence:

- `PRODUCT_KNOWLEDGE_INVENTORY.json` — pre-implementation audit.
- `PRODUCT_KNOWLEDGE_SHOPIFY_READBACK.json` — post-implementation live readback.
- Private recovery snapshots: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\product-knowledge-architecture`.

## Universal contract

Native Shopify fields remain authoritative for title, handle, vendor, product type/category, product/variant IDs, SKUs, options, prices, inventory, availability, media, collections, and publication state.

The pinned product editing surface is:

| Field group | Purpose |
|---|---|
| `custom.owner_content_status` | `NOT_STARTED`, `DRAFT`, `READY_FOR_REVIEW`, or `APPROVED` |
| `custom.product_contract` | One of the eight category contracts |
| `custom.product_knowledge_schema_version` | Current schema, `1.0.0` |
| `custom.technical_content_status` | `PENDING`, `PARTIAL`, or `VERIFIED` |
| `custom.technical_source` | Machine-readable technical provenance |
| `custom.assortment_status` | Preserved assortment decision |
| `custom.publication_readiness` | Preserved independent launch gate |
| `snoozepod_content.product_introduction` | Rich Ty-authored opening copy |
| `snoozepod_content.product_summary` | Concise reusable summary |
| `snoozepod_content.key_benefits` | Customer-facing benefit list |
| `snoozepod_content.what_makes_different` | Meaningful differentiation |
| `snoozepod_content.why_selected` | MySnoozePod assortment rationale |
| `snoozepod_content.customer_considerations` | Limitations and tradeoffs |
| `snoozepod_content.snooze_session_focus` | What to compare during a session |

Common technical fields live under `snoozepod_technical`: materials, verified features, supported configurations, compatibility information, care instructions, and verified warranty information.

The canonical field definitions, data types, validation choices, descriptions, and pin choices live in `content/product-knowledge-contract.mjs`. Shopify readback confirms 79 product definitions and four variant definitions created by this work, in addition to the two Shopify taxonomy definitions.

## Category contracts

| Contract | Products | Dedicated namespace | Organized fields |
|---|---:|---|---|
| Mattress | 4 | `snoozepod_mattress` | Construction, height, comfort/support, cooling, geometry, adjustable-base compatibility, Dual Comfort, verified combinations, purchasable mappings |
| Adjustable base | 3 | `snoozepod_base` | Motion/features, controls, physical specifications, split geometry, assembly, mattress compatibility, furniture compatibility, showroom experience |
| Pillow | 16 | `snoozepod_pillow` | Comfort profile, loft, sleep position, fill, cover, cooling/temperature, dimensions, preference guidance |
| Sheets and bedding | 3 | `snoozepod_bedding` | Fabric/construction, feel/breathability, fit, colors, included components, material experience |
| Mattress protection | 3 | `snoozepod_protection` | Protection/coverage, breathability/cooling, mattress fit, split geometry |
| Comforters, duvets, accessories | 6 | `snoozepod_accessory` | Subtype, materials/fill, warmth, cooling/breathability, dimensions/contents |
| Mattress topper | 2 | `snoozepod_topper` | Thickness, material/feel, support/pressure relief, cooling, compatibility, comfort experience |
| Bedroom furniture | 6 | `snoozepod_furniture` | Type, materials, finishes, dimensions/sizes, assembly/installation, base compatibility, appearance/function, room considerations |

Shopify does not conditionally hide custom product definitions by product type. The closest maintainable native experience is therefore:

1. Pin the universal workflow and Ty-authored content fields on every product.
2. Prefix category fields clearly (`Pillow |`, `Mattress |`, and so on).
3. Store `custom.product_contract` on every product so both Liquid and API consumers select only the relevant category fields.
4. Leave irrelevant category fields empty; the storefront never renders them.

No new custom metaobject was added. Direct typed product metafields are easier for Ty to maintain and avoid a second click into a separate metaobject record. Existing Shopify taxonomy metaobjects remain untouched.

## Owner workflow

1. Open the product in Shopify and choose **View all** under Product metafields.
2. Keep `01 Content workflow` at `NOT_STARTED` while gathering material.
3. Enter owner content in the seven pinned `Content |` fields and change the workflow to `DRAFT`.
4. When ready for Ty's final pass, set it to `READY_FOR_REVIEW`.
5. After Ty approves the exact copy, set it to `APPROVED` and save.

Only `APPROVED` owner content renders on the storefront and enters the normalized feed. Draft and review content stays editable in Shopify but remains excluded. Technical facts use the independent technical status and provenance fields.

## Product Page v1 rendering

`snippets/snoozepod-product-knowledge.liquid` is called by `sections/snoozepod-product-information-v1.liquid`.

The renderer:

- Shows approved owner content under Product Overview.
- Selects the correct category section from `custom.product_contract`.
- Renders only populated technical fields.
- Uses Shopify's safe `metafield_tag` for rich text.
- Creates no empty heading or filler copy.
- Keeps unknown compatibility unknown.
- Preserves the gallery, price, variants, booking, Add to Cart, Ask Snoozer, product description, policies, related products, and M3/M5 Dual Comfort behavior.

Actual preview QA confirmed all eight category headings on their representative products, an enabled standard Add to Cart where applicable, and no desktop document overflow.

## Content migration report

Automatically initialized facts were restricted to meanings that could be mapped exactly:

- Product/variant identity and native commerce data.
- Existing exact taxonomy tags for materials and verified features.
- Existing variant geometry fields.
- Native variant color and loft options.
- Exact height encoded in the approved mattress identity.
- Exact `2.5-inch` topper identity.
- Existing source manifests and approved assortment record as provenance.

Not migrated automatically:

- Manufacturer marketing prose into Ty-authored fields.
- Unverified sleep-position, pressure-relief, cooling, care, warranty, compatibility, dimension, or construction claims.
- Soft/Medium Soft/Medium Firm/Firm mappings for M3/M5.
- Any M3/M5 purchasable left/right configuration.
- Claims for the two duvet/sham products without exact current manufacturer pages.

Every product starts with owner content `NOT_STARTED` and technical content `PARTIAL`.

## Snoozer-ready schema

The normalized contract is defined by:

- `schemas/product-knowledge.v1.schema.json`
- `docs/product-knowledge/PRODUCT_KNOWLEDGE_FEED.v1.json`
- `tests/fixtures/product-knowledge-categories.v1.json`
- `scripts/export-product-knowledge.mjs`

The schema separates:

1. `content` — Ty-authored fields, emitted only when approved.
2. `technical` — structured facts, status, and provenance.
3. `commerce` — Shopify product/variant identity, with a mandatory live-authority rule.
4. `compatibility` — verified relationships with a fail-closed unknown rule.

The variant export also includes `standardizedSize`. It is derived deterministically from the native Shopify Size option, with `Cal King` normalized to `California King` and equivalent split labels expanded. The native value remains in `options.Size`; Shopify variant identity, live availability, and live price remain authoritative. This avoids a duplicate metafield while giving future Snoozer retrieval a stable size term.

## Future API mapping and synchronization

Initial synchronization should use Shopify Admin GraphQL or a Bulk Operation to query products, variants, collections, relevant metafields, IDs, and `updatedAt`. The integration should map namespace/key pairs through schema version `1.0.0`, not scrape rendered product descriptions.

Incremental refresh should subscribe to Shopify product create/update/delete webhooks. On an update:

1. Re-read the changed product and all variants from Shopify.
2. Validate the schema version and status enums.
3. Exclude owner content unless `custom.owner_content_status == APPROVED`.
4. Preserve technical provenance and exclude fields that are missing or pending.
5. Invalidate the cached knowledge record using product ID plus `updatedAt`.

Prices, current availability, variants, inventory, cart, and checkout must be resolved through the existing Shopify commerce service at request time. The knowledge cache must never become commerce authority. No AWS/backend implementation was made in this task.

Shopify primary references used for the implementation:

- <https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldDefinitionCreate>
- <https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldDefinitionPin>
- <https://shopify.dev/docs/api/admin-graphql/latest/queries/metafieldDefinitions>

## Validation evidence

- `node tests/runProductKnowledgeContractTests.mjs` — 40 assertions.
- Full storefront/catalog regression suites remain required before release.
- `node scripts/stage-product-knowledge-architecture.mjs` — idempotent plan, zero definitions, pins, unpins, fields, or assets remaining.
- Native commerce fingerprint preserved across all 43 products and 274 variants.
- Published theme `139460542525` hash-verified unchanged for both affected assets.
- Unpublished theme `139216420925` contains the new renderer.

Screenshots:

- `screenshots/shopify-editor-pinned-fields.png` — Ty's pinned Shopify writing fields.
- `screenshots/mattress-desktop.png` — actual unpublished-theme mattress product page.
- `screenshots/pillow-desktop.png` — actual unpublished-theme pillow product page.
- `../website-experience/screenshots/m3-dual-comfort-mobile.png` — authenticated mobile mattress Product Page v1 regression evidence; the product-knowledge renderer reuses this responsive product-page shell.

## Remaining content dependencies

The detailed per-product writing list is `OWNER_CONTENT_CHECKLIST.md`. The material technical dependencies are exact M3/M5 sell-unit mappings, missing exact media, verified warranty/care/compatibility specifications, and the two unmatched duvet/sham manufacturer sources.
