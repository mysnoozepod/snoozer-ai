"use strict";

const { ZOHO_SYNC_SCHEMA_VERSION } = require("./constants");
const { createRewardError, validationResult } = require("./errors");
const { hashMaterial } = require("./idempotency");
const { cleanString, isObject, isValidIsoTimestamp } = require("./rules");

const ZOHO_TIMELINE_EVENT_TYPES = Object.freeze([
  "points_awarded",
  "badge_earned",
  "offer_unlocked",
  "showroom_completed",
  "offer_redeemed",
  "reward_reversed",
  "post_purchase_badge_earned",
]);

const ZOHO_OWNED_FIELDS = Object.freeze([
  "canonicalProfileId",
  "snoozeCode",
  "currentShowroomBadge",
  "availableSleepPoints",
  "lifetimeSleepPoints",
  "showroomCompletionStatus",
  "assessmentCompletionStatus",
  "restTestCompletionStatus",
  "unlockedOfferSummaries",
  "lastRewardActivityAt",
  "lastShowroomVisitAt",
  "showroomLocation",
  "rulesVersion",
  "synchronizationVersion",
  "sourceUpdatedAt",
]);

function buildZohoRewardsDeduplicationKey(payload) {
  const material = [
    cleanString(payload?.canonicalProfileId),
    String(payload?.synchronizationVersion ?? ""),
    cleanString(payload?.sourceUpdatedAt),
  ].join("|");
  return `zoho-reward-sync#${hashMaterial(material)}`;
}

function validateZohoRewardsSyncPayload(input) {
  const errors = [];
  if (!isObject(input)) {
    return validationResult([
      createRewardError("REWARD_ZOHO_SYNC_INVALID", "Zoho rewards payload must be an object."),
    ]);
  }
  if (input.schemaVersion !== ZOHO_SYNC_SCHEMA_VERSION) {
    errors.push(
      createRewardError("REWARD_ZOHO_SYNC_INVALID", "Zoho sync schema version is unsupported.")
    );
  }
  for (const field of ["canonicalProfileId", "snoozeCode", "rulesVersion"]) {
    if (!cleanString(input[field])) {
      errors.push(
        createRewardError("REWARD_ZOHO_SYNC_INVALID", `${field} is required.`, { field })
      );
    }
  }
  if (!/^shopper#/.test(cleanString(input.canonicalProfileId))) {
    errors.push(
      createRewardError(
        "REWARD_ZOHO_SYNC_INVALID",
        "canonicalProfileId must use canonical shopper identity."
      )
    );
  }
  for (const field of ["availableSleepPoints", "lifetimeSleepPoints", "synchronizationVersion"]) {
    if (!Number.isInteger(input[field]) || input[field] < 0) {
      errors.push(
        createRewardError("REWARD_ZOHO_SYNC_INVALID", `${field} must be a non-negative integer.`, {
          field,
        })
      );
    }
  }
  if (!isValidIsoTimestamp(input.sourceUpdatedAt)) {
    errors.push(
      createRewardError("REWARD_ZOHO_SYNC_INVALID", "sourceUpdatedAt must be ISO-8601.")
    );
  }
  if (!Array.isArray(input.unlockedOfferSummaries)) {
    errors.push(
      createRewardError("REWARD_ZOHO_SYNC_INVALID", "unlockedOfferSummaries must be an array.")
    );
  }
  if (input.email || input.phone || input.address || input.paymentDetails) {
    errors.push(
      createRewardError(
        "REWARD_ZOHO_SYNC_INVALID",
        "Rewards sync payload must not introduce unrelated PII."
      )
    );
  }
  if (
    cleanString(input.deduplicationKey) &&
    input.deduplicationKey !== buildZohoRewardsDeduplicationKey(input)
  ) {
    errors.push(
      createRewardError("REWARD_ZOHO_SYNC_INVALID", "Zoho deduplication key is invalid.")
    );
  }
  return validationResult(errors, {
    ...input,
    deduplicationKey: buildZohoRewardsDeduplicationKey(input),
  });
}

function validateZohoTimelineEvent(input) {
  const errors = [];
  if (!isObject(input)) {
    return validationResult([
      createRewardError("REWARD_ZOHO_SYNC_INVALID", "Timeline event must be an object."),
    ]);
  }
  if (!ZOHO_TIMELINE_EVENT_TYPES.includes(input.eventType)) {
    errors.push(
      createRewardError("REWARD_ZOHO_SYNC_INVALID", "Timeline event type is unsupported.")
    );
  }
  for (const field of ["eventId", "canonicalProfileId", "occurredAt", "rulesVersion", "summary"]) {
    if (!cleanString(input[field])) {
      errors.push(createRewardError("REWARD_ZOHO_SYNC_INVALID", `${field} is required.`));
    }
  }
  if (!isValidIsoTimestamp(input.occurredAt)) {
    errors.push(createRewardError("REWARD_ZOHO_SYNC_INVALID", "Timeline timestamp is invalid."));
  }
  return validationResult(errors, input);
}

function assessZohoSyncFreshness(incoming, current) {
  const incomingValidation = validateZohoRewardsSyncPayload(incoming);
  if (!incomingValidation.ok) {
    return { accepted: false, error: incomingValidation.errors[0] };
  }
  if (!current) return { accepted: true, reason: "NO_CURRENT_SYNC_STATE" };
  const incomingVersion = Number(incoming.synchronizationVersion);
  const currentVersion = Number(current.synchronizationVersion);
  if (
    incomingVersion < currentVersion ||
    (incomingVersion === currentVersion &&
      Date.parse(incoming.sourceUpdatedAt) <= Date.parse(current.sourceUpdatedAt))
  ) {
    return {
      accepted: false,
      error: createRewardError("REWARD_ZOHO_SYNC_STALE", "Incoming Zoho sync state is stale."),
    };
  }
  return { accepted: true, reason: "INCOMING_SYNC_STATE_IS_NEWER" };
}

function classifyZohoSyncFailure(input = {}) {
  const status = Number(input.status || 0);
  const code = cleanString(input.code).toUpperCase();
  const retryable =
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500 ||
    ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "NETWORK_ERROR"].includes(code);
  return {
    retryable,
    terminal: !retryable,
    classification: retryable ? "transient" : "terminal",
  };
}

module.exports = {
  ZOHO_OWNED_FIELDS,
  ZOHO_TIMELINE_EVENT_TYPES,
  assessZohoSyncFreshness,
  buildZohoRewardsDeduplicationKey,
  classifyZohoSyncFailure,
  validateZohoRewardsSyncPayload,
  validateZohoTimelineEvent,
};
