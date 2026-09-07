"use strict";

const manifest = require("../data/sleep-essentials-catalog.v1.json");
const shopify = require("./shopify");

const CATEGORY_IDS = Object.freeze(["pillows", "sheets_bedding", "protectors"]);
const SHOWROOM_PRODUCT_LIMIT = 12;

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

function selectShowroomAssortment(
  document,
  availableHandles = null,
  limit = SHOWROOM_PRODUCT_LIMIT
) {
  const selectedHandles = new Set();
  let remaining = Math.max(0, Number(limit) || 0);

  return document.categories.map((category) => ({
    ...category,
    handles: category.handles.filter((rawHandle) => {
      const handle = clean(rawHandle);
      if (
        !handle ||
        selectedHandles.has(handle) ||
        (availableHandles && !availableHandles.has(handle)) ||
        remaining === 0
      ) return false;
      selectedHandles.add(handle);
      remaining -= 1;
      return true;
    }),
  }));
}

async function getSleepEssentialsCatalog(input = {}, options = {}) {
  const document = validateManifest(options.manifest || manifest);
  const requested = clean(input.categoryId);
  if (requested && !document.categories.some((category) => category.id === requested)) {
    const error = new Error("Sleep Essentials category was not found.");
    error.code = "SLEEP_ESSENTIALS_CATEGORY_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  const handles = [...new Set(document.categories.flatMap((category) => category.handles))];
  const result = await (options.shopify || shopify).fetchProductsByHandles({
    handles,
    lite: false,
  });
  const byHandle = new Map((result.items || []).map((product) => [product.handle, product]));
  const showroomCategories = selectShowroomAssortment(document, new Set(byHandle.keys()));
  const categories = requested
    ? showroomCategories.filter((category) => category.id === requested)
    : showroomCategories;
  return {
    catalogVersion: document.catalogVersion,
    categories: categories.map((category) => ({
      ...category,
      products: category.handles.map((handle) => byHandle.get(handle)).filter(Boolean),
      missingHandles: (document.categories.find((item) => item.id === category.id)?.handles || [])
        .filter((handle) => !byHandle.has(handle)),
    })),
    source: "shopify",
    shopifyMeta: result.meta || null,
  };
}

module.exports = {
  CATEGORY_IDS,
  SHOWROOM_PRODUCT_LIMIT,
  getSleepEssentialsCatalog,
  selectShowroomAssortment,
  validateManifest,
};
