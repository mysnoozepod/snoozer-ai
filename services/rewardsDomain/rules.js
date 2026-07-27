"use strict";

const {
  COMPLETION_AUTHORITIES,
  MILESTONE_STATUSES,
  OFFER_STATUSES,
  OFFER_TYPES,
  PRODUCT_CATEGORIES,
  REPEAT_POLICY_TYPES,
  REWARDS_SCHEMA_VERSION,
  RULE_STATUSES,
  SHOPIFY_APPLICATION_STRATEGIES,
  SHOWROOM_BADGE_CEILING_ID,
  SHOWROOM_BADGE_IDS,
  STACKING_MODES,
} = require("./constants");
const { createRewardError, validationResult } = require("./errors");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidIsoTimestamp(value) {
  const normalized = cleanString(value);
  return Boolean(normalized && /^\d{4}-\d{2}-\d{2}T/.test(normalized) && !Number.isNaN(Date.parse(normalized)));
}

function duplicateValues(items = [], selector = (value) => value) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const value = selector(item);
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function addError(errors, code, message, path, details = {}) {
  errors.push(createRewardError(code, message, { path, ...details }));
}

function validateRepeatPolicy(policy, errors, path) {
  if (!isObject(policy) || !REPEAT_POLICY_TYPES.includes(policy.type)) {
    addError(errors, "REWARD_RULES_INVALID", "Repeat policy type is invalid.", path);
    return;
  }
  if (
    policy.type === "repeatable_after_interval" &&
    (!Number.isInteger(policy.intervalSeconds) || policy.intervalSeconds <= 0)
  ) {
    addError(
      errors,
      "REWARD_RULES_INVALID",
      "Repeatable interval must be a positive integer.",
      `${path}.intervalSeconds`
    );
  }
}

function validateMilestone(milestone, errors, index) {
  const path = `milestones[${index}]`;
  if (!isObject(milestone)) {
    addError(errors, "REWARD_RULES_INVALID", "Milestone must be an object.", path);
    return;
  }
  if (!/^milestone\.[a-z0-9_]+\.[a-z0-9_]+$/.test(cleanString(milestone.id))) {
    addError(errors, "REWARD_RULES_INVALID", "Milestone ID is invalid.", `${path}.id`);
  }
  if (!cleanString(milestone.displayName) || !cleanString(milestone.description)) {
    addError(errors, "REWARD_RULES_INVALID", "Milestone display fields are required.", path);
  }
  if (!MILESTONE_STATUSES.includes(milestone.status)) {
    addError(errors, "REWARD_RULES_INVALID", "Milestone status is invalid.", `${path}.status`);
  }
  if (typeof milestone.enabled !== "boolean") {
    addError(errors, "REWARD_RULES_INVALID", "Milestone enabled must be boolean.", `${path}.enabled`);
  }
  if (!Number.isInteger(milestone.pointAward) || milestone.pointAward < 0) {
    addError(errors, "REWARD_RULES_INVALID", "Point award must be a non-negative integer.", `${path}.pointAward`);
  }
  if (!COMPLETION_AUTHORITIES.includes(milestone.completionAuthority)) {
    addError(errors, "REWARD_RULES_INVALID", "Completion authority is invalid.", `${path}.completionAuthority`);
  }
  for (const field of ["allowedSourceSystems", "allowedSourceSurfaces"]) {
    if (!Array.isArray(milestone[field]) || milestone[field].length === 0) {
      addError(errors, "REWARD_RULES_INVALID", `${field} must be a non-empty array.`, `${path}.${field}`);
    }
  }
  validateRepeatPolicy(milestone.repeatPolicy, errors, `${path}.repeatPolicy`);
  if (!isObject(milestone.subjectRequirements)) {
    addError(errors, "REWARD_RULES_INVALID", "Subject requirements are required.", `${path}.subjectRequirements`);
  }
  if (!Array.isArray(milestone.requiredMetadata)) {
    addError(errors, "REWARD_RULES_INVALID", "Required metadata must be an array.", `${path}.requiredMetadata`);
  }
}

function validateBadge(badge, errors, index) {
  const path = `badges[${index}]`;
  if (!isObject(badge)) {
    addError(errors, "REWARD_RULES_INVALID", "Badge must be an object.", path);
    return;
  }
  if (!SHOWROOM_BADGE_IDS.includes(badge.id)) {
    addError(
      errors,
      "REWARD_RULES_INVALID",
      "Only approved showroom badge IDs are permitted.",
      `${path}.id`
    );
  }
  if (!cleanString(badge.label)) {
    addError(errors, "REWARD_RULES_INVALID", "Badge label is required.", `${path}.label`);
  }
  if (!Number.isInteger(badge.thresholdPoints) || badge.thresholdPoints < 0) {
    addError(errors, "REWARD_RULES_INVALID", "Badge threshold is invalid.", `${path}.thresholdPoints`);
  }
}

function validateOffer(offer, errors, index, discountCapPolicies) {
  const path = `offers[${index}]`;
  if (!isObject(offer)) {
    addError(errors, "REWARD_RULES_INVALID", "Offer must be an object.", path);
    return;
  }
  if (!/^offer\.[a-z0-9_]+\.[a-z0-9_]+$/.test(cleanString(offer.id))) {
    addError(errors, "REWARD_RULES_INVALID", "Offer ID is invalid.", `${path}.id`);
  }
  if (!cleanString(offer.offerVersion)) {
    addError(errors, "REWARD_RULES_INVALID", "Offer version is required.", `${path}.offerVersion`);
  }
  if (!OFFER_STATUSES.includes(offer.status)) {
    addError(errors, "REWARD_RULES_INVALID", "Offer status is invalid.", `${path}.status`);
  }
  if (!OFFER_TYPES.includes(offer.offerType)) {
    addError(errors, "REWARD_RULES_INVALID", "Offer type is invalid.", `${path}.offerType`);
  }
  if (!cleanString(offer.displayLabel) || !cleanString(offer.customerDescription)) {
    addError(errors, "REWARD_RULES_INVALID", "Offer customer display fields are required.", path);
  }
  if (!cleanString(offer.internalDescription)) {
    addError(errors, "REWARD_RULES_INVALID", "Offer internal description is required.", `${path}.internalDescription`);
  }
  if (
    offer.requiredBadgeId !== null &&
    offer.requiredBadgeId !== undefined &&
    !SHOWROOM_BADGE_IDS.includes(offer.requiredBadgeId)
  ) {
    addError(errors, "REWARD_RULES_INVALID", "Required badge ID is invalid.", `${path}.requiredBadgeId`);
  }
  if (
    offer.requiredPoints !== null &&
    offer.requiredPoints !== undefined &&
    (!Number.isInteger(offer.requiredPoints) || offer.requiredPoints < 0)
  ) {
    addError(errors, "REWARD_RULES_INVALID", "Required points are invalid.", `${path}.requiredPoints`);
  }
  if (!Array.isArray(offer.requiredMilestoneIds)) {
    addError(errors, "REWARD_RULES_INVALID", "Required milestone IDs must be an array.", `${path}.requiredMilestoneIds`);
  }
  for (const field of ["qualifyingProductCategories", "excludedProductCategories"]) {
    if (!Array.isArray(offer[field])) {
      addError(errors, "REWARD_RULES_INVALID", `${field} must be an array.`, `${path}.${field}`);
      continue;
    }
    for (const category of offer[field]) {
      if (!PRODUCT_CATEGORIES.includes(category)) {
        addError(
          errors,
          "REWARD_RULES_INVALID",
          `Unknown product category: ${category}`,
          `${path}.${field}`
        );
      }
    }
  }
  if (!Number.isInteger(offer.minimumQualifyingQuantity) || offer.minimumQualifyingQuantity < 0) {
    addError(errors, "REWARD_RULES_INVALID", "Minimum quantity is invalid.", `${path}.minimumQualifyingQuantity`);
  }
  if (
    offer.minimumQualifyingSubtotalMinor !== null &&
    (!Number.isInteger(offer.minimumQualifyingSubtotalMinor) ||
      offer.minimumQualifyingSubtotalMinor < 0)
  ) {
    addError(errors, "REWARD_RULES_INVALID", "Minimum subtotal is invalid.", `${path}.minimumQualifyingSubtotalMinor`);
  }
  if (!isObject(offer.rewardValue)) {
    addError(errors, "REWARD_RULES_INVALID", "Reward value definition is required.", `${path}.rewardValue`);
  } else if (
    offer.rewardValue.percentageBasisPoints !== undefined &&
    (!Number.isInteger(offer.rewardValue.percentageBasisPoints) ||
      offer.rewardValue.percentageBasisPoints < 0 ||
      offer.rewardValue.percentageBasisPoints > 10000)
  ) {
    addError(errors, "REWARD_RULES_INVALID", "Offer percentage is invalid.", `${path}.rewardValue.percentageBasisPoints`);
  }
  if (typeof offer.qualifyingPurchaseRequired !== "boolean") {
    addError(
      errors,
      "REWARD_RULES_INVALID",
      "Qualifying purchase requirement must be boolean.",
      `${path}.qualifyingPurchaseRequired`
    );
  }
  if (
    offer.discountCapPolicyId !== null &&
    !Object.prototype.hasOwnProperty.call(discountCapPolicies, offer.discountCapPolicyId)
  ) {
    addError(errors, "REWARD_RULES_INVALID", "Discount cap policy does not exist.", `${path}.discountCapPolicyId`);
  }
  const protectedProductCategories = new Set([
    "mattress",
    "dual_comfort_mattress",
    "adjustable_base",
  ]);
  const appliesToProtectedProduct = (offer.qualifyingProductCategories || []).some(
    (category) => protectedProductCategories.has(category)
  );
  const isDirectDiscount =
    offer.offerType === "fixed_dollar_savings" ||
    offer.offerType === "percentage_savings";
  if (appliesToProtectedProduct && isDirectDiscount && !cleanString(offer.discountCapPolicyId)) {
    addError(
      errors,
      "REWARD_RULES_INVALID",
      "Mattress and adjustable-base discount offers require a discount cap policy.",
      `${path}.discountCapPolicyId`
    );
  }
  const discountCapPolicy = discountCapPolicies[offer.discountCapPolicyId];
  if (
    appliesToProtectedProduct &&
    offer.offerType === "percentage_savings" &&
    isObject(discountCapPolicy) &&
    Number.isInteger(offer.rewardValue?.percentageBasisPoints) &&
    offer.rewardValue.percentageBasisPoints > discountCapPolicy.percentageBasisPoints
  ) {
    addError(
      errors,
      "REWARD_RULES_INVALID",
      "Configured protected-product percentage exceeds its internal cap policy.",
      `${path}.rewardValue.percentageBasisPoints`
    );
  }
  if (!isObject(offer.stackingPolicy) || !STACKING_MODES.includes(offer.stackingPolicy.mode)) {
    addError(errors, "REWARD_RULES_INVALID", "Stacking policy is invalid.", `${path}.stackingPolicy`);
  }
  if (!SHOPIFY_APPLICATION_STRATEGIES.includes(offer.shopifyApplicationStrategy)) {
    addError(
      errors,
      "REWARD_RULES_INVALID",
      "Shopify application strategy is invalid.",
      `${path}.shopifyApplicationStrategy`
    );
  }
  if (
    !isObject(offer.redemptionLimit) ||
    !cleanString(offer.redemptionLimit.scope) ||
    !Number.isInteger(offer.redemptionLimit.quantity) ||
    offer.redemptionLimit.quantity <= 0
  ) {
    addError(errors, "REWARD_RULES_INVALID", "Redemption limit is invalid.", `${path}.redemptionLimit`);
  }
  if (!isObject(offer.expirationPolicy) || !cleanString(offer.expirationPolicy.type)) {
    addError(errors, "REWARD_RULES_INVALID", "Expiration policy is required.", `${path}.expirationPolicy`);
  }
}

function validateRewardsRules(input) {
  const errors = [];
  if (!isObject(input)) {
    return validationResult([
      createRewardError("REWARD_RULES_INVALID", "Rules document must be an object.", { path: "$" }),
    ]);
  }
  if (input.schemaVersion !== REWARDS_SCHEMA_VERSION) {
    addError(
      errors,
      "REWARD_RULES_VERSION_INVALID",
      `Unsupported rewards schema version: ${input.schemaVersion}`,
      "schemaVersion"
    );
  }
  if (!cleanString(input.rulesVersion)) {
    addError(errors, "REWARD_RULES_VERSION_INVALID", "Rules version is required.", "rulesVersion");
  }
  if (!isValidIsoTimestamp(input.effectiveFrom)) {
    addError(errors, "REWARD_RULES_INVALID", "effectiveFrom must be ISO-8601.", "effectiveFrom");
  }
  if (input.effectiveUntil !== null && input.effectiveUntil !== undefined && !isValidIsoTimestamp(input.effectiveUntil)) {
    addError(errors, "REWARD_RULES_INVALID", "effectiveUntil must be ISO-8601 or null.", "effectiveUntil");
  }
  if (
    isValidIsoTimestamp(input.effectiveFrom) &&
    isValidIsoTimestamp(input.effectiveUntil) &&
    Date.parse(input.effectiveUntil) <= Date.parse(input.effectiveFrom)
  ) {
    addError(errors, "REWARD_RULES_INVALID", "effectiveUntil must follow effectiveFrom.", "effectiveUntil");
  }
  if (!RULE_STATUSES.includes(input.status)) {
    addError(errors, "REWARD_RULES_INVALID", "Rules status is invalid.", "status");
  }

  const milestones = Array.isArray(input.milestones) ? input.milestones : [];
  const badges = Array.isArray(input.badges) ? input.badges : [];
  const offers = Array.isArray(input.offers) ? input.offers : [];
  const discountCapPolicies = isObject(input.discountCapPolicies) ? input.discountCapPolicies : {};

  if (!Array.isArray(input.milestones)) addError(errors, "REWARD_RULES_INVALID", "Milestones must be an array.", "milestones");
  if (!Array.isArray(input.badges)) addError(errors, "REWARD_RULES_INVALID", "Badges must be an array.", "badges");
  if (!Array.isArray(input.offers)) addError(errors, "REWARD_RULES_INVALID", "Offers must be an array.", "offers");

  milestones.forEach((item, index) => validateMilestone(item, errors, index));
  badges.forEach((item, index) => validateBadge(item, errors, index));
  offers.forEach((item, index) => validateOffer(item, errors, index, discountCapPolicies));

  const milestoneIds = new Set(milestones.map((item) => item?.id).filter(Boolean));
  for (const [index, offer] of offers.entries()) {
    for (const milestoneId of offer?.requiredMilestoneIds || []) {
      if (!milestoneIds.has(milestoneId)) {
        addError(
          errors,
          "REWARD_RULES_INVALID",
          `Required milestone does not exist: ${milestoneId}`,
          `offers[${index}].requiredMilestoneIds`
        );
      }
    }
  }

  for (const [label, values] of [
    ["milestone", duplicateValues(milestones, (item) => item?.id)],
    ["badge", duplicateValues(badges, (item) => item?.id)],
    ["offer", duplicateValues(offers, (item) => item?.id)],
  ]) {
    for (const value of values) {
      addError(errors, "REWARD_RULES_INVALID", `Duplicate ${label} ID: ${value}`, `${label}s`);
    }
  }

  if (input.showroomBadgeCeilingId !== SHOWROOM_BADGE_CEILING_ID) {
    addError(
      errors,
      "REWARD_RULES_INVALID",
      "Snooze Specialist must be the showroom badge ceiling.",
      "showroomBadgeCeilingId"
    );
  }
  const ceiling = badges.find((badge) => badge?.id === SHOWROOM_BADGE_CEILING_ID);
  if (!ceiling) {
    addError(errors, "REWARD_RULES_INVALID", "Snooze Specialist badge is required.", "badges");
  } else {
    const higherShowroomBadge = badges.find(
      (badge) =>
        cleanString(badge?.id).startsWith("badge.showroom.") &&
        Number(badge?.thresholdPoints) > Number(ceiling.thresholdPoints)
    );
    if (higherShowroomBadge) {
      addError(
        errors,
        "REWARD_RULES_INVALID",
        `Showroom badge ${higherShowroomBadge.id} exceeds the approved ceiling.`,
        "badges"
      );
    }
  }
  const sortedThresholds = badges
    .filter((badge) => SHOWROOM_BADGE_IDS.includes(badge?.id))
    .map((badge) => Number(badge.thresholdPoints));
  for (let index = 1; index < sortedThresholds.length; index += 1) {
    if (sortedThresholds[index] <= sortedThresholds[index - 1]) {
      addError(errors, "REWARD_RULES_INVALID", "Badge thresholds must increase deterministically.", "badges");
      break;
    }
  }

  for (const [id, policy] of Object.entries(discountCapPolicies)) {
    if (
      !isObject(policy) ||
      !Number.isInteger(policy.percentageBasisPoints) ||
      policy.percentageBasisPoints < 0 ||
      policy.percentageBasisPoints > 10000
    ) {
      addError(errors, "REWARD_RULES_INVALID", `Discount cap policy ${id} is invalid.`, `discountCapPolicies.${id}`);
    }
    if (isObject(policy) && policy.customerVisible !== false) {
      addError(
        errors,
        "REWARD_RULES_INVALID",
        `Discount cap policy ${id} must remain internal.`,
        `discountCapPolicies.${id}.customerVisible`
      );
    }
  }

  return validationResult(errors, input);
}

function resolveActiveRules(rulesDocuments = [], at = new Date().toISOString()) {
  const candidates = Array.isArray(rulesDocuments) ? rulesDocuments : [rulesDocuments];
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) {
    return {
      ok: false,
      error: createRewardError("REWARD_RULES_NOT_EFFECTIVE", "Evaluation timestamp is invalid."),
    };
  }
  const valid = [];
  for (const rules of candidates) {
    const validation = validateRewardsRules(rules);
    if (!validation.ok) continue;
    const starts = Date.parse(rules.effectiveFrom);
    const ends = rules.effectiveUntil ? Date.parse(rules.effectiveUntil) : Number.POSITIVE_INFINITY;
    if (rules.status === "active" && starts <= timestamp && timestamp < ends) valid.push(rules);
  }
  valid.sort((left, right) => Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom));
  if (valid.length === 0) {
    return {
      ok: false,
      error: createRewardError("REWARD_RULES_NOT_EFFECTIVE", "No active rewards rules apply.", { at }),
    };
  }
  return { ok: true, rules: valid[0] };
}

function deriveShowroomBadge(lifetimePoints, rules) {
  if (!Number.isInteger(lifetimePoints) || lifetimePoints < 0) return null;
  const validation = validateRewardsRules(rules);
  if (!validation.ok) return null;
  return rules.badges
    .filter((badge) => SHOWROOM_BADGE_IDS.includes(badge.id))
    .sort((left, right) => left.thresholdPoints - right.thresholdPoints)
    .reduce(
      (current, badge) => (lifetimePoints >= badge.thresholdPoints ? badge : current),
      null
    );
}

module.exports = {
  cleanString,
  deriveShowroomBadge,
  duplicateValues,
  isObject,
  isValidIsoTimestamp,
  resolveActiveRules,
  validateRewardsRules,
};
