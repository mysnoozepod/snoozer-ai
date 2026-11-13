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

check(manifest.schemaVersion === '1.1.0', 'manifest uses the owner-approved compatibility contract');
check(manifest.source.products === 43 && manifest.source.variants === 274, 'manifest is tied to the verified catalog baseline');
check(manifest.summary.bundles === 17, 'manifest has 12 mattress/base options and 5 bedding sets');
check(manifest.summary.beddingSets === 5 && manifest.summary.sleepSystems === 12 && manifest.summary.completePackages === 0, 'only Sleep Systems and Bedding Sets remain');
check(manifest.summary.stagedPurchasable === 17 && manifest.summary.blockedPendingCompatibility === 0, 'owner-approved rules make every generated option staged-purchasable');
check(manifest.compatibilityRules.splitHead.includes('Flex SH') && manifest.compatibilityRules.splitKing.includes('two Twin XL'), 'owner-approved rules are explicit');
check(manifest.compatibilityRules.unsupported.includes('Split Queen'), 'Split Queen is explicitly unsupported');
check(manifest.architecture.mode === 'MULTI_LINE_COMPONENT_CART', 'architecture preserves real component cart lines');
check(!manifest.architecture.parentBundleProductsCreated && !manifest.architecture.artificialSkusCreated && !manifest.architecture.discountsApplied, 'no artificial products, SKUs, or discounts are introduced');

for (const bundle of manifest.bundles) {
  check(bundle.contentStatus === 'READY_FOR_REVIEW', `${bundle.id} customer-facing content remains owner-reviewable`);
  check(bundle.purchaseStatus === 'STAGED_PURCHASABLE', `${bundle.id} is purchasable in the unpublished theme`);
  check(bundle.showroomRelationship === 'PENDING_VERIFICATION', `${bundle.id} does not invent a showroom relationship`);
  check(bundle.components.length >= 2 && bundle.sizes.length >= 1, `${bundle.id} has real components and configurations`);
  for (const component of bundle.components) {
    const product = products.get(component.handle);
    check(Boolean(product), `${bundle.id}/${component.handle} references a real product`);
    check(component.shopifyProductId === product.id && component.productId === String(product.legacyResourceId), `${bundle.id}/${component.handle} preserves product identity`);
    check(component.quantity === 1, `${bundle.id}/${component.handle} preserves the normal per-product quantity`);
  }
  for (const size of bundle.sizes) {
    check(size.label !== 'Split Queen', `${bundle.id} never exposes Split Queen`);
    check(size.componentVariants.length === bundle.components.length, `${bundle.id}/${size.label} maps every component`);
    check(size.componentQuantities.length === bundle.components.length, `${bundle.id}/${size.label} sets every component quantity`);
    let minimum = 0;
    let maximum = 0;
    size.componentVariants.forEach((options, componentIndex) => {
      check(options.length >= 1, `${bundle.id}/${size.label}/component-${componentIndex} has an exact available option`);
      minimum += Math.min(...options.map((variant) => Number(variant.price))) * size.componentQuantities[componentIndex];
      maximum += Math.max(...options.map((variant) => Number(variant.price))) * size.componentQuantities[componentIndex];
      for (const option of options) {
        const actual = variants.get(option.shopifyVariantId);
        check(Boolean(actual), `${bundle.id}/${option.variantId} references a real Shopify variant`);
        check(String(actual.variant.legacyResourceId) === option.variantId && actual.variant.sku === option.sku && actual.variant.price === option.price, `${bundle.id}/${option.variantId} preserves ID, SKU, and price`);
        check(actual.variant.availableForSale && option.available, `${bundle.id}/${option.variantId} is available in the captured Shopify catalog`);
        check(option.shopSizeKeys.includes(size.sourceSize), `${bundle.id}/${option.variantId} uses the exact source size ${size.sourceSize}`);
      }
    });
    check(size.minCombinedPrice === minimum.toFixed(2) && size.maxCombinedPrice === maximum.toFixed(2), `${bundle.id}/${size.label} combined price includes quantities exactly`);
  }

  if (bundle.category === 'SLEEP_SYSTEM') {
    check(bundle.compatibilityStatus === 'OWNER_APPROVED', `${bundle.id} uses the owner-approved rule`);
    const base = bundle.components[1];
    if (base.handle === 'flex-sh-adjustable-base') {
      check(bundle.sizes.every((size) => size.geometry === 'split_head' && size.label.startsWith('Split Head ') && size.componentQuantities.every((quantity) => quantity === 1)), `${bundle.id} exposes only exact split-head configurations`);
    } else {
      check(bundle.sizes.every((size) => size.geometry === 'standard' || size.label === 'Split King'), `${bundle.id} exposes only standard sizes plus Split King`);
      const splitKing = bundle.sizes.find((size) => size.label === 'Split King');
      check(Boolean(splitKing), `${bundle.id} exposes Split King`);
      check(splitKing.sourceSize === 'Twin XL' && splitKing.componentQuantities.every((quantity) => quantity === 2), `${bundle.id} defines Split King as two Twin XL mattresses and bases`);
      check(splitKing.componentVariants.every((options) => options.every((variant) => variant.nativeSize === 'Twin XL')), `${bundle.id} never substitutes a native King or Split King variant for the Twin XL pair`);
    }
  } else {
    check(bundle.compatibilityStatus === 'COMPONENT_SIZE_GEOMETRY_VERIFIED', `${bundle.id} uses exact bedding size and geometry`);
    check(bundle.sizes.every((size) => size.componentQuantities.every((quantity) => quantity === 1)), `${bundle.id} retains one unit per bedding component`);
  }
}

check(feed.bundles.length === manifest.bundles.length, 'Snoozer-ready feed contains every curated relationship');
check(feed.bundles.every((bundle) => bundle.sizes.every((size) => Array.isArray(size.componentQuantities) && size.sourceSize)), 'Snoozer-ready feed preserves source size and quantities');
check(schema.$defs.bundle.properties.compatibilityStatus.enum.includes('OWNER_APPROVED'), 'product knowledge schema represents owner-approved compatibility');
check(template.sections.main.type === 'snoozepod-curated-bundles', 'Sleep Systems page mounts the dedicated section');
check(section.includes('data-bundle-cart-status') && section.includes('aria-live="assertive"'), 'cart outcomes use an assertive accessible live region');
check(!section.includes('data-snoozer-trigger') && !section.includes('COMPLETE_SLEEP_PACKAGE'), 'Sleep Systems removes secondary CTA and obsolete complete-package clutter');
check(/two Twin XL mattresses/i.test(section) && section.includes('Flex SH'), 'customer-facing rules are simple and explicit');
check(section.includes('data-system-path="split_head"') && section.includes('Featured in Pods 2 &amp; 3'), 'Split-Head Sleep Systems receive the featured path');
check(!section.includes('data-bundle-grid="BEDDING_SET"'), 'bedding sets no longer compete with the core Sleep Systems journey');
check(section.includes('snoozepod-pod-builder.js') && ui.includes('SnoozePodBundleCart'), 'curated systems reuse the hardened reconciled cart implementation');
check(cart.includes('window.SnoozePodBundleCart = Object.freeze'), 'cart integrity primitives are exposed without duplicating mutation logic');
check(!/discount|save \$|% off|sale price/i.test(JSON.stringify(manifest.bundles)), 'curation does not invent discount claims');
check(ui.includes('Add Sleep System to Cart') && ui.includes('data-system-base'), 'each mattress card exposes size, base, and a purchase action');
check(ui.includes('data-system-comfort="left"') && ui.includes('data-system-comfort="right"'), 'Dual Comfort system cards expose independent left and right choices');
check(ui.includes('.snoozepod-system-path[data-system-path]') && ui.includes('event.target.matches("[data-system-size]")') && ui.includes('event.target.matches("[data-system-base]")'), 'pathway clicks are scoped and size/base changes use distinct deterministic update paths');
check(ui.includes('componentQuantities') && ui.includes('quantity: Number(quantities[index]'), 'cart quantities come from the selected configuration');
check(ui.includes('button.dataset.pending') && ui.includes('claimBundleLock'), 'double submissions remain blocked');
check(ui.includes('verifyBundleVariantReadiness') && ui.includes('executeBundleCartOperation'), 'live readiness and post-mutation reconciliation are required');
check(ui.includes('Your selections are still here'), 'selection-preserving failure guidance is present');

const sandbox = { window: {}, document: { addEventListener() {}, querySelectorAll() { return []; } }, Intl, Map, Set };
vm.runInNewContext(ui, sandbox);
const grouped = sandbox.window.SnoozePodCuratedBundleUI.groupSystems(manifest.bundles);
const helpers = sandbox.window.SnoozePodCuratedBundleUI;
check(grouped.length === 4, 'twelve pair options render as four clear mattress system cards');
check(grouped.every((group) => group.bundles.length === 3), 'each mattress offers Flex L, Flex LSX, and Flex SH through one card');
check(grouped.every((group) => sandbox.window.SnoozePodCuratedBundleUI.systemSizeLabels(group, 'split_head').every((size) => size.startsWith('Split Head '))), 'split-head path exposes only split-head configurations');
check(grouped.every((group) => sandbox.window.SnoozePodCuratedBundleUI.systemSizeLabels(group, 'full_split').join('|') === 'Split King'), 'full-split path exposes only Split King');
for (const group of grouped) {
  check(helpers.systemBundlesForSize(group, 'Queen').map((bundle) => bundle.components[1].handle).sort().join('|') === 'flex-l-adjustable-base|flex-lsx-adjustable-base', `${group.mattress.handle} standard sizes allow Flex L and Flex LSX`);
  check(helpers.systemBundlesForSize(group, 'Split Head Queen').map((bundle) => bundle.components[1].handle).join('|') === 'flex-sh-adjustable-base', `${group.mattress.handle} split-head sizes allow only Flex SH`);
  check(helpers.systemBundlesForSize(group, 'Split King').map((bundle) => bundle.components[1].handle).sort().join('|') === 'flex-l-adjustable-base|flex-lsx-adjustable-base', `${group.mattress.handle} Split King allows Flex L and Flex LSX`);
}
check(helpers.systemComfortProperties('12-inch-dual-comfort-mattress', 'Soft', 'Medium Firm')["Left Side Comfort"] === 'Soft', 'Dual Comfort properties preserve the left preference');
check(helpers.systemComfortProperties('12-inch-dual-comfort-mattress', 'Soft', 'Medium Firm')["Right Side Comfort"] === 'Medium Firm', 'Dual Comfort properties preserve the right preference');
check(helpers.systemComfortProperties('12-inch-dual-comfort-mattress', '', 'Firm') === null, 'incomplete Dual Comfort selections fail closed');
check(Object.keys(helpers.systemComfortProperties('12-inch-memory-foam-mattress', '', '')).length === 0, 'non-Dual Comfort systems do not require comfort properties');
check(sandbox.window.SnoozePodCuratedBundleUI.money('429.98') === '$429.98', 'price helper formats exact component totals');
check(sandbox.window.SnoozePodCuratedBundleUI.variantLabel({ options: { Size: 'Queen', Color: 'White' } }) === 'Color: White', 'variant choice labels preserve selectable product options without duplicating size');

console.log(`PASS curated bundles: ${assertions} assertions.`);
