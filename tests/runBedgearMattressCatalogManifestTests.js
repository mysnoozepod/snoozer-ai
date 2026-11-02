const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const manifestPath = path.join(ROOT, "docs", "catalog", "BEDGEAR_MATTRESS_CATALOG_MANIFEST.json");
const readbackPath = path.join(ROOT, "docs", "catalog", "bedgear-mattress-shopify-readback.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const readback = JSON.parse(fs.readFileSync(readbackPath, "utf8"));

const expected = new Map([
  ["S7", { title: 'S7 — 12" Memory Foam Mattress', variants: 10, displays: 1 }],
  ["H6", { title: 'H6 — 12" Hybrid Mattress', variants: 10, displays: 1 }],
  ["M3", { title: 'M3 — 12" Dual Comfort Mattress', variants: 8, displays: 2 }],
  ["M5", { title: 'M5 — 14" Dual Comfort Mattress', variants: 9, displays: 2 }],
]);

assert.equal(manifest.expectedProductCount, 4);
assert.equal(manifest.expectedVariantCount, 37);
assert.equal(manifest.products.length, 4);
assert.equal(manifest.collections.length, 1);
assert.equal(manifest.collections[0].title, "Mattresses");
assert.equal(manifest.collections[0].handle, "mattresses");
assert.equal(manifest.collections[0].templateSuffix, "snoozepod-v1");
assert.equal(manifest.collections[0].role, "CANONICAL_BUILDER_SOURCE");
assert.equal(manifest.collections[0].requiredForLaunch, true);
assert.ok(manifest.collections[0].shopifyCollectionId);

const allSkus = [];
for (const product of manifest.products) {
  const wanted = expected.get(product.model);
  assert.ok(wanted, `Unexpected model ${product.model}`);
  assert.equal(product.title, wanted.title);
  assert.equal(product.variants.length, wanted.variants);
  assert.equal(product.shopifyStatus, "DRAFT");
  assert.equal(product.assortmentStatus, "APPROVED");
  assert.equal(product.publicationReadiness, "BLOCKED");
  assert.equal(product.templateSuffix, "product-pod-builder");
  assert.deepEqual(product.collections, ["mattresses"]);
  assert.deepEqual(product.contract.builder_roles, ["mattress"]);
  assert.equal(product.contract.model, product.model);
  assert.equal(product.contract.showroom_representation.type, "json");
  assert.equal(product.contract.showroom_representation.value.displayCount, wanted.displays);
  assert.equal(product.contract.showroom_representation.value.locationStatus, "PENDING_LOCATION");
  assert.deepEqual(product.contract.showroom_representation.value.locations, []);

  for (const variant of product.variants) {
    assert.ok(variant.sku);
    assert.match(variant.referencePrice, /^\d+\.\d{2}$/);
    assert.equal(variant.contract.price_verification_status, "HISTORICAL_REFERENCE");
    assert.equal(variant.contract.fulfillment_readiness, "PENDING");
    assert.ok(["standard", "split_head", "full_split"].includes(variant.contract.sleep_geometry));
    allSkus.push(variant.sku);
  }

  if (["M3", "M5"].includes(product.model)) {
    assert.deepEqual(product.dualComfort.componentFeelLabelsVerified, ["0.0", "1.0", "2.0", "3.0"]);
    assert.equal(product.dualComfort.independentLeftRightSelection, "PENDING_APPROVED_COMPLETE_CONFIGURATION_MAP");
    assert.equal(product.contract.configuration_readiness, "PENDING_VENDOR_CONFIGURATION_MAP");
    assert.equal(product.contract.comfort_options.type, "json");
    for (const variant of product.variants) {
      assert.equal(variant.skuScope, "CHASSIS_AND_COMFORT_LAYER_COMPONENT_ONLY");
      assert.equal(variant.configurationStatus, "PENDING_APPROVED_COMPLETE_SELL_UNIT_AND_LEFT_RIGHT_COMBINATION_MAP");
      assert.equal(variant.contract.comfort_configuration_code, undefined);
      assert.equal(variant.contract.fulfillment_components, undefined);
      assert.deepEqual(
        variant.verifiedSpecifications.manufacturerComponentFeelOptions.map((option) => option.feel),
        ["0.0", "1.0", "2.0", "3.0"],
      );
    }
  }
}

assert.equal(new Set(allSkus).size, 37, "All staged manufacturer SKUs must be unique");
const m3 = manifest.products.find((product) => product.model === "M3");
const m5 = manifest.products.find((product) => product.model === "M5");
assert.equal(m3.variants.some((variant) => variant.options.Size === "Split King"), false);
assert.equal(m3.excludedManufacturerRows[0].size, "Split King");
assert.equal(m5.variants.some((variant) => variant.options.Size === "Twin XL x 2"), true);
assert.equal(m5.variants.find((variant) => variant.sku === "BGM506W81").contract.sleep_geometry, "full_split");

assert.equal(readback.store, "mysnoozepodtest.myshopify.com");
assert.equal(readback.products.length, 4);
assert.equal(readback.collections.length, 1);
assert.equal(readback.collections[0].handle, "mattresses");
assert.equal(readback.collections[0].templateSuffix, "snoozepod-v1");
assert.ok(readback.collections[0].shopifyCollectionId);

for (const product of readback.products) {
  const source = manifest.products.find((candidate) => candidate.handle === product.handle);
  assert.ok(source);
  assert.equal(product.status, "DRAFT");
  assert.equal(product.templateSuffix, "product-pod-builder");
  assert.ok(product.shopifyProductId);
  assert.equal(product.variants.length, source.variants.length);
  assert.equal(product.contract.assortment_status, "APPROVED");
  assert.equal(product.contract.publication_readiness, "BLOCKED");
  assert.equal(product.contract.builder_roles, '["mattress"]');
  assert.equal(product.contract.model, source.model);
  assert.equal(JSON.parse(product.contract.showroom_representation).displayCount, expected.get(source.model).displays);
  for (const variant of product.variants) {
    assert.ok(variant.shopifyVariantId);
    assert.equal(variant.contract.price_verification_status, "HISTORICAL_REFERENCE");
    assert.equal(variant.contract.fulfillment_readiness, "PENDING");
  }
}

console.log("BEDGEAR mattress catalog manifest/readback: 4 Draft products, 37 unique variants, template and fail-closed dual-comfort assertions passed.");
