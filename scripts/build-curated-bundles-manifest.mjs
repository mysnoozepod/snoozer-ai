import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'docs', 'catalog', 'catalog-shopping-restructure-current-inspection.json');
const FEED_PATH = path.join(ROOT, 'docs', 'product-knowledge', 'PRODUCT_KNOWLEDGE_FEED.v1.json');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'curated-bundles');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'CURATED_BUNDLE_MANIFEST.json');
const ASSET_PATH = path.join(ROOT, 'assets', 'snoozepod-curated-bundle-catalog.js');
const SIZE_ORDER = ['Queen', 'King', 'California King', 'Twin', 'Twin XL', 'Full', 'Full XL', 'Split Head Queen', 'Split Head King', 'Split Head California King', 'Split King'];

const BEDDING_DEFINITIONS = [
  { id: 'dri-tec-protection-set', name: 'Dri-Tec Bedding + Protection Set', category: 'BEDDING_SET', handles: ['dri-tec-sheet-set', 'dri-tec-mattress-protector'], basis: 'A sheet set and mattress protector sharing an exact Shopify size and sleep geometry.' },
  { id: 'ver-tex-protection-set', name: 'Ver-Tex Bedding + Protection Set', category: 'BEDDING_SET', handles: ['ver-tex-sheet-set', 'ver-tex-mattress-protector'], basis: 'A sheet set and mattress protector sharing an exact Shopify size and sleep geometry.' },
  { id: 'cotton-light-bedding-set', name: 'Cotton + Light Weight Bedding Set', category: 'BEDDING_SET', handles: ['cotton-sheet-set', 'light-weight-comforter'], basis: 'A sheet set and comforter whose existing Shopify variants both cover the selected size.' },
  { id: 'dri-tec-medium-bedding-set', name: 'Dri-Tec + Medium Weight Bedding Set', category: 'BEDDING_SET', handles: ['dri-tec-sheet-set', 'medium-weight-comforter'], basis: 'A sheet set and comforter whose existing Shopify variants both cover the selected size.' },
  { id: 'ver-tex-light-bedding-set', name: 'Ver-Tex + Light Weight Bedding Set', category: 'BEDDING_SET', handles: ['ver-tex-sheet-set', 'light-weight-comforter'], basis: 'A sheet set and comforter whose existing Shopify variants both cover the selected size.' },
];

const MATTRESS_HANDLES = [
  '12-inch-memory-foam-mattress',
  '12-inch-hybrid-mattress',
  '12-inch-dual-comfort-mattress',
  '14-inch-dual-comfort-mattress',
];
const BASE_HANDLES = ['flex-l-adjustable-base', 'flex-lsx-adjustable-base', 'flex-sh-adjustable-base'];
const SYSTEM_DEFINITIONS = MATTRESS_HANDLES.flatMap((mattressHandle) => BASE_HANDLES.map((baseHandle) => ({
  id: `${mattressHandle}--${baseHandle}`,
  name: null,
  category: 'SLEEP_SYSTEM',
  handles: [mattressHandle, baseHandle],
  basis: baseHandle === 'flex-sh-adjustable-base'
    ? 'Owner approved: split-head mattresses pair only with the Flex SH split-head base in the exact same size.'
    : 'Owner approved: standard mattresses and bases pair in the exact same size; Split King uses two Twin XL mattresses and two Twin XL bases.',
})));
const DEFINITIONS = [...BEDDING_DEFINITIONS, ...SYSTEM_DEFINITIONS];

function fail(message) { throw new Error(message); }
function normalizeSize(value) {
  return String(value || '').trim()
    .replace(/\s*\(2pc\)$/i, '')
    .replace(/^Cal King$/i, 'California King')
    .replace(/^Split Head Cal King$/i, 'Split Head California King')
    .replace(/^Split Cal King$/i, 'Split California King')
    .replace(/\s+/g, ' ');
}
function sizeKeys(value) {
  const normalized = normalizeSize(value);
  if (!normalized || normalized.toLowerCase() === 'one size') return [];
  return [...new Set(normalized.split('/').map((part) => part.trim()).filter(Boolean))];
}
function optionObject(variant) { return Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value])); }
function moneyNumber(value) { return Math.round(Number(value) * 100); }
function featureValues(product) {
  const raw = product.technical.fields['snoozepod_technical.verified_features']?.value;
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
function sortSizes(sizes) {
  return sizes.sort((left, right) => {
    const leftIndex = SIZE_ORDER.indexOf(left.label);
    const rightIndex = SIZE_ORDER.indexOf(right.label);
    if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    return left.label.localeCompare(right.label);
  });
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const feed = JSON.parse(fs.readFileSync(FEED_PATH, 'utf8'));
if (catalog.summary.products !== 43 || catalog.summary.variants !== 274) fail('The verified 43-product / 274-variant baseline changed.');
const catalogByHandle = new Map(catalog.products.nodes.map((product) => [product.handle, product]));
const feedByHandle = new Map(feed.products.map((product) => [product.handle, product]));

function variantRecord(product, variant, feedVariant) {
  const options = optionObject(variant);
  const nativeSize = options.Size || options.size || null;
  return {
    variantId: String(variant.legacyResourceId),
    shopifyVariantId: variant.id,
    sku: variant.sku,
    title: variant.title,
    price: variant.price,
    available: variant.availableForSale,
    options,
    nativeSize,
    shopSizeKeys: sizeKeys(nativeSize),
    geometry: feedVariant?.contract?.['custom.sleep_geometry'] || null,
    fulfillmentReadiness: feedVariant?.contract?.['custom.fulfillment_readiness'] || 'PENDING',
  };
}

function productRecord(handle) {
  const product = catalogByHandle.get(handle);
  const knowledge = feedByHandle.get(handle);
  if (!product || !knowledge) fail(`Missing catalog or product-knowledge record for ${handle}.`);
  const feedVariants = new Map(knowledge.commerce.variants.map((variant) => [variant.shopifyVariantId, variant]));
  return {
    productId: String(product.legacyResourceId),
    shopifyProductId: product.id,
    handle,
    title: product.title,
    productType: product.productType,
    url: `/products/${handle}`,
    image: product.media.nodes[0]?.image?.url || null,
    verifiedFeatures: featureValues(knowledge),
    variants: product.variants.nodes.filter((variant) => variant.availableForSale).map((variant) => variantRecord(product, variant, feedVariants.get(variant.id))),
  };
}

function priceRange(componentVariants, componentQuantities) {
  const minimum = componentVariants.reduce((sum, variants, index) => sum + (Math.min(...variants.map((variant) => moneyNumber(variant.price))) * componentQuantities[index]), 0);
  const maximum = componentVariants.reduce((sum, variants, index) => sum + (Math.max(...variants.map((variant) => moneyNumber(variant.price))) * componentQuantities[index]), 0);
  return { minCombinedPrice: (minimum / 100).toFixed(2), maxCombinedPrice: (maximum / 100).toFixed(2) };
}

function sizeRecord(label, geometry, componentVariants, componentQuantities, sourceSize = label) {
  return {
    label,
    geometry,
    sourceSize,
    componentQuantities,
    ...priceRange(componentVariants, componentQuantities),
    componentVariants,
  };
}

function buildSharedSizes(components) {
  const candidateKeys = [...new Set(components.flatMap((component) => component.variants.flatMap((variant) => variant.shopSizeKeys)))];
  return sortSizes(candidateKeys.flatMap((label) => {
    const byComponent = components.map((component) => component.variants.filter((variant) => variant.shopSizeKeys.includes(label)));
    if (byComponent.some((variants) => !variants.length)) return [];
    const geometries = [...new Set(byComponent.flat().map((variant) => variant.geometry).filter(Boolean))];
    if (geometries.length > 1) return [];
    return [sizeRecord(label, geometries[0] || 'standard', byComponent, components.map(() => 1))];
  }));
}

function buildSystemSizes(components) {
  const [mattress, base] = components;
  if (base.handle === 'flex-sh-adjustable-base') {
    const labels = [...new Set(base.variants.filter((variant) => variant.geometry === 'split_head').flatMap((variant) => variant.shopSizeKeys))];
    return sortSizes(labels.flatMap((label) => {
      const componentVariants = [
        mattress.variants.filter((variant) => variant.geometry === 'split_head' && variant.shopSizeKeys.includes(label)),
        base.variants.filter((variant) => variant.geometry === 'split_head' && variant.shopSizeKeys.includes(label)),
      ];
      return componentVariants.some((variants) => !variants.length) ? [] : [sizeRecord(label, 'split_head', componentVariants, [1, 1])];
    }));
  }

  const labels = [...new Set(base.variants.filter((variant) => variant.geometry === 'standard').flatMap((variant) => variant.shopSizeKeys))];
  const standard = labels.flatMap((label) => {
    const componentVariants = [
      mattress.variants.filter((variant) => variant.geometry === 'standard' && variant.shopSizeKeys.includes(label)),
      base.variants.filter((variant) => variant.geometry === 'standard' && variant.shopSizeKeys.includes(label)),
    ];
    return componentVariants.some((variants) => !variants.length) ? [] : [sizeRecord(label, 'standard', componentVariants, [1, 1])];
  });
  const splitKingVariants = [
    mattress.variants.filter((variant) => variant.geometry === 'standard' && variant.shopSizeKeys.includes('Twin XL')),
    base.variants.filter((variant) => variant.geometry === 'standard' && variant.shopSizeKeys.includes('Twin XL')),
  ];
  if (!splitKingVariants.some((variants) => !variants.length)) {
    standard.push(sizeRecord('Split King', 'full_split', splitKingVariants, [2, 2], 'Twin XL'));
  }
  return sortSizes(standard);
}

const bundles = DEFINITIONS.map((definition) => {
  const components = definition.handles.map(productRecord);
  const isSystem = definition.category === 'SLEEP_SYSTEM';
  const sizes = isSystem ? buildSystemSizes(components) : buildSharedSizes(components);
  if (!sizes.length) fail(`${definition.id} has no supported configuration.`);
  return {
    id: definition.id,
    name: definition.name || `${components[0].title} + ${components[1].title}`,
    category: definition.category,
    contentStatus: 'READY_FOR_REVIEW',
    purchaseStatus: 'STAGED_PURCHASABLE',
    compatibilityStatus: isSystem ? 'OWNER_APPROVED' : 'COMPONENT_SIZE_GEOMETRY_VERIFIED',
    curationBasis: definition.basis,
    showroomRelationship: 'PENDING_VERIFICATION',
    verifiedAttributes: [...new Set(components.flatMap((component) => component.verifiedFeatures))],
    components: components.map((component) => ({ ...component, quantity: 1 })),
    sizes,
  };
});

if (bundles.some((bundle) => bundle.sizes.some((size) => size.label === 'Split Queen'))) fail('Split Queen must never be generated.');
const manifest = {
  schemaVersion: '1.1.0',
  generatedAt: catalog.generatedAt,
  source: { store: catalog.shop, products: catalog.summary.products, variants: catalog.summary.variants, authority: 'Existing Shopify products and available variants; exact commerce state must be rechecked at add-to-cart time.' },
  architecture: { mode: 'MULTI_LINE_COMPONENT_CART', parentBundleProductsCreated: false, artificialSkusCreated: false, discountsApplied: false, rationale: 'Preserves each real component variant, live price, inventory check, line item, and fulfillment path while applying only the owner-approved mattress/base rules.' },
  compatibilityRules: {
    standard: 'Exact same-size standard mattress and standard Flex L or Flex LSX base.',
    splitHead: 'Exact same-size split-head mattress and Flex SH base only.',
    splitKing: 'Two Twin XL mattress units and two Twin XL base units.',
    unsupported: ['Split Queen'],
  },
  summary: { bundles: bundles.length, sleepSystems: bundles.filter((bundle) => bundle.category === 'SLEEP_SYSTEM').length, beddingSets: bundles.filter((bundle) => bundle.category === 'BEDDING_SET').length, completePackages: 0, stagedPurchasable: bundles.length, blockedPendingCompatibility: 0 },
  bundles,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(ASSET_PATH, `window.SnoozePodCuratedBundles = ${JSON.stringify(manifest, null, 2)};\n`);
console.log(JSON.stringify(manifest.summary, null, 2));
console.log(`Wrote ${path.relative(ROOT, MANIFEST_PATH)} and ${path.relative(ROOT, ASSET_PATH)}.`);
