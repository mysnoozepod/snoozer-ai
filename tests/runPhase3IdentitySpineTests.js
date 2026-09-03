#!/usr/bin/env node

const assert = require("assert");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const manifest = require("../data/showroom-manifest.v1.json");
const customerProfile = require("../services/customerProfile");
const shopifySvc = require("../services/shopify");
const openai = require("../services/openai");
const customerProfileZohoSync = require("../services/customerProfileZohoSync");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalFetchProductsByHandles = shopifySvc.fetchProductsByHandles;
const originalOpenAiGetSnoozerResponse = openai.getSnoozerResponse;
const originalSyncCustomerProfileToZoho =
  customerProfileZohoSync.syncCustomerProfileToZoho;

const profileStore = new Map();
const resultsStore = new Map();
const sessionStore = new Map();
const rewardsStore = new Map();
const openAiCalls = [];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function resetModules() {
  clearModule("../index");
}

function resetStores() {
  profileStore.clear();
  resultsStore.clear();
  sessionStore.clear();
  rewardsStore.clear();
  openAiCalls.length = 0;
}

function restoreDynamo() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
}

function restoreShopify() {
  shopifySvc.fetchProductsByHandles = originalFetchProductsByHandles;
}

function restoreOpenAi() {
  openai.getSnoozerResponse = originalOpenAiGetSnoozerResponse;
}

function restoreZohoSync() {
  customerProfileZohoSync.syncCustomerProfileToZoho =
    originalSyncCustomerProfileToZoho;
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
    firstAvailableVariantId: `gid://shopify/ProductVariant/${product.handle}-queen`,
    priceRange: {
      min: 1000,
      currencyCode: "USD",
    },
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

function patchOpenAi() {
  openai.getSnoozerResponse = async function mockedGetSnoozerResponse(message) {
    openAiCalls.push(String(message || ""));
    return {
      reply: `mocked fallback: ${message}`,
      text: `mocked fallback: ${message}`,
      model: "mock-openai",
      meta: { path: "mock_openai", retrievalMs: 0 },
      actions: [],
    };
  };
}

function patchZohoSync() {
  customerProfileZohoSync.syncCustomerProfileToZoho =
    async function mockedSyncCustomerProfileToZoho(profile = {}) {
      return {
        ok: true,
        skipped: false,
        operation: "update",
        shopperId: profile.shopperId || null,
        contactId: "zoho-phase3-test",
      };
    };
}

function applyProfileUpdate(profileId, input) {
  const existing = clone(profileStore.get(profileId) || { profileId });
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

function applySessionUpdate(sessionId, input) {
  const existing = clone(sessionStore.get(sessionId) || { sessionId, context: {} });
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};

  if (Object.prototype.hasOwnProperty.call(values, ":c")) {
    existing.context = clone(values[":c"]);
  }
  if (Object.prototype.hasOwnProperty.call(values, ":u")) {
    existing.updatedAt = values[":u"];
    existing.lastActiveAt = values[":u"];
  }
  if (names["#ttl"] && Object.prototype.hasOwnProperty.call(values, ":t")) {
    existing[names["#ttl"]] = values[":t"];
  }

  sessionStore.set(sessionId, existing);
  return existing;
}

function patchDynamo() {
  DynamoDBDocumentClient.prototype.send = async function send(command) {
    const tableName = String(command.input?.TableName || "");
    const key = command.input?.Key || {};

    if (command instanceof GetCommand) {
      if (key.profileId) {
        return { Item: clone(profileStore.get(key.profileId) || null) };
      }
      if (key.sessionId) {
        return { Item: clone(sessionStore.get(key.sessionId) || null) };
      }
      if (key.shopperId && /rewards/i.test(tableName)) {
        return { Item: clone(rewardsStore.get(key.shopperId) || null) };
      }
      if (key.shopperId) {
        return { Item: clone(resultsStore.get(key.shopperId) || null) };
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
        applySessionUpdate(key.sessionId, command.input);
        return {};
      }
      return {};
    }

    return {};
  };
}

function buildEvent(method, path, body) {
  return {
    version: "2.0",
    routeKey: `${method.toUpperCase()} ${path}`,
    rawPath: path,
    path,
    headers: {
      "content-type": "application/json",
      host: "local.phase3.identity.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: method.toUpperCase(),
        path,
        sourceIp: "127.0.0.1",
        userAgent: "phase3-identity-spine-test",
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
  return unwrapData(parseBody(await lambdaHandler(buildEvent(method, path, body))));
}

function buildCanonicalProfile({
  shopperId = "1234",
  assessmentAnswers,
  canonicalRecommendation,
  sessionPrep,
} = {}) {
  return customerProfile.buildCustomerProfilePatch({
    shopperId,
    snoozeCode: shopperId,
    accessCode: shopperId,
    profileId: `shopper#${shopperId}`,
    identityType: "snooze_code",
    identitySource: "test_seed",
    assessmentAnswers,
    canonicalRecommendation,
    sessionPrep,
    sessionPrepStatus: sessionPrep?.status,
    leadStage: "assessment_completed",
    bookingStatus: sessionPrep ? "scheduled" : undefined,
  });
}

async function testKnownCode1234ResolvesToCanonicalProfile() {
  resetStores();
  resetModules();

  const assessment = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
    temperature: "Hot",
  };

  profileStore.set(
    "shopper#1234",
    buildCanonicalProfile({
      shopperId: "1234",
      assessmentAnswers: assessment,
      canonicalRecommendation: {
        manifestVersion: "showroom-manifest.v1",
        normalizedAssessment: { motionKey: "none", motionLabel: "No Motion" },
        topPodId: "4",
        topPodIds: ["4"],
        primaryMattressHandle: "12-all-foam-mattress",
        baseHandle: null,
        motionKey: "none",
        motionLabel: "No Motion",
        reasonKeys: ["cooling"],
      },
    })
  );

  const payload = await invokeLambda("POST", "/identity/check-in", {
    snoozeCode: "1234",
    sourceSurface: "phase3_checkin",
  });

  assert.strictEqual(payload.ok, true, "known Snooze Code should resolve");
  assert.strictEqual(payload.shopperId, "1234", "shopperId should stay canonical");
  assert.strictEqual(payload.profileId, "shopper#1234", "profileId should stay canonical");
}

async function testAskSnoozerCarriesCanonicalIdentityForShopper1234() {
  resetStores();
  resetModules();

  const assessment = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
    temperature: "Hot",
  };

  resultsStore.set("1234", {
    shopperId: "1234",
    answers: clone(assessment),
    recommendations: [],
    createdAt: "2026-06-23T00:00:00.000Z",
  });

  profileStore.set(
    "shopper#1234",
    buildCanonicalProfile({
      shopperId: "1234",
      assessmentAnswers: assessment,
      canonicalRecommendation: {
        manifestVersion: "showroom-manifest.v1",
        normalizedAssessment: { motionKey: "none", motionLabel: "No Motion" },
        topPodId: "4",
        topPodIds: ["4"],
        primaryMattressHandle: "12-all-foam-mattress",
        baseHandle: null,
        motionKey: "none",
        motionLabel: "No Motion",
        reasonKeys: ["cooling", "pressure_relief"],
      },
    })
  );

  const payload = await invokeLambda("POST", "/ask-snoozer", {
    snoozeCode: "1234",
    sessionId: "phase3-ask-1234",
    message: "What do you recommend?",
    context: { assessment },
  });

  assert.strictEqual(payload.ok, true, "Ask Snoozer should succeed");
  assert.strictEqual(payload.context?.shopperId, "1234", "Ask Snoozer should use canonical shopper id");
  assert.strictEqual(payload.context?.profileId, "shopper#1234", "Ask Snoozer should retain the canonical profile id");
  assert.strictEqual(payload.context?.sessionId, "phase3-ask-1234", "Ask Snoozer should retain the visit session id");
  assert.strictEqual(openAiCalls.length, 0, "grounded recommendation should not need OpenAI");
}

async function testTemporaryAliasesAndRepeatedCallsDoNotCreateCompetingCanonicalProfiles() {
  resetStores();
  resetModules();

  const assessment = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
    temperature: "Hot",
  };

  const assessmentBody = await invokeLambda("POST", "/assessment", {
    shopperId: "shopify-assessment-phase3-temp-1234",
    accessCode: "1234",
    origin: "shopify_assessment_page",
    answers: assessment,
  });

  assert.strictEqual(assessmentBody.ok, true, "assessment should succeed");
  assert.strictEqual(assessmentBody.shopperId, "1234", "existing code should win");

  const firstAsk = await invokeLambda("POST", "/ask-snoozer", {
    snoozeCode: "1234",
    sessionId: "phase3-repeat-1",
    message: "What do you recommend?",
    context: { assessment },
  });
  const secondAsk = await invokeLambda("POST", "/ask-snoozer", {
    snoozeCode: "1234",
    sessionId: "phase3-repeat-2",
    message: "Explain my results.",
    context: { assessment },
  });

  const canonicalShopperKeys = [...profileStore.keys()].filter((key) => key === "shopper#1234");
  assert.deepStrictEqual(
    canonicalShopperKeys,
    ["shopper#1234"],
    "repeated calls should keep one canonical shopper profile"
  );
  assert(
    profileStore.get("alias#shopper:shopify-assessment-phase3-temp-1234"),
    "temporary Shopify assessment id should become an alias, not a competing shopper profile"
  );
  assert.strictEqual(firstAsk.context?.shopperId, "1234", "first Ask session should use the canonical shopper");
  assert.strictEqual(secondAsk.context?.shopperId, "1234", "second Ask session should use the canonical shopper");
  assert.strictEqual(firstAsk.context?.profileId, "shopper#1234", "first Ask session should use the canonical profile");
  assert.strictEqual(secondAsk.context?.profileId, "shopper#1234", "second Ask session should use the canonical profile");

  const shopperKeys = [...profileStore.keys()].filter((key) => key.startsWith("shopper#"));
  assert.deepStrictEqual(
    shopperKeys,
    ["shopper#1234"],
    "no competing shopper records should be created for the same Snooze Code"
  );
}

async function main() {
  process.env.ASSESSMENT_TABLE = "assessment_results_test";
  process.env.CUSTOMER_PROFILE_TABLE = "customer_profiles_test";
  process.env.SESSIONS_TABLE = "snoozer_sessions_test";
  process.env.REWARDS_TABLE = "rewards_balances_test";

  patchDynamo();
  patchShopify();
  patchOpenAi();
  patchZohoSync();

  const tests = [
    ["known_code_1234_resolves_to_canonical_profile", testKnownCode1234ResolvesToCanonicalProfile],
    ["ask_snoozer_carries_canonical_identity_for_shopper_1234", testAskSnoozerCarriesCanonicalIdentityForShopper1234],
    ["temporary_aliases_and_repeated_calls_do_not_create_competing_canonical_profiles", testTemporaryAliasesAndRepeatedCallsDoNotCreateCompetingCanonicalProfiles],
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
    restoreShopify();
    restoreOpenAi();
    restoreZohoSync();
    resetModules();
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s) detected.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${tests.length} Phase 3 identity spine tests passed.`);
}

main().catch((error) => {
  restoreDynamo();
  restoreShopify();
  restoreOpenAi();
  restoreZohoSync();
  resetModules();
  console.error(error);
  process.exit(1);
});
