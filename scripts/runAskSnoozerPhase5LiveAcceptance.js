#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  INTERNAL_LANGUAGE,
} = require("../services/askSnoozerConversationOrchestrator");
const {
  isCompleteShopperResponse,
} = require("../services/askSnoozerResponsePresenter");

const API_BASE = String(
  process.env.ASK_SNOOZER_API_BASE || "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod"
).replace(/\/$/, "");
const PACE_MS = Math.max(0, Number(process.env.ASK_SNOOZER_PACE_MS || 2500));

const canonicalContext = {
  assessment: {
    answers: {
      size: "King",
      sleepPosition: "combination",
      firmness: "medium",
      motion: "none",
    },
  },
  canonicalRecommendation: {
    topPodId: "3",
    primaryMattressHandle: "14-hybrid-mattress",
    primaryMattressTitle: "14-inch Hybrid Mattress",
    size: "King",
    motionKey: "none",
    normalizedAssessment: {
      size: "King",
      sleepPosition: "combination",
    },
  },
};

const turns = [
  "Why did you choose Pod 4 for me?",
  "The 14-inch Hybrid was too firm.",
  "Yes.",
  "Compare the options you are considering for me.",
  "What sizes are available for 12-dual-comfort-hybrid?",
  "What is the warranty on the 12-inch Dual Comfort and how long does delivery take?",
  "What is your return policy?",
  "How long does delivery take?",
  "How much is the King 12-inch Dual Comfort mattress only?",
];

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function deal(body = {}) {
  return body?.context?.askSnoozerWorkingMemory?.activeDeal || {};
}

function replyText(body = {}) {
  return clean(body?.reply || body?.displayAnswer || body?.answer?.text || body?.answer || body?.message?.text);
}

function rejectedHandles(body = {}) {
  return (deal(body)?.rejectedProducts || [])
    .filter((item) => clean(item?.status || "rejected").toLowerCase() === "rejected")
    .map((item) => clean(item?.handle).toLowerCase())
    .filter(Boolean);
}

function renderedHandles(body = {}) {
  return [
    ...(body?.products || []).map((product) => clean(product?.handle).toLowerCase()),
    ...(body?.actions || []).map((action) => clean(action?.payload?.handle || action?.handle).toLowerCase()),
  ].filter(Boolean);
}

function includesProtectedLanguage(text, phrase) {
  const escaped = clean(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped
    ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(clean(text))
    : false;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ask({ message, sessionId, testCaseId, turn }) {
  const startedAt = Date.now();
  const requestId = `${testCaseId}-turn-${turn}`;
  const response = await fetch(`${API_BASE}/ask-snoozer`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-session-id": sessionId,
      "x-request-id": requestId,
    },
    body: JSON.stringify({
      message,
      mode: "ask_snoozer_page",
      surface: "journey_os_phase_5_live_acceptance",
      source: "journey_os_phase_5_live_acceptance",
      sessionId,
      testCaseId,
      context: canonicalContext,
    }),
  });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { reply: raw }; }
  assert.equal(response.status, 200, `${message}: HTTP ${response.status}: ${raw.slice(0, 500)}`);
  assert.notEqual(body?.ok, false, `${message}: ${JSON.stringify(body?.error || body?.reply)}`);
  return { body, requestId, clientElapsedMs: Date.now() - startedAt };
}

function validate(result, turn) {
  const { body } = result;
  const reply = replyText(body);
  assert(reply, `turn ${turn}: no shopper-visible reply`);
  assert(isCompleteShopperResponse(reply), `turn ${turn}: incomplete reply: ${reply}`);
  assert(!reply.endsWith("..."), `turn ${turn}: raw ellipsis truncation`);
  for (const phrase of INTERNAL_LANGUAGE) {
    assert(!includesProtectedLanguage(reply, phrase), `turn ${turn}: leaked internal phrase ${phrase}`);
  }
  const rejected = new Set(rejectedHandles(body));
  assert(!renderedHandles(body).some((handle) => rejected.has(handle)), `turn ${turn}: rendered a rejected product`);
  assert(!["P0", "P1", "P2"].includes(clean(body?.metadata?.quality?.alertSeverity)), `turn ${turn}: quality defect`);
}

function summary(result, turn, message) {
  const { body } = result;
  const activeDeal = deal(body);
  const metadata = body?.metadata || {};
  return {
    turn,
    requestId: result.requestId,
    message,
    reply: replyText(body),
    task: metadata?.qualityGate?.intent || metadata?.semantics?.plannerTask || null,
    responsePath: metadata?.answerPath || null,
    planningMode: metadata?.planning?.mode || "deterministic",
    plannerCalls: Number(metadata?.planning?.modelCallCount || 0),
    plannerMs: Number(metadata?.planning?.modelMs || 0),
    requestedFacts: metadata?.planning?.requestedFacts || [],
    compositionMode: metadata?.composition?.mode || null,
    composerCalls: Number(metadata?.composition?.modelCallCount || 0),
    totalModelCalls: Number(metadata?.metrics?.modelCallCount || 0),
    totalMs: Number(metadata?.metrics?.totalMs || result.clientElapsedMs),
    clientElapsedMs: result.clientElapsedMs,
    activeProduct: activeDeal?.activeProductHandle || activeDeal?.sessionRecommendation?.productHandle || null,
    size: activeDeal?.activeSize || activeDeal?.activeConfiguration?.size || null,
    rejectedProducts: rejectedHandles(body),
    pendingCommitment: activeDeal?.pendingCommitment?.type || null,
    quoteStatus: activeDeal?.activeQuote?.status || null,
    renderedProducts: (body?.products || []).map((product) => product.handle),
    renderedActions: (body?.actions || []).map((action) => action.type),
    qualityOutcome: metadata?.quality?.outcomeCategory || null,
    alertSeverity: metadata?.quality?.alertSeverity || null,
  };
}

async function main() {
  const suffix = Date.now().toString(36);
  const sessionId = `journey-os-phase5-${suffix}`;
  const testCaseId = `journey-os-phase5-acceptance-${suffix}`;
  const results = [];

  for (let index = 0; index < turns.length; index += 1) {
    if (index > 0) await wait(PACE_MS);
    const result = await ask({ message: turns[index], sessionId, testCaseId, turn: index + 1 });
    validate(result, index + 1);
    results.push(result);
  }

  const summaries = results.map((result, index) => summary(result, index + 1, turns[index]));
  assert.match(summaries[0].reply, /SnoozePod 3/i, "wrong-pod correction did not name SnoozePod 3");
  assert.match(summaries[0].reply, /14(?:-inch|\") Hybrid/i, "wrong-pod correction did not name the actual mattress");
  assert(!/chose SnoozePod 4/i.test(summaries[0].reply), "wrong-pod premise was accepted");
  assert(summaries[1].rejectedProducts.includes("14-hybrid"), "rejection was not persisted");
  assert(!summaries[2].renderedProducts.includes("14-hybrid"), "pending yes resurrected the rejected mattress");
  assert.match(summaries[4].reply, /King/i, "exact-product size answer omitted King");
  assert(!/which mattress do you mean/i.test(summaries[4].reply), "exact handle was not resolved");
  assert.match(summaries[5].reply, /warranty/i, "compound answer omitted warranty");
  assert.match(summaries[5].reply, /deliver/i, "compound answer omitted delivery");
  assert.match(summaries[6].reply, /100-night/i, "return policy did not use approved policy truth");
  assert.match(summaries[7].reply, /3.{0,3}7 business days/i, "delivery policy did not use approved policy truth");
  assert.match(summaries[8].reply, /\$[\d,]+(?:\.\d{2})?/, "exact price answer omitted a resolved price");
  assert(summaries.slice(0, 6).some((turn) => turn.planningMode === "model_planned" && turn.plannerCalls > 0), "healthy substantive turns did not use model planning");

  console.log(JSON.stringify({ ok: true, apiBase: API_BASE, sessionId, testCaseId, turns: summaries }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
