#!/usr/bin/env node

const assert = require("assert");
const { INTERNAL_LANGUAGE } = require("../services/askSnoozerConversationOrchestrator");

const API_BASE = String(
  process.env.ASK_SNOOZER_API_BASE || "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod"
).replace(/\/$/, "");
const PACE_MS = Math.max(0, Number(process.env.ASK_SNOOZER_PACE_MS || 3500));
const BURST_COUNT = Math.max(1, Number(process.env.ASK_SNOOZER_BURST_COUNT || 6));

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

const transcript = [
  "The All Foam was too firm, but I liked the motion.",
  "I want something softer.",
  "What would you recommend instead?",
  "Why that one?",
  "Okay, I like that one.",
  "I need a King.",
  "How much?",
  "What about with the motion base?",
  "That's more than I want to spend.",
  "Then mattress only.",
  "Add it.",
  "What did my assessment originally recommend?",
  "And what do you recommend now?",
];

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function activeDeal(body = {}) {
  return body?.context?.askSnoozerWorkingMemory?.activeDeal || {};
}

function renderedHandles(body = {}) {
  return [
    ...(body.products || []).map((product) => clean(product?.handle).toLowerCase()),
    ...(body.actions || []).map((action) => clean(action?.payload?.handle || action?.handle).toLowerCase()),
  ].filter(Boolean);
}

function rejectedHandles(body = {}) {
  return (activeDeal(body).rejectedProducts || [])
    .filter((item) => clean(item?.status || "rejected") === "rejected")
    .map((item) => clean(item?.handle).toLowerCase());
}

function quoteItems(body = {}) {
  const quote = body?.metadata?.quote || activeDeal(body)?.activeQuote || null;
  return Array.isArray(quote?.items) ? quote.items : [];
}

function resolvedQuote(body = {}) {
  return body?.metadata?.quote || activeDeal(body)?.activeQuote || null;
}

function quoteSubtotal(body = {}) {
  const items = quoteItems(body);
  return items.reduce((sum, item) => sum + Number(item?.price || 0) * Math.max(1, Number(item?.quantity || 1)), 0);
}

function assertShopperSafe(body, label) {
  const reply = clean(body?.reply || body?.answer || body?.message?.text);
  assert(reply, `${label} returned no reply`);
  assert(/[.!?]$/.test(reply) && !reply.endsWith("..."), `${label} ended incompletely: ${reply}`);
  for (const phrase of INTERNAL_LANGUAGE) {
    assert(!reply.toLowerCase().includes(phrase), `${label} leaked ${phrase}`);
  }
  assert(!/trace|telemetry|fact pack|orchestrator|quality gate/i.test(reply), `${label} exposed implementation language`);
  const rejected = new Set(rejectedHandles(body));
  assert(!renderedHandles(body).some((handle) => rejected.has(handle)), `${label} rendered a rejected product`);
  const current = clean(activeDeal(body)?.sessionRecommendation?.productHandle).toLowerCase();
  assert(!current || !rejected.has(current), `${label} recommended a rejected product`);
  return reply;
}

async function ask({ message, sessionId, testCaseId, turn, surface = "journey_os_phase_2_live_acceptance" }) {
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
      surface,
      source: surface,
      sessionId,
      testCaseId,
      context: canonicalContext,
    }),
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = { reply: await response.text() };
  }
  return { response, body, elapsedMs: Date.now() - startedAt };
}

function summarize(result, turn, message) {
  const { body } = result;
  const memory = body?.context?.askSnoozerWorkingMemory || {};
  const deal = activeDeal(body);
  const quote = resolvedQuote(body);
  return {
    turn,
    message,
    task: body?.metadata?.qualityGate?.intent || null,
    interpretedActs: (memory?.lastTransition?.interpretedActs || []).map((act) => act.type),
    stateDelta: memory?.lastTransition?.stateDelta || {},
    originalRecommendation: deal?.canonicalRecommendation?.primaryMattressHandle || null,
    sessionRecommendation: deal?.sessionRecommendation?.productHandle || null,
    acceptedRecommendation: deal?.acceptedRecommendation?.productHandle || null,
    activeConfiguration: deal?.activeConfiguration || null,
    size: deal?.activeSize || null,
    rejectedProducts: rejectedHandles(body),
    desiredDirection: deal?.desiredDirection || {},
    retainedPreferences: Object.fromEntries(
      Object.entries(deal?.retainedPreferences || {}).map(([key, value]) => [key, value?.value])
    ),
    quoteStatus: deal?.activeQuote?.status || quote?.status || null,
    quoteItems: quoteItems(body).map((item) => ({
      title: item.title || item.productTitle || null,
      variantTitle: item.variantTitle || null,
      variantId: item.variantId || null,
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0),
    })),
    quoteSubtotal: quoteSubtotal(body),
    responsePath: body?.metadata?.answerPath || null,
    compositionMode: body?.metadata?.composition?.mode || null,
    modelCalls: Number(body?.metadata?.composition?.modelCallCount || 0),
    fallbackKind: body?.metadata?.composition?.fallbackKind || null,
    modelMs: Number(body?.metadata?.metrics?.modelMs || 0),
    totalMs: Number(body?.metadata?.metrics?.totalMs || result.elapsedMs),
    modelInputChars: Number(body?.metadata?.composition?.inputChars || 0),
    factPackChars: Number(body?.metadata?.composition?.factPackChars || 0),
    factPackBudget: body?.metadata?.composition?.factPackBudget || null,
    renderedProducts: (body.products || []).map((product) => product.handle),
    renderedActions: (body.actions || []).map((action) => action.type),
    qualityOutcome: body?.metadata?.quality?.outcomeCategory || null,
    alertSeverity: body?.metadata?.quality?.alertSeverity || null,
  };
}

async function runPacedAcceptance(suffix) {
  const sessionId = `journey-os-phase2-paced-${suffix}`;
  const testCaseId = `journey-os-phase2-paced-${suffix}`;
  const results = [];
  for (let index = 0; index < transcript.length; index += 1) {
    if (index > 0) await wait(PACE_MS);
    const result = await ask({
      message: transcript[index],
      sessionId,
      testCaseId,
      turn: index + 1,
    });
    assert.equal(result.response.status, 200, `paced turn ${index + 1} HTTP ${result.response.status}`);
    assert.notEqual(result.body?.ok, false, `paced turn ${index + 1}: ${JSON.stringify(result.body?.error || result.body?.reply)}`);
    assertShopperSafe(result.body, `paced turn ${index + 1}`);
    assert.notEqual(result.body?.metadata?.quality?.alertSeverity, "P0", `paced turn ${index + 1} emitted P0`);
    assert.notEqual(result.body?.metadata?.quality?.alertSeverity, "P1", `paced turn ${index + 1} emitted P1`);
    results.push(result);
  }

  const first = activeDeal(results[0].body);
  assert(rejectedHandles(results[0].body).includes("12-all-foam-mattress"), "turn 1 did not reject All Foam");
  assert.equal(first.productFeedback?.["12-all-foam-mattress"]?.feel, "too_firm");
  assert.equal(first.retainedPreferences?.motion?.value, "liked");

  const alternative = activeDeal(results[2].body)?.sessionRecommendation?.productHandle;
  assert(alternative && alternative !== "12-all-foam-mattress", "turn 3 did not choose a grounded alternative");
  assert(/because|fit|softer|feedback/i.test(clean(results[3].body.reply)), "turn 4 did not explain the recommendation");
  assert.equal(activeDeal(results[4].body)?.acceptedRecommendation?.productHandle, alternative, "turn 5 did not accept recommendation");
  assert.equal(activeDeal(results[5].body)?.activeSize, "King", "turn 6 did not retain King");

  const mattressQuote = resolvedQuote(results[6].body);
  assert(mattressQuote?.ok && quoteItems(results[6].body).length === 1, "turn 7 did not produce an exact mattress quote");
  const bundleQuote = resolvedQuote(results[7].body);
  assert(bundleQuote?.ok && quoteItems(results[7].body).length >= 2, "turn 8 did not produce an exact bundle quote");
  assert(quoteItems(results[7].body).every((item) => /^gid:\/\/shopify\/ProductVariant\//.test(clean(item.variantId))), "turn 8 lacked authoritative variant IDs");
  assert(/mattress.?only|save|lower|less/i.test(clean(results[8].body.reply)), "turn 9 did not handle the value objection");
  assert(resolvedQuote(results[9].body)?.ok && quoteItems(results[9].body).length === 1, "turn 10 did not re-quote mattress only");
  assert((results[10].body.actions || []).length > 0, "turn 11 did not expose the explicit cart handoff");
  assert(results.filter((_result, index) => index !== 10).every((result) => (result.body.actions || []).length === 0), "purchase action appeared before explicit Add it");
  assert(/All Foam/i.test(clean(results[11].body.reply)), "turn 12 did not recall the canonical recommendation");
  assert.equal(activeDeal(results[12].body)?.sessionRecommendation?.productHandle, alternative, "turn 13 lost current recommendation");
  assert(!renderedHandles(results[12].body).includes("12-all-foam-mattress"), "turn 13 rendered rejected canonical product");

  return {
    testCaseId,
    sessionId,
    paceMs: PACE_MS,
    alternative,
    mattressSubtotal: quoteSubtotal(results[6].body),
    bundleSubtotal: quoteSubtotal(results[7].body),
    turns: results.map((result, index) => summarize(result, index + 1, transcript[index])),
  };
}

async function runRapidBurst(suffix) {
  const testCaseId = `journey-os-phase2-burst-${suffix}`;
  const message = "Compare the 12-inch Dual Comfort Hybrid with the 14-inch Hybrid for a side sleeper, and explain the value tradeoff.";
  const results = await Promise.all(
    Array.from({ length: BURST_COUNT }, (_value, index) => ask({
      message,
      sessionId: `journey-os-phase2-burst-${suffix}-${index + 1}`,
      testCaseId,
      turn: index + 1,
      surface: "journey_os_phase_2_rapid_burst",
    }))
  );
  return {
    testCaseId,
    requestCount: BURST_COUNT,
    http200: results.filter((result) => result.response.status === 200).length,
    httpFailures: results.filter((result) => result.response.status !== 200).length,
    compositionCounts: results.reduce((counts, result) => {
      const key = result.body?.metadata?.composition?.mode || `http_${result.response.status}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    fallbackCounts: results.reduce((counts, result) => {
      const key = result.body?.metadata?.composition?.fallbackKind || "none";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    latenciesMs: results.map((result) => result.elapsedMs),
  };
}

async function main() {
  const suffix = Date.now().toString(36);
  const paced = await runPacedAcceptance(suffix);
  const burst = await runRapidBurst(suffix);
  console.log(JSON.stringify({
    ok: true,
    apiBase: API_BASE,
    paced,
    burst,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
