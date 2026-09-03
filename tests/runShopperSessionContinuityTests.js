#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const shopperCart = require("../services/shopperCart");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

async function testCanonicalIdentityAndRefreshContract() {
  const identityModule = await import(
    `${pathToFileURL(path.join(ROOT, "omnia-journey/src/state/identitySession.mjs")).href}?t=${Date.now()}`
  );
  const identity = identityModule.normalizeCanonicalIdentity({
    snoozeCode: " 589424 ",
    shopperId: "temporary-browser-id",
    profileId: "shopper#589424",
    sessionId: "session-1",
  });

  assert.deepStrictEqual(identity, {
    snoozeCode: "589424",
    accessCode: "589424",
    shopperId: "589424",
    profileId: "shopper#589424",
    sessionId: "session-1",
    threadId: null,
  });
  assert.strictEqual(
    identityModule.didCanonicalShopperChange(identity, { snoozeCode: "589424" }),
    false,
    "a refresh of the same shopper must not fork identity"
  );
}

async function testShopperSwitchClearsOnlyShopperState() {
  const identityModule = await import(
    `${pathToFileURL(path.join(ROOT, "omnia-journey/src/state/identitySession.mjs")).href}?t=${Date.now() + 1}`
  );
  const storage = memoryStorage({
    "snooze.assessment": "shopper-a-assessment",
    "snooze.recommendations": "shopper-a-recommendations",
    "snooze.askSnoozer.conversationId": "shopper-a-conversation",
    "snooze.pod.pod-4.review": "shopper-a-pod-state",
    "snooze.sleepEssentials.1111": "shopper-a-essentials",
    "snooze.shopify.cartId": "gid://shopify/Cart/cart-a",
    "snooze.shopify.checkoutUrl": "https://shop.example/checkouts/a",
  });

  assert.strictEqual(
    identityModule.didCanonicalShopperChange(
      { snoozeCode: "1111" },
      { snoozeCode: "2222" }
    ),
    true
  );
  identityModule.clearShopperScopedStorage(storage);

  assert.strictEqual(storage.getItem("snooze.assessment"), null);
  assert.strictEqual(storage.getItem("snooze.recommendations"), null);
  assert.strictEqual(storage.getItem("snooze.askSnoozer.conversationId"), null);
  assert.strictEqual(storage.getItem("snooze.pod.pod-4.review"), null);
  assert.strictEqual(storage.getItem("snooze.sleepEssentials.1111"), null);
  assert.strictEqual(
    storage.getItem("snooze.shopify.cartId"),
    "gid://shopify/Cart/cart-a",
    "identity switching must not clear Shopify's authoritative cart"
  );
}

async function testJourneySurfacesConsumeCanonicalIdentity() {
  const welcome = source("omnia-journey/src/pages/Welcome.jsx");
  const api = source("omnia-journey/src/lib/api.js");
  const results = source("omnia-journey/src/pages/Results.jsx");
  const pod = source("omnia-journey/src/pages/Pod.jsx");
  const essentials = source("omnia-journey/src/pages/SleepEssentials.jsx");
  const ask = source("omnia-journey/src/lib/snoozer/askSnoozerPage.js");
  const cart = source("omnia-journey/src/pages/Cart.jsx");

  assert(welcome.includes("checkIn.shopperChanged"), "Welcome must apply confirmed shopper switches");
  assert(api.includes("shopperId: identity.shopperId || shopperId"), "Assessment must use canonical shopperId");
  assert(api.includes("profileId: identity.profileId || undefined"), "Assessment/Ask must carry profileId");
  assert(results.includes("getShopperId() || \"\""), "Results must resolve the canonical shopper");
  assert(pod.includes("profileId: session.profileId || null"), "Pod context must retain profile identity");
  assert(essentials.includes("getSleepEssentialsJourneyId(shopperId)"), "Essentials state must be shopper-scoped");
  assert(ask.includes('"x-snooze-code"'), "Ask Snoozer must send the canonical Snooze Code");
  assert(cart.includes('getShopperId() || "guest"'), "Cart must retain canonical shopper identity");
}

async function testShopifyCheckoutCorrelationIsPrivateAndAuthoritative() {
  const calls = [];
  const profileWrites = [];
  const cartId = "gid://shopify/Cart/correlation-test";
  const checkoutUrl = "https://shop.example/checkouts/authoritative";
  const result = await shopperCart.prepareShopperCheckout(
    {},
    {
      resolveIdentity: async () => ({
        shopperId: "589424",
        snoozeCode: "589424",
        profileId: "shopper#589424",
        sessionId: "session-589424",
        profile: { shopifyCartId: cartId },
      }),
      shopify: {
        updateCartAttributes: async (input) => {
          calls.push(input);
          return { id: cartId, checkoutUrl, lines: { edges: [] } };
        },
      },
      customerProfileService: {
        upsertCustomerProfile: async (patch) => {
          profileWrites.push(patch);
          return { profile: patch };
        },
      },
    }
  );

  assert.strictEqual(result.checkoutUrl, checkoutUrl, "checkout URL must come from Shopify");
  assert.strictEqual(calls.length, 1, "checkout correlation must update the authoritative cart once");
  assert.deepStrictEqual(calls[0].attributes, [
    { key: "snooze_code__", value: "589424" },
    { key: "snooze_session__", value: "session-589424" },
  ]);
  assert(
    calls[0].attributes.every((attribute) => attribute.key.endsWith("__")),
    "Shopify correlation attributes must use the private cart-attribute convention"
  );
  assert(
    !JSON.stringify(calls[0].attributes).includes("shopper#589424"),
    "internal profile IDs must not be sent to Shopify"
  );
  assert.strictEqual(profileWrites.length, 1, "existing profile/cart association must remain current");
}

async function testCheckoutPreparationCallsCorrelationBridge() {
  const store = source("omnia-journey/src/lib/useStore.js");
  const api = source("omnia-journey/src/lib/api.js");
  const route = source("routes/shopifyRoutes.js");
  assert(store.includes("await api.prepareShopperCheckout()"));
  assert(api.includes('rewardRequest("/shopify/cart/owned/prepareCheckout"'));
  assert(route.includes("shopperCart.prepareShopperCheckout(event)"));
}

async function main() {
  const tests = [
    ["checkin_assessment_refresh_canonical_identity", testCanonicalIdentityAndRefreshContract],
    ["code_a_to_code_b_stale_state_protection", testShopperSwitchClearsOnlyShopperState],
    ["results_pod_essentials_ask_cart_identity_continuity", testJourneySurfacesConsumeCanonicalIdentity],
    ["shopify_private_order_correlation", testShopifyCheckoutCorrelationIsPrivateAndAuthoritative],
    ["checkout_preparation_uses_correlation_bridge", testCheckoutPreparationCallsCorrelationBridge],
  ];

  for (const [name, test] of tests) {
    await test();
    console.log(`PASS ${name}`);
  }
  console.log(`\nAll ${tests.length} shopper/session continuity tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
