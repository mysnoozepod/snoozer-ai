#!/usr/bin/env node

const assert = require("assert");

process.env.ASK_SNOOZER_PREFER_LOCAL_KNOWLEDGE = "1";
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
const manifest = require("../data/showroom-manifest.v1.json");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalOpenAi = openai.getSnoozerResponse;
const originalFetchProducts = shopify.fetchProductsByHandles;
const sessions = new Map();

const assessment = Object.freeze({
  size: "Queen",
  motionMode: "No Motion",
  firmness: "Soft",
  sleepPosition: "Side",
  sleepPartner: "No",
  baseType: "No Base",
  temperature: "Hot",
});

const canonicalRecommendation = Object.freeze({
  topPodId: "4",
  topPodIds: ["4", "2", "1"],
  primaryMattressHandle: "12-all-foam-mattress",
  baseHandle: null,
  motionKey: "none",
  normalizedAssessment: assessment,
});

const cases = [
  { id: "sleep-hot", prompt: "I sleep hot." },
  { id: "support", prompt: "I need better support." },
  { id: "snoring", prompt: "I snore." },
  { id: "compare", prompt: "Help me compare mattresses." },
  {
    id: "current-pod",
    prompt: "Why is this Pod recommended for me?",
    path: "/pod/pod-4",
    pageType: "pod",
    extraContext: { currentPodId: "4", podId: "4" },
  },
  {
    id: "product-specific",
    prompt: "Is this mattress good for hot sleepers?",
    path: "/products/14-hybrid",
    pageType: "product",
    extraContext: { currentProductHandle: "14-hybrid" },
  },
];

function patchDependencies() {
  DynamoDBDocumentClient.prototype.send = async function send(command) {
    if (command instanceof GetCommand) {
      const sessionId = command.input?.Key?.sessionId;
      return { Item: sessionId ? sessions.get(sessionId) || null : null };
    }
    if (command instanceof PutCommand) {
      const sessionId = command.input?.Item?.sessionId;
      if (sessionId) sessions.set(sessionId, command.input.Item);
      return {};
    }
    if (command instanceof UpdateCommand) {
      const sessionId = command.input?.Key?.sessionId;
      if (sessionId) {
        const current = sessions.get(sessionId) || { sessionId, context: {} };
        sessions.set(sessionId, {
          ...current,
          context: command.input?.ExpressionAttributeValues?.[":c"] || current.context,
        });
      }
      return {};
    }
    return {};
  };

  openai.getSnoozerResponse = async (_message, options = {}) => ({
    reply: "I can help you compare the relevant sleep factors without guessing.",
    text: "I can help you compare the relevant sleep factors without guessing.",
    model: "parity-model-stub",
    context: options.context || {},
    actions: [],
  });

  shopify.fetchProductsByHandles = async ({ handles = [] } = {}) => {
    const catalog = Array.isArray(manifest?.products) ? manifest.products : [];
    const requested = new Set(handles.map((handle) => String(handle)));
    return {
      items: catalog
        .filter((product) => requested.has(String(product.handle)))
        .map((product) => ({
          ...product,
          id: product.id || `gid://shopify/Product/parity-${product.handle}`,
          title: product.title || product.name || product.handle,
          availableForSale: true,
          variants: Array.isArray(product.variants) ? product.variants : [],
        })),
    };
  };
}

function restoreDependencies() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
  openai.getSnoozerResponse = originalOpenAi;
  shopify.fetchProductsByHandles = originalFetchProducts;
}

function buildEvent(path, body, requestId) {
  return {
    version: "2.0",
    rawPath: path,
    headers: {
      "content-type": "application/json",
      origin: "https://mysnoozepod.com",
    },
    requestContext: {
      http: { method: "POST", path },
      requestId,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

async function invoke(path, body, requestId) {
  const { lambdaHandler } = require("../index");
  const response = await lambdaHandler(buildEvent(path, body, requestId));
  assert.strictEqual(response.statusCode, 200, `${requestId} should return HTTP 200`);
  return JSON.parse(response.body);
}

function canonicalFingerprint(body) {
  const quality = body?.metadata?.qualityGate || {};
  return {
    intentGroup: quality.intentGroup || "",
    intent: quality.intent || "",
    productHandles: (body?.products || []).map((product) => product.handle).filter(Boolean).sort(),
    sourceOfTruth: quality.sourceOfTruth || "",
    protectedTruthRequired: Boolean(quality.protectedTruthRequired),
    answerType: quality.answerType || "",
    fallbackUsed: Boolean(body?.metadata?.metrics?.fallbackUsed),
  };
}

function legacyFingerprint(body) {
  return {
    intentGroup: body?.intent_group || "",
    intent: body?.intent || "",
    productHandles: (body?.products || []).map((product) => product.handle).filter(Boolean).sort(),
    sourceOfTruth: body?.meta?.source_of_truth || "",
    protectedTruthRequired: Boolean(body?.meta?.protected_truth_required),
    answerType: body?.meta?.answer_type || "",
    fallbackUsed: Boolean(body?.meta?.fallback_used),
  };
}

async function runCase(testCase) {
  const sessionId = `pass-a-parity-${testCase.id}`;
  const path = testCase.path || "/ask-snoozer";
  const pageType = testCase.pageType || "page";
  const context = {
    assessment,
    canonicalRecommendation,
    path,
    page_type: pageType,
    pageType,
    ...(testCase.extraContext || {}),
  };

  const react = await invoke(
    "/ask-snoozer",
    {
      message: testCase.prompt,
      source: "ask_snoozer_page",
      sessionId,
      thread_id: sessionId,
      context: { ...context, surface: "ask_snoozer_page" },
    },
    `parity-react-${testCase.id}`
  );
  const shopifyHeader = await invoke(
    "/ask-snoozer",
    {
      message: testCase.prompt,
      source: "shopify_header",
      sessionId,
      thread_id: sessionId,
      context: { ...context, surface: "shopify_header" },
    },
    `parity-shopify-${testCase.id}`
  );
  const legacyHudAsk = await invoke(
    "/hud/ask",
    {
      query: testCase.prompt,
      path,
      page_type: pageType,
      surface: "shopify_header",
      session_id: sessionId,
      context,
      currentProductHandle: testCase.extraContext?.currentProductHandle,
    },
    `parity-legacy-${testCase.id}`
  );

  const reactFingerprint = canonicalFingerprint(react);
  assert.deepStrictEqual(
    canonicalFingerprint(shopifyHeader),
    reactFingerprint,
    `${testCase.id}: React and Shopify header semantics should match`
  );
  assert.deepStrictEqual(
    legacyFingerprint(legacyHudAsk),
    reactFingerprint,
    `${testCase.id}: legacy /hud/ask adapter should preserve shared semantics`
  );
  assert.strictEqual(
    legacyHudAsk?.meta?.shared_brain_route,
    "/ask-snoozer",
    `${testCase.id}: legacy adapter should identify the shared route`
  );

  console.log(`${testCase.id}: parity ok`, reactFingerprint);
}

async function main() {
  patchDependencies();
  try {
    for (const testCase of cases) {
      await runCase(testCase);
    }
    console.log("All six Snoozer surface parity cases passed.");
  } finally {
    restoreDependencies();
  }
}

main().catch((error) => {
  restoreDependencies();
  console.error(error);
  process.exitCode = 1;
});
