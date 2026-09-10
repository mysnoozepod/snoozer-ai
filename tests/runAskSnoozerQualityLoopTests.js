#!/usr/bin/env node

const assert = require("assert");
const {
  QUALITY_TRACE_VERSION,
  aggregateAskSnoozerQualityTraces,
  buildAskSnoozerClientTimingEvent,
  buildAskSnoozerQualityTrace,
  classifyFailureSeverity,
  getAskSnoozerQualityConfig,
} = require("../services/askSnoozerQualityTrace");
const {
  BASELINE_POLICY_VERSION,
  PRESENTATION_POLICIES,
  resolveAskSnoozerPresentationPolicy,
} = require("../services/askSnoozerPresentationPolicy");

function baseInput(overrides = {}) {
  return {
    traceId: "trace-live-123",
    sessionId: "123456-secret-session",
    surface: "react_app",
    query: "What did you recommend for me?",
    reply: "I recommend the 12-inch All Foam Mattress.",
    plan: {
      taskType: "canonical_recall",
      stage: "narrowing",
      responseDepth: "standard",
      confidence: 0.96,
      protectedReferences: ["canonicalRecommendation"],
      references: {
        resolution: { phrase: "your recommendation", resolved: true, source: "canonical_recommendation" },
      },
    },
    context: { recentConversation: [] },
    gate: { ok: true, violations: [] },
    compositionMode: "deterministic",
    modelCallCount: 0,
    totalMs: 300,
    factPackComplete: true,
    actions: [],
    chips: [{ label: "Compare", value: "Compare", type: "prompt" }],
    ...overrides,
  };
}

const defaultConfig = getAskSnoozerQualityConfig({});
assert.equal(defaultConfig.sanitizedTextSampleRate, 0);
assert.equal(defaultConfig.responsePolicyVersion, BASELINE_POLICY_VERSION);

const trace = buildAskSnoozerQualityTrace(baseInput({ config: defaultConfig }));
assert.equal(trace.version, QUALITY_TRACE_VERSION);
assert.match(trace.correlationId, /^aq_[a-f0-9]{20}$/);
assert.notEqual(trace.correlationId, "123456-secret-session");
assert.equal(trace.sample, undefined, "raw text must not be sampled by default");
assert.equal(JSON.stringify(trace).includes("123456-secret-session"), false);
assert.equal(JSON.stringify(trace).includes("What did you recommend"), false);
assert.equal(trace.outcome.category, "successful_advancement");
assert.equal(trace.alert.severity, null);
assert.equal(trace.outcome.naturalEnd, false);

const generic = buildAskSnoozerQualityTrace(baseInput({
  query: "Hello",
  reply: "I do not want to guess without the right showroom context.",
  plan: { taskType: "fallback", stage: "exploring", responseDepth: "standard", confidence: 0.42 },
  chips: [],
  fallbackUsed: true,
}));
assert.equal(generic.genericResponse, true);
assert.equal(generic.outcome.naturalEnd, false);
assert.equal(generic.alert.severity, "P2");

const naturalEnd = buildAskSnoozerQualityTrace(baseInput({
  query: "Thank you",
  reply: "You’re welcome.",
  plan: { taskType: "conversation_end", stage: "complete", responseDepth: "quick", confidence: 0.96 },
  actions: [],
  chips: [],
}));
assert.equal(naturalEnd.outcome.naturalEnd, true);

const sampled = buildAskSnoozerQualityTrace(baseInput({
  query: "Email me at shopper@example.com or call 212-555-1212 using code 123456.",
  config: getAskSnoozerQualityConfig({
    ASK_SNOOZER_QUALITY_TEXT_SAMPLE_RATE: "1",
    ASK_SNOOZER_QUALITY_TEXT_MAX_CHARS: "200",
  }),
}));
assert.equal(sampled.sampling.textSampled, true);
assert.match(sampled.sample.question, /\[email\]/);
assert.match(sampled.sample.question, /\[phone\]/);
assert.equal(sampled.sample.question.includes("123456"), false);

const recovered = buildAskSnoozerQualityTrace(baseInput({
  query: "No, I meant the other one.",
  reply: "Got it—you mean the 14-inch Hybrid. It feels more lifted and responsive.",
  plan: {
    taskType: "product_experience",
    stage: "narrowing",
    responseDepth: "standard",
    confidence: 0.96,
    recovery: { recognized: true },
    references: { resolution: { phrase: "the other one", resolved: true, source: "comparison_other" } },
  },
  compositionFallbackUsed: true,
  modelGate: { ok: false, violations: ["unverified_price:$9,999.00"] },
}));
assert.equal(recovered.outcome.recovery.attempted, true);
assert.equal(recovered.outcome.recovery.success, true);
assert.equal(recovered.recoveryStatus, "recovered");
assert.equal(recovered.alert.severity, "P2");

const p0 = classifyFailureSeverity({
  consistencyGate: { violations: ["price_card_mismatch:14-hybrid"] },
  quoteConsistent: false,
  savedRecommendationPreserved: true,
});
assert.equal(p0.severity, "P0");

const clientTiming = buildAskSnoozerClientTimingEvent({
  timingId: "timing-123",
  requestId: "request-123",
  phase: "tts_complete",
  requestToFirstFeedbackMs: 12,
  speechDurationMs: 4321,
  email: "must-not-appear@example.com",
});
assert.equal(clientTiming.phase, "tts_complete");
assert.equal(clientTiming.timings.speechDurationMs, 4321);
assert.equal(JSON.stringify(clientTiming).includes("must-not-appear"), false);

assert.deepEqual(aggregateAskSnoozerQualityTraces(null), {
  telemetryStatus: "missing",
  totalTurns: null,
});
assert.equal(aggregateAskSnoozerQualityTraces([]).telemetryStatus, "available_zero_events");
const summary = aggregateAskSnoozerQualityTraces([trace, recovered, clientTiming]);
assert.equal(summary.totalTurns, 2);
assert.equal(summary.deterministicPercent, 100);
assert.equal(summary.recoveryAttempts, 1);
assert.equal(summary.recoverySuccessRate, 100);
assert.equal(summary.clientTiming.ttsCompleteCount, 1);
assert.equal(summary.humanReview.status, "missing");

const baseline = resolveAskSnoozerPresentationPolicy({ correlationId: "session", env: {} });
assert.equal(baseline.version, BASELINE_POLICY_VERSION);
assert.equal(baseline.assignment, "control");
const forced = resolveAskSnoozerPresentationPolicy({
  correlationId: "session",
  env: { ASK_SNOOZER_PRESENTATION_POLICY_VERSION: "direct-answer-first-v1" },
});
assert.equal(forced.version, "direct-answer-first-v1");
assert(PRESENTATION_POLICIES[forced.version]);

console.log("Ask Snoozer production quality-loop tests passed (privacy, outcome, recovery, client timing, reporting, experiments, severity)." );
