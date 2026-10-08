#!/usr/bin/env node

const assert = require("assert");
const manifest = require("../data/showroom-manifest.v1.json");
const {
  getConversationCoreConfig,
  runSnoozerConversationCore,
} = require("../services/askSnoozerModelCore");
const {
  applyConversationState,
  compactConversationState,
  normalizedConversationHistory,
} = require("../services/askSnoozerConversationState");
const {
  validateConversationResponse,
} = require("../services/askSnoozerConversationContracts");
const {
  executeConversationTool,
} = require("../services/askSnoozerConversationTools");

const ENV = {
  ASK_SNOOZER_CONVERSATION_CORE_MODE: "active",
  ASK_SNOOZER_CONVERSATION_CORE_MODEL: "gpt-6.1-sol",
  ASK_SNOOZER_CONVERSATION_CORE_REASONING_EFFORT: "low",
  ASK_SNOOZER_CONVERSATION_CORE_MAX_TOOL_ROUNDS: "2",
  ASK_SNOOZER_CONVERSATION_CORE_MAX_TOOL_CALLS: "6",
  ASK_SNOOZER_CONVERSATION_CORE_TOTAL_TIMEOUT_MS: "5000",
  ASK_SNOOZER_CONVERSATION_CORE_MODEL_TIMEOUT_MS: "2000",
};

function product(handle, title, family, price) {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title,
    family,
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
  product("12-dual-comfort-hybrid", "12-inch Dual Comfort Hybrid", "dual", 2499),
  product("14-hybrid", "14-inch Hybrid", "hybrid", 2399),
  product("12-all-foam-mattress", "12-inch All Foam Mattress", "foam", 1299),
  product("10-all-foam-mattress", "10-inch All Foam Mattress", "foam", 549),
  product("premium-motion-adjustable-base", "Premium Motion Adjustable Base", "adjustable", 1899),
];

const shopify = {
  fetchProductsByHandles: async ({ handles = [] } = {}) => ({
    items: catalogProducts.filter((item) => handles.includes(item.handle)),
  }),
};

const toolOverrides = {
  manifest,
  getShowroomCommerceCatalog: async () => ({
    catalogVersion: "test",
    products: catalogProducts,
    missingHandles: [],
  }),
  loadTrustedAdvisorFactPack: async ({ productHandles = [] } = {}) => ({
    productFacts: productHandles.map((handle) => ({
      handle,
      status: "verified_fact",
      sourceKey: `products/${handle}.md`,
      facts: handle === "14-hybrid"
        ? ["Curated cooling construction."]
        : ["Curated pressure-relief construction."],
    })),
  }),
};

function finalResponse(overrides = {}) {
  const base = {
    reply: "For a side sleeper with shoulder pressure who sleeps hot, I would compare the 12-inch All Foam and the 12-inch Dual Comfort Hybrid. I would start with the Dual Comfort because it balances pressure relief with verified cooling.",
    speech: "I would compare the 12-inch All Foam and the 12-inch Dual Comfort Hybrid, and start with the Dual Comfort for pressure relief plus cooling.",
    captions: "I would compare the 12-inch All Foam and the 12-inch Dual Comfort Hybrid, and start with the Dual Comfort for pressure relief plus cooling.",
    state: "speaking",
    priority: "normal",
    ttlMs: 7000,
    responseMode: "answer",
    productHandles: ["12-all-foam-mattress", "12-dual-comfort-hybrid"],
    chips: [],
    actionProposals: [],
    preferences: [
      { key: "sleep_position", value: "side", subject: "shopper", operation: "set", evidence: "side sleeper" },
      { key: "pressure_area", value: "shoulders", subject: "shopper", operation: "set", evidence: "shoulders get sore" },
      { key: "temperature", value: "sleeps_hot", subject: "shopper", operation: "set", evidence: "sleep hot" },
    ],
    references: {
      presentedProductHandles: ["12-all-foam-mattress", "12-dual-comfort-hybrid"],
      comparisonProductHandles: ["12-all-foam-mattress", "12-dual-comfort-hybrid"],
      lastDiscussedProductHandle: "12-dual-comfort-hybrid",
      lastDiscussedBaseHandle: null,
    },
    decisions: [{ status: "recommended", productHandle: "12-dual-comfort-hybrid", configurationKey: null, evidence: "side sleeper" }],
    claims: [
      { kind: "product", value: "The Dual Comfort has verified cooling.", sourceTool: "discover_products", sourceKey: "12-dual-comfort-hybrid" },
    ],
    fallback: { used: false, reason: null },
  };
  return JSON.stringify({ ...base, ...overrides });
}

async function testFreshDiscoveryAndState() {
  const calls = [];
  const runtime = async (request) => {
    calls.push(request);
    if (calls.length === 1) {
      return {
        text: "",
        output: [{ type: "function_call", name: "discover_products", call_id: "call_discover", arguments: JSON.stringify({
          sleepPosition: "side", temperature: "sleeps_hot", pressureAreas: ["shoulders"], firmness: null,
          partnerConsiderations: null, size: null, budgetMax: null, exclusions: [], limit: 2,
        }) }],
        functionCalls: [{ name: "discover_products", callId: "call_discover", arguments: JSON.stringify({
          sleepPosition: "side", temperature: "sleeps_hot", pressureAreas: ["shoulders"], firmness: null,
          partnerConsiderations: null, size: null, budgetMax: null, exclusions: [], limit: 2,
        }) }],
        tokens: { prompt: 500, cached: 100, completion: 100, total: 600, reasoning: 20 },
      };
    }
    assert(request.input.some((item) => item.type === "function_call_output" && item.call_id === "call_discover"));
    return {
      text: finalResponse(), output: [], functionCalls: [],
      tokens: { prompt: 700, cached: 200, completion: 200, total: 900, reasoning: 30 },
    };
  };
  const message = "I'm primarily a side sleeper, my shoulders get sore, and I sleep hot.";
  const result = await runSnoozerConversationCore({
    requestId: "core-unit-discovery", message, context: {}, shopify, runtime, env: ENV, toolOverrides,
  });
  assert.equal(result.ok, true, JSON.stringify(result.telemetry));
  assert.equal(calls.length, 2);
  assert.deepEqual(result.productHandles, ["12-all-foam-mattress", "12-dual-comfort-hybrid"]);
  assert.equal(result.telemetry.modelCallCount, 2);
  assert.equal(result.telemetry.toolCallCount, 1);
  assert(result.telemetry.usage.estimatedCostUsd > 0);
  const context = applyConversationState({ context: {}, response: result, quote: result.quote, now: new Date("2026-10-08T12:00:00Z") });
  const compact = compactConversationState(context);
  assert.equal(compact.preferences.length, 3);
  assert.deepEqual(compact.references.comparisonProductHandles, ["12-all-foam-mattress", "12-dual-comfort-hybrid"]);
  assert.equal(compact.decisions[0].status, "recommended");
}

async function testInvalidUngroundedResponseFallsBack() {
  const runtime = async () => ({
    text: finalResponse({
      productHandles: ["not-a-real-product"],
      references: {
        presentedProductHandles: ["not-a-real-product"], comparisonProductHandles: [],
        lastDiscussedProductHandle: "not-a-real-product", lastDiscussedBaseHandle: null,
      },
      decisions: [], claims: [], preferences: [],
    }),
    output: [], functionCalls: [], tokens: {},
  });
  const result = await runSnoozerConversationCore({
    requestId: "core-unit-invalid", message: "Recommend something.", context: {}, shopify, runtime, env: ENV, toolOverrides,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "fallback");
  assert(result.telemetry.validationErrors.some((item) => item.includes("product_not_approved")));
  assert.deepEqual(result.decisions, []);
}

function testValidationAndHistoryDiscipline() {
  const raw = JSON.parse(finalResponse({
    productHandles: [], claims: [],
    references: { presentedProductHandles: [], comparisonProductHandles: [], lastDiscussedProductHandle: null, lastDiscussedBaseHandle: null },
    preferences: [{ key: "firmness", value: "firm", subject: "shopper", operation: "set", evidence: "not in message" }],
    decisions: [{ status: "accepted", productHandle: null, configurationKey: "setup", evidence: "buy it" }],
  }));
  const validation = validateConversationResponse(raw, { message: "What if I buy it?", manifest });
  assert.equal(validation.valid, true);
  assert.equal(validation.value.preferences.length, 0);
  assert.equal(validation.value.decisions.length, 0);
  assert.equal(validation.stateValidation.rejectedPreferences[0].reason, "preference_evidence_missing");
  assert.equal(validation.stateValidation.rejectedDecisions[0].reason, "hypothetical_not_commitment");

  const rejected = validateConversationResponse(JSON.parse(finalResponse({
    productHandles: [], claims: [], preferences: [],
    references: { presentedProductHandles: [], comparisonProductHandles: [], lastDiscussedProductHandle: null, lastDiscussedBaseHandle: null },
    decisions: [{ status: "recommended", productHandle: "14-hybrid", configurationKey: null, evidence: "show me an option" }],
  })), {
    message: "Show me an option.",
    groundedProductHandles: ["14-hybrid"],
    rejectedProductHandles: ["14-hybrid"],
    manifest,
  });
  assert.equal(rejected.valid, true);
  assert.equal(rejected.value.decisions.length, 0);
  assert.equal(rejected.stateValidation.rejectedDecisions[0].reason, "rejected_product_not_reactivated");

  const history = normalizedConversationHistory(
    [{ role: "user", content: "Earlier" }, { role: "user", content: "Earlier" }, { role: "user", content: "Current" }],
    [{ role: "assistant", content: "Persisted should not win" }],
    "Current"
  );
  assert.deepEqual(history, [{ role: "user", content: "Earlier" }]);
}

async function testInventedPriceIsRejected() {
  let call = 0;
  const runtime = async () => {
    call += 1;
    if (call === 1) return {
      text: "", output: [{ type: "function_call", name: "get_live_commerce", call_id: "price_call", arguments: JSON.stringify({
        productHandles: ["12-all-foam-mattress"], size: "Queen", motionKey: null,
      }) }],
      functionCalls: [{ name: "get_live_commerce", callId: "price_call", arguments: JSON.stringify({
        productHandles: ["12-all-foam-mattress"], size: "Queen", motionKey: null,
      }) }], tokens: {},
    };
    return {
      text: finalResponse({
        reply: "The Queen is $9,999.00.", speech: "The Queen is $9,999.00.", captions: "The Queen is $9,999.00.",
        productHandles: ["12-all-foam-mattress"], preferences: [], decisions: [],
        references: { presentedProductHandles: ["12-all-foam-mattress"], comparisonProductHandles: [], lastDiscussedProductHandle: "12-all-foam-mattress", lastDiscussedBaseHandle: null },
        claims: [{ kind: "commerce", value: "$9,999.00", sourceTool: "get_live_commerce", sourceKey: "12-all-foam-mattress" }],
      }), output: [], functionCalls: [], tokens: {},
    };
  };
  const result = await runSnoozerConversationCore({
    requestId: "core-unit-price", message: "What is the Queen price?", context: {}, shopify, runtime, env: ENV, toolOverrides,
  });
  assert.equal(result.ok, false);
  assert(result.telemetry.validationErrors.includes("price_not_grounded:9999.00"));
}

async function testFalseNoProductsFallbackIsCorrected() {
  let call = 0;
  const runtime = async () => {
    call += 1;
    if (call === 1) return {
      text: "",
      output: [{ type: "function_call", name: "discover_products", call_id: "discover_for_repair", arguments: JSON.stringify({
        sleepPosition: "side", temperature: "sleeps_hot", pressureAreas: [], firmness: null,
        partnerConsiderations: null, size: "Queen", budgetMax: null, exclusions: [], limit: 2,
      }) }],
      functionCalls: [{ name: "discover_products", callId: "discover_for_repair", arguments: JSON.stringify({
        sleepPosition: "side", temperature: "sleeps_hot", pressureAreas: [], firmness: null,
        partnerConsiderations: null, size: "Queen", budgetMax: null, exclusions: [], limit: 2,
      }) }],
      tokens: {},
    };
    if (call === 2) return {
      text: finalResponse({
        reply: "I could not find any verified products.",
        productHandles: [], preferences: [], decisions: [], claims: [],
        references: { presentedProductHandles: [], comparisonProductHandles: [], lastDiscussedProductHandle: null, lastDiscussedBaseHandle: null },
        fallback: { used: true, reason: "no_verified_products" },
      }),
      output: [], functionCalls: [], tokens: {},
    };
    return {
      text: finalResponse({
        reply: "I found two verified Queen options: the 12-inch Dual Comfort Hybrid and the 14-inch Hybrid.",
        productHandles: ["12-dual-comfort-hybrid", "14-hybrid"],
        references: {
          presentedProductHandles: ["12-dual-comfort-hybrid", "14-hybrid"],
          comparisonProductHandles: ["12-dual-comfort-hybrid", "14-hybrid"],
          lastDiscussedProductHandle: "12-dual-comfort-hybrid",
          lastDiscussedBaseHandle: null,
        },
        decisions: [{ status: "recommended", productHandle: "12-dual-comfort-hybrid", configurationKey: null, evidence: "side sleeper" }],
        claims: [{ kind: "product", value: "Two verified Queen options were found.", sourceTool: "discover_products", sourceKey: "12-dual-comfort-hybrid,14-hybrid" }],
      }),
      output: [], functionCalls: [], tokens: {},
    };
  };
  const result = await runSnoozerConversationCore({
    requestId: "core-unit-false-fallback", message: "Recommend two Queen mattresses for a side sleeper who sleeps hot.",
    context: {}, shopify, runtime, env: ENV, toolOverrides,
  });
  assert.equal(result.ok, true, JSON.stringify(result.telemetry));
  assert.equal(result.fallback.used, false, JSON.stringify({ call, telemetry: result.telemetry, fallback: result.fallback }));
  assert.equal(call, 3);
  assert.equal(result.telemetry.tools[0].summary.productCount, 2);
}

async function testModelIdentityGuard() {
  await assert.rejects(
    () => runSnoozerConversationCore({
      requestId: "core-unit-model", message: "Hello", context: {}, shopify,
      runtime: async () => { throw new Error("must not run"); },
      env: { ...ENV, ASK_SNOOZER_CONVERSATION_CORE_MODEL: "gpt-6-luna" }, toolOverrides,
    }),
    (error) => error?.code === "CONVERSATION_CORE_MODEL_MISMATCH"
  );
}

async function testToolArgumentBoundary() {
  const invalid = await executeConversationTool("get_policy", { topic: "invented", question: "Anything?" }, { manifest });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "tool_arguments_type_invalid");
  const extra = await executeConversationTool("get_cart", { reason: "read", mutate: true }, { manifest });
  assert.equal(extra.ok, false);
  assert.equal(extra.error, "tool_arguments_shape_invalid");
}

async function main() {
  assert.equal(getConversationCoreConfig({ ASK_SNOOZER_MODEL_ONLY: "cc_shadow", OPENAI_FINAL_MODEL: "gpt-6.1-sol" }).mode, "shadow");
  assert.equal(getConversationCoreConfig({ ASK_SNOOZER_MODEL_ONLY: "cc_active", OPENAI_FINAL_MODEL: "gpt-6.1-sol" }).mode, "active");
  await testFreshDiscoveryAndState();
  await testInvalidUngroundedResponseFallsBack();
  testValidationAndHistoryDiscipline();
  await testInventedPriceIsRejected();
  await testFalseNoProductsFallbackIsCorrected();
  await testModelIdentityGuard();
  await testToolArgumentBoundary();
  console.log("Ask Snoozer Conversation Core tests passed (Sol guard, tool correlation, grounding, state validation, history precedence, and safe fallback).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
