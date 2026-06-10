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
const customerProfileZohoSync = require("../services/customerProfileZohoSync");
const shopifySvc = require("../services/shopify");
const openai = require("../services/openai");
const { resolveRecommendation } = require("../services/recommendationResolver");

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
  clearModule("../services/bookingSession");
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
        contactId: "zoho-local-test",
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
      host: "local.booking-webhook.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: method.toUpperCase(),
        path,
        sourceIp: "127.0.0.1",
        userAgent: "booking-webhook-route-test",
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
    source: "booking_route_test",
  });

  return {
    manifestVersion: resolved.manifestVersion,
    normalizedAssessment: resolved.normalizedAssessment,
    ...resolved.recommendation,
  };
}

async function testWebhookRouteSupportsAskAndHudSessionPrep() {
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
  const shopperId = "589424";

  profileStore.set(
    `shopper#${shopperId}`,
    customerProfile.buildCustomerProfilePatch({
      shopperId,
      snoozeCode: shopperId,
      accessCode: shopperId,
      profileId: `shopper#${shopperId}`,
      identityType: "snooze_code",
      identitySource: "test_seed",
      assessmentAnswers: assessment,
      canonicalRecommendation,
      leadStage: "assessment_completed",
    })
  );

  const webhookBody = await invokeLambda("POST", "/booking/calendly-webhook", {
    event: "invitee.created",
    payload: {
      invitee: {
        uri: "https://api.calendly.com/invitees/route-existing-1",
        email: "route@example.com",
        name: "Route Existing",
        timezone: "America/New_York",
      },
      scheduled_event: {
        uri: "https://api.calendly.com/scheduled_events/route-existing-1",
        start_time: "2026-06-22T15:00:00Z",
        end_time: "2026-06-22T15:30:00Z",
        location: { type: "in_person", location: "Charlotte showroom" },
      },
      tracking: {
        utm_content: shopperId,
      },
    },
  });

  assert.strictEqual(webhookBody.ok, true, "booking webhook route should succeed");
  assert.strictEqual(webhookBody.shopperId, shopperId);
  assert.strictEqual(webhookBody.bookingStatus, "scheduled");
  assert.strictEqual(webhookBody.sessionPrepStatus, "ready");

  const storedProfile = profileStore.get(`shopper#${shopperId}`);
  assert(storedProfile, "webhook should persist the canonical profile");
  assert.strictEqual(storedProfile.bookingStatus, "scheduled");
  assert.strictEqual(storedProfile.sessionPrepStatus, "ready");
  assert(storedProfile.sessionPrep, "session prep should be stored on profile");

  const askBody = await invokeLambda("POST", "/ask-snoozer", {
    message: "Where should I start?",
    sessionId: "booking-route-ask-1",
    snoozeCode: shopperId,
  });

  assert.strictEqual(askBody.ok, true, "Ask Snoozer should still succeed");
  assert.strictEqual(openAiCalls.length, 0, "session prep answer should not call OpenAI");
  assert(
    /Start with SnoozePod/i.test(String(askBody.reply || "")),
    "Ask Snoozer should answer from stored session prep"
  );
  assert.strictEqual(
    askBody.context?.sessionPrep?.status,
    "ready",
    "Ask Snoozer should return stored session prep in context"
  );

  const hudBody = await invokeLambda("POST", "/hud/ask", {
    query: "What should I try first?",
    path: "/pages/booking-a-snooze-session",
    page_type: "page",
    snoozeCode: shopperId,
  });

  assert.strictEqual(hudBody.status, "ok", "HUD should still respond");
  assert(
    /Start with SnoozePod/i.test(String(hudBody.reply || "")),
    "HUD should answer from stored session prep"
  );
}

async function testAliasWebhookRouteIssuesCanonicalCodeFromTemporaryShopperId() {
  resetStores();
  resetModules();

  const tempShopperId = "shopify-assessment-456";
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

  profileStore.set(
    `shopper#${tempShopperId}`,
    customerProfile.buildCustomerProfilePatch({
      shopperId: tempShopperId,
      profileId: `shopper#${tempShopperId}`,
      identityType: "temporary",
      identitySource: "shopify_assessment",
      sourceShopperId: tempShopperId,
      assessmentAnswers: assessment,
      canonicalRecommendation,
      leadStage: "assessment_completed",
    })
  );

  const webhookBody = await invokeLambda("POST", "/calendly/webhook", {
    event: "invitee.created",
    payload: {
      shopperId: tempShopperId,
      invitee: {
        uri: "https://api.calendly.com/invitees/route-temp-1",
        email: "temp-route@example.com",
        name: "Route Temp",
      },
      scheduled_event: {
        uri: "https://api.calendly.com/scheduled_events/route-temp-1",
        start_time: "2026-06-23T17:00:00Z",
        end_time: "2026-06-23T17:30:00Z",
      },
    },
  });

  assert.strictEqual(webhookBody.ok, true, "alias webhook route should succeed");
  assert.match(String(webhookBody.snoozeCode || ""), /^\d{6}$/, "route should issue a 6-digit Snooze Code");
  assert.strictEqual(webhookBody.bookingStatus, "scheduled");
  assert.strictEqual(
    webhookBody.sessionPrepStatus,
    "ready",
    "temporary assessment data should carry forward into ready session prep"
  );

  const canonicalProfileId = `shopper#${webhookBody.snoozeCode}`;
  const canonicalProfile = profileStore.get(canonicalProfileId);
  assert(canonicalProfile, "canonical booking profile should be stored");
  assert.strictEqual(canonicalProfile.shopperId, webhookBody.snoozeCode);
  assert.strictEqual(canonicalProfile.sessionPrepStatus, "ready");

  const mergedTempProfile = profileStore.get(`shopper#${tempShopperId}`);
  assert(
    mergedTempProfile && mergedTempProfile.mergedIntoShopperId === webhookBody.snoozeCode,
    "temporary shopper profile should be marked as merged"
  );
}

async function main() {
  process.env.CUSTOMER_PROFILE_TABLE = "customer_profiles_test";
  process.env.ASSESSMENT_TABLE = "assessment_results_test";
  process.env.SESSIONS_TABLE = "snoozer_sessions_test";

  patchDynamo();
  patchShopify();
  patchOpenAi();
  patchZohoSync();

  try {
    await testWebhookRouteSupportsAskAndHudSessionPrep();
    await testAliasWebhookRouteIssuesCanonicalCodeFromTemporaryShopperId();
    console.log("All booking webhook route tests passed.");
  } finally {
    restoreDynamo();
    restoreShopify();
    restoreOpenAi();
    restoreZohoSync();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
