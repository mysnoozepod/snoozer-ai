#!/usr/bin/env node

const assert = require("assert");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const manifest = require("../data/showroom-manifest.v1.json");
const shopifySvc = require("../services/shopify");
const customerProfileZohoSync = require("../services/customerProfileZohoSync");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalFetchProductsByHandles = shopifySvc.fetchProductsByHandles;
const originalSyncCustomerProfileToZoho =
  customerProfileZohoSync.syncCustomerProfileToZoho;

const profileStore = new Map();
const resultsStore = new Map();
const sessionStore = new Map();
const rewardsStore = new Map();
const zohoSyncCalls = [];

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function resetModules() {
  clearModule("../index");
  clearModule("../routes/rewardsRoutes");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreDynamo() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
}

function restoreShopify() {
  shopifySvc.fetchProductsByHandles = originalFetchProductsByHandles;
}

function restoreZohoSync() {
  customerProfileZohoSync.syncCustomerProfileToZoho = originalSyncCustomerProfileToZoho;
}

function resetStores() {
  profileStore.clear();
  resultsStore.clear();
  sessionStore.clear();
  rewardsStore.clear();
  zohoSyncCalls.length = 0;
}

function buildProductItem(product) {
  return {
    id: `gid://shopify/Product/${product.handle}`,
    handle: product.handle,
    title: product.title,
    productType: product.type || "mattress",
    variants: [
      {
        id: `gid://shopify/ProductVariant/${product.handle}-queen`,
        available: true,
        title: "Queen",
      },
    ],
  };
}

function patchShopify() {
  const productMap = new Map(manifest.products.map((product) => [product.handle, product]));
  shopifySvc.fetchProductsByHandles = async function mockedFetchProductsByHandles({
    handles = [],
  } = {}) {
    return {
      items: handles
        .map((handle) => productMap.get(String(handle || "").trim()))
        .filter(Boolean)
        .map(buildProductItem),
    };
  };
}

function applyProfileUpdate(profileId, input) {
  const existing = profileStore.get(profileId) || { profileId };
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};

  if (!existing.createdAt && Object.prototype.hasOwnProperty.call(values, ":createdAt")) {
    existing.createdAt = clone(values[":createdAt"]);
  }

  Object.keys(names).forEach((nameKey) => {
    if (!nameKey.startsWith("#attr")) return;
    const suffix = nameKey.replace("#attr", "");
    const valueKey = `:value${suffix}`;
    if (!Object.prototype.hasOwnProperty.call(values, valueKey)) return;
    existing[names[nameKey]] = clone(values[valueKey]);
  });

  profileStore.set(profileId, existing);
  return existing;
}

function applyRewardsUpdate(shopperId, input) {
  const existing = clone(
    rewardsStore.get(shopperId) || {
      shopperId,
      balance: 0,
      history: [],
      updatedAt: null,
    }
  );
  const values = input.ExpressionAttributeValues || {};

  if (Object.prototype.hasOwnProperty.call(values, ":delta")) {
    existing.balance = Number(existing.balance || 0) + Number(values[":delta"] || 0);
  }
  if (Object.prototype.hasOwnProperty.call(values, ":neg")) {
    existing.balance = Number(existing.balance || 0) + Number(values[":neg"] || 0);
  }
  if (Object.prototype.hasOwnProperty.call(values, ":entry")) {
    existing.history = []
      .concat(Array.isArray(existing.history) ? existing.history : [])
      .concat(clone(values[":entry"] || []));
  }
  if (Object.prototype.hasOwnProperty.call(values, ":ts")) {
    existing.updatedAt = values[":ts"];
  }

  rewardsStore.set(shopperId, existing);
  return existing;
}

function patchDynamo() {
  DynamoDBDocumentClient.prototype.send = async function send(command) {
    const tableName = String(command.input?.TableName || "");
    const key = command.input?.Key || {};

    if (command instanceof GetCommand) {
      if (key.profileId) {
        return { Item: profileStore.get(key.profileId) || null };
      }
      if (key.sessionId) {
        return { Item: sessionStore.get(key.sessionId) || null };
      }
      if (key.shopperId && /rewards/i.test(tableName)) {
        return { Item: rewardsStore.get(key.shopperId) || null };
      }
      if (key.shopperId) {
        return { Item: resultsStore.get(key.shopperId) || null };
      }
      return { Item: null };
    }

    if (command instanceof PutCommand) {
      const item = clone(command.input?.Item || {});
      if (item.sessionId) {
        sessionStore.set(item.sessionId, item);
      } else if (item.shopperId && /rewards/i.test(tableName)) {
        rewardsStore.set(item.shopperId, item);
      } else if (item.shopperId) {
        resultsStore.set(item.shopperId, item);
      }
      return {};
    }

    if (command instanceof UpdateCommand) {
      if (key.profileId) {
        applyProfileUpdate(key.profileId, command.input);
        return {};
      }
      if (key.sessionId) {
        const current = sessionStore.get(key.sessionId) || { sessionId: key.sessionId, context: {} };
        const contextValue = command.input?.ExpressionAttributeValues?.[":c"];
        sessionStore.set(key.sessionId, {
          ...current,
          context: clone(contextValue || current.context),
        });
        return {};
      }
      if (key.shopperId && /rewards/i.test(tableName)) {
        const updated = applyRewardsUpdate(key.shopperId, command.input);
        return { Attributes: clone(updated) };
      }
      return {};
    }

    return {};
  };
}

function patchZohoSync() {
  customerProfileZohoSync.syncCustomerProfileToZoho = async function mockedSync(profile = {}) {
    zohoSyncCalls.push(clone(profile));
    return {
      ok: true,
      skipped: false,
      reason: null,
      operation: "update",
      shopperId: profile.shopperId || null,
      contactId: "contact-test-1",
      code: "SUCCESS",
    };
  };
}

function buildEvent(method, path, body) {
  return {
    version: "2.0",
    routeKey: `${method.toUpperCase()} ${path}`,
    path,
    rawPath: path,
    headers: {
      "content-type": "application/json",
      host: "local.snooze-identity.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: method.toUpperCase(),
        path,
        sourceIp: "127.0.0.1",
        userAgent: "snooze-code-route-test",
      },
      requestId: `${path}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      routeKey: `${method.toUpperCase()} ${path}`,
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  };
}

function parseBody(response) {
  assert.strictEqual(response.statusCode, 200, "expected HTTP 200");
  return JSON.parse(response.body);
}

function unwrapData(payload) {
  return payload && payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;
}

async function invokeLambda(method, path, body) {
  const { lambdaHandler } = require("../index");
  return parseBody(await lambdaHandler(buildEvent(method, path, body)));
}

async function testAssessmentWithGeneratedShopifyIdIssuesSnoozeCode() {
  resetStores();
  resetModules();

  const payload = unwrapData(
    await invokeLambda("POST", "/assessment", {
      shopperId: "shopify-assessment-template--18443742478397__main-1781081490455-oot4gq",
      origin: "shopify_assessment_page",
      answers: {
        size: "Queen",
        motionMode: "No Motion",
        firmness: "Soft",
        sleepPosition: "Side",
        sleepPartner: "No",
        baseType: "No Base",
        temperature: "Hot",
      },
    })
  );

  assert.strictEqual(payload.ok, true, "assessment should succeed");
  assert(/^\d{6}$/.test(String(payload.snoozeCode || "")), "assessment should issue a six-digit Snooze Code");
  assert.strictEqual(payload.shopperId, payload.snoozeCode, "canonical shopperId should collapse onto Snooze Code");
  assert.strictEqual(payload.isNewCode, true, "assessment should report a new code");

  const canonicalProfile = profileStore.get(`shopper#${payload.snoozeCode}`);
  assert(canonicalProfile, "canonical customer profile should be created");
  assert(
    Array.isArray(canonicalProfile.identityAliases) &&
      canonicalProfile.identityAliases.includes("shopify-assessment-template--18443742478397__main-1781081490455-oot4gq"),
    "temporary Shopify id should be copied into canonical profile aliases"
  );
  assert(resultsStore.get(payload.snoozeCode), "assessment answers should be saved under canonical Snooze Code");
  assert.strictEqual(
    zohoSyncCalls[0]?.shopperId,
    payload.snoozeCode,
    "Zoho sync should receive canonical Snooze Code rather than temporary id"
  );
}

async function testAssessmentWithExistingAccessCodeSavesUnderCanonicalProfile() {
  resetStores();
  resetModules();

  const payload = unwrapData(
    await invokeLambda("POST", "/assessment", {
      shopperId: "shopify-assessment-page-legacy-temp",
      accessCode: "8862",
      origin: "shopify_assessment_page",
      answers: {
        size: "Queen",
        motionMode: "No Motion",
        firmness: "Soft",
        sleepPosition: "Side",
        sleepPartner: "No",
        baseType: "No Base",
      },
    })
  );

  assert.strictEqual(payload.shopperId, "8862", "existing access code should win");
  assert(profileStore.get("shopper#8862"), "profile should be stored under shopper#8862");
}

async function testAssessmentSnapshotPassesStoredAssessmentToProfileResolver() {
  const { handleAssessmentRoutes } = require("../routes/assessmentRoutes");
  const storedAssessment = {
    shopperId: "2468",
    answers: { firmness: "Soft" },
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
  let resolverInput = null;

  const result = await handleAssessmentRoutes({
    event: {},
    method: "GET",
    routePath: "/assessment/2468",
    traceId: "assessment-snapshot-unit",
    deps: {
      response: (_event, statusCode, body) => ({ statusCode, body }),
      log: () => {},
      getAssessmentResult: async (shopperId) => {
        assert.strictEqual(shopperId, "2468", "snapshot should read assessment by canonical shopper id");
        return storedAssessment;
      },
      getAssessmentSnapshot: async (shopperId, options) => {
        resolverInput = { shopperId, options };
        return {
          statusCode: 200,
          body: {
            ok: true,
            shopperId,
            exists: Boolean(options?.assessment),
            shopperState: options?.assessment ? "ASSESSED" : "NEW",
            assessment: options?.assessment || null,
          },
        };
      },
    },
  });

  assert.strictEqual(result.statusCode, 200, "assessment snapshot should resolve successfully");
  assert.strictEqual(result.body.shopperState, "ASSESSED", "stored assessment should select the completed path");
  assert.deepStrictEqual(resolverInput?.options?.assessment, storedAssessment, "profile resolver should receive Dynamo assessment state");
}

async function testIdentityCheckInReturnsSummaryAndMissesSafely() {
  resetStores();
  resetModules();

  profileStore.set("shopper#8862", {
    profileId: "shopper#8862",
    shopperId: "8862",
    snoozeCode: "8862",
    accessCode: "8862",
    leadStage: "assessment_completed",
    canonicalRecommendation: {
      manifestVersion: "showroom-manifest.v1",
      topPodId: "4",
      topPodIds: ["4"],
      primaryMattressHandle: "12-all-foam-mattress",
      baseHandle: null,
      motionKey: "none",
      reasonKeys: ["cooling"],
    },
  });
  rewardsStore.set("8862", {
    shopperId: "8862",
    balance: 175,
    updatedAt: "2026-06-10T00:00:00.000Z",
    history: [],
  });

  const found = unwrapData(
    await invokeLambda("POST", "/identity/check-in", {
      snoozeCode: "8862",
      sourceSurface: "shopify_header",
    })
  );
  assert.strictEqual(found.ok, true, "valid Snooze Code should resolve");
  assert.strictEqual(found.shopperId, "8862", "check-in should return canonical shopper id");
  assert.strictEqual(found.rewardsSummary?.balance, 175, "rewards summary should be included when available");

  const miss = unwrapData(
    await invokeLambda("POST", "/identity/check-in", {
      snoozeCode: "999999",
      sourceSurface: "shopify_header",
    })
  );
  assert.strictEqual(miss.ok, false, "unknown Snooze Code should not create a profile");
  assert.strictEqual(miss.code, "SNOOZE_CODE_NOT_FOUND", "unknown code should be explicit");
}

async function testDevelopmentWelcomeCheckInCreatesCanonicalFourDigitProfile() {
  resetStores();
  resetModules();

  const first = unwrapData(
    await invokeLambda("POST", "/identity/check-in", {
      snoozeCode: "4321",
      sessionId: "welcome-device-4321",
      sourceSurface: "showroom_welcome",
    })
  );

  assert.strictEqual(first.ok, true, "Welcome development check-in should accept a new four-digit code");
  assert.strictEqual(first.shopperId, "4321", "four-digit code should remain the canonical shopper id");
  assert.strictEqual(first.snoozeCode, "4321", "four-digit code should remain the Snooze Code");
  assert.strictEqual(first.profileId, "shopper#4321", "new Welcome shopper should use the canonical profile key");

  const profile = profileStore.get("shopper#4321");
  assert(profile, "new Welcome shopper should create one canonical profile");
  assert.strictEqual(profile.shopperId, "4321", "canonical profile should retain the entered code");
  assert.strictEqual(profile.sourceSurface, "showroom_welcome", "showroom source metadata should be preserved");
  assert.strictEqual(zohoSyncCalls.length, 1, "new canonical Welcome profile should follow the existing Zoho sync path");
  assert.strictEqual(zohoSyncCalls[0]?.shopperId, "4321", "Zoho sync should use the canonical shopper id");

  const second = unwrapData(
    await invokeLambda("POST", "/identity/check-in", {
      snoozeCode: "4321",
      sessionId: "welcome-device-4321-return",
      sourceSurface: "showroom_welcome",
    })
  );

  assert.strictEqual(second.ok, true, "repeat Welcome check-in should load the existing profile");
  assert.strictEqual(
    [...profileStore.keys()].filter((key) => key === "shopper#4321").length,
    1,
    "repeat check-in should not create a competing canonical profile"
  );
  assert.strictEqual(zohoSyncCalls.length, 1, "returning check-in should not create another Zoho contact");
}

async function testDevelopmentWelcomeAllowanceStaysNarrow() {
  resetStores();
  resetModules();

  const wrongSurface = unwrapData(
    await invokeLambda("POST", "/identity/check-in", {
      snoozeCode: "5678",
      sourceSurface: "shopify_header",
    })
  );
  assert.strictEqual(wrongSurface.ok, false, "unknown four-digit codes should remain restricted outside Welcome");

  const sixDigit = unwrapData(
    await invokeLambda("POST", "/identity/check-in", {
      snoozeCode: "654321",
      sourceSurface: "showroom_welcome",
    })
  );
  assert.strictEqual(sixDigit.ok, false, "unknown six-digit production codes should not be auto-created");
  assert.strictEqual(profileStore.has("shopper#5678"), false, "restricted four-digit miss should not create a profile");
  assert.strictEqual(profileStore.has("shopper#654321"), false, "six-digit miss should not create a profile");
}

async function testHudWithSnoozeCodeEnrichesCanonicalProfile() {
  resetStores();
  resetModules();

  profileStore.set("shopper#8862", {
    profileId: "shopper#8862",
    shopperId: "8862",
    snoozeCode: "8862",
    accessCode: "8862",
  });

  const payload = await invokeLambda("POST", "/hud/ask", {
    snoozeCode: "8862",
    query: "Which mattress fits me?",
    path: "/pages/snooze-assessment",
    page_type: "page",
    surface: "shopify_header",
    context: {
      assessment: {
        size: "Queen",
        motionMode: "No Motion",
        firmness: "Soft",
        sleepPosition: "Side",
        sleepPartner: "No",
        baseType: "No Base",
      },
    },
  });

  assert.strictEqual(payload.meta?.snooze_code_present, true, "HUD meta should show Snooze Code identity");
  assert.strictEqual(payload.meta?.profile_id, "shopper#8862", "HUD should point to canonical profile");
  assert(profileStore.get("shopper#8862"), "canonical HUD profile should remain canonical");
}

async function testHudWithoutSnoozeCodeUsesTemporarySessionProfile() {
  resetStores();
  resetModules();

  const payload = await invokeLambda("POST", "/hud/ask", {
    query: "Which mattress fits me?",
    path: "/pages/snooze-assessment",
    page_type: "page",
    surface: "shopify_header",
    context: {
      assessment: {
        size: "Queen",
        motionMode: "No Motion",
        firmness: "Soft",
        sleepPosition: "Side",
        sleepPartner: "No",
        baseType: "No Base",
      },
    },
  });

  const threadId = String(payload.thread_id || "");
  assert(threadId, "HUD should still create a thread id");
  assert(profileStore.get(`session#${threadId}`), "HUD without code should use session-backed profile");
  const shopperKeys = [...profileStore.keys()].filter((key) => key.startsWith("shopper#"));
  assert.strictEqual(shopperKeys.length, 0, "HUD should not issue a new Snooze Code for generic browsing");
}

async function testAskSnoozerWithLegacyCodeTreatsItAsCanonical() {
  resetStores();
  resetModules();

  const payload = await invokeLambda("POST", "/ask-snoozer", {
    shopperId: "8862",
    message: "What do you recommend?",
    sessionId: "ask-legacy-8862",
    context: {
      assessment: {
        size: "Queen",
        motionMode: "No Motion",
        firmness: "Soft",
        sleepPosition: "Side",
        sleepPartner: "No",
        baseType: "No Base",
      },
    },
  });

  assert.strictEqual(payload.ok, true, "Ask Snoozer should still succeed");
  assert.strictEqual(payload.context?.shopperId, "8862", "Ask Snoozer should stamp canonical shopper id");
  assert(profileStore.get("shopper#8862"), "Ask Snoozer should enrich canonical profile");
}

async function testRewardsBalanceUsesCanonicalLegacyCode() {
  resetStores();
  resetModules();

  rewardsStore.set("8862", {
    shopperId: "8862",
    balance: 90,
    updatedAt: "2026-06-10T00:00:00.000Z",
    history: [],
  });

  const payload = unwrapData(
    await invokeLambda("GET", "/rewards/balance/8862")
  );

  assert.strictEqual(payload.context?.shopperId, "8862", "rewards should keep legacy code canonical");
  assert.strictEqual(payload.context?.rewards?.balance, 90, "rewards balance should resolve under canonical code");
}

async function main() {
  process.env.ASSESSMENT_TABLE = "assessment_results_test";
  process.env.CUSTOMER_PROFILE_TABLE = "customer_profiles_test";
  process.env.REWARDS_TABLE = "rewards_balances_test";

  patchDynamo();
  patchShopify();
  patchZohoSync();

  const allTests = [
    ["assessment_with_generated_shopify_id_issues_snooze_code", testAssessmentWithGeneratedShopifyIdIssuesSnoozeCode],
    ["assessment_with_existing_access_code_saves_under_canonical_profile", testAssessmentWithExistingAccessCodeSavesUnderCanonicalProfile],
    ["assessment_snapshot_passes_stored_assessment_to_profile_resolver", testAssessmentSnapshotPassesStoredAssessmentToProfileResolver],
    ["identity_checkin_returns_summary_and_misses_safely", testIdentityCheckInReturnsSummaryAndMissesSafely],
    ["development_welcome_checkin_creates_canonical_four_digit_profile", testDevelopmentWelcomeCheckInCreatesCanonicalFourDigitProfile],
    ["development_welcome_allowance_stays_narrow", testDevelopmentWelcomeAllowanceStaysNarrow],
    ["hud_with_snooze_code_enriches_canonical_profile", testHudWithSnoozeCodeEnrichesCanonicalProfile],
    ["hud_without_snooze_code_uses_temporary_session_profile", testHudWithoutSnoozeCodeUsesTemporarySessionProfile],
    ["ask_snoozer_with_legacy_code_treats_it_as_canonical", testAskSnoozerWithLegacyCodeTreatsItAsCanonical],
    ["rewards_balance_uses_canonical_legacy_code", testRewardsBalanceUsesCanonicalLegacyCode],
  ];
  const welcomeDeviceTests = new Set([
    "assessment_with_existing_access_code_saves_under_canonical_profile",
    "assessment_snapshot_passes_stored_assessment_to_profile_resolver",
    "identity_checkin_returns_summary_and_misses_safely",
    "development_welcome_checkin_creates_canonical_four_digit_profile",
    "development_welcome_allowance_stays_narrow",
  ]);
  const tests = process.env.WELCOME_DEVICE_ONLY === "1"
    ? allTests.filter(([name]) => welcomeDeviceTests.has(name))
    : allTests;

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
    restoreZohoSync();
    restoreShopify();
    restoreDynamo();
    resetModules();
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s) detected.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${tests.length} Snooze Code route tests passed.`);
}

main().catch((error) => {
  restoreZohoSync();
  restoreShopify();
  restoreDynamo();
  resetModules();
  console.error(error);
  process.exit(1);
});
