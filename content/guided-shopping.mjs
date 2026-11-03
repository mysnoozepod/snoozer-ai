export const guidedShoppingPages = Object.freeze([
  {
    handle: 'sleep-tools',
    title: 'Sleep Tools',
    templateSuffix: 'sleep-tools',
    toolType: 'hub',
    eyebrow: 'Guides & Tools',
    summary: 'Use practical tools to narrow your choices, build a complete sleep system, and prepare for a Snooze Session.',
  },
  {
    handle: 'build-your-snoozepod',
    title: 'Build Your SnoozePod',
    templateSuffix: 'build-your-snoozepod',
    toolType: 'builder',
    eyebrow: 'Complete Sleep System',
    summary: 'Plan a mattress, base, protection, pillow, and bedding system without forcing unverified or unwanted additions.',
  },
  {
    handle: 'mattress-finder',
    title: 'Mattress Finder',
    templateSuffix: 'mattress-finder',
    toolType: 'mattress-finder',
    eyebrow: 'Find a Starting Point',
    summary: 'Narrow the mattress collection by comfort direction, construction, sleep position, and temperature preference.',
  },
  {
    handle: 'compatibility-checker',
    title: 'Sleep System Compatibility Checker',
    templateSuffix: 'compatibility-checker',
    toolType: 'compatibility',
    eyebrow: 'Verify Before You Buy',
    summary: 'Check size and geometry alignment while keeping product-level compatibility pending until Shopify contains verified evidence.',
  },
  {
    handle: 'compare-sleep-systems',
    title: 'Compare Sleep Systems',
    templateSuffix: 'compare-sleep-systems',
    toolType: 'compare',
    eyebrow: 'Compare Clearly',
    summary: 'Compare available mattresses and sleep-system components using the same verified Shopify product information.',
  },
  {
    handle: 'snooze-session-planner',
    title: 'Snooze Session Planner',
    templateSuffix: 'snooze-session-planner',
    toolType: 'session-planner',
    eyebrow: 'Prepare Your Visit',
    summary: 'Save what you want to test, the questions you want answered, and the comfort directions you want to compare.',
  },
  {
    handle: 'dual-comfort-planner',
    title: 'Dual Comfort Planner',
    templateSuffix: 'dual-comfort-planner',
    toolType: 'dual-comfort',
    eyebrow: 'Plan Each Side',
    summary: 'Record independent left and right comfort preferences without treating an unresolved combination as orderable.',
  },
  {
    handle: 'pillow-finder',
    title: 'Pillow Finder',
    templateSuffix: 'pillow-finder',
    toolType: 'pillow-finder',
    eyebrow: 'Support From The Top Down',
    summary: 'Narrow pillow choices by sleep position, feel, material direction, and cooling preference.',
  },
  {
    handle: 'cooling-bedding-finder',
    title: 'Cooling & Bedding Finder',
    templateSuffix: 'cooling-bedding-finder',
    toolType: 'bedding-finder',
    eyebrow: 'Complete The Sleep Environment',
    summary: 'Choose a starting direction for sheets, protection, comforters, and cooling layers.',
  },
  {
    handle: 'room-delivery-planner',
    title: 'Room & Delivery Planner',
    templateSuffix: 'room-delivery-planner',
    toolType: 'room-planner',
    eyebrow: 'Plan The Space',
    summary: 'Estimate room fit and record doorway measurements before confirming product-specific dimensions and delivery requirements.',
  },
]);

export const guidedShoppingRoutes = Object.freeze(
  Object.fromEntries(guidedShoppingPages.map((page) => [page.toolType, `/pages/${page.handle}`])),
);

export const customerFilterContract = Object.freeze([
  { key: 'size', label: 'Size', source: 'variant_option', authority: 'Shopify variant option' },
  { key: 'comfort_feel', label: 'Comfort', source: 'product_metafield', authority: 'Verified custom.comfort_feel' },
  { key: 'construction', label: 'Construction', source: 'product_metafield', authority: 'Verified custom.construction' },
  { key: 'sleep_positions', label: 'Sleep Position', source: 'product_metafield', authority: 'Verified custom.sleep_positions' },
  { key: 'cooling_level', label: 'Cooling', source: 'product_metafield', authority: 'Verified custom.cooling_level' },
  { key: 'geometry', label: 'Geometry', source: 'product_metafield', authority: 'Verified custom.geometry' },
  { key: 'materials', label: 'Material', source: 'product_metafield', authority: 'Verified custom.materials' },
  { key: 'pillow_loft', label: 'Pillow Loft', source: 'product_metafield', authority: 'Verified custom.pillow_loft' },
  { key: 'color', label: 'Color', source: 'variant_option', authority: 'Shopify variant option' },
  { key: 'availability', label: 'Availability', source: 'native', authority: 'Shopify variant availability' },
]);

export const organizationTagPrefixes = Object.freeze([
  'collection',
  'category',
  'subcategory',
  'type',
  'feature',
  'material',
  'comfort',
]);

