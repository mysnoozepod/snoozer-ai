const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const manifest = readJson('docs/catalog/CATALOG_SHOPPING_RESTRUCTURE_MANIFEST.json');
const readback = readJson('docs/catalog/catalog-shopping-restructure-shopify-readback.json');
const navigationReadbackPath = path.join(ROOT, 'docs/content-pages/CONTENT_NAVIGATION_SHOPIFY_READBACK.json');
const navigationReadback = fs.existsSync(navigationReadbackPath) ? JSON.parse(fs.readFileSync(navigationReadbackPath, 'utf8')) : null;
const baseline = readJson('docs/catalog/catalog-shopping-restructure-before.json');
const hero = read('sections/snoozepod-product-hero.liquid');
const homepage = read('templates/index.json');
const dualScript = read('assets/snoozepod-dual-comfort.js');
const canonicalProductHandle = (handle) => ({
  'bedgear-s7-12-memory-foam': '12-inch-memory-foam-mattress',
  'bedgear-h6-12-hybrid': '12-inch-hybrid-mattress',
  'bedgear-m3-12-dual-comfort': '12-inch-dual-comfort-mattress',
  'bedgear-m5-14-dual-comfort': '14-inch-dual-comfort-mattress',
}[handle] || handle);

const context = {
  globalThis: {},
  document: { readyState: 'loading', addEventListener() {} },
};
context.globalThis = context;
vm.runInNewContext(dualScript, context, { filename: 'snoozepod-dual-comfort.js' });
const dual = context.SnoozePodDualComfortContract;

test('the immutable baseline records the 43-product untagged manual-collection starting point', () => {
  assert.deepEqual(baseline.summary, {
    products: 43, draftProducts: 43, taggedProducts: 0, variants: 274,
    collections: 18, automatedCollections: 0, manualCollections: 18, menus: 4,
  });
});

test('all 43 products remain Draft and receive the required namespaced taxonomy', () => {
  assert.equal(manifest.products.length, 43);
  assert.equal(readback.summary.products, 43);
  assert.equal(readback.summary.draftProducts, 43);
  assert.equal(readback.summary.taggedProducts, 43);
  assert.equal(readback.summary.variants, 274);
  for (const product of readback.products) {
    assert.equal(product.status, 'DRAFT', product.handle);
    assert(product.tags.some((tag) => tag.startsWith('category:')), product.handle);
    assert(product.tags.some((tag) => tag.startsWith('subcategory:')), product.handle);
    assert(product.tags.some((tag) => tag.startsWith('type:')), product.handle);
    assert(product.tags.some((tag) => tag.startsWith('collection:')), product.handle);
  }
});

test('all 25 required collections are automated by one exact collection tag', () => {
  assert.equal(manifest.collections.length, 25);
  assert.equal(readback.summary.automatedCollections, 25);
  const actual = new Map(readback.collections.map((collection) => [collection.handle, collection]));
  const ids = new Map(readback.collections.map((collection) => [collection.handle, collection.id]));
  for (const expected of manifest.collections) {
    const collection = actual.get(expected.handle);
    assert(collection, expected.handle);
    assert.deepEqual(collection.ruleSet, {
      appliedDisjunctively: false,
      rules: [{ column: 'TAG', relation: 'EQUALS', condition: expected.ruleTag }],
    });
    assert.deepEqual(collection.products.map(canonicalProductHandle).sort(), [...expected.expectedProducts].sort(), expected.handle);
    assert(collection.image?.url, `${expected.handle} collection image`);
    assert(collection.categoryNavigation, `${expected.handle} category navigation`);
    assert.deepEqual(
      JSON.parse(collection.categoryNavigation),
      manifest.categoryNavigation[expected.handle].map((handle) => ids.get(handle)),
      `${expected.handle} category navigation`,
    );
  }
});

test('main navigation preserves existing destinations and adds mattress/base family destinations', () => {
  const menu = navigationReadback?.menus.find((item) => item.handle === 'main-menu') || readback.mainMenu;
  const mattresses = menu.items.find((item) => item.title === 'Mattresses');
  const bases = menu.items.find((item) => item.title === 'Adjustable Bases');
  assert.deepEqual(mattresses.items.slice(0, 5).map((item) => item.title), ['Shop All Mattresses', '12-inch Memory Foam', '12-inch Hybrid', '12-inch Dual Comfort', '14-inch Dual Comfort']);
  assert.deepEqual(bases.items.slice(0, 4).map((item) => item.title), ['Shop All Adjustable Bases', 'Flex L', 'Flex LSX', 'Flex SH']);
  if (navigationReadback) {
    assert(mattresses.items.find((item) => item.title === 'Mattress Buying Guides'));
    assert(bases.items.find((item) => item.title === 'Adjustable Base Guides'));
    const guidesAndTools = menu.items.find((item) => item.title === 'Guides & Tools');
    assert(guidesAndTools);
    assert(guidesAndTools.items.find((item) => item.title === 'Explore All Sleep Guides'));
    assert(guidesAndTools.items.find((item) => item.title === 'Build Your SnoozePod'));
  }
  assert(menu.items.find((item) => item.title === 'Your Showroom Visit'));
  assert(menu.items.find((item) => item.title === 'Our Story'));
});

test('all mattress products use Product Page v1 and no assigned product uses a Pod Builder template', () => {
  const mattresses = readback.products.filter((product) => product.tags.includes('category:mattresses'));
  assert.equal(mattresses.length, 4);
  assert(mattresses.every((product) => product.templateSuffix === 'snoozepod-v1'));
  assert(!readback.products.some((product) => /pod-builder/i.test(product.templateSuffix || '')));
});

test('the active homepage contains no Pod Builder section or customer-facing builder copy', () => {
  assert(!homepage.includes('"type": "snoozepod-final-build-cta"'));
  assert(!homepage.includes('Build Your SnoozePod'));
  assert(homepage.includes('"type": "snoozepod-collection-cta"'));
});

test('Product Page v1 retains the standard Shopify form, Ask Snoozer, gallery, feel, and description blocks', () => {
  for (const marker of [
    "render 'product-media-gallery'", "render 'product-variant-picker'", "render 'buy-buttons'",
    "render 'snoozepod-product-feel'", 'data-snoozer-trigger', 'product__description',
  ]) assert(hero.includes(marker), marker);
});

test('Dual Comfort controls expose independent customer-facing values and cart properties', () => {
  assert.deepEqual([...dual.VALUES], ['Soft', 'Medium Soft', 'Medium Firm', 'Firm']);
  assert(hero.includes('Left Side Comfort'));
  assert(hero.includes('Right Side Comfort'));
  assert(hero.includes('properties[Left Side Comfort]'));
  assert(hero.includes('properties[Right Side Comfort]'));
  assert(hero.includes('aria-live="polite"'));
  assert(hero.includes('data-comfort-policy="all-pairs"'));
  assert(hero.includes('"acceptsAnyComfortPair": true'));
});

test('Dual Comfort allows all 16 owner-approved comfort pairs for an available size', () => {
  const mappings = [
    { variantId: 101, size: 'Queen', acceptsAnyComfortPair: true, available: true },
    { variantId: 103, size: 'King', acceptsAnyComfortPair: true, available: false },
  ];
  for (const left of dual.VALUES) {
    for (const right of dual.VALUES) {
      assert.equal(dual.resolveMapping(mappings, { size: 'Queen', left, right }).variantId, 101, `${left} / ${right}`);
    }
  }
  assert.equal(dual.resolveMapping(mappings, { size: 'King', left: 'Soft', right: 'Firm' }), null);
  assert.equal(dual.resolveMapping(mappings, { size: '', left: 'Soft', right: 'Firm' }), null);
  assert.equal(dual.resolveMapping(mappings, { size: 'Queen', left: 'Unknown', right: 'Firm' }), null);
});

test('Dual Comfort enables complete owner-approved selections and fails closed when incomplete or unavailable', () => {
  assert(dualScript.includes("submit.disabled = true"));
  assert(dualScript.includes("submit.disabled = false"));
  assert(dualScript.includes("event.preventDefault()"));
  assert(dualScript.includes("root.dataset.orderable !== 'true'"));
  assert(dualScript.includes("if (label) label.textContent = originalSubmitLabel"));
  assert(dualScript.includes("closest('fieldset')?.querySelector('legend')"));
  assert.equal(manifest.dualComfort.comfortPairsPerAvailableSize, 16);
  assert.deepEqual(manifest.dualComfort.failClosedWhen, ['size unavailable', 'left comfort missing', 'right comfort missing']);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} catalog and shopping restructure assertions passed.`);
