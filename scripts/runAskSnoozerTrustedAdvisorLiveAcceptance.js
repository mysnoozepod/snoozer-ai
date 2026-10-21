#!/usr/bin/env node

const assert = require("assert");
const fixture = require("../tests/fixtures/ask-snoozer-trusted-advisor-10-turn.v1.json");
const { INTERNAL_LANGUAGE } = require("../services/askSnoozerConversationOrchestrator");

const API_BASE = String(
  process.env.ASK_SNOOZER_API_BASE ||
    "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod"
).replace(/\/$/, "");

const canonicalContext = {
  assessment: { answers: fixture.shopper.assessment },
  canonicalRecommendation: {
    topPodId: fixture.shopper.canonicalRecommendation.podId,
    primaryMattressHandle: fixture.shopper.canonicalRecommendation.mattressHandle,
    normalizedAssessment: {
      size: fixture.shopper.assessment.size,
      position: "side",
      painPoints: fixture.shopper.assessment.painPoints,
    },
  },
};

function responseText(body) {
  return String(body?.reply || body?.answer || body?.message?.text || body?.speech || "").trim();
}

function productPrice(product) {
  return Number(product?.price?.amount ?? product?.price);
}

async function ask({ message, sessionId, snoozeCode = "", testCaseId }) {
  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}/ask-snoozer`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-session-id": sessionId,
      "x-request-id": `${testCaseId}-${Date.now()}`,
      ...(snoozeCode ? { "x-snooze-code": snoozeCode } : {}),
    },
    body: JSON.stringify({
      message,
      mode: "ask_snoozer_page",
      surface: "live_acceptance",
      source: "trusted_advisor_live_acceptance",
      sessionId,
      snoozeCode: snoozeCode || null,
      testCaseId,
      context: canonicalContext,
    }),
  });
  const body = await response.json();
  assert.strictEqual(response.status, 200, `${testCaseId} returned HTTP ${response.status}`);
  assert(body?.ok !== false, `${testCaseId} failed: ${JSON.stringify(body?.error || body?.reply)}`);
  return { body, elapsedMs: Date.now() - startedAt };
}

function validateBody(body, label) {
  const reply = responseText(body);
  assert(reply && /[.!?]$/.test(reply) && !reply.endsWith("..."), `${label} has an incomplete reply`);
  const lower = reply.toLowerCase();
  for (const phrase of INTERNAL_LANGUAGE) {
    assert(!lower.includes(phrase), `${label} leaked internal language: ${phrase}`);
  }
  assert(body?.metadata?.metrics?.fallbackUsed !== true, `${label} used a fallback response`);
  assert(body?.metadata?.qualityGate?.factsResolved !== false, `${label} did not resolve its facts`);
  const quote = body?.context?.askSnoozerWorkingMemory?.activeDeal?.activeQuote;
  if (quote?.ok && body?.metadata?.qualityGate?.answerType === "commerce_answer") {
    for (const item of quote.items || []) {
      const card = (body.products || []).find((product) => product.handle === item.handle);
      assert(card, `${label} is missing the ${item.handle} quote card`);
      assert.strictEqual(productPrice(card), Number(item.price), `${label} has a quote/card price mismatch`);
    }
  }
  return reply;
}

function validateTurnExpectations(body, turn, reply) {
  const expected = turn.expects || {};
  const lower = reply.toLowerCase();
  for (const phrase of expected.doesNotContain || []) {
    assert(!lower.includes(String(phrase).toLowerCase()), `${turn.id} should not include ${phrase}`);
  }

  const quote = body?.context?.askSnoozerWorkingMemory?.activeDeal?.activeQuote;
  if (expected.quoteHandles) {
    const quoteHandles = (quote?.items || []).map((item) => item.handle);
    const productHandles = (body?.products || []).map((product) => product.handle);
    if (quoteHandles.length > 0) {
      assert.deepStrictEqual(quoteHandles, expected.quoteHandles, `${turn.id} returned the wrong quote line items`);
    } else {
      assert(
        expected.quoteHandles.length === 1 && productHandles.includes(expected.quoteHandles[0]),
        `${turn.id} returned neither the expected structured quote nor its exact product card`
      );
    }
  }
  const requiresStructuredQuote = Boolean(expected.motionKey || (expected.quoteHandles || []).length > 1);
  if (requiresStructuredQuote) assert(quote?.ok, `${turn.id} did not create a structured quote`);
  if (expected.size && quote) assert.strictEqual(quote.size, expected.size, `${turn.id} returned the wrong quote size`);
  if (expected.motionKey) assert.strictEqual(quote.motionKey, expected.motionKey, `${turn.id} returned the wrong motion option`);
  if (expected.cartReady !== undefined && quote) {
    assert.strictEqual(Boolean(quote?.cartReady), expected.cartReady, `${turn.id} returned the wrong cart readiness`);
  }
}

async function main() {
  const suffix = Date.now().toString(36);
  const sessionId = `trusted-advisor-live-${suffix}`;
  const latencies = [];
  const taskTypes = [];
  for (const turn of fixture.turns) {
    const { body, elapsedMs } = await ask({
      message: turn.message,
      sessionId,
      testCaseId: `trusted-advisor-live-${turn.id}`,
    });
    const reply = validateBody(body, turn.id);
    validateTurnExpectations(body, turn, reply);
    latencies.push(elapsedMs);
    taskTypes.push(body?.metadata?.qualityGate?.intent || "unknown");
    const canonical = body?.context?.askSnoozerWorkingMemory?.activeDeal?.canonicalRecommendation;
    if (turn.expects.canonicalHandle) {
      assert.strictEqual(canonical?.primaryMattressHandle, turn.expects.canonicalHandle, `${turn.id} changed the recommendation`);
    }
  }

  const snoozeCode = String(100000 + (Date.now() % 900000));
  const first = await ask({
    message: "I liked the elevated position.",
    sessionId: `trusted-advisor-live-device-a-${suffix}`,
    snoozeCode,
    testCaseId: "trusted-advisor-live-cross-device-a",
  });
  const second = await ask({
    message: "What did I say I liked?",
    sessionId: `trusted-advisor-live-device-b-${suffix}`,
    snoozeCode,
    testCaseId: "trusted-advisor-live-cross-device-b",
  });
  validateBody(first.body, "cross-device-a");
  const recalled = validateBody(second.body, "cross-device-b");
  assert.strictEqual(first.body.sessionId, second.body.sessionId, "same Snooze Code did not share a session");
  assert(/elevated position/i.test(recalled), "cross-device turn did not recall elevation preference");

  const sorted = [...latencies].sort((a, b) => a - b);
  const average = Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  console.log(JSON.stringify({
    ok: true,
    apiBase: API_BASE,
    exactTurns: fixture.turns.length,
    plannerTasks: taskTypes,
    crossDeviceContinuity: true,
    averageLatencyMs: average,
    p95LatencyMs: p95,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
