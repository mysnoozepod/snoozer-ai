#!/usr/bin/env node

"use strict";

const assert = require("assert");
const {
  parseModelPlannerDecision,
  resolveAskSnoozerSemanticAuthority,
} = require("../services/askSnoozerModelPlanner");
const {
  applyAskSnoozerWorkingMemory,
} = require("../services/askSnoozerWorkingMemory");
const {
  planAskSnoozerTurn,
  resolveAskSnoozerAdvisorTurn,
} = require("../services/askSnoozerConversationOrchestrator");
const {
  evaluateAskSnoozerSemanticShadow,
} = require("../services/askSnoozerSemanticShadow");

function baseContext() {
  return {
    canonicalRecommendation: {
      topPodId: "4",
      primaryMattressHandle: "14-hybrid",
      primaryMattressTitle: "14-inch Hybrid Mattress",
    },
    activeJourney: { journeyId: "journey-semantic-authority", revision: 7 },
    askSnoozerWorkingMemory: {
      turnIndex: 3,
      activeDeal: {
        stage: "narrowing",
        canonicalRecommendation: {
          topPodId: "4",
          primaryMattressHandle: "14-hybrid",
        },
        activeProductHandle: "10-all-foam-mattress",
        sessionRecommendation: {
          productHandle: "10-all-foam-mattress",
          source: "adaptive_session_recommendation",
        },
        activeSize: "Queen",
        rejectedProducts: [{ handle: "14-hybrid", status: "rejected", reason: "too_firm" }],
        desiredDirection: { feel: "softer" },
        retainedPreferences: { support: { value: "supportive" } },
        comparisonProductHandles: [],
      },
      conversationFocus: { topic: "narrowing", relevantTurns: [] },
    },
  };
}

function decision(raw, query, context) {
  return parseModelPlannerDecision({
    utteranceMode: "asserted",
    requiresComposition: true,
    confidence: 0.97,
    acts: [],
    productReferences: [],
    comparisonProductHandles: [],
    requestedFacts: [],
    answerRequirements: [],
    ...raw,
  }, { query, context });
}

async function main() {
  const checks = [];
  const check = (condition, name) => {
    assert(condition, name);
    checks.push(name);
  };

  const guidanceQuery = "I sleep mostly on my side and sometimes on my back. What should I be paying attention to when I test these mattresses?";
  const guidanceDecision = decision({
    primaryTask: "sleep_education",
    shopperGoal: "learn what to evaluate during a mattress test",
    answerRequirements: ["suggest_one_next_step"],
  }, guidanceQuery, baseContext());
  const guidanceContext = applyAskSnoozerWorkingMemory({ query: guidanceQuery, context: baseContext(), modelDecision: guidanceDecision });
  const guidancePlan = planAskSnoozerTurn({ query: guidanceQuery, context: guidanceContext, modelDecision: guidanceDecision });
  check(guidancePlan.taskType === "sleep_education", "A testing guidance remains planner-led sleep education");
  check(guidancePlan.taskType !== "medical_boundary", "A testing guidance does not drift into medical framing");

  const initialRejectionContext = baseContext();
  initialRejectionContext.askSnoozerWorkingMemory.activeDeal.activeProductHandle = "14-hybrid";
  initialRejectionContext.askSnoozerWorkingMemory.activeDeal.sessionRecommendation.productHandle = "14-hybrid";
  initialRejectionContext.askSnoozerWorkingMemory.activeDeal.rejectedProducts = [];
  const rejectionQuery = "I don't like this one. It feels too firm.";
  const rejectionDecision = decision({
    primaryTask: "shopper_feedback",
    acts: [
      { type: "reject_product", handle: "14-hybrid", reason: "too_firm", modality: "asserted" },
      { type: "product_feedback", handle: "14-hybrid", feedback: "too_firm", modality: "asserted" },
      { type: "desired_direction", key: "feel", value: "softer", modality: "asserted" },
    ],
    productReferences: [{ handle: "14-hybrid", role: "subject" }],
  }, rejectionQuery, initialRejectionContext);
  let rejectionContext = applyAskSnoozerWorkingMemory({ query: rejectionQuery, context: initialRejectionContext, modelDecision: rejectionDecision });
  const alternativeQuery = "What should I try instead if I want something softer but still supportive?";
  const alternativeDecision = decision({
    primaryTask: "alternative_resolution",
    acts: [
      { type: "desired_direction", key: "feel", value: "softer", modality: "asserted" },
      { type: "retain_preference", key: "support", value: "supportive", modality: "asserted" },
      { type: "request_alternative", modality: "asserted" },
    ],
  }, alternativeQuery, rejectionContext);
  rejectionContext = applyAskSnoozerWorkingMemory({ query: alternativeQuery, context: rejectionContext, modelDecision: alternativeDecision });
  const rejected = rejectionContext.askSnoozerWorkingMemory.activeDeal.rejectedProducts.filter((item) => item.status === "rejected");
  check(rejected.length === 1 && rejected[0].handle === "14-hybrid", "B one explicit rejection remains exactly one rejection");
  check(rejectionContext.askSnoozerWorkingMemory.activeDeal.desiredDirection.feel === "softer", "B desired direction changes independently of rejection count");

  const comparisonQuery = "Compare the mattress you're recommending now with the one I originally had.";
  const comparisonDecision = decision({
    primaryTask: "product_comparison",
    productReferences: [
      { handle: "10-all-foam-mattress", role: "subject" },
      { handle: "14-hybrid", role: "comparison" },
    ],
    comparisonProductHandles: ["10-all-foam-mattress", "14-hybrid"],
    answerRequirements: ["compare_named_products"],
  }, comparisonQuery, baseContext());
  let comparisonContext = applyAskSnoozerWorkingMemory({ query: comparisonQuery, context: baseContext(), modelDecision: comparisonDecision });
  let comparisonPlan = planAskSnoozerTurn({ query: comparisonQuery, context: comparisonContext, referenceContext: baseContext(), modelDecision: comparisonDecision });
  check(JSON.stringify(comparisonPlan.references.comparisonProductHandles) === JSON.stringify(["10-all-foam-mattress", "14-hybrid"]), "C authoritative comparison includes the rejected historical product");
  const followupQuery = "Which one should sleep cooler, which should have better motion isolation, and what's the main tradeoff between them?";
  const followupDecision = decision({
    primaryTask: "product_comparison",
    answerRequirements: ["compare_named_products", "give_grounded_opinion"],
  }, followupQuery, comparisonContext);
  comparisonContext = applyAskSnoozerWorkingMemory({ query: followupQuery, context: comparisonContext, modelDecision: followupDecision });
  comparisonPlan = planAskSnoozerTurn({ query: followupQuery, context: comparisonContext, modelDecision: followupDecision });
  check(JSON.stringify(comparisonPlan.references.comparisonProductHandles) === JSON.stringify(["10-all-foam-mattress", "14-hybrid"]), "C relational follow-up preserves the exact comparison pair");

  for (const shortQuery of [
    "Why is that a better direction than the one I just rejected?",
    "What about the other one?",
    "Which one would you start me on?",
  ]) {
    const shortDecision = decision({ primaryTask: "advisor_choice", answerRequirements: ["give_grounded_opinion"] }, shortQuery, comparisonContext);
    const shortContext = applyAskSnoozerWorkingMemory({ query: shortQuery, context: comparisonContext, modelDecision: shortDecision });
    const shortPlan = planAskSnoozerTurn({ query: shortQuery, context: shortContext, modelDecision: shortDecision });
    check(shortPlan.references.comparisonProductHandles.every((handle) => ["10-all-foam-mattress", "14-hybrid"].includes(handle)), `D short referent stays inside active pair: ${shortQuery}`);
  }

  const recapQuery = "Give me a quick recap of where we landed and what I should test next.";
  const recapDecision = decision({
    primaryTask: "confusion_recovery",
    answerRequirements: ["recap_current_state", "preserve_active_decision", "suggest_one_next_step"],
  }, recapQuery, comparisonContext);
  const recapContext = applyAskSnoozerWorkingMemory({ query: recapQuery, context: comparisonContext, modelDecision: recapDecision });
  const recapPlan = planAskSnoozerTurn({ query: recapQuery, context: recapContext, modelDecision: recapDecision });
  const recapOutcome = await resolveAskSnoozerAdvisorTurn({
    query: recapQuery,
    context: recapContext,
    plan: recapPlan,
    fetchProductsByHandles: async () => ({ items: [] }),
    loadAdvisorKnowledge: async () => ({ productFacts: [], policyFacts: [] }),
    composeAdvisorResponse: async ({ deterministicDraft }) => ({
      displayText: deterministicDraft.displayText,
      speechText: deterministicDraft.speechText,
      confidence: 0.99,
    }),
  });
  check(recapPlan.answerRequirements.includes("recap_current_state"), "E recap is represented by explicit planner requirements");
  check(/ruled out/i.test(recapOutcome.reply) && /10-inch All Foam/i.test(recapOutcome.reply), "E recap names rejected and current recommendations");
  check(/softer but supportive/i.test(recapOutcome.reply) && /Next, test/i.test(recapOutcome.reply), "E recap preserves direction and gives one clear next test");

  const shadowContext = baseContext();
  const shadowBefore = JSON.stringify(shadowContext);
  const contradictoryQuery = "I'm confused about the original mattress.";
  const authoritativeDecision = decision({
    primaryTask: "sleep_education",
    productReferences: [{ handle: "10-all-foam-mattress", role: "subject" }],
    comparisonProductHandles: ["10-all-foam-mattress", "14-hybrid"],
    acts: [{ type: "retain_preference", key: "support", value: "supportive", modality: "asserted" }],
  }, contradictoryQuery, shadowContext);
  const liveContext = applyAskSnoozerWorkingMemory({ query: contradictoryQuery, context: shadowContext, modelDecision: authoritativeDecision });
  const livePlanBeforeShadow = planAskSnoozerTurn({ query: contradictoryQuery, context: liveContext, referenceContext: shadowContext, modelDecision: authoritativeDecision });
  const shadow = evaluateAskSnoozerSemanticShadow({
    query: contradictoryQuery,
    context: shadowContext,
    modelDecision: authoritativeDecision,
    applyWorkingMemory: applyAskSnoozerWorkingMemory,
    planTurn: planAskSnoozerTurn,
  });
  const livePlanAfterShadow = planAskSnoozerTurn({ query: contradictoryQuery, context: liveContext, referenceContext: shadowContext, modelDecision: authoritativeDecision });
  check(livePlanAfterShadow.taskType === "sleep_education" && shadow.legacyTask === "confusion_recovery", "1 valid planner task beats contradictory legacy task");
  check(livePlanAfterShadow.references.requestedProductHandle === "10-all-foam-mattress", "2 valid planner reference beats legacy reference resolution");
  check(JSON.stringify(livePlanAfterShadow.references.comparisonProductHandles) === JSON.stringify(["10-all-foam-mattress", "14-hybrid"]), "3 valid planner comparison pair beats legacy heuristic pair");
  check(JSON.stringify(shadowContext.askSnoozerWorkingMemory) === JSON.stringify(JSON.parse(shadowBefore).askSnoozerWorkingMemory) && shadow.liveContextUnchanged, "4 legacy shadow does not mutate Working Memory");
  check(JSON.stringify(shadowContext.activeJourney) === JSON.stringify(JSON.parse(shadowBefore).activeJourney), "5 legacy shadow does not mutate Active Journey");
  check(JSON.stringify(livePlanAfterShadow) === JSON.stringify(livePlanBeforeShadow), "6 legacy shadow does not alter the live response plan");

  const failedDecision = {
    authority: "model_failed",
    modality: "asserted",
    primaryTask: null,
    acts: [],
    productReferences: [],
    comparisonProductHandles: [],
    requestedFacts: [],
    answerRequirements: [],
    requiresComposition: false,
  };
  const failedContext = applyAskSnoozerWorkingMemory({ query: "I'm confused.", context: baseContext(), modelDecision: failedDecision });
  const failedPlan = planAskSnoozerTurn({ query: "I'm confused.", context: failedContext, modelDecision: failedDecision });
  check(failedPlan.semanticAuthority === "model_failed" && failedPlan.taskType === "legacy" && !failedPlan.handled, "7 planner failure cannot promote legacy semantics");
  check(resolveAskSnoozerSemanticAuthority({ query: "What is your return policy?", context: baseContext() }).mode === "deterministic_atomic", "8 protected atomic fact lane avoids planner authority");

  const hypothetical = decision({
    utteranceMode: "hypothetical",
    primaryTask: "product_experience",
    acts: [
      { type: "reject_product", handle: "10-all-foam-mattress", reason: "too_soft", modality: "hypothetical" },
      { type: "desired_direction", key: "feel", value: "firmer", modality: "hypothetical" },
    ],
  }, "What if the 10-inch All Foam feels too soft?", baseContext());
  const hypotheticalContext = applyAskSnoozerWorkingMemory({ query: "What if the 10-inch All Foam feels too soft?", context: baseContext(), modelDecision: hypothetical });
  check(hypothetical.acts.length === 0 && hypotheticalContext.askSnoozerWorkingMemory.activeDeal.rejectedProducts.length === 1, "9 hypothetical questions cannot mutate rejection or preference state");
  check(rejected.length === 1, "10 one explicitly rejected product remains one rejected product");

  console.log(`Ask Snoozer semantic-authority tests passed (${checks.length} checks).`);
  for (const name of checks) console.log(`PASS ${name}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
