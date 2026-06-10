#!/usr/bin/env node

const assert = require("assert");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const {
  buildCustomerProfilePatch,
  upsertCustomerProfile,
  getCustomerProfileKey,
} = require("../services/customerProfile");

const originalSend = DynamoDBDocumentClient.prototype.send;

function restoreDynamo() {
  DynamoDBDocumentClient.prototype.send = originalSend;
}

async function testBuildCustomerProfilePatchNormalizesCanonicalFields() {
  const patch = buildCustomerProfilePatch({
    shopperId: "shopper-1",
    sessionId: "session-1",
    assessmentAnswers: {
      size: "Queen",
      motionMode: "No Motion",
    },
    canonicalRecommendation: {
      manifestVersion: "showroom-manifest.v1",
      normalizedAssessment: {
        motionKey: "no_motion",
        motionLabel: "No Motion",
        warnings: ["normalized_full_split"],
      },
      topPodId: "4",
      topPodIds: ["4", "2", "4"],
      primaryMattressHandle: "12-all-foam-mattress",
      baseHandle: null,
      motionKey: "no_motion",
      motionLabel: "No Motion",
      reasonKeys: ["cooling", "side_pressure_relief", "cooling"],
      warnings: ["normalized_full_split"],
    },
  });

  assert.strictEqual(patch.topPodId, "4", "top pod id should be preserved");
  assert.deepStrictEqual(patch.topPodIds, ["4", "2"], "top pod ids should dedupe");
  assert.strictEqual(
    patch.primaryMattressHandle,
    "12-all-foam-mattress",
    "primary mattress handle should be preserved"
  );
  assert.strictEqual(patch.baseHandle, null, "explicit no-base choice should remain null");
  assert.strictEqual(patch.motionKey, "no_motion", "motion key should be normalized");
  assert.deepStrictEqual(
    patch.reasonKeys,
    ["cooling", "side_pressure_relief"],
    "reason keys should dedupe"
  );
  assert.deepStrictEqual(
    patch.normalizedAssessment,
    {
      motionKey: "no_motion",
      motionLabel: "No Motion",
      warnings: ["normalized_full_split"],
    },
    "normalized assessment should be preserved"
  );
  assert.strictEqual(
    patch.canonicalRecommendation?.manifestVersion,
    "showroom-manifest.v1",
    "canonical snapshot should keep manifest version"
  );
}

async function testMissingCustomerProfileTableSkipsWrites() {
  const originalTable = process.env.CUSTOMER_PROFILE_TABLE;
  delete process.env.CUSTOMER_PROFILE_TABLE;

  let sendCalls = 0;
  DynamoDBDocumentClient.prototype.send = async function send() {
    sendCalls += 1;
    return {};
  };

  try {
    const result = await upsertCustomerProfile({
      shopperId: "shopper-2",
      sessionId: "session-2",
    });

    assert.deepStrictEqual(
      result,
      {
        ok: false,
        skipped: true,
        reason: "CUSTOMER_PROFILE_TABLE_NOT_CONFIGURED",
      },
      "missing table config should skip cleanly"
    );
    assert.strictEqual(sendCalls, 0, "no DynamoDB call should happen when table is missing");
  } finally {
    if (typeof originalTable === "string") {
      process.env.CUSTOMER_PROFILE_TABLE = originalTable;
    }
  }
}

async function testProfileKeyPrefersShopperId() {
  const key = getCustomerProfileKey({
    shopperId: "shopper-3",
    sessionId: "session-3",
    threadId: "thread-3",
  });

  assert.deepStrictEqual(
    key,
    { profileId: "shopper#shopper-3" },
    "shopper id should win over session/thread ids"
  );
}

async function testSessionFallbackKeyWorks() {
  const key = getCustomerProfileKey({
    threadId: "thread-4",
  });

  assert.deepStrictEqual(
    key,
    { profileId: "session#thread-4" },
    "thread id should fall back to session-based profile id"
  );
}

async function testUpsertUsesProfileIdKey() {
  const originalTable = process.env.CUSTOMER_PROFILE_TABLE;
  process.env.CUSTOMER_PROFILE_TABLE = "customer_profiles_test";

  const observed = [];
  DynamoDBDocumentClient.prototype.send = async function send(command) {
    observed.push(command);
    return {};
  };

  try {
    const result = await upsertCustomerProfile({
      shopperId: "shopper-5",
      sourceSurface: "ask_snoozer",
      lastIntent: "recommendation",
    });

    assert.strictEqual(result.ok, true, "upsert should succeed when table is configured");
    assert.strictEqual(result.profileId, "shopper#shopper-5", "profile id should match shopper key");
    assert.strictEqual(observed.length, 1, "exactly one update command should be sent");
    assert(
      observed[0] instanceof UpdateCommand,
      "customer profile persistence should use DynamoDB UpdateCommand"
    );
    assert.deepStrictEqual(
      observed[0].input.Key,
      { profileId: "shopper#shopper-5" },
      "update key should use the profileId partition key"
    );
  } finally {
    if (typeof originalTable === "string") {
      process.env.CUSTOMER_PROFILE_TABLE = originalTable;
    } else {
      delete process.env.CUSTOMER_PROFILE_TABLE;
    }
  }
}

async function main() {
  const tests = [
    ["build_customer_profile_patch_normalizes_canonical_fields", testBuildCustomerProfilePatchNormalizesCanonicalFields],
    ["missing_customer_profile_table_skips_writes", testMissingCustomerProfileTableSkipsWrites],
    ["profile_key_prefers_shopper_id", testProfileKeyPrefersShopperId],
    ["session_fallback_key_works", testSessionFallbackKeyWorks],
    ["upsert_uses_profile_id_key", testUpsertUsesProfileIdKey],
  ];

  const failures = [];

  try {
    for (const [name, testFn] of tests) {
      try {
        await testFn();
        console.log(`PASS ${name}`);
      } catch (error) {
        failures.push({ name, message: error.message });
        console.error(`FAIL ${name}: ${error.message}`);
      }
    }
  } finally {
    restoreDynamo();
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s) detected.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${tests.length} customer profile tests passed.`);
}

main().catch((error) => {
  restoreDynamo();
  console.error(error);
  process.exit(1);
});
