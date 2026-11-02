#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = require('../docs/catalog/BEDGEAR_CATALOG_MANIFEST.json');
const readback = require('../docs/catalog/bedgear-shopify-catalog-readback.json');

assert.equal(manifest.shopifyStore, 'mysnoozepodtest');
assert.equal(manifest.products.length, 16);
assert.equal(manifest.products.flatMap((product) => product.variants).length, 146);
assert.equal(manifest.products.filter((product) => product.assortmentStatus === 'APPROVED').length, 12);
assert.equal(manifest.products.filter((product) => product.assortmentStatus === 'SELECTED').length, 4);
assert.equal(manifest.collections.length, 5);
assert.ok(manifest.products.every((product) => product.shopifyStatus === 'DRAFT'));
assert.ok(manifest.products.every((product) => product.publicationReadiness === 'BLOCKED'));
assert.ok(manifest.products.every((product) => /^\d+$/.test(product.shopifyProductId)));
assert.ok(manifest.products.every((product) => product.variants.every((variant) => /^\d+$/.test(variant.shopifyVariantId))));

const skus = manifest.products.flatMap((product) => product.variants.map((variant) => variant.sku));
assert.equal(new Set(skus).size, 146);
assert.ok(skus.every((sku) => /^[A-Z0-9-]+$/.test(sku)));
const compatibilityKeys = manifest.products.flatMap((product) => product.variants.map((variant) => variant.contract.compatibility_key));
assert.equal(new Set(compatibilityKeys).size, 146);

const flexLsx = manifest.products.find((product) => product.handle === 'flex-lsx-adjustable-base');
const flexSh = manifest.products.find((product) => product.handle === 'flex-sh-adjustable-base');
assert.deepEqual(flexLsx.variants.map((variant) => variant.options.Size), ['Twin XL', 'Queen', 'King', 'Cal King', 'Split Cal King']);
assert.deepEqual(flexSh.variants.map((variant) => variant.options.Size), ['Split Head Queen', 'Split Head King', 'Split Head Cal King']);

const cotton = manifest.products.find((product) => product.handle === 'cotton-sheet-set');
const driTecSheets = manifest.products.find((product) => product.handle === 'dri-tec-sheet-set');
const verTexSheets = manifest.products.find((product) => product.handle === 'ver-tex-sheet-set');
assert.equal(cotton.variants.length, 36);
assert.equal(driTecSheets.variants.length, 41);
assert.equal(verTexSheets.variants.length, 18);
assert.ok([cotton, driTecSheets, verTexSheets].every((product) => product.variants.some((variant) => variant.contract.sleep_geometry === 'split_head')));

const encasement = manifest.products.find((product) => product.handle === 'stretchwick-mattress-encasement');
assert.ok(encasement.variants.every((variant) => variant.contract.sleep_geometry !== 'split_head'));
assert.ok(encasement.variants.every((variant) => variant.contract.sleep_geometry !== 'full_split'));

assert.equal(manifest.excludedPendingDecision.length, 1);
assert.equal(manifest.excludedPendingDecision[0].item, 'Cooling Blanket');
assert.match(manifest.excludedPendingDecision[0].reason, /Navy or Grey/);

assert.equal(readback.store, 'mysnoozepodtest.myshopify.com');
assert.equal(readback.products.length, 16);
assert.equal(readback.products.flatMap((product) => product.variants).length, 146);
assert.ok(readback.products.every((product) => product.status === 'DRAFT'));
assert.ok(readback.products.every((product) => product.contract.publication_readiness === 'BLOCKED'));
assert.ok(readback.products.every((product) => ['APPROVED', 'SELECTED'].includes(product.contract.assortment_status)));
assert.ok(readback.products.every((product) => product.variants.every((variant) => variant.contract.price_verification_status === 'HISTORICAL_REFERENCE')));
assert.ok(readback.products.every((product) => product.variants.every((variant) => variant.contract.fulfillment_readiness === 'PENDING')));

for (const product of manifest.products) {
  const actual = readback.products.find((candidate) => candidate.handle === product.handle);
  assert.ok(actual, `Readback is missing ${product.handle}.`);
  assert.equal(actual.shopifyProductId, product.shopifyProductId);
  assert.deepEqual(
    actual.variants.map((variant) => [variant.sku, variant.shopifyVariantId, variant.barcode]).sort(),
    product.variants.map((variant) => [variant.sku, variant.shopifyVariantId, variant.upc]).sort(),
    `${product.handle} SKU/ID/UPC readback must match the manifest.`,
  );
}

const workbookSource = path.resolve('C:/Users/1ones/Downloads/Bedgear Master PL Sept 2026.xlsx');
assert.ok(fs.existsSync(workbookSource), 'The controlling BEDGEAR source workbook must remain available for regeneration.');

console.log('BEDGEAR catalog manifest: PASS (16 Draft products, 146 verified variants, 5 collections).');
