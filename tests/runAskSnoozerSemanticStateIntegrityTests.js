#!/usr/bin/env node

const assert = require("assert");
const {
  inferUtteranceModality,
  parseModelPlannerDecision,
  resolvePendingCommitmentProtocol,
  shouldPlanAskSnoozerWithModel,
} = require("../services/askSnoozerModelPlanner");
const { applyAskSnoozerWorkingMemory } = require("../services/askSnoozerWorkingMemory");
const {
  buildRelevantFactPack,
  compactComposerFactPack,
  planAskSnoozerTurn,
} = require("../services/askSnoozerConversationOrchestrator");
const { buildAskSnoozerQualityTrace } = require("../services/askSnoozerQualityTrace");

function context() {
  return {
    canonicalRecommendation: {
      topPodId: "1",
      primaryMattressHandle: "12-dual-comfort-hybrid",
      reasons: ["assessment fit"],
    },
    askSnoozerWorkingMemory: {
      turnIndex: 3,
      slots: { size: { value: "King", source: "current_message" } },
      activeDeal: {
        activeProductHandle: "12-dual-comfort-hybrid",
        activeSize: "King",
        sessionRecommendation: { productHandle: "12-dual-comfort-hybrid" },
        eligibleAlternativeHandles: ["12-dual-comfort-hybrid"],
        activeQuote: {
          ok: true,
          cartReady: true,
          status: "ready",
          productHandle: "12-dual-comfort-hybrid",
          items: [{ handle: "12-dual-comfort-hybrid" }],
        },
        rejectedProducts: [{ handle: "14-hybrid", status: "rejected", reason: "too_firm" }],
        desiredDirection: { feel: "softer" },
      },
    },
  };
}

function activeDeal(value) {
  return value.askSnoozerWorkingMemory.activeDeal;
}

function main() {
  let checks = 0;
  const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

  assert.equal(inferUtteranceModality("What if I don't like it?"), "hypothetical");
  assert.equal(inferUtteranceModality("If it feels wrong, could I exchange it?"), "conditional");
  assert.equal(inferUtteranceModality("It felt too firm, what should I try?"), "asserted");
  checks += 3;

  const hypotheticalDecision = parseModelPlannerDecision({
    utteranceMode: "hypothetical",
    primaryTask: "product_experience",
    acts: [
      { type: "reject_product", handle: "12-dual-comfort-hybrid", reason: "did_not_like", modality: "asserted" },
      { type: "product_feedback", handle: "12-dual-comfort-hybrid", feedback: "did_not_like", modality: "asserted" },
    ],
    confidence: 0.98,
  }, { query: "What if I don't like it?", context: context() });
  assert.deepEqual(hypotheticalDecision.acts, []);
  check(hypotheticalDecision.validation.droppedActs.every((act) => act.reason === "non_asserted_hypothetical"), "hypothetical mutations are rejected with an explicit reason");

  const modelProtected = applyAskSnoozerWorkingMemory({
    query: "What if I don't like it?",
    context: context(),
    modelDecision: hypotheticalDecision,
  });
  assert.equal(activeDeal(modelProtected).activeProductHandle, "12-dual-comfort-hybrid");
  assert.equal(activeDeal(modelProtected).activeQuote.status, "ready");
  assert(!activeDeal(modelProtected).rejectedProducts.some((item) => item.handle === "12-dual-comfort-hybrid" && item.status === "rejected"));
  assert.deepEqual(modelProtected.askSnoozerWorkingMemory.lastTransition.interpretedActs, []);
  assert.equal(modelProtected.askSnoozerWorkingMemory.lastTransition.semanticAuthority, "model_semantics");
  checks += 5;

  const fallbackProtected = applyAskSnoozerWorkingMemory({ query: "What if I don't like it?", context: context() });
  assert.equal(activeDeal(fallbackProtected).activeQuote.status, "ready");
  assert.deepEqual(fallbackProtected.askSnoozerWorkingMemory.lastTransition.interpretedActs, []);
  checks += 2;

  const pendingContext = context();
  activeDeal(pendingContext).pendingCommitment = {
    id: "commitment-4",
    type: "find_alternative",
    status: "pending",
    payload: { constraints: { desiredDirection: { feel: "softer" } } },
  };
  const yesDecision = resolvePendingCommitmentProtocol({ query: "Yes", context: pendingContext });
  check(yesDecision?.authority === "typed_commitment", "yes uses typed commitment authority");
  assert.equal(yesDecision.primaryTask, "alternative_resolution");
  assert.equal(yesDecision.acts[0].commitmentId, "commitment-4");
  assert(!shouldPlanAskSnoozerWithModel({ query: "Yes", context: pendingContext }));
  const accepted = applyAskSnoozerWorkingMemory({ query: "Yes", context: pendingContext, modelDecision: yesDecision });
  assert.equal(activeDeal(accepted).pendingCommitment.status, "fulfilled");
  assert.equal(accepted.askSnoozerWorkingMemory.lastTransition.semanticAuthority, "typed_commitment");
  assert.equal(planAskSnoozerTurn({ query: "Yes", context: accepted, modelDecision: yesDecision }).taskType, "alternative_resolution");
  checks += 6;

  const noContext = context();
  activeDeal(noContext).pendingCommitment = { id: "commitment-5", type: "compare_products", status: "pending" };
  const noDecision = resolvePendingCommitmentProtocol({ query: "No thanks", context: noContext });
  const declined = applyAskSnoozerWorkingMemory({ query: "No thanks", context: noContext, modelDecision: noDecision });
  assert.equal(activeDeal(declined).pendingCommitment.status, "declined");
  assert.equal(planAskSnoozerTurn({ query: "No thanks", context: declined, modelDecision: noDecision }).taskType, "commitment_declined");
  checks += 2;

  const paraphraseDecision = parseModelPlannerDecision({
    utteranceMode: "asserted",
    primaryTask: "shopper_feedback",
    acts: [{ type: "reject_product", handle: "12-dual-comfort-hybrid", reason: "not_for_me", modality: "asserted" }],
    confidence: 0.95,
  }, { query: "This isn't going to work for me.", context: context() });
  assert.equal(paraphraseDecision.acts.length, 1);
  const paraphraseState = applyAskSnoozerWorkingMemory({
    query: "This isn't going to work for me.",
    context: context(),
    modelDecision: paraphraseDecision,
  });
  check(activeDeal(paraphraseState).rejectedProducts.some((item) => item.handle === "12-dual-comfort-hybrid" && item.status === "rejected"), "validated model semantics are not vetoed by a second keyword interpreter");

  const noActContext = context();
  noActContext.askSnoozerWorkingMemory.lastTransition = {
    semanticAuthority: "deterministic_fallback",
    modality: "question",
    interpretedActs: [],
    stateBefore: {},
    stateDelta: {},
    stateAfter: {},
  };
  const trace = buildAskSnoozerQualityTrace({
    traceId: "semantic-integrity",
    sessionId: "semantic-integrity",
    query: "Tell me more about this mattress.",
    reply: "It has a responsive hybrid construction and a more lifted feel.",
    plan: { taskType: "product_experience", confidence: 0.95, modelPlanning: { used: false } },
    context: noActContext,
    gate: { ok: true, violations: [] },
    compositionMode: "deterministic",
    responsePath: "atomic_deterministic",
  });
  assert.equal(trace.pendingCommitmentResolved, null);
  assert.equal(trace.sessionRecommendationGrounded, true);
  assert.equal(trace.acceptedRecommendationPromoted, null);
  assert.equal(trace.exactQuoteReached, null);
  assert.equal(trace.qualitySignalStates.pendingCommitmentResolved, "not_applicable");
  assert.equal(trace.qualitySignalStates.exactQuoteReached, "not_applicable");
  checks += 6;

  const feedbackPlan = { taskType: "shopper_feedback", stage: "narrowing", responseDepth: "standard", references: {}, knownFacts: {}, neededFacts: [], allowedActions: [] };
  const fullPack = buildRelevantFactPack({ query: "It felt wrong for me.", context: context(), plan: feedbackPlan });
  fullPack.advisorKnowledge = {
    status: "advisor_interpretation",
    principles: ["Respect the shopper's lived experience."],
    topicGuidance: { feel: ["Compare pressure and support."] },
    unrelatedArchive: "x".repeat(6000),
  };
  const compactPack = compactComposerFactPack(fullPack, feedbackPlan);
  check(JSON.stringify(compactPack).length < JSON.stringify(fullPack).length, "composer receives a task-shaped fact pack");
  check(!Object.prototype.hasOwnProperty.call(compactPack.advisorKnowledge, "unrelatedArchive"), "unused advisor payload is removed");
  check(!Object.prototype.hasOwnProperty.call(compactPack, "commerce"), "non-commerce turn omits commerce payload");

  console.log(`Ask Snoozer semantic-state integrity tests passed (${checks} checks).`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}
