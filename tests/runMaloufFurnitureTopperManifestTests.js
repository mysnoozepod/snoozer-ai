#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = require('../docs/catalog/MALOUF_FURNITURE_TOPPER_MANIFEST.json');
const readback = require('../docs/catalog/malouf-furniture-topper-shopify-readback.json');

assert.equal(manifest.shopifyStore, 'mysnoozepodtest');
assert.equal(manifest.products.length, 7);
assert.equal(manifest.products.flatMap((product) => product.variants).length, 48);
assert.equal(manifest.products.filter((product) => product.assortmentStatus === 'APPROVED').length, 6);
assert.equal(manifest.products.filter((product) => product.assortmentStatus === 'SELECTED').length, 1);
assert.ok(manifest.products.every((product) => product.shopifyStatus === 'DRAFT'));
assert.ok(manifest.products.every((product) => product.publicationReadiness === 'BLOCKED'));
assert.ok(manifest.products.every((product) => product.contract.builder_roles.length === 0));
assert.ok(manifest.products.every((product) => /^\d+$/.test(product.shopifyProductId)));
assert.ok(manifest.products.every((product) => product.variants.every((variant) => /^\d+$/.test(variant.shopifyVariantId))));

const furniture = manifest.products.filter((product) => ['Headboard', 'Platform Base'].includes(product.productType));
assert.equal(furniture.length, 6);
assert.ok(furniture.every((product) => new Set(product.variants.map((variant) => variant.options.Color)).size === 3));
assert.ok(furniture.every((product) => product.collections.includes('furniture')));

const topper = manifest.products.find((product) => product.productType === 'Mattress Topper');
assert.equal(topper.assortmentStatus, 'SELECTED');
assert.deepEqual(topper.variants.map((variant) => variant.sku), [
  'IS25TT45GT', 'IS25TX45GT', 'IS25FF45GT', 'IS25QQ45GT', 'IS25KK45GT', 'IS25CK45GT',
]);

const skus = manifest.products.flatMap((product) => product.variants.map((variant) => variant.sku));
assert.equal(new Set(skus).size, 48);
const compatibilityKeys = manifest.products.flatMap((product) => product.variants.map((variant) => variant.contract.compatibility_key));
assert.equal(new Set(compatibilityKeys).size, 48);

assert.equal(readback.store, 'mysnoozepodtest.myshopify.com');
assert.equal(readback.products.length, 7);
assert.equal(readback.products.flatMap((product) => product.variants).length, 48);
assert.ok(readback.products.every((product) => product.status === 'DRAFT'));
assert.ok(readback.products.every((product) => product.contract.publication_readiness === 'BLOCKED'));
assert.ok(readback.products.every((product) => product.variants.every((variant) => variant.contract.price_verification_status === 'HISTORICAL_REFERENCE')));
assert.ok(readback.products.every((product) => product.variants.every((variant) => variant.contract.fulfillment_readiness === 'PENDING')));

for (const product of manifest.products) {
  const actual = readback.products.find((candidate) => candidate.handle === product.handle);
  assert.ok(actual, `Readback is missing ${product.handle}.`);
  assert.equal(actual.shopifyProductId, product.shopifyProductId);
  assert.deepEqual(
    actual.variants.map((variant) => [variant.sku, variant.shopifyVariantId]).sort(),
    product.variants.map((variant) => [variant.sku, variant.shopifyVariantId]).sort(),
    `${product.handle} SKU/ID readback must match the manifest.`,
  );
}

const source = path.resolve('C:/Users/1ones/Downloads/MALOUF-PriceList-26.3-MAP.pdf');
assert.ok(fs.existsSync(source), 'The controlling Malouf source PDF must remain available for regeneration.');

console.log('Malouf furniture/topper manifest: PASS (7 Draft products, 48 verified variants, 4 collection mappings).');
