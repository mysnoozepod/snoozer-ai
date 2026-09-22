"use strict";

const { parseAskSnoozerSizeLabel } = require("../services/askSnoozerIntents");

function clean(value) { return String(value || "").trim(); }

function explicitFixtureHandle(query = "") {
  const text = clean(query).toLowerCase();
  if (/12[- ]inch all foam|12 inch all foam/.test(text)) return "12-all-foam-mattress";
  if (/10[- ]inch all foam|10 inch all foam/.test(text)) return "10-all-foam-mattress";
  if (/dual comfort|12[- ]inch hybri[ds]/.test(text)) return "12-dual-comfort-hybrid";
  if (/14[- ]inch hybrid|14 inch hybrid/.test(text)) return "14-hybrid";
  if (/\ball foam\b/.test(text)) return "12-all-foam-mattress";
  return null;
}

function activeDeal(context = {}) { return context?.askSnoozerWorkingMemory?.activeDeal || {}; }

function fixtureRequestedFacts(query = "") {
  const text = clean(query).toLowerCase();
  const requestedFacts = [];
  if (/\b(?:return policy|sleep trial|returns?)\b/.test(text)) requestedFacts.push("returns");
  if (/\b(?:delivery|deliver)\b/.test(text)) requestedFacts.push("delivery");
  if (/\bwarrant(?:y|ies)\b/.test(text)) requestedFacts.push("warranty");
  if (/\bfinanc(?:e|ing)\b/.test(text)) requestedFacts.push("financing");
  if (/\b(?:durability|how many years|starts? sagging|hold up)\b/.test(text)) requestedFacts.push("durability");
  if (/\b(?:how much|price|cost)\b/.test(text)) requestedFacts.push("price");
  return requestedFacts;
}

function fixtureTask(query = "") {
  const text = clean(query).toLowerCase();
  if (/^\s*(?:hello|hi|hey)\b/.test(text)) return "greeting";
  if (/\b(?:need help|human|associate|support)\b/.test(text)) return "support_handoff";
  if (/\bwarrant(?:y|ies)\b/.test(text)) return "warranty_explanation";
  if (/\b(?:return policy|sleep trial|delivery|financing)\b/.test(text)) return "compound_fact_answer";
  if (/\b(?:durability|how many years|starts? sagging|hold up)\b/.test(text)) return "durability_objection";
  if (/\badd\b.*\b(?:cart|setup|mattress)\b|^add it/.test(text)) return "cart_add";
  if (/\b(?:remind me|originally recommend|assessment originally recommend)\b/.test(text)) return "canonical_recall";
  if (/\bwhat (?:did i say|do you remember).*\blik/.test(text)) return "preference_recall";
  if (/\bmedium\b.*\b(?:versus|vs|or)\b.*\bsoft\b/.test(text)) return "firmness_compare";
  if (/\bhow much would i save\b|\bsave\b.*\bskip the base\b/.test(text)) return "savings_quote";
  if (/\bmore expensive\b|\bneed the (?:adjustable )?base\b|\bdidn.t notice anything from the base\b/.test(text)) return "value_judgment";
  if (/\b(?:liked|like)\b.*\b(?:elevated|motion|base)\b/.test(text)) return "preference_capture";
  if (/\b(?:compatible|make sense together|work with this|base works|base work)\b/.test(text)) return "compatibility";
  if (/\bwith standard motion\b/.test(text) || (/\b(?:with the motion base|mattress and base|full setup)\b/.test(text) && /\b(?:cost|price|how much|what about)\b/.test(text))) return "bundle_quote";
  if (/\b(?:how much|price|cost)\b/.test(text)) return "price_quote";
  if (/\b(?:standard motion|adjustable base|motion base)\b/.test(text)) return "base_education";
  if (/\b(?:would you buy|which one would you choose|which one would you start)\b/.test(text)) return "advisor_choice";
  if (/\b(?:where should i start|which snoozepod|what (?:mattress )?do you recommend|try first|recommendation now)\b/.test(text)) return "canonical_recommendation";
  if (/\b(?:what would you recommend instead|recommend.*(?:other|instead)|something softer|want softer|^softer\.?$)\b/.test(text)) return "alternative_resolution";
  if (/\b(?:too expensive|more than i want to spend|over my budget)\b/.test(text)) return "value_objection";
  if (/\b(?:i like that one|that works|go with that)\b/.test(text)) return "recommendation_acceptance";
  if (/\b(?:compare|versus|\bvs\b|difference|other one)\b/.test(text)) return "product_comparison";
  if (/\b(?:too firm|too soft|didn.t like|don.t like|stop telling me|stop showing me)\b/.test(text)) return "shopper_feedback";
  if (/\b(?:confused|getting lost|what am i choosing)\b/.test(text)) return "confusion_recovery";
  if (/\b(?:snor\w*|side sleep\w*|sleep hot|pressure relief|firmer mattress|dream\w*|partner moves?)\b/.test(text)) return "sleep_education";
  if (/\b(?:king|queen|full|twin|medium|not too soft)\b/.test(text)) return "preference_capture";
  return "product_experience";
}

function fixtureActs(query = "", context = {}) {
  const text = clean(query).toLowerCase();
  const deal = activeDeal(context);
  const subject = explicitFixtureHandle(query) || deal.activeProductHandle || deal.sessionRecommendation?.productHandle || null;
  const pending = deal.pendingCommitment?.status === "pending" ? deal.pendingCommitment : null;
  const acts = [];
  const add = (type, detail = {}) => acts.push({ type, modality: "asserted", ...detail });
  if (pending && /^(?:yes|yeah|yep|sure|please|okay)\.?$/.test(text)) {
    add("accept_commitment", { commitmentId: pending.id, commitmentType: pending.type });
    return acts;
  }
  if (pending && /^(?:no|nope|no thanks|not now)\.?$/.test(text)) {
    add("decline_commitment", { commitmentId: pending.id, commitmentType: pending.type });
    return acts;
  }
  if (/\b(?:actually|again|reconsider|show me)\b.*\b(?:all foam|original|first)\b/.test(text) && subject) {
    add("reconsider_product", { handle: subject });
    return acts;
  }
  const exclusion = /\b(?:stop telling me|stop showing me|any other mattress but|anything but|except)\b/.test(text);
  const tooFirm = /\btoo firm\b/.test(text);
  const tooSoft = /\btoo soft\b/.test(text);
  const disliked = /\b(?:didn.t like|don.t like|not for me)\b/.test(text);
  if (subject && (exclusion || tooFirm || tooSoft || disliked)) {
    const reason = exclusion ? "explicit_exclusion" : tooFirm ? "too_firm" : tooSoft ? "too_soft" : "did_not_like";
    add("reject_product", { handle: subject, reason });
    if (exclusion) add("explicit_exclusion", { handle: subject });
    add("product_feedback", { handle: subject, feedback: reason });
  }
  if (/\b(?:like|liked)\b.*\b(?:motion|elevated|elevation|base)\b/.test(text)) {
    add("retain_preference", { key: "motion", value: "liked" });
    if (subject) add("product_feedback", { handle: subject, feedback: "liked_motion" });
  }
  if (/\b(?:want|need)\b.*\bsofter\b|^softer\.?$/.test(text)) {
    add("desired_direction", { key: "feel", value: "softer" });
    add("request_alternative");
  } else if (/\b(?:want|need)\b.*\bfirmer\b|^firmer\.?$/.test(text)) {
    add("desired_direction", { key: "feel", value: "firmer" });
    add("request_alternative");
  } else if (/\b(?:recommend|show|find)\b.*\b(?:other|instead|another|alternative)\b/.test(text)) {
    add("request_alternative");
  }
  if (/\b(?:i like that one|that works|go with that)\b/.test(text) && subject) add("accept_recommendation", { handle: subject });
  if (/\b(?:too expensive|more than i want to spend|over my budget)\b/.test(text)) add("budget_value", { concern: "price_resistance", maxAmount: null });
  if (/\b(?:confused|getting lost|what am i choosing)\b/.test(text)) add("confusion");
  if (/\b(?:stop telling me|stop showing me|you are not listening)\b/.test(text)) add("trust_risk");
  return acts;
}

function buildPlannerFixture({ query = "", context = {} } = {}) {
  const primaryTask = fixtureTask(query);
  const requestedFacts = fixtureRequestedFacts(query);
  const deal = activeDeal(context);
  const explicit = explicitFixtureHandle(query);
  const active = clean(deal.activeProductHandle || deal.sessionRecommendation?.productHandle || context?.canonicalRecommendation?.primaryMattressHandle).toLowerCase() || null;
  const canonical = clean(deal.canonicalRecommendation?.primaryMattressHandle || context?.canonicalRecommendation?.primaryMattressHandle).toLowerCase() || null;
  const requestedHandle = ["canonical_recommendation", "canonical_recall"].includes(primaryTask)
    ? canonical || explicit || active
    : explicit || active;
  let comparisonProductHandles = [];
  if (primaryTask === "product_comparison") {
    comparisonProductHandles = Array.from(new Set([active, explicit, ...(deal.comparisonProductHandles || [])].filter(Boolean))).slice(0, 2);
  }
  const size = parseAskSnoozerSizeLabel(query) || null;
  const text = clean(query).toLowerCase();
  const explicitNoBase = /\bmattress only|skip the base\b/.test(text);
  const explicitMotionBase = /\bstandard motion|motion base|adjustable base\b/.test(text);
  const baseHandle = explicitNoBase ? null : explicitMotionBase ? "premium-motion-adjustable-base" : undefined;
  const motionKey = explicitNoBase ? "none" : explicitMotionBase && /standard/.test(text) ? "standard" : null;
  const baseDecision = explicitNoBase ? "mattress_only" : explicitMotionBase ? "full_setup" : null;
  return {
    decision: {
      authority: "model_semantics",
      modality: "asserted",
      primaryTask,
      shopperGoal: primaryTask,
      acts: fixtureActs(query, context),
      productReferences: requestedHandle ? [{ handle: requestedHandle, role: "subject" }] : [],
      comparisonProductHandles,
      requestedFacts,
      answerRequirements: [],
      requestedPodId: null,
      requiresComposition: true,
      confidence: 0.99,
      knownFacts: { size, baseDecision, baseHandle, motionKey },
      validation: { source: "test_planner_fixture" },
    },
    model: "test-planner-fixture",
    tokens: 0,
    modelMs: 1,
    inputChars: 0,
  };
}

module.exports = { buildPlannerFixture };
