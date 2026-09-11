#!/usr/bin/env node

const assert = require("assert");
const {
  planAskSnoozerTurn,
  resolveAskSnoozerAdvisorTurn,
} = require("../services/askSnoozerConversationOrchestrator");
const {
  applyAskSnoozerWorkingMemory,
  completeAskSnoozerAdvisorTurn,
} = require("../services/askSnoozerWorkingMemory");
const {
  clampAskSnoozerDisplayReply,
  clampAskSnoozerVoiceReply,
} = require("../services/askSnoozerAnswerEngine");
const { buildAskSnoozerQualityTrace } = require("../services/askSnoozerQualityTrace");

function product(handle, title, options) {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title,
    available: true,
    availableForSale: true,
    variants: options.map(([label, price], index) => ({
      id: `gid://shopify/ProductVariant/${handle}-${index}`,
      title: label,
      selectedOptions: [{ name: "Size", value: label }],
      available: true,
      availableForSale: true,
      price,
      currencyCode: "USD",
    })),
  };
}

const products = [
  product("12-all-foam-mattress", "12-inch All Foam Mattress", [["Queen", 1299], ["King", 1599]]),
  product("12-dual-comfort-hybrid", "12-inch Dual Comfort Hybrid", [["King", 3199], ["Half Split King", 3799]]),
  product("14-hybrid", "14-inch Hybrid Mattress", [["King", 3199]]),
  product("premium-motion-adjustable-base", "Premium Motion Adjustable Base", [["King (2pc)", 2899]]),
];

async function fetchProductsByHandles({ handles = [] } = {}) {
  const wanted = new Set(handles);
  return { items: products.filter((item) => wanted.has(item.handle)) };
}

const modelTurns = [];
async function composeAdvisorResponse(input) {
  modelTurns.push(input.strategy.taskType);
  return {
    displayText: input.deterministicDraft.displayText,
    speechText: input.deterministicDraft.speechText,
    probe: null,
    nextActionIntent: null,
    confidence: 0.98,
    model: "composer-contract-test",
  };
}

async function loadAdvisorKnowledge({ productHandles = [], taskType = "" } = {}) {
  return {
    version: "test-v1",
    status: "advisor_interpretation",
    principles: ["Advance the decision, not the sale."],
    topicGuidance: {},
    productFacts: productHandles.map((handle) => ({ handle, status: "verified_fact", facts: ["Approved product fact."] })),
    policyFacts: taskType === "warranty_explanation"
      ? [{ topic: "warranty", status: "verified_fact", facts: ["10-year limited mattress warranty."] }]
      : [],
  };
}

async function main() {
  let context = {
    canonicalRecommendation: {
      topPodId: "4",
      primaryMattressHandle: "12-all-foam-mattress",
      normalizedAssessment: { sleepPosition: "Side", painPoints: ["Shoulders", "Hips"] },
    },
    recentConversation: [],
  };
  const transcript = [
    ["What does the 12-inch All Foam Mattress feel like?", "product_experience"],
    ["What does Standard Motion do?", "base_education"],
    ["Which mattress would you choose for a side sleeper?", "advisor_choice"],
    ["I like the feel of the All Foam but I'm scared it may start to sag.", "durability_objection"],
    ["Sure, tell me about your hybrids.", "hybrid_exploration"],
    ["I'm interested in the Dual Comfort but I'm not sure I want the motion base.", "compound_product_base"],
    ["I need a King size.", "configuration_update"],
    ["I'm confused.", "confusion_recovery"],
    ["Is there a warranty with the mattress?", "warranty_explanation"],
    ["What is your return policy?", "legacy"],
    ["How long does delivery take?", "legacy"],
    ["Okay, so I want the Half Split King 12-inch Dual Comfort with the motion base. How much is that?", "bundle_quote"],
  ];
  const outputs = [];
  for (const [query, expectedTask] of transcript) {
    const before = context;
    context = applyAskSnoozerWorkingMemory({ query, context });
    const plan = planAskSnoozerTurn({ query, context, referenceContext: before });
    assert.equal(plan.taskType, expectedTask, `${query} should classify as ${expectedTask}`);
    if (!plan.handled) {
      outputs.push({ query, plan, outcome: null });
      continue;
    }
    const outcome = await resolveAskSnoozerAdvisorTurn({
      query,
      context,
      plan,
      fetchProductsByHandles,
      composeAdvisorResponse,
      loadAdvisorKnowledge,
      requestId: `commercial-continuity-${outputs.length + 1}`,
    });
    assert(outcome?.ok, `${expectedTask} should resolve`);
    assert(/[.!?]$/.test(outcome.reply) && !outcome.reply.endsWith("..."), `${expectedTask} should end naturally`);
    context = completeAskSnoozerAdvisorTurn(context, outcome);
    context.recentConversation = [...context.recentConversation, { role: "user", content: query }, { role: "assistant", content: outcome.reply }].slice(-8);
    outputs.push({ query, plan, outcome });
  }

  const compound = outputs[5].outcome;
  assert.equal(context.askSnoozerWorkingMemory.activeDeal.activeProductHandle, "12-dual-comfort-hybrid");
  assert(/optional|does not need/i.test(compound.reply));
  assert.equal(outputs[5].plan.knownFacts.baseDecision, "undecided");
  assert(/King/i.test(outputs[6].outcome.reply), "explicit King selection must be acknowledged");
  assert(/simple version|only open decision/i.test(outputs[7].outcome.reply), "confusion should recap and simplify");
  assert(!/assessment/i.test(outputs[7].outcome.reply), "confusion must not restart the assessment");
  assert(/10-year limited/i.test(outputs[8].outcome.reply), "known mattress should receive exact warranty term");

  const quote = outputs[11].outcome.quote;
  assert.equal(quote.ok, true);
  assert.equal(quote.configurationContractVersion, "2026-09-11.1");
  assert.equal(quote.subtotal, 6698);
  assert.deepEqual(quote.items.map((item) => item.selectedOptions[0].value), ["Half Split King", "King (2pc)"]);
  assert(outputs[11].outcome.products.every((item) => item.suppressAddToCart === true));
  assert(outputs[11].outcome.chips.some((chip) => /add full setup/i.test(chip.label)));

  const prohibited = /\b(?:shopify|showroom canon|canonical|page context|api|backend|s3|retrieval|resolver|database|source of truth|deterministic|working memory|active goal)\b/i;
  for (const { outcome } of outputs.filter((item) => item.outcome)) {
    const visible = [outcome.reply, ...outcome.chips.flatMap((chip) => [chip.label, chip.value])].join(" ");
    assert(!prohibited.test(visible), `shopper language should be clean: ${visible}`);
  }
  for (const task of ["product_experience", "base_education", "advisor_choice", "durability_objection", "hybrid_exploration", "compound_product_base", "configuration_update", "confusion_recovery", "warranty_explanation", "bundle_quote"]) {
    assert(modelTurns.includes(task), `${task} should use model composition`);
  }

  const longAnswer = Array.from({ length: 80 }, (_, index) => `Sentence ${index + 1} explains one complete shopper-facing idea.`).join(" ");
  const boundedDisplay = clampAskSnoozerDisplayReply(longAnswer);
  const boundedVoice = clampAskSnoozerVoiceReply(longAnswer);
  assert(boundedDisplay.length <= 1800 && /[.!?]$/.test(boundedDisplay));
  assert(boundedVoice.length <= 500 && /[.!?]$/.test(boundedVoice));
  assert(!boundedDisplay.endsWith("...") && !boundedVoice.endsWith("..."));

  let failedContext = JSON.parse(JSON.stringify(context));
  failedContext.recentConversation = [];
  const failedQuery = "I want the Half Split King Dual Comfort with the motion base. How much is that?";
  failedContext = applyAskSnoozerWorkingMemory({ query: failedQuery, context: failedContext });
  const failedPlan = planAskSnoozerTurn({ query: failedQuery, context: failedContext });
  assert(failedPlan.handled, `failed-bundle test plan must be handled: ${JSON.stringify(failedPlan)}`);
  const failedBundle = await resolveAskSnoozerAdvisorTurn({
    query: failedQuery,
    context: failedContext,
    plan: failedPlan,
    fetchProductsByHandles: async ({ handles = [] } = {}) => ({
      items: products.filter((item) => handles.includes(item.handle) && item.handle !== "premium-motion-adjustable-base"),
    }),
    composeAdvisorResponse,
    loadAdvisorKnowledge,
  });
  assert(failedBundle.quote, `failed-bundle outcome should retain unresolved quote details: ${JSON.stringify(failedBundle)}`);
  assert.equal(failedBundle.quote.ok, false);
  assert.deepEqual(failedBundle.products, [], "an unresolved full setup must not render a partial product action");
  assert(!failedBundle.chips.some((chip) => /confirm.*size/i.test(chip.label)), "known size must not be requested again");
  assert(/motion base|base/i.test(failedBundle.reply), "the unresolved line should be named for the shopper");

  let failureContext = {
    canonicalRecommendation: context.canonicalRecommendation,
    askSnoozerWorkingMemory: { activeDeal: { activeProductHandle: "12-all-foam-mattress" } },
    recentConversation: [],
  };
  const failureQuery = "What does the 12-inch All Foam Mattress feel like?";
  failureContext = applyAskSnoozerWorkingMemory({ query: failureQuery, context: failureContext });
  const failurePlan = planAskSnoozerTurn({ query: failureQuery, context: failureContext });
  const modelFailure = await resolveAskSnoozerAdvisorTurn({
    query: failureQuery,
    context: failureContext,
    plan: failurePlan,
    fetchProductsByHandles,
    loadAdvisorKnowledge,
    composeAdvisorResponse: async () => { throw new Error("forced composer failure"); },
  });
  assert.equal(modelFailure.ok, true);
  assert.equal(modelFailure.compositionMode, "model_fallback");
  assert.equal(modelFailure.modelCallCount, 1);
  assert(/[.!?]$/.test(modelFailure.reply) && !prohibited.test(modelFailure.reply));

  const renderedPartialTrace = buildAskSnoozerQualityTrace({
    traceId: "rendered-partial-action-test",
    sessionId: "rendered-partial-action-test",
    query: failedQuery,
    reply: "The base line could not be resolved.",
    plan: failedPlan,
    context: failedContext,
    products: [{ title: "12-inch Dual Comfort Hybrid", exactVariantResolved: true, suppressAddToCart: false }],
    quote: { ok: false },
    gate: { ok: true, violations: [] },
    factPackComplete: true,
  });
  assert.equal(renderedPartialTrace.requestedScopePreserved, false);
  assert.equal(renderedPartialTrace.partialActionSuppressed, false);
  assert.equal(renderedPartialTrace.outcome.category, "friction");

  console.log("Ask Snoozer commercial continuity/composer acceptance tests passed (12-turn continuity, compound state, confusion recovery, warranty, shared split quote, failed-bundle action suppression, composer fallback, sentence-safe length, rendered quality trace, language firewall).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
