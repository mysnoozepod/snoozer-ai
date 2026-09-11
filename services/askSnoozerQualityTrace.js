const crypto = require("crypto");

const QUALITY_TRACE_VERSION = "ask-snoozer-quality-v1";
const OUTCOME_MODEL_VERSION = "ask-snoozer-outcome-v1";
const RECOVERY_MODEL_VERSION = "ask-snoozer-recovery-v1";
const DEFAULT_RESPONSE_POLICY_VERSION = "baseline-v1";
const SHOPPER_LANGUAGE_BLOCKLIST = Object.freeze([
  "shopify", "showroom canon", "canonical", "page context", "api", "backend", "s3",
  "retrieval", "resolver", "database", "source of truth", "deterministic", "working memory",
  "active goal", "current verified option", "verified adjustable option",
]);

const SEVERITY_DEFINITIONS = Object.freeze({
  P0: "Commercial truth, cart integrity, canonical identity, compatibility, or safety integrity failure.",
  P1: "Broken conversation or failed recovery that prevents a trustworthy answer.",
  P2: "Quality friction such as an unnecessary probe, generic answer, or recovered model rejection.",
  P3: "Polish or performance degradation that does not change commercial truth.",
});

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseBoolean(value, fallback = false) {
  const token = clean(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(token)) return true;
  if (["0", "false", "no", "off"].includes(token)) return false;
  return fallback;
}

function getAskSnoozerQualityConfig(env = process.env) {
  return Object.freeze({
    enabled: parseBoolean(env.ASK_SNOOZER_QUALITY_TRACE_ENABLED, true),
    sanitizedTextSampleRate: clampNumber(
      env.ASK_SNOOZER_QUALITY_TEXT_SAMPLE_RATE,
      0,
      1,
      0
    ),
    sanitizedTextMaxChars: Math.round(
      clampNumber(env.ASK_SNOOZER_QUALITY_TEXT_MAX_CHARS, 40, 300, 160)
    ),
    samplingSalt: clean(env.ASK_SNOOZER_QUALITY_SAMPLING_SALT) || QUALITY_TRACE_VERSION,
    responsePolicyVersion:
      clean(env.ASK_SNOOZER_PRESENTATION_POLICY_VERSION) ||
      DEFAULT_RESPONSE_POLICY_VERSION,
    deterministicElevatedMs: Math.round(
      clampNumber(env.ASK_SNOOZER_DETERMINISTIC_ELEVATED_MS, 250, 10_000, 750)
    ),
    deterministicBreachMs: Math.round(
      clampNumber(env.ASK_SNOOZER_DETERMINISTIC_BREACH_MS, 500, 20_000, 1_500)
    ),
    modelElevatedMs: Math.round(
      clampNumber(env.ASK_SNOOZER_MODEL_ELEVATED_MS, 1_000, 20_000, 4_000)
    ),
    modelBreachMs: Math.round(
      clampNumber(env.ASK_SNOOZER_MODEL_BREACH_MS, 2_000, 30_000, 6_500)
    ),
  });
}

function safeCorrelationId(value, salt = QUALITY_TRACE_VERSION) {
  const token = clean(value);
  if (!token) return null;
  return `aq_${crypto.createHash("sha256").update(`${salt}:${token}`).digest("hex").slice(0, 20)}`;
}

function deterministicBucket(value, salt = QUALITY_TRACE_VERSION) {
  const digest = crypto.createHash("sha256").update(`${salt}:${clean(value)}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function sanitizeReviewText(value, maxChars = 160) {
  return clean(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[phone]")
    .replace(/\b\d{4,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .slice(0, maxChars);
}

function normalizeQuestion(value = "") {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function responseComplete(reply = "") {
  const text = clean(reply);
  return Boolean(text && /[.!?]$/.test(text) && !text.endsWith("..."));
}

function responseWordCount(reply = "") {
  return clean(reply).split(/\s+/).filter(Boolean).length;
}

function questionCount(reply = "") {
  return (clean(reply).match(/\?/g) || []).length;
}

function isGenericResponse(reply = "") {
  const text = normalizeQuestion(reply);
  return [
    "i do not want to guess without the right context",
    "i do not want to guess without the right showroom context",
    "tell me more and i will help",
    "how can i help you today",
    "try asking that another way",
  ].some((phrase) => text.includes(phrase));
}

function correctionSignals(query = "") {
  const text = normalizeQuestion(query);
  const signals = [];
  if (/\b(?:no i meant|not that|other one|you misunderstood|that.s not what i meant|correct that)\b/.test(text)) {
    signals.push("explicit_correction");
  }
  if (/\b(?:actually|changed my mind|instead|switch|make that|remove|without|mattress only|failed|try again|go back|return to)\b/.test(text)) {
    signals.push("decision_or_configuration_change");
  }
  return signals;
}

function repeatedQuestion(query = "", context = {}) {
  const current = normalizeQuestion(query);
  if (!current) return false;
  const history = Array.isArray(context?.recentConversation)
    ? context.recentConversation
    : Array.isArray(context?.askSnoozerWorkingMemory?.conversationFocus?.relevantTurns)
      ? context.askSnoozerWorkingMemory.conversationFocus.relevantTurns
      : [];
  const matchingIndexes = history
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry?.role === "user" && normalizeQuestion(entry?.content) === current)
    .map(({ index }) => index);
  const lastIsCurrent = matchingIndexes.length > 0 && matchingIndexes.at(-1) === history.length - 1;
  return matchingIndexes.length > (lastIsCurrent ? 1 : 0);
}

function knownQuestionRepeated(reply = "", plan = {}, context = {}) {
  const text = normalizeQuestion(reply);
  if (!text || correctionSignals(plan.query || "").length || plan?.recovery?.type === "size_change") {
    return false;
  }
  const memory = isObject(context?.askSnoozerWorkingMemory)
    ? context.askSnoozerWorkingMemory
    : {};
  const goal = isObject(memory.activeGoal) ? memory.activeGoal : {};
  const deal = isObject(memory.activeDeal) ? memory.activeDeal : {};
  const conflicts = new Set(
    (Array.isArray(memory.conflicts) ? memory.conflicts : [])
      .map((entry) => clean(entry?.slot))
      .filter(Boolean)
  );
  const knownSize = clean(goal.size || memory?.slots?.size?.value || deal.activeSize);
  if (
    knownSize &&
    !conflicts.has("size") &&
    /\b(?:what|which) size\b|\bconfirm (?:the |your )?size\b/.test(text)
  ) {
    return true;
  }
  const knownProduct = clean(goal.productHandle || deal.activeProductHandle);
  if (
    knownProduct &&
    !conflicts.has("productHandle") &&
    /\bwhich (?:mattress|product|one) (?:do you|should i|are you)\b|\bwhat (?:mattress|product)\b/.test(text)
  ) {
    return true;
  }
  return false;
}

function responseDepthFit(depth = "standard", wordCount = 0) {
  if (!wordCount) return false;
  if (depth === "quick") return wordCount <= 70;
  if (depth === "deep") return wordCount >= 35;
  if (depth === "compare" || depth === "teach" || depth === "coach") return wordCount >= 18;
  return wordCount <= 180;
}

function classifyLatency(mode, totalMs, config) {
  const modelAssisted = String(mode || "").startsWith("model_");
  const elevated = modelAssisted ? config.modelElevatedMs : config.deterministicElevatedMs;
  const breach = modelAssisted ? config.modelBreachMs : config.deterministicBreachMs;
  if (totalMs > breach) return { band: "breach", elevatedMs: elevated, breachMs: breach };
  if (totalMs > elevated) return { band: "elevated", elevatedMs: elevated, breachMs: breach };
  return { band: "expected", elevatedMs: elevated, breachMs: breach };
}

function classifyOutcome({
  plan = {},
  reply = "",
  actions = [],
  chips = [],
  products = [],
  gate = {},
  modelGate = null,
  fallbackUsed = false,
  compositionFallbackUsed = false,
  referenceResolution = null,
  repeated = false,
  knownRepeated = false,
  commercialSignals = {},
} = {}) {
  const task = clean(plan.taskType) || "unknown";
  const normalizedQuery = normalizeQuestion(plan.query || "");
  const shopperEndedNaturally = /^(?:thanks|thank you|that s all|that is all|i m done|i am done|we re done|we are done|no thanks)$/.test(normalizedQuery);
  const corrections = correctionSignals(plan.query || "");
  const recoveryAttempted = Boolean(plan?.recovery) || corrections.length > 0 || compositionFallbackUsed;
  const referenceRequired = Boolean(referenceResolution?.phrase);
  const referenceResolved = !referenceRequired || Boolean(referenceResolution?.resolved);
  const referenceSafelyHandled = referenceResolved || plan.taskType === "reference_clarification";
  const complete = responseComplete(reply);
  const gatePassed = gate?.ok !== false;
  const modelRejected = Boolean(compositionFallbackUsed && modelGate?.ok === false);
  const recognized = Boolean(plan?.recovery?.recognized || corrections.length || modelRejected);
  const recoverySuccess = recoveryAttempted
    ? Boolean(recognized && gatePassed && complete && referenceSafelyHandled)
    : null;
  const friction = [];
  if (repeated) friction.push("repeated_question");
  if (knownRepeated) friction.push("known_question_repeated");
  if (commercialSignals.commercialOpportunityStranded) {
    friction.push("commercial_opportunity_stranded");
  }
  if (commercialSignals.explicitStateChangeAcknowledged === false) friction.push("explicit_state_change_not_acknowledged");
  if (commercialSignals.confusionRecovered === false) friction.push("confusion_not_recovered");
  if (commercialSignals.requestedScopePreserved === false) friction.push("requested_scope_not_preserved");
  if (commercialSignals.partialActionSuppressed === false) friction.push("partial_action_not_suppressed");
  if (commercialSignals.shopperLanguageClean === false) friction.push("shopper_language_violation");
  if (!referenceResolved) friction.push("unresolved_reference");
  if (!complete) friction.push("incomplete_response");
  if (fallbackUsed && !modelRejected) friction.push("fallback_used");
  if (isGenericResponse(reply)) friction.push("generic_response");
  if (questionCount(reply) > 1) friction.push("multiple_probes");
  if (modelRejected) friction.push("model_composition_rejected_and_recovered");
  if (recoveryAttempted && !recoverySuccess) friction.push("recovery_incomplete");

  const advancementByTask = {
    canonical_recommendation: "recommendation_understood",
    canonical_recall: "recommendation_restored",
    product_comparison: "comparison_completed",
    advisor_choice: "decision_guidance_completed",
    price_quote: "quote_understood",
    bundle_quote: "configuration_and_quote_clarified",
    savings_quote: "lower_cost_option_understood",
    compatibility: "compatibility_resolved",
    value_judgment: "objection_or_value_tradeoff_resolved",
    cart_add: "requested_cart_action_resolved",
    preference_capture: "shopper_preference_updated",
    reference_clarification: "ambiguous_reference_clarified",
  };
  const advancementType = advancementByTask[task] || null;
  let category = "neutral_complete";
  if (friction.some((item) => item !== "model_composition_rejected_and_recovered")) category = "friction";
  else if (recoveryAttempted) category = recoverySuccess ? "recovery" : "friction";
  else if ((advancementType || commercialSignals.decisionAdvanced) && gatePassed && complete) {
    category = "successful_advancement";
  }

  return {
    version: OUTCOME_MODEL_VERSION,
    category,
    advancementType,
    completed: complete,
    naturalEnd: Boolean(commercialSignals.justifiedNaturalEnding || (complete && shopperEndedNaturally)),
    friction,
    recovery: {
      version: RECOVERY_MODEL_VERSION,
      attempted: recoveryAttempted,
      recognized,
      success: recoverySuccess,
      signals: corrections.concat(modelRejected ? ["model_gate_safe_fallback"] : []),
    },
  };
}

function classifyFailureSeverity(trace = {}) {
  const gateViolations = Array.isArray(trace?.consistencyGate?.violations)
    ? trace.consistencyGate.violations
    : [];
  const codes = [];
  const commercialTruthFailure = gateViolations.some((item) =>
    /price_|subtotal_|canonical_|compatibility_|motion_configuration|unsafe_cart|unverified_(?:price|product)/.test(item)
  );
  if (commercialTruthFailure || trace.quoteConsistent === false || trace.savedRecommendationPreserved === false) {
    codes.push("commercial_truth_integrity");
    return { severity: "P0", codes };
  }
  if (
    trace.commercialOpportunityStranded ||
    trace.multipleProbes ||
    trace.responseComplete === false ||
    trace.confusionRecovered === false ||
    trace.requestedScopePreserved === false ||
    trace.partialActionSuppressed === false ||
    (trace.referenceResolution?.phrase && !trace.referenceResolution?.resolved && trace.confidentCommercialAnswer) ||
    trace.outcome?.recovery?.success === false
  ) {
    if (trace.commercialOpportunityStranded) codes.push("commercial_opportunity_stranded");
    if (trace.multipleProbes) codes.push("multiple_probes");
    if (trace.responseComplete === false) codes.push("incomplete_response");
    if (trace.confusionRecovered === false) codes.push("confusion_not_recovered");
    if (trace.requestedScopePreserved === false) codes.push("requested_scope_not_preserved");
    if (trace.partialActionSuppressed === false) codes.push("partial_action_not_suppressed");
    if (trace.referenceResolution?.phrase && !trace.referenceResolution?.resolved) codes.push("unresolved_protected_reference");
    if (trace.outcome?.recovery?.success === false) codes.push("failed_recovery");
    return { severity: "P1", codes };
  }
  if (
    trace.knownQuestionRepeated ||
    trace.repeatedQuestion ||
    trace.composition?.rejected ||
    trace.fallbackUsed ||
    trace.genericResponse ||
    trace.firewallPassed === false
  ) {
    if (trace.knownQuestionRepeated) codes.push("known_question_repeated");
    if (trace.repeatedQuestion) codes.push("repeated_question");
    if (trace.composition?.rejected) codes.push("model_composition_rejected");
    if (trace.fallbackUsed) codes.push("fallback_used");
    if (trace.genericResponse) codes.push("generic_response");
    if (trace.firewallPassed === false) codes.push("language_firewall_violation");
    return { severity: "P2", codes };
  }
  if (trace.latency?.band === "breach" || trace.depthFit === false) {
    if (trace.latency?.band === "breach") codes.push("latency_breach");
    if (trace.depthFit === false) codes.push("response_depth_mismatch");
    return { severity: "P3", codes };
  }
  return { severity: null, codes: [] };
}

function buildAskSnoozerQualityTrace({
  timestamp = new Date(),
  traceId,
  sessionId,
  surface,
  deviceCategory,
  query = "",
  reply = "",
  plan = {},
  context = {},
  actions = [],
  chips = [],
  products = [],
  gate = {},
  modelGate = null,
  compositionMode = "deterministic",
  compositionFallbackUsed = false,
  modelCallCount = 0,
  totalMs = 0,
  modelMs = 0,
  factPackComplete = false,
  quote = null,
  fallbackUsed = false,
  visitMetadata = null,
  regressionId = null,
  responsePolicyVersion = null,
  config = getAskSnoozerQualityConfig(),
} = {}) {
  const safeSessionCorrelationId = safeCorrelationId(sessionId || traceId, config.samplingSalt);
  const samplingKey = safeSessionCorrelationId || traceId || query;
  const textSampled = config.sanitizedTextSampleRate > 0 &&
    deterministicBucket(samplingKey, config.samplingSalt) < config.sanitizedTextSampleRate;
  const referenceResolution = plan?.references?.resolution || null;
  const repeated = repeatedQuestion(query, context);
  const renderedControlText = [
    ...actions.flatMap((action) => [action?.label, action?.type]),
    ...chips.flatMap((chip) => [chip?.label, chip?.value]),
    ...products.flatMap((product) => [product?.title, product?.subtitle]),
  ].map(clean).filter(Boolean).join(" ");
  const finalVisibleText = `${clean(reply)} ${renderedControlText}`.trim();
  const knownRepeated = knownQuestionRepeated(finalVisibleText, { ...plan, query }, context);
  const commercialState = isObject(plan?.commercialState) ? plan.commercialState : {};
  const goal = isObject(context?.askSnoozerWorkingMemory?.activeGoal)
    ? context.askSnoozerWorkingMemory.activeGoal
    : {};
  const quotePresented = Boolean(quote?.ok && responseComplete(reply));
  const compatibilityChecked = ["compatible", "incompatible", "not_applicable"].includes(
    clean(quote?.compatibility?.status)
  );
  const contextualNextActionPresented = Boolean(actions.length || chips.length);
  const explicitStateChange = /\b(?:i need|i want|make it|go with|actually)\b.*\b(?:twin xl|twin|full|queen|king|soft|medium|firm)\b/.test(normalizeQuestion(query));
  const knownSize = clean(context?.askSnoozerWorkingMemory?.activeDeal?.activeSize || plan?.knownFacts?.size);
  const explicitStateChangeAcknowledged = !explicitStateChange || (knownSize && normalizeQuestion(reply).includes(normalizeQuestion(knownSize)));
  const confusionEvent = /\b(?:confused|getting lost|i am lost|what am i choosing|simplify)\b/.test(normalizeQuestion(query));
  const confusionRecovered = !confusionEvent || (
    clean(plan.taskType) === "confusion_recovery" &&
    responseComplete(reply) &&
    /\b(?:looking at|already decided|open decision|only open|simple version)\b/.test(normalizeQuestion(reply))
  );
  const fullSetupRequested = ["mattress_plus_base", "full_pod"].includes(clean(commercialState.requestedScope)) || clean(plan.taskType) === "bundle_quote";
  const partialPurchaseVisible = products.some((product) => product?.suppressAddToCart !== true && product?.exactVariantResolved === true) || actions.some((action) => action?.type === "add_to_cart");
  const requestedScopePreserved = !(fullSetupRequested && quote?.ok === false && partialPurchaseVisible);
  const partialActionSuppressed = !fullSetupRequested || quote?.ok === true || !partialPurchaseVisible;
  const shopperLanguageClean = !SHOPPER_LANGUAGE_BLOCKLIST.some((phrase) => normalizeQuestion(finalVisibleText).includes(normalizeQuestion(phrase)));
  const contextualNextActionAvailable = Boolean(
    commercialState.goalReady ||
      quotePresented ||
      quote?.compatibility?.status === "incompatible" ||
      ["price_quote", "bundle_quote", "savings_quote", "compatibility", "cart_add"].includes(
        clean(plan.taskType)
      )
  );
  const readyGoalCompleted = Boolean(
    commercialState.goalReady &&
      (quotePresented || quote?.compatibility?.status === "incompatible") &&
      contextualNextActionPresented
  );
  const commercialOpportunityStranded = Boolean(
    commercialState.goalReady &&
      !readyGoalCompleted &&
      commercialState.clearSubjectChange !== true
  );
  const activeGoalStillActionable = Boolean(
    goal.intent === "price_quote" &&
      ["collecting_slots", "ready", "resolving", "presented", "awaiting_decision"].includes(
        clean(goal.status)
      )
  );
  const decisionAdvanced = Boolean(
    quotePresented ||
      compatibilityChecked ||
      contextualNextActionPresented ||
      [
        "canonical_recommendation",
        "canonical_recall",
        "product_comparison",
        "advisor_choice",
        "value_judgment",
      "preference_capture",
        "compound_product_base",
        "durability_objection",
        "hybrid_exploration",
        "configuration_update",
        "confusion_recovery",
      ].includes(clean(plan.taskType))
  );
  const normalizedQuery = normalizeQuestion(query);
  const explicitConversationEnd = /^(?:thanks|thank you|that s all|that is all|i m done|i am done|we re done|we are done|no thanks)$/.test(
    normalizedQuery
  );
  const justifiedNaturalEnding = Boolean(
    explicitConversationEnd ||
      (!activeGoalStillActionable &&
        !commercialState.goalReady &&
        !commercialOpportunityStranded &&
        !contextualNextActionPresented &&
        responseComplete(reply) &&
        !repeated &&
        !knownRepeated &&
        !isGenericResponse(reply) &&
        ![
          "canonical_recommendation",
          "canonical_recall",
          "product_comparison",
          "advisor_choice",
          "value_judgment",
          "preference_capture",
          "price_quote",
          "bundle_quote",
          "savings_quote",
          "compatibility",
          "cart_add",
        ].includes(
          clean(plan.taskType)
        ))
  );
  const commercialSignals = {
    readyGoalCompleted,
    commercialOpportunityStranded,
    justifiedNaturalEnding,
    decisionAdvanced,
    quotePresented,
    compatibilityChecked,
    contextualNextActionAvailable,
    contextualNextActionPresented,
    activeGoalStillActionable,
    staleRouteOverride: Boolean(plan.staleRouteOverride),
    commercialCompletionAttempted: Boolean(plan.commercialCompletionAttempted),
    explicitStateChangeAcknowledged,
    confusionRecovered,
    knownInformationReasked: knownRepeated,
    requestedScopePreserved,
    partialActionSuppressed,
    groundingSufficient: Boolean(factPackComplete && gate?.ok !== false),
    modelCompositionUsed: compositionMode === "model_assisted" && Number(modelCallCount) > 0,
    responseCompletedNaturally: responseComplete(reply),
    shopperLanguageClean,
  };
  const outcome = classifyOutcome({
    plan: { ...plan, query },
    reply,
    actions,
    chips,
    gate,
    modelGate,
    fallbackUsed,
    compositionFallbackUsed,
    referenceResolution,
    repeated,
    knownRepeated,
    commercialSignals,
  });
  const mode = ["model_assisted", "model_fallback", "deterministic_recovery"].includes(compositionMode)
    ? compositionMode
    : "deterministic";
  const wordCount = responseWordCount(reply);
  const trace = {
    version: QUALITY_TRACE_VERSION,
    timestamp: timestamp instanceof Date ? timestamp.toISOString() : clean(timestamp),
    correlationId: safeSessionCorrelationId,
    requestCorrelationId: safeCorrelationId(traceId, config.samplingSalt),
    surfaceCategory: clean(surface).slice(0, 48) || "unknown",
    deviceCategory: clean(deviceCategory).slice(0, 48) || "unknown",
    stage: clean(plan.stage) || "unknown",
    task: clean(plan.taskType) || "unknown",
    continuation: Boolean(plan.continuationOf),
    depth: clean(plan.responseDepth) || "standard",
    responseStrategy: clean(plan.answerMode || plan.taskType) || "unknown",
    responsePolicyVersion: clean(responsePolicyVersion) || config.responsePolicyVersion,
    composition: {
      mode,
      modelCallCount: Math.max(0, Number(modelCallCount) || 0),
      rejected: Boolean(compositionFallbackUsed && modelGate?.ok === false),
    },
    latency: {
      totalMs: Math.max(0, Number(totalMs) || 0),
      modelMs: Math.max(0, Number(modelMs) || 0),
      ...classifyLatency(mode, Number(totalMs) || 0, config),
    },
    referenceResolution: referenceResolution
      ? {
          phrase: clean(referenceResolution.phrase) || null,
          resolved: Boolean(referenceResolution.resolved),
          source: clean(referenceResolution.source) || null,
        }
      : { phrase: null, resolved: true, source: null },
    factPackComplete: Boolean(factPackComplete),
    savedRecommendationPreserved: !(
      Array.isArray(gate?.violations) && gate.violations.includes("canonical_reference_lost")
    ),
    quoteConsistent: !(
      Array.isArray(gate?.violations) && gate.violations.some((item) => /price_|subtotal_/.test(item))
    ),
    compatibilityResult: clean(quote?.compatibility?.status) || null,
    activeGoal: clean(goal.intent) || clean(commercialState.activeGoal) || null,
    goalStatus: clean(goal.status) || clean(commercialState.goalStatus) || null,
    goalReady: Boolean(commercialState.goalReady),
    activeQuoteReady: Boolean(
      quote?.cartReady || context?.askSnoozerWorkingMemory?.activeDeal?.activeQuote?.cartReady
    ),
    consistencyGate: {
      passed: gate?.ok !== false,
      violations: Array.isArray(gate?.violations) ? gate.violations.slice(0, 8) : [],
    },
    probeUsed: questionCount(reply) === 1,
    multipleProbes: questionCount(reply) > 1,
    nextActionOffered: Boolean(actions.length || chips.length),
    firewallPassed: shopperLanguageClean && !(
      Array.isArray(gate?.violations) && gate.violations.some((item) => item.startsWith("internal_language"))
    ),
    medicalBoundaryTriggered: Boolean(plan.medicalBoundary || plan.taskType === "medical_boundary"),
    fallbackUsed: Boolean(fallbackUsed),
    recoveryStatus: outcome.recovery.attempted
      ? outcome.recovery.success
        ? "recovered"
        : "failed"
      : "not_attempted",
    visit: {
      reused: Boolean(visitMetadata?.reused),
      rotated: Boolean(visitMetadata?.rotated),
      rotationReason: clean(visitMetadata?.rotationReason) || null,
    },
    responseComplete: responseComplete(reply),
    responseWordCount: wordCount,
    depthFit: responseDepthFit(plan.responseDepth, wordCount),
    repeatedQuestion: repeated,
    knownQuestionRepeated: knownRepeated,
    genericResponse: isGenericResponse(reply),
    ...commercialSignals,
    regressionId: clean(regressionId).replace(/[^a-z0-9_.:-]/gi, "").slice(0, 80) || null,
    questionFingerprint: safeCorrelationId(normalizeQuestion(query), config.samplingSalt),
    outcome,
    sampling: {
      sanitizedTextSampleRate: config.sanitizedTextSampleRate,
      textSampled,
    },
  };
  trace.confidentCommercialAnswer = Boolean(
    plan.confidence >= 0.9 && ["price_quote", "bundle_quote", "compatibility", "cart_add"].includes(plan.taskType)
  );
  trace.alert = classifyFailureSeverity(trace);
  if (textSampled) {
    trace.sample = {
      question: sanitizeReviewText(query, config.sanitizedTextMaxChars),
      response: sanitizeReviewText(reply, config.sanitizedTextMaxChars),
    };
  }
  return trace;
}

function buildAskSnoozerClientTimingEvent(payload = {}, config = getAskSnoozerQualityConfig()) {
  const allowedPhase = [
    "display",
    "tts_start",
    "tts_complete",
    "tts_unavailable",
    "tts_error",
    "tts_cancelled",
    "tts_superseded",
  ];
  const phase = allowedPhase.includes(clean(payload.phase)) ? clean(payload.phase) : "display";
  const number = (value, max = 120_000) => Math.round(clampNumber(value, 0, max, 0));
  return {
    version: QUALITY_TRACE_VERSION,
    timestamp: new Date().toISOString(),
    correlationId: safeCorrelationId(payload.timingId || payload.requestId, config.samplingSalt),
    requestCorrelationId: safeCorrelationId(payload.requestId, config.samplingSalt),
    phase,
    surfaceCategory: clean(payload.surface).slice(0, 48) || "ask_snoozer",
    responsePolicyVersion: clean(payload.responsePolicyVersion).slice(0, 64) || config.responsePolicyVersion,
    timings: {
      requestToFirstFeedbackMs: number(payload.requestToFirstFeedbackMs),
      backendRoundTripMs: number(payload.backendRoundTripMs),
      backendReportedMs: number(payload.backendReportedMs),
      responseToDisplayMs: number(payload.responseToDisplayMs),
      requestToDisplayMs: number(payload.requestToDisplayMs),
      responseToTtsStartMs: number(payload.responseToTtsStartMs),
      speechWaitBeforeStartMs: number(payload.speechWaitBeforeStartMs),
      speechQueueWaitMs: number(payload.speechQueueWaitMs),
      ttsPreparationMs: number(payload.ttsPreparationMs),
      speechDurationMs: number(payload.speechDurationMs, 300_000),
      totalPerceivedMs: number(payload.totalPerceivedMs, 300_000),
    },
    tts: {
      requested: Boolean(payload.ttsRequested),
      played: Boolean(payload.ttsPlayed),
      captionsOnly: Boolean(payload.captionsOnly),
      interrupted: Boolean(payload.interrupted),
      superseded: Boolean(payload.speechSuperseded),
      staleSpeechPrevented: Boolean(payload.staleSpeechPrevented),
      terminalState: clean(payload.speechTerminalState).slice(0, 32) || null,
      queueDepthAtEnqueue: number(payload.speechQueueDepthAtEnqueue, 100),
      queueDepthAfterSupersession: number(payload.speechQueueDepthAfterSupersession, 100),
      supersededCount: number(payload.speechSupersededCount, 100),
      activeSpeechTurnId: safeCorrelationId(payload.activeSpeechTurnId, config.samplingSalt),
    },
  };
}

function buildQualityMetricEnvelope(trace = {}, environment = process.env.REWARDS_ENVIRONMENT || "staging") {
  const severity = trace?.alert?.severity || "none";
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: "Snoozer/ConversationQuality",
          Dimensions: [["Environment", "CompositionMode"]],
          Metrics: [
            { Name: "Turns", Unit: "Count" },
            { Name: "Fallbacks", Unit: "Count" },
            { Name: "RecoveryAttempts", Unit: "Count" },
            { Name: "RecoverySuccesses", Unit: "Count" },
            { Name: "LatencyBreaches", Unit: "Count" },
            { Name: "P0Failures", Unit: "Count" },
            { Name: "P1Failures", Unit: "Count" },
            { Name: "SuccessfulAdvancements", Unit: "Count" },
            { Name: "CommercialStranding", Unit: "Count" },
            { Name: "ReadyGoalCompletions", Unit: "Count" },
          ],
        },
      ],
    },
    Environment: clean(environment) || "staging",
    CompositionMode: trace?.composition?.mode || "deterministic",
    Turns: 1,
    Fallbacks: trace?.fallbackUsed ? 1 : 0,
    RecoveryAttempts: trace?.outcome?.recovery?.attempted ? 1 : 0,
    RecoverySuccesses: trace?.outcome?.recovery?.success ? 1 : 0,
    LatencyBreaches: trace?.latency?.band === "breach" ? 1 : 0,
    P0Failures: severity === "P0" ? 1 : 0,
    P1Failures: severity === "P1" ? 1 : 0,
    SuccessfulAdvancements: trace?.outcome?.category === "successful_advancement" ? 1 : 0,
    CommercialStranding: trace?.commercialOpportunityStranded ? 1 : 0,
    ReadyGoalCompletions: trace?.readyGoalCompleted ? 1 : 0,
  };
}

function emitAskSnoozerQualityTrace({ log, metricSink = console.log, ...input } = {}) {
  const config = input.config || getAskSnoozerQualityConfig();
  if (!config.enabled) return null;
  const trace = buildAskSnoozerQualityTrace({ ...input, config });
  if (typeof log === "function") log("ask-snoozer.quality-trace", "turn", trace);
  if (trace.alert.severity && typeof log === "function") {
    log("ask-snoozer.quality-alert", trace.alert.severity, {
      version: trace.version,
      correlationId: trace.correlationId,
      requestCorrelationId: trace.requestCorrelationId,
      severity: trace.alert.severity,
      codes: trace.alert.codes,
      task: trace.task,
      compositionMode: trace.composition.mode,
    });
  }
  if (typeof metricSink === "function") {
    metricSink(JSON.stringify(buildQualityMetricEnvelope(trace)));
  }
  return trace;
}

function percentile(values = [], fraction = 0.95) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function average(values = []) {
  const safe = values.map(Number).filter(Number.isFinite);
  return safe.length ? Math.round(safe.reduce((sum, value) => sum + value, 0) / safe.length) : null;
}

function rate(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : null;
}

function aggregateAskSnoozerQualityTraces(events, reviews = null) {
  if (events == null) return { telemetryStatus: "missing", totalTurns: null };
  const traces = (Array.isArray(events) ? events : []).filter(
    (event) => event?.version === QUALITY_TRACE_VERSION && event?.task
  );
  const clientTimings = (Array.isArray(events) ? events : []).filter(
    (event) => event?.version === QUALITY_TRACE_VERSION && event?.phase
  );
  const total = traces.length;
  const count = (predicate) => traces.filter(predicate).length;
  const modes = ["deterministic", "model_assisted", "model_fallback", "deterministic_recovery"];
  const latencyByMode = Object.fromEntries(modes.map((mode) => {
    const values = traces.filter((event) => event?.composition?.mode === mode).map((event) => event?.latency?.totalMs);
    return [mode, { count: values.length, averageMs: average(values), p95Ms: percentile(values) }];
  }));
  const recoveryAttempts = count((event) => event?.outcome?.recovery?.attempted);
  const recoverySuccesses = count((event) => event?.outcome?.recovery?.success === true);
  const reviewScores = Array.isArray(reviews)
    ? reviews.flatMap((review) => Object.values(isObject(review?.scores) ? review.scores : {})).map(Number).filter(Number.isFinite)
    : [];
  return {
    telemetryStatus: total || clientTimings.length ? "available" : "available_zero_events",
    totalTurns: total,
    deterministicPercent: rate(count((event) => event?.composition?.mode === "deterministic"), total),
    modelAssistedPercent: rate(count((event) => event?.composition?.mode === "model_assisted"), total),
    modelFallbackPercent: rate(count((event) => event?.composition?.mode === "model_fallback"), total),
    latencyByMode,
    probeRate: rate(count((event) => event?.probeUsed), total),
    unresolvedReferenceRate: rate(count((event) => event?.referenceResolution?.phrase && !event?.referenceResolution?.resolved), total),
    consistencyGateRejectionRate: rate(count((event) => event?.composition?.rejected), total),
    deterministicFallbackRate: rate(count((event) => event?.composition?.rejected && event?.composition?.mode === "deterministic"), total),
    fallbackRate: rate(count((event) => event?.fallbackUsed), total),
    successfulAdvancementRate: rate(count((event) => event?.outcome?.category === "successful_advancement"), total),
    neutralCompleteRate: rate(count((event) => event?.outcome?.category === "neutral_complete"), total),
    frictionRate: rate(count((event) => event?.outcome?.category === "friction"), total),
    recoveryRate: rate(count((event) => event?.outcome?.category === "recovery"), total),
    readyGoalCompletionRate: rate(
      count((event) => event?.readyGoalCompleted),
      count((event) => event?.commercialState?.goalReady || event?.commercialCompletionAttempted || event?.readyGoalCompleted || event?.commercialOpportunityStranded)
    ),
    commercialStrandingCount: count((event) => event?.commercialOpportunityStranded),
    repeatedKnownQuestionCount: count((event) => event?.knownQuestionRepeated),
    quotePresentedWhenReadyRate: rate(
      count((event) => event?.quotePresented && (event?.commercialCompletionAttempted || event?.readyGoalCompleted)),
      count((event) => event?.commercialCompletionAttempted || event?.readyGoalCompleted || event?.commercialOpportunityStranded)
    ),
    compatibilityResolvedWhenPossibleRate: rate(
      count((event) => event?.compatibilityChecked && (event?.commercialCompletionAttempted || event?.readyGoalCompleted)),
      count((event) => event?.commercialCompletionAttempted || event?.readyGoalCompleted || event?.commercialOpportunityStranded)
    ),
    justifiedNaturalEndingRate: rate(count((event) => event?.justifiedNaturalEnding), total),
    genericAnswerRate: rate(count((event) => event?.genericResponse), total),
    quoteConsistencyFailures: count((event) => event?.quoteConsistent === false),
    compatibilityConflicts: count((event) => event?.consistencyGate?.violations?.some((item) => /compatibility/.test(item))),
    languageFirewallViolations: count((event) => event?.firewallPassed === false),
    medicalBoundaryTriggers: count((event) => event?.medicalBoundaryTriggered),
    visitRotations: count((event) => event?.visit?.rotated),
    recoveryAttempts,
    recoverySuccesses,
    recoverySuccessRate: rate(recoverySuccesses, recoveryAttempts),
    repeatedQuestionConversations: new Set(traces.filter((event) => event?.repeatedQuestion).map((event) => event.correlationId)).size,
    naturalEndingRate: rate(count((event) => event?.outcome?.naturalEnd), total),
    contextualNextActionRate: rate(count((event) => event?.nextActionOffered), total),
    alertCounts: Object.fromEntries(["P0", "P1", "P2", "P3"].map((severity) => [severity, count((event) => event?.alert?.severity === severity)])),
    clientTiming: {
      eventCount: clientTimings.length,
      displayCount: clientTimings.filter((event) => event.phase === "display").length,
      ttsStartCount: clientTimings.filter((event) => event.phase === "tts_start").length,
      ttsCompleteCount: clientTimings.filter((event) => event.phase === "tts_complete").length,
      ttsSupersededCount: clientTimings.filter((event) => event.phase === "tts_superseded").length,
      ttsCancelledCount: clientTimings.filter((event) => event.phase === "tts_cancelled").length,
      requestToFirstFeedbackAverageMs: average(clientTimings.map((event) => event?.timings?.requestToFirstFeedbackMs).filter((value) => value > 0)),
      responseToDisplayAverageMs: average(clientTimings.map((event) => event?.timings?.responseToDisplayMs).filter((value) => value > 0)),
      responseToTtsStartAverageMs: average(clientTimings.map((event) => event?.timings?.responseToTtsStartMs).filter((value) => value > 0)),
      speechQueueWaitAverageMs: average(clientTimings.map((event) => event?.timings?.speechQueueWaitMs).filter((value) => value > 0)),
      ttsPreparationAverageMs: average(clientTimings.map((event) => event?.timings?.ttsPreparationMs).filter((value) => value > 0)),
      staleSpeechPreventedCount: clientTimings.filter((event) => event?.tts?.staleSpeechPrevented).length,
      speechDurationAverageMs: average(clientTimings.map((event) => event?.timings?.speechDurationMs).filter((value) => value > 0)),
    },
    humanReview: Array.isArray(reviews)
      ? { status: reviewScores.length ? "available" : "available_zero_scores", average: reviewScores.length ? Math.round((reviewScores.reduce((sum, score) => sum + score, 0) / reviewScores.length) * 100) / 100 : null, reviewCount: reviews.length }
      : { status: "missing", average: null, reviewCount: null },
  };
}

module.exports = {
  DEFAULT_RESPONSE_POLICY_VERSION,
  OUTCOME_MODEL_VERSION,
  QUALITY_TRACE_VERSION,
  RECOVERY_MODEL_VERSION,
  SEVERITY_DEFINITIONS,
  aggregateAskSnoozerQualityTraces,
  buildAskSnoozerClientTimingEvent,
  buildAskSnoozerQualityTrace,
  buildQualityMetricEnvelope,
  classifyFailureSeverity,
  classifyOutcome,
  emitAskSnoozerQualityTrace,
  getAskSnoozerQualityConfig,
  safeCorrelationId,
  sanitizeReviewText,
};
