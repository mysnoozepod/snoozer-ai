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
const PACE_MS = Math.max(0, Number(process.env.ASK_SNOOZER_PACE_MS || 3500));

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

const seedTurns = [
  "The All Foam was too firm, but I liked the motion.",
  "I want something softer.",
  "What would you recommend instead?",
  "Okay, I like that one.",
  "I need King.",
];

const acceptanceTurns = [
  "What do you recommend now?",
  "Why?",
  "Compare that with the 14 Hybrid.",
  "Which one would you pick for me?",
  "Why is it better for me?",
  "Which one should hold up better?",
  "How much is the King?",
  "Why does it cost that much and is it worth it?",
  "What if I skip the motion base?",
  "Okay, mattress only.",
  "How much now?",
  "What's the difference between my original recommendation and this one?",
  "I'm still a little confused.",
  "So what would you do?",
  "Add the mattress.",
];

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function includesProtectedLanguage(text, phrase) {
  const escaped = clean(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(clean(text));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

function average(values) {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;
}

function deal(body = {}) {
  return body?.context?.askSnoozerWorkingMemory?.activeDeal || {};
}

function activeHandle(body = {}) {
  const activeDeal = deal(body);
  return clean(
    activeDeal?.acceptedRecommendation?.productHandle ||
    activeDeal?.sessionRecommendation?.productHandle ||
    activeDeal?.activeConfiguration?.productHandle ||
    activeDeal?.activeProductHandle
  ).toLowerCase();
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

function replyText(body = {}) {
  return clean(body?.reply || body?.displayAnswer || body?.answer?.text || body?.answer || body?.message?.text);
}

async function ask({ message, sessionId, testCaseId, requestPrefix, turn }) {
  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}/ask-snoozer`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-session-id": sessionId,
      "x-request-id": `${requestPrefix}-turn-${turn}`,
    },
    body: JSON.stringify({
      message,
      mode: "ask_snoozer_page",
      surface: "journey_os_phase_4_live_acceptance",
      source: "journey_os_phase_4_live_acceptance",
      sessionId,
      testCaseId,
      context: canonicalContext,
    }),
  });
  const raw = await response.text();
  let body = {};
  try { body = JSON.parse(raw); } catch { body = { reply: raw }; }
  assert.equal(response.status, 200, `${message}: HTTP ${response.status}: ${raw.slice(0, 500)}`);
  assert.notEqual(body?.ok, false, `${message}: ${JSON.stringify(body?.error || body?.reply)}`);
  return { body, clientElapsedMs: Date.now() - startedAt };
}

function validateShopperResponse(result, label) {
  const { body } = result;
  const reply = replyText(body);
  assert(reply, `${label}: no shopper-visible reply`);
  assert(isCompleteShopperResponse(reply), `${label}: incomplete reply: ${reply}`);
  assert(!reply.endsWith("..."), `${label}: raw ellipsis truncation`);
  for (const phrase of INTERNAL_LANGUAGE) {
    assert(!includesProtectedLanguage(reply, phrase), `${label}: leaked internal phrase ${phrase}`);
  }
  const rejected = new Set(rejectedHandles(body));
  assert(!renderedHandles(body).some((handle) => rejected.has(handle)), `${label}: rendered a rejected product`);
  assert(!rejected.has(activeHandle(body)), `${label}: rejected product is active`);
  assert(!["P0", "P1", "P2"].includes(clean(body?.metadata?.quality?.alertSeverity)), `${label}: ${body?.metadata?.quality?.alertSeverity} quality defect`);
  assert(["atomic_deterministic", "structured_composer", "grounded_safe_fallback", "legacy_path"].includes(clean(body?.metadata?.answerPath)), `${label}: invalid response path`);
}

function turnSummary(result, turn, message) {
  const { body } = result;
  const activeDeal = deal(body);
  const metadata = body?.metadata || {};
  return {
    turn,
    message,
    reply: replyText(body),
    task: metadata?.qualityGate?.intent || metadata?.semantics?.plannerTask || null,
    responsePath: metadata?.answerPath || null,
    compositionMode: metadata?.composition?.mode || null,
    modelCalls: Number(metadata?.composition?.modelCallCount || 0),
    modelMs: Number(metadata?.metrics?.modelMs || 0),
    totalMs: Number(metadata?.metrics?.totalMs || result.clientElapsedMs),
    clientElapsedMs: result.clientElapsedMs,
    responseValidationMs: Number(metadata?.metrics?.responseValidationMs || 0),
    modelInputChars: Number(metadata?.composition?.inputChars || 0),
    factPackChars: Number(metadata?.composition?.factPackChars || metadata?.metrics?.factPackChars || 0),
    activeProduct: activeHandle(body) || null,
    size: activeDeal?.activeSize || activeDeal?.activeConfiguration?.size || null,
    baseDecision: activeDeal?.activeConfiguration?.baseDecision || activeDeal?.baseDecision || null,
    quoteStatus: activeDeal?.activeQuote?.status || metadata?.quote?.status || null,
    renderedProducts: (body?.products || []).map((product) => product.handle),
    renderedActions: (body?.actions || []).map((action) => action.type),
    qualityOutcome: metadata?.quality?.outcomeCategory || null,
    alertSeverity: metadata?.quality?.alertSeverity || null,
    complete: isCompleteShopperResponse(replyText(body)),
  };
}

function summarizePath(turns, path) {
  const selected = turns.filter((turn) => turn.responsePath === path);
  const totalLatencies = selected.map((turn) => turn.totalMs);
  const factPackChars = selected.map((turn) => turn.factPackChars).filter((value) => value > 0);
  return {
    count: selected.length,
    rate: Math.round((selected.length / Math.max(1, turns.length)) * 1000) / 10,
    latencyAvgMs: average(totalLatencies),
    latencyP95Ms: percentile(totalLatencies, 0.95),
    factPackAvgChars: average(factPackChars),
    factPackP95Chars: percentile(factPackChars, 0.95),
  };
}

async function main() {
  const suffix = Date.now().toString(36);
  const sessionId = `journey-os-phase4-${suffix}`;
  const seedTestCaseId = `journey-os-phase4-seed-${suffix}`;
  const testCaseId = `journey-os-phase4-acceptance-${suffix}`;

  const seedResults = [];
  for (let index = 0; index < seedTurns.length; index += 1) {
    if (index > 0) await wait(PACE_MS);
    const result = await ask({
      message: seedTurns[index],
      sessionId,
      testCaseId: seedTestCaseId,
      requestPrefix: seedTestCaseId,
      turn: index + 1,
    });
    validateShopperResponse(result, `seed turn ${index + 1}`);
    seedResults.push(result);
  }

  const seededDeal = deal(seedResults.at(-1).body);
  const selectedHandle = activeHandle(seedResults.at(-1).body);
  assert(selectedHandle && selectedHandle !== "12-all-foam-mattress", "controlled journey did not select a valid alternative");
  assert.equal(clean(seededDeal?.activeSize || seededDeal?.activeConfiguration?.size), "King");
  assert.equal(clean(seededDeal?.retainedPreferences?.motion?.value), "liked");
  assert(rejectedHandles(seedResults.at(-1).body).includes("12-all-foam-mattress"));

  const results = [];
  for (let index = 0; index < acceptanceTurns.length; index += 1) {
    await wait(PACE_MS);
    const result = await ask({
      message: acceptanceTurns[index],
      sessionId,
      testCaseId,
      requestPrefix: testCaseId,
      turn: index + 1,
    });
    validateShopperResponse(result, `acceptance turn ${index + 1}`);
    results.push(result);
  }

  const summaries = results.map((result, index) => turnSummary(result, index + 1, acceptanceTurns[index]));
  const paths = ["atomic_deterministic", "structured_composer", "grounded_safe_fallback", "legacy_path"];
  const pathDistribution = Object.fromEntries(paths.map((path) => [path, summarizePath(summaries, path)]));
  const substantiveTurns = summaries.filter((turn) => ![7, 11, 15].includes(turn.turn));
  assert(substantiveTurns.every((turn) => turn.responsePath === "structured_composer"), "a normal substantive turn bypassed the structured composer");
  assert.equal(pathDistribution.legacy_path.count, 0, "legacy path appeared in normal acceptance");
  assert.equal(pathDistribution.grounded_safe_fallback.count, 0, "safe fallback appeared under healthy acceptance conditions");
  assert.equal(summaries[6].responsePath, "atomic_deterministic", "exact King price was not atomic deterministic");
  assert.equal(summaries[10].responsePath, "atomic_deterministic", "mattress-only price was not atomic deterministic");
  assert(summaries[14].renderedActions.includes("add_to_cart"), "final turn did not expose the guarded cart action");
  assert(summaries.slice(0, 14).every((turn) => !turn.renderedActions.includes("add_to_cart")), "cart action appeared before explicit add request");
  assert(summaries.every((turn) => turn.activeProduct === selectedHandle), "current recommendation drifted during acceptance");
  assert(/All Foam/i.test(summaries[11].reply) && /Dual Comfort|Hybrid/i.test(summaries[11].reply), "canonical/current comparison was incomplete");

  const modelLatencies = summaries
    .filter((turn) => turn.responsePath === "structured_composer")
    .map((turn) => turn.modelMs);
  const factPackSizes = summaries.map((turn) => turn.factPackChars).filter((value) => value > 0);
  const validationLatencies = summaries.map((turn) => turn.responseValidationMs);
  console.log(JSON.stringify({
    ok: true,
    apiBase: API_BASE,
    testCaseId,
    seedTestCaseId,
    sessionId,
    selectedHandle,
    paceMs: PACE_MS,
    pathDistribution,
    modelExecution: {
      averageMs: average(modelLatencies),
      p95Ms: percentile(modelLatencies, 0.95),
    },
    factPack: {
      averageChars: average(factPackSizes),
      p95Chars: percentile(factPackSizes, 0.95),
      maxChars: factPackSizes.length ? Math.max(...factPackSizes) : 0,
    },
    responseValidation: {
      averageMs: average(validationLatencies),
      p95Ms: percentile(validationLatencies, 0.95),
    },
    turns: summaries,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
