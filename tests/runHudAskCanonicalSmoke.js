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
      host: "local.ask-snoozer.test",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/hud/ask",
        sourceIp: "127.0.0.1",
        userAgent: "hud-canonical-smoke-test",
      },
      requestId: `hud-${Date.now()}`,
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

async function testCanonicalHudAnswer() {
  const body = await invokeHudAsk({
    query: "Which mattress fits me?",
    path: "/pages/snooze-assessment",
    page_type: "page",
    context: {
      assessment: {
        size: "Queen",
        motionMode: "No Motion",
        firmness: "Soft",
        sleepPosition: "Side",
        sleepPartner: "No",
        baseType: "No Base",
        temperature: "Hot",
      },
    },
  });

  assert.strictEqual(body.status, "ok", "HUD should return ok");
  assert.strictEqual(body.meta?.canonical_top_pod_id, "4", "HUD should attach canonical top pod id");
  assert.strictEqual(
    body.meta?.canonical_primary_mattress_handle,
    "12-all-foam-mattress",
    "HUD should attach canonical mattress handle"
  );
  assert(
    /SnoozePod 4|12" All Foam/i.test(String(body.reply || "")),
    "HUD reply should reflect the canonical recommendation"
  );
  assert(
    Array.isArray(body.products) && body.products.some((product) => product.handle === "12-all-foam-mattress"),
    "HUD canonical path should backfill the matched mattress product card"
  );
}

async function testHudMissingContextFallback() {
  const body = await invokeHudAsk({
    query: "What do you recommend?",
    path: "/",
    page_type: "home",
  });

  assert.strictEqual(body.status, "ok", "HUD fallback should still succeed");
  assert(!/SnoozePod\s+\d/i.test(String(body.reply || "")), "missing context should not invent a pod");
}

async function testHudCommonIntentStillResponds() {
  const body = await invokeHudAsk({
    query: "Do you offer financing?",
    path: "/",
    page_type: "home",
  });

  assert.strictEqual(body.status, "ok", "common HUD intents should still respond");
  assert(String(body.reply || "").trim().length > 0, "common HUD intent reply should not be blank");
}

async function main() {
  patchShopify();
  try {
    await testCanonicalHudAnswer();
    await testHudMissingContextFallback();
    await testHudCommonIntentStillResponds();
    console.log("All /hud/ask canonical smoke tests passed.");
  } finally {
    restoreShopify();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
