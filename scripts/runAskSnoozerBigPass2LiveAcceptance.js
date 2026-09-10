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
      baseType: "none",
      motion: "none",
    },
  },
  canonicalRecommendation: {
    topPodId: "4",
    primaryMattressHandle: "12-all-foam-mattress",
    primaryMattressTitle: '12" All Foam Mattress',
    size: "King",
    motionKey: "none",
    baseHandle: null,
    normalizedAssessment: {
      size: "King",
      sleepPosition: "side",
      painPoints: ["shoulder", "hip"],
    },
  },
};

async function ask({ message, sessionId, snoozeCode = "", testCaseId, startNewVisit = false }) {
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
      surface: "big_pass_2_live_acceptance",
      source: "big_pass_2_live_acceptance",
      sessionId,
      snoozeCode: snoozeCode || null,
      testCaseId,
      startNewVisit,
      context: canonicalContext,
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${testCaseId} HTTP ${response.status}`);
  assert.notEqual(body?.ok, false, `${testCaseId}: ${JSON.stringify(body?.error || body?.reply)}`);
  const reply = String(body?.reply || body?.message?.text || "").trim();
  assert(reply && /[.!?]$/.test(reply) && !reply.endsWith("..."), `${testCaseId} incomplete`);
  for (const phrase of INTERNAL_LANGUAGE) {
    assert(!reply.toLowerCase().includes(phrase), `${testCaseId} leaked ${phrase}`);
  }
  return { body, reply, elapsedMs: Date.now() - startedAt };
}

async function main() {
  const suffix = Date.now().toString(36);
  const latencies = [];

  const modelSession = `bp2-model-${suffix}`;
  const modelPrimer = await ask({
    message: "What did you recommend for me?",
    sessionId: modelSession,
    testCaseId: "bp2-model-primer",
  });
  latencies.push(modelPrimer.elapsedMs);
  const modelTurn = await ask({
    message: "I'm torn—walk me through in deep detail how that one compares to the 14-inch Hybrid for my shoulder and hip pressure.",
    sessionId: modelSession,
    testCaseId: "bp2-model-composer",
  });
  latencies.push(modelTurn.elapsedMs);
  assert.equal(modelTurn.body?.metadata?.composition?.mode, "model_assisted", "live model composer was not selected");
  assert.equal(modelTurn.body?.metadata?.composition?.modelCallCount, 1, "live composer call count was not one");
  assert.equal(modelTurn.body?.metadata?.metrics?.modelCallCount, 1, "live response metrics lost the composer call count");
  assert(modelTurn.body?.metadata?.metrics?.modelMs > 0, "live response metrics lost model latency");
  assert.equal(modelTurn.body?.metadata?.composition?.gate?.ok, true, "live composed answer failed the semantic gate");
  assert.equal(
    modelTurn.body?.metadata?.composition?.referenceResolution?.handle,
    "12-all-foam-mattress",
    "live composer rebound 'that one' to the comparison product"
  );
  assert(/12-inch All Foam Mattress/i.test(modelTurn.reply), "live composed answer lost the recommendation");

  const commerceSession = `bp2-commerce-${suffix}`;
  const quoted = await ask({
    message: "What would the King version of your recommendation cost?",
    sessionId: commerceSession,
    testCaseId: "bp2-deterministic-quote",
  });
  latencies.push(quoted.elapsedMs);
  assert.equal(quoted.body?.metadata?.metrics?.modelCallCount || 0, 0, "deterministic quote called the model");
  assert((quoted.body?.products || []).length >= 1, "deterministic quote returned no product card");
  const compatible = await ask({
    message: "Does it work with Standard Motion in King?",
    sessionId: commerceSession,
    testCaseId: "bp2-deterministic-compatibility",
  });
  latencies.push(compatible.elapsedMs);
  assert.equal(compatible.body?.metadata?.metrics?.modelCallCount || 0, 0, "compatibility called the model");
  assert(/compatible|work together|pair/i.test(compatible.reply), "compatibility answer was unclear");

  const snoozeCode = String(100000 + (Date.now() % 900000));
  const deviceA = await ask({
    message: "I liked the elevated position.",
    sessionId: `bp2-device-a-${suffix}`,
    snoozeCode,
    testCaseId: "bp2-cross-device-a",
  });
  const deviceB = await ask({
    message: "What did I say I liked?",
    sessionId: `bp2-device-b-${suffix}`,
    snoozeCode,
    testCaseId: "bp2-cross-device-b",
  });
  latencies.push(deviceA.elapsedMs, deviceB.elapsedMs);
  assert.equal(deviceA.body.sessionId, deviceB.body.sessionId, "same code did not resolve the same active session");
  assert.equal(
    deviceA.body?.context?.visitLifecycle?.visitId,
    deviceB.body?.context?.visitLifecycle?.visitId,
    "same-code devices did not reuse the active visit"
  );
  assert(/elevated position/i.test(deviceB.reply), "cross-device preference was not recalled");

  const beforeRotationId = deviceB.body?.context?.visitLifecycle?.visitId;
  const rotated = await ask({
    message: "What did you recommend for me?",
    sessionId: `bp2-device-c-${suffix}`,
    snoozeCode,
    testCaseId: "bp2-explicit-visit-rotation",
    startNewVisit: true,
  });
  latencies.push(rotated.elapsedMs);
  assert.notEqual(rotated.body?.context?.visitLifecycle?.visitId, beforeRotationId, "explicit visit rotation retained old visit ID");
  assert.equal(rotated.body?.context?.visitLifecycle?.rotationReason, "explicit_new_journey");
  assert(/12-inch All Foam Mattress/i.test(rotated.reply), "durable recommendation was lost during rotation");

  const sorted = [...latencies].sort((a, b) => a - b);
  console.log(JSON.stringify({
    ok: true,
    apiBase: API_BASE,
    calls: latencies.length,
    modelComposition: modelTurn.body.metadata.composition,
    quoteReply: quoted.reply,
    compatibilityReply: compatible.reply,
    crossDeviceActiveVisit: true,
    explicitVisitRotation: true,
    deterministicExpiryCoveredBy: "tests/runAskSnoozerVisitLifecycleTests.js",
    averageLatencyMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    p95LatencyMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
    latenciesMs: latencies,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
