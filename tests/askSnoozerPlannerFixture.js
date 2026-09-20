"use strict";

const { applyAskSnoozerWorkingMemory } = require("../services/askSnoozerWorkingMemory");
const { planAskSnoozerTurn } = require("../services/askSnoozerConversationOrchestrator");

function fixtureTask(query = "", legacyTask = "legacy") {
  const text = String(query || "").toLowerCase();
  if (/\b(?:need help|human|associate|support)\b/.test(text)) return "support_handoff";
  if (/\b(?:where should i start|which snoozepod|what mattress do you recommend)\b/.test(text)) return "canonical_recommendation";
  if (/\b(?:compare|versus|\bvs\b|difference|other one)\b/.test(text)) return "product_comparison";
  if (/\b(?:snor\w*|side sleep\w*|sleep hot|pressure relief|firmer mattress|dream\w*)\b/.test(text)) return "sleep_education";
  if (/\b(?:base works|base work|compatible|work with this)\b/.test(text)) return "compatibility";
  if (/\b(?:king|medium|not too soft)\b/.test(text)) return "preference_capture";
  if (legacyTask && legacyTask !== "legacy") return legacyTask;
  return "product_experience";
}

function explicitFixtureHandle(query = "") {
  const text = String(query || "").toLowerCase();
  if (/12[- ]inch all foam|12 all foam/.test(text)) return "12-all-foam-mattress";
  if (/10[- ]inch all foam|10 all foam/.test(text)) return "10-all-foam-mattress";
  if (/dual comfort|12[- ]inch hybri[ds]/.test(text)) return "12-dual-comfort-hybrid";
  if (/14[- ]inch hybrid|14 hybrid/.test(text)) return "14-hybrid";
  return null;
}

function buildPlannerFixture({ query = "", context = {} } = {}) {
  const shadowContext = applyAskSnoozerWorkingMemory({ query, context, modelDecision: null });
  const shadowPlan = planAskSnoozerTurn({ query, context: shadowContext, referenceContext: context, modelDecision: null });
  const primaryTask = fixtureTask(query, shadowPlan.taskType);
  const requestedHandle = explicitFixtureHandle(query) || shadowPlan.references?.requestedProductHandle || null;
  return {
    decision: {
      authority: "model_semantics",
      modality: "asserted",
      primaryTask,
      shopperGoal: primaryTask,
      acts: shadowContext.askSnoozerWorkingMemory?.lastTransition?.interpretedActs || [],
      productReferences: requestedHandle ? [{ handle: requestedHandle, role: "subject" }] : [],
      comparisonProductHandles: shadowPlan.references?.comparisonProductHandles || [],
      requestedFacts: shadowPlan.requestedFacts || [],
      answerRequirements: [],
      requestedPodId: null,
      requiresComposition: true,
      confidence: 0.99,
      validation: { source: "test_planner_fixture" },
    },
    model: "test-planner-fixture",
    tokens: 0,
    modelMs: 1,
    inputChars: 0,
  };
}

module.exports = { buildPlannerFixture };
