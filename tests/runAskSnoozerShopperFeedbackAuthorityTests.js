#!/usr/bin/env node

const assert = require("assert");
const {
  planAskSnoozerTurn,
  resolveAskSnoozerAdvisorTurn,
  validateResponseConsistency,
} = require("../services/askSnoozerConversationOrchestrator");
const {
  PENDING_COMMITMENT_TTL_MS,
  applyAskSnoozerWorkingMemory,
  completeAskSnoozerAdvisorTurn,
} = require("../services/askSnoozerWorkingMemory");
const { buildAskSnoozerQualityTrace } = require("../services/askSnoozerQualityTrace");

function product(handle, title) {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title,
    available: true,
    availableForSale: true,
    variants: [{
      id: `gid://shopify/ProductVariant/${handle}-king`,
      title: "King",
      selectedOptions: [{ name: "Size", value: "King" }],
      available: true,
      availableForSale: true,
      price: 1999,
      currencyCode: "USD",
    }],
  };
}

const catalog = [
  product("12-all-foam-mattress", "12-inch All Foam Mattress"),
  product("10-all-foam-mattress", "10-inch All Foam Mattress"),
  product("12-dual-comfort-hybrid", "12-inch Dual Comfort Hybrid"),
  product("14-hybrid", "14-inch Hybrid Mattress"),
];

async function fetchProductsByHandles({ handles = [] } = {}) {
  const wanted = new Set(handles);
  return { items: catalog.filter((item) => wanted.has(item.handle)) };
}

async function composeAdvisorResponse({ deterministicDraft }) {
  return {
    displayText: deterministicDraft.displayText,
    speechText: deterministicDraft.speechText,
    probe: null,
    nextActionIntent: null,
    confidence: 0.99,
    model: "shopper-feedback-authority-test",
  };
}

async function loadAdvisorKnowledge({ productHandles = [] } = {}) {
  return {
    version: "feedback-test-v1",
    status: "advisor_interpretation",
    principles: ["The assessment recommends; the shopper decides."],
    productFacts: productHandles.map((handle) => ({
      handle,
      status: "verified_fact",
      facts: ["Approved showroom product."],
    })),
    policyFacts: [],
  };
}

function initialContext({ quote = true } = {}) {
  return {
    canonicalRecommendation: {
      topPodId: "4",
      primaryMattressHandle: "12-all-foam-mattress",
      primaryMattressTitle: '12" All Foam Mattress',
      normalizedAssessment: { sleepPosition: "side", size: "King" },
    },
    assessment: { answers: { sleepPosition: "side", size: "King" } },
    recentConversation: [],
    askSnoozerWorkingMemory: {
      turnIndex: 0,
      activeDeal: {
        stage: "narrowing",
        activeProductHandle: "12-all-foam-mattress",
        activeSize: "King",
        activeMotionKey: "standard",
        activeQuote: quote
          ? {
              ok: true,
              status: "ready",
              cartReady: true,
              productHandle: "12-all-foam-mattress",
              size: "King",
              items: [{ handle: "12-all-foam-mattress", title: "12-inch All Foam Mattress" }],
            }
          : null,
      },
    },
  };
}

function activeDeal(context) {
  return context.askSnoozerWorkingMemory.activeDeal;
}

function rejectedHandles(context) {
  return (activeDeal(context).rejectedProducts || [])
    .filter((item) => item.status === "rejected")
    .map((item) => item.handle);
}

async function runTurn(context, query, now = new Date()) {
  const referenceContext = context;
  let next = applyAskSnoozerWorkingMemory({ query, context, now });
  const plan = planAskSnoozerTurn({ query, context: next, referenceContext });
  assert(plan.handled, `${query} should be handled by the structured advisor path`);
  const outcome = await resolveAskSnoozerAdvisorTurn({
    query,
    context: next,
    plan,
    fetchProductsByHandles,
    composeAdvisorResponse,
    loadAdvisorKnowledge,
    requestId: `feedback-${next.askSnoozerWorkingMemory.turnIndex}`,
  });
  assert(outcome?.ok, `${query} should resolve: ${JSON.stringify(outcome?.gate)}`);
  next = completeAskSnoozerAdvisorTurn(next, outcome, { now });
  next.recentConversation = [...(next.recentConversation || []),
    { role: "user", content: query },
    { role: "assistant", content: outcome.reply },
  ].slice(-12);
  return { context: next, plan, outcome };
}

function assertRejectedNotRendered(context, outcome) {
  const rejected = new Set(rejectedHandles(context));
  assert(!(outcome.products || []).some((item) => rejected.has(item.handle)), "rejected product card rendered");
  assert(!(outcome.actions || []).some((item) => rejected.has(item?.payload?.handle)), "rejected product action rendered");
  assert(!rejected.has(activeDeal(context)?.sessionRecommendation?.productHandle), "session recommendation points to rejected product");
}

async function main() {
  let context = initialContext();
  const start = new Date("2026-09-11T16:00:00.000Z");

  const first = await runTurn(context, "The 12-inch All Foam was too firm, but I like the motion features.", start);
  context = first.context;
  assert.equal(first.plan.taskType, "shopper_feedback");
  assert.deepEqual(first.plan.interpretedActs.map((act) => act.type), [
    "reject_product", "product_feedback", "retain_preference", "product_feedback",
  ]);
  assert(rejectedHandles(context).includes("12-all-foam-mattress"));
  assert.equal(activeDeal(context).productFeedback["12-all-foam-mattress"].feel, "too_firm");
  assert.equal(activeDeal(context).retainedPreferences.motion.value, "liked");
  assert.equal(activeDeal(context).activeSize, "King");
  assert.equal(activeDeal(context).activeQuote.status, "invalidated");
  assert.equal(activeDeal(context).activeQuote.cartReady, false);
  assert.equal(activeDeal(context).pendingCommitment.type, "find_alternative");
  assert.equal(context.canonicalRecommendation.primaryMattressHandle, "12-all-foam-mattress");
  assertRejectedNotRendered(context, first.outcome);

  const second = await runTurn(context, "It was just too firm.", new Date(start.getTime() + 60_000));
  context = second.context;
  assert.equal(second.plan.taskType, "shopper_feedback");
  assert(!/leans softer|actually.*soft/i.test(second.outcome.reply));
  assert(rejectedHandles(context).includes("12-all-foam-mattress"));

  const third = await runTurn(context, "I want softer.", new Date(start.getTime() + 120_000));
  context = third.context;
  assert.equal(third.plan.taskType, "alternative_resolution");
  assert.equal(activeDeal(context).desiredDirection.feel, "softer");
  assert.equal(activeDeal(context).retainedPreferences.motion.value, "liked");
  assert.equal(activeDeal(context).sessionRecommendation.productHandle, "12-dual-comfort-hybrid");
  assertRejectedNotRendered(context, third.outcome);
  assert(!/ultra-plush|topper/i.test(third.outcome.reply));

  const fourth = await runTurn(context, "I didn't like that one.", new Date(start.getTime() + 180_000));
  context = fourth.context;
  assert.equal(fourth.plan.taskType, "shopper_feedback");
  assert(rejectedHandles(context).includes("12-dual-comfort-hybrid"));
  assert.equal(activeDeal(context).pendingCommitment.type, "find_alternative");

  const fifth = await runTurn(context, "Yes.", new Date(start.getTime() + 240_000));
  context = fifth.context;
  assert.equal(fifth.plan.taskType, "alternative_resolution");
  assert(fifth.plan.interpretedActs.some((act) => act.type === "accept_commitment"));
  assert.equal(activeDeal(context).sessionRecommendation.productHandle, "14-hybrid");
  assert.equal(activeDeal(context).desiredDirection.feel, "softer");
  assert.equal(activeDeal(context).retainedPreferences.motion.value, "liked");
  assertRejectedNotRendered(context, fifth.outcome);

  const sixth = await runTurn(context, "Stop telling me about the All Foam.", new Date(start.getTime() + 300_000));
  context = sixth.context;
  assert.equal(sixth.plan.taskType, "trust_recovery");
  assert(sixth.plan.interpretedActs.some((act) => act.type === "explicit_exclusion"));
  assert(sixth.plan.interpretedActs.some((act) => act.type === "trust_risk"));
  assert(/right to correct me|off your active list/i.test(sixth.outcome.reply));
  assertRejectedNotRendered(context, sixth.outcome);

  const seventh = await runTurn(context, "Softer.", new Date(start.getTime() + 360_000));
  context = seventh.context;
  assert.equal(seventh.plan.taskType, "alternative_resolution");
  assert(!/topper|ultra-plush/i.test(seventh.outcome.reply));
  assert.equal(activeDeal(context).pendingCommitment.type, "compare_products");

  const eighth = await runTurn(context, "No.", new Date(start.getTime() + 420_000));
  context = eighth.context;
  assert.equal(eighth.plan.taskType, "commitment_declined");
  assert.equal(activeDeal(context).pendingCommitment.status, "declined");
  assert(!eighth.outcome.actions.length);
  assertRejectedNotRendered(context, eighth.outcome);

  const ninth = await runTurn(context, "I'm confused.", new Date(start.getTime() + 480_000));
  context = ninth.context;
  assert.equal(ninth.plan.taskType, "confusion_recovery");
  assert(/ruled out/i.test(ninth.outcome.reply));
  assert(/motion/i.test(ninth.outcome.reply));
  assert(!/current active choice/i.test(ninth.outcome.reply));
  assertRejectedNotRendered(context, ninth.outcome);

  const tenth = await runTurn(context, "Recommend me any other mattress but the All Foam.", new Date(start.getTime() + 540_000));
  context = tenth.context;
  assert.equal(tenth.plan.taskType, "alternative_resolution");
  assert.equal(activeDeal(context).sessionRecommendation.productHandle, "14-hybrid");
  assert(!tenth.outcome.products.some((item) => item.handle === "12-all-foam-mattress"));
  assert(!tenth.outcome.actions.some((item) => item?.payload?.handle === "12-all-foam-mattress"));
  assert(!/recommend(?:ed|ation)?(?: is|:)?.*all foam/i.test(tenth.outcome.reply));
  assertRejectedNotRendered(context, tenth.outcome);

  const quality = buildAskSnoozerQualityTrace({
    traceId: "feedback-quality",
    sessionId: "feedback-quality",
    query: "Recommend me any other mattress but the All Foam.",
    reply: tenth.outcome.reply,
    plan: tenth.plan,
    context: { ...context, recentConversation: context.recentConversation.slice(0, -2) },
    products: tenth.outcome.products,
    actions: tenth.outcome.actions,
    chips: tenth.outcome.chips,
    gate: tenth.outcome.gate,
    modelGate: tenth.outcome.modelGate,
    compositionMode: tenth.outcome.compositionMode,
    modelCallCount: tenth.outcome.modelCallCount,
    factPackComplete: true,
  });
  assert.equal(quality.explicitRejectionHonored, true);
  assert.equal(quality.explicitExclusionHonored, true);
  assert.equal(quality.alternativeGrounded, true);
  assert.equal(quality.rejectedProductReintroduced, false);
  assert.notEqual(quality.outcome.category, "friction", JSON.stringify({
    friction: quality.outcome.friction,
    alert: quality.alert,
    task: quality.task,
    stateDelta: quality.stateDelta,
  }, null, 2));

  const badProduct = product("12-all-foam-mattress", "12-inch All Foam Mattress");
  const badGate = validateResponseConsistency({
    reply: "Here is the product you asked me not to recommend.",
    products: [badProduct],
    actions: [],
    plan: tenth.plan,
    factPack: tenth.outcome.factPack,
  });
  assert.equal(badGate.ok, false);
  assert(badGate.violations.includes("rejected_product_card:12-all-foam-mattress"));
  const badProseGate = validateResponseConsistency({
    reply: "I recommend the 12-inch All Foam Mattress as your best option.",
    products: [],
    actions: [],
    plan: tenth.plan,
    factPack: tenth.outcome.factPack,
  });
  assert.equal(badProseGate.ok, false);
  assert(badProseGate.violations.includes("rejected_product_recommendation:12-all-foam-mattress"));
  const badQuality = buildAskSnoozerQualityTrace({
    traceId: "feedback-quality-bad",
    sessionId: "feedback-quality-bad",
    query: "Do not show me the All Foam.",
    reply: "Here is the mattress.",
    plan: tenth.plan,
    context,
    products: [badProduct],
    gate: badGate,
    factPackComplete: true,
  });
  assert.equal(badQuality.rejectedProductReintroduced, true);
  assert.equal(badQuality.alert.severity, "P1");
  assert.notEqual(badQuality.outcome.category, "successful_advancement");

  let reconsiderContext = initialContext({ quote: false });
  reconsiderContext = (await runTurn(reconsiderContext, "The All Foam was too firm.", start)).context;
  const reconsidered = await runTurn(reconsiderContext, "Actually, show me the All Foam again.", new Date(start.getTime() + 60_000));
  assert.equal(reconsidered.plan.taskType, "reconsider_product");
  assert.equal(activeDeal(reconsidered.context).activeProductHandle, "12-all-foam-mattress");
  assert(!rejectedHandles(reconsidered.context).includes("12-all-foam-mattress"));

  let expiryContext = initialContext({ quote: false });
  expiryContext = (await runTurn(expiryContext, "The All Foam was too firm.", start)).context;
  expiryContext = applyAskSnoozerWorkingMemory({
    query: "Yes.",
    context: expiryContext,
    now: new Date(start.getTime() + PENDING_COMMITMENT_TTL_MS + 1),
  });
  assert.equal(activeDeal(expiryContext).pendingCommitment.status, "expired");
  assert(!expiryContext.askSnoozerWorkingMemory.lastTransition.interpretedActs.some((act) => act.type === "accept_commitment"));

  console.log(JSON.stringify({
    status: "passed",
    academyGroup: "state-transitions/shopper-feedback-authority",
    continuousTurns: 10,
    finalSessionRecommendation: activeDeal(context).sessionRecommendation.productHandle,
    rejectedProducts: rejectedHandles(context),
    retainedPreferences: activeDeal(context).retainedPreferences,
    desiredDirection: activeDeal(context).desiredDirection,
    finalQuoteStatus: activeDeal(context).activeQuote.status,
    finalCompositionMode: tenth.outcome.compositionMode,
    renderedProductHandles: tenth.outcome.products.map((item) => item.handle),
    finalQualityOutcome: quality.outcome.category,
    forcedViolationSeverity: badQuality.alert.severity,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
