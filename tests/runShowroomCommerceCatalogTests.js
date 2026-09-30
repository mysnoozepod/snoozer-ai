"use strict";

const assert = require("node:assert/strict");
const showroomManifest = require("../data/showroom-manifest.v1.json");
const sleepManifest = require("../data/sleep-essentials-catalog.v1.json");
const {
  approvedCategoryDefinitions,
  getShowroomCommerceCatalog,
} = require("../services/showroomCommerceCatalog");

function product(handle) {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title: handle,
    variants: [{ id: `gid://shopify/ProductVariant/${handle}`, available: true, price: 100 }],
  };
}

(async () => {
  const definitions = approvedCategoryDefinitions();
  assert.deepEqual(definitions.map((category) => category.id), [
    "mattresses",
    "bases",
    "pillows",
    "sheets_bedding",
    "protectors",
  ]);

  const expectedHandles = [
    ...showroomManifest.products.filter((item) => item.active).map((item) => item.handle),
    ...sleepManifest.categories.flatMap((category) => category.handles),
  ];
  let requestedHandles = [];
  const catalog = await getShowroomCommerceCatalog({}, {
    shopify: {
      fetchProductsByHandles: async ({ handles, lite }) => {
        requestedHandles = [...handles];
        assert.equal(lite, false, "Shop requires full Shopify variants without a browser waterfall");
        return { items: handles.map(product), meta: { source: "mock-shopify" } };
      },
    },
  });

  assert.deepEqual(requestedHandles, expectedHandles, "only curated manifest handles may be requested");
  assert.equal(catalog.products.length, expectedHandles.length);
  assert.equal(catalog.missingHandles.length, 0);
  assert.equal(new Set(catalog.products.map((item) => item.handle)).size, expectedHandles.length);
  assert.equal(catalog.products.some((item) => item.handle === "unapproved-product"), false);
  assert.equal(catalog.products[0].commerceCategoryId, "mattresses");
  assert.equal(catalog.products.at(-1).commerceCategoryId, "protectors");

  const missingCatalog = await getShowroomCommerceCatalog({}, {
    shopify: {
      fetchProductsByHandles: async ({ handles }) => ({ items: handles.slice(1).map(product) }),
    },
  });
  assert.deepEqual(missingCatalog.missingHandles, [expectedHandles[0]]);
  assert.equal(missingCatalog.products.some((item) => item.handle === expectedHandles[0]), false);

  console.log("Showroom commerce catalog tests passed: curated categories, one Shopify batch, deterministic order, and no unapproved leakage.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
