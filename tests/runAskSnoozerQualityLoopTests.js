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

const stranded = buildAskSnoozerQualityTrace(baseInput({
  query: "Okay.",
  reply: "Standard Motion raises and lowers the head and foot of the bed.",
  plan: {
    taskType: "base_education",
    stage: "configuring",
    responseDepth: "standard",
    confidence: 0.96,
    commercialState: { goalReady: true, clearSubjectChange: false },
    commercialCompletionAttempted: false,
  },
  context: {
    recentConversation: [],
    askSnoozerWorkingMemory: {
      activeGoal: { intent: "price_quote", status: "ready", missingSlots: [] },
    },
  },
  actions: [],
  chips: [],
}));
assert.equal(stranded.commercialOpportunityStranded, true);
assert.equal(stranded.readyGoalCompleted, false);
assert.equal(stranded.outcome.category, "friction");
assert.equal(stranded.alert.severity, "P1");

const educational = buildAskSnoozerQualityTrace(baseInput({
  query: "What is memory foam?",
  reply: "Memory foam contours around the body and absorbs movement.",
  plan: { taskType: "product_education", stage: "exploring", responseDepth: "standard", confidence: 0.96 },
  context: { recentConversation: [] },
  actions: [],
  chips: [],
}));
assert.equal(educational.outcome.category, "neutral_complete");
assert.equal(educational.justifiedNaturalEnding, true);

const quote = {
  ok: true,
  cartReady: true,
  subtotal: 3698,
  currencyCode: "USD",
  compatibility: { status: "compatible" },
  items: [],
};
const completedReadyGoal = buildAskSnoozerQualityTrace(baseInput({
  query: "Okay.",
  reply: "That King configuration works together. The complete setup is $3,698.00.",
  plan: {
    taskType: "bundle_quote",
    stage: "configuring",
    responseDepth: "standard",
    confidence: 0.96,
    commercialState: { goalReady: true, clearSubjectChange: false },
    commercialCompletionAttempted: true,
    staleRouteOverride: true,
  },
  context: {
    recentConversation: [],
    askSnoozerWorkingMemory: {
      activeGoal: { intent: "price_quote", status: "awaiting_decision", missingSlots: [] },
    },
  },
  quote,
  chips: [{ label: "Mattress only", value: "Price mattress only", type: "prompt" }],
}));
assert.equal(completedReadyGoal.readyGoalCompleted, true);
assert.equal(completedReadyGoal.quotePresented, true);
assert.equal(completedReadyGoal.compatibilityChecked, true);
assert.equal(completedReadyGoal.contextualNextActionPresented, true);
assert.equal(completedReadyGoal.staleRouteOverride, true);
assert.equal(completedReadyGoal.outcome.category, "successful_advancement");

const knownRepeat = buildAskSnoozerQualityTrace(baseInput({
  query: "Price the setup.",
  reply: "What size should I price?",
  plan: { taskType: "price_quote", stage: "configuring", responseDepth: "standard", confidence: 0.96 },
  context: {
    recentConversation: [],
    askSnoozerWorkingMemory: {
      slots: { size: { value: "King", provenance: "current_conversation" } },
      activeGoal: { intent: "price_quote", status: "collecting_slots", size: "King" },
      conflicts: [],
    },
  },
  actions: [],
  chips: [],
}));
assert.equal(knownRepeat.knownQuestionRepeated, true);
assert.equal(knownRepeat.outcome.category, "friction");
assert.equal(knownRepeat.alert.severity, "P2");

const validConfirmation = buildAskSnoozerQualityTrace(baseInput({
  query: "Actually make it Queen.",
  reply: "Just to confirm, Queen?",
  plan: {
    taskType: "price_quote",
    stage: "configuring",
    responseDepth: "standard",
    confidence: 0.96,
    recovery: { recognized: true, type: "size_change" },
  },
  context: {
    recentConversation: [],
    askSnoozerWorkingMemory: {
      slots: { size: { value: "Queen", provenance: "current_message" } },
      activeGoal: { intent: "price_quote", status: "collecting_slots", size: "Queen" },
      conflicts: [{ slot: "size" }],
    },
  },
  actions: [],
  chips: [],
}));
assert.equal(validConfirmation.knownQuestionRepeated, false);

const advisorNaturalDecision = buildAskSnoozerQualityTrace(baseInput({
  query: "Do I need the motion base?",
  reply: "You do not need the motion base unless elevation gives you a benefit you value.",
  plan: { taskType: "value_judgment", stage: "evaluating_value", responseDepth: "standard", confidence: 0.96 },
  context: { recentConversation: [] },
  actions: [],
  chips: [],
}));
assert.equal(advisorNaturalDecision.outcome.category, "successful_advancement");

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

const supersededTiming = buildAskSnoozerClientTimingEvent({
  timingId: "timing-old",
  requestId: "request-old",
  phase: "tts_superseded",
  speechSuperseded: true,
  staleSpeechPrevented: true,
  speechTerminalState: "superseded",
  speechSupersededCount: 2,
  speechQueueDepthAfterSupersession: 0,
});
assert.equal(supersededTiming.tts.superseded, true);
assert.equal(supersededTiming.tts.terminalState, "superseded");
assert.equal(supersededTiming.tts.staleSpeechPrevented, true);

assert.deepEqual(aggregateAskSnoozerQualityTraces(null), {
  telemetryStatus: "missing",
  totalTurns: null,
});
assert.equal(aggregateAskSnoozerQualityTraces([]).telemetryStatus, "available_zero_events");
const summary = aggregateAskSnoozerQualityTraces([
  trace,
  recovered,
  stranded,
  educational,
  completedReadyGoal,
  knownRepeat,
  advisorNaturalDecision,
  clientTiming,
  supersededTiming,
]);
assert.equal(summary.totalTurns, 7);
assert.equal(summary.deterministicPercent, 100);
assert.equal(summary.recoveryAttempts, 1);
assert.equal(summary.recoverySuccessRate, 100);
assert.equal(summary.clientTiming.ttsCompleteCount, 1);
assert.equal(summary.clientTiming.ttsSupersededCount, 1);
assert.equal(summary.commercialStrandingCount, 1);
assert.equal(summary.repeatedKnownQuestionCount, 1);
assert.equal(summary.readyGoalCompletionRate, 50);
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
