const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  INTERNAL_LANGUAGE,
  planAskSnoozerTurn,
  resolveAskSnoozerAdvisorTurn,
  validateResponseConsistency,
} = require("../services/askSnoozerConversationOrchestrator");
const {
  isCompleteShopperResponse,
  shortenAtSentenceBoundary,
} = require("../services/askSnoozerResponsePresenter");
const { buildSnoozerVoiceReply } = require("../services/snoozerVoice");
const { buildAskSnoozerQualityTrace } = require("../services/askSnoozerQualityTrace");

const prices = {
  "12-dual-comfort-hybrid": 1399,
  "14-hybrid": 2399,
  "12-all-foam-mattress": 1049,
  "premium-motion-adjustable-base": 2299,
};

function product(handle) {
  const titles = {
    "12-dual-comfort-hybrid": '12" Dual Comfort Hybrid',
    "14-hybrid": '14" Hybrid',
    "12-all-foam-mattress": '12" All Foam Mattress',
    "premium-motion-adjustable-base": "Premium Motion Adjustable Base",
  };
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title: titles[handle] || handle,
    available: true,
    variants: [{
      id: `gid://shopify/ProductVariant/${handle}-king`,
      title: "King",
      available: true,
      price: { amount: String(prices[handle]), currencyCode: "USD" },
      selectedOptions: [{ name: "Size", value: "King" }],
    }],
  };
}

async function fetchProductsByHandles({ handles = [] } = {}) {
  return { items: handles.map(product) };
}

function context(overrides = {}) {
  const activeDeal = {
    stage: "narrowing",
    activeProductHandle: "12-dual-comfort-hybrid",
    activeSize: "King",
    activeBaseHandle: null,
    activeMotionKey: "none",
    baseDecision: "declined",
    comparisonProductHandles: ["12-dual-comfort-hybrid", "14-hybrid"],
    sessionRecommendation: { productHandle: "12-dual-comfort-hybrid" },
    acceptedRecommendation: { productHandle: "12-dual-comfort-hybrid" },
    recommendationReasons: ["the All Foam felt too firm", "you wanted a more responsive alternative"],
    rejectedProducts: [{ handle: "12-all-foam-mattress", status: "rejected", reason: "too_firm" }],
    retainedPreferences: { motion: { value: "liked" } },
    desiredDirection: { feel: "softer" },
    activeConfiguration: { productHandle: "12-dual-comfort-hybrid", size: "King", scope: "mattress_only", baseHandle: null },
    eligibleAlternativeHandles: ["12-dual-comfort-hybrid", "14-hybrid"],
    rankedAlternatives: [
      { handle: "12-dual-comfort-hybrid", score: 92 },
      { handle: "14-hybrid", score: 84 },
    ],
    ...overrides,
  };
  return {
    canonicalRecommendation: {
      topPodId: "4",
      primaryMattressHandle: "12-all-foam-mattress",
      normalizedAssessment: { sleepPosition: "side" },
    },
    askSnoozerWorkingMemory: {
      turnIndex: 9,
      slots: { painPoints: { value: ["shoulder", "hip"] } },
      conversationFocus: { relevantTurns: [] },
      activeDeal,
    },
  };
}

async function run(query, ctx = context(), composer = null) {
  const plan = planAskSnoozerTurn({ query, context: ctx });
  const calls = [];
  const outcome = await resolveAskSnoozerAdvisorTurn({
    query,
    context: ctx,
    plan,
    fetchProductsByHandles,
    loadAdvisorKnowledge: async ({ productHandles = [] }) => ({
      productFacts: productHandles.map((handle) => ({ handle, facts: ["approved construction and feel facts"] })),
      advisorKnowledge: ["Use shopper feedback and explain the practical tradeoff."],
      policyFacts: plan.taskType === "warranty_explanation" ? ["10-year limited mattress warranty"] : [],
    }),
    composeAdvisorResponse: composer || (async ({ deterministicDraft, factPack }) => {
      calls.push(factPack);
      return {
        displayText: deterministicDraft.displayText,
        speechText: deterministicDraft.speechText,
        probe: null,
        nextActionIntent: null,
        confidence: 0.94,
        model: "phase4-academy-composer",
        inputChars: JSON.stringify(factPack).length,
        factPackChars: JSON.stringify(factPack).length,
      };
    }),
  });
  return { plan, outcome, calls };
}

async function main() {
  const scenarios = [];

  const comparison = await run("Compare the Dual Comfort and 14 Hybrid.");
  assert.equal(comparison.plan.taskType, "product_comparison");
  assert.equal(comparison.outcome.responsePath, "structured_composer");
  assert(isCompleteShopperResponse(comparison.outcome.reply));
  assert.match(comparison.outcome.reply, /Dual Comfort/i);
  assert.match(comparison.outcome.reply, /14-inch Hybrid/i);
  scenarios.push("product comparison");

  const comparisonValue = await run("What's the difference between these and is the Hybrid worth the extra money?");
  assert.equal(comparisonValue.plan.taskType, "comparison_value");
  assert.match(comparisonValue.outcome.reply, /differ|difference/i);
  assert.match(comparisonValue.outcome.reply, /worth|value|pay/i);
  scenarios.push("comparison + value compound question");

  for (const [query, task] of [
    ["Why?", "recommendation_explanation"],
    ["Which one would you pick for me?", "advisor_choice"],
    ["Which one should hold up better?", "durability_objection"],
    ["What does the Dual Comfort feel like?", "product_experience"],
    ["What if I skip the motion base?", "configuration_value"],
    ["I'm confused. What are we doing again?", "confusion_recovery"],
    ["You're not listening to me.", "trust_recovery"],
    ["Is there a warranty with this mattress?", "warranty_explanation"],
    ["Why is it better for me?", "recommendation_explanation"],
    ["So what would you do?", "advisor_choice"],
  ]) {
    const result = await run(query);
    assert.equal(result.plan.taskType, task, query);
    assert.equal(result.outcome.responsePath, "structured_composer", query);
    assert(isCompleteShopperResponse(result.outcome.reply), query);
  }
  scenarios.push("recommendation explanation", "objection handling", "durability", "feel explanation", "configuration explanation", "confusion", "frustration", "policy nuance", "short-reference continuation", "accepted recommendation recap");

  const atomicPrice = await run("How much is the King Dual Comfort?");
  assert.equal(atomicPrice.plan.taskType, "price_quote");
  assert.equal(atomicPrice.plan.needsModel, false);
  assert.equal(atomicPrice.outcome.responsePath, "atomic_deterministic");
  assert.match(atomicPrice.outcome.reply, /\$1,399/);
  scenarios.push("price atomic");

  const priceValue = await run("Why does the Hybrid cost more and is it worth it for me?");
  assert.equal(priceValue.plan.taskType, "price_value");
  assert.equal(priceValue.outcome.responsePath, "structured_composer", JSON.stringify({ gate: priceValue.outcome.gate, modelGate: priceValue.outcome.modelGate, reply: priceValue.outcome.reply }));
  assert.match(priceValue.outcome.reply, /\$1,399/);
  assert.match(priceValue.outcome.reply, /worth|value/i);
  scenarios.push("price substantive");

  const noMatchContext = context({
    activeProductHandle: null,
    sessionRecommendation: null,
    acceptedRecommendation: null,
    eligibleAlternativeHandles: [],
    rankedAlternatives: [],
  });
  noMatchContext.askSnoozerWorkingMemory.lastTransition = { interpretedActs: [{ type: "request_alternative" }] };
  const noMatch = await run("Show me something else.", noMatchContext);
  assert.equal(noMatch.plan.taskType, "alternative_resolution");
  assert.match(noMatch.outcome.reply, /do not have another eligible|will not invent/i);
  scenarios.push("no-match");

  const forcedFailure = await run("Compare the Dual Comfort and 14 Hybrid.", context(), async () => {
    throw Object.assign(new Error("forced composer failure"), { code: "E_FORCED" });
  });
  assert.equal(forcedFailure.outcome.responsePath, "grounded_safe_fallback");
  assert.equal(forcedFailure.outcome.compositionMode, "model_fallback");
  assert(isCompleteShopperResponse(forcedFailure.outcome.reply));
  scenarios.push("forced composer failure");

  const malformed = await run("Compare the Dual Comfort and 14 Hybrid.", context(), async () => ({
    displayText: "The 12-inch Dual Comfort Hybrid uses responsive support while...",
    speechText: "The comparison is",
  }));
  assert.equal(malformed.outcome.responsePath, "grounded_safe_fallback");
  assert(malformed.outcome.modelGate.violations.includes("truncated_ending"));
  scenarios.push("malformed composer response");

  const long = Array.from({ length: 12 }, (_, index) => `Complete comparison point ${index + 1} explains one practical tradeoff.`).join(" ");
  const shortened = shortenAtSentenceBoundary(long, { maxChars: 240, maxSentences: 9 });
  assert(shortened.length <= 300);
  assert(isCompleteShopperResponse(shortened));
  assert(!shortened.endsWith("..."));
  scenarios.push("long response completion");

  const internalGate = validateResponseConsistency({
    reply: "The sessionRecommendation resolver used a Shopify variant GID.",
    plan: { taskType: "product_experience", technicalLanguageAllowed: false, references: {}, protectedReferences: [] },
    factPack: { products: [], feedback: { explicitExclusions: [] } },
  });
  assert(internalGate.violations.some((item) => item.startsWith("internal_language:")));
  for (const phrase of INTERNAL_LANGUAGE) assert(!comparison.outcome.reply.toLowerCase().includes(phrase));
  scenarios.push("internal-language firewall");

  const voice = buildSnoozerVoiceReply("foam_vs_hybrid", {
    firstTitle: "12-inch All Foam Mattress",
    secondTitle: "14-inch Hybrid Mattress",
  });
  assert(isCompleteShopperResponse(voice));
  assert(!voice.endsWith("..."));
  assert(voice.length < comparison.outcome.reply.length);
  scenarios.push("display/voice consistency");

  const cardGate = validateResponseConsistency({
    reply: "I recommend the 12-inch Dual Comfort Hybrid because it fits your current feedback.",
    products: [{ handle: "14-hybrid" }],
    actions: [{ type: "add_to_cart", label: "Add full setup", payload: { handle: "14-hybrid" } }],
    plan: {
      taskType: "recommendation_explanation",
      technicalLanguageAllowed: false,
      protectedReferences: [],
      references: { activeProductHandle: "12-dual-comfort-hybrid", sessionRecommendationHandle: "12-dual-comfort-hybrid" },
    },
    factPack: {
      products: [{ handle: "12-dual-comfort-hybrid" }, { handle: "14-hybrid" }],
      feedback: { explicitExclusions: [] },
      recommendation: { current: "12-dual-comfort-hybrid" },
      state: { activeConfiguration: { scope: "mattress_only" } },
    },
  });
  assert(cardGate.violations.includes("unrelated_product_card:14-hybrid"));
  assert(cardGate.violations.includes("wrong_product_action:14-hybrid"));
  assert(cardGate.violations.includes("action_scope_mismatch"));
  scenarios.push("card/action consistency");

  const badTrace = buildAskSnoozerQualityTrace({
    query: "Compare them and tell me which is worth it.",
    reply: "The first uses foam while...",
    plan: { taskType: "comparison_value", query: "Compare them and tell me which is worth it.", responseDepth: "compare", references: {} },
    gate: { ok: false, violations: ["truncated_ending", "comparison_incomplete", "compound_value_unanswered"] },
    responsePath: "legacy_path",
  });
  assert.equal(badTrace.responseComplete, false);
  assert.equal(badTrace.compoundQuestionFullyAnswered, false);
  assert.equal(badTrace.comparisonComplete, false);
  assert.equal(badTrace.legacyProsePathUsed, true);
  assert.equal(badTrace.outcome.category, "friction");
  assert.equal(badTrace.alert.severity, "P2");

  const routeSource = fs.readFileSync(path.join(__dirname, "..", "routes", "askSnoozerRoutes.js"), "utf8");
  assert(routeSource.includes('new Set(["find_rewards", "analyze_cart", "browse_products"])'));
  assert(routeSource.includes('String(mode || "").toLowerCase() === "ask_snoozer_page"'));
  assert(routeSource.includes('path: "legacy_path"'));
  scenarios.push("legacy path detection");

  assert(new Set(scenarios).size >= 21);
  console.log(JSON.stringify({
    academy: "response-quality/unified-advisor-pipeline",
    scenarios: scenarios.length,
    passed: scenarios.length,
    comparisonPath: comparison.outcome.responsePath,
    atomicPricePath: atomicPrice.outcome.responsePath,
    forcedFailurePath: forcedFailure.outcome.responsePath,
    voice,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
