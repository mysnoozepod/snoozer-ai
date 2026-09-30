"use strict";

const showroomManifest = require("../data/showroom-manifest.v1.json");
const sleepEssentialsManifest = require("../data/sleep-essentials-catalog.v1.json");
const shopify = require("./shopify");

const ESSENTIAL_CATEGORY_MAP = Object.freeze({
  pillows: { id: "pillows", label: "Pillows" },
  sheets_bedding: { id: "sheets_bedding", label: "Bedding & Sheets" },
  protectors: { id: "protectors", label: "Protectors" },
});

function clean(value) {
  return String(value || "").trim();
}

function approvedCategoryDefinitions(options = {}) {
  const core = options.showroomManifest || showroomManifest;
  const essentials = options.sleepEssentialsManifest || sleepEssentialsManifest;
  const activeCore = Array.isArray(core?.products)
    ? core.products.filter((product) => product?.active === true && clean(product?.handle))
    : [];

  const categories = [
    {
      id: "mattresses",
      label: "Mattresses",
      description: "Shop the mattresses available in the MySnoozePod showroom.",
      products: activeCore.filter((product) => product.catalogType === "mattress"),
    },
    {
      id: "bases",
      label: "Bases",
      description: "Compare the approved foundations and adjustable bases.",
      products: activeCore.filter((product) => product.catalogType === "base"),
    },
  ];

  for (const category of Array.isArray(essentials?.categories) ? essentials.categories : []) {
    const mapped = ESSENTIAL_CATEGORY_MAP[category?.id];
    if (!mapped) continue;
    categories.push({
      ...mapped,
      description: clean(category.description),
      products: (category.handles || []).map((handle) => ({ handle: clean(handle) })).filter((item) => item.handle),
    });
  }

  return categories.filter((category) => category.products.length > 0);
}

async function getShowroomCommerceCatalog(_input = {}, options = {}) {
  const categories = approvedCategoryDefinitions(options);
  const orderedHandles = [];
  const categoryByHandle = new Map();
  const metadataByHandle = new Map();

  for (const category of categories) {
    for (const product of category.products) {
      const handle = clean(product.handle);
      if (!handle || categoryByHandle.has(handle)) continue;
      orderedHandles.push(handle);
      categoryByHandle.set(handle, category);
      metadataByHandle.set(handle, product);
    }
  }

  const result = await (options.shopify || shopify).fetchProductsByHandles({
    handles: orderedHandles,
    lite: false,
  });
  const byHandle = new Map((result.items || []).map((product) => [clean(product?.handle), product]));
  const products = orderedHandles
    .map((handle, featuredRank) => {
      const product = byHandle.get(handle);
      if (!product) return null;
      const category = categoryByHandle.get(handle);
      const curated = metadataByHandle.get(handle) || {};
      return {
        ...product,
        commerceCategoryId: category.id,
        commerceCategoryLabel: category.label,
        featuredRank,
        curatedAttributes: curated.attributes || {},
      };
    })
    .filter(Boolean);

  const availableHandles = new Set(products.map((product) => product.handle));
  return {
    catalogVersion: `${clean(showroomManifest.version) || "showroom"}+${clean(sleepEssentialsManifest.catalogVersion) || "essentials"}`,
    source: "shopify",
    categories: categories.map((category) => ({
      id: category.id,
      label: category.label,
      description: category.description,
      handles: category.products.map((product) => clean(product.handle)).filter((handle) => availableHandles.has(handle)),
    })),
    products,
    missingHandles: orderedHandles.filter((handle) => !availableHandles.has(handle)),
    shopifyMeta: result.meta || null,
  };
}

module.exports = {
  approvedCategoryDefinitions,
  getShowroomCommerceCatalog,
};
