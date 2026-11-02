# MySnoozePod MVP Merchandising and Full Sleep System Pod Builder Contract

Task: P1-002  
Owner: Ty  
Implementer: Codi  
Contract date: 2026-10-30  
Development baseline: `mysnoozepod/snoozer-ai`, `main`, `f5056cf9b3ee3392f0da01064f7171ea7c1ff01b`  
Published theme: `139460542525`, `snoozer-ai/main`  
Status: Contract complete; no Shopify products, collections, metafields, metaobjects, theme files, or carts were changed.

## 1. Authority and fail-closed rules

The October 30 assortment decision record controls selection and approval status. Manufacturer documents support model, size, color, component, SKU, warranty, and historical price facts. They do not authorize publication. Shopify remains authoritative for the final approved product, variant, price, availability, cart, and checkout state.

Evidence labels used here:

- **APPROVED**: Ty approved the family or product for the planned assortment. This does not by itself make a variant publishable.
- **SELECTED**: Intended for inclusion, but exact SKU and/or physical sample confirmation is still required.
- **PROVISIONAL**: Working choice that still requires Ty's final product approval.
- **DEFERRED**: Not included in the MVP now.
- **MANUFACTURER VERIFIED**: Explicitly supported by the supplied manufacturer document.
- **OWNER APPROVED**: Explicit Ty decision, without claiming manufacturer verification.
- **PENDING VERIFICATION**: Evidence is insufficient to approve the relationship.
- **UNSUPPORTED**: Explicitly unavailable, incompatible, or excluded by the controlling record.

Mandatory gates:

1. Every online product needs a full showroom display, a physical sample, or an appropriate physical swatch.
2. A family-level approval does not approve every size, color, geometry, price, or component combination.
3. Matching size words do not prove mechanical compatibility.
4. `PENDING VERIFICATION` is a blocking state. The builder must not convert it to compatible.
5. No builder-enabled product may be published until P1-006A cart integrity passes.
6. Customer-facing names and copy require Ty's approval. Manufacturer codes stay internal unless Ty chooses otherwise.

## 2. Source record and limits

| Source | Use in this contract | Material evidence | Limit |
|---|---|---|---|
| `MySnoozePod_Product_Lineup_Decisions_October_2026.pdf` | Controlling assortment decision | Six mattress positions; exact 16 pillows; approved bases, bedding, protection, comforters, and furniture; selected cooling/duvet/toppers; deferred items | Does not authorize live price or provisional mattress publication |
| `Bedgear Master PL Sept 2026.xlsx` | BEDGEAR size, color, topology, component, SKU, and historical UPP support | S7/H6 sizes; M3/M5 chassis and 0.0-3.0 suspension components; Flex L/LSX/SH variants; sheet/protector geometries; bedding and topper rows | Conflicting/current-versus-all sheets and blank LSX/SH dropship fields require vendor reconciliation |
| `MALOUF-PriceList-26.3-MAP.pdf` | Malouf pillow, topper, furniture, warranty, size, and SKU support | Pillow pages 49-65; furniture pages 28-32; topper page 74 | MAP is a historical reference; current dealer terms, availability, freight, and returns still require confirmation |
| Current theme source | Existing implementation contract | Inline shared builder, dynamic collection sourcing, mattress variants, motion choices, multi-item Ajax add | Current filtering is not geometry-aware and cart fallback is unsafe |

## 3. Deliverable A - MVP merchandising contract

### 3.1 Readiness summary

No product is ready for publication as of this contract. The assortment categories are frozen, but the publish gate still requires exact approved variants, final prices, availability, physical representation, fulfillment facts, compatibility evidence, warranty/return facts, and Ty-approved content.

| Category | Assortment decision | Variant evidence | Physical showroom contract | Publication readiness |
|---|---|---|---|---|
| Mattress floor | **APPROVED**: six physical positions | Position plan is exact | Six full mattress displays | Footprint ready; product publication blocked |
| S7, H6, M3, M5 | **PROVISIONAL** | BEDGEAR source contains size/topology rows; M3/M5 include modular components | S7: 1; H6: 1; M3: 2; M5: 2 | Blocked on Ty model approval and variant contract |
| Flex L, Flex LSX, Flex SH | **APPROVED** families | Exact manufacturer rows exist; LSX/SH dropship rates are blank in supplied workbook | Full operating base representation on relevant pods | Blocked on pairwise compatibility, price policy, freight, availability |
| 16 Malouf pillows | **APPROVED** models | Malouf catalog provides size/SKU/MAP rows for the selected models | Each model must be touchable; variants may use representative size samples | Blocked on exact size/loft selection, current wholesale, samples, content |
| Cotton, Dri-Tec, Ver-Tex sheets | **APPROVED** collections | BEDGEAR rows include standard, split, and split-head variants by collection/color, with collection-specific gaps | Sheet samples and real color swatches | Blocked on final SKU/color list, inventory, compatibility, content |
| Dri-Tec, Ver-Tex, Stretchwick encasement | **APPROVED** products | Split-head rows exist for Dri-Tec and Ver-Tex; no split-head Stretchwick row in source | Physical sample for each product | Blocked on exact SKU list and articulating/geometry verification |
| Light, Medium, Ultra comforters | **APPROVED** weights | Full/Queen and King/Cal King rows exist | Physical sample for each weight | Blocked on live SKU/price/availability and content |
| Cooling blanket, cooling throw, two duvet designs | **SELECTED** | BEDGEAR rows support the selected designs | Exact selected piece as sample | Blocked on SKU and sample readiness |
| Two toppers | **SELECTED** | Malouf and BEDGEAR source rows exist | Physical topper samples on padded display rails | Blocked on SKU, sample, current price, availability |
| Four headboards, two platform bases | **APPROVED** models | Malouf catalog lists sizes, colors, specifications, and MAP | Integrated into the six pods; fabric swatches where needed | Blocked on exact size/color list, fulfillment, return terms, cross-brand compatibility |

### 3.2 Mattress floor and modular configuration

| Position | Working model | State | Demonstration purpose | Shopify identity rule |
|---|---|---|---|---|
| 01 | BEDGEAR S7 | **PROVISIONAL** | Performance mattress | One product family; variants only after final approval |
| 02 | BEDGEAR H6 | **PROVISIONAL** | Pillowtop hybrid | One product family; variants only after final approval |
| 03 | BEDGEAR M3 - Comfort A | **PROVISIONAL** | Modular comfort demonstration | Same M3 product family as position 04 |
| 04 | BEDGEAR M3 - Comfort B | **PROVISIONAL** | A genuinely different modular feel | Same M3 product family as position 03 |
| 05 | BEDGEAR M5 - Comfort A | **PROVISIONAL** | Premium modular demonstration | Same M5 product family as position 06 |
| 06 | BEDGEAR M5 - Comfort B | **PROVISIONAL** | A genuinely different premium feel | Same M5 product family as position 05 |

Six physical positions equal four working product families, not six Shopify products. The BEDGEAR workbook lists M3/M5 chassis-plus-comfort-layer sell units and 0.0, 1.0, 2.0, and 3.0 Independent Suspension components. It also lists standard, split-head, split King, and split Cal King forms. This proves component and topology records exist; it does not prove every left/right combination is orderable or owner approved.

Before a modular product can be created, Ty/vendor must freeze:

- the exact M3 and M5 cover/architecture being sold;
- the allowed left/right comfort combinations by size and topology;
- the manufacturer order components and quantities for each sellable Shopify variant;
- whether Shopify represents a complete manufacturer e-commerce SKU or a MySnoozePod bundle of component SKUs;
- which two configurations each physical model demonstrates.

### 3.3 Adjustable bases

| Family | State | Manufacturer-listed geometries in supplied workbook | Contract treatment |
|---|---|---|---|
| Flex L | **APPROVED** | Twin XL, Queen, King, Cal King | Standard adjustable family; exact mattress pairings remain pending |
| Flex LSX | **APPROVED** | Twin XL, Queen, King, Cal King, Split Cal King | Preserve neck/lumbar distinction; do not relabel as Flex SH or infer split-head support |
| Flex SH | **APPROVED** | Split Head Queen, Split Head King, Split Head Cal King | Split-head family only; do not treat as full-split or standard geometry |

The proposed equal retail strategy for comparable LSX and SH Queen/King configurations is an owner pricing principle, not an authorized live price. The BEDGEAR source contains lower LSX reference values than the proposed match and has blank LSX/SH dropship cells. Current advertised-pricing policy, freight, and exact price authorization are required before publication.

### 3.4 Approved Malouf pillows

Each row below is a distinct Shopify product model. Size and loft choices remain variants of that model when the manufacturer actually offers them.

| Collection | Approved model | Source-supported variant note | Readiness |
|---|---|---|---|
| Zoned | Zoned Dough + Bamboo Charcoal | Queen/King; mid loft; shoulder variant exists but is not automatically approved as this model's variant | Blocked on exact variant selection |
| Zoned | Zoned ActiveDough + Bamboo Charcoal | Queen/King | Blocked on exact variant selection |
| Zoned | Zoned Gel Dough | High/mid/low loft and shoulder entries exist | Blocked on exact loft/shape selection |
| Zoned | Shoulder Zoned Gel ActiveDough | Queen/King shoulder entry exists | Blocked on exact variant confirmation |
| Filled | Gelled Microfiber | Queen/King | Blocked on exact variant confirmation |
| Filled | Convolution | Queen/King | Blocked on exact variant confirmation |
| Filled | Gel Convolution | Queen/King | Blocked on exact variant confirmation |
| Filled | Quilted Convolution + HyperChill | Queen/King | Blocked on exact variant confirmation |
| Foam | Weekender Gel Memory Foam | Standard/Queen/King | Blocked on exact variant confirmation |
| Foam | Zoned Talalay Latex | Queen/King; catalog notes case packs | Blocked on wholesale/fulfillment confirmation |
| Foam | HexCurve + OmniPhase | Queen/King | Blocked on exact variant confirmation |
| Foam | Bamboo Charcoal + Cooling Cover | Queen/King and shoulder forms in Weekender catalog | Blocked on exact standard/shoulder selection |
| Temperature Regulating | Zoned Gel ActiveDough | Queen/King and shoulder entries exist | Blocked on exact standard/shoulder selection |
| Temperature Regulating | Gel Dough + Z Gel | High/mid and shoulder entries exist | Blocked on exact loft/shape selection |
| Temperature Regulating | CarbonCool + OmniPhase | Queen/King and shoulder entries exist | Blocked on exact standard/shoulder selection |
| Temperature Regulating | Ice Cloud + OmniPhase | High/mid/low loft, Queen/King | Blocked on exact loft selection |

Convolution and Gel Convolution remain in **Filled**, not Foam. CBD-infused pillows are excluded. No other Malouf pillow may re-enter the MVP without a new Ty decision.

### 3.5 Bedding, protection, comforters, cooling/duvets, and toppers

| Product family/model | State | Required Shopify variant dimensions | Blocking facts |
|---|---|---|---|
| BEDGEAR Cotton sheet set | **APPROVED** | Size/topology, color | Final SKU/color subset, availability, compatibility |
| BEDGEAR Dri-Tec sheet set | **APPROVED** | Size/topology, color | Final SKU/color subset, availability, compatibility |
| BEDGEAR Ver-Tex sheet set | **APPROVED** | Size/topology, color | Source has split-head only in some colors; exact subset required |
| BEDGEAR Dri-Tec Protector | **APPROVED** | Size/topology | Availability, compatibility, live price |
| BEDGEAR Ver-Tex Protector | **APPROVED** | Size/topology | Availability, compatibility, live price |
| BEDGEAR Stretchwick six-sided encasement | **APPROVED** | Standard size only until evidence changes | Articulating-base fit; no split-head claim |
| BEDGEAR Light Comforter | **APPROVED** | Full/Queen; King/Cal King | Availability, live price, content |
| BEDGEAR Medium Comforter | **APPROVED** | Full/Queen; King/Cal King | Availability, live price, content |
| BEDGEAR Ultra Comforter | **APPROVED** | Full/Queen; King/Cal King | Availability, live price, content |
| BEDGEAR Cooling Blanket | **SELECTED** | Queen, Navy or Grey display choice | Exact SKU and physical sample |
| BEDGEAR Cooling Performance Throw | **SELECTED** | White/Grey, 50 x 60 in. | Workbook calls it Cooling Throw; exact naming/SKU confirmation |
| BEDGEAR Solid Duvet + Sham Set | **SELECTED** | Solid White, Queen | Exact SKU and sample; comforter insert is separate |
| BEDGEAR Racetrack Duvet + Sham Set | **SELECTED** | Light Grey, Queen | Exact SKU and sample; comforter insert is separate |
| Malouf 2.5-inch Gel Memory Foam Topper | **SELECTED** | Size | Exact size subset, sample, wholesale/fulfillment |
| BEDGEAR React Pro Performance Topper | **SELECTED** | Size | Exact SKU, sample, current price/availability |

### 3.6 Furniture

| Model | State | Shopify structure | Builder treatment | Compatibility status |
|---|---|---|---|---|
| Hennessy Headboard | **APPROVED** | Product; size and fabric color variants | Not a builder step | Headboard/platform pairing supported within Malouf family; exact pod assignment pending |
| Carlisle Headboard | **APPROVED** | Product; size and fabric color variants | Not a builder step | Same as above |
| Scoresby Headboard | **APPROVED** | Product; size and fabric color variants | Not a builder step | Same as above |
| Blackwell Headboard | **APPROVED** | Product; size and fabric color variants | Not a builder step | Same as above |
| Eastman Platform Base | **APPROVED** | Product; size and fabric color variants | Not a builder step | Manufacturer states compatibility with all Malouf bases and most competitors; exact BEDGEAR pairing pending |
| Watson Platform Base | **APPROVED** | Product; size and fabric color variants | Not a builder step | Manufacturer states zero-clearance-base compatibility; BEDGEAR model/clearance pairing pending, especially around drawers |

Furniture coexists through normal product/collection pages and the pods' physical merchandising. Do not give furniture a `builder_roles` value and do not add a furniture step without Ty's authorization.

### 3.7 Deferred/excluded record

- BEDGEAR Arrowhead duvet designs: **DEFERRED**.
- BEDGEAR Sherpa Throw: **DEFERRED**.
- Weekender Mid-Rise Diamond-Tufted Headboard special buy: **DEFERRED/conditional**, not part of the six approved furniture models.
- CBD-infused Malouf pillows: **UNSUPPORTED for this assortment**.
- Every product not explicitly listed above: **DEFERRED by default**, not implicitly approved.

## 4. Deliverable B - Shopify data contract

### 4.1 Native Shopify structure

Use native fields first.

| Requirement | Native Shopify field | Contract |
|---|---|---|
| Manufacturer | Product vendor | Required; normalized to `BEDGEAR` or `Malouf` |
| Product family/model | Product title plus internal handle | One customer-facing product per approved model/family; Ty approves title |
| Product type | Product type | Controlled values: Mattress, Adjustable Base, Mattress Protector, Pillow, Sheet Set, Comforter, Bedding, Topper, Headboard, Platform Base |
| Shopify product identity | Product ID/handle | Generated only after product creation; handle is not the manufacturer identity |
| Manufacturer SKU | Variant SKU | Required for publishable variants; never use a synthetic or guessed SKU |
| Shopify variant identity | Variant ID | Generated by Shopify; fixture IDs are never importable |
| Size/color/comfort | Variant options | Product-specific options below; do not overload title text |
| Retail price | Variant price | Must be owner authorized and policy verified; historical UPP/MAP is not live authority |
| Availability | Variant availability/inventory behavior | Shopify remains authoritative; dropship readiness is an additional gate |
| Media | Product/variant media | Approved image rights and Ty-approved alt text required |
| Warranty/return copy | Product content/page links | Publish only verified warranty facts; return policy remains a store/vendor decision |
| Publication | Product status and sales channels | Create as draft until every required gate passes |

### 4.2 Recommended product and variant boundaries

- **Mattresses**: one product per final model (S7, H6, M3, M5 if approved). S7/H6 use Size as the principal variant option. M3/M5 require Size, Geometry, and Comfort Configuration only after the allowed configuration set is frozen. Do not create a variant for each physical display slot.
- **M3/M5 fulfillment**: each Shopify variant is one customer sell unit. If fulfillment requires multiple manufacturer components, record the verified component list and quantity separately. Do not place several component SKUs in the Shopify SKU field.
- **Adjustable bases**: one product per family; variant option Size/Geometry. Flex SH variants are split-head. Flex L/LSX must not inherit Flex SH geometry.
- **Pillows**: one product per approved model; variants are only manufacturer-supported Size, Loft, and Shape combinations selected for the MVP.
- **Sheets**: one product per approved collection; variants use Size/Geometry and Color. Keep split, split-head, and standard labels distinct.
- **Protectors**: one product per approved model; variants use Size/Geometry. Stretchwick has no split-head variant without new evidence.
- **Comforters**: one product per approved weight; Size variant.
- **Cooling/duvet products**: one product per selected design; only the selected size/color until Ty expands it.
- **Toppers**: one product per selected model; Size variant.
- **Furniture**: one product per approved model; Size and Color variants. Do not assign the Pod Builder template.

### 4.3 Custom field dictionary

Only the fields below solve relationships or operational gates that native Shopify fields cannot represent accurately.

| Field | Shopify type | Purpose | Source of truth | Required | Validation | Consumers |
|---|---|---|---|---|---|---|
| `custom.assortment_status` | Product metafield, single-line text | Preserve APPROVED/SELECTED/PROVISIONAL/DEFERRED separately | Ty decision record | Yes | Exact enum; no blank | Theme, Snoozer, operations |
| `custom.publication_readiness` | Product metafield, single-line text | Independent go-live gate | Operations checklist plus Ty approval | Yes | `BLOCKED` or `READY`; READY requires all gates | Theme, operations |
| `custom.builder_roles` | Product metafield, list of single-line text | Explicit discovery without fragile collection order/tags | This contract | Required for builder products; empty for furniture | Values only `mattress`, `base`, `protection`, `pillow`, `bedding` | Pod Builder, Snoozer |
| `custom.showroom_representation` | Product metafield, JSON | Map online assortment to physical full display/sample/swatch and station IDs | Showroom operations | Yes | Type enum; at least one station/sample ID; readiness state | Theme, Snoozer, operations |
| `custom.sleep_geometry` | Variant metafield, single-line text | Separate standard, split-head, half-split, full-split, and not-applicable geometry | Manufacturer evidence and approved SKU map | Required for builder variants | Exact enum; cannot be inferred from loose title match | Pod Builder, Snoozer, operations |
| `custom.comfort_configuration_code` | Variant metafield, single-line text | Stable approved M3/M5 configuration identity | Ty/vendor approved configuration table | Required only for modular mattress variants | Must resolve to one approved component composition | Pod Builder, Snoozer, operations |
| `custom.fulfillment_components` | Variant metafield, JSON | Record verified manufacturer component SKU/quantity for a multi-component sell unit | Manufacturer/order operations | Required only when one Shopify variant ships as multiple components | Nonempty SKU and positive integer quantity; no duplicates | Operations |
| `custom.price_verification_status` | Variant metafield, single-line text | Prevent historical MAP/UPP from becoming live authority | Ty plus current vendor policy | Yes | `HISTORICAL_REFERENCE`, `VENDOR_CONFIRMED`, `OWNER_APPROVED`, `LIVE_VERIFIED`; publish requires last two | Theme, operations |
| `custom.fulfillment_readiness` | Variant metafield, single-line text | Distinguish Shopify availability from dropship operational readiness | Vendor/operations | Yes | `PENDING`, `READY`, or `BLOCKED`; READY requires lead time/freight path | Theme, Snoozer, operations |
| `custom.owner_content_status` | Product metafield, single-line text | Enforce Ty's copy authority | Ty | Yes | `PENDING` or `APPROVED`; publish requires APPROVED | Theme, operations |
| `custom.warranty_return_note` | Product metafield, multi-line text | Structured internal fact note for verified warranty and return sources | Manufacturer/store policy | Optional until verified; required to publish claims | Must cite source/date; no inferred claim | Theme, Snoozer, operations |
| `custom.compatibility_key` | Variant metafield, single-line text | Stable key for pairwise rules across Shopify IDs/environments | Approved import manifest | Required for builder variants | Unique, immutable, lowercase token | Pod Builder, Snoozer, operations |

Use one small `sleep_compatibility_rule` metaobject because native product/variant fields cannot represent pairwise tri-state relationships.

| Metaobject field | Type | Rule |
|---|---|---|
| `rule_key` | Single-line text | Unique and immutable |
| `subject_key` | Single-line text | Existing `custom.compatibility_key` |
| `target_key` | Single-line text | Existing `custom.compatibility_key` |
| `status` | Single-line text | `MANUFACTURER_VERIFIED`, `OWNER_APPROVED`, `PENDING_VERIFICATION`, or `UNSUPPORTED` |
| `evidence_source` | Multi-line text | Document/vendor decision and date |
| `notes` | Multi-line text | Optional operational constraint such as clearance or final-sale warning |

Do not create a separate compatibility metaobject for every size label before exact variants exist. Generate rules from the frozen variant manifest, validate references, and publish only rules whose endpoints exist.

## 5. Deliverable C - Full Sleep System Pod Builder contract

### 5.1 Existing architecture to preserve

The current inline builder is reusable:

- `sections/snoozepod-pod-builder-hero.liquid` renders the shared `snippets/snoozepod-guided-pod-builder-core.liquid` inside the product hero.
- The shared snippet emits mattress variant data and product catalogs for base, protection, pillow, and bedding.
- `assets/snoozepod-pod-builder.js` synchronizes the selected mattress variant, hides motion for non-adjustable bases, supports skip choices, reviews the build, estimates the total, and attempts a single multi-item Ajax add.
- Both Pod Builder templates mount the same hero/facts/booking structure.
- Existing CSS supports a multi-option card grid and inline layout; no architecture replacement is required.

### 5.2 Current gaps that the implementation must target

| Current behavior | Contract gap | Required modification |
|---|---|---|
| Collections are hardcoded in Liquid | Historical handles do not encode approval or compatibility | Add explicit builder role/status fields and a targeted collection map |
| `ADDON_STEP_LIMITS` exposes only the first protector, pillow, and bedding product | Arbitrary collection order hides valid choices | Remove first-item limiting; render all eligible products or an approved filtered/paginated chooser |
| Add-on variant resolver falls back to first available variant | Can select the wrong size/geometry | No fallback across size/geometry; return unavailable/pending and block selection |
| Size aliases cover standard size words but not split-head topology | Size text is being used as compatibility | Resolve exact variant geometry plus explicit rules |
| Motion options infer Queen/King behavior | Half/full split labels are not manufacturer relationships | Replace inference with variant/rule-driven geometry choices |
| `base:adjustable` tag or handle substring identifies adjustable bases | Accidental naming can change behavior | Use `builder_roles` and exact base family/geometry data |
| Builder catalog JSON contains native product/variant data only | No tri-state compatibility or fulfillment gate | Emit normalized product contract fields and compatibility keys/status |
| Multi-item add falls back to the normal mattress form | False bundle success and ambiguous cart mutation risk | P1-006A must fail closed and reconcile cart state |

### 5.3 Discovery and selection interface

The builder must receive a normalized catalog entry for each eligible product:

```json
{
  "shopifyProductId": "gid://shopify/Product/...",
  "handle": "approved-handle",
  "title": "Ty-approved customer title",
  "manufacturer": "BEDGEAR",
  "family": "Flex SH",
  "assortmentStatus": "APPROVED",
  "publicationReadiness": "READY",
  "builderRoles": ["base"],
  "variants": [
    {
      "shopifyVariantId": "gid://shopify/ProductVariant/...",
      "compatibilityKey": "bedgear-flex-sh-split-head-queen",
      "size": "Split Head Queen",
      "geometry": "split_head",
      "available": true,
      "price": "SHOPIFY_AUTHORITY"
    }
  ]
}
```

The example shows shape only. It is not fixture data or permission to create records.

Eligibility requires all of the following:

1. Product assortment status is APPROVED, or SELECTED only after the exact SKU/sample gate is complete and Ty authorizes builder inclusion.
2. Product and variant publication readiness are READY.
3. Shopify reports the variant sellable for the relevant channel.
4. The product has the step's explicit builder role.
5. The exact selected mattress/variant pair has an allowed compatibility result.
6. `PENDING_VERIFICATION` and missing rules are shown as not yet verified, not as compatible.

### 5.4 Step contracts

#### Mattress

- Start from the current product and exact Shopify variant, not a text-only model selection.
- Require an option whose semantic role is Size. The implementation may continue to recognize a `Size` option but must also read explicit geometry.
- M3/M5 comfort choices use approved `comfort_configuration_code` values and verified component compositions.
- A showroom-only configuration may be displayed as a demonstration note but cannot be selected for checkout unless it maps to a sellable variant.
- A change in size/geometry invalidates downstream selections that no longer have compatible rules.

#### Adjustable base

- Discover only products with builder role `base` from the approved `adjustable-bases` source.
- Filter by exact size, geometry, and compatibility rule. Do not treat Flex L, LSX, and SH as interchangeable.
- Standard, split-head, half-split, and full-split choices are product/variant geometries, not presentation-only motion labels.
- If no verified compatible base exists, retain `No base / already have one` and `Not sure yet`; do not recommend an unknown pairing.

#### Protection

- Discover approved protector products from `mattress-protectors`.
- Filter by exact size/geometry and compatibility status.
- Dri-Tec and Ver-Tex split-head variants can be candidates only after exact pairing is verified.
- Stretchwick encasement is excluded from split-head choices while its rule is pending.
- Skip remains a valid choice.

#### Pillow

- Discover from one canonical `pillows` source and include all approved models whose selected variants are ready.
- Preserve collection/category metadata for Zoned, Filled, Foam, and Temperature Regulating filters.
- Allow the shopper to compare/select among multiple models. Never choose the first collection item as the only product.
- Pillow size/loft/shape selection is product-specific; mattress size must not force an arbitrary pillow variant.
- Skip remains a valid choice.

#### Bedding

- Discover sheets through `sheet-sets` and approved comforter/cooling/duvet products through `bedding`.
- Filter sheet sets by exact mattress size and geometry. Preserve color selection.
- Comforters, throws, blankets, and duvet sets have their own size requirements and must not inherit mattress geometry without an explicit rule.
- Make the separate comforter insert requirement visible for duvet sets after Ty approves the language.
- Skip remains a valid choice.

#### Furniture

- Furniture remains available through standard product/collection discovery.
- It has no builder role in this contract.
- The compatibility service may still maintain platform/base clearance rules for Snoozer and operations, but the builder must not render a furniture step.

### 5.5 Compatibility resolver behavior

For every candidate pair, return one of four explicit states:

```json
{
  "status": "PENDING_VERIFICATION",
  "selectable": false,
  "reasonCode": "PAIRING_NOT_CONFIRMED",
  "evidenceLabel": "Vendor confirmation required"
}
```

- `MANUFACTURER_VERIFIED`: selectable when all other readiness gates pass.
- `OWNER_APPROVED`: selectable only for a relationship Ty has authority to approve and when it does not contradict manufacturer evidence.
- `PENDING_VERIFICATION`: visible only as unverified when useful; never selectable as confirmed compatible.
- `UNSUPPORTED`: hidden or visibly disabled with a plain reason; never selectable.
- Missing rule: treat exactly as `PENDING_VERIFICATION`.

## 6. Deliverable D - Compatibility decision matrix

| Subject | Target | Decision | Evidence and implementation rule |
|---|---|---|---|
| Mattress size | Same-labeled base size | **PENDING VERIFICATION** | Size labels alone are insufficient; require exact mattress/base variant rule |
| Standard S7/H6 variant | Flex L same size | **PENDING VERIFICATION** | Both product rows exist, but supplied documents do not explicitly approve the pair |
| Standard S7/H6 variant | Flex LSX same size | **PENDING VERIFICATION** | Same as above; preserve LSX neck/lumbar identity |
| Standard mattress | Flex SH split-head base | **PENDING VERIFICATION** | Do not assume standard mattress can use independent split-head motion correctly |
| Split-head mattress | Flex SH same split-head size | **PENDING VERIFICATION** | Intended geometry aligns, but exact model/variant pairing still needs manufacturer confirmation |
| Split-head mattress | Flex L/LSX standard size | **PENDING VERIFICATION** | Similar dimensions do not prove independent head operation or safe use |
| Half-split selection | Any base | **PENDING VERIFICATION** | Current builder label is not an approved manufacturer SKU relationship |
| Full-split selection | Any base | **PENDING VERIFICATION** | Requires exact two-piece mattress/base component mapping; current King inference is not authority |
| M3/M5 chassis | 0.0-3.0 Independent Suspension components | **MANUFACTURER VERIFIED** as listed components | Workbook lists component options and required quantities; allowed left/right combinations remain pending |
| M3/M5 two display positions | One product family | **OWNER APPROVED** | Two physical configurations demonstrate one model; do not create duplicate products for slots |
| Dri-Tec/Ver-Tex protector | Same geometry mattress | **PENDING VERIFICATION** | Manufacturer lists standard/split/split-head SKUs, but exact pairing still needs an approved rule |
| Stretchwick encasement | Standard mattress | **PENDING VERIFICATION** | Standard sizes exist; articulating-base fit still requires confirmation |
| Stretchwick encasement | Split-head mattress | **PENDING VERIFICATION** | No split-head variant is confirmed; builder must not present it as compatible |
| Cotton/Dri-Tec/Ver-Tex sheets | Exact same size/geometry mattress | **PENDING VERIFICATION** | Exact geometry SKUs exist with collection/color gaps; freeze pairwise variant rules |
| Mismatched standard vs split-head sheet/protector geometry | Mattress | **UNSUPPORTED** | Explicit geometry mismatch; builder must exclude |
| Eastman platform | Malouf adjustable bases | **MANUFACTURER VERIFIED** at family claim level | Malouf says compatible with all Malouf bases; this does not verify BEDGEAR |
| Eastman platform | BEDGEAR Flex family | **PENDING VERIFICATION** | Malouf says most competitors, which is not a specific BEDGEAR approval |
| Watson platform | Generic zero-clearance adjustable base | **MANUFACTURER VERIFIED** at capability level | Malouf states zero-clearance compatibility |
| Watson platform | BEDGEAR Flex family | **PENDING VERIFICATION** | Verify zero-clearance mode, rail/drawer clearance, brackets, and service access |
| Headboards | Eastman/Watson upholstered bases | **MANUFACTURER VERIFIED** within Malouf family | Catalog says interchangeable; exact size/color SKU map still required |

### Required manufacturer/vendor questions

1. For each final S7/H6/M3/M5 variant, which Flex L, LSX, and/or SH exact variants are approved?
2. What do BEDGEAR's half-split and full-split commercial configurations consist of, by mattress pieces, base pieces, sync behavior, and exact SKUs?
3. Which M3/M5 left/right 0.0-3.0 comfort combinations are orderable, warrantied, and supported for standard and split-head forms?
4. Is Stretchwick approved on articulating bases, and is any split-head encasement available?
5. For each approved sheet/protector collection, which exact colors and geometries are current, stocked/dropship-ready, and eligible for the MVP?
6. Are Flex LSX/SH dropship rates available, and do the proposed equal comparable prices comply with the current advertised-pricing policy?
7. Are Flex L/LSX/SH approved inside Eastman and Watson, with required zero-clearance setup, headboard brackets, and drawer/service clearances?
8. What are current damaged-item, return, final-sale, warranty-service, and lead-time rules for bases and furniture?

## 7. Deliverable E - Collection mapping

| Proposed handle | Customer purpose | Pod Builder dependency | Membership rule | Launch requirement | Migration implication |
|---|---|---|---|---|---|
| `mattresses` | Browse approved mattress models | No; mattress is current product context | Approved/finalized mattress products only | Yes once mattresses are approved | Restore broken customer route; do not include provisional products as active |
| `adjustable-bases` | Browse approved Flex families | Yes: canonical base source | Products with builder role `base`, approved and ready | Yes for builder launch | Retain historical handle; remove substring-based adjustable detection |
| `bases` | Optional general foundations route | No at builder launch | Only if Ty wants a broader non-builder foundation route | No | Do not include Eastman/Watson here while current builder consumes it; eliminate as builder source |
| `mattress-protectors` | Browse approved protection | Yes | Approved/ready Dri-Tec, Ver-Tex, Stretchwick products | Yes | Retain; remove seven hardcoded fallback handles after mapping change |
| `pillows` | Browse/filter all 16 approved models | Yes: one canonical source | Approved/ready pillow models; category held in structured product data | Yes | Retain; builder must not depend on subcollection order |
| `shoulder-pillows` | Historical subtype route | No | None unless an external route requires preservation | No | Obsolete as builder dependency; redirect or keep only if route evidence requires it |
| `zoned-pillows` | Historical subtype route | No | None by default | No | Use `pillows` filters/category instead of duplicate source |
| `gel-dough-pillows` | Historical subtype route | No | None by default | No | Same as above |
| `latex-pillows` | Historical subtype route | No | None by default | No | Same as above |
| `filled-pillows` | Historical subtype route | No | None by default | No | Same as above; Filled category remains a product attribute/filter |
| `sheet-sets` | Browse approved sheet collections | Yes | Approved/ready Cotton, Dri-Tec, Ver-Tex products | Yes | Retain historical handle |
| `bedding` | Browse comforters, cooling, duvet sets, and approved bedding additions | Yes | Approved/ready or fully cleared selected bedding products | Yes for the full builder | Retain; builder filters by role and compatibility rather than first item |
| `toppers` | Browse selected toppers | No in current builder contract | Cleared SELECTED topper products | No until SKU/sample gate passes | New route only when products are ready |
| `furniture` | Browse approved headboards/platforms | No | Six approved, ready furniture products | Required when furniture is published | New canonical route; no builder step |

Do not recreate empty historical collections solely because the Liquid currently names them. Change the future discovery mapping once, preserve useful public routes with redirects where evidence shows they existed, and avoid duplicate collection membership as a compatibility system.

## 8. Deliverable F - Non-production fixture

Fixture: `tests/fixtures/p1-002-pod-builder-contract.fixture.json`  
Validator: `tests/runP1_002PodBuilderContractTests.js`

The fixture is synthetic and deliberately contains no real manufacturer SKU, Shopify ID, or price. It proves:

- standard mattress plus compatible adjustable base;
- modular mattress with two different comfort configurations;
- split-head geometry with a geometry-specific base;
- standard and split-head protection/sheet cases;
- multiple eligible pillow products;
- an explicit incompatible standard/split-head pairing;
- explicit unknown encasement and furniture-clearance cases;
- optional skip choices for every accessory step;
- furniture coexistence without a builder role;
- all four assortment states and compatibility states are constrained enums.

The fixture is a relationship proof, not proof that any real product is compatible or ready.

## 9. Deliverable G - P1-006A cart-integrity acceptance contract

P1-002 does not change cart code. P1-006A must pass all requirements below before any builder-enabled product is published.

1. Never submit the normal mattress-only form after a selected multi-item Ajax request fails or is ambiguous.
2. Build an immutable requested-item plan containing exact variant IDs, quantities, selected roles, and a client-generated bundle operation ID.
3. Add the same bundle operation ID as a private line property on every requested bundle item so new lines can be distinguished from pre-existing identical variants.
4. Capture a pre-add cart snapshot, submit once, then reconcile the post-add cart against requested variant, quantity, and operation ID.
5. Treat network errors, timeouts, malformed responses, and non-2xx responses as ambiguous until the cart is read back.
6. If the cart already contains the complete requested delta, report success without retrying.
7. If only part of the requested delta exists, show an incomplete-bundle error and identify missing components. Do not redirect or claim success.
8. Never blindly retry the entire request. A retry may target only reconciled missing items and must preserve the same operation context.
9. Prevent double submit while an operation is pending and handle multiple clicks/tabs without duplicate additions.
10. Keep descriptive mattress properties separate from proof of actual line additions. A property naming a protector or pillow is not cart evidence.
11. Preserve all selections and the review state after an error. Let the shopper retry safely, change choices, or book a Snooze Session.
12. Show clear, accessible status with per-item success/failure, focus management, and an `aria-live` announcement.
13. Use Shopify locale-aware cart routes for both add and read-back operations.
14. Fail before cart submission if any selected variant is unavailable, geometry-incompatible, pending verification, missing an ID, or no longer price/availability ready.
15. Recompute against current Shopify variant data immediately before submission; never trust a stale displayed total as price authority.
16. Test at least: complete success; 422 with no mutation; 422 with partial/limited mutation; timeout after full mutation; timeout after partial mutation; duplicate retry; pre-existing identical variant; unavailable add-on; and changed selection after error.

Acceptance evidence must include unit tests for the reconciliation state machine, DOM behavior tests for retained selections/error messaging, and an authorized non-production Shopify cart test. Passing the synthetic fixture alone is not cart acceptance.

## 10. Implementation backlog

| Priority | Task | Scope | Acceptance criteria |
|---|---|---|---|
| 1 | **P1-006A - Fail-closed bundle cart integrity** | Cart submission/reconciliation only; no product creation | All 16 cart requirements above pass; no mattress-only fallback; non-production cart evidence; rollback documented |
| 2 | **P1-002A - Variant and vendor evidence freeze** | Produce the exact real SKU/size/color/geometry/component manifest | Ty approves final mattresses; every real variant has current SKU, price status, availability, fulfillment, sample, warranty/return, and compatibility evidence |
| 3 | **P1-002B - Builder discovery and compatibility adapter** | Targeted Liquid/JS modification preserving inline core | Explicit builder roles; tri-state rules; no first-variant fallback; all eligible accessories; no arbitrary first-item limit; fixture/DOM tests pass |
| 4 | **P1-002C - Collection and route implementation** | Create only approved collection taxonomy after authorization | Required handles exist; historical obsolete handles redirect only when needed; builder reads canonical sources; customer routes pass |
| 5 | **P1-002D - Draft catalog implementation** | Draft Shopify products/variants/metafields only after authorization | Frozen manifest imports without live publication; Shopify IDs captured; no unapproved product; all products remain draft until gates pass |
| 6 | **P1-002E - End-to-end builder acceptance** | Non-production product/template/cart validation | Exact filtering, optional choices, price authority, error recovery, cart reconciliation, mobile/accessibility, and booking secondary path pass |

## 11. Decisions required from Ty

1. Final approve or replace each provisional mattress model: S7, H6, M3, and M5.
2. Approve the exact two M3 and two M5 showroom comfort configurations after vendor-supported combinations are known.
3. Approve the exact customer-facing product names and content after the internal SKU manifest is frozen.
4. Approve live prices only after the current BEDGEAR/Malouf policy check, including the proposed equal comparable LSX/SH pricing.
5. Decide later whether furniture should ever become a builder step. It remains outside the builder now.

Vendor facts, not Ty preference, must resolve exact supported configurations, pairwise compatibility, dropship/freight, availability, warranty service, and return/final-sale rules.

## 12. Contract completion statement

The assortment states, Shopify structure, Pod Builder discovery/selection contract, compatibility states, collection mapping, synthetic fixture, and P1-006A cart acceptance contract are now defined. The existing inline builder can be preserved, but it requires targeted data-driven filtering and cart hardening before launch. Unknown relationships remain blocked. No production or customer-facing implementation was performed.
