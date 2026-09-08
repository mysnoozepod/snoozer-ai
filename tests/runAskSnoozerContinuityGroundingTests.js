#!/usr/bin/env node

const assert = require("assert");

process.env.ASK_SNOOZER_PREFER_LOCAL_KNOWLEDGE = "1";
process.env.ASSESSMENT_TABLE = "ask-snoozer-continuity-assessments";
for (const key of [
  "ZCRM_CLIENT_ID",
  "ZCRM_CLIENT_SECRET",
  "ZCRM_REFRESH_TOKEN",
  "ZCRM_OAUTH_DOMAIN",
  "ZCRM_API_DOMAIN",
  "ZOHO_CRM_BASE",
]) {
  process.env[key] = "";
}

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const openai = require("../services/openai");
const shopify = require("../services/shopify");
const conversationState = require("../services/conversationState");
const { loadShowroomManifest } = require("../services/showroomManifest");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalOpenAi = openai.getSnoozerResponse;
const originalFetchProducts = shopify.fetchProductsByHandles;
const originalConsoleLog = console.log;

const sessionStore = new Map();
const resultsStore = new Map();
const openAiCalls = [];
const shopifyCalls = [];
const manifest = loadShowroomManifest();

const SOFT_ALL_FOAM_ASSESSMENT = Object.freeze({
  size: "Queen",
  motionMode: "No Motion",
  firmness: "Soft",
  sleepPosition: "Side",
  sleepPartner: "No",
  baseType: "No Base",
  temperature: "Hot",
  painPoints: ["Shoulders", "Hips"],
});

function buildEvent(body, requestId) {
  return {
    version: "2.0",
    routeKey: "POST /ask-snoozer",
    rawPath: "/ask-snoozer",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      host: "local.ask-snoozer-continuity.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/ask-snoozer",
        sourceIp: "127.0.0.1",
        userAgent: "ask-snoozer-continuity-test",
      },
      requestId,
      routeKey: "POST /ask-snoozer",
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function patchDependencies() {
  DynamoDBDocumentClient.prototype.send = async function send(command) {
    if (command instanceof GetCommand) {
      if (command.input?.Key?.sessionId) {
        return { Item: sessionStore.get(command.input.Key.sessionId) || null };
      }
      if (command.input?.Key?.shopperId) {
        return { Item: resultsStore.get(command.input.Key.shopperId) || null };
      }
      return { Item: null };
    }

    if (command instanceof PutCommand) {
      if (command.input?.Item?.sessionId) {
        sessionStore.set(command.input.Item.sessionId, command.input.Item);
      }
      if (command.input?.Item?.shopperId) {
        resultsStore.set(command.input.Item.shopperId, command.input.Item);
      }
      return {};
    }

    if (command instanceof UpdateCommand) {
      const sessionId = command.input?.Key?.sessionId;
      if (sessionId) {
        const existing = sessionStore.get(sessionId) || { sessionId, context: {} };
        sessionStore.set(sessionId, {
          ...existing,
          context: command.input?.ExpressionAttributeValues?.[":c"] || existing.context,
        });
      }
      return {};
    }
    return {};
  };

  openai.getSnoozerResponse = async function mockedGetSnoozerResponse(message, options = {}) {
    openAiCalls.push({ message, options });
    return {
      reply: "Dreams can reflect normal sleep-stage activity; consistent sleep timing can help overall sleep quality.",
      text: "Dreams can reflect normal sleep-stage activity; consistent sleep timing can help overall sleep quality.",
      model: "continuity-model-stub",
      meta: { path: "mock_openai", retrievalMs: 0, modelMs: 4 },
      context: options.context || {},
      actions: [],
    };
  };

  shopify.fetchProductsByHandles = async ({ handles = [] } = {}) => {
    shopifyCalls.push(handles.slice());
    const requested = new Set(handles.map(String));
    return {
      items: manifest.products
        .filter((product) => requested.has(String(product.handle)))
        .map((product, productIndex) => ({
          ...product,
          id: `gid://shopify/Product/continuity-${productIndex}`,
          availableForSale: true,
          variants: ["Queen", "King", "Split King"].map((size, sizeIndex) => ({
            id: `gid://shopify/ProductVariant/${productIndex}-${sizeIndex}`,
            title: size,
            availableForSale: true,
            selectedOptions: [{ name: "Size", value: size }],
            price: product.catalogType === "base" ? 2100 + sizeIndex * 100 : 3100 + sizeIndex * 100,
            currencyCode: "USD",
          })),
        })),
    };
  };
}

function restoreDependencies() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
  openai.getSnoozerResponse = originalOpenAi;
  shopify.fetchProductsByHandles = originalFetchProducts;
  console.log = originalConsoleLog;
}

function resetStores() {
  sessionStore.clear();
  resultsStore.clear();
  openAiCalls.length = 0;
  shopifyCalls.length = 0;
}

function seedAssessment(shopperId = "1234", assessment = SOFT_ALL_FOAM_ASSESSMENT) {
  resultsStore.set(shopperId, { shopperId, answers: { ...assessment } });
}

function getMemory(sessionId) {
  return sessionStore.get(sessionId)?.context?.askSnoozerWorkingMemory || null;
}

function getGoal(sessionId) {
  return getMemory(sessionId)?.activeGoal || null;
}

async function invoke({ sessionId, message, context = {}, testCaseId = "continuity" }) {
  const { lambdaHandler } = require("../index");
  const response = await lambdaHandler(
    buildEvent(
      {
        message,
        sessionId,
        shopperId: "1234",
        testCaseId,
        context,
      },
      `${testCaseId}-${Date.now()}`
    )
  );
  assert.strictEqual(response.statusCode, 200, `${testCaseId} should return HTTP 200`);
  return JSON.parse(response.body);
}

function responseText(body) {
  return String(body?.reply || body?.answer || body?.message?.text || body?.speech || "").trim();
}

async function testCanonicalPageConflictAndRecall() {
  resetStores();
  seedAssessment();
  const sessionId = "continuity-canonical";
  const pageContext = {
    podId: "1",
    path: "/pod/1",
    pageType: "pod",
    explore: [
      { handle: "12-dual-comfort-hybrid", title: "12-inch Dual Comfort Hybrid" },
      { handle: "premium-motion-adjustable-base", title: "Premium Motion Adjustable Base" },
    ],
  };

  const first = await invoke({
    sessionId,
    message: "Based on everything I've told you, which SnoozePod should I try first and why?",
    context: pageContext,
    testCaseId: "canonical-page-conflict",
  });
  assert.match(responseText(first), /SnoozePod 4/i);
  assert.match(responseText(first), /All Foam/i);
  assert.strictEqual(first?.metadata?.qualityGate?.sourceOfTruth, "canonical_profile");
  assert.strictEqual(first?.metadata?.qualityGate?.shouldUseOpenAI, false);
  assert.strictEqual(openAiCalls.length, 0);

  await invoke({
    sessionId,
    message: "Tell me about the 14-inch Hybrid.",
    context: pageContext,
    testCaseId: "recommendation-discussion",
  });
  const recalled = await invoke({
    sessionId,
    message: "What did you recommend for me again?",
    context: pageContext,
    testCaseId: "recommendation-recall",
  });
  assert.match(responseText(recalled), /SnoozePod 4/i);
  assert.match(responseText(recalled), /All Foam/i);
  assert.doesNotMatch(responseText(recalled), /SnoozePod 1/i);
}

async function testSessionSlotPrecedenceAndPainPreservation() {
  resetStores();
  seedAssessment("1234", { ...SOFT_ALL_FOAM_ASSESSMENT, firmness: "Firm" });
  const sessionId = "continuity-session-slots";

  await invoke({
    sessionId,
    message: "I want a King, medium, not too soft. My shoulders and hips hurt.",
    testCaseId: "current-session-slots",
  });
  let memory = getMemory(sessionId);
  assert.strictEqual(memory.slots.size.value, "King");
  assert.strictEqual(memory.slots.firmness.value, "Medium");
  assert.deepStrictEqual(memory.slots.painPoints.value, ["shoulders", "hips"]);
  assert(!memory.slots.painPoints.value.includes("back"));
  assert(memory.conflicts.some((entry) => entry.slot === "size"));
  assert(memory.conflicts.some((entry) => entry.slot === "firmness"));
  assert.strictEqual(resultsStore.get("1234").answers.size, "Queen");
  assert.strictEqual(resultsStore.get("1234").answers.firmness, "Firm");

  await invoke({
    sessionId,
    message: "Why do people dream?",
    testCaseId: "model-state-parity",
  });
  await invoke({
    sessionId,
    message: "How should I compare pressure relief?",
    testCaseId: "deterministic-state-parity",
  });
  memory = getMemory(sessionId);
  assert.strictEqual(memory.slots.size.value, "King");
  assert.strictEqual(memory.slots.size.provenance, "current_conversation");
  assert.strictEqual(memory.slots.firmness.value, "Medium");
  assert(openAiCalls.length >= 1, "model lane should have been exercised");
  const modelMemory = openAiCalls[0].options.context.askSnoozerWorkingMemory;
  assert.strictEqual(modelMemory.slots.size.value, "King");
  assert.strictEqual(modelMemory.slots.firmness.value, "Medium");
  assert.strictEqual(getMemory(sessionId).turnIndex, 3);
}

async function testPendingPriceQuoteTranscriptAndColdStart() {
  resetStores();
  seedAssessment();
  const sessionId = "continuity-price-quote";

  const start = await invoke({
    sessionId,
    message: "What is the price for that setup?",
    testCaseId: "price-quote-start",
  });
  assert.match(responseText(start), /Which base/i);
  assert.strictEqual(getGoal(sessionId).intent, "price_quote");
  assert.strictEqual(getGoal(sessionId).status, "collecting_slots");
  assert.deepStrictEqual(getGoal(sessionId).missingSlots, ["baseHandle"]);

  await invoke({
    sessionId,
    message: "King",
    testCaseId: "price-quote-king",
  });
  assert.strictEqual(getGoal(sessionId).size, "King");
  assert.strictEqual(getGoal(sessionId).intent, "price_quote");

  conversationState.resetMemory(sessionId);
  const standard = await invoke({
    sessionId,
    message: "standard",
    testCaseId: "price-quote-standard-after-cold-start",
  });
  assert.strictEqual(getGoal(sessionId).baseHandle, "premium-motion-adjustable-base");
  assert.strictEqual(getGoal(sessionId).motionKey, "standard");
  assert.strictEqual(getGoal(sessionId).status, "completed");
  assert.match(responseText(standard), /\$5,400/i);
  assert.strictEqual(standard?.metadata?.qualityGate?.sourceOfTruth, "shopify");

  const howMuch = await invoke({
    sessionId,
    message: "how much",
    testCaseId: "price-quote-how-much",
  });
  assert.match(responseText(howMuch), /\$5,400/i);
  assert.strictEqual(getGoal(sessionId).size, "King");
  assert.strictEqual(getGoal(sessionId).motionKey, "standard");
  assert.strictEqual(getGoal(sessionId).status, "completed");
  assert.strictEqual(openAiCalls.length, 0, "price transcript must not delegate commerce truth to OpenAI");
  assert(shopifyCalls.length >= 2, "Shopify should resolve each completed quote turn");

  const allFoam = await invoke({
    sessionId,
    message: "all foam",
    testCaseId: "price-quote-all-foam-fragment",
  });
  assert.match(responseText(allFoam), /All Foam/i);
  assert.strictEqual(getGoal(sessionId).productHandle, "12-all-foam-mattress");
  assert.strictEqual(getGoal(sessionId).size, "King");
  assert.strictEqual(getGoal(sessionId).motionKey, "standard");
}

async function testAllFoamGoalSwitchAndKnowledgeMatch() {
  resetStores();
  seedAssessment();
  const quoteSession = "continuity-product-switch";
  sessionStore.set(quoteSession, {
    sessionId: quoteSession,
    context: {
      askSnoozerWorkingMemory: {
        version: 1,
        turnIndex: 4,
        slots: {
          productHandle: { value: "14-hybrid", provenance: "current_conversation" },
          size: { value: "King", provenance: "current_conversation" },
          baseHandle: {
            value: "premium-motion-adjustable-base",
            provenance: "current_conversation",
          },
          motionKey: { value: "standard", provenance: "current_conversation" },
        },
        activeGoal: {
          intent: "price_quote",
          status: "completed",
          scope: "full_pod",
          productHandle: "14-hybrid",
          size: "King",
          baseHandle: "premium-motion-adjustable-base",
          motionKey: "standard",
          missingSlots: [],
        },
        conflicts: [],
      },
    },
  });

  const switched = await invoke({
    sessionId: quoteSession,
    message: "all foam",
    testCaseId: "price-quote-all-foam",
  });
  assert.strictEqual(getGoal(quoteSession).productHandle, "12-all-foam-mattress");
  assert.strictEqual(getGoal(quoteSession).size, "King");
  assert.strictEqual(getGoal(quoteSession).baseHandle, "premium-motion-adjustable-base");
  assert.strictEqual(getGoal(quoteSession).motionKey, "standard");
  assert.strictEqual(getGoal(quoteSession).status, "completed");
  assert.match(responseText(switched), /All Foam/i);

  const shopifyCallsBeforeEducation = shopifyCalls.length;
  const postQuoteKnowledge = await invoke({
    sessionId: quoteSession,
    message: "What is the 12-inch All Foam mattress good for?",
    context: {
      podId: "1",
      path: "/pod/1",
      explore: [{ handle: "12-dual-comfort-hybrid", title: "12-inch Dual Comfort Hybrid" }],
    },
    testCaseId: "post-quote-product-knowledge-match",
  });
  assert.strictEqual(postQuoteKnowledge?.metadata?.answerSourceType, "s3_product");
  assert.strictEqual(postQuoteKnowledge?.metadata?.resolvedRequestedProductHandle, "12-all-foam-mattress");
  assert.strictEqual(
    shopifyCalls.length,
    shopifyCallsBeforeEducation,
    "a full product question after a completed quote must not be treated as a quote fragment"
  );

  const knowledgeSession = "continuity-product-knowledge";
  const knowledge = await invoke({
    sessionId: knowledgeSession,
    message: "What is the 12-inch All Foam mattress good for?",
    context: {
      podId: "1",
      path: "/pod/1",
      explore: [{ handle: "12-dual-comfort-hybrid", title: "12-inch Dual Comfort Hybrid" }],
    },
    testCaseId: "product-knowledge-match",
  });
  assert.strictEqual(
    knowledge?.metadata?.resolvedRequestedProductHandle,
    "12-all-foam-mattress"
  );
  assert.deepStrictEqual(knowledge?.metadata?.loadedProductKnowledgeHandles, [
    "12-all-foam-mattress",
  ]);
  assert.doesNotMatch(String(knowledge?.metadata?.answerSourceKey || ""), /dual-comfort/i);
}

async function testShopifyPriceAndAvailabilityAuthority() {
  resetStores();
  seedAssessment();
  const sessionId = "continuity-shopify-authority";
  const body = await invoke({
    sessionId,
    message: "Is the 12-inch All Foam mattress available in King?",
    context: { lastTotal: 1 },
    testCaseId: "shopify-availability-authority",
  });
  assert.strictEqual(body?.metadata?.qualityGate?.sourceOfTruth, "shopify");
  assert.strictEqual(body?.metadata?.qualityGate?.factsResolved, true);
  assert.match(responseText(body), /available/i);
  assert.strictEqual(openAiCalls.length, 0);
  assert(shopifyCalls.some((handles) => handles.includes("12-all-foam-mattress")));
}

const tests = [
  ["canonical_page_conflict_and_recommendation_recall", testCanonicalPageConflictAndRecall],
  ["king_medium_profile_precedence_model_parity_and_pain_preservation", testSessionSlotPrecedenceAndPainPreservation],
  ["pending_price_quote_standard_how_much_and_cold_start", testPendingPriceQuoteTranscriptAndColdStart],
  ["all_foam_goal_switch_and_exact_product_knowledge", testAllFoamGoalSwitchAndKnowledgeMatch],
  ["shopify_price_and_availability_authority", testShopifyPriceAndAvailabilityAuthority],
];

async function main() {
  patchDependencies();
  console.log = () => {};
  const failures = [];
  for (const [name, test] of tests) {
    try {
      await test();
      originalConsoleLog(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, error });
      originalConsoleLog(`FAIL ${name}: ${error.stack || error.message}`);
    }
  }
  restoreDependencies();
  if (failures.length) {
    process.exitCode = 1;
    return;
  }
  originalConsoleLog(`All ${tests.length} Ask Snoozer continuity and grounding transcript tests passed.`);
}

main().catch((error) => {
  restoreDependencies();
  originalConsoleLog(error.stack || error.message);
  process.exitCode = 1;
});
