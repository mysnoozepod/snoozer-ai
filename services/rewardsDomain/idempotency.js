"use strict";

const crypto = require("crypto");
const { REPEAT_POLICY_TYPES } = require("./constants");
const { createRewardError } = require("./errors");
const { cleanString, isObject, isValidIsoTimestamp } = require("./rules");

function hashMaterial(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function requiredValue(value, name) {
  const normalized = cleanString(value);
  if (!normalized) {
    return {
      ok: false,
      error: createRewardError("REWARD_SUBJECT_REQUIRED", `Idempotency requires ${name}.`, {
        field: name,
      }),
    };
  }
  return { ok: true, value: normalized };
}

function buildRewardIdempotencyKey(event, milestone, rulesVersion) {
  if (!isObject(event) || !isObject(milestone)) {
    return {
      ok: false,
      error: createRewardError("REWARD_EVENT_INVALID", "Event and milestone are required."),
    };
  }
  const shopper = requiredValue(event.shopperId, "shopperId");
  if (!shopper.ok) return shopper;
  const milestoneId = requiredValue(milestone.id, "milestoneId");
  if (!milestoneId.ok) return milestoneId;
  const version = requiredValue(rulesVersion || event.rulesVersion, "rulesVersion");
  if (!version.ok) return version;

  const repeatPolicy = milestone.repeatPolicy || {};
  if (!REPEAT_POLICY_TYPES.includes(repeatPolicy.type)) {
    return {
      ok: false,
      error: createRewardError("REWARD_RULES_INVALID", "Repeat policy is unsupported.", {
        repeatPolicy: repeatPolicy.type || null,
      }),
    };
  }

  const parts = [
    `shopper=${shopper.value}`,
    `milestone=${milestoneId.value}`,
    `rules=${version.value}`,
    `repeat=${repeatPolicy.type}`,
  ];

  switch (repeatPolicy.type) {
    case "once_per_showroom_journey": {
      const journey = requiredValue(event.metadata?.journeyId, "metadata.journeyId");
      if (!journey.ok) return journey;
      parts.push(`journey=${journey.value}`);
      break;
    }
    case "once_per_appointment": {
      const appointment = requiredValue(event.appointmentId, "appointmentId");
      if (!appointment.ok) return appointment;
      parts.push(`appointment=${appointment.value}`);
      break;
    }
    case "once_per_session": {
      const session = requiredValue(event.sessionId, "sessionId");
      if (!session.ok) return session;
      parts.push(`session=${session.value}`);
      break;
    }
    case "once_per_pod": {
      const pod = requiredValue(
        event.metadata?.podId || (event.subjectType === "pod" ? event.subjectId : ""),
        "metadata.podId"
      );
      if (!pod.ok) return pod;
      parts.push(`pod=${pod.value}`);
      break;
    }
    case "once_per_qualifying_subject": {
      const subjectType = requiredValue(event.subjectType, "subjectType");
      if (!subjectType.ok) return subjectType;
      const subject = requiredValue(event.subjectId, "subjectId");
      if (!subject.ok) return subject;
      parts.push(`subjectType=${subjectType.value}`, `subject=${subject.value}`);
      break;
    }
    case "repeatable_after_interval": {
      if (!Number.isInteger(repeatPolicy.intervalSeconds) || repeatPolicy.intervalSeconds <= 0) {
        return {
          ok: false,
          error: createRewardError("REWARD_RULES_INVALID", "Repeat interval is invalid."),
        };
      }
      if (!isValidIsoTimestamp(event.occurredAt)) {
        return {
          ok: false,
          error: createRewardError("REWARD_EVENT_INVALID", "occurredAt is required for interval repeat."),
        };
      }
      const bucket = Math.floor(
        Date.parse(event.occurredAt) / 1000 / repeatPolicy.intervalSeconds
      );
      parts.push(`window=${bucket}`, `interval=${repeatPolicy.intervalSeconds}`);
      break;
    }
    case "once_per_shopper_lifetime":
    case "non_repeatable":
      break;
    default:
      return {
        ok: false,
        error: createRewardError("REWARD_RULES_INVALID", "Repeat policy is unsupported."),
      };
  }

  const material = parts.join("|");
  const hash = hashMaterial(material);
  return {
    ok: true,
    claimKey: `reward-claim#${hash}`,
    claimHash: hash,
    material,
    repeatPolicy: repeatPolicy.type,
  };
}

module.exports = {
  buildRewardIdempotencyKey,
  hashMaterial,
};
