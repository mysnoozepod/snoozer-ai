"use strict";

const manifest = require("../data/sleep-essentials-catalog.v1.json");
const shopify = require("./shopify");

const CATEGORY_IDS = Object.freeze(["pillows", "sheets_bedding", "protectors"]);

function clean(value) {
  return String(value || "").trim();
}

function validateManifest(document = manifest) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document?.categories)) {
    throw new Error("Sleep Essentials catalog manifest is invalid.");
  }
  for (const categoryId of CATEGORY_IDS) {
    const category = document.categories.find((item) => item?.id === categoryId);
    if (!category || !Array.isArray(category.handles) || !category.handles.length) {
      throw new Error(`Sleep Essentials category ${categoryId} is incomplete.`);
    }
  }
  return document;
}

async function getSleepEssentialsCatalog(input = {}, options = {}) {
  const document = validateManifest(options.manifest || manifest);
  const requested = clean(input.categoryId);
  const categories = requested
    ? document.categories.filter((category) => category.id === requested)
    : document.categories;
  if (!categories.length) {
    const error = new Error("Sleep Essentials category was not found.");
    error.code = "SLEEP_ESSENTIALS_CATEGORY_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  const handles = [...new Set(categories.flatMap((category) => category.handles))];
  const result = await (options.shopify || shopify).fetchProductsByHandles({
    handles,
    lite: false,
  });
  const byHandle = new Map((result.items || []).map((product) => [product.handle, product]));
  return {
    catalogVersion: document.catalogVersion,
    categories: categories.map((category) => ({
      ...category,
      products: category.handles.map((handle) => byHandle.get(handle)).filter(Boolean),
      missingHandles: category.handles.filter((handle) => !byHandle.has(handle)),
    })),
    source: "shopify",
    shopifyMeta: result.meta || null,
  };
}

module.exports = {
  CATEGORY_IDS,
  getSleepEssentialsCatalog,
  validateManifest,
};
