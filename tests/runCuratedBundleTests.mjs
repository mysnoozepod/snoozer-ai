import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const manifest = readJson('docs/curated-bundles/CURATED_BUNDLE_MANIFEST.json');
const catalog = readJson('docs/catalog/catalog-shopping-restructure-current-inspection.json');
const feed = readJson('docs/product-knowledge/PRODUCT_KNOWLEDGE_FEED.v1.json');
const schema = readJson('schemas/product-knowledge.v1.schema.json');
const section = fs.readFileSync(path.join(ROOT, 'sections', 'snoozepod-curated-bundles.liquid'), 'utf8');
const template = readJson('templates/page.sleep-systems.json');
const ui = fs.readFileSync(path.join(ROOT, 'assets', 'snoozepod-curated-bundles.js'), 'utf8');
const cart = fs.readFileSync(path.join(ROOT, 'assets', 'snoozepod-pod-builder.js'), 'utf8');

let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions += 1; }
const products = new Map(catalog.products.nodes.map((product) => [product.handle, product]));
const variants = new Map(catalog.products.nodes.flatMap((product) => product.variants.nodes.map((variant) => [variant.id, { product, variant }])));

check(manifest.source.products === 43 && manifest.source.variants === 274, 'manifest is tied to the verified catalog baseline');
check(manifest.summary.bundles === 11, 'manifest has a manageable 11 curated records');
check(manifest.summary.beddingSets === 5 && manifest.summary.sleepSystems === 4 && manifest.summary.completePackages === 2, 'all three requested categories are represented');
check(manifest.summary.stagedPurchasable === 5 && manifest.summary.blockedPendingCompatibility === 6, 'only verified bedding relationships are staged for purchase');
check(manifest.architecture.mode === 'MULTI_LINE_COMPONENT_CART', 'architecture preserves real component cart lines');
check(!manifest.architecture.parentBundleProductsCreated && !manifest.architecture.artificialSkusCreated && !manifest.architecture.discountsApplied, 'no artificial products, SKUs, or discounts are introduced');

for (const bundle of manifest.bundles) {
  check(bundle.contentStatus === 'READY_FOR_REVIEW', `${bundle.id} customer-facing content remains owner-reviewable`);
  check(bundle.showroomRelationship === 'PENDING_VERIFICATION', `${bundle.id} does not invent a showroom relationship`);
  check(bundle.components.length >= 2 && bundle.sizes.length >= 1, `${bundle.id} has real components and exact size records`);
  for (const component of bundle.components) {
    const product = products.get(component.handle);
    check(Boolean(product), `${bundle.id}/${component.handle} references a real product`);
    check(component.shopifyProductId === product.id && component.productId === String(product.legacyResourceId), `${bundle.id}/${component.handle} preserves product identity`);
    check(component.quantity === 1, `${bundle.id}/${component.handle} has an explicit quantity`);
  }
  for (const size of bundle.sizes) {
    check(size.componentVariants.length === bundle.components.length, `${bundle.id}/${size.label} maps every component`);
    let minimum = 0;
    let maximum = 0;
    size.componentVariants.forEach((options, componentIndex) => {
      check(options.length >= 1, `${bundle.id}/${size.label}/component-${componentIndex} has an exact available option`);
      minimum += Math.min(...options.map((variant) => Number(variant.price)));
      maximum += Math.max(...options.map((variant) => Number(variant.price)));
      for (const option of options) {
        const actual = variants.get(option.shopifyVariantId);
        check(Boolean(actual), `${bundle.id}/${option.variantId} references a real Shopify variant`);
        check(String(actual.variant.legacyResourceId) === option.variantId && actual.variant.sku === option.sku && actual.variant.price === option.price, `${bundle.id}/${option.variantId} preserves ID, SKU, and price`);
        check(actual.variant.availableForSale && option.available, `${bundle.id}/${option.variantId} is available in the captured Shopify catalog`);
        check(option.shopSizeKeys.includes(size.label), `${bundle.id}/${option.variantId} actually covers ${size.label}`);
        check(option.geometry === size.geometry, `${bundle.id}/${option.variantId} uses the exact shared geometry`);
      }
    });
    check(size.minCombinedPrice === minimum.toFixed(2) && size.maxCombinedPrice === maximum.toFixed(2), `${bundle.id}/${size.label} combined price range is exact`);
  }
  if (bundle.category === 'SLEEP_SYSTEM' || bundle.category === 'COMPLETE_SLEEP_PACKAGE') {
    check(bundle.purchaseStatus === 'BLOCKED_COMPATIBILITY' && bundle.compatibilityStatus === 'PENDING_VERIFICATION', `${bundle.id} fails closed on unverified mattress/base compatibility`);
  } else {
    check(bundle.purchaseStatus === 'STAGED_PURCHASABLE' && bundle.compatibilityStatus === 'COMPONENT_SIZE_GEOMETRY_VERIFIED', `${bundle.id} is staged only on exact component size and geometry`);
  }
}

check(feed.bundles.length === manifest.bundles.length, 'Snoozer-ready feed contains every curated relationship');
check(schema.required.includes('bundles') && schema.$defs.bundle, 'product knowledge schema defines the bundle contract');
check(template.sections.main.type === 'snoozepod-curated-bundles', 'Sleep Systems page mounts the dedicated section');
check(section.includes('data-bundle-cart-status') && section.includes('aria-live="assertive"'), 'cart outcomes use an assertive accessible live region');
check(section.includes('data-snoozer-trigger') && section.includes('/pages/book-a-snooze-session'), 'Ask Snoozer and booking remain secondary actions');
check(section.includes('snoozepod-pod-builder.js') && ui.includes('SnoozePodBundleCart'), 'curated sets reuse the hardened reconciled cart implementation');
check(cart.includes('window.SnoozePodBundleCart = Object.freeze'), 'cart integrity primitives are exposed without duplicating mutation logic');
check(!/discount|save \$|% off|sale price/i.test(JSON.stringify(manifest.bundles)), 'curation does not invent discount claims');
check(!section.includes('Add System to Cart') && ui.includes('Add Set to Cart'), 'unverified systems cannot expose a purchase action');
check(ui.includes('Current component total') && ui.includes('data-component-price'), 'blocked review candidates still expose actual component and combined pricing');
check(ui.includes('button.dataset.pending') && ui.includes('claimBundleLock'), 'double submissions remain blocked');
check(ui.includes('verifyBundleVariantReadiness') && ui.includes('executeBundleCartOperation'), 'live readiness and post-mutation reconciliation are required');
check(ui.includes('Your selections are still here'), 'selection-preserving failure guidance is present');

const sandbox = { window: {}, document: { addEventListener() {}, querySelectorAll() { return []; } }, Intl };
vm.runInNewContext(ui, sandbox);
check(sandbox.window.SnoozePodCuratedBundleUI.money('429.98') === '$429.98', 'price helper formats exact component totals');
check(sandbox.window.SnoozePodCuratedBundleUI.variantLabel({ options: { Size: 'Queen', Color: 'White' } }) === 'Color: White', 'variant choice labels preserve selectable product options without duplicating size');

console.log(`PASS curated bundles: ${assertions} assertions.`);
