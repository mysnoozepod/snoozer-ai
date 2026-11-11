import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'storewide-shop-by-size', 'STOREWIDE_SIZE_COLLECTIONS_MANIFEST.json'), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'catalog', 'catalog-shopping-restructure-current-inspection.json'), 'utf8'));
const mapSource = fs.readFileSync(path.join(root, 'assets', 'snoozepod-size-collection-map.js'), 'utf8');
const sizeMap = JSON.parse(mapSource.replace(/^window\.SnoozePodSizeCollections = /, '').replace(/;\s*$/, ''));

let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }

equal(inventory.summary.products, 43);
equal(inventory.summary.variants, 274);
equal(manifest.summary.taggedProducts, 42);
equal(manifest.summary.storewideSizes, 15);
equal(manifest.summary.categories, 9);
equal(manifest.summary.collections, 77);
equal(manifest.summary.excludedOneSizeVariants, 1);
equal(new Set(manifest.collections.map((collection) => collection.handle)).size, 77, 'collection handles are unique');
check(manifest.collections.every((collection) => collection.productHandles.length > 0), 'no empty collections are generated');
check(manifest.collections.every((collection) => collection.rules.every((rule) => rule.column === 'TAG' && rule.relation === 'EQUALS')), 'all automated membership rules use exact tags');
check(!manifest.collections.some((collection) => collection.sizeLabel === 'One Size'), 'One Size is not exposed as a collection');

const products = new Map(inventory.products.nodes.map((product) => [product.handle, product]));
const plans = new Map(manifest.products.map((product) => [product.handle, product]));
for (const plan of manifest.products) {
  const liveProduct = products.get(plan.handle);
  check(Boolean(liveProduct), `${plan.handle} exists in the inventory`);
  check(plan.desiredTags.includes('shop-by-size:true'), `${plan.handle} has the master marker`);
  for (const size of plan.shopSizes) {
    const slug = size.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    check(plan.desiredTags.includes(`shop-size:${slug}`), `${plan.handle} has exact ${size} membership`);
  }
}
equal(plans.has('cooling-throw'), false, 'the One Size-only throw is not marked for size shopping');

for (const collection of manifest.collections) {
  for (const handle of collection.productHandles) check(products.has(handle), `${collection.handle} references a real product`);
  if (collection.sizeLabel) {
    const slug = collection.sizeLabel.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    for (const handle of collection.productHandles) check(plans.get(handle).desiredTags.includes(`shop-size:${slug}`), `${handle} supports ${collection.sizeLabel}`);
  }
}

equal(sizeMap.storewide.length, 15);
equal(sizeMap.categories.length, 9);
check(sizeMap.storewide.some((size) => size.label === 'Texas King'), 'Texas King is included because a live variant supports it');
check(sizeMap.storewide.some((size) => size.label === 'Twin XL x 2'), 'Twin XL x 2 remains an exact distinct configuration');
check(sizeMap.categories.find((category) => category.key === 'pillows').sizes.some((size) => size.label === 'Standard'), 'Standard pillow routing exists');
check(sizeMap.categories.find((category) => category.key === 'bedroom-furniture').sizes.some((size) => size.label === 'California King'), 'furniture size routing exists');

console.log(`Storewide Shop by Size: ${assertions} assertions passed.`);
