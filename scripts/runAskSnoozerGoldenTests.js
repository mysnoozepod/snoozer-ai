#!/usr/bin/env node

const assert = require("assert");
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

process.env.ASK_SNOOZER_PREFER_LOCAL_KNOWLEDGE = "1";

const openai = require("../services/openai");
const shopifySvc = require("../services/shopify");
const { resolveRecommendation } = require("../services/recommendationResolver");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalOpenAiGetSnoozerResponse = openai.getSnoozerResponse;
const originalFetchProductsByHandles = shopifySvc.fetchProductsByHandles;

const sessionStore = new Map();
const resultsStore = new Map();
const openAiCalls = [];

const PRODUCT_FIXTURES = Object.freeze({
  "14-hybrid": {
    id: "gid://shopify/Product/14-hybrid",
    handle: "14-hybrid",
    title: '14" Hybrid',
    available: true,
    priceRange: { min: 2899, currencyCode: "USD" },
    variants: [
      { id: "gid://shopify/ProductVariant/14hyb-queen", title: "Queen", price: 2899, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "Queen" }] },
      { id: "gid://shopify/ProductVariant/14hyb-king", title: "King", price: 3299, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "King" }] },
    ],
  },
  "12-dual-comfort-hybrid": {
    id: "gid://shopify/Product/12-dual-comfort-hybrid",
    handle: "12-dual-comfort-hybrid",
    title: '12" Dual Comfort Hybrid',
    available: true,
    priceRange: { min: 3199, currencyCode: "USD" },
    variants: [
      { id: "gid://shopify/ProductVariant/12dual-queen", title: "Queen", price: 3199, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "Queen" }] },
      { id: "gid://shopify/ProductVariant/12dual-king", title: "King", price: 3599, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "King" }] },
    ],
  },
  "12-all-foam-mattress": {
    id: "gid://shopify/Product/12-all-foam-mattress",
    handle: "12-all-foam-mattress",
    title: '12" All Foam Mattress',
    available: true,
    priceRange: { min: 2199, currencyCode: "USD" },
    variants: [
      { id: "gid://shopify/ProductVariant/12foam-queen", title: "Queen", price: 2199, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "Queen" }] },
      { id: "gid://shopify/ProductVariant/12foam-king", title: "King", price: 2599, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "King" }] },
    ],
  },
  "10-all-foam-mattress": {
    id: "gid://shopify/Product/10-all-foam-mattress",
    handle: "10-all-foam-mattress",
    title: '10" All Foam Mattress',
    available: true,
    priceRange: { min: 1799, currencyCode: "USD" },
    variants: [
      { id: "gid://shopify/ProductVariant/10foam-queen", title: "Queen", price: 1799, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "Queen" }] },
      { id: "gid://shopify/ProductVariant/10foam-king", title: "King", price: 2199, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "King" }] },
    ],
  },
  "premium-motion-adjustable-base": {
    id: "gid://shopify/Product/premium-motion-adjustable-base",
    handle: "premium-motion-adjustable-base",
    title: "Premium Motion Adjustable Base",
    available: true,
    priceRange: { min: 1499, currencyCode: "USD" },
    variants: [
      { id: "gid://shopify/ProductVariant/motion-queen", title: "Queen", price: 1499, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "Queen" }] },
      { id: "gid://shopify/ProductVariant/motion-king", title: "King", price: 1899, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "King" }] },
    ],
  },
  "platform-base": {
    id: "gid://shopify/Product/platform-base",
    handle: "platform-base",
    title: "Platform Base",
    available: true,
    priceRange: { min: 699, currencyCode: "USD" },
    variants: [
      { id: "gid://shopify/ProductVariant/platform-queen", title: "Queen", price: 699, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "Queen" }] },
      { id: "gid://shopify/ProductVariant/platform-king", title: "King", price: 899, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "King" }] },
    ],
  },
  "storage-base": {
    id: "gid://shopify/Product/storage-base",
    handle: "storage-base",
    title: "Storage Base",
    available: true,
    priceRange: { min: 999, currencyCode: "USD" },
    variants: [
      { id: "gid://shopify/ProductVariant/storage-queen", title: "Queen", price: 999, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "Queen" }] },
      { id: "gid://shopify/ProductVariant/storage-king", title: "King", price: 1199, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "King" }] },
    ],
  },
});

function buildEvent(body) {
  return {
    version: "2.0",
    routeKey: "POST /ask-snoozer",
    rawPath: "/ask-snoozer",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      host: "local.ask-snoozer.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/ask-snoozer",
        sourceIp: "127.0.0.1",
        userAgent: "ask-snoozer-quality-golden-test",
      },
      requestId: `golden-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      routeKey: "POST /ask-snoozer",
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

function patchDynamo() {
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
}

function restoreDynamo() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
}

function patchOpenAi() {
  openai.getSnoozerResponse = async function mockedGetSnoozerResponse(message, options = {}) {
    openAiCalls.push({ message, options });
    return {
      reply: `mocked openai: ${message}`,
      text: `mocked openai: ${message}`,
      model: "mock-openai",
      meta: { path: "mock_openai", retrievalMs: 0 },
      context: options.context || {},
      actions: [],
    };
  };
}

function restoreOpenAi() {
  openai.getSnoozerResponse = originalOpenAiGetSnoozerResponse;
}

function patchShopify() {
  shopifySvc.fetchProductsByHandles = async function mockedFetchProductsByHandles({ handles = [] } = {}) {
    return {
      items: (Array.isArray(handles) ? handles : [])
        .map((handle) => PRODUCT_FIXTURES[String(handle || "").trim()] || null)
        .filter(Boolean),
      meta: { source: "mock", fromCache: false },
    };
  };
}

function restoreShopify() {
  shopifySvc.fetchProductsByHandles = originalFetchProductsByHandles;
}

function resetStores() {
  sessionStore.clear();
  resultsStore.clear();
  openAiCalls.length = 0;
}

async function invokeAskSnoozer(body) {
  const { lambdaHandler } = require("../index");
  return parseBody(await lambdaHandler(buildEvent(body)));
}

async function buildCanonicalContext(assessment) {
  const resolved = await resolveRecommendation({
    assessment,
    includeProducts: true,
    includePods: true,
  });
  return resolved.recommendation;
}

function getQualityGate(payload) {
  return payload?.metadata?.qualityGate || {};
}

async function runCase(testCase) {
  resetStores();
  const payload = await invokeAskSnoozer(testCase.body);
  const qualityGate = getQualityGate(payload);
  const actual = {
    intentGroup: qualityGate.intentGroup || null,
    sourceOfTruth: qualityGate.sourceOfTruth || null,
    slots: qualityGate.slots || {},
    reply: payload.reply || "",
    answerType: qualityGate.answerType || null,
  };

  const checks = [];
  if (testCase.expected.intentGroup) {
    checks.push({
      ok: actual.intentGroup === testCase.expected.intentGroup,
      reason: `expected intentGroup=${testCase.expected.intentGroup}, got ${actual.intentGroup}`,
    });
  }
  if (testCase.expected.sourceOfTruth) {
    checks.push({
      ok: actual.sourceOfTruth === testCase.expected.sourceOfTruth,
      reason: `expected sourceOfTruth=${testCase.expected.sourceOfTruth}, got ${actual.sourceOfTruth}`,
    });
  }
  for (const [slotKey, slotValue] of Object.entries(testCase.expected.slots || {})) {
    checks.push({
      ok: actual.slots?.[slotKey] === slotValue,
      reason: `expected slot ${slotKey}=${slotValue}, got ${actual.slots?.[slotKey]}`,
    });
  }
  if (Array.isArray(testCase.expected.replyIncludes)) {
    for (const token of testCase.expected.replyIncludes) {
      checks.push({
        ok: String(actual.reply || "").toLowerCase().includes(String(token).toLowerCase()),
        reason: `expected reply to include "${token}"`,
      });
    }
  }
  if (testCase.expected.noOpenAi === true) {
    checks.push({
      ok: openAiCalls.length === 0,
      reason: `expected no OpenAI call, saw ${openAiCalls.length}`,
    });
  }

  const failedChecks = checks.filter((check) => !check.ok);
  return {
    id: testCase.id,
    prompt: testCase.prompt,
    expectedIntentGroup: testCase.expected.intentGroup,
    expectedSourceOfTruth: testCase.expected.sourceOfTruth,
    expectedSlots: testCase.expected.slots || {},
    actualIntentGroup: actual.intentGroup,
    actualSourceOfTruth: actual.sourceOfTruth,
    actualSlots: actual.slots,
    pass: failedChecks.length === 0,
    reason: failedChecks.map((check) => check.reason).join(" | "),
  };
}

async function main() {
  patchDynamo();
  patchOpenAi();
  patchShopify();

  const canonicalRecommendation = await buildCanonicalContext({
    size: "Queen",
    motionMode: "No Motion",
    firmness: "Soft",
    sleepPosition: "Side",
    sleepPartner: "No",
    baseType: "No Base",
    temperature: "Hot",
  });

  const cases = [
    {
      id: "commerce_queen_14_hybrid_mattress_only",
      prompt: "How much is the queen 14 hybrid mattress only?",
      body: { message: "How much is the queen 14 hybrid mattress only?", sessionId: "golden-1" },
      expected: {
        intentGroup: "commerce",
        sourceOfTruth: "shopify",
        slots: { scope: "mattress_only", size: "Queen", productHandle: "14-hybrid" },
        replyIncludes: ['14" Hybrid', "$2,899"],
        noOpenAi: true,
      },
    },
    {
      id: "commerce_queen_14_hybrid_platform_bundle",
      prompt: "How much is the queen 14 hybrid mattress and platform base?",
      body: { message: "How much is the queen 14 hybrid mattress and platform base?", sessionId: "golden-2" },
      expected: {
        intentGroup: "commerce",
        sourceOfTruth: "shopify",
        slots: { scope: "mattress_plus_base", size: "Queen", productHandle: "14-hybrid", baseHandle: "platform-base" },
        replyIncludes: ["Platform Base", "$699", "$3,598"],
        noOpenAi: true,
      },
    },
    {
      id: "commerce_pronoun_queen_with_canonical_context",
      prompt: "How much is it in queen?",
      body: {
        message: "How much is it in queen?",
        sessionId: "golden-3",
        context: {
          canonicalRecommendation,
        },
      },
      expected: {
        intentGroup: "commerce",
        sourceOfTruth: "shopify",
        slots: { size: "Queen", productHandle: "12-all-foam-mattress" },
        replyIncludes: ['12" All Foam Mattress'],
        noOpenAi: true,
      },
    },
    {
      id: "commerce_hybris_typo",
      prompt: "i just wanna know how much a 12 inch hybris is in a queen size for the mattress only",
      body: {
        message: "i just wanna know how much a 12 inch hybris is in a queen size for the mattress only",
        sessionId: "golden-4",
      },
      expected: {
        intentGroup: "commerce",
        sourceOfTruth: "shopify",
        slots: { scope: "mattress_only", size: "Queen", productHandle: "12-dual-comfort-hybrid" },
        replyIncludes: ['12" Dual Comfort Hybrid', "$3,199"],
        noOpenAi: true,
      },
    },
    {
      id: "commerce_cheapest_queen_setup",
      prompt: "What is the cheapest queen setup?",
      body: { message: "What is the cheapest queen setup?", sessionId: "golden-5" },
      expected: {
        intentGroup: "commerce",
        sourceOfTruth: "shopify",
        slots: { scope: "full_pod", size: "Queen" },
        replyIncludes: ["cheapest mattress-only option", "cheapest full setup"],
        noOpenAi: true,
      },
    },
    {
      id: "policy_sleep_trial",
      prompt: "What is the sleep trial?",
      body: { message: "What is the sleep trial?", sessionId: "golden-6" },
      expected: {
        intentGroup: "policy",
        sourceOfTruth: "s3_policy",
        slots: { policyTopic: "sleep_trial" },
        replyIncludes: ["sleep trial"],
        noOpenAi: true,
      },
    },
    {
      id: "policy_return_if_i_do_not_like_it",
      prompt: "Can I return it if I do not like it?",
      body: { message: "Can I return it if I do not like it?", sessionId: "golden-7" },
      expected: {
        intentGroup: "policy",
        sourceOfTruth: "s3_policy",
        slots: { policyTopic: "return_policy" },
        replyIncludes: ["return", "trial"],
        noOpenAi: true,
      },
    },
    {
      id: "support_help_during_session",
      prompt: "What happens if I need help during my session?",
      body: { message: "What happens if I need help during my session?", sessionId: "golden-8" },
      expected: {
        intentGroup: "support",
        sourceOfTruth: "fallback",
        slots: {},
        replyIncludes: ["contact", "support"],
        noOpenAi: true,
      },
    },
    {
      id: "education_snoring",
      prompt: "What helps with snoring?",
      body: { message: "What helps with snoring?", sessionId: "golden-9" },
      expected: {
        intentGroup: "product_education",
        sourceOfTruth: "s3_product",
        slots: {},
        replyIncludes: ["adjustable base"],
        noOpenAi: true,
      },
    },
    {
      id: "education_side_sleepers_current_product",
      prompt: "Is this good for side sleepers?",
      body: {
        message: "Is this good for side sleepers?",
        sessionId: "golden-10",
        context: {
          path: "/products/14-hybrid",
          page_type: "product",
          currentProductHandle: "14-hybrid",
        },
      },
      expected: {
        intentGroup: "product_education",
        sourceOfTruth: "s3_product",
        slots: { productHandle: "14-hybrid" },
        replyIncludes: ['14" Hybrid'],
        noOpenAi: true,
      },
    },
    {
      id: "session_guidance_where_should_i_start",
      prompt: "Where should I start?",
      body: {
        message: "Where should I start?",
        sessionId: "golden-11",
        context: {
          sessionPrep: {
            recommendedStartingPod: "SnoozePod 3",
            showroomStartingPoint: "Start with SnoozePod 3 and compare support first.",
            comfortSummary: "Support-first with adjustable elevation.",
          },
        },
      },
      expected: {
        intentGroup: "session_guidance",
        sourceOfTruth: "session_prep",
        slots: { sessionTopic: "where_to_start" },
        replyIncludes: ["SnoozePod 3", "Start with SnoozePod 3"],
        noOpenAi: true,
      },
    },
    {
      id: "fallback_random_nonsense",
      prompt: "asdf random nonsense banana base moon policy",
      body: { message: "asdf random nonsense banana base moon policy", sessionId: "golden-12" },
      expected: {
        intentGroup: "fallback",
        sourceOfTruth: "fallback",
        slots: {},
        replyIncludes: ["live pricing", "sleep trial"],
        noOpenAi: true,
      },
    },
  ];

  const rows = [];
  let failed = 0;

  try {
    for (const testCase of cases) {
      const row = await runCase(testCase);
      rows.push({
        id: row.id,
        prompt: row.prompt,
        expectedIntentGroup: row.expectedIntentGroup,
        expectedSourceOfTruth: row.expectedSourceOfTruth,
        expectedSlots: JSON.stringify(row.expectedSlots),
        actualIntentGroup: row.actualIntentGroup,
        actualSourceOfTruth: row.actualSourceOfTruth,
        actualSlots: JSON.stringify(row.actualSlots),
        result: row.pass ? "PASS" : "FAIL",
        reason: row.reason,
      });
      if (!row.pass) failed += 1;
    }
  } finally {
    restoreShopify();
    restoreOpenAi();
    restoreDynamo();
  }

  console.table(rows);

  if (failed > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`All ${cases.length} Ask Snoozer golden tests passed.`);
}

main().catch((error) => {
  restoreShopify();
  restoreOpenAi();
  restoreDynamo();
  console.error(error);
  process.exit(1);
});
