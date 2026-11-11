export const PRODUCT_KNOWLEDGE_SCHEMA_VERSION = '1.0.0';

export const CONTENT_STATUSES = ['NOT_STARTED', 'DRAFT', 'READY_FOR_REVIEW', 'APPROVED'];
export const TECHNICAL_STATUSES = ['PENDING', 'PARTIAL', 'VERIFIED'];

const definition = (namespace, key, name, type, description, options = {}) => ({
  namespace,
  key,
  name,
  type,
  description,
  ownerType: options.ownerType || 'PRODUCT',
  validations: options.validations || [],
  pin: Boolean(options.pin),
});

const choices = (values) => [{ name: 'choices', value: JSON.stringify(values) }];

export const PRODUCT_METAFIELD_DEFINITIONS = [
  definition('custom', 'owner_content_status', '01 Content workflow', 'single_line_text_field', 'Ty-controlled workflow: Not Started, Draft, Ready for Review, or Approved. Only Approved owner content is eligible for storefront and future Snoozer use.', { pin: true, validations: choices(CONTENT_STATUSES) }),
  definition('custom', 'product_contract', '02 Product knowledge category', 'single_line_text_field', 'Category-specific contract assigned to this product.', { pin: true, validations: choices(['mattress', 'adjustable_base', 'pillow', 'sheets_bedding', 'mattress_protection', 'comforter_duvet_accessory', 'mattress_topper', 'bedroom_furniture']) }),
  definition('custom', 'product_knowledge_schema_version', '03 Knowledge schema version', 'single_line_text_field', 'Version of the normalized MySnoozePod product-knowledge contract.', { pin: true }),
  definition('custom', 'technical_content_status', '04 Technical content status', 'single_line_text_field', 'Verification status for structured technical facts.', { pin: true, validations: choices(TECHNICAL_STATUSES) }),
  definition('custom', 'technical_source', '05 Technical source and provenance', 'json', 'Machine-readable provenance for technical facts. Do not use this field for customer-facing prose.', { pin: true }),
  definition('custom', 'assortment_status', '06 Assortment status', 'single_line_text_field', 'Owner assortment decision, separate from Shopify publication status.', { pin: true, validations: choices(['APPROVED', 'SELECTED', 'PROVISIONAL', 'DEFERRED']) }),
  definition('custom', 'publication_readiness', '07 Publication readiness', 'single_line_text_field', 'Independent operational publication gate.', { pin: true, validations: choices(['BLOCKED', 'READY']) }),
  definition('custom', 'model', '08 Internal model', 'single_line_text_field', 'Stable internal model identifier where the manufacturer model is verified.'),
  definition('custom', 'builder_roles', '09 Guided-shopping roles', 'list.single_line_text_field', 'Legacy guided-shopping discovery roles retained for compatibility; not authority for live availability.'),
  definition('custom', 'showroom_representation', '10 Showroom representation', 'json', 'Structured physical showroom display, sample, or swatch relationship.'),
  definition('custom', 'comfort_options', '11 Internal comfort options', 'json', 'Verified technical comfort identifiers. Customer labels require an approved mapping.'),
  definition('custom', 'configuration_readiness', '12 Configuration readiness', 'single_line_text_field', 'Whether exact purchasable configuration mappings are verified.'),
  definition('custom', 'feel_label', '13 Verified product feel', 'single_line_text_field', 'Customer-facing mattress feel classification. Populate only when the classification is verified.', { validations: choices(['Plush', 'Medium Plush', 'Medium Firm', 'Firm']) }),

  definition('snoozepod_content', 'product_introduction', 'Content | Product introduction', 'rich_text_field', 'Ty-authored opening description. Visible only when the content workflow is Approved.', { pin: true }),
  definition('snoozepod_content', 'product_summary', 'Content | Product summary', 'multi_line_text_field', 'Concise Ty-authored summary for product and future Snoozer contexts.', { pin: true }),
  definition('snoozepod_content', 'key_benefits', 'Content | Key benefits', 'list.single_line_text_field', 'Customer-facing benefit statements approved by Ty.', { pin: true }),
  definition('snoozepod_content', 'what_makes_different', 'Content | What makes it different', 'rich_text_field', 'Ty-authored explanation of meaningful product distinctions.', { pin: true }),
  definition('snoozepod_content', 'why_selected', 'Content | Why MySnoozePod selected it', 'rich_text_field', 'Ty-authored assortment rationale.', { pin: true }),
  definition('snoozepod_content', 'customer_considerations', 'Content | Customer considerations', 'rich_text_field', 'Important limitations, tradeoffs, or questions a customer should consider.', { pin: true }),
  definition('snoozepod_content', 'snooze_session_focus', 'Content | Snooze Session focus', 'rich_text_field', 'What a customer should experience or compare during a Snooze Session.', { pin: true }),

  definition('snoozepod_technical', 'materials', 'Technical | Materials', 'list.single_line_text_field', 'Verified materials only.'),
  definition('snoozepod_technical', 'verified_features', 'Technical | Verified features', 'list.single_line_text_field', 'Verified product features only.'),
  definition('snoozepod_technical', 'supported_configurations', 'Technical | Supported configurations', 'list.single_line_text_field', 'Manufacturer-verified configurations; do not infer from similar size labels.'),
  definition('snoozepod_technical', 'compatibility_information', 'Technical | Compatibility information', 'rich_text_field', 'Verified compatibility guidance. Unknown relationships must remain unresolved.'),
  definition('snoozepod_technical', 'care_instructions', 'Technical | Care instructions', 'rich_text_field', 'Verified care and maintenance instructions.'),
  definition('snoozepod_technical', 'warranty_information', 'Technical | Warranty information', 'rich_text_field', 'Verified manufacturer warranty information, not a store-created promise.'),

  definition('snoozepod_mattress', 'construction', 'Mattress | Construction', 'multi_line_text_field', 'Mattress type, height, comfort layers, support system, materials, and verified construction details.'),
  definition('snoozepod_mattress', 'overall_height_inches', 'Mattress | Overall height (in)', 'number_decimal', 'Verified overall mattress height in inches.'),
  definition('snoozepod_mattress', 'comfort_and_support', 'Mattress | Comfort and support', 'multi_line_text_field', 'Verified feel, support, pressure-relief, and sleep-position considerations.'),
  definition('snoozepod_mattress', 'cooling_features', 'Mattress | Cooling features', 'list.single_line_text_field', 'Verified cooling and temperature-regulation features.'),
  definition('snoozepod_mattress', 'supported_geometries', 'Mattress | Supported geometries', 'list.single_line_text_field', 'Verified standard, split-head, half-split, or full-split geometries.'),
  definition('snoozepod_mattress', 'adjustable_base_compatible', 'Mattress | Adjustable-base compatible', 'boolean', 'True only when compatibility is manufacturer verified.'),
  definition('snoozepod_mattress', 'dual_comfort_capable', 'Mattress | Dual Comfort capable', 'boolean', 'Whether independent side comfort is supported.'),
  definition('snoozepod_mattress', 'comfort_combinations', 'Mattress | Verified comfort combinations', 'list.single_line_text_field', 'Only exact verified left/right comfort combinations.'),
  definition('snoozepod_mattress', 'purchasable_configurations', 'Mattress | Purchasable configurations', 'list.single_line_text_field', 'Exact orderable mappings. Leave blank until manufacturer identities are verified.'),

  definition('snoozepod_base', 'motion_and_features', 'Adjustable base | Motion and features', 'multi_line_text_field', 'Verified head/foot elevation, supported positioning, presets, massage, and other functions.'),
  definition('snoozepod_base', 'control_methods', 'Adjustable base | Control methods', 'list.single_line_text_field', 'Verified remotes, apps, or other control methods.'),
  definition('snoozepod_base', 'physical_specifications', 'Adjustable base | Physical specifications', 'multi_line_text_field', 'Verified dimensions, height, clearance, weight capacity, and size availability.'),
  definition('snoozepod_base', 'split_geometries', 'Adjustable base | Split geometries', 'list.single_line_text_field', 'Verified standard, split-head, half-split, or full-split geometry support.'),
  definition('snoozepod_base', 'assembly_requirements', 'Adjustable base | Assembly requirements', 'rich_text_field', 'Verified assembly or installation requirements.'),
  definition('snoozepod_base', 'compatible_mattress_types', 'Adjustable base | Mattress compatibility', 'list.single_line_text_field', 'Verified compatible mattress types.'),
  definition('snoozepod_base', 'furniture_compatibility', 'Adjustable base | Furniture compatibility', 'rich_text_field', 'Verified headboard, platform, clearance, or zero-clearance compatibility.'),
  definition('snoozepod_base', 'showroom_experience', 'Adjustable base | Showroom experience', 'rich_text_field', 'What customers can test during a Snooze Session.'),

  definition('snoozepod_pillow', 'comfort_profile', 'Pillow | Comfort profile', 'multi_line_text_field', 'Verified loft, firmness, support, shape, and profile.'),
  definition('snoozepod_pillow', 'loft_options', 'Pillow | Loft options', 'list.single_line_text_field', 'Manufacturer-supported loft choices represented by the product.'),
  definition('snoozepod_pillow', 'sleep_positions', 'Pillow | Sleep-position suitability', 'list.single_line_text_field', 'Verified sleep-position guidance.'),
  definition('snoozepod_pillow', 'fill_material', 'Pillow | Fill material', 'list.single_line_text_field', 'Verified fill materials.'),
  definition('snoozepod_pillow', 'cover_material', 'Pillow | Cover material', 'list.single_line_text_field', 'Verified cover materials.'),
  definition('snoozepod_pillow', 'cooling_and_temperature', 'Pillow | Cooling and temperature', 'multi_line_text_field', 'Verified cooling and temperature-regulation technology.'),
  definition('snoozepod_pillow', 'dimensions', 'Pillow | Dimensions', 'multi_line_text_field', 'Verified dimensions and available sizes; Shopify variants remain commerce authority.'),
  definition('snoozepod_pillow', 'who_may_prefer', 'Pillow | Who may prefer it', 'rich_text_field', 'Ty-authored, approved preference guidance.'),

  definition('snoozepod_bedding', 'fabric_and_construction', 'Sheets & bedding | Fabric and construction', 'multi_line_text_field', 'Verified fabric composition, weave, and construction.'),
  definition('snoozepod_bedding', 'feel_and_breathability', 'Sheets & bedding | Feel and breathability', 'multi_line_text_field', 'Verified texture, feel, breathability, and cooling properties.'),
  definition('snoozepod_bedding', 'fit_information', 'Sheets & bedding | Fit information', 'multi_line_text_field', 'Verified sizes, geometry, pocket depth, and fit.'),
  definition('snoozepod_bedding', 'color_options', 'Sheets & bedding | Color options', 'list.single_line_text_field', 'Manufacturer-supported colors represented by current variants.'),
  definition('snoozepod_bedding', 'included_components', 'Sheets & bedding | Included components', 'list.single_line_text_field', 'Verified package contents.'),
  definition('snoozepod_bedding', 'material_experience', 'Sheets & bedding | Material experience', 'rich_text_field', 'Ty-authored explanation of how the material feels or performs.'),

  definition('snoozepod_protection', 'protection_and_coverage', 'Protection | Type and coverage', 'multi_line_text_field', 'Verified protection type, coverage, waterproofing, and moisture protection.'),
  definition('snoozepod_protection', 'breathability_and_cooling', 'Protection | Breathability and cooling', 'multi_line_text_field', 'Verified breathability and cooling behavior.'),
  definition('snoozepod_protection', 'mattress_fit', 'Protection | Mattress fit', 'multi_line_text_field', 'Verified mattress depth, fit, and supported sizes.'),
  definition('snoozepod_protection', 'split_geometry', 'Protection | Split geometry', 'list.single_line_text_field', 'Verified standard or split-head geometries. Matching size alone is insufficient.'),

  definition('snoozepod_accessory', 'product_subtype', 'Comforter & accessory | Product subtype', 'single_line_text_field', 'Comforter, duvet set, throw, blanket, or other verified subtype.'),
  definition('snoozepod_accessory', 'materials_and_fill', 'Comforter & accessory | Materials and fill', 'multi_line_text_field', 'Verified composition, fill, or insulation.'),
  definition('snoozepod_accessory', 'warmth_category', 'Comforter & accessory | Warmth category', 'single_line_text_field', 'Verified light, medium, ultra, or other warmth classification.'),
  definition('snoozepod_accessory', 'cooling_and_breathability', 'Comforter & accessory | Cooling and breathability', 'multi_line_text_field', 'Verified cooling or breathability characteristics.'),
  definition('snoozepod_accessory', 'dimensions_and_contents', 'Comforter & accessory | Dimensions and contents', 'multi_line_text_field', 'Verified dimensions, sizes, and included components.'),

  definition('snoozepod_topper', 'thickness_inches', 'Mattress topper | Thickness (in)', 'number_decimal', 'Verified topper thickness in inches.'),
  definition('snoozepod_topper', 'material_and_feel', 'Mattress topper | Material and feel', 'multi_line_text_field', 'Verified material and feel.'),
  definition('snoozepod_topper', 'support_and_pressure_relief', 'Mattress topper | Support and pressure relief', 'multi_line_text_field', 'Verified support and pressure-relief characteristics.'),
  definition('snoozepod_topper', 'cooling', 'Mattress topper | Cooling', 'multi_line_text_field', 'Verified cooling behavior.'),
  definition('snoozepod_topper', 'compatible_configurations', 'Mattress topper | Compatible configurations', 'list.single_line_text_field', 'Verified mattress sizes and geometries.'),
  definition('snoozepod_topper', 'comfort_experience', 'Mattress topper | Comfort experience', 'rich_text_field', 'Ty-authored description of the comfort change.'),

  definition('snoozepod_furniture', 'furniture_type', 'Bedroom furniture | Type', 'single_line_text_field', 'Headboard or platform base.'),
  definition('snoozepod_furniture', 'materials', 'Bedroom furniture | Materials', 'list.single_line_text_field', 'Verified furniture materials.'),
  definition('snoozepod_furniture', 'colors_and_finishes', 'Bedroom furniture | Colors and finishes', 'list.single_line_text_field', 'Verified colors and finishes represented by current variants.'),
  definition('snoozepod_furniture', 'dimensions_and_sizes', 'Bedroom furniture | Dimensions and sizes', 'multi_line_text_field', 'Verified dimensions and size compatibility.'),
  definition('snoozepod_furniture', 'assembly_and_installation', 'Bedroom furniture | Assembly and installation', 'rich_text_field', 'Verified assembly and installation considerations.'),
  definition('snoozepod_furniture', 'adjustable_base_compatibility', 'Bedroom furniture | Base compatibility', 'rich_text_field', 'Verified adjustable-base, platform, and clearance compatibility.'),
  definition('snoozepod_furniture', 'appearance_and_function', 'Bedroom furniture | Appearance and function', 'rich_text_field', 'Ty-authored appearance, functionality, and distinguishing characteristics.'),
  definition('snoozepod_furniture', 'room_considerations', 'Bedroom furniture | Room considerations', 'rich_text_field', 'Ty-authored room-planning considerations.'),
];

export const VARIANT_METAFIELD_DEFINITIONS = [
  definition('custom', 'sleep_geometry', 'Sleep geometry', 'single_line_text_field', 'Verified standard, split-head, half-split, full-split, or not-applicable geometry.', { ownerType: 'PRODUCTVARIANT', validations: choices(['standard', 'split_head', 'half_split', 'full_split', 'not_applicable', 'pending_verification']) }),
  definition('custom', 'price_verification_status', 'Price verification status', 'single_line_text_field', 'Source/approval status for the Shopify variant price.', { ownerType: 'PRODUCTVARIANT', validations: choices(['HISTORICAL_REFERENCE', 'OWNER_APPROVED', 'POLICY_VERIFIED', 'PENDING']) }),
  definition('custom', 'fulfillment_readiness', 'Fulfillment readiness', 'single_line_text_field', 'Operational fulfillment readiness independent of Shopify availability.', { ownerType: 'PRODUCTVARIANT', validations: choices(['PENDING', 'READY', 'BLOCKED']) }),
  definition('custom', 'compatibility_key', 'Compatibility key', 'single_line_text_field', 'Stable internal key for exact compatibility relationships.', { ownerType: 'PRODUCTVARIANT' }),
];

export function contractForProduct(product) {
  const tags = new Set(product.tags || []);
  if (tags.has('type:mattress')) return 'mattress';
  if (tags.has('type:adjustable-base')) return 'adjustable_base';
  if (tags.has('type:pillow')) return 'pillow';
  if (tags.has('type:sheet-set')) return 'sheets_bedding';
  if (tags.has('type:mattress-protector')) return 'mattress_protection';
  if (tags.has('type:comforter') || tags.has('type:duvet-set') || tags.has('type:throw')) return 'comforter_duvet_accessory';
  if (tags.has('type:mattress-topper')) return 'mattress_topper';
  if (tags.has('type:headboard') || tags.has('type:platform-base')) return 'bedroom_furniture';
  throw new Error(`No product knowledge contract maps ${product.handle}.`);
}

function listValues(tags, prefix) {
  return [...tags]
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length).replaceAll('-', ' '))
    .sort((a, b) => a.localeCompare(b));
}

function uniqueVariantOptions(product, name) {
  return [...new Set(product.variants.flatMap((variant) => variant.selectedOptions.filter((option) => option.name.toLowerCase() === name.toLowerCase()).map((option) => option.value)))];
}

function field(namespace, key, type, value) {
  return { namespace, key, type, value: typeof value === 'string' ? value : JSON.stringify(value) };
}

export function initialKnowledgeFields(product) {
  const tags = new Set(product.tags || []);
  const contract = contractForProduct(product);
  const materials = listValues(tags, 'material:');
  const features = listValues(tags, 'feature:');
  const sourceFiles = ['Shopify native product, variant, tag, and collection data'];
  if (product.vendor === 'BEDGEAR') sourceFiles.push('Bedgear Master PL Sept 2026.xlsx');
  if (product.vendor === 'Malouf') sourceFiles.push('MALOUF-PriceList-26.3-MAP.pdf');
  sourceFiles.push('MySnoozePod_Product_Lineup_Decisions_October_2026.pdf');

  const fields = [
    field('custom', 'product_contract', 'single_line_text_field', contract),
    field('custom', 'product_knowledge_schema_version', 'single_line_text_field', PRODUCT_KNOWLEDGE_SCHEMA_VERSION),
    field('custom', 'technical_content_status', 'single_line_text_field', 'PARTIAL'),
    field('custom', 'technical_source', 'json', {
      status: 'PARTIAL',
      sources: sourceFiles,
      rule: 'Only mapped native commerce data, exact catalog records, and explicit tags are initialized. Empty fields remain unverified.',
    }),
  ];
  if (materials.length) fields.push(field('snoozepod_technical', 'materials', 'list.single_line_text_field', materials));
  if (features.length) fields.push(field('snoozepod_technical', 'verified_features', 'list.single_line_text_field', features));

  if (contract === 'mattress') {
    const height = product.handle.includes('-14-') ? '14.0' : (product.handle.includes('-12-') ? '12.0' : null);
    const mattressType = tags.has('comfort:memory-foam') ? 'Memory foam' : tags.has('comfort:hybrid') ? 'Hybrid' : tags.has('comfort:dual-comfort') ? 'Dual Comfort modular mattress' : null;
    if (height) fields.push(field('snoozepod_mattress', 'overall_height_inches', 'number_decimal', height));
    if (mattressType) fields.push(field('snoozepod_mattress', 'construction', 'multi_line_text_field', mattressType));
    fields.push(field('snoozepod_mattress', 'dual_comfort_capable', 'boolean', tags.has('feature:dual-comfort') ? 'true' : 'false'));
  }
  if (contract === 'adjustable_base') {
    const geometries = [...new Set(product.variants.flatMap((variant) => variant.metafields.filter((entry) => entry.namespace === 'custom' && entry.key === 'sleep_geometry').map((entry) => entry.value)))];
    if (geometries.length) fields.push(field('snoozepod_base', 'split_geometries', 'list.single_line_text_field', geometries));
  }
  if (contract === 'pillow') {
    const lofts = uniqueVariantOptions(product, 'Loft');
    if (lofts.length) fields.push(field('snoozepod_pillow', 'loft_options', 'list.single_line_text_field', lofts));
    if (materials.length) fields.push(field('snoozepod_pillow', 'fill_material', 'list.single_line_text_field', materials));
  }
  if (contract === 'sheets_bedding') {
    const colors = uniqueVariantOptions(product, 'Color');
    if (colors.length) fields.push(field('snoozepod_bedding', 'color_options', 'list.single_line_text_field', colors));
  }
  if (contract === 'mattress_protection') {
    const geometries = [...new Set(product.variants.flatMap((variant) => variant.metafields.filter((entry) => entry.namespace === 'custom' && entry.key === 'sleep_geometry').map((entry) => entry.value)))];
    if (geometries.length) fields.push(field('snoozepod_protection', 'split_geometry', 'list.single_line_text_field', geometries));
  }
  if (contract === 'comforter_duvet_accessory') {
    const subtype = tags.has('type:comforter') ? 'Comforter' : tags.has('type:duvet-set') ? 'Duvet and sham set' : 'Throw';
    fields.push(field('snoozepod_accessory', 'product_subtype', 'single_line_text_field', subtype));
    const warmth = listValues(tags, 'comfort:').find((value) => value.endsWith('weight'));
    if (warmth) fields.push(field('snoozepod_accessory', 'warmth_category', 'single_line_text_field', warmth));
  }
  if (contract === 'mattress_topper' && product.handle.includes('2-5-inch')) {
    fields.push(field('snoozepod_topper', 'thickness_inches', 'number_decimal', '2.5'));
  }
  if (contract === 'bedroom_furniture') {
    fields.push(field('snoozepod_furniture', 'furniture_type', 'single_line_text_field', tags.has('type:headboard') ? 'Headboard' : 'Platform base'));
    const colors = uniqueVariantOptions(product, 'Color');
    if (colors.length) fields.push(field('snoozepod_furniture', 'colors_and_finishes', 'list.single_line_text_field', colors));
  }
  return fields;
}

export const CATEGORY_LABELS = {
  mattress: 'Mattress',
  adjustable_base: 'Adjustable base',
  pillow: 'Pillow',
  sheets_bedding: 'Sheets and bedding',
  mattress_protection: 'Mattress protection',
  comforter_duvet_accessory: 'Comforter, duvet, and accessory',
  mattress_topper: 'Mattress topper',
  bedroom_furniture: 'Bedroom furniture',
};
