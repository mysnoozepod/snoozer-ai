#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const fixturePath = path.join(__dirname, "fixtures", "p1-002-pod-builder-contract.fixture.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function productVariants(products) {
  return products.flatMap((product) =>
    (product.variants || []).map((variant) => ({ ...variant, product }))
  );
}

function validateFixture() {
  assert.strictEqual(fixture.schemaVersion, "p1-002.fixture.v1");
  assert.strictEqual(fixture.fixtureOnly, true);
  assert(/synthetic/i.test(fixture.notice));

  const products = fixture.products || [];
  const variants = productVariants(products);
  const variantById = new Map(variants.map((entry) => [entry.id, entry]));
  assert.strictEqual(variantById.size, variants.length, "variant IDs must be unique");

  products.forEach((product) => {
    assert(
      fixture.allowedAssortmentStatuses.includes(product.assortmentStatus),
      `invalid assortment status for ${product.id}`
    );
    assert(product.id.startsWith("fixture-"), `non-synthetic product ID: ${product.id}`);
    assert.notStrictEqual(product.publicationReadiness, "READY", "fixture product must not be publish-ready");
    assert(product.showroomRepresentation, `showroom representation missing for ${product.id}`);
  });

  variants.forEach((variant) => {
    assert(variant.id.startsWith("fixture-"), `non-synthetic variant ID: ${variant.id}`);
    assert(
      String(variant.manufacturerSku || "").startsWith("FIXTURE-NOT-A-REAL-SKU-"),
      `fixture SKU is not clearly synthetic: ${variant.id}`
    );
    assert.strictEqual(variant.price, null, `fixture price must be null: ${variant.id}`);
    assert.strictEqual(
      variant.priceVerificationStatus,
      "FIXTURE_NOT_AUTHORIZED",
      `fixture price status must stay unauthorized: ${variant.id}`
    );
  });

  ["base", "protection", "pillow", "bedding"].forEach((step) => {
    assert(fixture.builder.optionalSelections[step], `optional selection missing for ${step}`);
  });

  const requiredHandles = [
    "adjustable-bases",
    "mattress-protectors",
    "pillows",
    "sheet-sets",
    "bedding",
  ];
  const configuredHandles = Object.values(fixture.builder.collectionSources).flat();
  requiredHandles.forEach((handle) => {
    assert(configuredHandles.includes(handle), `builder collection source missing: ${handle}`);
  });

  const pillowProducts = products.filter((product) => product.builderRoles.includes("pillow"));
  assert(pillowProducts.length >= 2, "fixture must expose multiple eligible pillow products");

  const modular = products.find((product) => product.id === "fixture-product-mattress-modular");
  assert(modular, "modular mattress fixture missing");
  const modularConfigs = new Set(
    modular.variants
      .filter((variant) => variant.comfortConfiguration)
      .map((variant) => JSON.stringify(variant.comfortConfiguration))
  );
  assert(modularConfigs.size >= 2, "modular fixture needs differing comfort configurations");

  const rules = fixture.compatibilityRules || [];
  const requiredStatuses = [
    "MANUFACTURER_VERIFIED",
    "OWNER_APPROVED",
    "PENDING_VERIFICATION",
    "UNSUPPORTED",
  ];
  requiredStatuses.forEach((status) => {
    assert(rules.some((rule) => rule.status === status), `compatibility status missing: ${status}`);
  });

  rules.forEach((rule) => {
    assert(rule.id.startsWith("fixture-"), `non-synthetic rule ID: ${rule.id}`);
    assert(variantById.has(rule.subjectVariantId), `unknown subject variant: ${rule.id}`);
    assert(variantById.has(rule.targetVariantId), `unknown target variant: ${rule.id}`);
    assert(
      fixture.allowedCompatibilityStatuses.includes(rule.status),
      `invalid compatibility status: ${rule.id}`
    );
  });

  const incompatibleRule = rules.find((rule) => rule.status === "UNSUPPORTED");
  assert(incompatibleRule, "incompatible fixture case missing");
  const unknownRule = rules.find((rule) => rule.status === "PENDING_VERIFICATION");
  assert(unknownRule, "unknown compatibility fixture case missing");

  const furniture = products.find((product) => product.productType === "Furniture");
  assert(furniture, "furniture coexistence fixture missing");
  assert.deepStrictEqual(furniture.builderRoles, [], "furniture must not become a builder step in P1-002");
}

validateFixture();
console.log("P1-002 Pod Builder contract fixture passed 34 assertions/groups.");
