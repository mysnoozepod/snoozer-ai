"use strict";

const { CUSTOMER_PROFILE_REWARD_SUMMARY_SCHEMA_VERSION } = require("./constants");
const { createRewardError, validationResult } = require("./errors");
const { cleanString, isObject, isValidIsoTimestamp } = require("./rules");

function validateCustomerProfileRewardSummary(input) {
  const errors = [];
  if (!isObject(input)) {
    return validationResult([
      createRewardError("REWARD_EVENT_INVALID", "Reward summary must be an object."),
    ]);
  }
  if (input.schemaVersion !== CUSTOMER_PROFILE_REWARD_SUMMARY_SCHEMA_VERSION) {
    errors.push(
      createRewardError("REWARD_RULES_VERSION_INVALID", "Reward summary schema is unsupported.")
    );
  }
  for (const field of ["activeRulesVersion", "currentShowroomBadgeId", "latestRewardActivityAt"]) {
    if (!cleanString(input[field])) {
      errors.push(createRewardError("REWARD_EVENT_INVALID", `${field} is required.`));
    }
  }
  for (const field of [
    "availableSleepPoints",
    "lifetimeSleepPoints",
    "unlockedOfferCount",
    "summaryVersion",
  ]) {
    if (!Number.isInteger(input[field]) || input[field] < 0) {
      errors.push(createRewardError("REWARD_EVENT_INVALID", `${field} is invalid.`));
    }
  }
  if (!isValidIsoTimestamp(input.latestRewardActivityAt)) {
    errors.push(
      createRewardError("REWARD_EVENT_INVALID", "latestRewardActivityAt must be ISO-8601.")
    );
  }
  if (!["pending", "synced", "failed", "not_configured"].includes(input.syncStatus)) {
    errors.push(createRewardError("REWARD_EVENT_INVALID", "syncStatus is invalid."));
  }
  return validationResult(errors, input);
}

module.exports = {
  validateCustomerProfileRewardSummary,
};
