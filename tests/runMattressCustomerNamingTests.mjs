import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { COMFORT_LABELS, MATTRESS_CUSTOMER_NAMING } from '../content/mattress-customer-naming.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));
const readback = readJson('docs/catalog/MATTRESS_CUSTOMER_NAMING_SHOPIFY_READBACK.json');
const dualScript = read('assets/snoozepod-dual-comfort.js');
const productHero = read('sections/snoozepod-product-hero.liquid');
const homepage = read('templates/index.json');
const navigation = read('content/content-navigation.mjs');
const sharedCommerceSurfaces = [
  read('snippets/card-product.liquid'),
  read('snippets/cart-drawer.liquid'),
  read('sections/cart-notification-product.liquid'),
  read('sections/main-cart-items.liquid'),
  read('sections/predictive-search.liquid'),
];

assert.deepEqual(COMFORT_LABELS, ['Soft', 'Medium Soft', 'Medium Firm', 'Firm']);
assert.equal(MATTRESS_CUSTOMER_NAMING.length, 4);
assert.equal(readback.summary.products, 4);
assert.equal(readback.summary.publishedThemeUnchanged, true);
assert.equal(readback.summary.commerceFingerprintPreserved, true);

const customerFacingSources = [homepage, navigation];
for (const source of customerFacingSources) {
  assert.doesNotMatch(source, /\b(?:BEDGEAR\s+)?(?:S7|H6|M3|M5)\b/);
  assert.doesNotMatch(source, /bedgear-(?:s7|h6|m3|m5)/);
}

for (const contract of MATTRESS_CUSTOMER_NAMING) {
  const product = readback.products.find((entry) => entry.handle === contract.handle);
  assert(product, contract.handle);
  assert.equal(product.title, contract.title);
  assert.doesNotMatch(product.handle, /bedgear|s7|h6|m3|m5/i);
  assert(product.media.every((media) => !/\b(?:BEDGEAR|S7|H6|M3|M5)\b/i.test(media.alt || '')));
}

const context = { globalThis: {}, document: { readyState: 'loading', addEventListener() {} } };
context.globalThis = context;
vm.runInNewContext(dualScript, context, { filename: 'snoozepod-dual-comfort.js' });
assert.deepEqual([...context.SnoozePodDualComfortContract.VALUES], COMFORT_LABELS);
assert.match(productHero, /Soft\|Medium Soft\|Medium Firm\|Firm/);
assert.match(productHero, /properties\[Left Side Comfort\]/);
assert.match(productHero, /properties\[Right Side Comfort\]/);
assert.match(productHero, /hide_mattress_vendor/);
for (const source of sharedCommerceSurfaces) {
  assert.match(source, /product_contract\.value != 'mattress'/);
  assert.match(source, /type != 'Mattress'/);
}

const menuText = JSON.stringify(readback.menus);
assert.doesNotMatch(menuText, /"title":"(?:S7|H6|M3|M5)"/);
assert.doesNotMatch(menuText, /\/products\/bedgear-(?:s7|h6|m3|m5)/);

console.log('PASS mattress customer naming and comfort labels: 18 assertions/groups.');
