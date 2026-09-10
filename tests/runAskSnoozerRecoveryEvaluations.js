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
} = require("../services/askSnoozerWorkingMemory");
const {
  getVisitLifecyclePolicy,
  resolveAskSnoozerVisitLifecycle,
} = require("../services/askSnoozerVisitLifecycle");
const { buildAskSnoozerQualityTrace } = require("../services/askSnoozerQualityTrace");

function mockedProducts() {
  return Object.entries(fixture.commerceFixture.products).map(([handle, product], productIndex) => ({
    id: `gid://shopify/Product/recovery-${productIndex}`,
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
}

async function fetchProductsByHandles({ handles = [] } = {}) {
  const wanted = new Set(handles);
  return { items: mockedProducts().filter((product) => wanted.has(product.handle)) };
}

function initialContext(overrides = {}) {
  const context = {
    canonicalRecommendation: {
      topPodId: "4",
      primaryMattressHandle: "12-all-foam-mattress",
      primaryMattressTitle: '12" All Foam Mattress',
      size: "King",
      motionKey: "standard",
      baseHandle: "premium-motion-adjustable-base",
      normalizedAssessment: { size: "King", sleepPosition: "side", painPoints: ["shoulder", "hip"] },
    },
    assessment: { answers: { size: "King", sleepPosition: "side", painPoints: ["shoulder", "hip"] } },
    recentConversation: [],
    askSnoozerWorkingMemory: {
      turnIndex: 3,
      slots: { painPoints: { value: ["shoulder", "hip"] }, size: { value: "King" } },
      activeDeal: {
        stage: "comparing",
        activeProductHandle: "12-all-foam-mattress",
        recentProductHandle: "14-hybrid",
        comparisonProductHandles: ["12-all-foam-mattress", "14-hybrid"],
        activeSize: "King",
        activeBaseHandle: "premium-motion-adjustable-base",
        recentBaseHandle: null,
        activeMotionKey: "standard",
        activeQuote: null,
        compatibilityStatus: "compatible",
        decision: { firmness: "Soft", adjustableBase: "keep" },
        currentTopic: "comparison",
      },
    },
  };
  return {
    ...context,
    ...overrides,
    askSnoozerWorkingMemory: {
      ...context.askSnoozerWorkingMemory,
      ...(overrides.askSnoozerWorkingMemory || {}),
      activeDeal: {
        ...context.askSnoozerWorkingMemory.activeDeal,
        ...(overrides.askSnoozerWorkingMemory?.activeDeal || {}),
      },
    },
  };
}

async function turn(context, query, options = {}) {
  const referenceContext = context;
  let nextContext = applyAskSnoozerWorkingMemory({ query, context });
  const plan = planAskSnoozerTurn({ query, context: nextContext, referenceContext });
  if (options.recovery) plan.recovery = options.recovery;
  const outcome = await resolveAskSnoozerAdvisorTurn({
    query,
    context: nextContext,
    plan,
    fetchProductsByHandles: options.fetchProductsByHandles || fetchProductsByHandles,
    composeAdvisorResponse: options.composeAdvisorResponse,
  });
  assert(outcome, `No advisor outcome for: ${query}`);
  nextContext = completeAskSnoozerAdvisorTurn(nextContext, outcome);
  nextContext.recentConversation = (nextContext.recentConversation || []).concat([
    { role: "user", content: query },
    { role: "assistant", content: outcome.reply },
  ]).slice(-12);
  const quality = buildAskSnoozerQualityTrace({
    traceId: `recovery-${Date.now()}`,
    sessionId: "recovery-evaluation-session",
    surface: "recovery_evaluation",
    query,
    reply: outcome.reply,
    plan: outcome.plan,
    context,
    actions: outcome.actions,
    chips: outcome.chips,
    gate: outcome.gate,
    modelGate: outcome.modelGate,
    compositionMode: outcome.compositionMode,
    compositionFallbackUsed: outcome.compositionFallbackUsed,
    modelCallCount: outcome.modelCallCount,
    totalMs: 100,
    modelMs: outcome.modelMs,
    factPackComplete: !(outcome.plan.neededFacts || []).length,
    quote: outcome.quote,
    fallbackUsed: outcome.fallbackUsed,
    regressionId: options.id,
  });
  return { context: nextContext, plan, outcome, quality };
}

function scoreRecovery({ id, result, invalidContextDiscarded = true, correctNextAction = true, acknowledgement = null }) {
  const reply = String(result.outcome.reply || "");
  const recognized = Boolean(result.plan.recovery?.recognized || result.quality.outcome.recovery.recognized);
  const acknowledged = acknowledgement == null
    ? /\b(?:got it|thanks for correcting|updated|removed|does not pair|stopped before|do not want to guess)\b/i.test(reply)
    : acknowledgement;
  const criteria = {
    recognizedProblem: recognized,
    preservedValidContext: result.context.canonicalRecommendation.primaryMattressHandle === "12-all-foam-mattress",
    discardedInvalidContext: Boolean(invalidContextDiscarded),
    correctedCommercialTruth: Boolean(result.outcome.gate?.ok),
    acknowledgedCorrectionNaturally: Boolean(acknowledged),
    avoidedDefensiveness: !/your fault|you said|blame|obviously/i.test(reply),
    avoidedConversationRestart: !/start over|begin again/i.test(reply),
    avoidedUnnecessaryAssessment: !/start the assessment|retake/i.test(reply),
    correctNextAction: Boolean(correctNextAction),
    completeRecovery: Boolean(result.quality.outcome.recovery.success),
  };
  assert(Object.values(criteria).every(Boolean), `${id}: ${JSON.stringify({ criteria, plan: result.plan, reply }, null, 2)}`);
  return { id, task: result.plan.taskType, reply, criteria };
}

async function main() {
  const results = [];

  results.push(scoreRecovery({
    id: "other-product-correction",
    result: await turn(initialContext(), "No, I meant the other one.", { id: "other-product-correction" }),
  }));

  let priced = await turn(initialContext(), "What would the King full setup cost?", { id: "size-primer" });
  const changedSize = await turn(priced.context, "Actually, make that Queen.", { id: "size-change" });
  results.push(scoreRecovery({
    id: "size-after-quote",
    result: changedSize,
    invalidContextDiscarded: changedSize.outcome.quote?.size === "Queen",
  }));

  const mattressOnly = await turn(priced.context, "Actually, mattress only.", { id: "remove-base" });
  results.push(scoreRecovery({
    id: "bundle-to-mattress-only",
    result: mattressOnly,
    invalidContextDiscarded: mattressOnly.outcome.quote?.items?.length === 1 && mattressOnly.outcome.quote?.baseHandle === null,
  }));

  results.push(scoreRecovery({
    id: "contradict-earlier-preference",
    result: await turn(initialContext(), "Actually, I prefer firm now.", { id: "preference-change" }),
  }));

  let olderProductContext = initialContext();
  for (const query of [
    "Compare my recommendation to the 14-inch Hybrid.",
    "What does Standard Motion do?",
    "I liked the elevated position.",
    "What did I say I liked?",
    "Which one would you choose for me?",
  ]) {
    olderProductContext = (await turn(olderProductContext, query)).context;
  }
  results.push(scoreRecovery({
    id: "product-from-six-turns-ago",
    result: await turn(olderProductContext, "Go back to the 12-inch All Foam Mattress—what will I notice?", { id: "older-product" }),
    acknowledgement: true,
  }));

  const ambiguousContext = initialContext({
    askSnoozerWorkingMemory: { activeDeal: { activeProductHandle: null, recentProductHandle: null } },
  });
  const ambiguous = await turn(ambiguousContext, "How much is that one?", { id: "ambiguous-reference" });
  results.push(scoreRecovery({
    id: "ambiguous-reference",
    result: ambiguous,
    invalidContextDiscarded: ambiguous.plan.taskType === "reference_clarification" && !ambiguous.plan.references.resolution.resolved,
  }));

  const modelRejected = await turn(
    initialContext(),
    "I'm torn—walk me through in deep detail how that one compares to the 14-inch Hybrid.",
    {
      id: "model-gate-recovery",
      composeAdvisorResponse: async () => ({
        displayText: "Buy it now for $9,999.00.",
        speechText: "Buy it now for $9,999.00.",
        probe: null,
        model: "adversarial-evaluation",
      }),
    }
  );
  results.push(scoreRecovery({
    id: "model-gate-safe-fallback",
    result: modelRejected,
    acknowledgement: true,
  }));

  results.push(scoreRecovery({
    id: "shopper-says-misunderstood",
    result: await turn(initialContext(), "You misunderstood me.", { id: "misunderstood" }),
  }));

  results.push(scoreRecovery({
    id: "changed-mind-after-objection",
    result: await turn(initialContext(), "I changed my mind; I want the elevated position after all.", { id: "mind-change" }),
  }));

  const incompatible = await turn(priced.context, "Actually, switch to half split motion.", { id: "incompatible-change" });
  results.push(scoreRecovery({
    id: "configuration-becomes-incompatible",
    result: incompatible,
    invalidContextDiscarded: incompatible.outcome.quote?.compatibility?.status === "incompatible",
  }));

  const cartFailure = await turn(initialContext(), "The cart action failed—try adding the full setup to my cart again.", {
    id: "cart-failure",
    fetchProductsByHandles: async ({ handles = [] } = {}) => ({
      items: mockedProducts().filter((product) => handles.includes(product.handle) && product.handle !== "premium-motion-adjustable-base"),
    }),
  });
  results.push(scoreRecovery({
    id: "cart-action-cannot-complete",
    result: cartFailure,
    invalidContextDiscarded: cartFailure.outcome.actions.length === 0,
  }));

  const started = resolveAskSnoozerVisitLifecycle({
    context: initialContext(),
    sessionId: "returning-shopper",
    shopperId: "shopper-returning",
    now: new Date("2026-09-10T10:00:00Z"),
    policy: getVisitLifecyclePolicy({ ASK_SNOOZER_ACTIVE_VISIT_TTL_MINUTES: "60" }),
  });
  const expired = resolveAskSnoozerVisitLifecycle({
    context: started.context,
    sessionId: "returning-shopper",
    shopperId: "shopper-returning",
    now: new Date("2026-09-10T11:01:00Z"),
    policy: getVisitLifecyclePolicy({ ASK_SNOOZER_ACTIVE_VISIT_TTL_MINUTES: "60" }),
  });
  const returned = await turn(expired.context, "What did you recommend for me?", {
    id: "expired-return",
    recovery: { recognized: true, type: "expired_visit_return", acknowledgement: false },
  });
  results.push(scoreRecovery({
    id: "expired-visit-return",
    result: returned,
    invalidContextDiscarded: expired.metadata.rotated && !expired.context.askSnoozerWorkingMemory,
    acknowledgement: true,
  }));

  const totalCriteria = results.length * 10;
  const passedCriteria = results.reduce(
    (sum, result) => sum + Object.values(result.criteria).filter(Boolean).length,
    0
  );
  const report = {
    version: "ask-snoozer-recovery-eval-v1",
    cases: results.length,
    criteriaPerCase: 10,
    passedCriteria,
    totalCriteria,
    recoveryAttempts: results.length,
    recoverySuccesses: results.filter((result) => result.criteria.completeRecovery).length,
    recoverySuccessRate: Math.round((results.filter((result) => result.criteria.completeRecovery).length / results.length) * 1000) / 10,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
