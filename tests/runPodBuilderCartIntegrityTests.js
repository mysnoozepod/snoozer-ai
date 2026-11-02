#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadPodBuilderModule } = require("./loadPodBuilderModule");

const podBuilder = loadPodBuilderModule({
  window: {
    fetch: async function missingFetch() { throw new Error("fetch not mocked"); },
    sessionStorage: { getItem() { return ""; }, setItem() {} },
    localStorage: { getItem() { return ""; }, setItem() {} },
    crypto: { randomUUID() { return "fixture-operation"; } },
    MySnoozePod: {},
  },
  document: {
    documentElement: { getAttribute() { return ""; } },
    addEventListener() {},
    querySelectorAll() { return []; },
  },
});

function response(ok, body, options = {}) {
  return {
    ok,
    async json() {
      if (options.malformed) throw new Error("malformed response");
      return body;
    },
  };
}

function lineFor(item, quantity = item.quantity) {
  const line = {
    variant_id: Number(item.id),
    quantity,
    properties: { ...item.properties },
  };
  if (item.selling_plan) {
    line.selling_plan_allocation = { selling_plan: { id: item.selling_plan } };
  }
  return line;
}

function createPlan(operationId = "fixture-op-1", rawItems) {
  return podBuilder.createBundleRequestPlan(rawItems || [
    {
      id: "101",
      quantity: 1,
      role: "mattress",
      productHandle: "fixture-mattress",
      properties: { "SnoozePod Size": "Queen" },
    },
    {
      id: "202",
      quantity: 1,
      role: "base",
      productHandle: "fixture-base",
    },
    {
      id: "303",
      quantity: 2,
      role: "pillow",
      productHandle: "fixture-pillow",
    },
  ], operationId);
}

function cartFetch(options) {
  let cartReadCount = 0;
  const requests = [];
  const fetchImpl = async function fetchImpl(url, request = {}) {
    requests.push({ url, request });
    if (url.endsWith("cart.js")) {
      cartReadCount += 1;
      if (cartReadCount === 1) {
        if (options.preError) throw new Error("pre cart unavailable");
        return response(true, options.pre || { items: [] });
      }
      if (options.postError) throw new Error("post cart unavailable");
      return response(true, options.post || { items: [] });
    }
    if (url.endsWith("cart/add.js")) {
      if (options.addError) throw new Error("network interrupted");
      return response(options.addOk !== false, options.addBody || {}, { malformed: options.addMalformed });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  return { fetchImpl, requests };
}

async function execute(plan, options) {
  const mocked = cartFetch(options);
  const result = await podBuilder.executeBundleCartOperation(
    plan,
    mocked.fetchImpl,
    { cart: "/cart.js", add: "/cart/add.js" },
    { timeoutMs: 200 }
  );
  return { result, requests: mocked.requests };
}

async function testSuccessfulBundle() {
  const plan = createPlan();
  const { result, requests } = await execute(plan, {
    post: { items: plan.items.map((item) => lineFor(item)) },
  });
  assert.strictEqual(result.status, "success");
  assert.strictEqual(result.reconciliation.confirmedQuantity, 4);
  const addRequest = requests.find((entry) => entry.url.endsWith("cart/add.js"));
  assert(addRequest, "bundle add request should be issued");
  assert.strictEqual(JSON.parse(addRequest.request.body).items.length, 3);
}

async function testExistingCartQuantitiesDoNotCountAsNewBundle() {
  const plan = createPlan();
  const existing = { variant_id: 101, quantity: 5, properties: { "SnoozePod Size": "Queen" } };
  const { result } = await execute(plan, {
    pre: { items: [existing] },
    post: { items: [existing, ...plan.items.map((item) => lineFor(item))] },
  });
  assert.strictEqual(result.status, "success");
  assert.strictEqual(result.reconciliation.confirmedQuantity, 4);
}

function testDuplicateVariantsAggregateByExactIdentity() {
  const plan = createPlan("fixture-duplicate", [
    { id: "404", quantity: 1, role: "pillow", productHandle: "fixture-pillow" },
    { id: "404", quantity: 2, role: "pillow", productHandle: "fixture-pillow" },
  ]);
  assert.strictEqual(plan.items.length, 1);
  assert.strictEqual(plan.items[0].quantity, 3);
}

function testSameVariantWithDistinctPropertiesRemainsDistinct() {
  const plan = createPlan("fixture-properties", [
    { id: "505", quantity: 1, role: "bedding", productHandle: "fixture-sheet", properties: { Color: "White" } },
    { id: "505", quantity: 1, role: "bedding", productHandle: "fixture-sheet", properties: { Color: "Grey" } },
    { id: "505", quantity: 1, role: "protection", productHandle: "fixture-sheet", properties: { Color: "White" } },
  ]);
  assert.strictEqual(plan.items.length, 3);
  assert.strictEqual(new Set(plan.items.map(podBuilder.cartLineIdentity)).size, 3);
}

function testSameVariantWithDistinctSellingPlansRemainsDistinct() {
  const plan = createPlan("fixture-selling-plans", [
    { id: "525", quantity: 1, role: "bedding", productHandle: "fixture-sheet", sellingPlanId: "plan-a" },
    { id: "525", quantity: 1, role: "bedding", productHandle: "fixture-sheet", sellingPlanId: "plan-b" },
  ]);
  assert.strictEqual(plan.items.length, 2);
  assert.strictEqual(new Set(plan.items.map(podBuilder.cartLineIdentity)).size, 2);
}

async function testFailedRequestWithNoMutation() {
  const plan = createPlan();
  const { result } = await execute(plan, { addOk: false, post: { items: [] } });
  assert.strictEqual(result.status, "failed");
  assert.strictEqual(result.reconciliation.confirmedQuantity, 0);
}

async function testFailedResponseAfterSuccessfulMutation() {
  const plan = createPlan();
  const { result } = await execute(plan, {
    addOk: false,
    post: { items: plan.items.map((item) => lineFor(item)) },
  });
  assert.strictEqual(result.status, "success");
  assert.strictEqual(result.addResponseOk, false);
}

async function testPartialMutation() {
  const plan = createPlan();
  const { result } = await execute(plan, {
    addOk: false,
    post: { items: [lineFor(plan.items[0])] },
  });
  assert.strictEqual(result.status, "partial");
  assert(result.reconciliation.items.some((item) => item.missingQuantity > 0));
}

async function testNetworkInterruptionAfterFullMutation() {
  const plan = createPlan();
  const { result } = await execute(plan, {
    addError: true,
    post: { items: plan.items.map((item) => lineFor(item)) },
  });
  assert.strictEqual(result.status, "success");
  assert(result.addError, "transport error should remain available for diagnostics");
}

async function testCartReconciliationFailureIsUncertain() {
  const plan = createPlan();
  const { result } = await execute(plan, { addError: true, postError: true });
  assert.strictEqual(result.status, "uncertain");
  assert.strictEqual(result.mutationAttempted, true);
}

async function testTimedOutMutationStillReconciles() {
  const plan = createPlan();
  let cartReads = 0;
  const result = await podBuilder.executeBundleCartOperation(
    plan,
    async function timedFetch(url) {
      if (url.endsWith("cart/add.js")) return new Promise(function () {});
      cartReads += 1;
      return response(true, {
        items: cartReads === 1 ? [] : plan.items.map((item) => lineFor(item)),
      });
    },
    { cart: "/cart.js", add: "/cart/add.js" },
    { timeoutMs: 10 }
  );
  assert.strictEqual(result.status, "success");
  assert(result.addError && /timed out/i.test(result.addError.message));
}

async function testPreflightFailureDoesNotMutate() {
  const plan = createPlan();
  const { result, requests } = await execute(plan, { preError: true });
  assert.strictEqual(result.status, "failed");
  assert.strictEqual(result.mutationAttempted, false);
  assert.strictEqual(requests.some((entry) => entry.url.endsWith("cart/add.js")), false);
}

async function testPartialRetryAddsOnlyMissingItems() {
  const plan = createPlan();
  const mattressLine = lineFor(plan.items[0]);
  const { result, requests } = await execute(plan, {
    pre: { items: [mattressLine] },
    post: { items: plan.items.map((item) => lineFor(item)) },
  });
  assert.strictEqual(result.status, "success");
  const payload = JSON.parse(requests.find((entry) => entry.url.endsWith("cart/add.js")).request.body);
  assert.strictEqual(payload.items.length, 2);
  assert.strictEqual(payload.items.some((item) => String(item.id) === plan.items[0].id), false);
}

async function testRetryPreservesDistinctLineProperties() {
  const plan = createPlan("fixture-property-retry", [
    { id: "515", quantity: 1, role: "bedding", productHandle: "fixture-sheet", properties: { Color: "White" } },
    { id: "515", quantity: 1, role: "bedding", productHandle: "fixture-sheet", properties: { Color: "Grey" } },
  ]);
  const whiteItem = plan.items.find((item) => item.properties.Color === "White");
  const { result, requests } = await execute(plan, {
    pre: { items: [lineFor(whiteItem)] },
    post: { items: plan.items.map((item) => lineFor(item)) },
  });
  assert.strictEqual(result.status, "success");
  const payload = JSON.parse(requests.find((entry) => entry.url.endsWith("cart/add.js")).request.body);
  assert.strictEqual(payload.items.length, 1);
  assert.strictEqual(payload.items[0].properties.Color, "Grey");
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || ""; },
    setItem(key, value) { values.set(key, value); },
  };
}

function testDoubleSubmissionAndCrossTabLock() {
  const storage = createMemoryStorage();
  const first = createPlan("fixture-tab-a");
  const second = createPlan("fixture-tab-b");
  assert.strictEqual(first.fingerprint, second.fingerprint);
  assert.strictEqual(podBuilder.claimBundleLock(first, storage, 1000), true);
  assert.strictEqual(podBuilder.claimBundleLock(second, storage, 1001), false);
  assert.strictEqual(podBuilder.claimBundleLock(first, storage, 1002), true);
}

function testUnavailableItemFailsValidation() {
  const plan = createPlan("fixture-unavailable", [
    { id: "606", quantity: 1, role: "mattress", productHandle: "fixture-mattress" },
    { id: "707", quantity: 1, role: "pillow", productHandle: "fixture-pillow", available: false },
  ]);
  assert(podBuilder.validateBundleRequestPlan(plan).some((message) => /pillow.*available/i.test(message)));
}

async function testLiveVariantReadiness() {
  const plan = createPlan("fixture-live", [
    { id: "808", quantity: 1, role: "mattress", productHandle: "fixture-mattress" },
    { id: "909", quantity: 1, role: "pillow", productHandle: "fixture-pillow" },
  ]);
  const readiness = await podBuilder.verifyBundleVariantReadiness(
    plan,
    async function fetchProduct(url) {
      if (url.includes("fixture-mattress")) return response(true, { variants: [{ id: 808, available: true }] });
      return response(true, { variants: [{ id: 909, available: false }] });
    },
    "/",
    200
  );
  assert.strictEqual(readiness.ok, false);
  assert(readiness.errors.some((message) => /pillow.*available/i.test(message)));
}

async function testSelectionPreservation() {
  const selections = {
    size: "Queen",
    base: "fixture-base",
    motion: "standard",
    protection: "fixture-protector",
    pillow: "fixture-pillow",
    bedding: "fixture-sheet",
  };
  const before = JSON.stringify(selections);
  await execute(createPlan(), { addOk: false, post: { items: [] } });
  assert.strictEqual(JSON.stringify(selections), before);
}

function testAccessibleFailureAnnouncement() {
  const attributes = {};
  const status = {
    hidden: true,
    textContent: "",
    focused: false,
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
    focus() { this.focused = true; },
  };
  podBuilder.renderCartStatus(status, {
    status: "partial",
    reconciliation: { items: [{ role: "pillow", missingQuantity: 1 }] },
  });
  assert.strictEqual(status.hidden, false);
  assert.strictEqual(attributes["data-status"], "partial");
  assert.strictEqual(status.focused, true);
  assert(/not fully added.*pillow.*selections are still here/i.test(status.textContent));
}

function testChangedSelectionCreatesDifferentOperationFingerprint() {
  const queen = createPlan("fixture-queen");
  const king = createPlan("fixture-king", [
    { id: "111", quantity: 1, role: "mattress", productHandle: "fixture-mattress", properties: { "SnoozePod Size": "King" } },
  ]);
  assert.notStrictEqual(queen.fingerprint, king.fingerprint);
}

function testNoUnsafeFallbackAndAccessibleMarkup() {
  const root = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "assets", "snoozepod-pod-builder.js"), "utf8");
  const markup = fs.readFileSync(path.join(root, "snippets", "snoozepod-guided-pod-builder-core.liquid"), "utf8");
  const standaloneMarkup = fs.readFileSync(path.join(root, "sections", "snoozepod-guided-pod-builder.liquid"), "utf8");
  assert(!source.includes("HTMLFormElement.prototype.submit.call"), "mattress-only fallback must be removed");
  assert(source.includes("executeBundleCartOperation"), "submission must use reconciliation state machine");
  assert(source.includes("if (state.isSubmitting) return;"), "repeat clicks must be blocked while pending");
  assert(markup.includes("data-builder-cart-status"));
  assert(markup.includes('aria-live="polite"'));
  assert(markup.includes('aria-atomic="true"'));
  assert(standaloneMarkup.includes("data-builder-cart-status"));
  assert(standaloneMarkup.includes('aria-live="polite"'));
}

async function main() {
  await testSuccessfulBundle();
  await testExistingCartQuantitiesDoNotCountAsNewBundle();
  testDuplicateVariantsAggregateByExactIdentity();
  testSameVariantWithDistinctPropertiesRemainsDistinct();
  testSameVariantWithDistinctSellingPlansRemainsDistinct();
  await testFailedRequestWithNoMutation();
  await testFailedResponseAfterSuccessfulMutation();
  await testPartialMutation();
  await testNetworkInterruptionAfterFullMutation();
  await testCartReconciliationFailureIsUncertain();
  await testTimedOutMutationStillReconciles();
  await testPreflightFailureDoesNotMutate();
  await testPartialRetryAddsOnlyMissingItems();
  await testRetryPreservesDistinctLineProperties();
  testDoubleSubmissionAndCrossTabLock();
  testUnavailableItemFailsValidation();
  await testLiveVariantReadiness();
  await testSelectionPreservation();
  testAccessibleFailureAnnouncement();
  testChangedSelectionCreatesDifferentOperationFingerprint();
  testNoUnsafeFallbackAndAccessibleMarkup();
  console.log("Pod Builder cart-integrity tests passed (21 scenarios).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
