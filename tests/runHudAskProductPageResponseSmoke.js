#!/usr/bin/env node

const assert = require("assert");
const manifest = require("../data/showroom-manifest.v1.json");
const shopifySvc = require("../services/shopify");

const originalFetchProductsByHandles = shopifySvc.fetchProductsByHandles;

function buildEvent(body) {
  return {
    version: "2.0",
    routeKey: "POST /hud/ask",
    rawPath: "/hud/ask",
    headers: {
      "content-type": "application/json",
      origin: "https://mysnoozepod.com",
      host: "local.hud-product-page.test",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/hud/ask",
        sourceIp: "127.0.0.1",
        userAgent: "hud-product-page-smoke",
      },
      requestId: `hud-product-page-${Date.now()}`,
      routeKey: "POST /hud/ask",
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function parseBody(response) {
  assert.strictEqual(response.statusCode, 200, "expected HTTP 200");
  return JSON.parse(response.body);
}

function buildProductItem(product) {
  const sizeOptions = ["Twin", "Full", "Queen", "King"];
  const variants = sizeOptions.map(function mapSize(size) {
    return {
      id: `gid://shopify/ProductVariant/${product.handle}-${size.toLowerCase()}`,
      available: true,
      title: size,
      price: 1000,
      currencyCode: "USD",
      selectedOptions: [{ name: "Size", value: size }],
    };
  });

  return {
    id: `gid://shopify/Product/${product.handle}`,
    handle: product.handle,
    title: product.title,
    variants,
    firstAvailableVariantId: variants[0].id,
    priceRange: {
      min: 1000,
      currencyCode: "USD",
    },
  };
}

function patchShopify() {
  const productMap = new Map(manifest.products.map((product) => [product.handle, product]));
  shopifySvc.fetchProductsByHandles = async function mockedFetchProductsByHandles({ handles = [] } = {}) {
    const items = handles
      .map((handle) => productMap.get(String(handle || "").trim()))
      .filter(Boolean)
      .map(buildProductItem);
    return { items };
  };
}

function restoreShopify() {
  shopifySvc.fetchProductsByHandles = originalFetchProductsByHandles;
}

async function invokeHudAsk(body) {
  const { lambdaHandler } = require("../index");
  return parseBody(await lambdaHandler(buildEvent(body)));
}

function printCase(caseId, body) {
  console.log(`\n=== ${caseId} ===`);
  console.log(JSON.stringify(body, null, 2));
}

async function runCase(caseId, payload) {
  const body = await invokeHudAsk(payload);
  printCase(caseId, body);
  assert.strictEqual(body.status, "ok", `${caseId} should return ok`);
  return body;
}

async function main() {
  patchShopify();
  try {
    const productCoupleConflict = await runCase("product-page-couple-conflict", {
      query: "I like firmer, my wife likes softer",
      path: "/products/14-hybrid",
      page_type: "product",
    });

    assert.strictEqual(
      productCoupleConflict.meta?.answer_source_key,
      "12-dual-comfort-hybrid",
      "product-page couple conflict should source from the first ranked dual-comfort product"
    );
    assert(
      /compare 12" Dual Comfort Hybrid first/i.test(String(productCoupleConflict.reply || "")),
      "product-page couple conflict reply should tell the shopper to compare Dual Comfort first"
    );
    assert(
      !/I can still guide you\. Try one of these starting points\./i.test(String(productCoupleConflict.reply || "")),
      "grounded product-page couple conflict reply should not use the generic fallback"
    );

    const homepageCoupleConflict = await runCase("homepage-couple-conflict", {
      query: "I like firmer, my wife likes softer",
      path: "/",
      page_type: "home",
    });

    assert.strictEqual(
      homepageCoupleConflict.meta?.answer_source_key,
      "12-dual-comfort-hybrid",
      "homepage couple conflict should keep Dual Comfort as the answer source"
    );

    const productBackPain = await runCase("product-page-back-pain", {
      query: "my back hurts",
      path: "/products/14-hybrid",
      page_type: "product",
    });

    assert(
      productBackPain.meta?.answer_grounded,
      "back-pain product-page reply should stay grounded"
    );
    assert(
      !/I can still guide you\. Try one of these starting points\./i.test(String(productBackPain.reply || "")),
      "grounded back-pain reply should not use the generic fallback"
    );

    console.log("\nAll /hud/ask product-page response smoke tests passed.");
  } finally {
    restoreShopify();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
