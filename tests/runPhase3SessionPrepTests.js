#!/usr/bin/env node

const assert = require("assert");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const manifest = require("../data/showroom-manifest.v1.json");
const bookingSession = require("../services/bookingSession");
const customerProfile = require("../services/customerProfile");
const { resolveRecommendation } = require("../services/recommendationResolver");
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
        contactId: "zoho-phase3-sessionprep",
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
    const key = command.input?.Key || {};

    if (command instanceof GetCommand) {
      if (key.profileId) {
        return { Item: clone(profileStore.get(key.profileId) || null) };
      }
      if (key.sessionId) {
        return { Item: clone(sessionStore.get(key.sessionId) || null) };
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
      host: "local.phase3.sessionprep.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: method.toUpperCase(),
        path,
        sourceIp: "127.0.0.1",
        userAgent: "phase3-sessionprep-test",
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

async function buildCanonicalRecommendation(assessment) {
  const resolved = await resolveRecommendation({
    assessment,
    includeProducts: true,
    includePods: true,
    source: "phase3_sessionprep_test",
  });

  return {
    manifestVersion: resolved.manifestVersion,
    normalizedAssessment: resolved.normalizedAssessment,
    ...resolved.recommendation,
  };
}

function buildCanonicalProfile({
  shopperId = "1234",
  assessmentAnswers,
  canonicalRecommendation,
  sessionPrep,
  bookingStatus,
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
    bookingStatus,
    leadStage: bookingStatus ? "booked" : "assessment_completed",
  });
}

async function testBuildSessionPrepReadyContract() {
  resetStores();
  const assessment = {
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
    temperature: "Hot",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);

  const sessionPrep = bookingSession.buildSessionPrep(
    {
      shopperId: "1234",
      profileId: "shopper#1234",
      snoozeCode: "1234",
      assessmentAnswers: assessment,
      canonicalRecommendation,
    },
    {
      source: "booking_webhook",
      bookingStatus: "scheduled",
      shopperId: "1234",
      profileId: "shopper#1234",
      snoozeCode: "1234",
      bookingEventUri: "https://api.calendly.com/scheduled_events/phase3-ready-1",
      bookingInviteeUri: "https://api.calendly.com/invitees/phase3-ready-1",
      bookingStartTime: "2026-06-26T13:00:00Z",
      bookingEndTime: "2026-06-26T13:30:00Z",
    }
  );

  assert.strictEqual(sessionPrep.status, "ready");
  assert.strictEqual(sessionPrep.shopperId, "1234");
  assert.strictEqual(sessionPrep.profileId, "shopper#1234");
  assert.strictEqual(sessionPrep.snoozeCode, "1234");
  assert.strictEqual(sessionPrep.bookingStartTime, "2026-06-26T13:00:00Z");
  assert.strictEqual(sessionPrep.bookingEndTime, "2026-06-26T13:30:00Z");
  assert(sessionPrep.recommendedStartingPod, "session prep should include starting pod");
  assert(sessionPrep.startingMattressHandle, "session prep should include starting mattress handle");
  assert(Array.isArray(sessionPrep.podsToTry), "session prep should include pods to try");
  assert(Array.isArray(sessionPrep.sessionInstructions), "session prep should include session instructions");
  assert(Array.isArray(sessionPrep.openConcerns), "session prep should include open concerns");
  assert(sessionPrep.customerFitSummary, "session prep should include customer fit summary");
  assert(sessionPrep.generatedAt, "session prep should include generatedAt");
  assert(sessionPrep.updatedAt, "session prep should include updatedAt");
}

async function testCheckInReturnsStoredSessionPrep() {
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
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const sessionPrep = bookingSession.buildSessionPrep(
    {
      shopperId: "1234",
      profileId: "shopper#1234",
      snoozeCode: "1234",
      assessmentAnswers: assessment,
      canonicalRecommendation,
    },
    {
      source: "booking_webhook",
      bookingStatus: "scheduled",
      shopperId: "1234",
      profileId: "shopper#1234",
      snoozeCode: "1234",
      bookingStartTime: "2026-06-26T13:00:00Z",
      bookingEndTime: "2026-06-26T13:30:00Z",
    }
  );

  profileStore.set(
    "shopper#1234",
    buildCanonicalProfile({
      shopperId: "1234",
      assessmentAnswers: assessment,
      canonicalRecommendation,
      sessionPrep,
      bookingStatus: "scheduled",
    })
  );

  const payload = await invokeLambda("POST", "/identity/check-in", {
    snoozeCode: "1234",
    sourceSurface: "phase3_checkin",
  });

  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.sessionPrepStatus, "ready", "check-in should expose session prep status");
  assert.strictEqual(payload.sessionPrep?.status, "ready", "check-in should expose session prep");
  assert.strictEqual(
    payload.sessionPrep?.recommendedStartingPod,
    canonicalRecommendation.topPodId,
    "check-in should return the deterministic starting pod"
  );
}

async function testAskSnoozerUsesStoredSessionPrepWithoutOpenAi() {
  resetStores();
  resetModules();
  const assessment = {
    size: "King",
    motionMode: "Half Split Motion",
    firmness: "Medium",
    partnerFirmness: "Firm",
    sleepPosition: "Side",
    sleepPartner: "Yes",
    baseType: "Adjustable Base",
  };
  const canonicalRecommendation = await buildCanonicalRecommendation(assessment);
  const sessionPrep = bookingSession.buildSessionPrep(
    {
      shopperId: "1234",
      profileId: "shopper#1234",
      snoozeCode: "1234",
      assessmentAnswers: assessment,
      canonicalRecommendation,
    },
    {
      source: "booking_webhook",
      bookingStatus: "scheduled",
      shopperId: "1234",
      profileId: "shopper#1234",
      snoozeCode: "1234",
      bookingStartTime: "2026-06-27T13:00:00Z",
      bookingEndTime: "2026-06-27T13:30:00Z",
    }
  );

  profileStore.set(
    "shopper#1234",
    buildCanonicalProfile({
      shopperId: "1234",
      assessmentAnswers: assessment,
      canonicalRecommendation,
      sessionPrep,
      bookingStatus: "scheduled",
    })
  );

  const payload = await invokeLambda("POST", "/ask-snoozer", {
    snoozeCode: "1234",
    sessionId: "phase3-sessionprep-ask",
    message: "Which pod should I try first?",
  });

  assert.strictEqual(payload.ok, true);
  assert.strictEqual(openAiCalls.length, 0, "stored session prep should answer without OpenAI");
  assert.match(
    String(payload.reply || ""),
    /Start with SnoozePod/i,
    "reply should come from deterministic session prep guidance"
  );
  assert.strictEqual(payload.context?.sessionPrep?.status, "ready");
}

async function testCanonicalFallbackStillWorksWhenSessionPrepMissing() {
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

  const payload = await invokeLambda("POST", "/ask-snoozer", {
    snoozeCode: "1234",
    sessionId: "phase3-sessionprep-fallback",
    message: "Which pod should I try first?",
    context: { assessment },
  });

  assert.strictEqual(payload.ok, true);
  assert.strictEqual(openAiCalls.length, 0, "canonical recommendation fallback should stay deterministic");
  assert.strictEqual(
    payload.context?.canonicalRecommendation?.topPodId,
    "4",
    "canonical fallback should still carry the top pod"
  );
}

async function main() {
  process.env.ASSESSMENT_TABLE = "assessment_results_test";
  process.env.CUSTOMER_PROFILE_TABLE = "customer_profiles_test";
  process.env.SESSIONS_TABLE = "snoozer_sessions_test";

  patchDynamo();
  patchShopify();
  patchOpenAi();
  patchZohoSync();

  const tests = [
    ["build_session_prep_ready_contract", testBuildSessionPrepReadyContract],
    ["checkin_returns_stored_session_prep", testCheckInReturnsStoredSessionPrep],
    ["ask_snoozer_uses_stored_session_prep_without_openai", testAskSnoozerUsesStoredSessionPrepWithoutOpenAi],
    ["canonical_fallback_still_works_when_session_prep_missing", testCanonicalFallbackStillWorksWhenSessionPrepMissing],
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

  console.log(`\nAll ${tests.length} Phase 3 session prep tests passed.`);
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
