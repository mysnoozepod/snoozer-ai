#!/usr/bin/env node

const assert = require("assert");
const manifest = require("../data/showroom-manifest.v1.json");
const shopifySvc = require("../services/shopify");
const {
  getAskSnoozerProductDocKeys,
} = require("../services/askSnoozerPolicy");
const { BANNED_SNOOZER_PHRASES } = require("../services/snoozerVoice");

const originalFetchProductsByHandles = shopifySvc.fetchProductsByHandles;

function buildEvent(body) {
  return {
    version: "2.0",
    routeKey: "POST /hud/ask",
    rawPath: "/hud/ask",
    headers: {
      "content-type": "application/json",
      origin: "https://mysnoozepod.com",
      host: "local.hud-quality.test",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/hud/ask",
        sourceIp: "127.0.0.1",
        userAgent: "hud-quality-test",
      },
      requestId: `hud-quality-${Date.now()}`,
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

function assertNoBannedPhrases(text, label) {
  const normalized = String(text || "").toLowerCase();
  for (const phrase of BANNED_SNOOZER_PHRASES) {
    assert(
      !normalized.includes(String(phrase).toLowerCase()),
      `${label} should not include banned phrase: ${phrase}`
    );
  }
}

async function invokeHudAsk(body) {
  const { lambdaHandler } = require("../index");
  return parseBody(await lambdaHandler(buildEvent(body)));
}

function testKnowledgeHandleMappings() {
  assert.strictEqual(
    getAskSnoozerProductDocKeys("12-dual-comfort-hybrid")[0],
    "products/mattress/12-dual-comfort-hybrid.md"
  );
  assert.strictEqual(
    getAskSnoozerProductDocKeys("14-hybrid")[0],
    "products/mattress/14-hybrid.md"
  );
  assert.strictEqual(
    getAskSnoozerProductDocKeys("12-all-foam-mattress")[0],
    "products/mattress/12-all-foam-mattress.md"
  );
  assert.strictEqual(
    getAskSnoozerProductDocKeys("10-all-foam-mattress")[0],
    "products/mattress/10-all-foam-mattress.md"
  );
}

async function testCoupleConflictPrefersDualComfort() {
  const body = await invokeHudAsk({
    query: "My partner likes soft and I like firm. What should we compare?",
    path: "/collections/mattresses",
    page_type: "collection",
    context: {
      assessment: {
        size: "Queen",
        sleepPartner: "Yes",
        firmness: "Medium",
        motionMode: "Half Split Motion",
        baseType: "Adjustable Base",
      },
    },
  });

  assert.strictEqual(body.status, "ok");
  assert(Array.isArray(body.products) && body.products.length > 0, "expected HUD product cards");
  assert.strictEqual(body.products[0].handle, "12-dual-comfort-hybrid");
  assert(/dual comfort/i.test(String(body.reply || "")), "couple conflict reply should mention Dual Comfort");
  assert(/different bodies|force one mattress feel/i.test(String(body.reply || "")), "couple conflict reply should explain the fit conflict");
  assert(/queen or king/i.test(String(body.reply || "")), "couple conflict reply should ask for Queen or King");
  assert(String(body.reply || "").length <= 220, "couple conflict reply should stay concise");
  assertNoBannedPhrases(body.reply, "couple conflict reply");
}

async function testCanonicalProductChoiceBeatsGenericHybridBias() {
  const body = await invokeHudAsk({
    query: "Which mattress fits me if I sleep hot?",
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

  assert.strictEqual(body.status, "ok");
  assert.strictEqual(body.meta && body.meta.canonical_primary_mattress_handle, "12-all-foam-mattress");
  assert(Array.isArray(body.products) && body.products.length > 0, "expected HUD product cards");
  assert.strictEqual(body.products[0].handle, "12-all-foam-mattress");
  assertNoBannedPhrases(body.reply, "hot-sleeper reply");
}

async function testHotSleeperVoice() {
  const body = await invokeHudAsk({
    query: "I sleep hot",
    path: "/collections/mattresses",
    page_type: "collection",
  });

  assert.strictEqual(body.status, "ok");
  assert(/airflow|heat/i.test(String(body.reply || "")), "hot-sleeper reply should mention airflow or heat");
  assert(!/\bcools you|will keep you cool|guaranteed cooling\b/i.test(String(body.reply || "")), "hot-sleeper reply should not overclaim cooling");
  assert(/side, back, or stomach|assessment/i.test(String(body.reply || "")), "hot-sleeper reply should ask the next useful question or point toward assessment");
  assert(String(body.reply || "").length <= 220, "hot-sleeper reply should stay concise");
  assertNoBannedPhrases(body.reply, "hot-sleeper voice reply");
}

async function testCompareFoamVsHybridVoice() {
  const body = await invokeHudAsk({
    query: "compare foam vs hybrid",
    path: "/collections/mattresses",
    page_type: "collection",
  });

  assert.strictEqual(body.status, "ok");
  assert(/foam/i.test(String(body.reply || "")), "compare reply should mention foam");
  assert(/hybrid/i.test(String(body.reply || "")), "compare reply should mention hybrid");
  assert(/airflow|breathable|bounce/i.test(String(body.reply || "")), "compare reply should describe hybrid in plain English");
  assert(/contour|motion/i.test(String(body.reply || "")), "compare reply should describe foam in plain English");
  assert(String(body.reply || "").length <= 220, "compare reply should stay concise");
  assertNoBannedPhrases(body.reply, "compare reply");
}

async function main() {
  patchShopify();
  try {
    testKnowledgeHandleMappings();
    await testCoupleConflictPrefersDualComfort();
    await testCanonicalProductChoiceBeatsGenericHybridBias();
    await testHotSleeperVoice();
    await testCompareFoamVsHybridVoice();
    console.log("All HUD knowledge and voice tests passed.");
  } finally {
    restoreShopify();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
