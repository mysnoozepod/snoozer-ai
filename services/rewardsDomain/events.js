"use strict";

const {
  CLIENT_CONTROLLED_REWARD_FIELDS,
  REWARD_EVENT_SCHEMA_VERSION,
} = require("./constants");
const { createRewardError, validationResult } = require("./errors");
const { buildRewardIdempotencyKey } = require("./idempotency");
const {
  cleanString,
  isObject,
  isValidIsoTimestamp,
  resolveActiveRules,
  validateRewardsRules,
} = require("./rules");

function findForbiddenField(input) {
  if (!isObject(input)) return null;
  for (const field of CLIENT_CONTROLLED_REWARD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) return field;
    if (isObject(input.metadata) && Object.prototype.hasOwnProperty.call(input.metadata, field)) {
      return `metadata.${field}`;
    }
  }
  return null;
}

function validateRewardEvent(input, rules) {
  const errors = [];
  if (!isObject(input)) {
    return validationResult([
      createRewardError("REWARD_EVENT_INVALID", "Reward event must be an object."),
    ]);
  }
  const forbiddenField = findForbiddenField(input);
  if (forbiddenField) {
    errors.push(
      createRewardError(
        "REWARD_EVENT_INVALID",
        `Client-controlled reward field is prohibited: ${forbiddenField}`,
        { field: forbiddenField }
      )
    );
  }
  if (input.schemaVersion !== REWARD_EVENT_SCHEMA_VERSION) {
    errors.push(
      createRewardError("REWARD_EVENT_INVALID", "Reward event schema version is unsupported.", {
        field: "schemaVersion",
      })
    );
  }
  for (const field of [
    "eventId",
    "eventType",
    "shopperId",
    "profileId",
    "sessionId",
    "subjectType",
    "sourceSurface",
    "sourceSystem",
    "rulesVersion",
  ]) {
    if (!cleanString(input[field])) {
      const code =
        field === "shopperId" || field === "profileId"
          ? "REWARD_IDENTITY_REQUIRED"
          : "REWARD_EVENT_INVALID";
      errors.push(createRewardError(code, `${field} is required.`, { field }));
    }
  }
  for (const field of ["occurredAt", "receivedAt"]) {
    if (!isValidIsoTimestamp(input[field])) {
      errors.push(
        createRewardError("REWARD_EVENT_INVALID", `${field} must be ISO-8601.`, { field })
      );
    }
  }
  if (input.deviceId !== null && input.deviceId !== undefined && !cleanString(input.deviceId)) {
    errors.push(createRewardError("REWARD_EVENT_INVALID", "deviceId must be a string or null."));
  }
  if (
    input.appointmentId !== null &&
    input.appointmentId !== undefined &&
    !cleanString(input.appointmentId)
  ) {
    errors.push(createRewardError("REWARD_EVENT_INVALID", "appointmentId must be a string or null."));
  }
  if (!isObject(input.metadata)) {
    errors.push(createRewardError("REWARD_EVENT_INVALID", "metadata must be an object."));
  }

  const rulesValidation = validateRewardsRules(rules);
  if (!rulesValidation.ok) {
    errors.push(createRewardError("REWARD_RULES_INVALID", "Reward rules failed validation."));
    return validationResult(errors);
  }
  const milestone = rules.milestones.find((candidate) => candidate.id === input.eventType);
  if (!milestone) {
    errors.push(
      createRewardError("REWARD_EVENT_TYPE_UNSUPPORTED", `Unsupported event type: ${input.eventType}`)
    );
    return validationResult(errors);
  }
  if (input.rulesVersion !== rules.rulesVersion) {
    errors.push(
      createRewardError("REWARD_RULES_VERSION_INVALID", "Event rules version does not match.", {
        eventRulesVersion: input.rulesVersion,
        activeRulesVersion: rules.rulesVersion,
      })
    );
  }
  if (!milestone.allowedSourceSystems.includes(input.sourceSystem)) {
    errors.push(
      createRewardError("REWARD_SOURCE_UNAUTHORIZED", "Source system is not authorized.", {
        sourceSystem: input.sourceSystem,
      })
    );
  }
  if (!milestone.allowedSourceSurfaces.includes(input.sourceSurface)) {
    errors.push(
      createRewardError("REWARD_SOURCE_UNAUTHORIZED", "Source surface is not authorized.", {
        sourceSurface: input.sourceSurface,
      })
    );
  }
  if (
    milestone.subjectRequirements?.required &&
    (!cleanString(input.subjectId) ||
      (Array.isArray(milestone.subjectRequirements.allowedTypes) &&
        !milestone.subjectRequirements.allowedTypes.includes(input.subjectType)))
  ) {
    errors.push(
      createRewardError("REWARD_SUBJECT_REQUIRED", "Required qualifying subject is missing.", {
        subjectType: input.subjectType || null,
      })
    );
  }
  for (const field of milestone.requiredMetadata || []) {
    const value = input.metadata?.[field];
    if (value === null || value === undefined || value === "") {
      errors.push(
        createRewardError("REWARD_EVENT_INVALID", `Required metadata is missing: ${field}`, {
          field: `metadata.${field}`,
        })
      );
    }
  }
  return validationResult(errors, { event: input, milestone });
}

function evaluateMilestoneEvent(input = {}) {
  const resolved = input.rules
    ? { ok: true, rules: input.rules }
    : resolveActiveRules(input.rulesDocuments, input.evaluationTime || input.event?.receivedAt);
  if (!resolved.ok) return { accepted: false, error: resolved.error };
  const rules = resolved.rules;
  const validation = validateRewardEvent(input.event, rules);
  if (!validation.ok) {
    return {
      accepted: false,
      errors: validation.errors,
      error: validation.errors[0],
    };
  }
  const milestone = validation.value.milestone;
  if (!milestone.enabled || milestone.status !== "implemented") {
    const error = createRewardError(
      "REWARD_MILESTONE_DISABLED",
      `Milestone is not enabled: ${milestone.id}`,
      { milestoneId: milestone.id }
    );
    return { accepted: false, error, errors: [error] };
  }
  const idempotency = buildRewardIdempotencyKey(input.event, milestone, rules.rulesVersion);
  if (!idempotency.ok) {
    return { accepted: false, error: idempotency.error, errors: [idempotency.error] };
  }
  return {
    accepted: true,
    rulesVersion: rules.rulesVersion,
    milestoneId: milestone.id,
    pointAward: milestone.pointAward,
    badgeContribution: Boolean(milestone.badgeContribution),
    candidateOfferUnlockIds: [...(milestone.candidateOfferUnlockIds || [])],
    idempotency,
    authority: milestone.completionAuthority,
  };
}

module.exports = {
  evaluateMilestoneEvent,
  findForbiddenField,
  validateRewardEvent,
};
