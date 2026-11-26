#!/usr/bin/env node

const assert = require("assert");
const manifest = require("../data/showroom-manifest.v1.json");
const {
  getConversationCoreConfig,
  runSnoozerConversationCore,
  validateReplyMonetaryClaims,
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

async function testWebsiteAssessmentContinuityAndGrounding() {
  const handle = "12-inch-dual-comfort-mattress";
  const mattress = product(handle, '12" Dual Comfort Mattress', "dual", 2000);
  mattress.variants = [
    { ...mattress.variants[0], id: "gid://shopify/ProductVariant/101" },
    {
      id: "gid://shopify/ProductVariant/102", price: null, availableForSale: false,
      selectedOptions: [{ name: "Size", value: "King" }],
    },
    {
      id: "gid://shopify/ProductVariant/103", price: { amount: "3000", currencyCode: "USD" }, availableForSale: true,
      selectedOptions: [{ name: "Size", value: "Split Head Queen" }],
    },
  ];
  const websiteShopify = {
    fetchProductsByHandles: async ({ handles }) => {
      assert(!handles.includes("12-dual-comfort-hybrid"));
      return { items: handles.includes(handle) ? [mattress] : [] };
    },
  };
  const navigate = (target, { handles = [], size = null, motionKey = null } = {}) => ({
    type: "navigate", label: "Continue", target, productHandles: handles, size, motionKey, baseHandle: null, scope: "none",
  });
  const preference = (key, value, subject, evidence, operation = "set") => ({ key, value, subject, operation, evidence });
  const commerce = (size) => ({ name: "get_live_commerce", args: { productHandles: [handle], size, motionKey: null } });
  let context = {};

  async function turn(message, response, { tool, inspectEnvelope, inspectEvidence } = {}) {
    let callCount = 0;
    const result = await runSnoozerConversationCore({
      requestId: "website-assessment", source: "website", message, context, shopify: websiteShopify, env: ENV,
      runtime: async ({ input, instructions, tools, text }) => {
        callCount += 1;
        assert.match(instructions, /first resolve whether they want an adjustable bed or want it to stay flat/);
        assert.match(instructions, /one shared, unsplit Dual Comfort mattress/);
        assert.match(instructions, /Full Split Queen is not offered/);
        assert.match(instructions, /They can switch goals at any time/);
        assert(!tools.some(({ name }) => ["quote_configuration", "get_cart", "get_rewards"].includes(name)));
        assert(text.format.schema.properties.preferences.items.properties.key.enum.includes("motion_preference"));
        const envelope = JSON.parse(input[0].content);
        assert(envelope.approvedProducts.some((item) => item.handle === handle));
        assert(!envelope.approvedProducts.some((item) => item.handle === "12-dual-comfort-hybrid"));
        inspectEnvelope?.(envelope);
        if (tool && callCount === 1) return {
          text: "", output: [{ type: "function_call", name: tool.name, call_id: "website_read", arguments: JSON.stringify(tool.args) }],
          functionCalls: [{ name: tool.name, callId: "website_read", arguments: tool.args }], tokens: {},
        };
        if (inspectEvidence) inspectEvidence(JSON.parse(input.at(-1).output));
        return {
          text: finalResponse({
            productHandles: [], preferences: [], claims: [], decisions: [],
            references: { presentedProductHandles: [], comparisonProductHandles: [], lastDiscussedProductHandle: null, lastDiscussedBaseHandle: null },
            ...response,
          }), output: [], functionCalls: [], tokens: {},
        };
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result.telemetry));
    context = applyConversationState({ context, response: result });
    return result;
  }

  await turn("I'd like it soft, my partner wants it firm, and we'd like to keep a Queen bed.", {
    reply: "You can have two feels on one shared mattress. Are you happy keeping the bed flat, or would you like it to adjust?",
    responseMode: "clarification",
    preferences: [
      preference("firmness", "Soft", "shopper", "I'd like it soft"),
      preference("firmness", "Firm", "partner", "my partner wants it firm"),
      preference("size", "Queen", "household", "Queen bed"),
    ],
  });

  const flat = await turn("Keep it flat. Can you show me one that works in Queen?", {
    reply: "You can have Soft on your side and Firm on your partner's side on the same flat Queen mattress.",
    preferences: [preference("motion_preference", "flat", "household", "Keep it flat")],
    productHandles: [handle],
    actionProposals: [navigate(null, { handles: [handle], size: "Queen" })],
    claims: [{ kind: "product", sourceTool: "discover_products", sourceKey: handle, value: "Independent mattress comfort" }],
  }, {
    tool: { name: "discover_products", args: {
      sleepPosition: null, temperature: null, pressureAreas: [], firmness: null, partnerConsiderations: "two different feels",
      size: "Queen", budgetMax: null, pricePreference: "fit", exclusions: [], limit: 2,
    } },
    inspectEvidence: ({ data }) => {
      assert.equal(data.products[0].curatedAttributes.dualComfort, true);
      assert.equal(data.products[0].commerce.price, 2000);
      assert.deepEqual(data.products[0].commerce.offeredSizes, ["Queen", "King"]);
    },
  });
  assert.equal(flat.actions[0]?.target, `/products/${handle}?variant=101`);
  assert.equal(flat.products[0]?.url, flat.actions[0]?.target);

  const motion = await turn("Actually I'd like to sit up while they stay flat, but only at the head.", {
    reply: "Half Split lets you raise your head while your partner stays flat. You can still keep Soft on your side and Firm on theirs.",
    preferences: [preference("motion_preference", "half_split", "household", "only at the head", "correct")],
    actionProposals: [navigate("/pages/sleep-systems", { motionKey: "half_split", size: "Queen" })],
  }, { inspectEnvelope: ({ conversationState }) => {
    assert(conversationState.preferences.some((item) => item.key === "motion_preference" && item.value === "flat"));
  } });
  assert.equal(motion.actions[0]?.target, "/pages/sleep-systems?system=split_head#sleep-systems");

  const incompatible = await turn("What if we get Full Split in Queen?", {
    reply: "Full Split isn't offered in Queen. Would you rather keep Queen with independent head movement or consider Split King for independent head and foot movement?",
    responseMode: "clarification",
    preferences: [preference("motion_preference", "full_split", "household", "Full Split in Queen")],
    actionProposals: [navigate("/pages/sleep-systems", { motionKey: "full_split", size: "Queen" })],
  });
  assert.deepEqual(incompatible.actions, []);
  assert.equal(incompatible.preferences.length, 0);

  const unavailable = await turn('Is the 12" Dual Comfort available in King on its own?', {
    reply: "The King variant is currently unavailable, and I couldn't verify its price.",
    claims: [{ kind: "commerce", sourceTool: "get_live_commerce", sourceKey: handle, value: "King variant unavailable" }],
    actionProposals: [navigate(null, { handles: [handle], size: "King" }), navigate("https://example.invalid")],
  }, { tool: commerce("King"), inspectEvidence: ({ data }) => {
    assert.equal(data.products[0].available, false);
    assert.equal(data.products[0].price, null);
  } });
  assert.deepEqual(unavailable.actions.map(({ target }) => target), [`/products/${handle}?variant=102`]);
  assert(validateReplyMonetaryClaims({
    reply: "The King is $0.",
    monetaryClaims: [{
      semantic: "verified_exact_variant_price", amount: 0, currencyCode: "USD", productHandle: handle,
      sourceTool: "get_live_commerce", sourceKey: handle, shopperEvidence: null, evidence: "$0",
    }],
  }, unavailable.toolResults).some((error) => error.startsWith("price_not_grounded")));

  const splitMattressLink = await turn('Can I buy the 12-inch Dual Comfort in Split Head Queen on its own?', {
    reply: "Split Head Queen is offered through Sleep Systems with an adjustable base.",
    productHandles: [handle],
    actionProposals: [
      navigate(null, { handles: [handle] }),
      navigate("/pages/sleep-systems", { motionKey: "half_split", size: "Queen" }),
    ],
  }, { tool: commerce("Split Head Queen") });
  assert.deepEqual(splitMattressLink.products, []);
  assert.deepEqual(splitMattressLink.actions.map(({ target }) => target), ["/pages/sleep-systems?system=split_head#sleep-systems"]);

  const book = await turn("Can we try this in person? I'd like to book.", {
    reply: "A Snooze Session gives you both a chance to compare the two feels and try raising just your side at the head.",
    actionProposals: [navigate("/pages/book-a-snooze-session")],
  }, { inspectEnvelope: ({ conversationState }) => {
    const saved = Object.fromEntries(conversationState.preferences.map((item) => [`${item.subject}:${item.key}`, item.value]));
    assert.deepEqual(saved, {
      "shopper:firmness": "Soft", "partner:firmness": "Firm", "household:size": "Queen", "household:motion_preference": "half_split",
    });
  } });
  assert.deepEqual(book.actions, [{ type: "navigate", label: "Book a Snooze Session", target: "/pages/book-a-snooze-session", payload: {} }]);
  context = {};
  const directBook = await turn("I'd like to book a Snooze Session.", {
    reply: "You can choose a time on the booking page.", actionProposals: [navigate("/pages/book-a-snooze-session")],
  });
  assert.equal(directBook.actions[0]?.target, "/pages/book-a-snooze-session");
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
  await testFactsCardHydrationFormattingAndRepeatSuppression();
  await testPreparedExactConfigurationUsesOneModelCall();
  await testWebsiteAssessmentContinuityAndGrounding();
  console.log("Website assessment tests passed (comfort/motion continuity, exact Shopify variant handoff, Full Split Queen, booking, and unavailable variant handling).");
  console.log("Ask Snoozer Conversation Core tests passed (Sol guard, tool correlation, grounding, state validation, history precedence, and safe fallback).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
