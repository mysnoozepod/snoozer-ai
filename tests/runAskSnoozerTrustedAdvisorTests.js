#!/usr/bin/env node

const assert = require("assert");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

process.env.ASK_SNOOZER_PREFER_LOCAL_KNOWLEDGE = "1";
process.env.ASSESSMENT_TABLE = "ask-snoozer-trusted-advisor-assessments";
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

const fixture = require("./fixtures/ask-snoozer-trusted-advisor-10-turn.v1.json");
const openai = require("../services/openai");
const shopify = require("../services/shopify");
const {
  INTERNAL_LANGUAGE,
  planAskSnoozerTurn,
} = require("../services/askSnoozerConversationOrchestrator");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalOpenAi = openai.getSnoozerResponse;
const originalFetchProducts = shopify.fetchProductsByHandles;
const originalGetCart = shopify.getCart;
const originalConsoleLog = console.log;

const sessionStore = new Map();
const resultStore = new Map();
const openAiCalls = [];
const performanceSamples = [];

function mockedProducts() {
  return Object.entries(fixture.commerceFixture.products).map(([handle, product], productIndex) => ({
    id: `gid://shopify/Product/trusted-advisor-${productIndex}`,
    handle,
    title: product.title,
    available: true,
    availableForSale: true,
    imageUrl: `/fixture/${handle}.png`,
    priceRange: {
      min: Math.min(...Object.values(product.variants).map((variant) => variant.price)),
      max: Math.max(...Object.values(product.variants).map((variant) => variant.price)),
      currencyCode: fixture.commerceFixture.currencyCode,
    },
    variants: Object.entries(product.variants).map(([size, variant]) => ({
      id: variant.id,
      title: size,
      available: true,
      availableForSale: true,
      price: variant.price,
      currencyCode: fixture.commerceFixture.currencyCode,
      selectedOptions: [{ name: "Size", value: size }],
    })),
  }));
}

function patchDependencies() {
  DynamoDBDocumentClient.prototype.send = async function send(command) {
    if (command instanceof GetCommand) {
      if (command.input?.Key?.sessionId) return { Item: sessionStore.get(command.input.Key.sessionId) || null };
      if (command.input?.Key?.shopperId) return { Item: resultStore.get(command.input.Key.shopperId) || null };
      return { Item: null };
    }
    if (command instanceof PutCommand) {
      if (command.input?.Item?.sessionId) sessionStore.set(command.input.Item.sessionId, command.input.Item);
      if (command.input?.Item?.shopperId) resultStore.set(command.input.Item.shopperId, command.input.Item);
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

  openai.getSnoozerResponse = async (message, options = {}) => {
    openAiCalls.push({ message, options });
    return {
      reply: "Model fallback fixture response.",
      text: "Model fallback fixture response.",
      model: "fixture-model",
      meta: { path: "mock_openai", retrievalMs: 0, modelMs: 2 },
      context: options.context || {},
      actions: [],
    };
  };

  shopify.fetchProductsByHandles = async ({ handles = [] } = {}) => {
    const wanted = new Set(handles.map((handle) => String(handle)));
    return { items: mockedProducts().filter((product) => wanted.has(product.handle)) };
  };

  shopify.getCart = async () => ({
    lines: {
      edges: [
        {
          node: {
            quantity: 1,
            merchandise: {
              id: fixture.commerceFixture.products["12-all-foam-mattress"].variants.King.id,
              title: "King",
              availableForSale: true,
              price: { amount: "1399.00", currencyCode: "USD" },
              product: {
                id: "gid://shopify/Product/cart-foam",
                handle: "12-all-foam-mattress",
                title: "12-inch All Foam Mattress",
              },
            },
          },
        },
      ],
    },
    cost: { totalAmount: { amount: "1399.00", currencyCode: "USD" } },
  });
}

function restoreDependencies() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
  openai.getSnoozerResponse = originalOpenAi;
  shopify.fetchProductsByHandles = originalFetchProducts;
  shopify.getCart = originalGetCart;
  console.log = originalConsoleLog;
}

function buildEvent(body, requestId) {
  return {
    version: "2.0",
    routeKey: "POST /ask-snoozer",
    rawPath: "/ask-snoozer",
    headers: {
      "content-type": "application/json",
      host: "local.trusted-advisor.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: { method: "POST", path: "/ask-snoozer", sourceIp: "127.0.0.1", userAgent: "trusted-advisor-test" },
      requestId,
      routeKey: "POST /ask-snoozer",
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

async function invoke({ message, sessionId = fixture.shopper.sessionId, snoozeCode = "", testCaseId }) {
  const startedAt = Date.now();
  const { lambdaHandler } = require("../index");
  const response = await lambdaHandler(
    buildEvent(
      {
        message,
        mode: "ask_snoozer_page",
        source: "trusted_advisor_test",
        sessionId,
        shopperId: fixture.shopper.shopperId,
        snoozeCode: snoozeCode || undefined,
        testCaseId,
        context: { cartId: "gid://shopify/Cart/trusted-advisor" },
      },
      `${testCaseId}-${Date.now()}`
    )
  );
  assert.strictEqual(response.statusCode, 200, `${testCaseId} should return HTTP 200`);
  const body = JSON.parse(response.body);
  performanceSamples.push({
    testCaseId,
    elapsedMs: Date.now() - startedAt,
    complexity: /compare|advisor|compatib|full setup|standard motion|save|would you/i.test(message)
      ? "complex"
      : "simple",
  });
  return body;
}

function responseText(body) {
  return String(body?.reply || body?.answer || body?.message?.text || body?.speech || "").trim();
}

function memory(body) {
  return body?.context?.askSnoozerWorkingMemory || null;
}

function assertNoInternalLanguage(text, label) {
  const lower = text.toLowerCase();
  for (const phrase of INTERNAL_LANGUAGE) {
    assert(!lower.includes(phrase), `${label} leaked internal phrase: ${phrase}`);
  }
}

function assertCleanEnding(text, label) {
  assert(/[.!?]$/.test(text), `${label} should end cleanly`);
  assert(!text.endsWith("..."), `${label} should not be truncated`);
}

function productPrice(product) {
  const value = product?.price?.amount ?? product?.price;
  return Number(value);
}

async function runExactTenTurnFixture() {
  const outputs = [];
  for (const turn of fixture.turns) {
    const body = await invoke({ message: turn.message, testCaseId: `trusted-advisor-${turn.id}` });
    const text = responseText(body);
    outputs.push({ turn, body, text });
    for (const phrase of turn.expects.contains || []) {
      assert(text.toLowerCase().includes(phrase.toLowerCase()), `${turn.id} should include ${phrase}: ${text}`);
    }
    for (const phrase of turn.expects.doesNotContain || []) {
      assert(!text.toLowerCase().includes(phrase.toLowerCase()), `${turn.id} should not include ${phrase}: ${text}`);
    }
    assertNoInternalLanguage(text, turn.id);
    assertCleanEnding(text, turn.id);
    assert((body.chips || []).every((chip) => !/assessment|snooze session|human/i.test(chip.label)), `${turn.id} should not show generic chips`);
    assert(!body.actions?.some((action) => /checkout/i.test(action.type)), `${turn.id} should not start checkout`);
    const deal = memory(body)?.activeDeal || {};
    if (turn.expects.stage) assert.strictEqual(deal.stage, turn.expects.stage, `${turn.id} stage`);
    if (turn.expects.canonicalHandle) {
      assert.strictEqual(deal.canonicalRecommendation?.primaryMattressHandle, turn.expects.canonicalHandle, `${turn.id} canonical`);
    }
    if (turn.expects.activeProductHandle) assert.strictEqual(deal.activeProductHandle, turn.expects.activeProductHandle);
    if (turn.expects.comparisonHandles) assert.deepStrictEqual(deal.comparisonProductHandles, turn.expects.comparisonHandles);
    if (turn.expects.compatibilityStatus) assert.strictEqual(deal.compatibilityStatus, turn.expects.compatibilityStatus);
    if (turn.expects.quoteHandles) {
      assert.deepStrictEqual(deal.activeQuote?.items?.map((item) => item.handle), turn.expects.quoteHandles);
      for (const item of deal.activeQuote.items) {
        const card = (body.products || []).find((product) => product.handle === item.handle);
        assert(card, `${turn.id} should include card for ${item.handle}`);
        assert.strictEqual(productPrice(card), item.price, `${turn.id} card and quote price must match`);
      }
    }
  }
  assert.strictEqual(openAiCalls.length, 0, "bounded ten-turn flow should not call the model");
  return outputs;
}

async function runCommercialProgression() {
  const sessionId = "trusted-advisor-commercial-progression";
  const questions = [
    ["What would the King version of your recommendation cost?", "price_quote"],
    ["What would it cost with Standard Motion?", "bundle_quote"],
    ["How much would I save if I skip the base?", "savings_quote"],
    ["Is more expensive automatically better for me?", "value_judgment"],
    ["I didn't notice anything from the base.", "value_judgment"],
    ["I liked the elevated position.", "preference_capture"],
    ["What did I say I liked?", "preference_recall"],
    ["Medium versus soft on the mattress we're discussing?", "firmness_compare"],
    ["Would you buy this setup for me?", "advisor_choice"],
    ["Add the full setup to my cart.", "cart_add"],
    ["Add just the mattress to my cart.", "cart_add"],
    ["Is the mattress and base setup compatible?", "compatibility"],
  ];
  for (const [message, taskType] of questions) {
    const body = await invoke({ message, sessionId, testCaseId: `commercial-${taskType}` });
    const text = responseText(body);
    assertCleanEnding(text, message);
    assertNoInternalLanguage(text, message);
    assert.strictEqual(memory(body)?.lastPlan?.taskType, taskType, message);
    if (taskType === "cart_add") {
      assert((body.actions || []).length >= 1, `${message} should offer exact cart action`);
      assert((body.actions || []).every((action) => /^gid:\/\/shopify\/ProductVariant\//.test(action.payload?.merchandiseId)), `${message} should use exact variants`);
    }
  }
}

function runPlannerAndDepthMatrix() {
  const context = {
    canonicalRecommendation: { primaryMattressHandle: "12-all-foam-mattress" },
    askSnoozerWorkingMemory: {
      activeDeal: { activeProductHandle: "12-all-foam-mattress", activeSize: "King", stage: "narrowing" },
    },
  };
  const cases = [
    ["Quick answer: what does Standard Motion do?", "base_education", "quick"],
    ["Explain what Standard Motion does.", "base_education", "teach"],
    ["Compare it to the 14-inch Hybrid.", "product_comparison", "compare"],
    ["Which one would you choose for me?", "advisor_choice", "coach"],
    ["Give me a deep, detailed comparison with the 14-inch Hybrid.", "product_comparison", "deep"],
    ["Could this cure sciatica?", "medical_boundary", "standard"],
    ["Can this replace my CPAP for sleep apnea?", "medical_boundary", "standard"],
    ["My shoulder feels pressure on soft beds.", "legacy", "standard"],
    ["Does the setup make sense together?", "compatibility", "standard"],
    ["What is the price?", "price_quote", "standard"],
    ["What would the full setup cost?", "bundle_quote", "standard"],
    ["How much do I save without the base?", "savings_quote", "standard"],
  ];
  for (const [query, taskType, depth] of cases) {
    const plan = planAskSnoozerTurn({ query, context });
    assert.strictEqual(plan.taskType, taskType, query);
    assert.strictEqual(plan.responseDepth, depth, query);
    assert(plan.allowedActions.length <= 1, `${query} action allowlist should be bounded`);
  }
}

async function runCrossDeviceContinuity() {
  const code = "589424";
  const first = await invoke({
    message: "I liked the elevated position.",
    sessionId: "device-a-session",
    snoozeCode: code,
    testCaseId: "cross-device-a",
  });
  const second = await invoke({
    message: "What did I say I liked?",
    sessionId: "device-b-session",
    snoozeCode: code,
    testCaseId: "cross-device-b",
  });
  assert.strictEqual(first.sessionId, second.sessionId, "same Snooze Code should share active visit session");
  assert.match(responseText(second), /elevated position/i);
  assert.strictEqual(memory(second)?.activeDeal?.decision?.elevation, "liked");
}

async function main() {
  patchDependencies();
  console.log = () => {};
  try {
    resultStore.set(fixture.shopper.shopperId, {
      shopperId: fixture.shopper.shopperId,
      answers: { ...fixture.shopper.assessment },
    });
    const outputs = await runExactTenTurnFixture();
    await runCommercialProgression();
    runPlannerAndDepthMatrix();
    await runCrossDeviceContinuity();
    console.log = originalConsoleLog;
    console.log(`Ask Snoozer trusted-advisor tests passed (${outputs.length} exact turns, 12 commerce turns, 12 planner/depth cases, cross-device continuity).`);
    for (const complexity of ["simple", "complex"]) {
      const values = performanceSamples
        .filter((sample) => sample.complexity === complexity)
        .map((sample) => sample.elapsedMs)
        .sort((a, b) => a - b);
      const average = values.length
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : 0;
      const p95 = values.length ? values[Math.ceil(values.length * 0.95) - 1] : 0;
      console.log(`Local ${complexity} latency: avg=${average}ms p95=${p95}ms n=${values.length}`);
    }
    console.log(`Bounded advisor model calls: ${openAiCalls.length}`);
  } finally {
    restoreDependencies();
  }
}

main().catch((error) => {
  restoreDependencies();
  console.error(error.stack || error.message || error);
  process.exit(1);
});
