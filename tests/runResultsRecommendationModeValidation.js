#!/usr/bin/env node

const assert = require("assert");

const { resolveRecommendation } = require("../services/recommendationResolver");
const { loadReactShowroomRecommendations } = require("./loadReactShowroomRecommendations");
const { loadResultsRecommendationHelpers } = require("./loadResultsRecommendationHelpers");

async function main() {
  const reactModule = loadReactShowroomRecommendations();
  const helpers = loadResultsRecommendationHelpers();

  assert.strictEqual(
    helpers.isCanonicalRecommendationsEnabled(undefined, { defaultValue: true }),
    true,
    "canonical flag should default on when requested"
  );
  assert.strictEqual(
    helpers.isCanonicalRecommendationsEnabled("false", { defaultValue: true }),
    false,
    "canonical flag should turn off when explicitly false"
  );

  const warnings = [];
  const logger = {
    warn: (...args) => warnings.push(args.map((item) => String(item)).join(" ")),
  };

  const answers = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
  };

  const localResult = await helpers.getResultsRecommendations({
    answers,
    useCanonical: false,
    generateLocal: reactModule.generateShowroomRecommendations,
    logger,
  });

  assert.strictEqual(localResult.mode, "local", "local mode should use the local engine");
  assert(Array.isArray(localResult.recommendations?.pods), "local mode should return pods");
  assert.strictEqual(localResult.recommendations.pods[0]?.podId, 4, "local mode should preserve current pod ranking");

  const canonicalResult = await helpers.getResultsRecommendations({
    answers,
    useCanonical: true,
    generateLocal: reactModule.generateShowroomRecommendations,
    resolveCanonical: (payload) => resolveRecommendation(payload),
    logger,
  });

  assert.strictEqual(canonicalResult.mode, "canonical", "canonical mode should use the resolver when enabled");
  assert(Array.isArray(canonicalResult.recommendations?.pods), "canonical mode should return pods");
  assert.strictEqual(
    canonicalResult.recommendations.meta?.source,
    "canonical_resolver",
    "canonical mode should tag the adapted payload"
  );
  assert.strictEqual(
    canonicalResult.recommendations.pods[0]?.baseHandle,
    null,
    "canonical mode should preserve explicit No Base intent"
  );

  const fallbackResult = await helpers.getResultsRecommendations({
    answers,
    useCanonical: true,
    generateLocal: reactModule.generateShowroomRecommendations,
    resolveCanonical: async () => {
      throw new Error("synthetic canonical failure");
    },
    logger,
  });

  assert.strictEqual(
    fallbackResult.mode,
    "local_fallback",
    "canonical failures should fall back to the local engine"
  );
  assert(Array.isArray(fallbackResult.recommendations?.pods), "fallback mode should still return pods");
  assert(
    warnings.some((entry) => entry.includes("canonical recommendations failed")),
    "fallback should log a clear warning"
  );

  console.log("PASS flag_default_on");
  console.log("PASS flag_explicit_false_off");
  console.log("PASS local_mode");
  console.log("PASS canonical_mode");
  console.log("PASS canonical_failure_fallback");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
