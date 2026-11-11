const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shopBySize = require(path.join(root, 'assets', 'snoozepod-shop-by-size.js'));
const section = fs.readFileSync(path.join(root, 'sections', 'main-collection-product-grid.liquid'), 'utf8');
const card = fs.readFileSync(path.join(root, 'snippets', 'card-product.liquid'), 'utf8');
const feed = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'product-knowledge', 'PRODUCT_KNOWLEDGE_FEED.v1.json'), 'utf8'));

let assertions = 0;
function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

assert.deepEqual(shopBySize.STANDARD_SIZES, ['Twin', 'Twin XL', 'Full', 'Queen', 'King', 'California King']);
assertions += 1;
assert.equal(shopBySize.normalizeSize('Cal King'), 'California King');
assertions += 1;
assert.equal(shopBySize.normalizeSize('California King'), 'California King');
assertions += 1;
assert.equal(shopBySize.normalizeSize('Split King'), null);
assertions += 1;

const representativeVariants = [
  { variantId: '101', nativeSize: 'Queen', available: true, price: '$1,999.00' },
  { variantId: '102', nativeSize: 'King', available: false, price: '$2,499.00' },
  { variantId: '103', nativeSize: 'Cal King', available: true, price: '$2,499.00' },
];
assert.equal(shopBySize.eligibleVariant(representativeVariants, 'Queen').variantId, '101');
assertions += 1;
assert.equal(shopBySize.eligibleVariant(representativeVariants, 'King'), null, 'unavailable variants must not be eligible');
assertions += 1;
assert.equal(shopBySize.eligibleVariant(representativeVariants, 'California King').variantId, '103');
assertions += 1;

assert.equal(shopBySize.selectedSizeFromSearch('?size=Twin+XL'), 'Twin XL');
assertions += 1;
assert.equal(shopBySize.selectedSizeFromSearch('?filter.v.option.size=Cal+King'), 'California King');
assertions += 1;
assert.equal(shopBySize.selectedSizeFromSearch('?filter.v.option.size=Queen&filter.v.option.size=King'), null);
assertions += 1;

assert.equal(
  shopBySize.productUrlForVariant('/products/example?ref=collection', '101', 'Queen'),
  '/products/example?ref=collection&variant=101&size=Queen',
);
assertions += 1;
assert.equal(
  shopBySize.filterUrl('?sort_by=price-ascending&filter.v.option.size=King&page=2', 'California King'),
  '?sort_by=price-ascending&size=California+King&filter.v.option.size=Cal+King',
);
assertions += 1;
assert.equal(shopBySize.filterUrl('?size=Queen&filter.v.option.size=Queen', null), '');
assertions += 1;

for (const size of shopBySize.STANDARD_SIZES) {
  check(section.includes(`data-shop-by-size-option="{{ snoozepod_size }}"`) && section.includes(`'Twin|Twin XL|Full|Queen|King|California King'`), `${size} is represented by the canonical size list`);
}
check(section.includes('variant.available | json'), 'Liquid availability is the storefront eligibility authority');
check(section.includes('variant.id | json'), 'Shopify variant IDs are emitted for variant deep links');
check(section.includes('variant.price | money | json'), 'variant-specific Shopify prices are emitted');
check(section.includes("product_option_name_normalized == 'size'") && section.includes('snoozepod_variant_size'), 'Liquid finds the named Size option instead of assuming a fixed option position');
check(section.includes("collection.handle == 'mattresses'"), 'Shop by Size is bounded to the mattress collection');
check(card.includes('data-shop-by-size-price'), 'product cards expose a selected-size price surface');
check(section.includes('aria-live="polite"'), 'filter results are announced accessibly');

const mattresses = feed.products.filter((product) => product.categoryContract === 'mattress');
assert.equal(mattresses.length, 4);
assertions += 1;
const allMattressVariants = mattresses.flatMap((product) => product.commerce.variants);
check(allMattressVariants.every((variant) => variant.shopifyVariantId.startsWith('gid://shopify/ProductVariant/')), 'every mattress variant retains its Shopify identity');
check(allMattressVariants.every((variant) => variant.sku), 'every mattress variant retains its manufacturer SKU');
check(allMattressVariants.every((variant) => /^\d+\.\d{2}$/.test(variant.price)), 'every mattress variant retains its Shopify price');
check(allMattressVariants.every((variant) => typeof variant.standardizedSize === 'string'), 'every mattress variant exports a standardized size');
check(allMattressVariants.some((variant) => variant.options.Size === 'Cal King' && variant.standardizedSize === 'California King'), 'Cal King is normalized without changing the native Shopify option');
check(allMattressVariants.every((variant) => variant.contract['custom.sleep_geometry']), 'every mattress variant retains explicit geometry');
check(allMattressVariants.every((variant) => variant.contract['custom.compatibility_key']), 'every mattress variant retains a compatibility key');
check(mattresses.every((product) => [null, 'Plush', 'Medium Plush', 'Medium Firm', 'Firm'].includes(product.feelLabel)), 'mattress Feel stays within the approved vocabulary');

const dualComfort = mattresses.find((product) => product.handle === '12-inch-dual-comfort-mattress');
check(!dualComfort.commerce.variants.some((variant) => variant.standardizedSize === 'Full'), 'a missing Full variant is not invented for Dual Comfort');
check(dualComfort.commerce.variants.some((variant) => variant.standardizedSize === 'Queen' && variant.price === '2499.00'), 'representative exact Queen price remains mapped');

console.log(`Shop by Size: ${assertions} assertions passed.`);
