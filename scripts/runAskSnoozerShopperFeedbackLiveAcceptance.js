#!/usr/bin/env node

const assert = require("assert");
const { INTERNAL_LANGUAGE } = require("../services/askSnoozerConversationOrchestrator");

const API_BASE = String(
  process.env.ASK_SNOOZER_API_BASE || "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod"
).replace(/\/$/, "");

const canonicalContext = {
  assessment: {
    answers: {
      size: "King",
      sleepPosition: "side",
      firmness: "soft",
      painPoints: ["shoulder", "hip"],
      motion: "standard",
    },
  },
  canonicalRecommendation: {
    topPodId: "4",
    primaryMattressHandle: "12-all-foam-mattress",
    primaryMattressTitle: "12-inch All Foam Mattress",
    size: "King",
    motionKey: "standard",
    normalizedAssessment: {
      size: "King",
      sleepPosition: "side",
      painPoints: ["shoulder", "hip"],
    },
  },
};

const turns = [
  "The 12-inch All Foam was too firm, but I like the motion features.",
  "It was just too firm.",
  "I want softer.",
  "I didn't like that one.",
  "Yes.",
  "Stop telling me about the All Foam.",
  "Softer.",
  "No.",
  "I'm confused.",
  "Recommend me any other mattress but the All Foam.",
];

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function activeDeal(body = {}) {
  return body?.context?.askSnoozerWorkingMemory?.activeDeal || {};
}

function rejectedHandles(body = {}) {
  return (activeDeal(body).rejectedProducts || [])
    .filter((item) => clean(item?.status || "rejected") === "rejected")
    .map((item) => clean(item?.handle).toLowerCase());
}

function renderedHandles(body = {}) {
  return [
    ...(body.products || []).map((product) => clean(product?.handle).toLowerCase()),
    ...(body.actions || []).map((action) => clean(action?.payload?.handle || action?.handle).toLowerCase()),
  ].filter(Boolean);
}

async function ask({ message, sessionId, testCaseId, turn }) {
  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}/ask-snoozer`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-session-id": sessionId,
      "x-request-id": `${testCaseId}-turn-${turn}`,
    },
    body: JSON.stringify({
      message,
      mode: "ask_snoozer_page",
      surface: "journey_os_phase_1_live_acceptance",
      source: "journey_os_phase_1_live_acceptance",
      sessionId,
      testCaseId,
      context: canonicalContext,
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `turn ${turn} HTTP ${response.status}`);
  assert.notEqual(body?.ok, false, `turn ${turn}: ${JSON.stringify(body?.error || body?.reply)}`);
  const reply = clean(body?.reply || body?.answer || body?.message?.text);
  assert(reply && /[.!?]$/.test(reply) && !reply.endsWith("..."), `turn ${turn} incomplete`);
  for (const phrase of INTERNAL_LANGUAGE) {
    assert(!reply.toLowerCase().includes(phrase), `turn ${turn} leaked ${phrase}`);
  }
  const rejected = new Set(rejectedHandles(body));
  assert(!renderedHandles(body).some((handle) => rejected.has(handle)), `turn ${turn} rendered a rejected product`);
  const sessionRecommendation = clean(activeDeal(body)?.sessionRecommendation?.productHandle).toLowerCase();
  assert(!sessionRecommendation || !rejected.has(sessionRecommendation), `turn ${turn} recommended a rejected product`);
  return { body, reply, latencyMs: Date.now() - startedAt };
}

async function main() {
  const suffix = Date.now().toString(36);
  const sessionId = `journey-os-phase1-${suffix}`;
  const testCaseId = `journey-os-phase1-acceptance-${suffix}`;
  const results = [];

  for (let index = 0; index < turns.length; index += 1) {
    results.push(await ask({
      message: turns[index],
      sessionId,
      testCaseId,
      turn: index + 1,
    }));
  }

  const firstDeal = activeDeal(results[0].body);
  assert(rejectedHandles(results[0].body).includes("12-all-foam-mattress"));
  assert.equal(firstDeal.productFeedback?.["12-all-foam-mattress"]?.feel, "too_firm");
  assert.equal(firstDeal.retainedPreferences?.motion?.value, "liked");
  assert.equal(firstDeal.activeSize, "King");
  assert.equal(firstDeal.canonicalRecommendation?.primaryMattressHandle, "12-all-foam-mattress");
  assert.equal(firstDeal.pendingCommitment?.type, "find_alternative");

  assert.equal(activeDeal(results[2].body).desiredDirection?.feel, "softer");
  assert.equal(
    results[4].body?.context?.askSnoozerWorkingMemory?.lastTransition?.stateAfter?.pendingCommitmentStatus,
    "fulfilled"
  );
  assert.equal(activeDeal(results[4].body).pendingCommitment?.type, "compare_products");
  assert.equal(activeDeal(results[4].body).pendingCommitment?.status, "pending");
  assert.equal(activeDeal(results[7].body).pendingCommitment?.status, "declined");
  assert.equal(results[5].body?.metadata?.qualityGate?.intent, "trust_recovery");
  assert.equal(results[8].body?.metadata?.qualityGate?.intent, "confusion_recovery");
  assert(
    /ruled out|off your list/i.test(results[8].reply),
    `confusion recovery did not recap the rejection: ${results[8].reply}`
  );

  const final = results.at(-1);
  assert(!renderedHandles(final.body).includes("12-all-foam-mattress"));
  assert.notEqual(activeDeal(final.body)?.sessionRecommendation?.productHandle, "12-all-foam-mattress");
  assert(
    ["successful_advancement", "recovery"].includes(final.body?.metadata?.quality?.outcomeCategory),
    `unexpected final quality outcome: ${final.body?.metadata?.quality?.outcomeCategory}`
  );
  assert.notEqual(final.body?.metadata?.quality?.alertSeverity, "P0");
  assert.notEqual(final.body?.metadata?.quality?.alertSeverity, "P1");

  const observations = results.map((result, index) => {
    const deal = activeDeal(result.body);
    const memory = result.body?.context?.askSnoozerWorkingMemory || {};
    return {
      turn: index + 1,
      interpretedActs: (memory?.lastTransition?.interpretedActs || []).map((act) => act.type),
      activeProductBefore: memory?.lastTransition?.stateBefore?.activeProductHandle || null,
      rejectedProductsBefore: memory?.lastTransition?.stateBefore?.rejectedProductHandles || [],
      stateDelta: memory?.lastTransition?.stateDelta || {},
      sessionRecommendationAfter: deal?.sessionRecommendation?.productHandle || null,
      retainedPreferences: Object.fromEntries(
        Object.entries(deal?.retainedPreferences || {}).map(([key, value]) => [key, value?.value])
      ),
      desiredDirection: deal?.desiredDirection || {},
      pendingCommitment: deal?.pendingCommitment
        ? { type: deal.pendingCommitment.type, status: deal.pendingCommitment.status }
        : null,
      quoteStatus: deal?.activeQuote?.status || null,
      responsePath:
        result.body?.metadata?.answerPath ||
        result.body?.metadata?.qualityGate?.answerPath ||
        result.body?.model ||
        result.body?.metadata?.model ||
        null,
      compositionMode: result.body?.metadata?.composition?.mode || null,
      renderedProductHandles: (result.body?.products || []).map((product) => product.handle),
      renderedActions: (result.body?.actions || []).map((action) => action.type),
      qualityOutcome: result.body?.metadata?.quality?.outcomeCategory || null,
      alertSeverity: result.body?.metadata?.quality?.alertSeverity || null,
      latencyMs: result.latencyMs,
      modelMs: result.body?.metadata?.metrics?.modelMs || 0,
    };
  });

  console.log(JSON.stringify({
    ok: true,
    apiBase: API_BASE,
    testCaseId,
    sessionId,
    turns: observations,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
