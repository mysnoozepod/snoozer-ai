import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'docs', 'catalog', 'catalog-shopping-restructure-current-inspection.json');
const FEED_PATH = path.join(ROOT, 'docs', 'product-knowledge', 'PRODUCT_KNOWLEDGE_FEED.v1.json');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'curated-bundles');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'CURATED_BUNDLE_MANIFEST.json');
const ASSET_PATH = path.join(ROOT, 'assets', 'snoozepod-curated-bundle-catalog.js');
const SIZE_ORDER = ['Queen', 'King', 'California King', 'Twin', 'Twin XL', 'Full', 'Full XL', 'Split Head Queen', 'Split Head King', 'Split Head California King', 'Split King', 'Split California King', 'Twin XL x 2'];

const DEFINITIONS = [
  { id: 'dri-tec-protection-set', name: 'Dri-Tec Bedding + Protection Set', category: 'BEDDING_SET', status: 'STAGED_PURCHASABLE', handles: ['dri-tec-sheet-set', 'dri-tec-mattress-protector'], basis: 'A sheet set and mattress protector sharing an exact Shopify size and sleep geometry.' },
  { id: 'ver-tex-protection-set', name: 'Ver-Tex Bedding + Protection Set', category: 'BEDDING_SET', status: 'STAGED_PURCHASABLE', handles: ['ver-tex-sheet-set', 'ver-tex-mattress-protector'], basis: 'A sheet set and mattress protector sharing an exact Shopify size and sleep geometry.' },
  { id: 'cotton-light-bedding-set', name: 'Cotton + Light Weight Bedding Set', category: 'BEDDING_SET', status: 'STAGED_PURCHASABLE', handles: ['cotton-sheet-set', 'light-weight-comforter'], basis: 'A sheet set and comforter whose existing Shopify variants both cover the selected size.' },
  { id: 'dri-tec-medium-bedding-set', name: 'Dri-Tec + Medium Weight Bedding Set', category: 'BEDDING_SET', status: 'STAGED_PURCHASABLE', handles: ['dri-tec-sheet-set', 'medium-weight-comforter'], basis: 'A sheet set and comforter whose existing Shopify variants both cover the selected size.' },
  { id: 'ver-tex-light-bedding-set', name: 'Ver-Tex + Light Weight Bedding Set', category: 'BEDDING_SET', status: 'STAGED_PURCHASABLE', handles: ['ver-tex-sheet-set', 'light-weight-comforter'], basis: 'A sheet set and comforter whose existing Shopify variants both cover the selected size.' },
  { id: 'memory-foam-flex-l-review', name: '12-inch Memory Foam + Flex L System', category: 'SLEEP_SYSTEM', status: 'BLOCKED_COMPATIBILITY', handles: ['12-inch-memory-foam-mattress', 'flex-l-adjustable-base'], basis: 'Review candidate only. Matching size and geometry do not prove mechanical compatibility.' },
  { id: 'hybrid-flex-lsx-review', name: '12-inch Hybrid + Flex LSX System', category: 'SLEEP_SYSTEM', status: 'BLOCKED_COMPATIBILITY', handles: ['12-inch-hybrid-mattress', 'flex-lsx-adjustable-base'], basis: 'Review candidate only. Matching size and geometry do not prove mechanical compatibility.' },
  { id: 'dual-comfort-flex-sh-review', name: '12-inch Dual Comfort + Flex SH System', category: 'SLEEP_SYSTEM', status: 'BLOCKED_COMPATIBILITY', handles: ['12-inch-dual-comfort-mattress', 'flex-sh-adjustable-base'], basis: 'Review candidate only. Matching size and geometry do not prove mechanical compatibility.' },
  { id: 'dual-comfort-flex-lsx-review', name: '14-inch Dual Comfort + Flex LSX System', category: 'SLEEP_SYSTEM', status: 'BLOCKED_COMPATIBILITY', handles: ['14-inch-dual-comfort-mattress', 'flex-lsx-adjustable-base'], basis: 'Review candidate only. Matching size and geometry do not prove mechanical compatibility.' },
  { id: 'queen-complete-review', name: 'Queen Complete Sleep Package', category: 'COMPLETE_SLEEP_PACKAGE', status: 'BLOCKED_COMPATIBILITY', handles: ['12-inch-memory-foam-mattress', 'flex-l-adjustable-base', 'cotton-sheet-set', 'dri-tec-mattress-protector'], basis: 'Review candidate only. The mattress and base pairing requires explicit compatibility verification.' },
  { id: 'split-head-complete-review', name: 'Split Head Queen Complete Sleep Package', category: 'COMPLETE_SLEEP_PACKAGE', status: 'BLOCKED_COMPATIBILITY', handles: ['12-inch-dual-comfort-mattress', 'flex-sh-adjustable-base', 'dri-tec-sheet-set', 'dri-tec-mattress-protector'], basis: 'Review candidate only. The mattress and base pairing requires explicit compatibility verification.' },
];

function fail(message) { throw new Error(message); }
function normalizeSize(value) {
  return String(value || '').trim().replace(/\s*\(2pc\)$/i, '').replace(/Cal King/gi, 'California King').replace(/\s+/g, ' ');
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

function buildSizes(components) {
  const candidateKeys = [...new Set(components.flatMap((component) => component.variants.flatMap((variant) => variant.shopSizeKeys)))];
  return candidateKeys.flatMap((label) => {
    const byComponent = components.map((component) => component.variants.filter((variant) => variant.shopSizeKeys.includes(label)));
    if (byComponent.some((variants) => !variants.length)) return [];
    const geometries = [...new Set(byComponent.flat().map((variant) => variant.geometry).filter(Boolean))];
    const geometryMatches = geometries.length <= 1;
    if (!geometryMatches) return [];
    const minimum = byComponent.reduce((sum, variants) => sum + Math.min(...variants.map((variant) => moneyNumber(variant.price))), 0);
    const maximum = byComponent.reduce((sum, variants) => sum + Math.max(...variants.map((variant) => moneyNumber(variant.price))), 0);
    return [{ label, geometry: geometries[0] || 'standard', minCombinedPrice: (minimum / 100).toFixed(2), maxCombinedPrice: (maximum / 100).toFixed(2), componentVariants: byComponent }];
  }).sort((left, right) => {
    const leftIndex = SIZE_ORDER.indexOf(left.label);
    const rightIndex = SIZE_ORDER.indexOf(right.label);
    if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    return left.label.localeCompare(right.label);
  });
}

const bundles = DEFINITIONS.map((definition) => {
  const components = definition.handles.map(productRecord);
  const sizes = buildSizes(components);
  if (!sizes.length) fail(`${definition.id} has no exact shared size/geometry candidates.`);
  const purchasable = definition.status === 'STAGED_PURCHASABLE';
  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    contentStatus: 'READY_FOR_REVIEW',
    purchaseStatus: definition.status,
    compatibilityStatus: purchasable ? 'COMPONENT_SIZE_GEOMETRY_VERIFIED' : 'PENDING_VERIFICATION',
    curationBasis: definition.basis,
    showroomRelationship: 'PENDING_VERIFICATION',
    verifiedAttributes: [...new Set(components.flatMap((component) => component.verifiedFeatures))],
    components: components.map((component) => ({ ...component, quantity: 1 })),
    sizes,
  };
});

const manifest = {
  schemaVersion: '1.0.0',
  generatedAt: catalog.generatedAt,
  source: { store: catalog.shop, products: catalog.summary.products, variants: catalog.summary.variants, authority: 'Existing Shopify products and available variants; exact commerce state must be rechecked at add-to-cart time.' },
  architecture: { mode: 'MULTI_LINE_COMPONENT_CART', parentBundleProductsCreated: false, artificialSkusCreated: false, discountsApplied: false, rationale: 'Preserves each real component variant, live price, inventory check, line item, and fulfillment path without hiding unverified compatibility.' },
  summary: { bundles: bundles.length, sleepSystems: bundles.filter((bundle) => bundle.category === 'SLEEP_SYSTEM').length, beddingSets: bundles.filter((bundle) => bundle.category === 'BEDDING_SET').length, completePackages: bundles.filter((bundle) => bundle.category === 'COMPLETE_SLEEP_PACKAGE').length, stagedPurchasable: bundles.filter((bundle) => bundle.purchaseStatus === 'STAGED_PURCHASABLE').length, blockedPendingCompatibility: bundles.filter((bundle) => bundle.purchaseStatus === 'BLOCKED_COMPATIBILITY').length },
  bundles,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(ASSET_PATH, `window.SnoozePodCuratedBundles = ${JSON.stringify(manifest, null, 2)};\n`);
console.log(JSON.stringify(manifest.summary, null, 2));
console.log(`Wrote ${path.relative(ROOT, MANIFEST_PATH)} and ${path.relative(ROOT, ASSET_PATH)}.`);
