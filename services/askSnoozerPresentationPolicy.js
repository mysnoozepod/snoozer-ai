const crypto = require("crypto");

const PRESENTATION_EXPERIMENT_VERSION = "ask-snoozer-presentation-exp-v1";
const BASELINE_POLICY_VERSION = "baseline-v1";
const PRESENTATION_POLICIES = Object.freeze({
  "baseline-v1": Object.freeze({
    version: "baseline-v1",
    description: "Current trusted-advisor production presentation.",
    directives: ["preserve_current_structure"],
  }),
  "conversational-transitions-v1": Object.freeze({
    version: "conversational-transitions-v1",
    description: "Use slightly more natural continuity and acknowledgement language.",
    directives: ["acknowledge_prior_context_briefly", "avoid_template_openers"],
  }),
  "concise-default-v1": Object.freeze({
    version: "concise-default-v1",
    description: "Prefer a shorter standard-depth explanation while preserving the useful tradeoff.",
    directives: ["shorter_standard_depth", "retain_tradeoff"],
  }),
  "direct-answer-first-v1": Object.freeze({
    version: "direct-answer-first-v1",
    description: "Lead with the answer or recommendation before explanation.",
    directives: ["direct_answer_first", "explanation_second"],
  }),
});

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function clampRate(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function bucket(value) {
  const digest = crypto.createHash("sha256").update(clean(value)).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function parseVariants(value = "") {
  const variants = clean(value)
    .split(",")
    .map((item) => clean(item))
    .filter((item) => PRESENTATION_POLICIES[item] && item !== BASELINE_POLICY_VERSION);
  return [...new Set(variants)];
}

function resolveAskSnoozerPresentationPolicy({ correlationId = "", env = process.env } = {}) {
  const forcedVersion = clean(env.ASK_SNOOZER_PRESENTATION_POLICY_VERSION);
  if (PRESENTATION_POLICIES[forcedVersion]) {
    return {
      experimentVersion: PRESENTATION_EXPERIMENT_VERSION,
      assignment: "forced",
      ...PRESENTATION_POLICIES[forcedVersion],
    };
  }

  const rate = clampRate(env.ASK_SNOOZER_PRESENTATION_EXPERIMENT_RATE, 0);
  const variants = parseVariants(
    env.ASK_SNOOZER_PRESENTATION_EXPERIMENT_VARIANTS ||
      "conversational-transitions-v1,concise-default-v1,direct-answer-first-v1"
  );
  const key = `${PRESENTATION_EXPERIMENT_VERSION}:${clean(correlationId) || "anonymous"}`;
  if (!variants.length || rate <= 0 || bucket(`${key}:eligible`) >= rate) {
    return {
      experimentVersion: PRESENTATION_EXPERIMENT_VERSION,
      assignment: "control",
      ...PRESENTATION_POLICIES[BASELINE_POLICY_VERSION],
    };
  }

  const index = Math.min(variants.length - 1, Math.floor(bucket(`${key}:variant`) * variants.length));
  return {
    experimentVersion: PRESENTATION_EXPERIMENT_VERSION,
    assignment: "experiment",
    ...PRESENTATION_POLICIES[variants[index]],
  };
}

module.exports = {
  BASELINE_POLICY_VERSION,
  PRESENTATION_EXPERIMENT_VERSION,
  PRESENTATION_POLICIES,
  resolveAskSnoozerPresentationPolicy,
};
