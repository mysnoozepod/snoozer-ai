#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  buildDeterministicAtomicDecision,
  parseModelPlannerDecision,
  resolveAskSnoozerSemanticAuthority,
} = require("../services/askSnoozerModelPlanner");
const {
  applyAskSnoozerWorkingMemory,
} = require("../services/askSnoozerWorkingMemory");
const intents = require("../services/askSnoozerIntents");
const answerEngine = require("../services/askSnoozerAnswerEngine");
const qualityGate = require("../services/askSnoozerQualityGate");
const station = require("../services/askSnoozerStation");
const {
  validateResponseConsistency,
} = require("../services/askSnoozerConversationOrchestrator");

const root = path.join(__dirname, "..");
let checks = 0;

function check(condition, message) {
  assert(condition, message);
  checks += 1;
}

function context() {
  return {
    currentProductHandle: "14-hybrid",
    askSnoozerWorkingMemory: {
      version: "ask-snoozer-working-memory-v1",
      slots: {},
      activeDeal: {
        stage: "narrowing",
        activeProductHandle: "14-hybrid",
        comparisonProductHandles: [],
        rejectedProducts: [],
        productFeedback: {},
        retainedPreferences: {},
        desiredDirection: {},
        activeConfiguration: {},
      },
    },
  };
}

function decision(overrides = {}) {
  return {
    authority: "model_semantics",
    modality: "asserted",
    primaryTask: "product_experience",
    acts: [],
    productReferences: [],
    comparisonProductHandles: [],
    requestedFacts: [],
    answerRequirements: [],
    requiresComposition: true,
    confidence: 0.99,
    ...overrides,
  };
}

function main() {
  const routeSource = fs.readFileSync(path.join(root, "routes", "askSnoozerRoutes.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(root, "index.js"), "utf8");
  const stationSource = fs.readFileSync(path.join(root, "services", "askSnoozerStation.js"), "utf8");
  const workingMemorySource = fs.readFileSync(path.join(root, "services", "askSnoozerWorkingMemory.js"), "utf8");

  check(!fs.existsSync(path.join(root, "services", "openai.js")), "legacy services/openai.js is deleted");
  check(!fs.existsSync(path.join(root, "src", "services", "openai.js")), "orphaned Assistants API wrapper is deleted");
  for (const source of [routeSource, indexSource]) {
    check(!source.includes("getSnoozerResponse"), "canonical runtime has no getSnoozerResponse dependency");
    check(!source.includes("routeAskSnoozerQuestion"), "canonical runtime has no broad legacy semantic router");
    check(!source.includes("evaluateAskSnoozerSemanticShadow"), "canonical runtime has no semantic shadow evaluator");
    check(!source.includes("legacy_path"), "canonical runtime has no legacy_path branch");
  }

  check(!routeSource.includes("legacyShadow"), "canonical route emits no legacyShadow metadata");
  check(!stationSource.includes("detectStationIntent"), "station resolver does not rediscover intent from prose");
  check(!workingMemorySource.includes("interpretShopperActs"), "Working Memory has no fallback prose act interpreter");
  check(!workingMemorySource.includes('"deterministic_fallback"'), "Working Memory has no hidden deterministic_fallback authority");

  check(
    JSON.stringify(Object.keys(intents).sort()) === JSON.stringify([
      "classifyAskSnoozerPolicySubtype",
      "normalizeAskSnoozerText",
      "parseAskSnoozerSizeLabel",
    ]),
    "intent layer exposes only normalization, size parsing, and narrow policy subtype parsing"
  );
  check(
    JSON.stringify(Object.keys(answerEngine).sort()) === JSON.stringify([
      "clampAskSnoozerVoiceReply",
    ]),
    "Answer Engine exposes only the live voice presentation clamp"
  );
  check(!Object.prototype.hasOwnProperty.call(qualityGate, "classifyAskSnoozerIntent"), "Quality Gate exports no broad classifier");
  check(typeof qualityGate.resolveAskSnoozerCommerceResponse === "function", "Quality Gate retains verified commerce resolution");
  check(JSON.stringify(Object.keys(station)) === JSON.stringify(["resolveAskSnoozerStationResponse"]), "station module exports only its explicit-intent resolver");

  const freeText = resolveAskSnoozerSemanticAuthority({
    query: "I liked the first mattress, but it was too firm. What should I try next?",
    context: context(),
  });
  check(freeText.mode === "model_semantics", "free shopper language has one model-semantic authority");
  check(resolveAskSnoozerSemanticAuthority({ query: "Hello" }).reason === "greeting", "greeting remains deterministic atomic");
  check(resolveAskSnoozerSemanticAuthority({ query: "I need to talk to a human." }).reason === "support_handoff", "human handoff remains deterministic atomic");
  check(resolveAskSnoozerSemanticAuthority({ query: "What is your return policy?" }).reason === "protected_fact", "return policy remains protected atomic truth");
  check(resolveAskSnoozerSemanticAuthority({ query: "How much is this in a King?", context: context() }).reason === "protected_fact", "exact contextual price remains protected atomic truth");
  check(resolveAskSnoozerSemanticAuthority({ query: "Browse Products" }).reason === "station_starter", "legacy English starter maps once at authority boundary");

  const browseDecision = buildDeterministicAtomicDecision({ reason: "station_starter", query: "Browse Products" });
  check(browseDecision.knownFacts.stationIntent === "browse_products", "browse station intent is explicit in the atomic decision");
  const motionDecision = buildDeterministicAtomicDecision({ reason: "station_starter", query: "Motion Base Features" });
  check(motionDecision.knownFacts.stationIntent === "motion_base_features", "motion station intent is explicit in the atomic decision");
  const priceDecision = buildDeterministicAtomicDecision({ reason: "protected_fact", query: "How much is this in a King?", context: context() });
  check(priceDecision.knownFacts.size === "King", "atomic price decision preserves requested King size");
  check(priceDecision.productReferences[0]?.handle === "14-hybrid", "atomic price decision uses active verified product context");

  const returnPolicyGate = validateResponseConsistency({
    reply: "Return policy: you may return your mattress within 100 nights for a full refund.",
    plan: {
      taskType: "compound_fact_answer",
      knownFacts: { size: "King" },
      requestedFacts: ["returns"],
      references: {},
      protectedReferences: [],
    },
    factPack: {
      policyFacts: [{ known: true, type: "returns", trialWindow: "100 nights", terms: [] }],
      products: [],
    },
  });
  check(returnPolicyGate.ok, "full refund policy language is not mistaken for a Full mattress size");

  const contradictory = context();
  const authoritative = applyAskSnoozerWorkingMemory({
    query: "I hate the dual comfort mattress and it is too firm.",
    context: contradictory,
    modelDecision: decision({
      primaryTask: "sleep_education",
      productReferences: [{ handle: "10-all-foam-mattress", role: "subject" }],
      comparisonProductHandles: ["10-all-foam-mattress", "14-hybrid"],
      acts: [{ type: "retain_preference", key: "support", value: "supportive", modality: "asserted" }],
    }),
  });
  const authoritativeDeal = authoritative.askSnoozerWorkingMemory.activeDeal;
  check(authoritativeDeal.activeProductHandle === "10-all-foam-mattress", "validated model reference wins over contradictory prose");
  check(authoritativeDeal.rejectedProducts.length === 0, "model-semantic prose is not independently interpreted as rejection");
  check(authoritativeDeal.retainedPreferences.support?.value === "supportive", "only the validated model act updates retained preference");
  check(JSON.stringify(authoritativeDeal.comparisonProductHandles) === JSON.stringify(["10-all-foam-mattress", "14-hybrid"]), "validated comparison pair persists exactly");

  const failed = applyAskSnoozerWorkingMemory({
    query: "I hate this one. It is too firm, so give me something softer.",
    context: context(),
    modelDecision: decision({ authority: "model_failed", primaryTask: null, requiresComposition: false }),
  });
  const failedDeal = failed.askSnoozerWorkingMemory.activeDeal;
  check(failedDeal.activeProductHandle === "14-hybrid", "model failure preserves active product");
  check(failedDeal.rejectedProducts.length === 0, "model failure cannot infer a rejection from prose");
  check(Object.keys(failedDeal.retainedPreferences).length === 0, "model failure cannot infer retained preferences from prose");
  check(Object.keys(failedDeal.desiredDirection).length === 0, "model failure cannot infer desired direction from prose");
  check(failed.askSnoozerWorkingMemory.lastTransition.semanticAuthority === "model_failed", "model failure remains explicit in transition metadata");

  const typedCompare = applyAskSnoozerWorkingMemory({
    query: "Compare",
    context: context(),
    modelDecision: decision({
      authority: "typed_showroom_action",
      primaryTask: "product_comparison",
      productReferences: [
        { handle: "12-dual-comfort-hybrid", role: "subject" },
        { handle: "14-hybrid", role: "comparison" },
      ],
      comparisonProductHandles: ["12-dual-comfort-hybrid", "14-hybrid"],
      requiresComposition: false,
    }),
  });
  check(
    JSON.stringify(typedCompare.askSnoozerWorkingMemory.activeDeal.comparisonProductHandles) ===
      JSON.stringify(["12-dual-comfort-hybrid", "14-hybrid"]),
    "typed compare persists the exact pair through Working Memory"
  );
  check(typedCompare.askSnoozerWorkingMemory.lastTransition.semanticAuthority === "typed_showroom_action", "typed action authority remains explicit");

  const alias = parseModelPlannerDecision(JSON.stringify({
    primaryTask: "request_alternative",
    modality: "asserted",
    acts: [],
    productReferences: [],
    comparisonProductHandles: [],
    requestedFacts: [],
    answerRequirements: [],
    requiresComposition: true,
    confidence: 0.8,
  }), { query: "What should I try instead?", context: context() });
  check(alias.primaryTask === "alternative_resolution", "the observed request_alternative task alias remains narrow and intact");

  console.log(`Ask Snoozer legacy excision tests passed (${checks} checks).`);
}

main();
