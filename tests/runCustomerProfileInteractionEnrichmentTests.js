#!/usr/bin/env node

const assert = require("assert");
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const manifest = require("../data/showroom-manifest.v1.json");
const customerProfile = require("../services/customerProfile");
const { resolveRecommendation } = require("../services/recommendationResolver");
const shopifySvc = require("../services/shopify");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalFetchProductsByHandles = shopifySvc.fetchProductsByHandles;

function restoreDynamo() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function resetIndexAndServices() {
  clearModule("../index");
  clearModule("../services/customerProfile");
  clearModule("../services/customerProfileZohoSync");
}

function buildEvent(path, body) {
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    headers: {
      "content-type": "application/json",
      host: "local.customer-profile.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path,
        sourceIp: "127.0.0.1",
        userAgent: "customer-profile-interaction-test",
      },
      requestId: `${path}-${Date.now()}`,
      routeKey: `POST ${path}`,
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function parseBody(response) {
  assert.strictEqual(response.statusCode, 200, "expected HTTP 200");
  return JSON.parse(response.body);
}

function buildProductItem(product) {
  const sizeOptions = ["Twin", "Full", "Queen", "King"];
  const variants = sizeOptions.map(function mapSize(size) {
    return {
      id: `gid://shopify/ProductVariant/${product.handle}-${size.toLowerCase()}`,
      available: true,
      title: size,
      price: 1000,
      currencyCode: "USD",
      selectedOptions: [{ name: "Size", value: size }],
    };
  });

  return {
    id: `gid://shopify/Product/${product.handle}`,
    handle: product.handle,
    title: product.title,
    variants,
    firstAvailableVariantId: variants[0].id,
    priceRange: {
      min: 1000,
      currencyCode: "USD",
    },
  };
}

function patchShopify() {
  const productMap = new Map(manifest.products.map((product) => [product.handle, product]));
  shopifySvc.fetchProductsByHandles = async function mockedFetchProductsByHandles({ handles = [] } = {}) {
    const items = handles
      .map((handle) => productMap.get(String(handle || "").trim()))
      .filter(Boolean)
      .map(buildProductItem);
    return { items };
  };
}

function restoreShopify() {
  shopifySvc.fetchProductsByHandles = originalFetchProductsByHandles;
}

function patchDynamo({ assessmentByShopperId = {} } = {}) {
  const sessionStore = new Map();
  const assessmentStore = new Map(Object.entries(assessmentByShopperId));

  DynamoDBDocumentClient.prototype.send = async function send(command) {
    if (command instanceof GetCommand) {
      if (command.input?.Key?.sessionId) {
        return { Item: sessionStore.get(command.input.Key.sessionId) || null };
      }
      if (command.input?.Key?.shopperId) {
        return { Item: assessmentStore.get(command.input.Key.shopperId) || null };
      }
      if (command.input?.Key?.profileId) {
        return { Item: null };
      }
      return { Item: null };
    }

    if (command instanceof PutCommand) {
      if (command.input?.Item?.sessionId) {
        sessionStore.set(command.input.Item.sessionId, command.input.Item);
      }
      return {};
    }

    if (command instanceof UpdateCommand) {
      return {};
    }

    return {};
  };
}

async function testHudProfilePatchIncludesIntentPathPageProductAndCanonicalFields() {
  const canonical = await resolveRecommendation({
    assessment: {
      size: "Queen",
      motionMode: "No Motion",
      firmness: "Soft",
      sleepPosition: "Side",
      sleepPartner: "No",
      baseType: "No Base",
      temperature: "Hot",
    },
    includeProducts: true,
    includePods: true,
  });

  const canonicalRecommendation = {
    manifestVersion: canonical.manifestVersion,
    normalizedAssessment: canonical.normalizedAssessment,
    ...canonical.recommendation,
  };

  const patch = customerProfile.buildHudProfilePatch({
    previousProfile: { leadStage: "assessment_completed" },
    shopperId: "shopper-hud-1",
    sessionId: "hud-session-1",
    threadId: "hud-session-1",
    sourceSurface: "shopify_header",
    lastIntent: "sleep_hot",
    lastIntentGroup: "product_fit",
    query: "Which mattress fits me if I sleep hot?",
    path: "/products/14-hybrid",
    pageType: "product",
    currentProductHandle: "14-hybrid",
    products: [{ handle: "12-all-foam-mattress" }, { handle: "14-hybrid" }],
    canonicalRecommendation,
    assessment: {
      size: "Queen",
      motionMode: "No Motion",
      firmness: "Soft",
      sleepPosition: "Side",
      sleepPartner: "No",
      baseType: "No Base",
    },
  });

  assert.strictEqual(patch.lastIntent, "sleep_hot", "HUD patch should include last intent");
  assert.strictEqual(patch.lastIntentGroup, "product_fit", "HUD patch should include last intent group");
  assert.strictEqual(patch.lastQuery, "Which mattress fits me if I sleep hot?", "HUD patch should include query");
  assert.strictEqual(patch.lastPath, "/products/14-hybrid", "HUD patch should include path");
  assert.strictEqual(patch.lastPageType, "product", "HUD patch should include page type");
  assert.strictEqual(patch.currentProductHandle, "14-hybrid", "HUD patch should include current product handle");
  assert.deepStrictEqual(
    patch.recommendedProductHandles,
    ["12-all-foam-mattress", "14-hybrid"],
    "HUD patch should include recommended product handles"
  );
  assert.strictEqual(patch.topPodId, canonical.recommendation.topPodId, "HUD patch should include canonical top pod");
  assert.strictEqual(
    patch.primaryMattressHandle,
    canonical.recommendation.primaryMattressHandle,
    "HUD patch should include canonical mattress handle"
  );
  assert.strictEqual(
    patch.leadStage,
    "assessment_completed",
    "HUD patch should not downgrade assessment-completed shoppers"
  );
}

async function testAskProfilePatchIncludesSessionMessageModeAndCanonicalFields() {
  const canonical = await resolveRecommendation({
    assessment: {
      size: "King",
      motionMode: "Half Split Motion",
      firmness: "Medium",
      sleepPosition: "Side",
      sleepPartner: "Yes",
      baseType: "Adjustable Base",
    },
    includeProducts: true,
    includePods: true,
  });

  const patch = customerProfile.buildAskSnoozerProfilePatch({
    previousProfile: { leadStage: "browsing" },
    shopperId: "shopper-ask-1",
    sessionId: "ask-session-1",
    threadId: "ask-session-1",
    mode: "showroom",
    sourceSurface: "showroom_app",
    lastIntent: "compare_mattresses",
    lastIntentGroup: "product_compare",
    message: "Compare mattresses for me",
    canonicalRecommendation: {
      manifestVersion: canonical.manifestVersion,
      normalizedAssessment: canonical.normalizedAssessment,
      ...canonical.recommendation,
    },
    context: {
      podId: "1",
      recommendedProductHandles: ["12-dual-comfort-hybrid", "premium-motion-adjustable-base"],
    },
  });

  assert.strictEqual(patch.sessionId, "ask-session-1", "Ask patch should include session id");
  assert.strictEqual(patch.mode, "showroom", "Ask patch should include mode");
  assert.strictEqual(patch.sourceSurface, "showroom_app", "Ask patch should include source surface");
  assert.strictEqual(patch.lastQuery, "Compare mattresses for me", "Ask patch should include message");
  assert.strictEqual(patch.lastIntent, "compare_mattresses", "Ask patch should include intent");
  assert.strictEqual(patch.lastIntentGroup, "product_compare", "Ask patch should include intent group");
  assert.strictEqual(patch.podId, "1", "Ask patch should include pod id");
  assert.deepStrictEqual(
    patch.recommendedProductHandles,
    ["12-dual-comfort-hybrid", "premium-motion-adjustable-base"],
    "Ask patch should include recommended product handles"
  );
  assert.strictEqual(
    patch.primaryMattressHandle,
    canonical.recommendation.primaryMattressHandle,
    "Ask patch should include canonical primary mattress handle"
  );
}

async function testLeadStageDoesNotDowngradeAssessmentCompletedToBrowsing() {
  const nextStage = customerProfile.resolveLeadStage("assessment_completed", "browsing");
  assert.strictEqual(
    nextStage,
    "assessment_completed",
    "lead stage resolution should never downgrade"
  );
}

async function testHudHighValueIntentWithShopperIdTriggersZohoSync() {
  const policy = customerProfile.shouldSyncProfileToZoho(
    {},
    customerProfile.buildHudProfilePatch({
      shopperId: "shopper-sync-1",
      sessionId: "hud-sync-1",
      threadId: "hud-sync-1",
      sourceSurface: "shopify_header",
      lastIntent: "sleep_hot",
      lastIntentGroup: "product_fit",
      query: "I sleep hot",
      products: [{ handle: "14-hybrid" }],
      canonicalRecommendation: {
        topPodId: "3",
        topPodIds: ["3"],
        primaryMattressHandle: "14-hybrid",
        baseHandle: "premium-motion-adjustable-base",
        motionKey: "standard",
        reasonKeys: ["cooling"],
        normalizedAssessment: { motionKey: "standard" },
      },
    }),
    { lastIntent: "sleep_hot", lastIntentGroup: "product_fit" }
  );

  assert.strictEqual(policy.shouldSync, true, "high-value HUD interaction should trigger Zoho sync");
}

async function testHudLowValueFallbackSkipsZoho() {
  const previousProfile = customerProfile.buildHudProfilePatch({
    shopperId: "shopper-sync-2",
    sessionId: "hud-sync-2",
    threadId: "hud-sync-2",
    sourceSurface: "shopify_header",
    lastIntent: "sleep_hot",
    lastIntentGroup: "product_fit",
    query: "I sleep hot",
    products: [{ handle: "14-hybrid" }],
    canonicalRecommendation: {
      topPodId: "3",
      topPodIds: ["3"],
      primaryMattressHandle: "14-hybrid",
      baseHandle: "premium-motion-adjustable-base",
      motionKey: "standard",
      reasonKeys: ["cooling"],
      normalizedAssessment: { motionKey: "standard" },
    },
  });

  const nextPatch = customerProfile.buildHudProfilePatch({
    previousProfile,
    shopperId: "shopper-sync-2",
    sessionId: "hud-sync-2",
    threadId: "hud-sync-2",
    sourceSurface: "shopify_header",
    lastIntent: "fallback",
    lastIntentGroup: "fallback_unclear",
    query: "Hello",
    products: [{ handle: "14-hybrid" }],
    canonicalRecommendation: {
      topPodId: "3",
      topPodIds: ["3"],
      primaryMattressHandle: "14-hybrid",
      baseHandle: "premium-motion-adjustable-base",
      motionKey: "standard",
      reasonKeys: ["cooling"],
      normalizedAssessment: { motionKey: "standard" },
    },
  });

  const policy = customerProfile.shouldSyncProfileToZoho(previousProfile, nextPatch, {
    lastIntent: "fallback",
    lastIntentGroup: "fallback_unclear",
  });

  assert.strictEqual(policy.shouldSync, false, "low-value fallback should not sync Zoho");
  assert(
    ["LOW_VALUE_INTENT", "NO_MATERIAL_ZOHO_CHANGE"].includes(policy.reason),
    "fallback skip should report a low-value or no-material reason"
  );
}

async function testAskHighValueCanonicalProfileChangeTriggersZohoSync() {
  const policy = customerProfile.shouldSyncProfileToZoho(
    {},
    customerProfile.buildAskSnoozerProfilePatch({
      shopperId: "shopper-sync-3",
      sessionId: "ask-sync-3",
      threadId: "ask-sync-3",
      sourceSurface: "ask_snoozer",
      lastIntent: "compare_mattresses",
      lastIntentGroup: "product_compare",
      message: "Compare mattresses",
      recommendedProductHandles: ["12-all-foam-mattress", "14-hybrid"],
      canonicalRecommendation: {
        topPodId: "4",
        topPodIds: ["4"],
        primaryMattressHandle: "12-all-foam-mattress",
        baseHandle: null,
        motionKey: "none",
        reasonKeys: ["pressure_relief"],
        normalizedAssessment: { motionKey: "none" },
      },
    }),
    { lastIntent: "compare_mattresses", lastIntentGroup: "product_compare" }
  );

  assert.strictEqual(policy.shouldSync, true, "high-value Ask interaction should trigger Zoho sync");
}

async function testSessionOnlyProfileSkipsZoho() {
  const policy = customerProfile.shouldSyncProfileToZoho(
    {},
    customerProfile.buildAskSnoozerProfilePatch({
      sessionId: "ask-sync-4",
      threadId: "ask-sync-4",
      sourceSurface: "ask_snoozer",
      lastIntent: "compare_mattresses",
      lastIntentGroup: "product_compare",
      message: "Compare mattresses",
      canonicalRecommendation: {
        topPodId: "4",
        topPodIds: ["4"],
        primaryMattressHandle: "12-all-foam-mattress",
        baseHandle: null,
        motionKey: "none",
        reasonKeys: ["pressure_relief"],
        normalizedAssessment: { motionKey: "none" },
      },
    }),
    { lastIntent: "compare_mattresses", lastIntentGroup: "product_compare" }
  );

  assert.strictEqual(policy.shouldSync, false, "session-only profiles should not sync to Zoho");
  assert(
    ["SESSION_ONLY_PROFILE", "NO_SHOPPER_ID"].includes(policy.reason),
    "session-only skip should explain why Zoho sync was not attempted"
  );
}

async function invokeHud(body) {
  const { lambdaHandler } = require("../index");
  return parseBody(await lambdaHandler(buildEvent("/hud/ask", body)));
}

async function invokeAsk(body) {
  const { lambdaHandler } = require("../index");
  return parseBody(await lambdaHandler(buildEvent("/ask-snoozer", body)));
}

async function testProfileUpsertFailureDoesNotBreakHudAsk() {
  resetIndexAndServices();
  patchShopify();
  patchDynamo();

  const customerProfileSvc = require("../services/customerProfile");
  const syncSvc = require("../services/customerProfileZohoSync");
  const originalGet = customerProfileSvc.getCustomerProfile;
  const originalUpsert = customerProfileSvc.upsertCustomerProfile;
  const originalSync = syncSvc.syncCustomerProfileToZoho;

  customerProfileSvc.getCustomerProfile = async function mockedGet() {
    return { ok: true, skipped: false, profile: null, profileId: null };
  };
  customerProfileSvc.upsertCustomerProfile = async function failingUpsert() {
    throw new Error("PROFILE_UPSERT_TEST_FAILURE");
  };
  syncSvc.syncCustomerProfileToZoho = async function skippedSync() {
    return { ok: false, skipped: true, reason: "SESSION_ONLY_PROFILE" };
  };

  try {
    const body = await invokeHud({
      query: "Which mattress fits me?",
      path: "/pages/snooze-assessment",
      page_type: "page",
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

    assert.strictEqual(body.status, "ok", "HUD should still succeed when profile upsert fails");
  } finally {
    customerProfileSvc.getCustomerProfile = originalGet;
    customerProfileSvc.upsertCustomerProfile = originalUpsert;
    syncSvc.syncCustomerProfileToZoho = originalSync;
    restoreShopify();
    restoreDynamo();
    resetIndexAndServices();
  }
}

async function testProfileUpsertFailureDoesNotBreakAskSnoozer() {
  resetIndexAndServices();
  patchDynamo();

  const customerProfileSvc = require("../services/customerProfile");
  const syncSvc = require("../services/customerProfileZohoSync");
  const originalGet = customerProfileSvc.getCustomerProfile;
  const originalUpsert = customerProfileSvc.upsertCustomerProfile;
  const originalSync = syncSvc.syncCustomerProfileToZoho;

  customerProfileSvc.getCustomerProfile = async function mockedGet() {
    return { ok: true, skipped: false, profile: null, profileId: null };
  };
  customerProfileSvc.upsertCustomerProfile = async function failingUpsert() {
    throw new Error("PROFILE_UPSERT_TEST_FAILURE");
  };
  syncSvc.syncCustomerProfileToZoho = async function skippedSync() {
    return { ok: false, skipped: true, reason: "SESSION_ONLY_PROFILE" };
  };

  try {
    const body = await invokeAsk({
      message: "What do you recommend?",
      sessionId: "ask-upsert-failure-1",
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

    assert.strictEqual(body.ok, true, "Ask Snoozer should still succeed when profile upsert fails");
  } finally {
    customerProfileSvc.getCustomerProfile = originalGet;
    customerProfileSvc.upsertCustomerProfile = originalUpsert;
    syncSvc.syncCustomerProfileToZoho = originalSync;
    restoreDynamo();
    resetIndexAndServices();
  }
}

async function testZohoSyncFailureDoesNotBreakHudAsk() {
  resetIndexAndServices();
  patchShopify();
  patchDynamo();

  const customerProfileSvc = require("../services/customerProfile");
  const syncSvc = require("../services/customerProfileZohoSync");
  const originalGet = customerProfileSvc.getCustomerProfile;
  const originalUpsert = customerProfileSvc.upsertCustomerProfile;
  const originalSync = syncSvc.syncCustomerProfileToZoho;

  customerProfileSvc.getCustomerProfile = async function mockedGet() {
    return { ok: true, skipped: false, profile: null, profileId: null };
  };
  customerProfileSvc.upsertCustomerProfile = async function mockedUpsert() {
    return { ok: true, skipped: false, profileId: "shopper#hud-sync-failure-1" };
  };
  syncSvc.syncCustomerProfileToZoho = async function failingSync() {
    throw new Error("ZOHO_SYNC_FAILURE_TEST");
  };

  try {
    const body = await invokeHud({
      shopperId: "hud-sync-failure-1",
      query: "Which mattress fits me?",
      path: "/pages/snooze-assessment",
      page_type: "page",
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

    assert.strictEqual(body.status, "ok", "HUD should still succeed when Zoho sync fails");
  } finally {
    customerProfileSvc.getCustomerProfile = originalGet;
    customerProfileSvc.upsertCustomerProfile = originalUpsert;
    syncSvc.syncCustomerProfileToZoho = originalSync;
    restoreShopify();
    restoreDynamo();
    resetIndexAndServices();
  }
}

async function testZohoSyncFailureDoesNotBreakAskSnoozer() {
  resetIndexAndServices();
  patchDynamo();

  const customerProfileSvc = require("../services/customerProfile");
  const syncSvc = require("../services/customerProfileZohoSync");
  const originalGet = customerProfileSvc.getCustomerProfile;
  const originalUpsert = customerProfileSvc.upsertCustomerProfile;
  const originalSync = syncSvc.syncCustomerProfileToZoho;

  customerProfileSvc.getCustomerProfile = async function mockedGet() {
    return { ok: true, skipped: false, profile: null, profileId: null };
  };
  customerProfileSvc.upsertCustomerProfile = async function mockedUpsert() {
    return { ok: true, skipped: false, profileId: "shopper#ask-sync-failure-1" };
  };
  syncSvc.syncCustomerProfileToZoho = async function failingSync() {
    throw new Error("ZOHO_SYNC_FAILURE_TEST");
  };

  try {
    const body = await invokeAsk({
      shopperId: "ask-sync-failure-1",
      message: "What do you recommend?",
      sessionId: "ask-sync-failure-session-1",
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

    assert.strictEqual(body.ok, true, "Ask Snoozer should still succeed when Zoho sync fails");
  } finally {
    customerProfileSvc.getCustomerProfile = originalGet;
    customerProfileSvc.upsertCustomerProfile = originalUpsert;
    syncSvc.syncCustomerProfileToZoho = originalSync;
    restoreDynamo();
    resetIndexAndServices();
  }
}

async function main() {
  const tests = [
    ["hud_profile_patch_includes_intent_path_page_product_and_canonical_fields", testHudProfilePatchIncludesIntentPathPageProductAndCanonicalFields],
    ["ask_profile_patch_includes_session_message_mode_and_canonical_fields", testAskProfilePatchIncludesSessionMessageModeAndCanonicalFields],
    ["lead_stage_does_not_downgrade_assessment_completed_to_browsing", testLeadStageDoesNotDowngradeAssessmentCompletedToBrowsing],
    ["hud_high_value_intent_with_shopper_id_triggers_zoho_sync", testHudHighValueIntentWithShopperIdTriggersZohoSync],
    ["hud_low_value_fallback_skips_zoho", testHudLowValueFallbackSkipsZoho],
    ["ask_high_value_canonical_profile_change_triggers_zoho_sync", testAskHighValueCanonicalProfileChangeTriggersZohoSync],
    ["session_only_profile_skips_zoho", testSessionOnlyProfileSkipsZoho],
    ["profile_upsert_failure_does_not_break_hud_ask", testProfileUpsertFailureDoesNotBreakHudAsk],
    ["profile_upsert_failure_does_not_break_ask_snoozer", testProfileUpsertFailureDoesNotBreakAskSnoozer],
    ["zoho_sync_failure_does_not_break_hud_ask", testZohoSyncFailureDoesNotBreakHudAsk],
    ["zoho_sync_failure_does_not_break_ask_snoozer", testZohoSyncFailureDoesNotBreakAskSnoozer],
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
      } finally {
        restoreShopify();
        restoreDynamo();
        resetIndexAndServices();
      }
    }
  } finally {
    restoreShopify();
    restoreDynamo();
    resetIndexAndServices();
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s) detected.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${tests.length} customer profile interaction enrichment tests passed.`);
}

main().catch((error) => {
  restoreShopify();
  restoreDynamo();
  resetIndexAndServices();
  console.error(error);
  process.exit(1);
});
