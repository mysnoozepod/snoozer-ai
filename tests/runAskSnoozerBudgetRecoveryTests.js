#!/usr/bin/env node

const assert = require("assert");
const manifest = require("../data/showroom-manifest.v1.json");
const {
  runSnoozerConversationCore,
  validateReplyMonetaryClaims,
} = require("../services/askSnoozerModelCore");
const { executeConversationTool } = require("../services/askSnoozerConversationTools");
const { applyConversationState } = require("../services/askSnoozerConversationState");
const {
  buildAskJourneyPayload,
  hydrateAskContextFromActiveJourney,
  isAskJourneyPayloadEquivalent,
  makeActiveJourney,
} = require("../services/activeJourney");

const ENV = {
  ASK_SNOOZER_CONVERSATION_CORE_MODE: "active",
  ASK_SNOOZER_CONVERSATION_CORE_MODEL: "gpt-6.1-sol",
  ASK_SNOOZER_CONVERSATION_CORE_REASONING_EFFORT: "low",
  ASK_SNOOZER_CONVERSATION_CORE_MAX_TOOL_ROUNDS: "2",
  ASK_SNOOZER_CONVERSATION_CORE_MAX_TOOL_CALLS: "6",
  ASK_SNOOZER_CONVERSATION_CORE_TOTAL_TIMEOUT_MS: "5000",
  ASK_SNOOZER_CONVERSATION_CORE_MODEL_TIMEOUT_MS: "2000",
};

function product(handle, title, price) {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title,
    priceRange: { min: price, max: price, currencyCode: "USD" },
    available: true,
    availableForSale: true,
    variants: [{
      id: `gid://shopify/ProductVariant/${handle}-queen`,
      title: "Queen",
      selectedOptions: [{ name: "Size", value: "Queen" }],
      available: true,
      availableForSale: true,
      price: { amount: String(price), currencyCode: "USD" },
    }],
  };
}

const catalogProducts = [
  product("12-dual-comfort-hybrid", "12-inch Dual Comfort Hybrid", 2499),
  product("14-hybrid", "14-inch Hybrid", 2399),
  product("12-all-foam-mattress", "12-inch All Foam Mattress", 1299),
  product("10-all-foam-mattress", "10-inch All Foam Mattress", 549),
];
const shopify = {
  fetchProductsByHandles: async ({ handles = [] } = {}) => ({
    items: catalogProducts.filter((item) => handles.includes(item.handle)),
  }),
};
const toolOverrides = {
  manifest,
  getShowroomCommerceCatalog: async () => ({ catalogVersion: "budget-test", products: catalogProducts }),
  loadTrustedAdvisorFactPack: async ({ productHandles = [] } = {}) => ({
    productFacts: productHandles.map((handle) => ({ handle, status: "verified_fact", facts: ["Verified test fact."] })),
  }),
};

function response(overrides = {}) {
  return JSON.stringify({
    reply: "I can help with that.",
    responseMode: "answer",
    productHandles: [],
    chips: [],
    actionProposals: [],
    preferences: [],
    references: {
      presentedProductHandles: [],
      comparisonProductHandles: [],
      lastDiscussedProductHandle: null,
      lastDiscussedBaseHandle: null,
    },
    decisions: [],
    claims: [],
    monetaryClaims: [],
    fallback: { used: false, reason: null },
    ...overrides,
  });
}

function exactCommerceResult(price = 2499) {
  return [{
    ok: true,
    name: "get_live_commerce",
    data: {
      products: [{
        handle: "12-dual-comfort-hybrid",
        price,
        priceRange: { min: price, max: price, currencyCode: "USD" },
        currencyCode: "USD",
        pricingMode: "exact_variant",
        exactVariantResolved: true,
      }],
    },
  }];
}

function monetaryClaim(overrides = {}) {
  return {
    semantic: "verified_exact_variant_price",
    amount: 2499,
    currencyCode: "USD",
    productHandle: "12-dual-comfort-hybrid",
    sourceTool: "get_live_commerce",
    sourceKey: "12-dual-comfort-hybrid",
    shopperEvidence: null,
    evidence: "$2,499",
    ...overrides,
  };
}

function testMonetarySemantics() {
  const suggested = {
    reply: "The verified Queen price is $2,499. Would under $1,500 be a useful maximum budget?",
    responseMode: "clarification",
    monetaryClaims: [
      monetaryClaim({ evidence: "$2,499" }),
      monetaryClaim({
        semantic: "suggested_budget_threshold", amount: 1500, productHandle: null,
        sourceTool: null, sourceKey: null, shopperEvidence: null,
        evidence: "under $1,500 be a useful maximum budget",
      }),
    ],
  };
  assert.deepEqual(validateReplyMonetaryClaims(suggested, exactCommerceResult(), "I want something affordable."), []);

  const shopperBudget = {
    reply: "I'll use your approximate $2,000 mattress budget.",
    responseMode: "answer",
    monetaryClaims: [monetaryClaim({
      semantic: "shopper_budget", amount: 2000, productHandle: null,
      sourceTool: null, sourceKey: null, shopperEvidence: "about two grand",
      evidence: "approximate $2,000 mattress budget",
    })],
  };
  assert.deepEqual(validateReplyMonetaryClaims(shopperBudget, [], "My budget is about two grand."), []);

  const hypothetical = {
    reply: "A hypothetical $1,500 budget would narrow the eligible options.",
    responseMode: "answer",
    monetaryClaims: [monetaryClaim({
      semantic: "hypothetical_spending_example", amount: 1500, productHandle: null,
      sourceTool: null, sourceKey: null, shopperEvidence: "What if my budget were $1,500",
      evidence: "hypothetical $1,500 budget",
    })],
  };
  assert.deepEqual(validateReplyMonetaryClaims(hypothetical, [], "What if my budget were $1,500? Don't save it yet."), []);

  const disguisedPrice = {
    reply: "The mattress costs $1,500.",
    responseMode: "answer",
    monetaryClaims: [monetaryClaim({
      semantic: "suggested_budget_threshold", amount: 1500, productHandle: null,
      sourceTool: null, sourceKey: null, shopperEvidence: null, evidence: "costs $1,500",
    })],
  };
  assert(validateReplyMonetaryClaims(disguisedPrice, [], "I want something affordable.").includes("suggested_budget_invalid:1500.00"));

  const starting = [{
    ok: true,
    name: "discover_products",
    data: { products: [{ commerce: {
      handle: "12-all-foam-mattress", pricingMode: "starting_at",
      price: null, priceRange: { min: 1299, max: 1799, currencyCode: "USD" }, exactVariantResolved: false,
    } }] },
  }];
  const startingReply = {
    reply: "It starts at $1,299 before a size is selected.",
    responseMode: "answer",
    monetaryClaims: [monetaryClaim({
      semantic: "verified_starting_at_price", amount: 1299,
      productHandle: "12-all-foam-mattress", sourceTool: "discover_products",
      sourceKey: "12-all-foam-mattress", evidence: "starts at $1,299",
    })],
  };
  assert.deepEqual(validateReplyMonetaryClaims(startingReply, starting, "What does it start at?"), []);
  startingReply.monetaryClaims[0].semantic = "verified_exact_variant_price";
  assert(validateReplyMonetaryClaims(startingReply, starting, "What is the Queen price?").includes("price_not_grounded:1299.00"));

  const badBundle = {
    reply: "The verified bundle subtotal is $3,999.",
    responseMode: "answer",
    monetaryClaims: [monetaryClaim({
      semantic: "verified_bundle_subtotal", amount: 3999, productHandle: null,
      sourceTool: "quote_configuration", sourceKey: "queen-bundle", evidence: "subtotal is $3,999",
    })],
  };
  const quote = [{ ok: true, name: "quote_configuration", data: { ok: true, cartReady: true, subtotal: 4398 } }];
  assert(validateReplyMonetaryClaims(badBundle, quote, "Quote the bundle.").includes("price_not_grounded:3999.00"));
}

async function testCorrectionRecovery() {
  let call = 0;
  const runtime = async () => {
    call += 1;
    if (call === 1) {
      const args = { productHandles: ["12-dual-comfort-hybrid"], size: "Queen", motionKey: null };
      return {
        text: "", output: [{ type: "function_call", name: "get_live_commerce", call_id: "commerce", arguments: JSON.stringify(args) }],
        functionCalls: [{ name: "get_live_commerce", callId: "commerce", arguments: JSON.stringify(args) }], tokens: {},
      };
    }
    if (call === 2) return {
      text: response({
        reply: "The Queen costs $1,500.",
        monetaryClaims: [monetaryClaim({
          semantic: "unverified_product_price", amount: 1500, evidence: "$1,500",
          sourceTool: null, sourceKey: null,
        })],
        preferences: [{ key: "budget", value: "under 1500", subject: "household", operation: "set", evidence: "need a Queen" }],
      }), output: [], functionCalls: [], tokens: {},
    };
    return {
      text: response({
        reply: "The verified Queen price is $2,499. What maximum mattress budget should I use?",
        responseMode: "clarification",
        productHandles: ["12-dual-comfort-hybrid"],
        references: {
          presentedProductHandles: ["12-dual-comfort-hybrid"], comparisonProductHandles: [],
          lastDiscussedProductHandle: "12-dual-comfort-hybrid", lastDiscussedBaseHandle: null,
        },
        claims: [{ kind: "commerce", value: "Verified Queen price.", sourceTool: "get_live_commerce", sourceKey: "12-dual-comfort-hybrid" }],
        monetaryClaims: [monetaryClaim({ evidence: "$2,499" })],
        preferences: [{ key: "size", value: "Queen", subject: "household", operation: "set", evidence: "need a Queen" }],
      }), output: [], functionCalls: [], tokens: {},
    };
  };
  const result = await runSnoozerConversationCore({
    requestId: "budget-correction", message: "We need a Queen and want something affordable.",
    context: {}, shopify, runtime, env: ENV, toolOverrides,
  });
  assert.equal(result.ok, true, JSON.stringify(result.telemetry));
  assert.equal(result.telemetry.modelCallCount, 3);
  assert.equal(result.telemetry.recovery.succeeded, true);
  assert.deepEqual(result.preferences.map((item) => item.key), ["size"], "invalid response state must not survive recovery");
  assert(!result.actions.length, "budget recovery must not mutate cart state");
}

async function testPersistentInvalidPriceUsesFocusedFallback() {
  let call = 0;
  const runtime = async () => {
    call += 1;
    if (call === 1) {
      const args = { productHandles: ["12-dual-comfort-hybrid"], size: "Queen", motionKey: null };
      return {
        text: "", output: [{ type: "function_call", name: "get_live_commerce", call_id: "commerce", arguments: JSON.stringify(args) }],
        functionCalls: [{ name: "get_live_commerce", callId: "commerce", arguments: JSON.stringify(args) }], tokens: {},
      };
    }
    return {
      text: response({
        reply: "The Queen costs $1,500.",
        monetaryClaims: [monetaryClaim({
          semantic: "unverified_product_price", amount: 1500, evidence: "$1,500", sourceTool: null, sourceKey: null,
        })],
      }), output: [], functionCalls: [], tokens: {},
    };
  };
  const result = await runSnoozerConversationCore({
    requestId: "budget-persistent-invalid", message: "We need a Queen and want something affordable.",
    context: {}, shopify, runtime, env: ENV, toolOverrides,
  });
  assert.equal(result.ok, false);
  assert.equal(result.telemetry.recovery.attempted, true);
  assert(result.reply.includes("maximum mattress budget"));
  assert(!result.reply.includes("$1,500"));
}

async function testCommerceFailureIsExplicitAndSafe() {
  let call = 0;
  const runtime = async () => {
    call += 1;
    if (call === 1) {
      const args = { productHandles: ["12-dual-comfort-hybrid"], size: "Queen", motionKey: null };
      return {
        text: "", output: [{ type: "function_call", name: "get_live_commerce", call_id: "commerce", arguments: JSON.stringify(args) }],
        functionCalls: [{ name: "get_live_commerce", callId: "commerce", arguments: JSON.stringify(args) }], tokens: {},
      };
    }
    return {
      text: response({
        reply: "I can't verify the live Queen price right now, so I won't quote an amount or change your cart.",
        responseMode: "safe_fallback", fallback: { used: true, reason: "live_price_unavailable" },
      }), output: [], functionCalls: [], tokens: {},
    };
  };
  const unavailableShopify = { fetchProductsByHandles: async () => { throw Object.assign(new Error("temporary"), { code: "SHOPIFY_TIMEOUT" }); } };
  const result = await runSnoozerConversationCore({
    requestId: "budget-commerce-down", message: "What is the Queen price?",
    context: {}, shopify: unavailableShopify, runtime, env: ENV, toolOverrides,
  });
  assert.equal(result.ok, true);
  assert.equal(result.fallback.used, true);
  assert.equal(result.actions.length, 0);
  assert(!/\$\s*\d/.test(result.reply));
}

async function testAffordableDiscoveryAndRejectionGuard() {
  const baseArgs = {
    sleepPosition: "side", temperature: "sleeps_hot", pressureAreas: ["shoulders"], firmness: null,
    partnerConsiderations: "back sleeper who prefers firm", size: "Queen", budgetMax: null,
    pricePreference: "lowest_price", exclusions: ["12-all-foam-mattress"], limit: 4,
  };
  const result = await executeConversationTool("discover_products", baseArgs, { ...toolOverrides, shopify });
  assert.equal(result.ok, true);
  assert(!result.data.products.some((item) => item.handle === "12-all-foam-mattress"));
  const prices = result.data.products.map((item) => item.commerce.price).filter(Number.isFinite);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b), "lowest-price retrieval must return verified Queen prices in order");

  const none = await executeConversationTool("discover_products", { ...baseArgs, budgetMax: 500 }, { ...toolOverrides, shopify });
  assert.equal(none.ok, true);
  assert.equal(none.data.products.length, 0, "unresolved or over-budget variants must not pass an exact cap");
}

async function testPreparedFactMissIsExplicit() {
  const result = await executeConversationTool("get_product_facts", {
    productHandles: ["12-dual-comfort-hybrid", "premium-motion-adjustable-base"],
    factClasses: ["product_features"],
  }, {
    manifest,
    loadTrustedAdvisorFactPack: async () => ({
      productFacts: [{ handle: "12-dual-comfort-hybrid", status: "verified_fact", facts: ["Verified fact."] }],
    }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.requestedHandles, ["12-dual-comfort-hybrid", "premium-motion-adjustable-base"]);
  assert.deepEqual(result.data.missingHandles, ["premium-motion-adjustable-base"]);
}

function testStateProjectionNoOpAndBudgetRemoval() {
  const rejectedAt = "2026-10-09T03:17:44.023Z";
  const journey = {
    ...makeActiveJourney({ recordId: "budget-state", identity: { sessionId: "budget-state" }, now: new Date("2026-10-09T03:13:42Z") }),
    revision: 4,
    currentSurface: "ask_snoozer",
    sessionRecommendation: { productHandle: "12-dual-comfort-hybrid", source: "conversation_core", updatedAt: "2026-10-09T03:16:31Z" },
    rejectedProducts: [{ handle: "12-all-foam-mattress", status: "rejected", reason: "shopper_rejected", rejectedAt }],
    retainedPreferences: {
      "household:product_exclusion": { value: "12-all-foam-mattress", source: "shopper_statement", updatedAt: rejectedAt },
      "household:budget": { value: "under 1500 USD", source: "shopper_statement", updatedAt: rejectedAt },
    },
    activeConfiguration: { productHandle: "12-dual-comfort-hybrid", baseHandle: null },
  };
  const base = hydrateAskContextFromActiveJourney({
    snoozerConversationState: {
      version: "conversation-state.v1", preferences: {}, decisions: [],
      references: {
        presentedProductHandles: ["12-dual-comfort-hybrid", "12-all-foam-mattress"],
        comparisonProductHandles: [], lastDiscussedProductHandle: "12-dual-comfort-hybrid", lastDiscussedBaseHandle: null,
      },
      rejectedProductHandles: ["12-all-foam-mattress"],
    },
  }, journey);
  const recall = applyConversationState({
    context: base,
    response: {
      preferences: [], decisions: [], productHandles: ["12-all-foam-mattress"],
      references: { presentedProductHandles: ["12-all-foam-mattress"], comparisonProductHandles: [], lastDiscussedProductHandle: "12-dual-comfort-hybrid", lastDiscussedBaseHandle: null },
    },
    now: new Date("2026-10-09T03:18:09.249Z"),
  });
  assert.equal(recall.askSnoozerWorkingMemory.activeDeal.rejectedProducts[0].rejectedAt, rejectedAt);
  const recallPayload = buildAskJourneyPayload(recall);
  assert.equal(
    isAskJourneyPayloadEquivalent(journey, recallPayload),
    true,
    `memory recall must not advance Active Journey: ${JSON.stringify(recallPayload)}`
  );

  const removed = applyConversationState({
    context: base,
    response: {
      preferences: [{ key: "budget", value: "no active limit", subject: "household", operation: "remove", evidence: "Price isn't an issue anymore" }],
      decisions: [], productHandles: [],
      references: { presentedProductHandles: [], comparisonProductHandles: [], lastDiscussedProductHandle: "12-dual-comfort-hybrid", lastDiscussedBaseHandle: null },
    },
  });
  assert.equal(removed.askSnoozerWorkingMemory.activeDeal.retainedPreferences["household:budget"], undefined);
}

async function main() {
  testMonetarySemantics();
  await testCorrectionRecovery();
  await testPersistentInvalidPriceUsesFocusedFallback();
  await testCommerceFailureIsExplicitAndSafe();
  await testAffordableDiscoveryAndRejectionGuard();
  await testPreparedFactMissIsExplicit();
  testStateProjectionNoOpAndBudgetRemoval();
  console.log("Ask Snoozer budget intelligence and monetary recovery tests passed.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
