#!/usr/bin/env node

require("dotenv").config();

const { loadShowroomManifest } = require("../services/showroomManifest");
const shopify = require("../services/shopify");

function productCategoryHint(product) {
  const tags = Array.isArray(product?.tags) ? product.tags : [];
  return (
    tags.find((tag) => /^cat:/i.test(String(tag || ""))) ||
    tags.find((tag) => /^type:/i.test(String(tag || ""))) ||
    tags.find((tag) => /^base:/i.test(String(tag || ""))) ||
    null
  );
}

function sizeOptions(product) {
  const sizeOption = (product?.options || []).find(
    (option) => String(option?.name || "").toLowerCase() === "size"
  );
  return Array.isArray(sizeOption?.values) ? sizeOption.values : [];
}

function buildMismatches(manifestProduct, shopifyProduct) {
  const mismatches = [];

  if (!shopifyProduct) {
    mismatches.push("Missing from Shopify fetch.");
    return mismatches;
  }

  if (String(manifestProduct.title || "").trim() !== String(shopifyProduct.title || "").trim()) {
    mismatches.push(
      `Manifest title "${manifestProduct.title}" does not exactly match Shopify title "${shopifyProduct.title}".`
    );
  }

  if (
    manifestProduct.catalogType === "base" &&
    Array.isArray(shopifyProduct.options) &&
    shopifyProduct.options.some((option) => String(option?.name || "").toLowerCase() === "color")
  ) {
    mismatches.push("Shopify base product has a Color option that the manifest does not currently model.");
  }

  if (manifestProduct.handle === "12-dual-comfort-hybrid") {
    const sizes = sizeOptions(shopifyProduct);
    const hasHalfSplit = sizes.some((size) => /half split/i.test(size));
    const hasSplitKing = sizes.some((size) => /split king/i.test(size));
    if (!hasHalfSplit || !hasSplitKing) {
      mismatches.push("Dual comfort product does not expose the expected split-size options.");
    }
  }

  if (manifestProduct.handle === "premium-motion-adjustable-base") {
    const sizes = sizeOptions(shopifyProduct);
    if (sizes.some((size) => /\(2pc\)/i.test(size))) {
      mismatches.push('Shopify adjustable base uses "(2pc)" size labels that will need translation before customer-facing migration.');
    }
  }

  return mismatches;
}

async function main() {
  const manifest = loadShowroomManifest();
  const handles = manifest.products.map((product) => product.handle);
  const out = await shopify.fetchProductsByHandles({ handles, lite: false });
  const found = new Map((out.items || []).map((item) => [item.handle, item]));

  const report = manifest.products.map((manifestProduct) => {
    const product = found.get(manifestProduct.handle) || null;
    return {
      handle: manifestProduct.handle,
      exists: Boolean(product),
      title: product?.title || null,
      category: product ? productCategoryHint(product) : null,
      available: product?.available ?? null,
      variantCount: Array.isArray(product?.variants) ? product.variants.length : null,
      sizeOptions: product ? sizeOptions(product) : [],
      mismatches: buildMismatches(manifestProduct, product),
    };
  });

  console.log(JSON.stringify({
    fetchedCount: (out.items || []).length,
    report,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
