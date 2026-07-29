"use strict";

const { loadRewardsRules } = require("./rulesLoader");

let readinessLogged = false;

function configured(value) {
  return Boolean(String(value || "").trim());
}

function readRewardsConfiguration(options = {}) {
  const env = options.env || process.env;
  const featureEnabled =
    String(env.REWARDS_FEATURE_ENABLED || "").trim().toLowerCase() === "true";
  const tableConfigured = configured(env.REWARDS_TABLE_NAME);
  const rulesConfigured =
    configured(env.REWARDS_RULES_BUCKET) && configured(env.REWARDS_RULES_KEY);
  const classificationsConfigured =
    configured(env.REWARDS_CLASSIFICATIONS_BUCKET) &&
    configured(env.REWARDS_CLASSIFICATIONS_KEY);
  const zohoOutboxConfigured = configured(env.REWARDS_ZOHO_QUEUE_URL);
  const missingRequiredKeys = [];

  if (!tableConfigured) missingRequiredKeys.push("REWARDS_TABLE_NAME");
  if (!configured(env.REWARDS_RULES_BUCKET)) {
    missingRequiredKeys.push("REWARDS_RULES_BUCKET");
  }
  if (!configured(env.REWARDS_RULES_KEY)) {
    missingRequiredKeys.push("REWARDS_RULES_KEY");
  }
  if (!configured(env.REWARDS_CLASSIFICATIONS_BUCKET)) {
    missingRequiredKeys.push("REWARDS_CLASSIFICATIONS_BUCKET");
  }
  if (!configured(env.REWARDS_CLASSIFICATIONS_KEY)) {
    missingRequiredKeys.push("REWARDS_CLASSIFICATIONS_KEY");
  }
  if (!zohoOutboxConfigured) {
    missingRequiredKeys.push("REWARDS_ZOHO_QUEUE_URL");
  }

  return {
    event: "rewards.configuration.ready",
    environment: String(env.REWARDS_ENVIRONMENT || "unknown").trim(),
    featureEnabled,
    tableConfigured,
    rulesConfigured,
    activeRulesVersion: null,
    classificationsConfigured,
    zohoOutboxConfigured,
    redemptionEnabled:
      String(env.REWARDS_REDEMPTION_ENABLED || "").trim().toLowerCase() ===
      "true",
    missingRequiredKeys,
  };
}

async function logRewardsConfigurationReady(options = {}) {
  if (readinessLogged && !options.force) return null;

  const readiness = readRewardsConfiguration(options);
  if (readiness.featureEnabled && readiness.rulesConfigured) {
    try {
      const loadRules = options.loadRules || loadRewardsRules;
      const loaded = options.rules
        ? { rules: options.rules }
        : await loadRules(options.rulesOptions || options);
      readiness.activeRulesVersion = loaded?.rules?.rulesVersion || null;
    } catch (error) {
      readiness.missingRequiredKeys.push("REWARDS_ACTIVE_RULES");
      readiness.rulesLoadError = error.code || "REWARD_RULES_LOAD_FAILED";
    }
  }

  readinessLogged = true;
  console.log(JSON.stringify(readiness));
  return readiness;
}

function resetRewardsConfigurationReadiness() {
  readinessLogged = false;
}

module.exports = {
  logRewardsConfigurationReady,
  readRewardsConfiguration,
  resetRewardsConfigurationReadiness,
};
