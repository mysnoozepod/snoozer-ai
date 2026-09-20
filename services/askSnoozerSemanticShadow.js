"use strict";

const { SEMANTIC_AUTHORITY } = require("./askSnoozerModelPlanner");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function sameMembers(left = [], right = []) {
  const a = unique(left).sort();
  const b = unique(right).sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

function modelReferences(decision = {}) {
  return unique((decision.productReferences || []).map((reference) => reference?.handle));
}

function legacyReferences(plan = {}) {
  const references = plan.references || {};
  return unique([
    references.requestedProductHandle,
    references.activeProductHandle,
    references.feedbackProductHandle,
  ]);
}

function evaluateAskSnoozerSemanticShadow({
  query = "",
  context = {},
  modelDecision = {},
  applyWorkingMemory,
  planTurn,
  now = new Date(),
} = {}) {
  if (typeof applyWorkingMemory !== "function" || typeof planTurn !== "function") return null;
  const sourceSnapshot = JSON.stringify(context);
  const shadowInput = clone(context) || {};
  const shadowContext = applyWorkingMemory({ query, context: shadowInput, now, modelDecision: null });
  const legacyPlan = planTurn({
    query,
    context: shadowContext,
    referenceContext: shadowInput,
    modelDecision: null,
  });
  const modelTask = clean(modelDecision.primaryTask) || null;
  const legacyTask = clean(legacyPlan?.taskType) || null;
  const modelProductReferences = modelReferences(modelDecision);
  const legacyProductReferences = legacyReferences(legacyPlan);
  const modelComparisonHandles = unique(modelDecision.comparisonProductHandles);
  const legacyComparisonHandles = unique(legacyPlan?.references?.comparisonProductHandles);
  const modelActs = unique((modelDecision.acts || []).map((act) => act?.type));
  const legacyActs = unique((legacyPlan?.interpretedActs || []).map((act) => act?.type));
  return {
    authority: SEMANTIC_AUTHORITY.LEGACY_SHADOW,
    evaluated: true,
    modelTask,
    legacyTask,
    taskAgreement: modelTask === legacyTask,
    modelReferences: modelProductReferences,
    legacyReferences: legacyProductReferences,
    referenceAgreement: sameMembers(modelProductReferences, legacyProductReferences),
    modelComparisonHandles,
    legacyComparisonHandles,
    comparisonAgreement: sameMembers(modelComparisonHandles, legacyComparisonHandles),
    modelActs,
    legacyActs,
    stateChangingActAgreement: sameMembers(modelActs, legacyActs),
    modelConfidence: modelDecision.confidence !== null && modelDecision.confidence !== undefined && modelDecision.confidence !== "" && Number.isFinite(Number(modelDecision.confidence))
      ? Number(modelDecision.confidence)
      : null,
    liveContextUnchanged: JSON.stringify(context) === sourceSnapshot,
  };
}

module.exports = {
  evaluateAskSnoozerSemanticShadow,
};
