"use strict";

const assert = require("assert");
const {
  logRewardsConfigurationReady,
  readRewardsConfiguration,
  resetRewardsConfigurationReadiness,
} = require("../services/rewards/configuration");

async function run() {
  const missing = readRewardsConfiguration({ env: {} });
  assert.strictEqual(missing.featureEnabled, false);
  assert(missing.missingRequiredKeys.includes("REWARDS_TABLE_NAME"));
  assert(missing.missingRequiredKeys.includes("REWARDS_CLASSIFICATIONS_KEY"));

  const env = {
    REWARDS_FEATURE_ENABLED: "true",
    REWARDS_ENVIRONMENT: "staging",
    REWARDS_TABLE_NAME: "msp-staging-rewards",
    REWARDS_RULES_BUCKET: "msp-staging-rewards-rules-851725413787",
    REWARDS_RULES_KEY: "rewards/staging/rewards-rules.v1.json",
    REWARDS_CLASSIFICATIONS_BUCKET:
      "msp-staging-rewards-rules-851725413787",
    REWARDS_CLASSIFICATIONS_KEY:
      "rewards/staging/rewards-product-classifications.v1.json",
    REWARDS_ZOHO_QUEUE_URL:
      "https://sqs.us-east-1.amazonaws.com/851725413787/msp-staging-rewards-zoho",
    REWARDS_REDEMPTION_ENABLED: "false",
  };
  const configured = readRewardsConfiguration({ env });
  assert.deepStrictEqual(configured.missingRequiredKeys, []);
  assert.strictEqual(configured.redemptionEnabled, false);

  resetRewardsConfigurationReadiness();
  const readiness = await logRewardsConfigurationReady({
    env,
    rules: { rulesVersion: "rewards.staging.v1" },
    force: true,
  });
  assert.strictEqual(readiness.activeRulesVersion, "rewards.staging.v1");
  assert.deepStrictEqual(readiness.missingRequiredKeys, []);

  console.log("Rewards configuration tests passed: 8");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
