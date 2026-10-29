#!/usr/bin/env node

const assert = require("node:assert/strict");

const API_BASE = String(
  process.env.ASK_SNOOZER_API_BASE || "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod"
).replace(/\/$/, "");
const samplesPerCategory = Math.max(1, Math.min(10, Number(process.env.LATENCY_SAMPLES_PER_CATEGORY || 3)));
const runLabel = String(process.env.LATENCY_RUN_LABEL || "latency-pass3").trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase();

const canonicalContext = {
  assessment: {
    answers: {
      size: "Queen",
      motionMode: "No Motion",
      firmness: "Soft",
      sleepPosition: "Side",
      sleepPartner: "No",
      baseType: "No Base",
      temperature: "Hot",
      painPoints: ["Shoulders", "Hips"],
    },
  },
  canonicalRecommendation: {
    topPodId: "4",
    primaryMattressHandle: "12-all-foam-mattress",
    normalizedAssessment: {
      size: "Queen",
      position: "side",
      painPoints: ["Shoulders", "Hips"],
    },
  },
};

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function unwrap(value) {
  return value?.data || value || {};
}

async function ask({ message, sessionId, snoozeCode = "", context = null, testCaseId }) {
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
      source: "latency_pass3_benchmark",
      surface: "latency_pass3_benchmark",
      sessionId,
      snoozeCode: snoozeCode || null,
      testCaseId,
      ...(context ? { context } : {}),
    }),
  });
  const body = await response.json();
  const clientMs = Date.now() - startedAt;
  assert.equal(response.status, 200, `${testCaseId} returned HTTP ${response.status}`);
  assert.notEqual(body?.ok, false, `${testCaseId} failed: ${JSON.stringify(body?.error || body?.reply)}`);
  const core = body?.metadata?.conversationCore || {};
  const lifecycle = core.lifecycle || {};
  const metrics = body?.metadata?.metrics || {};
  return {
    testCaseId,
    requestId: body?.metadata?.requestId || null,
    clientMs,
    backendMs: Number(body?.metadata?.latencyMs ?? metrics.totalMs ?? 0),
    modelMs: Number(metrics.modelMs || 0),
    retrievalMs: Number(metrics.retrievalMs || 0),
    requestToCoreMs: Number(lifecycle.requestToCoreMs || 0),
    preparedEvidenceMs: Number(core.preparedContext?.latencyMs || 0),
    toolExecutionWallMs: Number(lifecycle.toolExecutionMs || 0),
    validationMs: Number(lifecycle.validationMs || 0),
    productHydrationMs: Number(lifecycle.productHydrationMs || 0),
    persistenceMs: Number(lifecycle.persistenceMs || 0),
    responseBuildMs: Number(lifecycle.responseBuildMs || 0),
    postModelMs: Number(lifecycle.postModelMs || 0),
    modelCallCount: Number(metrics.modelCallCount || 0),
    toolProposalCount: Number(core.toolProposalCount || 0),
    toolExecutionCount: Number(core.toolExecutionCount || 0),
    duplicateCallsAvoided: Number(core.duplicateCallsAvoided || 0),
    preparedEvidenceHits: Number(core.preparedEvidenceHits || 0),
    inputTokens: Number(core.usage?.prompt || 0),
    cachedTokens: Number(core.usage?.cached || 0),
    outputTokens: Number(core.usage?.completion || 0),
    reasoningTokens: Number(core.usage?.reasoning || 0),
    estimatedCostUsd: Number(core.estimatedCostUsd || core.usage?.estimatedCostUsd || 0),
    fallbackUsed: metrics.fallbackUsed === true,
    recoveryAttempts: Number(core.recovery?.attempts || 0),
    validationFailureCount: Array.isArray(core.validationErrors) ? core.validationErrors.length : 0,
  };
}

async function issueIdentity(sampleId) {
  const response = await fetch(`${API_BASE}/assessment`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      shopperId: sampleId,
      sessionId: `${sampleId}-assessment`,
      answers: canonicalContext.assessment.answers,
      origin: "latency_pass3_benchmark",
    }),
  });
  const body = unwrap(await response.json());
  assert.equal(response.status, 200, `${sampleId} assessment returned HTTP ${response.status}`);
  const snoozeCode = String(body.accessCode || body.snoozeCode || "");
  assert.match(snoozeCode, /^\d{6}$/);
  return snoozeCode;
}

async function runCategory(category, sampleIndex) {
  const unique = `${runLabel}-${category}-${sampleIndex}-${Date.now()}`;
  if (category === "simple") {
    return ask({
      message: "Hi Snoozer, what can you help me with?",
      sessionId: unique,
      testCaseId: `${runLabel}-${category}-${sampleIndex}`,
    });
  }
  if (category === "product_knowledge") {
    return ask({
      message: "What will I notice on the 12-inch All Foam Mattress as a side sleeper with sore shoulders?",
      sessionId: unique,
      context: canonicalContext,
      testCaseId: `${runLabel}-${category}-${sampleIndex}`,
    });
  }
  if (category === "commerce") {
    return ask({
      message: "What is the current King price for the 12-inch All Foam Mattress?",
      sessionId: unique,
      context: canonicalContext,
      testCaseId: `${runLabel}-${category}-${sampleIndex}`,
    });
  }
  if (category === "multi_turn_reasoning") {
    await ask({
      message: "Tell me about the 12-inch All Foam Mattress for my shoulder and hip pressure.",
      sessionId: unique,
      context: canonicalContext,
      testCaseId: `${runLabel}-${category}-${sampleIndex}-setup`,
    });
    return ask({
      message: "How does that compare with the 14-inch Hybrid, and which would you choose for me?",
      sessionId: unique,
      context: canonicalContext,
      testCaseId: `${runLabel}-${category}-${sampleIndex}`,
    });
  }
  if (category === "journey_state") {
    const snoozeCode = await issueIdentity(unique);
    await ask({
      message: "I need King.",
      sessionId: `${unique}-device-a`,
      snoozeCode,
      context: canonicalContext,
      testCaseId: `${runLabel}-${category}-${sampleIndex}-setup`,
    });
    return ask({
      message: "What size did I choose, and what did my assessment originally recommend?",
      sessionId: `${unique}-device-b`,
      snoozeCode,
      context: canonicalContext,
      testCaseId: `${runLabel}-${category}-${sampleIndex}`,
    });
  }
  throw new Error(`Unknown category: ${category}`);
}

function summarize(category, samples) {
  const values = (field) => samples.map((sample) => Number(sample[field] || 0));
  return {
    category,
    sampleCount: samples.length,
    clientP50Ms: percentile(values("clientMs"), 0.5),
    clientP95Ms: percentile(values("clientMs"), 0.95),
    backendP50Ms: percentile(values("backendMs"), 0.5),
    backendP95Ms: percentile(values("backendMs"), 0.95),
    modelP50Ms: percentile(values("modelMs"), 0.5),
    modelP95Ms: percentile(values("modelMs"), 0.95),
    retrievalP50Ms: percentile(values("retrievalMs"), 0.5),
    retrievalP95Ms: percentile(values("retrievalMs"), 0.95),
    averageModelCalls: Number((values("modelCallCount").reduce((sum, value) => sum + value, 0) / samples.length).toFixed(2)),
    averageToolProposals: Number((values("toolProposalCount").reduce((sum, value) => sum + value, 0) / samples.length).toFixed(2)),
    averageToolExecutions: Number((values("toolExecutionCount").reduce((sum, value) => sum + value, 0) / samples.length).toFixed(2)),
    averageInputTokens: average(values("inputTokens")),
    averageCachedTokens: average(values("cachedTokens")),
    averageOutputTokens: average(values("outputTokens")),
    averageReasoningTokens: average(values("reasoningTokens")),
    averageEstimatedCostUsd: Number((values("estimatedCostUsd").reduce((sum, value) => sum + value, 0) / samples.length).toFixed(6)),
    fallbackRate: Number((samples.filter((sample) => sample.fallbackUsed).length / samples.length).toFixed(3)),
    validationFailureRate: Number((samples.filter((sample) => sample.validationFailureCount > 0).length / samples.length).toFixed(3)),
  };
}

async function main() {
  const categories = ["simple", "product_knowledge", "commerce", "multi_turn_reasoning", "journey_state"];
  const samples = [];
  for (const category of categories) {
    for (let sampleIndex = 1; sampleIndex <= samplesPerCategory; sampleIndex += 1) {
      samples.push({ category, ...(await runCategory(category, sampleIndex)) });
    }
  }
  console.log(JSON.stringify({
    ok: true,
    runLabel,
    apiBase: API_BASE,
    samplesPerCategory,
    note: "P95 values are directional when sample counts are small.",
    summaries: categories.map((category) => summarize(category, samples.filter((sample) => sample.category === category))),
    samples,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
