#!/usr/bin/env node
"use strict";

const assert = require("assert");

process.env.ASK_SNOOZER_PREFER_LOCAL_KNOWLEDGE = "1";
process.env.ASK_SNOOZER_MODEL_ONLY = "1";
for (const key of [
  "ZCRM_CLIENT_ID",
  "ZCRM_CLIENT_SECRET",
  "ZCRM_REFRESH_TOKEN",
  "ZCRM_OAUTH_DOMAIN",
  "ZCRM_API_DOMAIN",
  "ZOHO_CRM_BASE",
]) process.env[key] = "";

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const openai = require("../services/openai");
const shopify = require("../services/shopify");
const rewards = require("../services/rewards/service");
const manifest = require("../data/showroom-manifest.v1.json");
const { buildPlannerFixture } = require("./askSnoozerPlannerFixture");
const {
  buildShowroomCommandDecision,
  validateShowroomCommand,
} = require("../services/askSnoozerShowroomCommand");
const { applyAskSnoozerWorkingMemory } = require("../services/askSnoozerWorkingMemory");

const originalDdbSend = DynamoDBDocumentClient.prototype.send;
const originalPlanner = openai.planTrustedAdvisorTurnWithModel;
const originalComposer = openai.composeTrustedAdvisorResponse;
const originalFetchProducts = shopify.fetchProductsByHandles;
const originalGetCart = shopify.getCart;
const originalGetRewardSummary = rewards.getRewardSummary;
const originalGetRewardOffers = rewards.getRewardOffers;

const sessionStore = new Map();
const logs = [];
let plannerCalls = 0;
let composerCalls = 0;
let cartReads = 0;
let freeTextComparisonState = [];

const mattressHandles = manifest.products
  .filter((product) => product.active !== false && product.catalogType === "mattress")
  .map((product) => product.handle);

const products = Object.fromEntries(manifest.products.map((product, index) => [product.handle, {
  id: `gid://shopify/Product/${index + 1}`,
  handle: product.handle,
  title: product.title,
  description: `Verified ${product.title}`,
  imageUrl: `https://cdn.example/${product.handle}.jpg`,
  available: true,
  priceRange: { min: 500 + index * 100, max: 900 + index * 100, currencyCode: "USD" },
  variants: [
    {
      id: `gid://shopify/ProductVariant/${index + 1}01`,
      title: "Queen",
      price: 700 + index * 100,
      currencyCode: "USD",
      available: true,
      selectedOptions: [{ name: "Size", value: "Queen" }],
    },
    {
      id: `gid://shopify/ProductVariant/${index + 1}02`,
      title: "King",
      price: 900 + index * 100,
      currencyCode: "USD",
      available: true,
      selectedOptions: [{ name: "Size", value: "King" }],
    },
  ],
}]));

function patchDependencies() {
  DynamoDBDocumentClient.prototype.send = async function send(command) {
    if (command instanceof GetCommand) {
      const sessionId = command.input?.Key?.sessionId;
      return { Item: sessionId ? sessionStore.get(sessionId) || null : null };
    }
    if (command instanceof PutCommand) {
      const item = command.input?.Item;
      if (item?.sessionId) sessionStore.set(item.sessionId, item);
      return {};
    }
    if (command instanceof UpdateCommand) {
      const sessionId = command.input?.Key?.sessionId;
      if (sessionId) {
        const existing = sessionStore.get(sessionId) || { sessionId, context: {} };
        const journey = command.input?.ExpressionAttributeValues?.[":journey"];
        sessionStore.set(sessionId, {
          ...existing,
          context: journey
            ? { ...(existing.context || {}), activeJourney: journey }
            : command.input?.ExpressionAttributeValues?.[":c"] || existing.context,
          ...(journey ? { journeyRevision: Number(journey.revision || 0) } : {}),
        });
      }
      return {};
    }
    return {};
  };

  shopify.fetchProductsByHandles = async ({ handles = [] } = {}) => ({
    items: handles.map((handle) => products[handle]).filter(Boolean),
  });
  shopify.getCart = async () => {
    cartReads += 1;
    return {
      id: "gid://shopify/Cart/typed-test",
      cost: { totalAmount: { amount: "1600.00", currencyCode: "USD" } },
      lines: { edges: [{ node: {
        quantity: 1,
        merchandise: {
          id: "gid://shopify/ProductVariant/201",
          title: "Queen",
          availableForSale: true,
          price: { amount: "1600.00", currencyCode: "USD" },
          product: { id: "gid://shopify/Product/2", title: "14 Hybrid", handle: "14-hybrid" },
        },
      } }] },
    };
  };
  rewards.getRewardSummary = async () => ({
    availableSleepPoints: 420,
    currentBadge: { label: "Dreamer" },
    activeRulesVersion: "typed-test-rules",
  });
  rewards.getRewardOffers = async () => [{ label: "Verified offer", unlocked: true, status: "unlocked" }];

  openai.planTrustedAdvisorTurnWithModel = async (args = {}) => {
    plannerCalls += 1;
    freeTextComparisonState = args.context?.askSnoozerWorkingMemory?.activeDeal?.comparisonProductHandles || [];
    return buildPlannerFixture(args);
  };
  openai.composeTrustedAdvisorResponse = async (input = {}) => {
    composerCalls += 1;
    return {
      displayText: input.deterministicDraft.displayText,
      speechText: input.deterministicDraft.speechText,
      confidence: 0.99,
      model: "typed-action-test-composer",
      inputChars: 0,
      factPackChars: 0,
    };
  };
}

function restore() {
  DynamoDBDocumentClient.prototype.send = originalDdbSend;
  openai.planTrustedAdvisorTurnWithModel = originalPlanner;
  openai.composeTrustedAdvisorResponse = originalComposer;
  shopify.fetchProductsByHandles = originalFetchProducts;
  shopify.getCart = originalGetCart;
  rewards.getRewardSummary = originalGetRewardSummary;
  rewards.getRewardOffers = originalGetRewardOffers;
}

function eventFor(body) {
  const sessionId = body.sessionId || "typed-actions-session";
  return {
    version: "2.0",
    routeKey: "POST /ask-snoozer",
    rawPath: "/ask-snoozer",
    headers: {
      "content-type": "application/json",
      host: "typed-actions.test",
      origin: "https://mysnoozepod.com",
      "x-forwarded-proto": "https",
      "x-session-id": sessionId,
    },
    requestContext: {
      http: { method: "POST", path: "/ask-snoozer", sourceIp: "127.0.0.1", userAgent: "typed-actions-test" },
      requestId: `typed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify({
      mode: "ask_snoozer_page",
      surface: "typed_action_test",
      ...body,
      sessionId,
    }),
    isBase64Encoded: false,
  };
}

async function request(body) {
  const { lambdaHandler } = require("../index");
  const beforePlanner = plannerCalls;
  const beforeComposer = composerCalls;
  const response = await lambdaHandler(eventFor(body), { getRemainingTimeInMillis: () => 30000 });
  const parsed = JSON.parse(response.body || "{}");
  return {
    response,
    body: parsed,
    plannerCalls: plannerCalls - beforePlanner,
    composerCalls: composerCalls - beforeComposer,
  };
}

function command(type, payload = {}) {
  return { version: "showroom-command.v1", type, payload };
}

async function run() {
  patchDependencies();
  const originalConsoleLog = console.log;
  console.log = (...args) => logs.push(args.map((arg) => String(arg)).join(" "));
  let checks = 0;
  const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
  try {
    const invalidHandle = validateShowroomCommand(
      command("compare_products", { productHandles: ["fake-product-handle", "14-hybrid"] }),
      { manifest }
    );
    check(!invalidHandle.ok && invalidHandle.validationReason === "unknown_product_handle", "unknown handles fail validation");
    const invalidType = validateShowroomCommand(command("do_whatever"), { manifest });
    check(!invalidType.ok && invalidType.code === "E_INVALID_SHOWROOM_COMMAND", "unknown command types fail closed");
    const invalidTruth = validateShowroomCommand(command("find_rewards", { rewardBalance: 9999 }), { manifest });
    check(!invalidTruth.ok && invalidTruth.validationReason.startsWith("unexpected_payload_field"), "payload cannot inject domain truth");
    check(!validateShowroomCommand({ version: "showroom-command.v2", type: "find_rewards", payload: {} }, { manifest }).ok, "unsupported command version is rejected");
    check(!validateShowroomCommand(command("compare_products", { productHandles: ["12-dual-comfort-hybrid", "14-hybrid", "12-all-foam-mattress"] }), { manifest }).ok, "compare is bounded to two handles");
    check(!validateShowroomCommand(command("browse_products", { offset: -1 }), { manifest }).ok && !validateShowroomCommand(command("browse_products", { offset: 101 }), { manifest }).ok, "browse offset is numeric, non-negative, and bounded");
    check(!validateShowroomCommand(command("policy_fact", { topic: "shipping_copy" }), { manifest }).ok, "policy topic is restricted to canonical truth domains");
    check(!validateShowroomCommand(command("price_quote", { size: "California King" }), { manifest }).ok, "price size is restricted to manifest values");
    check(!validateShowroomCommand(command("product_sizes", { productHandle: "14-hybrid", variantId: "gid://shopify/ProductVariant/201" }), { manifest }).ok, "variant identity cannot enter through a command payload");
    check(!validateShowroomCommand(command("price_quote", {}), { manifest }).ok, "price command requires product or size context");

    const rewardsResult = await request({
      message: "Banana spaceship",
      command: command("find_rewards"),
      shopperId: "typed-shopper",
      testCaseId: "typed-label-independence",
    });
    check(rewardsResult.plannerCalls === 0 && rewardsResult.composerCalls === 0, "typed rewards bypasses both planner and composer");
    check(String(rewardsResult.body.reply).includes("420") && !String(rewardsResult.body.reply).includes("Banana"), "display label cannot alter rewards execution");
    check(rewardsResult.body.metadata?.planning?.semanticAuthority === "typed_showroom_action", "typed rewards reports typed semantic authority");
    check(rewardsResult.body.metadata?.planning?.legacyShadow?.evaluated === false, "typed rewards bypasses legacy shadow");

    const cartResult = await request({
      message: "Do not parse this",
      command: command("analyze_cart"),
      context: { cartId: "gid://shopify/Cart/typed-test" },
    });
    check(cartResult.plannerCalls === 0 && cartReads === 1, "typed cart uses the existing cart authority without model planning");
    check(String(cartResult.body.reply).includes("14 Hybrid") && String(cartResult.body.reply).includes("$1,600.00"), "typed cart reports verified cart lines and total");

    const browse = await request({ message: "Not browse prose", command: command("browse_products", { offset: 0 }) });
    check(browse.plannerCalls === 0 && browse.body.products?.length === 3, "typed browse works without an English browse phrase");
    const nextOffset = browse.body.chips?.[0]?.command?.payload?.offset;
    const more = await request({ message: "Not show-more prose", command: command("browse_products", { offset: nextOffset }) });
    check(more.plannerCalls === 0 && Number.isInteger(nextOffset) && nextOffset > 0, "show-more uses an explicit numeric offset");

    const motion = await request({ message: "Unrelated label", command: command("motion_base_features") });
    check(motion.plannerCalls === 0 && motion.body.products?.[0]?.handle === "premium-motion-adjustable-base", "typed motion uses the verified motion-base lane");

    const sizes = await request({
      message: "Unrelated label",
      command: command("product_sizes", { productHandle: "12-dual-comfort-hybrid" }),
    });
    check(sizes.plannerCalls === 0 && String(sizes.body.reply).match(/Queen|King/), "typed product sizes resolves verified sizes without planning");

    const compareSession = "typed-compare-continuity";
    const compare = await request({
      sessionId: compareSession,
      message: "Ignore this label",
      command: command("compare_products", { productHandles: ["12-dual-comfort-hybrid", "14-hybrid"] }),
    });
    check(compare.plannerCalls === 0, "typed compare bypasses the planner");
    check(compare.body.products?.map((item) => item.handle).join(",") === "12-dual-comfort-hybrid,14-hybrid", "typed compare returns exactly the commanded pair in order");
    const storedPair = sessionStore.get(compareSession)?.context?.askSnoozerWorkingMemory?.activeDeal?.comparisonProductHandles || [];
    check(storedPair.join(",") === "12-dual-comfort-hybrid,14-hybrid", "typed compare persists through the existing working-memory reducer");

    const followup = await request({ sessionId: compareSession, message: "Which one sleeps cooler?" });
    check(followup.plannerCalls === 1 && followup.body.metadata?.planning?.semanticAuthority === "model_semantics", "free-text comparison follow-up still uses Pass 2 model semantics");
    check(freeTextComparisonState.join(",") === storedPair.join(","), "free-text planner receives the persisted typed comparison pair");

    const policy = await request({ message: "Ignore label", command: command("policy_fact", { topic: "returns" }) });
    check(policy.plannerCalls === 0 && /100-night|return/i.test(String(policy.body.reply)), "typed policy uses canonical policy truth without planning");

    const priceContext = applyAskSnoozerWorkingMemory({
      query: "",
      context: {},
      modelDecision: buildShowroomCommandDecision(command("price_quote", { productHandle: "14-hybrid", size: "Queen" })),
    });
    check(priceContext.askSnoozerWorkingMemory.activeDeal.activeProductHandle === "14-hybrid" && priceContext.askSnoozerWorkingMemory.activeDeal.activeSize === "Queen", "typed price identity and size enter existing working memory");
    const price = await request({
      message: "Ignore label",
      command: command("price_quote", { productHandle: "14-hybrid", size: "Queen" }),
    });
    check(price.plannerCalls === 0 && /\$/.test(String(price.body.reply)), "typed exact price uses the commerce truth lane without planning");
    const unresolvedPrice = await request({ message: "Queen pricing", command: command("price_quote", { size: "Queen" }) });
    check(unresolvedPrice.plannerCalls === 0 && !/12-dual-comfort-hybrid|14-hybrid/i.test(String(unresolvedPrice.body.reply)), "price command without product context does not invent a product");

    const invalidRoute = await request({ message: "Find Rewards", command: command("do_whatever") });
    check(invalidRoute.plannerCalls === 0 && invalidRoute.body.error?.code === "E_INVALID_SHOWROOM_COMMAND", "invalid command type fails closed without English fallback");
    const invalidProductRoute = await request({
      message: "Compare Products",
      command: command("compare_products", { productHandles: ["fake-product-handle", "14-hybrid"] }),
    });
    check(invalidProductRoute.plannerCalls === 0 && invalidProductRoute.body.error?.code === "E_INVALID_SHOWROOM_COMMAND", "invalid product command fails closed without model reinterpretation");

    const freeText = await request({ message: "I liked the first mattress but it felt too firm. What should I try instead?" });
    check(freeText.plannerCalls === 1 && freeText.body.metadata?.planning?.semanticAuthority === "model_semantics", "ordinary free text remains model-semantic authority");

    const typedLogs = logs
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((entry) => entry?.src === "ask-snoozer.typed-command");
    check(typedLogs.some((entry) => entry.valid && entry.plannerBypassed && entry.semanticAuthority === "typed_showroom_action"), "valid typed command observability is emitted");
    check(typedLogs.some((entry) => !entry.valid && entry.validationReason), "invalid typed command observability includes validation reason");
    check(typedLogs.every((entry) => entry.fallbackUsed !== undefined && entry.productHandleCount !== undefined), "typed command logs include fallback and handle count fields");
    const parsedLogs = logs.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const typedQuality = parsedLogs.filter((entry) => entry.src === "ask-snoozer.quality-trace" && entry.semanticAuthority === "typed_showroom_action");
    check(typedQuality.some((entry) => entry.semanticAuthority === "typed_showroom_action" && entry.plannerModelCallCount === 0), "quality trace distinguishes typed authority with zero planner calls");
    check(!parsedLogs.some((entry) => entry.src === "ask-snoozer.semantic-shadow" && entry.semanticAuthority === "typed_showroom_action"), "typed commands never evaluate the legacy semantic shadow");

    const pageSource = require("fs").readFileSync(require("path").join(__dirname, "../omnia-journey/src/pages/AskSnoozer.jsx"), "utf8");
    check(pageSource.includes('action?.type === "add_to_cart"') && pageSource.includes("addToCart(action.payload)"), "existing structured add-to-cart path remains unchanged");
    check(!pageSource.includes("canInitiateCheckout") && !pageSource.includes("checkoutUrl"), "typed actions do not add a checkout path");

    originalConsoleLog(`Ask Snoozer typed showroom action tests passed (${checks} checks).`);
  } finally {
    console.log = originalConsoleLog;
    restore();
  }
}

run().catch((error) => {
  restore();
  console.error(error);
  process.exitCode = 1;
});
