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

function responseText(body) {
  return String(body?.reply || body?.answer || body?.message?.text || "").trim();
}

async function ask({ message, sessionId, snoozeCode = "", testCaseId, context = canonicalContext }) {
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
      surface: "big_pass_3_live_acceptance",
      source: "big_pass_3_live_acceptance",
      sessionId,
      snoozeCode: snoozeCode || null,
      testCaseId,
      context,
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${testCaseId} HTTP ${response.status}`);
  assert.notEqual(body?.ok, false, `${testCaseId}: ${JSON.stringify(body?.error || body?.reply)}`);
  const reply = responseText(body);
  assert(reply && /[.!?]$/.test(reply) && !reply.endsWith("..."), `${testCaseId} incomplete`);
  for (const phrase of INTERNAL_LANGUAGE) {
    assert(!reply.toLowerCase().includes(phrase), `${testCaseId} leaked ${phrase}`);
  }
  assert(!/trace|telemetry|regression|quality gate|fact pack|orchestrator/i.test(reply), `${testCaseId} exposed observability language`);
  assert(body?.metadata?.quality?.traceVersion, `${testCaseId} missing quality trace version`);
  assert(body?.metadata?.quality?.outcomeVersion, `${testCaseId} missing outcome version`);
  assert(body?.metadata?.quality?.responsePolicyVersion, `${testCaseId} missing response policy version`);
  return { body, reply, elapsedMs: Date.now() - startedAt };
}

function assertCommercialConsistency(result, label) {
  const compositionGate = result.body?.metadata?.composition?.gate;
  const violations = compositionGate?.violations || [];
  if (result.body?.metadata?.composition?.mode === "model_assisted") {
    assert.equal(compositionGate?.ok, true, `${label} consistency gate failed: ${violations.join(", ")}`);
  }
  assert.equal(result.body?.metadata?.qualityGate?.factsResolved, true, `${label} did not resolve its protected facts`);
  assert.notEqual(result.body?.metadata?.quality?.alertSeverity, "P0", `${label} emitted a P0 quality alert`);
}

async function main() {
  const suffix = Date.now().toString(36);
  const results = [];

  const deterministic = await ask({
    message: "What would the King version of your recommendation cost?",
    sessionId: `bp3-deterministic-${suffix}`,
    testCaseId: "bp3-deterministic",
  });
  assert.equal(deterministic.body?.metadata?.composition?.mode, "deterministic");
  assert.equal(deterministic.body?.metadata?.composition?.modelCallCount, 0);
  assertCommercialConsistency(deterministic, "deterministic");
  results.push({ id: "deterministic", ...deterministic });

  const modelSession = `bp3-model-${suffix}`;
  await ask({
    message: "What did you recommend for me?",
    sessionId: modelSession,
    testCaseId: "bp3-model-primer",
  });
  const model = await ask({
    message: "I'm torn—walk me through in deep detail how that one compares with the 14-inch Hybrid for my shoulder and hip pressure.",
    sessionId: modelSession,
    testCaseId: "bp3-model-assisted",
  });
  assert.equal(model.body?.metadata?.composition?.mode, "model_assisted");
  assert.equal(model.body?.metadata?.composition?.modelCallCount, 1);
  assert(model.body?.metadata?.metrics?.modelMs > 0, "model latency missing");
  assertCommercialConsistency(model, "model-assisted");
  results.push({ id: "model-assisted", ...model });

  const recoverySession = `bp3-recovery-${suffix}`;
  await ask({
    message: "Compare my recommended mattress with the 14-inch Hybrid.",
    sessionId: recoverySession,
    testCaseId: "bp3-recovery-primer",
  });
  const recovery = await ask({
    message: "No, I meant the other one.",
    sessionId: recoverySession,
    testCaseId: "bp3-recovery",
  });
  assert.equal(recovery.body?.metadata?.quality?.recoveryStatus, "recovered");
  assert(/got it|thanks for correcting/i.test(recovery.reply), "recovery did not acknowledge the correction");
  assertCommercialConsistency(recovery, "recovery");
  results.push({ id: "recovery", ...recovery });

  const ambiguousContext = {
    ...canonicalContext,
    askSnoozerWorkingMemory: {
      turnIndex: 2,
      slots: { size: { value: "King" }, painPoints: { value: ["shoulder", "hip"] } },
      activeDeal: {
        stage: "comparing",
        activeProductHandle: null,
        recentProductHandle: null,
        comparisonProductHandles: ["12-all-foam-mattress", "14-hybrid"],
        activeSize: "King",
        activeBaseHandle: null,
        activeMotionKey: "none",
        activeQuote: null,
        currentTopic: "comparison",
      },
    },
  };
  const ambiguous = await ask({
    message: "What would that one cost?",
    sessionId: `bp3-ambiguous-${suffix}`,
    testCaseId: "bp3-ambiguous-reference",
    context: ambiguousContext,
  });
  assert.equal(ambiguous.body?.metadata?.qualityGate?.intent, "reference_clarification");
  assert(/which one|do not want to guess/i.test(ambiguous.reply), "ambiguous reference was answered confidently");
  assertCommercialConsistency(ambiguous, "ambiguous-reference");
  results.push({ id: "ambiguous-reference", ...ambiguous });

  const snoozeCode = String(100000 + (Date.now() % 900000));
  const deviceA = await ask({
    message: "I liked the elevated position.",
    sessionId: `bp3-device-a-${suffix}`,
    snoozeCode,
    testCaseId: "bp3-cross-device-a",
  });
  const deviceB = await ask({
    message: "What did I say I liked?",
    sessionId: `bp3-device-b-${suffix}`,
    snoozeCode,
    testCaseId: "bp3-cross-device-b",
  });
  assert.equal(deviceA.body.sessionId, deviceB.body.sessionId, "same code did not resolve one session");
  assert.equal(deviceA.body?.context?.visitLifecycle?.visitId, deviceB.body?.context?.visitLifecycle?.visitId, "same code did not preserve the active visit");
  assert(/elevated position/i.test(deviceB.reply), "cross-device preference was not recalled");
  assertCommercialConsistency(deviceB, "cross-device");
  results.push({ id: "cross-device", ...deviceB });

  const latencies = results.map((result) => result.elapsedMs);
  const sorted = [...latencies].sort((a, b) => a - b);
  const summary = {
    ok: true,
    apiBase: API_BASE,
    productionTraceVersion: deterministic.body.metadata.quality.traceVersion,
    responsePolicyVersions: [...new Set(results.map((result) => result.body.metadata.quality.responsePolicyVersion))],
    conversations: results.map((result) => ({
      id: result.id,
      latencyMs: result.elapsedMs,
      composition: result.body.metadata.composition.mode,
      modelMs: result.body.metadata.metrics.modelMs,
      outcome: result.body.metadata.quality.outcomeCategory,
      recovery: result.body.metadata.quality.recoveryStatus,
      alert: result.body.metadata.quality.alertSeverity,
    })),
    commercialConsistencyViolations: results.reduce(
      (sum, result) => sum + (result.body?.metadata?.composition?.gate?.violations || []).length,
      0
    ),
    crossDeviceContinuity: true,
    averageLatencyMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    p95LatencyMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
