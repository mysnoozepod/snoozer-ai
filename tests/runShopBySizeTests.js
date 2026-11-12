const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shopBySize = require(path.join(root, 'assets', 'snoozepod-shop-by-size.js'));
const mapSource = fs.readFileSync(path.join(root, 'assets', 'snoozepod-size-collection-map.js'), 'utf8');
const sizeMap = JSON.parse(mapSource.replace(/^window\.SnoozePodSizeCollections = /, '').replace(/;\s*$/, ''));
const section = fs.readFileSync(path.join(root, 'sections', 'main-collection-product-grid.liquid'), 'utf8');
const card = fs.readFileSync(path.join(root, 'snippets', 'card-product.liquid'), 'utf8');
const feed = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'product-knowledge', 'PRODUCT_KNOWLEDGE_FEED.v1.json'), 'utf8'));

let assertions = 0;
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function check(value, message) { assert.ok(value, message); assertions += 1; }

equal(shopBySize.normalizeSize('Cal King'), 'California King');
equal(shopBySize.normalizeSize('Split Head Cal King'), 'Split Head California King');
equal(shopBySize.normalizeSize('Split King (2pc)'), 'Split King');
equal(shopBySize.normalizeSize('One Size'), null);
assert.deepEqual(shopBySize.shopSizeLabels('Full/Queen'), ['Full', 'Queen']); assertions += 1;
assert.deepEqual(shopBySize.shopSizeLabels('Split King/Split Cal King'), ['Split King', 'Split California King']); assertions += 1;
assert.deepEqual(shopBySize.shopSizeLabels('Twin XL x 2'), ['Twin XL x 2']); assertions += 1;

const representativeVariants = [
  { variantId: '101', nativeSize: 'Full/Queen', available: true, price: '$199.00' },
  { variantId: '102', nativeSize: 'King', available: false, price: '$249.00' },
  { variantId: '103', nativeSize: 'Split Cal King (2pc)', available: true, price: '$499.00' },
];
equal(shopBySize.eligibleVariant(representativeVariants, 'Queen').variantId, '101');
equal(shopBySize.eligibleVariant(representativeVariants, 'King'), null, 'unavailable variants are ineligible');
equal(shopBySize.eligibleVariant(representativeVariants, 'Split California King').variantId, '103');
equal(shopBySize.selectedSizeFromSearch('?size=Split+Head+King'), 'Split Head King');

equal(shopBySize.productUrlForVariant('/products/example?ref=collection', '101', 'Queen'), '/products/example?ref=collection&variant=101&size=Queen');
const mattressContext = shopBySize.collectionContext(sizeMap, 'mattresses');
equal(mattressContext.heading, 'Shop Mattresses by Size');
equal(mattressContext.sizes.length, 6);
check(mattressContext.sizes.every((size) => !shopBySize.systemOnlyMattressSize(size.label)), 'standalone mattress size routes exclude system-only geometries');
const splitContext = shopBySize.collectionContext(sizeMap, 'adjustable-bases-size-split-head-king');
equal(splitContext.selectedSize, 'Split Head King');
equal(splitContext.clearHandle, 'adjustable-bases');
equal(shopBySize.collectionContext(sizeMap, 'zoned-pillows'), null, 'unmanaged collections do not show the size panel');

check(section.includes("'snoozepod-size-collection-map.js' | asset_url"), 'the catalog-derived routing map is loaded');
check(section.includes('data-shop-by-size-root'), 'size-specific behavior mounts without a visible pre-product panel');
check(section.includes('data-collection-handle="{{ collection.handle | escape }}"'), 'the active collection handle is exposed');
check(section.includes('data-product-type="{{ product.type | handleize }}"'), 'cards expose product type for system-only geometry protection');
check(section.includes('variant.available | json'), 'Shopify availability is emitted');
check(section.includes('variant.id | json'), 'Shopify variant IDs are emitted');
check(section.includes('variant.price | money | json'), 'exact Shopify variant prices are emitted');
check(section.includes("product_option_name_normalized == 'size'"), 'Liquid locates the named Size option');
check(card.includes('data-shop-by-size-price'), 'cards expose a selected-size price surface');
check(!section.includes('class="snoozepod-shop-by-size"'), 'collection products are not buried beneath a Shop by Size panel');

const allVariants = feed.products.flatMap((product) => product.commerce.variants);
check(allVariants.every((variant) => variant.shopifyVariantId.startsWith('gid://shopify/ProductVariant/')), 'variant identities are retained');
check(allVariants.every((variant) => typeof variant.price === 'string'), 'variant prices are retained');
check(allVariants.every((variant) => Array.isArray(variant.shopSizeKeys)), 'every variant exports structured shopping size keys');
check(allVariants.some((variant) => variant.standardizedSize === 'Full/Queen' && variant.shopSizeKeys.join('|') === 'Full|Queen'), 'compound sizes remain exact while supporting both destinations');
check(allVariants.some((variant) => variant.standardizedSize === 'One Size' && variant.shopSizeKeys.length === 0), 'One Size does not create a narrowing destination');

console.log(`Shop by Size: ${assertions} assertions passed.`);
