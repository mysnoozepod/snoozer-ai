#!/usr/bin/env node

const assert = require("assert");
const manifest = require("../data/showroom-manifest.v1.json");
const {
  cardPresentationPolicy,
  getConversationCoreConfig,
  runSnoozerConversationCore,
  withToolDeadline,
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
const { buildAskJourneyPayload } = require("../services/activeJourney");

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
    imageUrl: `https://cdn.example/${handle}.jpg`,
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    monetaryClaims: [],
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
          partnerConsiderations: null, size: null, budgetMax: null, pricePreference: "fit", exclusions: [], limit: 2,
        }) }],
        functionCalls: [{ name: "discover_products", callId: "call_discover", arguments: JSON.stringify({
          sleepPosition: "side", temperature: "sleeps_hot", pressureAreas: ["shoulders"], firmness: null,
          partnerConsiderations: null, size: null, budgetMax: null, pricePreference: "fit", exclusions: [], limit: 2,
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
        monetaryClaims: [{
          semantic: "unverified_product_price", amount: 9999, currencyCode: "USD",
          productHandle: "12-all-foam-mattress", sourceTool: null, sourceKey: null,
          shopperEvidence: null, evidence: "$9,999.00",
        }],
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
        partnerConsiderations: null, size: "Queen", budgetMax: null, pricePreference: "fit", exclusions: [], limit: 2,
      }) }],
      functionCalls: [{ name: "discover_products", callId: "discover_for_repair", arguments: JSON.stringify({
        sleepPosition: "side", temperature: "sleeps_hot", pressureAreas: [], firmness: null,
        partnerConsiderations: null, size: "Queen", budgetMax: null, pricePreference: "fit", exclusions: [], limit: 2,
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

async function testClaimProvenanceCorrectionUsesExistingEvidence() {
  let calls = 0;
  const handle = "12-all-foam-mattress";
  const context = {
    snoozerConversationState: {
      preferences: {
        "shopper:size": { key: "size", subject: "shopper", value: "Queen", status: "active" },
      },
      references: {
        presentedProductHandles: [handle], comparisonProductHandles: [],
        lastDiscussedProductHandle: handle, lastDiscussedBaseHandle: null,
      },
    },
  };
  const runtime = async () => {
    calls += 1;
    const claim = calls === 1
      ? { kind: "product", value: "Verified pressure relief.", sourceTool: "get_product_facts", sourceKey: null }
      : { kind: "product", value: "Verified pressure relief.", sourceTool: "get_product_facts", sourceKey: handle };
    return {
      text: finalResponse({
        reply: "The 12-inch All Foam has verified pressure-relief construction.",
        productHandles: [handle], preferences: [], decisions: [],
        references: {
          presentedProductHandles: [handle], comparisonProductHandles: [],
          lastDiscussedProductHandle: handle, lastDiscussedBaseHandle: null,
        },
        claims: [claim],
      }),
      output: [], functionCalls: [], tokens: { prompt: 300, cached: 100, completion: 80, total: 380 },
    };
  };
  const result = await runSnoozerConversationCore({
    requestId: "claim-provenance-repair",
    message: "Recap why that Queen mattress fits me.",
    context,
    shopify,
    runtime,
    env: ENV,
    toolOverrides,
  });
  assert.equal(result.ok, true, JSON.stringify(result.telemetry));
  assert.equal(calls, 1, "provenance metadata repair must not add a model call");
  assert.equal(result.telemetry.recovery.attempted, false);
  assert.equal(result.telemetry.provenanceMetadataRepairs, 1);
  assert.equal(result.telemetry.toolExecutionCount, 2, "repair must reuse prepared evidence without another tool execution");
}

function testClaimSourceAndJourneyProjectionIntegrity() {
  const handle = "12-all-foam-mattress";
  const invalidSource = validateConversationResponse(JSON.parse(finalResponse({
    reply: "The mattress has verified pressure relief.",
    productHandles: [handle], preferences: [], decisions: [],
    references: {
      presentedProductHandles: [handle], comparisonProductHandles: [],
      lastDiscussedProductHandle: handle, lastDiscussedBaseHandle: null,
    },
    claims: [{ kind: "product", value: "Verified pressure relief.", sourceTool: "get_product_facts", sourceKey: "invented-document" }],
  })), {
    message: "Tell me about that mattress.",
    groundedProductHandles: [handle],
    successfulTools: ["get_product_facts"],
    successfulToolResults: [{ ok: true, name: "get_product_facts", data: { productFacts: [{ handle, sourceKey: `products/${handle}.md` }] } }],
    manifest,
  });
  assert.equal(invalidSource.valid, false);
  assert(invalidSource.errors.includes("claim_source_invalid:product"));

  const commerceSource = validateConversationResponse(JSON.parse(finalResponse({
    reply: "Current commerce details were verified.",
    productHandles: [handle], preferences: [], decisions: [],
    references: {
      presentedProductHandles: [handle], comparisonProductHandles: [],
      lastDiscussedProductHandle: handle, lastDiscussedBaseHandle: null,
    },
    claims: [{ kind: "commerce", value: "Current commerce details were verified.", sourceTool: "get_live_commerce", sourceKey: "shopify_storefront" }],
  })), {
    message: "Is it currently available?",
    groundedProductHandles: [handle],
    successfulTools: ["get_live_commerce"],
    successfulToolResults: [{ ok: true, name: "get_live_commerce", data: { source: "shopify_storefront", products: [{ handle }] } }],
    manifest,
  });
  assert.equal(commerceSource.valid, true, JSON.stringify(commerceSource.errors));

  const priorContext = {
    askSnoozerWorkingMemory: {
      activeDeal: {
        activeProductHandle: handle,
        activeSize: "Queen",
        activeBaseHandle: "premium-motion-adjustable-base",
        activeMotionKey: "standard",
        activeConfiguration: {
          productHandle: handle, size: "Queen",
          baseHandle: "premium-motion-adjustable-base", motionKey: "standard",
        },
        activeQuote: { ok: true, cartReady: true, productHandle: handle, size: "Queen", status: "complete" },
      },
    },
  };
  const response = JSON.parse(finalResponse({
    productHandles: [], claims: [], decisions: [],
    preferences: [{ key: "size", value: "King", subject: "shopper", operation: "set", evidence: "need King" }],
    references: {
      presentedProductHandles: [handle], comparisonProductHandles: [],
      lastDiscussedProductHandle: handle, lastDiscussedBaseHandle: "premium-motion-adjustable-base",
    },
  }));
  const projected = applyConversationState({
    context: priorContext,
    response,
    now: new Date("2026-10-28T16:00:00Z"),
  });
  const deal = projected.askSnoozerWorkingMemory.activeDeal;
  assert.equal(deal.activeSize, "King");
  assert.equal(deal.activeConfiguration.size, "King");
  assert.equal(deal.activeQuote.status, "invalidated");
  assert.equal(deal.activeQuote.invalidationReason, "size_changed");
  assert.equal(buildAskJourneyPayload(projected).activeConfiguration.size, "King");

  const quote = {
    ok: true, cartReady: true, status: "complete",
    productHandle: handle, baseHandle: "premium-motion-adjustable-base",
    size: "King", motionKey: "standard",
    compatibility: { status: "compatible" }, items: [],
  };
  const quoted = applyConversationState({ context: projected, response: { ...response, preferences: [] }, quote });
  const quotedDeal = quoted.askSnoozerWorkingMemory.activeDeal;
  assert.equal(quotedDeal.activeConfiguration.productHandle, handle);
  assert.equal(quotedDeal.activeConfiguration.size, "King");
  assert.equal(quotedDeal.activeConfiguration.baseHandle, "premium-motion-adjustable-base");
  assert.equal(quotedDeal.activeConfiguration.motionKey, "standard");
  assert.equal(quotedDeal.activeQuote.cartReady, true);

  const mattressOnly = applyConversationState({
    context: quoted,
    response: { ...response, preferences: [], decisions: [], claims: [] },
    message: "Actually price it mattress only.",
  });
  const mattressOnlyDeal = mattressOnly.askSnoozerWorkingMemory.activeDeal;
  assert.equal(mattressOnlyDeal.activeProductHandle, handle);
  assert.equal(mattressOnlyDeal.activeSize, "King");
  assert.equal(mattressOnlyDeal.baseDecision, "mattress_only");
  assert.equal(mattressOnlyDeal.activeConfiguration.baseDecision, "mattress_only");
  assert.equal(mattressOnlyDeal.activeConfiguration.baseHandle, null);
  assert.equal(mattressOnlyDeal.activeBaseHandle, null);
  assert.equal(mattressOnlyDeal.activeQuote.status, "invalidated");
  assert.equal(mattressOnlyDeal.activeQuote.invalidationReason, "base_removed");
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

async function testFactsCardHydrationFormattingAndRepeatSuppression() {
  let call = 0;
  const runtime = async () => {
    call += 1;
    if (call === 1) return {
      text: "", output: [{ type: "function_call", name: "get_product_facts", call_id: "facts", arguments: JSON.stringify({ productHandles: ["12-all-foam-mattress"], factClasses: ["product_features"] }) }],
      functionCalls: [{ name: "get_product_facts", callId: "facts", arguments: JSON.stringify({ productHandles: ["12-all-foam-mattress"], factClasses: ["product_features"] }) }], tokens: {},
    };
    return { text: finalResponse({
      reply: "**The 12-inch All Foam is the better pressure-relief option.** <script>bad()</script>",
      productHandles: ["12-all-foam-mattress"], preferences: [], decisions: [],
      references: { presentedProductHandles: ["12-all-foam-mattress"], comparisonProductHandles: [], lastDiscussedProductHandle: "12-all-foam-mattress", lastDiscussedBaseHandle: null },
      claims: [{ kind: "product", value: "Pressure relief", sourceTool: "get_product_facts", sourceKey: "12-all-foam-mattress" }],
    }), output: [], functionCalls: [], tokens: {} };
  };
  const result = await runSnoozerConversationCore({ requestId: "facts-card", message: "Tell me about the all foam mattress.", context: {}, shopify, runtime, env: ENV, toolOverrides });
  assert.equal(result.ok, true, JSON.stringify(result.telemetry));
  assert.equal(result.products[0].imageUrl, "https://cdn.example/12-all-foam-mattress.jpg");
  assert.equal(result.products[0].pricingMode, "starting_at");
  assert(!result.reply.includes("**") && !result.reply.includes("<script>"));

  const context = applyConversationState({ context: {}, response: result, now: new Date("2026-10-08T12:00:00Z") });
  const oneCall = await runSnoozerConversationCore({
    requestId: "known-followup", message: "Why is that Queen mattress better for me?", context, shopify, env: ENV, toolOverrides,
    runtime: async () => ({ text: finalResponse({
      reply: "It provides the deeper cushioning you asked about.", productHandles: ["12-all-foam-mattress"], preferences: [], decisions: [],
      references: { presentedProductHandles: ["12-all-foam-mattress"], comparisonProductHandles: [], lastDiscussedProductHandle: "12-all-foam-mattress", lastDiscussedBaseHandle: null },
      claims: [{ kind: "product", value: "Deeper cushioning", sourceTool: "get_product_facts", sourceKey: "12-all-foam-mattress" }],
    }), output: [], functionCalls: [], tokens: {} }),
  });
  assert.equal(oneCall.ok, true, JSON.stringify(oneCall.telemetry));
  assert.equal(oneCall.telemetry.modelCallCount, 1);
  assert.equal(oneCall.telemetry.preparedContext.enabled, true);
  assert(oneCall.telemetry.preparedContext.tools.some((item) => item.name === "get_live_commerce"));
  assert.equal(oneCall.products.length, 0);
  assert.equal(oneCall.telemetry.cardPresentation.reason, "unchanged_repeat");

  const commerceResponse = {
    productHandles: ["12-all-foam-mattress"],
    claims: [{ kind: "commerce", sourceTool: "get_live_commerce", sourceKey: "shopify_storefront" }],
    actionProposals: [],
  };
  const preparedCommerce = [{ ok: true, name: "get_live_commerce", prepared: true }];
  const recapPresentation = cardPresentationPolicy(
    commerceResponse, context, preparedCommerce, "Recap why the remaining setup fits and what I should do next."
  );
  assert.equal(recapPresentation.show, false, "a recap must not repeat already presented commerce cards");
  const pricePresentation = cardPresentationPolicy(
    commerceResponse, context, preparedCommerce, "What are the current price and availability?"
  );
  assert.equal(pricePresentation.show, true, "an explicit commerce question should show verified cards");
  assert.equal(pricePresentation.reason, "commerce_confirmation");
}

async function testPreparedExactConfigurationUsesOneModelCall() {
  let calls = 0;
  const runtime = async (request) => {
    calls += 1;
    const envelope = JSON.parse(request.input[0].content);
    assert(envelope.preparedEvidence.some((item) => item.tool === "quote_configuration"));
    return {
      text: finalResponse({
        reply: "That exact King Half Split Motion setup is not compatible, so I would not quote or add it to the cart.",
        productHandles: ["12-all-foam-mattress", "premium-motion-adjustable-base"],
        preferences: [],
        decisions: [],
        references: {
          presentedProductHandles: ["12-all-foam-mattress", "premium-motion-adjustable-base"],
          comparisonProductHandles: [],
          lastDiscussedProductHandle: "12-all-foam-mattress",
          lastDiscussedBaseHandle: "premium-motion-adjustable-base",
        },
        claims: [{
          kind: "compatibility",
          value: "The exact configuration is incompatible.",
          sourceTool: "quote_configuration",
          sourceKey: "12-all-foam-mattress:premium-motion-adjustable-base:king:half_split",
        }],
      }),
      output: [],
      functionCalls: [],
      tokens: { prompt: 500, cached: 100, completion: 100, total: 600, reasoning: 0 },
    };
  };
  const result = await runSnoozerConversationCore({
    requestId: "prepared-configuration",
    message: "Is a King 12-inch All Foam Mattress compatible with Half Split Motion on the Premium Motion Adjustable Base?",
    context: {},
    shopify,
    runtime,
    env: ENV,
    toolOverrides,
  });
  assert.equal(result.ok, true, JSON.stringify(result.telemetry));
  assert.equal(calls, 1);
  assert.equal(result.telemetry.modelCallCount, 1);
  assert.equal(result.telemetry.toolCallCount, 0);
  assert.equal(result.telemetry.preparedContext.configurationPrepared, true);
  assert(result.telemetry.preparedContext.tools.some((item) => item.name === "quote_configuration"));
  assert.deepEqual(result.actions, []);
}

async function testPreparedMattressOnlyQuoteOffersVerifiedCartAction() {
  let calls = 0;
  const handle = "12-dual-comfort-hybrid";
  const context = {
    snoozerConversationState: {
      references: {
        presentedProductHandles: [handle], comparisonProductHandles: [],
        lastDiscussedProductHandle: handle, lastDiscussedBaseHandle: null,
      },
      decisions: [], rejectedProductHandles: [], preferences: {},
    },
    askSnoozerWorkingMemory: {
      activeDeal: {
        activeProductHandle: handle,
        activeSize: "Queen",
        baseDecision: "mattress_only",
        activeBaseHandle: null,
        activeMotionKey: null,
        activeConfiguration: { productHandle: handle, size: "Queen", baseDecision: "mattress_only", baseHandle: null },
      },
    },
  };
  const runtime = async (request) => {
    calls += 1;
    const envelope = JSON.parse(request.input[0].content);
    const quoteEvidence = envelope.preparedEvidence.find((item) => item.tool === "quote_configuration");
    assert.equal(quoteEvidence?.data?.cartReady, true);
    assert.equal(quoteEvidence?.data?.baseHandle, null);
    assert.equal(quoteEvidence?.data?.items?.length, 1);
    return {
      text: finalResponse({
        reply: "Your verified Queen mattress-only quote is ready.",
        productHandles: [handle], preferences: [], decisions: [], actionProposals: [],
        references: {
          presentedProductHandles: [handle], comparisonProductHandles: [],
          lastDiscussedProductHandle: handle, lastDiscussedBaseHandle: null,
        },
        claims: [{
          kind: "commerce", value: "The Queen mattress-only quote is ready.",
          sourceTool: "quote_configuration", sourceKey: `${handle}:queen:none`,
        }],
      }),
      output: [], functionCalls: [], tokens: {},
    };
  };
  const result = await runSnoozerConversationCore({
    requestId: "prepared-mattress-only", message: "How much?", context, shopify, runtime, env: ENV, toolOverrides,
  });
  assert.equal(result.ok, true, JSON.stringify(result.telemetry));
  assert.equal(calls, 1);
  assert.equal(result.quote?.cartReady, true);
  assert.equal(result.quote?.items?.length, 1);
  assert.equal(result.actions?.[0]?.type, "add_to_cart");
  assert.equal(result.actions?.[0]?.payload?.lines?.length, 1);
  assert.equal(result.actions?.[0]?.payload?.lines?.[0]?.handle, handle);
}

async function testRequestScopedEvidenceReuseAndParallelTelemetry() {
  let modelCalls = 0;
  let factExecutions = 0;
  let commerceExecutions = 0;
  const handle = "12-all-foam-mattress";
  const duplicateArguments = JSON.stringify({
    productHandles: [handle],
    factClasses: ["partner_fit", "temperature", "support", "comfort", "product_features"],
  });
  const runtime = async () => {
    modelCalls += 1;
    if (modelCalls === 1) return {
      text: "",
      output: [{ type: "function_call", name: "get_product_facts", call_id: "duplicate_facts", arguments: duplicateArguments }],
      functionCalls: [{ name: "get_product_facts", callId: "duplicate_facts", arguments: duplicateArguments }],
      tokens: {},
    };
    return {
      text: finalResponse({
        reply: "The 12-inch All Foam remains the grounded pressure-relief option for your Queen setup.",
        productHandles: [handle],
        preferences: [],
        decisions: [],
        references: {
          presentedProductHandles: [handle], comparisonProductHandles: [],
          lastDiscussedProductHandle: handle, lastDiscussedBaseHandle: null,
        },
        claims: [{ kind: "product", value: "Pressure relief construction.", sourceTool: "get_product_facts", sourceKey: handle }],
      }),
      output: [], functionCalls: [], tokens: {},
    };
  };
  const result = await runSnoozerConversationCore({
    requestId: "request-scoped-evidence-reuse",
    message: "Why is that Queen mattress still the better pressure-relief fit?",
    context: {
      snoozerConversationState: {
        preferences: {
          "shopper:size": { key: "size", subject: "shopper", value: "Queen", status: "active" },
        },
        references: {
          presentedProductHandles: [handle], comparisonProductHandles: [],
          lastDiscussedProductHandle: handle, lastDiscussedBaseHandle: null,
        },
      },
    },
    shopify: {
      fetchProductsByHandles: async ({ handles = [] } = {}) => {
        commerceExecutions += 1;
        await wait(70);
        return { items: catalogProducts.filter((item) => handles.includes(item.handle)) };
      },
    },
    runtime,
    env: ENV,
    toolOverrides: {
      manifest,
      loadTrustedAdvisorFactPack: async ({ productHandles = [] } = {}) => {
        factExecutions += 1;
        await wait(45);
        return {
          productFacts: productHandles.map((item) => ({
            handle: item, status: "verified_fact", facts: ["Pressure relief construction."],
          })),
        };
      },
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result.telemetry));
  assert.equal(factExecutions, 1, "equivalent prepared facts should execute once");
  assert.equal(commerceExecutions, 1, "prepared live commerce should execute once");
  assert.equal(result.telemetry.duplicateCallsAvoided, 1);
  assert.equal(result.telemetry.preparedEvidenceHits, 1);
  assert.equal(result.telemetry.toolExecutionCount, 2);
  assert.equal(result.telemetry.toolProposalCount, 3);
  assert(result.telemetry.retrievalWorkMs > result.telemetry.retrievalWallMs + 20, JSON.stringify(result.telemetry));
  assert(result.telemetry.tools.some((item) => item.reused && item.duplicateSuppressed));
  assert(result.telemetry.tools.every((item) => ["verified", "missing", "failed", "stale", "unknown", "unsupported"].includes(item.evidenceStatus)));
}

async function testTypedEvidenceAndAbortAwareDeadline() {
  const missingCommerce = await executeConversationTool("get_live_commerce", {
    productHandles: ["12-all-foam-mattress"], size: "Queen", motionKey: null,
  }, {
    manifest,
    shopify: { fetchProductsByHandles: async () => ({ items: [] }) },
  });
  assert.equal(missingCommerce.ok, true);
  assert.equal(missingCommerce.evidenceStatus, "missing");
  assert.deepEqual(missingCommerce.data.missingHandles, ["12-all-foam-mattress"]);

  const failedCommerce = await executeConversationTool("get_live_commerce", {
    productHandles: ["12-all-foam-mattress"], size: "Queen", motionKey: null,
  }, {
    manifest,
    shopify: { fetchProductsByHandles: async () => { throw Object.assign(new Error("timeout"), { code: "SHOPIFY_TIMEOUT" }); } },
  });
  assert.equal(failedCommerce.ok, false);
  assert.equal(failedCommerce.evidenceStatus, "failed");
  assert.equal(failedCommerce.errorType, "timeout");
  assert.equal(failedCommerce.retryable, true);

  let aborted = false;
  const timedOut = await withToolDeadline((signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      aborted = true;
      reject(signal.reason);
    }, { once: true });
  }), 20, "abort_probe");
  assert.equal(timedOut.error, "tool_timeout");
  assert.equal(timedOut.aborted, true);
  assert.equal(aborted, true, "deadline must abort supported underlying work");
}

async function main() {
  assert.equal(getConversationCoreConfig({ ASK_SNOOZER_MODEL_ONLY: "cc_shadow", OPENAI_FINAL_MODEL: "gpt-6.1-sol" }).mode, "shadow");
  assert.equal(getConversationCoreConfig({ ASK_SNOOZER_MODEL_ONLY: "cc_active", OPENAI_FINAL_MODEL: "gpt-6.1-sol" }).mode, "active");
  await testFreshDiscoveryAndState();
  await testInvalidUngroundedResponseFallsBack();
  testValidationAndHistoryDiscipline();
  await testInventedPriceIsRejected();
  await testFalseNoProductsFallbackIsCorrected();
  await testClaimProvenanceCorrectionUsesExistingEvidence();
  testClaimSourceAndJourneyProjectionIntegrity();
  await testModelIdentityGuard();
  await testToolArgumentBoundary();
  await testFactsCardHydrationFormattingAndRepeatSuppression();
  await testPreparedExactConfigurationUsesOneModelCall();
  await testPreparedMattressOnlyQuoteOffersVerifiedCartAction();
  await testRequestScopedEvidenceReuseAndParallelTelemetry();
  await testTypedEvidenceAndAbortAwareDeadline();
  console.log("Ask Snoozer Conversation Core tests passed (Sol guard, tool correlation, request-scoped evidence reuse, typed evidence, parallel telemetry, abort-aware deadlines, grounding, state validation, history precedence, and safe fallback).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
