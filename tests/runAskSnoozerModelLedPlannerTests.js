#!/usr/bin/env node

const assert = require("assert");
const {
  buildModelPlannerInput,
  parseModelPlannerDecision,
  resolveCatalogHandle,
  shouldPlanAskSnoozerWithModel,
} = require("../services/askSnoozerModelPlanner");
const {
  applyAskSnoozerWorkingMemory,
  completeAskSnoozerAdvisorTurn,
  resolveExplicitProductHandle,
} = require("../services/askSnoozerWorkingMemory");
const {
  planAskSnoozerTurn,
  resolveAskSnoozerAdvisorTurn,
  validateResponseConsistency,
} = require("../services/askSnoozerConversationOrchestrator");
const { buildAskSnoozerQualityTrace } = require("../services/askSnoozerQualityTrace");

function baseContext() {
  return {
    canonicalRecommendation: {
      topPodId: "3",
      primaryMattressHandle: "14-hybrid",
      reasons: ["balanced support", "strongest assessment fit"],
      normalizedAssessment: { sleepPosition: "combination", sleepPartner: false },
    },
    askSnoozerWorkingMemory: {
      turnIndex: 4,
      slots: { size: { value: "King", source: "current_message" } },
      conversationFocus: {
        relevantTurns: [
          { role: "user", content: "The 14 Hybrid felt too firm." },
          { role: "assistant", content: "I took it off your active list." },
        ],
      },
      activeDeal: {
        stage: "narrowing",
        canonicalRecommendation: {
          topPodId: "3",
          primaryMattressHandle: "14-hybrid",
        },
        activeProductHandle: "12-dual-comfort-hybrid",
        activeSize: "King",
        sessionRecommendation: { productHandle: "12-dual-comfort-hybrid" },
        comparisonProductHandles: ["14-hybrid", "12-dual-comfort-hybrid", "10-all-foam-mattress"],
        rejectedProducts: [{ handle: "14-hybrid", status: "rejected", reason: "too_firm" }],
        retainedPreferences: {},
        desiredDirection: { feel: "softer" },
      },
    },
  };
}

function product(handle) {
  const titles = {
    "12-dual-comfort-hybrid": "12-inch Dual Comfort Hybrid Mattress",
    "14-hybrid": "14-inch Hybrid Mattress",
  };
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title: titles[handle] || handle,
    available: true,
    availableForSale: true,
    options: [{ name: "Size", values: ["Queen", "King", "Half Split King"] }],
    variants: ["Queen", "King", "Half Split King"].map((size, index) => ({
      id: `gid://shopify/ProductVariant/${handle}-${index}`,
      title: size,
      available: true,
      availableForSale: true,
      price: { amount: String(2000 + index), currencyCode: "USD" },
      selectedOptions: [{ name: "Size", value: size }],
    })),
  };
}

async function main() {
  let checks = 0;
  const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

  check(resolveCatalogHandle("12-dual-comfort-hybrid") === "12-dual-comfort-hybrid", "exact handles resolve against catalog");
  check(resolveCatalogHandle("12 inch dual comfort hybrid mattress") === "12-dual-comfort-hybrid", "shopper titles resolve against catalog");
  check(resolveExplicitProductHandle("What sizes are available for 12-dual-comfort-hybrid?") === "12-dual-comfort-hybrid", "working memory accepts exact catalog handles");

  const compound = parseModelPlannerDecision({
    primaryTask: "warranty_explanation",
    shopperGoal: "understand warranty and delivery",
    productReferences: [{ handle: "12-dual-comfort-hybrid", role: "subject" }],
    requestedFacts: ["warranty", "delivery"],
    answerRequirements: ["answer_all_requested_facts"],
    requiresComposition: true,
    confidence: 0.97,
  }, { query: "What is the warranty on the 12-inch Dual Comfort and how long does delivery take?" });
  assert.equal(compound.primaryTask, "compound_fact_answer");
  assert.deepEqual(compound.requestedFacts.sort(), ["delivery", "warranty"]);
  checks += 2;

  const protectedDecision = parseModelPlannerDecision({
    primaryTask: "product_comparison",
    productReferences: [
      { handle: "not-a-real-mattress", role: "subject" },
      { title: "12-inch Dual Comfort Hybrid", role: "comparison" },
    ],
    comparisonProductHandles: ["not-a-real-mattress", "14-hybrid"],
    requestedFacts: ["made_up_fact", "product_features"],
    acts: [{ type: "reject_product", handle: "not-a-real-mattress", reason: "too_firm" }],
  }, { query: "Compare them." });
  check(!protectedDecision.productReferences.some((reference) => reference.handle === "not-a-real-mattress"), "invented handles are rejected");
  check(!protectedDecision.comparisonProductHandles.includes("not-a-real-mattress"), "invented comparison handles are rejected");
  check(!protectedDecision.requestedFacts.includes("made_up_fact"), "unknown fact requests are rejected");
  check(protectedDecision.acts.length === 0, "state mutations with invented handles are rejected");

  const misdirectedPriceDecision = parseModelPlannerDecision({
    primaryTask: "alternative_resolution",
    productReferences: [{ handle: "12-dual-comfort-hybrid", role: "subject" }],
    requestedFacts: ["price", "returns", "delivery"],
    acts: [{ type: "request_alternative" }],
    confidence: 0.99,
  }, { query: "How much is the Queen 14-inch Hybrid mattress only?" });
  assert.deepEqual(misdirectedPriceDecision.requestedFacts, ["price"]);
  check(misdirectedPriceDecision.acts.length === 0, "unsupported model acts cannot mutate a protected price turn");
  const guardedPricePlan = planAskSnoozerTurn({
    query: "How much is the Queen 14-inch Hybrid mattress only?",
    context: baseContext(),
    modelDecision: misdirectedPriceDecision,
  });
  check(guardedPricePlan.taskType === "price_quote", "deterministic commerce scope rejects an incompatible model task");

  check(!shouldPlanAskSnoozerWithModel({ query: "What is your return policy?", context: baseContext() }), "simple atomic return lookup stays deterministic");
  check(shouldPlanAskSnoozerWithModel({ query: "What is the warranty and how long does delivery take?", context: baseContext() }), "compound facts use model planning");
  const pendingContext = baseContext();
  pendingContext.askSnoozerWorkingMemory.activeDeal.pendingCommitment = { id: "c1", type: "find_alternative", status: "pending" };
  check(!shouldPlanAskSnoozerWithModel({ query: "Yes", context: pendingContext }), "typed yes continuation stays deterministic");

  const rejectionDecision = parseModelPlannerDecision({
    primaryTask: "shopper_feedback",
    acts: [
      { type: "reject_product", handle: "14-hybrid", reason: "too_firm" },
      { type: "product_feedback", handle: "14-hybrid", feedback: "too_firm" },
      { type: "retain_preference", key: "motion", value: "liked" },
      { type: "desired_direction", key: "feel", value: "softer" },
    ],
    productReferences: [{ handle: "14-hybrid", role: "subject" }],
    requestedFacts: [],
  }, { query: "That mattress felt too firm, but I liked the motion. I want softer." });
  const updated = applyAskSnoozerWorkingMemory({
    query: "That mattress felt too firm, but I liked the motion. I want softer.",
    context: baseContext(),
    modelDecision: rejectionDecision,
  });
  const updatedDeal = updated.askSnoozerWorkingMemory.activeDeal;
  check(updatedDeal.rejectedProducts.some((item) => item.handle === "14-hybrid" && item.status === "rejected"), "validated model rejection reaches existing reducer");
  check(updatedDeal.retainedPreferences.motion.value === "liked", "validated independent preference is retained");
  check(updatedDeal.desiredDirection.feel === "softer", "validated desired direction is retained");

  const sizeDecision = parseModelPlannerDecision({
    primaryTask: "product_sizes",
    productReferences: [{ handle: "12-dual-comfort-hybrid", role: "subject" }],
    requestedFacts: ["product_sizes"],
    answerRequirements: ["answer_all_requested_facts"],
    requiresComposition: true,
  }, { query: "What sizes are available for 12-dual-comfort-hybrid?" });
  const plannedContext = applyAskSnoozerWorkingMemory({
    query: "What sizes are available for 12-dual-comfort-hybrid?",
    context: baseContext(),
    modelDecision: sizeDecision,
  });
  const sizePlan = planAskSnoozerTurn({
    query: "What sizes are available for 12-dual-comfort-hybrid?",
    context: plannedContext,
    modelDecision: sizeDecision,
  });
  assert.equal(sizePlan.taskType, "product_sizes");
  assert.equal(sizePlan.references.requestedProductHandle, "12-dual-comfort-hybrid");
  checks += 2;

  const sizeOutcome = await resolveAskSnoozerAdvisorTurn({
    query: "What sizes are available for 12-dual-comfort-hybrid?",
    context: plannedContext,
    plan: sizePlan,
    fetchProductsByHandles: async ({ handles = [] }) => ({ items: handles.map(product) }),
    loadAdvisorKnowledge: async () => ({ productFacts: [], policyFacts: [] }),
    composeAdvisorResponse: async ({ deterministicDraft }) => ({
      displayText: deterministicDraft.displayText,
      speechText: deterministicDraft.speechText,
      confidence: 0.95,
    }),
  });
  assert.match(sizeOutcome.reply, /Queen, King, Half Split King/);
  check(sizeOutcome.gate.ok, `size response passes validation: ${sizeOutcome.gate.violations.join(", ")}`);

  const compoundPlan = planAskSnoozerTurn({
    query: "What is the warranty on the 12-inch Dual Comfort and how long does delivery take?",
    context: plannedContext,
    modelDecision: compound,
  });
  assert.equal(compoundPlan.taskType, "compound_fact_answer");
  assert.deepEqual(compoundPlan.requestedFacts.sort(), ["delivery", "warranty"]);
  checks += 2;

  const missingDelivery = validateResponseConsistency({
    reply: "The mattress includes a 10-year limited warranty.",
    plan: compoundPlan,
    factPack: { products: [{ handle: "12-dual-comfort-hybrid" }], feedback: { explicitExclusions: [] } },
  });
  check(missingDelivery.violations.includes("requested_fact_unanswered:delivery"), "rendered-response validation catches omitted delivery answer");

  const trace = buildAskSnoozerQualityTrace({
    traceId: "phase5-model-planner",
    sessionId: "phase5-session",
    query: "What is the warranty and how long does delivery take?",
    reply: "The mattress includes a 10-year limited warranty.",
    plan: { ...compoundPlan, modelPlanning: { used: true, modelCallCount: 1, modelMs: 120 } },
    context: plannedContext,
    gate: missingDelivery,
    compositionMode: "model_assisted",
    responsePath: "structured_composer",
    modelCallCount: 2,
  });
  check(trace.modelPlanningUsed && trace.plannerModelCallCount === 1, "quality trace records model planning separately");
  check(trace.requestedFactsFullyAnswered === false && trace.compoundQuestionFullyAnswered === false, "quality trace rejects incomplete compound answers");

  const input = buildModelPlannerInput({ query: "Why did you choose pod 4 for me?", context: baseContext() });
  check(input.activeJourney.canonicalRecommendation.podId === "3", "planner receives protected canonical pod identity");
  check(input.catalog.every((item) => item.handle && item.title), "planner receives compact real catalog identities");

  const previousModelOnly = process.env.ASK_SNOOZER_MODEL_ONLY;
  process.env.ASK_SNOOZER_MODEL_ONLY = "true";
  try {
    const baseCompatibility = parseModelPlannerDecision({
      utteranceMode: "hypothetical",
      primaryTask: "compatibility",
      shopperGoal: "understand whether a base can be added",
      requestedFacts: ["compatibility"],
      productReferences: [{ handle: "12-dual-comfort-hybrid", role: "subject" }],
      confidence: 0.96,
    }, { query: "What if I want to add a base to it?", context: baseContext() });
    assert.deepEqual(baseCompatibility.requestedFacts, ["compatibility"]);
    const basePlan = planAskSnoozerTurn({
      query: "What if I want to add a base to it?",
      context: baseContext(),
      modelDecision: baseCompatibility,
    });
    check(basePlan.taskType === "compatibility" && basePlan.handled, "model-only semantics route a base question to verified compatibility instead of legacy snoring");

    const initialAlternativeContext = baseContext();
    Object.assign(initialAlternativeContext.askSnoozerWorkingMemory.activeDeal, {
      activeProductHandle: "14-hybrid",
      sessionRecommendation: null,
      rejectedProducts: [],
      desiredDirection: {},
    });
    const alternativeDecision = parseModelPlannerDecision({
      utteranceMode: "question",
      primaryTask: "alternative_resolution",
      shopperGoal: "replace a mattress that felt too firm",
      acts: [
        { type: "reject_product", handle: "14-hybrid", reason: "too_firm", modality: "asserted" },
        { type: "product_feedback", handle: "14-hybrid", feedback: "too_firm", modality: "asserted" },
        { type: "desired_direction", key: "feel", value: "softer", modality: "asserted" },
        { type: "request_alternative", modality: "asserted" },
      ],
      productReferences: [{ handle: "14-hybrid", role: "subject" }],
      confidence: 0.98,
    }, { query: "This mattress feels too firm. What should I try instead?", context: initialAlternativeContext });
    assert.equal(alternativeDecision.modality, "asserted");
    check(alternativeDecision.acts.length === 4, "compound feedback survives model-only validation even when the utterance also asks a question");
    const alternativeContext = applyAskSnoozerWorkingMemory({
      query: "This mattress feels too firm. What should I try instead?",
      context: initialAlternativeContext,
      modelDecision: alternativeDecision,
    });
    const alternativeHandle = alternativeContext.askSnoozerWorkingMemory.activeDeal.sessionRecommendation.productHandle;
    check(alternativeHandle && alternativeHandle !== "14-hybrid", "model-only alternative state excludes the rejected product");
    const alternativePlan = planAskSnoozerTurn({
      query: "This mattress feels too firm. What should I try instead?",
      context: alternativeContext,
      referenceContext: initialAlternativeContext,
      modelDecision: alternativeDecision,
    });
    assert.equal(alternativePlan.references.requestedProductHandle, alternativeHandle);
    const alternativeOutcome = await resolveAskSnoozerAdvisorTurn({
      query: "This mattress feels too firm. What should I try instead?",
      context: alternativeContext,
      plan: alternativePlan,
      fetchProductsByHandles: async ({ handles = [] }) => ({ items: handles.map(product) }),
      loadAdvisorKnowledge: async () => ({ productFacts: [], policyFacts: [] }),
      composeAdvisorResponse: async ({ deterministicDraft }) => ({
        displayText: deterministicDraft.displayText,
        speechText: deterministicDraft.speechText,
        confidence: 0.95,
      }),
    });
    assert.deepEqual(alternativeOutcome.products.map((item) => item.handle), [alternativeHandle]);
    const completedAlternative = completeAskSnoozerAdvisorTurn(alternativeContext, alternativeOutcome);
    assert.equal(completedAlternative.askSnoozerWorkingMemory.activeDeal.activeProductHandle, alternativeHandle);
    const wrongAlternativeCard = validateResponseConsistency({
      reply: "Try the softer alternative next.",
      products: [product("14-hybrid")],
      plan: alternativePlan,
      factPack: {
        recommendation: { current: alternativeHandle },
        feedback: { explicitExclusions: ["14-hybrid"] },
        products: [{ handle: alternativeHandle }],
      },
    });
    check(
      wrongAlternativeCard.violations.includes("session_recommendation_product_card_mismatch"),
      "response validation rejects a card that disagrees with the session recommendation"
    );
    checks += 5;
  } finally {
    if (previousModelOnly === undefined) delete process.env.ASK_SNOOZER_MODEL_ONLY;
    else process.env.ASK_SNOOZER_MODEL_ONLY = previousModelOnly;
  }

  const wrongPodDecision = parseModelPlannerDecision({
    primaryTask: null,
    requestedFacts: ["recommendation_reasons"],
    requestedPodId: "4",
    requiresComposition: true,
    confidence: 0.96,
  }, { query: "Why did you choose Pod 4 for me?" });
  const wrongPodPlan = planAskSnoozerTurn({
    query: "Why did you choose Pod 4 for me?",
    context: baseContext(),
    modelDecision: wrongPodDecision,
  });
  check(wrongPodPlan.taskType === "recommendation_explanation", "recommendation-reason scope cannot fall into the legacy route when the model omits a primary task");
  check(wrongPodPlan.handled && wrongPodPlan.needsModel, "wrong-pod correction enters the structured advisor composer");

  console.log(`Ask Snoozer model-led planner tests passed (${checks} checks).`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
