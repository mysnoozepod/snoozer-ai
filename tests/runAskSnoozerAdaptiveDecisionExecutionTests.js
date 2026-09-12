#!/usr/bin/env node

const assert = require("assert");
const fixture = require("./fixtures/ask-snoozer-trusted-advisor-10-turn.v1.json");
const {
  planAskSnoozerTurn,
  resolveAskSnoozerAdvisorTurn,
} = require("../services/askSnoozerConversationOrchestrator");
const {
  applyAskSnoozerWorkingMemory,
  completeAskSnoozerAdvisorTurn,
  resolveAdaptiveSessionRecommendation,
} = require("../services/askSnoozerWorkingMemory");
const { buildAskSnoozerQualityTrace } = require("../services/askSnoozerQualityTrace");

function mockedProducts() {
  const configured = Object.entries(fixture.commerceFixture.products).map(([handle, product], index) => ({
    id: `gid://shopify/Product/phase2-${index}`,
    handle,
    title: product.title,
    available: true,
    availableForSale: true,
    variants: Object.entries(product.variants).map(([size, variant]) => ({
      id: variant.id,
      title: size,
      available: true,
      availableForSale: true,
      price: variant.price,
      currencyCode: fixture.commerceFixture.currencyCode,
      selectedOptions: [{ name: "Size", value: size }],
    })),
  }));
  configured.push({
    id: "gid://shopify/Product/phase2-dual",
    handle: "12-dual-comfort-hybrid",
    title: "12-inch Dual Comfort Hybrid",
    available: true,
    availableForSale: true,
    variants: [{
      id: "gid://shopify/ProductVariant/phase2-dual-king",
      title: "King",
      available: true,
      availableForSale: true,
      price: 3799,
      currencyCode: fixture.commerceFixture.currencyCode,
      selectedOptions: [{ name: "Size", value: "King" }],
    }],
  });
  return configured;
}

async function fetchProductsByHandles({ handles = [] } = {}) {
  const wanted = new Set(handles);
  return { items: mockedProducts().filter((product) => wanted.has(product.handle)) };
}

async function runTurn(context, query, minute) {
  const referenceContext = context;
  const now = new Date(`2026-09-12T00:${String(minute).padStart(2, "0")}:00.000Z`);
  let next = applyAskSnoozerWorkingMemory({ query, context, now });
  const plan = planAskSnoozerTurn({ query, context: next, referenceContext });
  assert(plan.handled, `${query}: structured planner should handle the turn`);
  const outcome = await resolveAskSnoozerAdvisorTurn({
    query,
    context: next,
    plan,
    fetchProductsByHandles,
    composeAdvisorResponse: async ({ deterministicDraft, factPack }) => {
      assert(factPack.budget.totalChars < 10000, `fact pack too large: ${factPack.budget.totalChars}`);
      return {
        displayText: deterministicDraft.displayText,
        speechText: deterministicDraft.speechText,
        probe: null,
        model: "phase2-composer-test",
        inputChars: factPack.budget.totalChars + 2200,
        factPackChars: factPack.budget.totalChars,
      };
    },
    loadAdvisorKnowledge: async ({ productHandles = [] } = {}) => ({
      version: "phase2-test",
      principles: ["The shopper decides."],
      topicGuidance: { feel: ["Use lived feedback."] },
      productFacts: productHandles.map((handle) => ({ handle, facts: ["Approved showroom product."] })),
      policyFacts: [],
    }),
  });
  assert(outcome?.ok, `${query}: ${JSON.stringify(outcome?.gate)}`);
  next = completeAskSnoozerAdvisorTurn(next, outcome, { now });
  next.recentConversation = [...(context.recentConversation || []),
    { role: "user", content: query },
    { role: "assistant", content: outcome.reply },
  ].slice(-10);
  return { context: next, plan, outcome };
}

function deal(context) {
  return context.askSnoozerWorkingMemory.activeDeal;
}

async function main() {
  const targetedScenarios = [
    "eligible candidate filtering",
    "explainable adaptive ranking",
    "recommendation change explanation",
    "recommendation acceptance",
    "known size preservation",
    "motion preference preservation",
    "exact quote handoff",
    "authoritative variant ids",
    "no implicit cart mutation",
    "value objection handling",
    "mattress-only savings path",
    "current versus original recommendation",
    "explicit reconsideration",
    "narrow compatibility invalidation",
    "composer payload budget",
    "fallback and quality accounting",
  ];
  assert.equal(targetedScenarios.length, 16);
  const direct = resolveAdaptiveSessionRecommendation({
    canonicalRecommendation: { primaryMattressHandle: "12-all-foam-mattress" },
    rejectedProducts: [{ handle: "12-all-foam-mattress", status: "rejected" }],
    desiredDirection: { feel: "softer" },
    retainedPreferences: { motion: { value: "liked" } },
    activeSize: "King",
  });
  assert.equal(direct.sessionRecommendation.productHandle, "12-dual-comfort-hybrid");
  assert(direct.excludedCandidates.some((candidate) => candidate.handle === "12-all-foam-mattress"));
  assert(direct.recommendationReasons.some((reason) => reason.code === "softer_side_available"));
  const availabilityFiltered = resolveAdaptiveSessionRecommendation({
    desiredDirection: { response: "more_responsive" },
    liveAvailabilityRequired: true,
    availableProductHandles: ["14-hybrid"],
  });
  assert.deepEqual(availabilityFiltered.eligibleCandidateHandles, ["14-hybrid"]);
  assert(availabilityFiltered.excludedCandidates.some((candidate) => candidate.reason === "live_unavailable"));

  let context = {
    canonicalRecommendation: {
      topPodId: "4",
      primaryMattressHandle: "12-all-foam-mattress",
      normalizedAssessment: { sleepPosition: "side", size: "King" },
    },
    assessment: { answers: { sleepPosition: "side", size: "King" } },
    recentConversation: [],
    askSnoozerWorkingMemory: {
      turnIndex: 0,
      slots: { size: { value: "King", provenance: "saved_profile" } },
      activeDeal: {
        stage: "narrowing",
        activeProductHandle: "12-all-foam-mattress",
        activeSize: "King",
        activeMotionKey: "standard",
      },
    },
  };

  const transcript = [
    "The 12-inch All Foam was too firm, but I liked the motion.",
    "I want something softer.",
    "What would you recommend instead?",
    "Why that one?",
    "Okay, I like that one.",
    "I need a King.",
    "How much?",
    "What about with the motion base?",
    "That's more than I want to spend.",
    "Then mattress only.",
    "Add it.",
    "What did my assessment originally recommend?",
    "And what do you recommend now?",
  ];
  const turns = [];
  for (let index = 0; index < transcript.length; index += 1) {
    const turn = await runTurn(context, transcript[index], index);
    context = turn.context;
    turns.push(turn);
  }

  assert.equal(turns[0].plan.taskType, "shopper_feedback");
  assert.equal(turns[1].plan.taskType, "alternative_resolution");
  assert.equal(deal(turns[1].context).sessionRecommendation.productHandle, "12-dual-comfort-hybrid");
  assert.equal(turns[2].plan.taskType, "alternative_resolution");
  assert.equal(turns[3].plan.taskType, "recommendation_explanation");
  assert(/because/i.test(turns[3].outcome.reply));
  assert.equal(turns[4].plan.taskType, "recommendation_acceptance");
  assert.equal(deal(turns[4].context).acceptedRecommendation.productHandle, "12-dual-comfort-hybrid");
  assert.equal(deal(turns[4].context).activeConfiguration.productHandle, "12-dual-comfort-hybrid");
  assert.equal(deal(turns[5].context).activeSize, "King");
  assert.equal(turns[6].plan.taskType, "price_quote");
  assert.equal(turns[6].outcome.quote.items.length, 1);
  assert.equal(turns[7].plan.taskType, "bundle_quote");
  assert(turns[7].outcome.quote?.ok, `accepted mattress plus motion should reach exact quote: ${JSON.stringify(turns[7].outcome.quote)}`);
  assert.equal(turns[7].outcome.quote.productHandle, "12-dual-comfort-hybrid");
  assert(turns[7].outcome.quote.items.every((item) => /^gid:\/\/shopify\/ProductVariant\//.test(item.variantId)));
  assert.equal(turns[8].plan.taskType, "value_objection");
  assert(/mattress-only/i.test(turns[8].outcome.reply));
  assert.equal(turns[9].plan.taskType, "price_quote");
  assert.equal(turns[9].outcome.quote.items.length, 1);
  assert.equal(turns[10].plan.taskType, "cart_add");
  assert(turns[10].outcome.actions.length > 0, "cart action should appear only after explicit add request");
  assert(turns.filter((_turn, index) => index !== 10).every((turn) => turn.outcome.actions.length === 0));
  assert.equal(turns[11].plan.taskType, "canonical_recall");
  assert(/originally|original|assessment/i.test(turns[11].outcome.reply));
  assert.equal(turns[12].plan.taskType, "session_recommendation_recall");
  assert(/current recommendation/i.test(turns[12].outcome.reply));

  const quality = buildAskSnoozerQualityTrace({
    traceId: "phase2-acceptance",
    sessionId: "phase2-acceptance",
    query: transcript[4],
    reply: turns[4].outcome.reply,
    plan: turns[4].plan,
    context: turns[4].context,
    products: turns[4].outcome.products,
    actions: turns[4].outcome.actions,
    chips: turns[4].outcome.chips,
    gate: turns[4].outcome.gate,
    modelGate: turns[4].outcome.modelGate,
    compositionMode: turns[4].outcome.compositionMode,
    modelCallCount: turns[4].outcome.modelCallCount,
    factPackComplete: true,
    factPack: turns[4].outcome.factPack,
    modelInputChars: turns[4].outcome.modelInputChars,
  });
  assert.equal(quality.acceptedRecommendationPromoted, true);
  assert.equal(quality.sessionRecommendationGrounded, true);
  assert.equal(quality.rejectedCandidateSuppressed, true);
  assert(quality.factPackBudget.totalChars > 0);

  const fallbackBase = turns[1].context;
  const fallbackPlan = planAskSnoozerTurn({
    query: "Why that one?",
    context: fallbackBase,
    referenceContext: fallbackBase,
  });
  const rateLimited = await resolveAskSnoozerAdvisorTurn({
    query: "Why that one?",
    context: fallbackBase,
    plan: fallbackPlan,
    fetchProductsByHandles,
    composeAdvisorResponse: async () => {
      const error = new Error("429 tokens per minute");
      error.status = 429;
      throw error;
    },
    loadAdvisorKnowledge: async () => ({ principles: [], topicGuidance: {}, productFacts: [], policyFacts: [] }),
  });
  assert.equal(rateLimited.ok, true);
  assert.equal(rateLimited.compositionMode, "model_fallback");
  assert.equal(rateLimited.fallbackKind, "rate_limit");
  assert.equal(rateLimited.modelCallCount, 1);
  assert(
    /Dual Comfort|current visit|feedback/i.test(rateLimited.reply),
    `rate-limit fallback should retain the grounded deterministic answer: ${rateLimited.reply}`
  );

  const incompatibleContext = applyAskSnoozerWorkingMemory({
    query: "Let's go with the 14-inch Hybrid.",
    now: new Date("2026-09-12T01:00:00.000Z"),
    context: {
      canonicalRecommendation: context.canonicalRecommendation,
      askSnoozerWorkingMemory: {
        turnIndex: 4,
        activeDeal: {
          stage: "configuring",
          activeProductHandle: "12-dual-comfort-hybrid",
          activeSize: "King",
          activeBaseHandle: "premium-motion-adjustable-base",
          activeMotionKey: "full_split",
          sessionRecommendation: { productHandle: "14-hybrid" },
          activeConfiguration: {
            productHandle: "12-dual-comfort-hybrid",
            size: "King",
            baseHandle: "premium-motion-adjustable-base",
            motionKey: "full_split",
          },
        },
      },
    },
  });
  assert.equal(deal(incompatibleContext).acceptedRecommendation.productHandle, "14-hybrid");
  assert.equal(deal(incompatibleContext).activeConfiguration.productHandle, "14-hybrid");
  assert.equal(deal(incompatibleContext).activeConfiguration.size, "King");
  assert.equal(deal(incompatibleContext).activeConfiguration.baseHandle, null);
  assert.equal(deal(incompatibleContext).activeConfiguration.motionKey, null);
  assert.equal(deal(incompatibleContext).configurationInvalidation.reason, "motion_incompatible_with_accepted_product");

  const reconsideredContext = applyAskSnoozerWorkingMemory({
    query: "Actually, let me look at the original one again.",
    now: new Date("2026-09-12T01:01:00.000Z"),
    context: turns[1].context,
  });
  assert.equal(deal(reconsideredContext).activeProductHandle, "12-all-foam-mattress");
  assert.equal(
    deal(reconsideredContext).rejectedProducts.find((item) => item.handle === "12-all-foam-mattress").status,
    "reconsidered"
  );

  console.log(JSON.stringify({
    status: "passed",
    academyGroup: "decision-execution/adaptive-recommendation",
    continuousTurns: transcript.length,
    originalRecommendation: deal(context).canonicalRecommendation.primaryMattressHandle,
    currentRecommendation: deal(turns[12].context).sessionRecommendation.productHandle,
    acceptedRecommendation: deal(turns[4].context).acceptedRecommendation.productHandle,
    exactBundleSubtotal: turns[7].outcome.quote.subtotal,
    finalCartActions: turns[10].outcome.actions.length,
    maxFactPackChars: Math.max(...turns.map((turn) => turn.outcome.factPack?.budget?.totalChars || 0)),
    fallbackKind: rateLimited.fallbackKind,
    targetedScenarios,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
