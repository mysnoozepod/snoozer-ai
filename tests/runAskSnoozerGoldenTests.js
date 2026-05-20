#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  canonicalizeHudHref,
  isKnownDeadHudHref,
  isSafeHudInternalHref,
} = require("../services/askSnoozerRoutes");

const FIXTURE_PATH = path.join(__dirname, "askSnoozerGoldenSet.json");
const MAX_REPLY_LENGTH = 220;
const CONFIDENCE_RANK = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
});

function loadCases() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

function buildEvent(testCase) {
  const body = {
    query: testCase.query,
    path: testCase.context?.path || "/",
    page_type: testCase.context?.page_type || "unknown",
    surface: testCase.context?.surface || "shopify_header",
  };

  return {
    version: "2.0",
    routeKey: "POST /hud/ask",
    rawPath: "/hud/ask",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      origin: "https://mysnoozepod.com",
      host: "local.ask-snoozer.test",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/hud/ask",
        sourceIp: "127.0.0.1",
        userAgent: "ask-snoozer-golden-test",
      },
      requestId: `golden-${testCase.id}`,
      routeKey: "POST /hud/ask",
      stage: "local",
      timeEpoch: Date.now(),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function parseResponseBody(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return {
      __parseError: error.message,
      __rawBody: raw,
    };
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function summarizeVisibleText(payload) {
  const parts = [];
  if (typeof payload?.reply === "string") parts.push(payload.reply);

  for (const chip of toArray(payload?.chips)) {
    if (typeof chip?.label === "string") parts.push(chip.label);
    if (typeof chip?.value === "string") parts.push(chip.value);
  }

  for (const item of [
    ...toArray(payload?.actions),
    ...toArray(payload?.collections),
    ...toArray(payload?.pages),
    ...toArray(payload?.products),
  ]) {
    if (typeof item?.label === "string") parts.push(item.label);
    if (typeof item?.title === "string") parts.push(item.title);
    if (typeof item?.reason === "string") parts.push(item.reason);
    for (const tag of toArray(item?.tags)) {
      if (typeof tag === "string") parts.push(tag);
    }
  }

  return parts.join(" ").toLowerCase();
}

function isSafeInternalHref(href) {
  return isSafeHudInternalHref(href, {
    allowProducts: true,
    allowPages: true,
    allowCollections: true,
    allowStaticProducts: true,
  });
}

function isSafeProductHref(href) {
  const canonical = canonicalizeHudHref(href, {
    allowProducts: true,
    allowPages: false,
    allowCollections: false,
    allowStaticProducts: true,
  });
  return Boolean(canonical) && canonical.startsWith("/products/");
}

function addFailure(failures, category, message) {
  failures.push({ category, message });
}

function validateContract(payload, failures) {
  const requiredStringFields = ["status", "reply", "intent", "intent_group", "confidence_label"];
  for (const field of requiredStringFields) {
    if (typeof payload?.[field] !== "string" || !payload[field].trim()) {
      addFailure(failures, "response_contract_break", `Missing or invalid string field: ${field}`);
    }
  }

  if (typeof payload?.confidence !== "number" || Number.isNaN(payload.confidence)) {
    addFailure(failures, "response_contract_break", "Missing or invalid numeric field: confidence");
  }

  const requiredArrayFields = ["chips", "actions", "products", "collections", "pages"];
  for (const field of requiredArrayFields) {
    if (!Array.isArray(payload?.[field])) {
      addFailure(failures, "response_contract_break", `Missing or invalid array field: ${field}`);
    }
  }

  if (!payload?.meta || typeof payload.meta !== "object" || Array.isArray(payload.meta)) {
    addFailure(failures, "response_contract_break", "Missing or invalid object field: meta");
  }

  if (
    payload?.thread_id != null &&
    typeof payload.thread_id !== "string"
  ) {
    addFailure(failures, "response_contract_break", "thread_id must be a string when present");
  }
}

function validateGuardrails(payload, failures) {
  const reply = typeof payload?.reply === "string" ? payload.reply : "";
  const visibleText = summarizeVisibleText(payload);
  const answerStrategy = String(payload?.meta?.answer_strategy || "").trim();
  const priceReplyAllowed =
    (answerStrategy === "verified_price" || answerStrategy === "verified_bundle_price") &&
    payload?.intent_group === "size_price" &&
    Boolean(payload?.meta?.answer_grounded);

  if (reply.length > MAX_REPLY_LENGTH) {
    addFailure(
      failures,
      "reply_too_verbose",
      `Reply length ${reply.length} exceeds ${MAX_REPLY_LENGTH}`
    );
  }

  if (/product_id|variant_id|traceId|requestId|stack/i.test(reply)) {
    addFailure(failures, "response_contract_break", "Reply contains internal/debug text");
  }

  if (/product_id|variant_id/i.test(visibleText)) {
    addFailure(failures, "response_contract_break", "Visible text exposes internal product identifiers");
  }

  if (!priceReplyAllowed && /\$\s*\d|\b\d+\s*(?:\/mo|per month|monthly)\b/i.test(reply)) {
    addFailure(failures, "unsafe_claim", "Reply contains unverified price language");
  }

  if (/\bcure|heal|treat|guarantee\b/i.test(reply)) {
    addFailure(failures, "unsafe_claim", "Reply contains unsafe or over-promising language");
  }

  const products = toArray(payload?.products);
  if (products.length > 3) {
    addFailure(failures, "unsafe_product", `Returned ${products.length} products; max is 3`);
  }

  const allHrefs = [];

  for (const product of products) {
    if (String(product?.type || "").trim() !== "product") {
      addFailure(failures, "unsafe_product", "Product entry missing type=product");
    }
    if (!isSafeProductHref(product?.href)) {
      addFailure(
        failures,
        "unsafe_product",
        `Unsafe product href: ${String(product?.href || "") || "(blank)"}`
      );
    }
    if (!String(product?.handle || "").trim()) {
      addFailure(failures, "unsafe_product", "Product missing handle");
    }
    allHrefs.push(String(product?.href || ""));
  }

  for (const item of [
    ...toArray(payload?.actions),
    ...toArray(payload?.collections),
    ...toArray(payload?.pages),
  ]) {
    if (!String(item?.label || "").trim()) {
      addFailure(failures, "response_contract_break", "Action/page/collection entry missing label");
    }
    if (!isSafeInternalHref(item?.href)) {
      addFailure(
        failures,
        "response_contract_break",
        `Unsafe action/page/collection href: ${String(item?.href || "") || "(blank)"}`
      );
    }
    if (isKnownDeadHudHref(item?.href)) {
      addFailure(
        failures,
        "response_contract_break",
        `Known-dead action/page/collection href: ${String(item?.href || "") || "(blank)"}`
      );
    }
    allHrefs.push(String(item?.href || ""));
  }

  const seen = new Set();
  const duplicates = new Set();
  for (const href of allHrefs.filter(Boolean)) {
    if (seen.has(href)) duplicates.add(href);
    seen.add(href);
  }
  if (duplicates.size > 0) {
    addFailure(
      failures,
      "response_contract_break",
      `Duplicate hrefs detected: ${Array.from(duplicates).join(", ")}`
    );
  }
}

function validateExpectedBehavior(testCase, payload, failures) {
  const expected = testCase.expected || {};
  const products = toArray(payload?.products);
  const handles = products.map((product) => String(product?.handle || "").trim()).filter(Boolean);
  const hrefPool = [
    ...toArray(payload?.actions),
    ...toArray(payload?.collections),
    ...toArray(payload?.pages),
    ...products,
  ]
    .map((item) => canonicalizeHudHref(String(item?.href || "").trim(), {
      allowProducts: true,
      allowPages: true,
      allowCollections: true,
      allowStaticProducts: true,
    }))
    .filter(Boolean);

  if (expected.intent_group && payload?.intent_group !== expected.intent_group) {
    addFailure(
      failures,
      "wrong_intent_group",
      `Expected intent_group=${expected.intent_group}, got ${payload?.intent_group || "(blank)"}`
    );
  }

  if (
    expected.policy_subtype &&
    String(payload?.policy_subtype || "").trim() !== String(expected.policy_subtype).trim()
  ) {
    addFailure(
      failures,
      "wrong_intent",
      `Expected policy_subtype=${expected.policy_subtype}, got ${payload?.policy_subtype || "(blank)"}`
    );
  }

  if (
    Array.isArray(expected.accepted_intents) &&
    expected.accepted_intents.length > 0 &&
    !expected.accepted_intents.includes(payload?.intent)
  ) {
    addFailure(
      failures,
      "wrong_intent",
      `Expected one of [${expected.accepted_intents.join(", ")}], got ${payload?.intent || "(blank)"}`
    );
  }

  if (expected.confidence_label_min) {
    const actualRank = CONFIDENCE_RANK[String(payload?.confidence_label || "").toLowerCase()] || 0;
    const minRank = CONFIDENCE_RANK[String(expected.confidence_label_min).toLowerCase()] || 0;
    if (actualRank < minRank) {
      addFailure(
        failures,
        "low_confidence",
        `Expected confidence >= ${expected.confidence_label_min}, got ${payload?.confidence_label || "(blank)"}`
      );
    }
  }

  if (expected.products) {
    const minProducts = Number.isFinite(expected.products.min) ? expected.products.min : null;
    const maxProducts = Number.isFinite(expected.products.max) ? expected.products.max : null;

    if (minProducts != null && products.length < minProducts) {
      addFailure(
        failures,
        payload?.intent_group === "fallback_unclear" ? "unexpected_fallback" : "missing_products",
        `Expected at least ${minProducts} products, got ${products.length}`
      );
    }

    if (maxProducts != null && products.length > maxProducts) {
      addFailure(
        failures,
        "unsafe_product",
        `Expected at most ${maxProducts} products, got ${products.length}`
      );
    }

    if (Array.isArray(expected.products.expected_handles) && expected.products.expected_handles.length > 0) {
      const missing = expected.products.expected_handles.filter((handle) => !handles.includes(handle));
      if (missing.length > 0) {
        addFailure(
          failures,
          "wrong_product_priority",
          `Missing expected product handles: ${missing.join(", ")}`
        );
      }
    }

    if (
      typeof expected.products.preferred_first_handle === "string" &&
      expected.products.preferred_first_handle.trim()
    ) {
      if (handles[0] !== expected.products.preferred_first_handle) {
        addFailure(
          failures,
          "wrong_product_priority",
          `Expected first product ${expected.products.preferred_first_handle}, got ${handles[0] || "(none)"}`
        );
      }
    }

    if (Array.isArray(expected.products.preferred_handles) && expected.products.preferred_handles.length > 0) {
      const overlap = expected.products.preferred_handles.filter((handle) => handles.includes(handle));
      if (products.length > 0 && overlap.length === 0) {
        addFailure(
          failures,
          "wrong_product_priority",
          `Expected at least one preferred handle from [${expected.products.preferred_handles.join(", ")}]`
        );
      }
    }
  }

  if (Array.isArray(expected.required_hrefs) && expected.required_hrefs.length > 0) {
    const requiredHrefs = expected.required_hrefs
      .map((href) =>
        canonicalizeHudHref(String(href || "").trim(), {
          allowProducts: true,
          allowPages: true,
          allowCollections: true,
          allowStaticProducts: true,
        })
      )
      .filter(Boolean);
    const missing = requiredHrefs.filter((href) => !hrefPool.includes(href));
    if (missing.length > 0) {
      addFailure(
        failures,
        "missing_action",
        `Missing required hrefs: ${missing.join(", ")}`
      );
    }
  }

  if (typeof expected.policy_retrieved === "boolean") {
    if (Boolean(payload?.meta?.policy_retrieved) !== expected.policy_retrieved) {
      addFailure(
        failures,
        expected.policy_retrieved ? "unexpected_fallback" : "response_contract_break",
        `Expected meta.policy_retrieved=${expected.policy_retrieved}, got ${Boolean(payload?.meta?.policy_retrieved)}`
      );
    }
  }

  if (typeof expected.policy_answer_grounded === "boolean") {
    if (Boolean(payload?.meta?.policy_answer_grounded) !== expected.policy_answer_grounded) {
      addFailure(
        failures,
        expected.policy_answer_grounded ? "unexpected_fallback" : "response_contract_break",
        `Expected meta.policy_answer_grounded=${expected.policy_answer_grounded}, got ${Boolean(payload?.meta?.policy_answer_grounded)}`
      );
    }
  }

  if (typeof expected.answer_grounded === "boolean") {
    if (Boolean(payload?.meta?.answer_grounded) !== expected.answer_grounded) {
      addFailure(
        failures,
        expected.answer_grounded ? "unexpected_fallback" : "response_contract_break",
        `Expected meta.answer_grounded=${expected.answer_grounded}, got ${Boolean(payload?.meta?.answer_grounded)}`
      );
    }
  }

  if (Array.isArray(expected.policy_source_any_of) && expected.policy_source_any_of.length > 0) {
    const actualSource = String(payload?.meta?.policy_source || "").trim();
    if (!expected.policy_source_any_of.includes(actualSource)) {
      addFailure(
        failures,
        "unexpected_fallback",
        `Expected policy source in [${expected.policy_source_any_of.join(", ")}], got ${actualSource || "(blank)"}`
      );
    }
  }

  if (Array.isArray(expected.answer_source_any_of) && expected.answer_source_any_of.length > 0) {
    const actualSource = String(payload?.meta?.answer_source_type || "").trim();
    if (!expected.answer_source_any_of.includes(actualSource)) {
      addFailure(
        failures,
        "unexpected_fallback",
        `Expected answer source in [${expected.answer_source_any_of.join(", ")}], got ${actualSource || "(blank)"}`
      );
    }
  }

  if (Number.isFinite(expected.answer_facts_count_min)) {
    const actualFacts = Number(payload?.meta?.answer_facts_count || 0);
    if (actualFacts < expected.answer_facts_count_min) {
      addFailure(
        failures,
        expected.answer_facts_count_min > 0 ? "unexpected_fallback" : "response_contract_break",
        `Expected meta.answer_facts_count >= ${expected.answer_facts_count_min}, got ${actualFacts}`
      );
    }
  }

  const visibleText = summarizeVisibleText(payload);

  if (Array.isArray(expected.must_include)) {
    const missingTerms = expected.must_include.filter((term) => {
      const normalized = String(term || "").trim().toLowerCase();
      return normalized && !visibleText.includes(normalized);
    });
    if (missingTerms.length > 0) {
      addFailure(
        failures,
        "response_contract_break",
        `Missing expected visible terms: ${missingTerms.join(", ")}`
      );
    }
  }

  if (Array.isArray(expected.must_not_include)) {
    const foundTerms = expected.must_not_include.filter((term) => {
      const normalized = String(term || "").trim().toLowerCase();
      return normalized && visibleText.includes(normalized);
    });
    if (foundTerms.length > 0) {
      addFailure(
        failures,
        "unsafe_claim",
        `Found forbidden visible terms: ${foundTerms.join(", ")}`
      );
    }
  }
}

async function invokeTestCase(lambdaHandler, testCase) {
  const event = buildEvent(testCase);
  const response = await lambdaHandler(event);
  const payload = parseResponseBody(response?.body);
  return {
    statusCode: response?.statusCode,
    payload,
  };
}

async function run() {
  const cases = loadCases();
  const failuresByCategory = new Map();
  const failedTests = [];
  let passed = 0;

  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};

  try {
    const { lambdaHandler } = require("../index");

    for (const testCase of cases) {
      const failures = [];
      let result;

      try {
        result = await invokeTestCase(lambdaHandler, testCase);
      } catch (error) {
        addFailure(
          failures,
          "response_contract_break",
          `Unhandled execution error: ${error.message}`
        );
      }

      if (result) {
        if (result.statusCode !== 200) {
          addFailure(
            failures,
            "response_contract_break",
            `Expected statusCode 200, got ${result.statusCode}`
          );
        }

        if (result.payload?.__parseError) {
          addFailure(
            failures,
            "response_contract_break",
            `Response body parse failed: ${result.payload.__parseError}`
          );
        } else {
          validateContract(result.payload, failures);
          validateGuardrails(result.payload, failures);
          validateExpectedBehavior(testCase, result.payload, failures);
        }
      }

      if (failures.length === 0) {
        passed += 1;
        continue;
      }

      failedTests.push({
        id: testCase.id,
        category: testCase.category,
        query: testCase.query,
        failures,
      });

      for (const failure of failures) {
        failuresByCategory.set(
          failure.category,
          (failuresByCategory.get(failure.category) || 0) + 1
        );
      }
    }
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  const total = cases.length;
  const failed = failedTests.length;

  originalConsole.log(`Ask Snoozer Golden Test Set v1`);
  originalConsole.log(`Fixture: ${FIXTURE_PATH}`);
  originalConsole.log(`Total tests: ${total}`);
  originalConsole.log(`Passed: ${passed}`);
  originalConsole.log(`Failed: ${failed}`);

  if (failuresByCategory.size > 0) {
    originalConsole.log(`Failure categories:`);
    for (const [category, count] of Array.from(failuresByCategory.entries()).sort((a, b) => b[1] - a[1])) {
      originalConsole.log(`- ${category}: ${count}`);
    }
  }

  if (failedTests.length > 0) {
    originalConsole.log(`Failed cases:`);
    for (const failedTest of failedTests) {
      originalConsole.log(`- ${failedTest.id} (${failedTest.category}) :: ${failedTest.query}`);
      for (const failure of failedTest.failures) {
        originalConsole.log(`  [${failure.category}] ${failure.message}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  originalConsole.log(`All tests passed.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
