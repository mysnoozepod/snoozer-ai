#!/usr/bin/env node

"use strict";

const assert = require("assert");

process.env.ASK_SNOOZER_PREFER_LOCAL_KNOWLEDGE = "1";

const {
  resolveAskSnoozerPolicyAnswer,
  resolveAskSnoozerPolicyTruth,
} = require("../services/askSnoozerPolicy");
const { loadTrustedAdvisorFactPack } = require("../services/askSnoozerAdvisorFactPack");
const {
  durabilityFactSentences,
  normalizeDurabilityFacts,
  rewardFactSentences,
} = require("../services/askSnoozerTypedTruth");
const { buildProductCardTruth } = require("../services/askSnoozerProductCardTruth");
const {
  planAskSnoozerTurn,
  validateResponseConsistency,
} = require("../services/askSnoozerConversationOrchestrator");
const { applyAskSnoozerWorkingMemory } = require("../services/askSnoozerWorkingMemory");
const { buildSuccessResponse } = require("../services/responseBuilder");

function policyDocument(key, raw) {
  return { key, source: "test_fixture", raw };
}

function mattressProduct({ includeKing = true } = {}) {
  const sizes = [
    ["Twin", 549, "101"],
    ["Queen", 799, "102"],
    ...(includeKing ? [["King", 1099, "103"]] : []),
  ];
  return {
    id: "gid://shopify/Product/500",
    handle: "12-all-foam-mattress",
    title: "12-inch All Foam Mattress",
    productType: "Mattress",
    available: true,
    priceRange: { min: 549, max: includeKing ? 1099 : 799, currencyCode: "USD" },
    variants: sizes.map(([size, price, id]) => ({
      id: `gid://shopify/ProductVariant/${id}`,
      title: size,
      selectedOptions: [{ name: "Size", value: size }],
      price,
      currencyCode: "USD",
      available: true,
      availableForSale: true,
    })),
  };
}

async function testPolicyTruth() {
  const syntheticTruth = await resolveAskSnoozerPolicyTruth({
    topic: "returns",
    sourceDocuments: {
      canonical: [policyDocument("policies/returns.md", "Mattresses include a 100-night sleep trial. Returns are available during the sleep trial.")],
      faq: [policyDocument("faq/returns.md", "Mattresses include a 90-night sleep trial. Contact us to return a mattress.")],
    },
  });
  assert.equal(syntheticTruth.trialWindow, "100-night sleep trial", "canonical policy must win a scalar conflict");
  assert.equal(syntheticTruth.sourceKind, "canonical_policy");
  assert.equal(syntheticTruth.sourceKey, "policies/returns.md");
  assert.equal(syntheticTruth.sourcePriority, 1);
  assert.equal(syntheticTruth.fallbackUsed, false);
  assert.equal(syntheticTruth.conflictDetected, true, "contradictory FAQ must be recorded");
  assert(syntheticTruth.conflicts.some((conflict) => conflict.field === "trialWindow"));

  const sleepTrial = await resolveAskSnoozerPolicyAnswer({ query: "What is the sleep trial?" });
  assert.equal(sleepTrial.policySubtype, "returns");
  assert.equal(sleepTrial.fact.known, true);
  assert.match(sleepTrial.reply, new RegExp(sleepTrial.fact.trialWindow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert(!/check (?:the|our) policy/i.test(sleepTrial.reply));

  const disliked = await resolveAskSnoozerPolicyAnswer({ query: "Can I return it if I do not like it?" });
  assert.equal(disliked.fact.sourceKey, sleepTrial.fact.sourceKey);
  assert.equal(disliked.fact.trialWindow, sleepTrial.fact.trialWindow);
  const initial = {
    askSnoozerWorkingMemory: {
      activeDeal: {
        activeProductHandle: "12-all-foam-mattress",
        rejectedProducts: [{ handle: "10-all-foam-mattress", status: "rejected", reason: "too firm" }],
      },
    },
  };
  const updated = applyAskSnoozerWorkingMemory({
    query: "Can I return it if I do not like it?",
    context: initial,
    modelDecision: {
      authority: "model_semantics",
      modality: "question",
      primaryTask: "compound_fact_answer",
      shopperGoal: "returns",
      acts: [],
      productReferences: [],
      comparisonProductHandles: [],
      requestedFacts: ["returns"],
      answerRequirements: ["answer_returns"],
      requiresComposition: true,
      confidence: 0.99,
    },
  });
  assert.deepEqual(
    updated.askSnoozerWorkingMemory.activeDeal.rejectedProducts.map(({ handle, status, reason }) => ({ handle, status, reason })),
    initial.askSnoozerWorkingMemory.activeDeal.rejectedProducts
  );
  assert.equal(updated.askSnoozerWorkingMemory.activeDeal.activeProductHandle, "12-all-foam-mattress");

  const advisor = await loadTrustedAdvisorFactPack({
    query: "Tell me the return policy and why this fits me.",
    taskType: "compound_fact_answer",
    requestedFacts: ["returns"],
    advisorKnowledgeOverride: { version: "test", principles: [], topics: {} },
    productFactsOverride: [],
    resolvePolicyTruth: async () => syntheticTruth,
  });
  assert.equal(advisor.policyFacts.length, 1);
  assert.equal(advisor.policyFacts[0].trialWindow, syntheticTruth.trialWindow);
  assert.equal(advisor.policyFacts[0].sourceKey, syntheticTruth.sourceKey);
  assert.equal(advisor.policyFacts[0].sourcePriority, syntheticTruth.sourcePriority);
}

async function testRewardsTruth() {
  const atomicBalancePlan = planAskSnoozerTurn({ query: "How many points do I have?", context: {} });
  assert.equal(atomicBalancePlan.taskType, "rewards_explanation");
  assert.deepEqual(atomicBalancePlan.requestedFacts, ["rewards"]);
  assert.equal(atomicBalancePlan.needsModel, false);
  const identity = {
    shopperId: "92989",
    profileId: "shopper#92989",
    isTemporary: false,
  };
  const rewardsService = {
    getRewardSummary: async () => ({
      availableSleepPoints: 275,
      lifetimeSleepPoints: 425,
      currentBadge: { id: "badge.rested", label: "Rested" },
      badgeProgress: { complete: false, nextBadgeLabel: "Dreamer", pointsRemaining: 75 },
      milestones: [{ id: "visit", label: "Visit completed", pointAward: 125, completed: true }],
      activeRulesVersion: "rules-test-v7",
    }),
    getRewardOffers: async () => [{ id: "mask", label: "Sleep Mask", unlocked: true, status: "unlocked" }],
    activeRules: async () => ({
      rulesVersion: "rules-test-v7",
      milestones: [
        { id: "visit", displayName: "Visit completed", pointAward: 125 },
        { id: "rest-test", displayName: "Rest Test completed", pointAward: 175 },
      ],
      badges: [{ id: "badge.dreamer", label: "Dreamer", thresholdPoints: 500 }],
      offers: [{ id: "mask", displayLabel: "Sleep Mask", requiredPoints: 400 }],
    }),
  };
  const factPack = await loadTrustedAdvisorFactPack({
    query: "How many points do I have?",
    taskType: "rewards_explanation",
    requestedFacts: ["rewards"],
    identity,
    rewardsService,
    advisorKnowledgeOverride: { version: "test", principles: [], topics: {} },
    productFactsOverride: [],
  });
  const fact = factPack.rewardFacts;
  assert.equal(fact.known, true);
  assert.equal(fact.summary.availableSleepPoints, 275);
  assert.equal(fact.activeRulesVersion, "rules-test-v7");
  assert.match(rewardFactSentences(fact, "How many points do I have?").join(" "), /275 available Sleep Points/i);
  const rulesAnswer = rewardFactSentences(fact, "What do I earn points for?").join(" ");
  assert.match(rulesAnswer, /Visit completed: 125 points/i);
  assert.match(rulesAnswer, /Rest Test completed: 175 points/i);

  const rejected = validateResponseConsistency({
    reply: "You have 999 available Sleep Points.",
    plan: { taskType: "rewards_explanation", requestedFacts: ["rewards"], technicalLanguageAllowed: false },
    factPack: { rewardFacts: fact, products: [] },
  });
  assert.equal(rejected.ok, false);
  assert(rejected.violations.some((violation) => violation.startsWith("unverified_reward_number:")));

  const missingIdentity = await loadTrustedAdvisorFactPack({
    query: "How many points do I have?",
    taskType: "rewards_explanation",
    requestedFacts: ["rewards"],
    identity: null,
    rewardsService,
    advisorKnowledgeOverride: { version: "test", principles: [], topics: {} },
    productFactsOverride: [],
  });
  assert.equal(missingIdentity.rewardFacts.known, false);
  assert.equal(missingIdentity.rewardFacts.failureReason, "reward_identity_missing");
  assert(!/\b\d+\b/.test(rewardFactSentences(missingIdentity.rewardFacts, "How many points do I have?").join(" ")));
}

function testDurabilityTruth() {
  const warrantyOnly = normalizeDurabilityFacts({
    productFacts: ["This mattress includes a 10-year limited warranty.", "Rotate the mattress regularly for even wear."],
    sourceKey: "products/mattress/test.md",
  });
  assert.equal(warrantyOnly.exactLifespanKnown, false, "warranty term must not become lifespan truth");
  assert.equal(warrantyOnly.expectedLifespanYears, null);
  assert.equal(warrantyOnly.exactSaggingTimelineKnown, false);
  const reply = durabilityFactSentences(warrantyOnly, { exactQuestion: true }).join(" ");
  assert.match(reply, /cannot verify an exact number of years/i);
  assert(!/\b10\s*(?:-|to)?\s*years?\b/i.test(reply));
}

function testProductCardTruth() {
  const product = mattressProduct();
  const unknown = buildProductCardTruth(product);
  assert.equal(unknown.pricingMode, "starting_at");
  assert.equal(unknown.price, null);
  assert.equal(unknown.priceLabel, "From");
  assert.equal(unknown.priceRange.min, 549);
  assert.equal(unknown.exactVariantResolved, false);

  const king = buildProductCardTruth(product, { activeSize: "King" });
  assert.equal(king.pricingMode, "exact_variant");
  assert.equal(king.price, 1099);
  assert.equal(king.activeSize, "King");
  assert.equal(king.exactVariantResolved, true);
  assert.equal(king.variantId, "gid://shopify/ProductVariant/103");
  assert.equal(king.selectedOptions[0].value, "King");
  assert.notEqual(king.selectedOptions[0].value, "Queen");

  const unresolved = buildProductCardTruth(mattressProduct({ includeKing: false }), { activeSize: "King" });
  assert.equal(unresolved.pricingMode, "unresolved");
  assert.equal(unresolved.price, null);
  assert.equal(unresolved.variantId, null);
  assert.equal(unresolved.exactVariantResolved, false);
  assert.equal(unresolved.available, null);

  const startingEnvelope = buildSuccessResponse({ requestId: "starting-card", text: "Starting card.", products: [unknown] });
  assert.equal(startingEnvelope.products[0].pricingMode, "starting_at");
  assert.equal(startingEnvelope.products[0].price, null);
  assert.equal(startingEnvelope.products[0].variantId, null);
  const exactEnvelope = buildSuccessResponse({ requestId: "exact-card", text: "Exact card.", products: [king] });
  assert.equal(exactEnvelope.products[0].pricingMode, "exact_variant");
  assert.equal(exactEnvelope.products[0].price.amount, 1099);
  assert.equal(exactEnvelope.products[0].activeSize, "King");

  const parity = validateResponseConsistency({
    reply: "The King mattress is $1,099.",
    quote: {
      ok: true,
      cartReady: false,
      size: "King",
      subtotal: 1099,
      currencyCode: "USD",
      items: [{ handle: product.handle, price: 1099, currencyCode: "USD" }],
    },
    products: [king],
    plan: {
      taskType: "price_quote",
      requestedFacts: ["price"],
      technicalLanguageAllowed: false,
      knownFacts: { size: "King" },
      references: { activeProductHandle: product.handle },
    },
    factPack: { products: [{ handle: product.handle }] },
  });
  assert.equal(parity.ok, true, JSON.stringify(parity.violations));
}

async function main() {
  await testPolicyTruth();
  await testRewardsTruth();
  testDurabilityTruth();
  testProductCardTruth();
  console.log("Ask Snoozer truth-lane tests passed (14/14: canonical policy precedence, trial/dislike/parity, rewards balance/rules/identity, durability unknown/warranty separation, and starting/exact/unresolved/card parity pricing).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
