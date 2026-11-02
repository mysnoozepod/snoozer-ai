const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = require('../docs/catalog/MVP_CATALOG_MANIFEST.json');

assert.equal(manifest.shopifyStore, 'mysnoozepodtest');
assert.equal(manifest.products.length, 16, 'The approved pillow assortment must contain exactly 16 products.');
assert.equal(manifest.collections.length, 5, 'Pillows must have one canonical and four merchandising collections.');

const handles = manifest.products.map((product) => product.handle);
const skus = manifest.products.flatMap((product) => product.variants.map((variant) => variant.sku));
assert.equal(new Set(handles).size, handles.length, 'Product handles must be unique.');
assert.equal(new Set(skus).size, skus.length, 'Manufacturer SKUs must be unique.');
assert.equal(skus.length, 43, 'The bounded approved pillow variant manifest must contain 43 SKU rows.');

for (const product of manifest.products) {
  assert.equal(product.assortmentStatus, 'APPROVED');
  assert.equal(product.publicationReadiness, 'BLOCKED');
  assert.equal(product.shopifyStatus, 'DRAFT');
  assert.equal(product.manufacturer, 'Malouf');
  assert.equal(product.productType, 'Pillow');
  assert.ok(product.collections.includes('pillows'));
  assert.ok(product.source.pdfPage >= 49 && product.source.pdfPage <= 91);
  for (const variant of product.variants) {
    assert.match(variant.sku, /^[A-Z0-9]+$/);
    assert.match(variant.referencePrice, /^\d+\.\d{2}$/);
    assert.ok(variant.options.Size, `${product.handle} variant ${variant.sku} must include Size.`);
  }
}

const existing = manifest.products.find((product) => product.handle === 'gelled-microfiber-pillow');
assert.equal(existing.shopifyProductId, '8099363094589');
assert.deepEqual(existing.variants.map((variant) => variant.shopifyVariantId), ['44049793777725', '44049793810493']);
assert.ok(manifest.shopifyReadbackVerifiedAt, 'A successful Shopify readback timestamp must be recorded.');
assert.ok(manifest.collections.every((collection) => /^\d+$/.test(collection.shopifyCollectionId)), 'Every staged collection must have a verified Shopify ID.');
assert.ok(manifest.products.every((product) => /^\d+$/.test(product.shopifyProductId)), 'Every staged product must have a verified Shopify ID.');
assert.ok(manifest.products.every((product) => product.variants.every((variant) => /^\d+$/.test(variant.shopifyVariantId))), 'Every staged variant must have a verified Shopify ID.');

const cbd = manifest.products.filter((product) => /cbd/i.test(product.title) || product.variants.some((variant) => /CBD/i.test(variant.sku)));
assert.equal(cbd.length, 0, 'CBD pillow products must remain excluded.');

const zonedGelDough = manifest.products.find((product) => product.handle === 'zoned-gel-dough-pillow');
assert.deepEqual([...new Set(zonedGelDough.variants.map((variant) => variant.options.Loft))], ['High', 'Mid', 'Low']);
assert.ok(zonedGelDough.variants.every((variant) => !variant.sku.includes('SC')), 'Unapproved shoulder variants must not enter Zoned Gel Dough.');

const shoulderActiveDough = manifest.products.find((product) => product.handle === 'shoulder-zoned-gel-activedough-pillow');
assert.ok(shoulderActiveDough.variants.every((variant) => variant.sku.includes('SC')));

const csvPath = path.resolve(__dirname, '..', 'docs', 'catalog', 'import', 'malouf-pillows-p1-005b.csv');
if (fs.existsSync(csvPath)) {
  const csv = fs.readFileSync(csvPath, 'utf8');
  assert.ok(csv.startsWith('Handle,Title,'));
  const lines = csv.trim().split(/\r?\n/);
  const csvHeaders = lines[0].split(',');
  const publishedIndex = csvHeaders.indexOf('Published');
  const statusIndex = csvHeaders.indexOf('Status');
  const csvRows = lines.slice(1).map((line) => line.split(','));
  assert.equal(csvRows.length, 41);
  assert.ok(csvRows.every((row) => row[publishedIndex] === 'FALSE'), 'Every new variant import row must be unpublished.');
  assert.ok(csvRows.every((row) => row[statusIndex] === 'draft'), 'Every new variant import row must be draft.');
  assert.ok(!csv.includes('gelled-microfiber-pillow'), 'The import must not duplicate the existing draft product.');
}

const readbackPath = path.resolve(__dirname, '..', 'docs', 'catalog', 'shopify-catalog-readback.json');
assert.ok(fs.existsSync(readbackPath), 'The verified Shopify readback must exist.');
const readback = JSON.parse(fs.readFileSync(readbackPath, 'utf8'));
assert.equal(readback.store, 'mysnoozepodtest.myshopify.com');
assert.equal(readback.apiVersion, '2025-10');
assert.equal(readback.products.length, 16);
assert.equal(readback.collections.length, 5);
assert.ok(readback.products.every((product) => product.status === 'DRAFT'), 'Every staged Shopify product must remain Draft.');
assert.equal(readback.products.flatMap((product) => product.variants).length, 43);
assert.ok(readback.products.every((product) => product.contract.assortment_status === 'APPROVED'));
assert.ok(readback.products.every((product) => product.contract.publication_readiness === 'BLOCKED'));
assert.ok(readback.products.every((product) => product.contract.builder_roles === '["pillow"]'));
assert.ok(readback.products.every((product) => product.contract.owner_content_status === 'PENDING'));
assert.ok(readback.products.every((product) => product.variants.every((variant) => variant.contract.sleep_geometry === 'not_applicable')));
assert.ok(readback.products.every((product) => product.variants.every((variant) => variant.contract.price_verification_status === 'HISTORICAL_REFERENCE')));
assert.ok(readback.products.every((product) => product.variants.every((variant) => variant.contract.fulfillment_readiness === 'PENDING')));
const compatibilityKeys = readback.products.flatMap((product) => product.variants.map((variant) => variant.contract.compatibility_key));
assert.equal(new Set(compatibilityKeys).size, 43, 'Every staged variant must have a unique compatibility key.');
assert.ok(compatibilityKeys.every((key) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)));
for (const product of manifest.products) {
  const actual = readback.products.find((candidate) => candidate.handle === product.handle);
  assert.ok(actual, `Readback is missing ${product.handle}.`);
  assert.equal(actual.shopifyProductId, product.shopifyProductId);
  assert.deepEqual(
    actual.variants.map((variant) => [variant.sku, variant.shopifyVariantId]).sort(),
    product.variants.map((variant) => [variant.sku, variant.shopifyVariantId]).sort(),
    `${product.handle} variant IDs must match the verified readback.`,
  );
}

console.log('MVP catalog manifest: PASS (16 approved pillow products, 43 variants).');
