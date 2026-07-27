"use strict";

const ERROR_DEFINITIONS = Object.freeze({
  REWARD_EVENT_INVALID: [400, false, "We could not verify that reward activity."],
  REWARD_EVENT_TYPE_UNSUPPORTED: [400, false, "That activity is not eligible for rewards."],
  REWARD_SOURCE_UNAUTHORIZED: [403, false, "That activity could not be verified."],
  REWARD_IDENTITY_REQUIRED: [401, false, "A Snooze Profile is required for this reward."],
  REWARD_SUBJECT_REQUIRED: [400, false, "That activity is missing required details."],
  REWARD_MILESTONE_DISABLED: [409, false, "That activity is not currently reward eligible."],
  REWARD_REPEAT_NOT_ALLOWED: [409, false, "That reward has already been recorded."],
  REWARD_PRODUCT_UNCLASSIFIED: [422, false, "That item is not eligible for this offer."],
  REWARD_OFFER_INELIGIBLE: [422, false, "That offer is not available for this selection."],
  REWARD_OFFER_CONFLICT: [409, false, "Those offers cannot be used together."],
  REWARD_PRICE_REQUIRED: [422, true, "We could not confirm the current offer value."],
  REWARD_DISCOUNT_CAP_EXCEEDED: [422, false, "That offer value could not be confirmed."],
  REWARD_RULES_VERSION_INVALID: [400, false, "The reward rules could not be verified."],
  REWARD_RULES_NOT_EFFECTIVE: [409, true, "Rewards are temporarily unavailable."],
  REWARD_RULES_INVALID: [500, false, "Rewards are temporarily unavailable."],
  REWARD_ZOHO_SYNC_INVALID: [400, false, "The rewards profile update is invalid."],
  REWARD_ZOHO_SYNC_STALE: [409, false, "The rewards profile update is older than the current record."],
});

function createRewardError(code, diagnosticMessage, details = {}) {
  const definition = ERROR_DEFINITIONS[code] || [500, false, "Rewards are temporarily unavailable."];
  return {
    code,
    diagnosticMessage: String(diagnosticMessage || code),
    publicMessage: definition[2],
    retryable: definition[1],
    httpStatus: definition[0],
    details: details && typeof details === "object" ? details : {},
  };
}

function validationResult(errors = [], value) {
  const normalized = Array.isArray(errors) ? errors.filter(Boolean) : [];
  return {
    ok: normalized.length === 0,
    errors: normalized,
    value: normalized.length === 0 ? value : undefined,
  };
}

module.exports = {
  ERROR_DEFINITIONS,
  createRewardError,
  validationResult,
};
