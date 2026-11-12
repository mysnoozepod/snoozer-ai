const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath).replace(/^\s*\/\*[\s\S]*?\*\//, ''));

const manifest = json('docs/catalog/STOREFRONT_SKELETON_MANIFEST.json');
const readback = json('docs/catalog/storefront-skeleton-shopify-readback.json');
const headerGroup = json('sections/header-group.json');
const footerGroup = json('sections/footer-group.json');
const collectionTemplate = json('templates/collection.snoozepod-v1.json');
const homeTemplate = json('templates/index.json');
const builderCore = read('snippets/snoozepod-guided-pod-builder-core.liquid');
const collectionNavigation = read('sections/snoozepod-collection-navigation-v1.liquid');
const productHero = read('sections/snoozepod-product-hero.liquid');
const collectionHero = read('sections/snoozepod-collection-hero.liquid');
const footerNavigation = read('sections/snoozepod-footer-navigation.liquid');

assert.equal(readback.store, 'mysnoozepodtest.myshopify.com');
assert.equal(readback.products.length, manifest.expectedProductCount);
assert.equal(readback.collections.length, manifest.expectedCollectionCount);
assert.ok(readback.products.every((product) => product.status === 'DRAFT'));
assert.ok(readback.products.every((product) => product.collections.length > 0));

const products = new Map(readback.products.map((product) => [product.handle, product]));
const collections = new Map(readback.collections.map((collection) => [collection.handle, collection]));
assert.equal(products.size, 43);
assert.equal(collections.size, 18);

for (const [handle, override] of Object.entries(manifest.productOverrides)) {
  const product = products.get(handle);
  assert.ok(product, `Missing product ${handle}`);
  assert.equal(product.title, override.title, `${handle} title`);
  assert.equal(product.templateSuffix, override.templateSuffix, `${handle} template`);
}

for (const product of readback.products) {
  if (!manifest.productOverrides[product.handle]) {
    assert.equal(product.templateSuffix, manifest.productTemplateDefault, `${product.handle} template`);
  }
}

const expectedCollectionCounts = {
  mattresses: 4,
  'adjustable-bases': 3,
  pillows: 16,
  'zoned-pillows': 4,
  'filled-pillows': 4,
  'foam-pillows': 4,
  'temperature-regulating-pillows': 4,
  sheets: 3,
  'mattress-protectors': 3,
  comforters: 3,
  'cooling-bedding': 3,
  'mattress-toppers': 2,
  'bedroom-furniture': 6,
  headboards: 4,
  'platform-bases': 2,
  bedding: 10,
  furniture: 6,
  'sheet-sets': 3,
};

for (const collectionContract of manifest.collections) {
  const collection = collections.get(collectionContract.handle);
  assert.ok(collection, `Missing collection ${collectionContract.handle}`);
  assert.equal(collection.templateSuffix, 'snoozepod-v1', `${collectionContract.handle} template`);
  assert.equal(collection.products.length, expectedCollectionCounts[collectionContract.handle], `${collectionContract.handle} membership count`);
  if (collectionContract.products) {
    assert.deepEqual([...collection.products].sort(), [...collectionContract.products].sort(), `${collectionContract.handle} exact membership`);
  }
}

for (const [handle, expected] of Object.entries(manifest.categoryNavigation)) {
  const expectedIds = expected.map((collectionHandle) => manifest.verifiedIds.collections[collectionHandle]);
  assert.deepEqual(collections.get(handle).categoryNavigation, expectedIds, `${handle} category navigation`);
}

const actualMenus = new Map(readback.menus.map((menu) => [menu.handle, menu]));
const compareMenuItems = (expectedItems, actualItems, parent = 'menu') => {
  assert.deepEqual(actualItems.map((item) => item.title), expectedItems.map((item) => item.title), `${parent} item order`);
  expectedItems.forEach((expected, index) => {
    const actual = actualItems[index];
    assert.equal(actual.type, expected.type, `${parent} > ${expected.title} type`);
    assert.ok(actual.url, `${parent} > ${expected.title} URL`);
    if (expected.type !== 'FRONTPAGE') assert.ok(actual.resourceId, `${parent} > ${expected.title} resource`);
    compareMenuItems(expected.items || [], actual.items || [], `${parent} > ${expected.title}`);
  });
};

for (const [handle, menuContract] of Object.entries(manifest.menus)) {
  const actual = actualMenus.get(handle);
  assert.ok(actual, `Missing menu ${handle}`);
  compareMenuItems(menuContract.items, actual.items, handle);
}

assert.equal(headerGroup.sections.header.settings.menu, 'main-menu');
assert.equal(headerGroup.sections.header.settings.menu_type_desktop, 'dropdown');
assert.equal(footerGroup.sections['experience-navigation'].type, 'snoozepod-footer-navigation');
assert.ok(footerGroup.order.indexOf('experience-navigation') < footerGroup.order.indexOf('newsletter'));
assert.match(footerNavigation, /Shop/);
assert.match(footerNavigation, /Visit &amp; Guidance/);
assert.match(footerNavigation, /Customer Support/);

const expectedTopLevelCollections = [
  'mattresses',
  'adjustable-bases',
  'pillows',
  'sheets',
  'mattress-protectors',
  'comforters',
  'cooling-bedding',
  'mattress-toppers',
  'bedroom-furniture',
];
const collectionNavigationHandles = collectionTemplate.sections['category-navigation'].block_order.map(
  (blockId) => collectionTemplate.sections['category-navigation'].blocks[blockId].settings.collection,
);
assert.deepEqual(collectionNavigationHandles, expectedTopLevelCollections);
assert.match(collectionNavigation, /"limit": 12/);

const environment = homeTemplate.sections.snoozepod_environment_GYx7gN;
const homeCollectionHandles = environment.block_order.map((blockId) => environment.blocks[blockId].settings.collection);
assert.deepEqual(homeCollectionHandles, expectedTopLevelCollections.filter((handle) => handle !== 'mattresses'));
assert.equal(environment.settings.cta_link, '/collections');

assert.match(builderCore, /bedding_collection_handles = 'sheets,bedding'/);
assert.doesNotMatch(builderCore, /bedding_collection_handles = 'sheet-sets,bedding'/);
assert.match(productHero, /aria-label="Breadcrumb"/);
assert.match(collectionHero, /aria-label="Breadcrumb"/);
assert.ok(manifest.knownContentGaps.some((gap) => gap.includes('Warranty page')));
assert.ok(manifest.knownContentGaps.some((gap) => gap.includes('Showroom Information page')));

console.log('Storefront skeleton: 43 Draft products, 18 collections, exact nested menus, canonical homepage routes, templates, breadcrumbs, footer exposure, and builder collection mappings passed.');
