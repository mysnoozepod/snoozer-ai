const { loadShowroomManifest } = require("./showroomManifest");
const { normalizeAskSnoozerText } = require("./askSnoozerIntents");

const MODEL_PLANNER_VERSION = "2026-09-16.1";

const SEMANTIC_AUTHORITY = Object.freeze({
  DETERMINISTIC_ATOMIC: "deterministic_atomic",
  MODEL_SEMANTICS: "model_semantics",
  MODEL_FAILED: "model_failed",
  LEGACY_SHADOW: "legacy_semantics_shadow",
});

function isModelOnlySemanticRoutingEnabled() {
  return ["1", "true", "yes", "on"].includes(
    clean(process.env.ASK_SNOOZER_MODEL_ONLY || "").toLowerCase()
  );
}

const ALLOWED_MODALITIES = new Set([
  "asserted",
  "hypothetical",
  "conditional",
  "question",
  "reconsideration",
]);

const STATE_CHANGING_ACTS = new Set([
  "accept_recommendation",
  "budget_value",
  "desired_direction",
  "explicit_exclusion",
  "product_feedback",
  "reconsider_product",
  "reject_product",
  "request_alternative",
  "retain_preference",
]);

const PROTECTED_FACTS = new Set([
  "availability",
  "cart",
  "compatibility",
  "delivery",
  "durability",
  "financing",
  "price",
  "product_sizes",
  "rewards",
  "returns",
  "store_value",
  "warranty",
]);

const ALLOWED_TASKS = new Set([
  "alternative_resolution",
  "advisor_choice",
  "base_education",
  "bundle_quote",
  "canonical_comparison",
  "canonical_recall",
  "canonical_recommendation",
  "commitment_declined",
  "commitment_resolution",
  "comparison_value",
  "compatibility",
  "compound_fact_answer",
  "compound_product_base",
  "configuration_update",
  "configuration_value",
  "confusion_recovery",
  "durability_objection",
  "firmness_choice",
  "firmness_compare",
  "hybrid_exploration",
  "medical_boundary",
  "preference_capture",
  "preference_recall",
  "price_quote",
  "price_value",
  "product_comparison",
  "product_experience",
  "product_sizes",
  "recommendation_acceptance",
  "recommendation_explanation",
  "reconsider_product",
  "rewards_explanation",
  "session_recommendation_recall",
  "shopper_feedback",
  "sleep_education",
  "store_value",
  "trust_recovery",
  "value_judgment",
  "value_objection",
  "warranty_explanation",
]);

const ALLOWED_FACTS = new Set([
  "availability",
  "cart",
  "compatibility",
  "delivery",
  "durability",
  "financing",
  "price",
  "product_features",
  "product_sizes",
  "recommendation_reasons",
  "rewards",
  "returns",
  "store_value",
  "warranty",
]);

const ALLOWED_REQUIREMENTS = new Set([
  "acknowledge_feedback",
  "answer_all_requested_facts",
  "answer_durability",
  "answer_rewards",
  "answer_store_value",
  "compare_named_products",
  "explain_recommendation_reasons",
  "give_grounded_opinion",
  "preserve_active_decision",
  "recap_current_state",
  "state_unknowns",
  "suggest_one_next_step",
]);

const ALLOWED_ACTS = new Set([
  "accept_commitment",
  "accept_recommendation",
  "budget_value",
  "confusion",
  "decline_commitment",
  "desired_direction",
  "explicit_exclusion",
  "product_feedback",
  "reconsider_product",
  "reject_product",
  "request_alternative",
  "retain_preference",
  "trust_risk",
]);

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function inferUtteranceModality(query = "") {
  const text = normalizeAskSnoozerText(query);
  if (/\b(?:what if|suppose|hypothetically|imagine)\b/.test(text)) return "hypothetical";
  if (/\bif\b.*\b(?:would|could|might|may)\b|\b(?:would|could|might|may)\b.*\bif\b/.test(text)) return "conditional";
  if (/\?$/.test(clean(query)) && !/\b(?:i want|i need|i prefer|i like|i liked|i do not want|i don.t want|felt too|was too)\b/.test(text)) {
    return "question";
  }
  return "asserted";
}

function catalogProducts() {
  return (loadShowroomManifest()?.products || [])
    .filter((product) => product?.active !== false)
    .map((product) => ({
      handle: clean(product?.handle).toLowerCase(),
      title: clean(product?.title),
      catalogType: clean(product?.catalogType),
      recommendable: product?.recommendable !== false,
    }))
    .filter((product) => product.handle);
}

function resolveCatalogHandle(value = "") {
  const wanted = normalizeAskSnoozerText(clean(value).replace(/[-_]+/g, " "));
  if (!wanted) return "";
  const comparable = (text) => normalizeAskSnoozerText(text)
    .replace(/(\d+)\s*(?:inch|inches|in)\b/g, "$1")
    .replace(/\bmattress\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const product of catalogProducts()) {
    if (clean(value).toLowerCase() === product.handle) return product.handle;
    const handleWords = normalizeAskSnoozerText(product.handle.replace(/[-_]+/g, " "));
    const titleWords = normalizeAskSnoozerText(product.title);
    if (
      wanted === handleWords ||
      wanted === titleWords ||
      comparable(wanted) === comparable(handleWords) ||
      comparable(wanted) === comparable(titleWords)
    ) return product.handle;
  }
  return "";
}

function inferRequestedFacts(query = "") {
  const text = normalizeAskSnoozerText(query);
  const asksProductSizes = /\b(?:sizes?|dimensions?) (?:are |do you )?(?:available|come in|offer)|\bwhat sizes?\b/.test(text);
  return unique([
    /\bwarrant(?:y|ies)\b|\bcoverage\b/.test(text) ? "warranty" : "",
    /\bdeliver(?:y|ies|ed)?\b|\bshipping\b|\bship\b|\bhow long.*(?:arrive|get here)\b/.test(text) ? "delivery" : "",
    /\bhow long\b.*\b(?:last|hold up|hold|durable)\b|\bdurab(?:le|ility)\b|\bwear out\b|\bsag(?:ging)?\b|\bbody impression\b/.test(text) ? "durability" : "",
    /\breturn(?:s|ed|ing)?\b|\bsleep trial\b|\bexchange\b/.test(text) ? "returns" : "",
    /\bfinanc(?:e|ing)\b|\bpayment plan\b/.test(text) ? "financing" : "",
    /\brewards?|sleep points?|reward balance|points? balance|how many points|earn(?:ed)? points|badge|milestone|unlocked offer\b/.test(text) ? "rewards" : "",
    asksProductSizes ? "product_sizes" : "",
    /\b(?:how much|what (?:does|would|will|is).*(?:cost|price)|price|pricing|quote)\b/.test(text) ? "price" : "",
    !asksProductSizes && /\b(?:available|in stock|availability)\b/.test(text) ? "availability" : "",
    /\b(?:compatible|compatibility|work together|work with)\b/.test(text) ? "compatibility" : "",
    /\bwhy\b.*\b(?:choose|chose|recommend|recommended|pod)\b|\bwhy (?:that|this) one\b/.test(text)
      ? "recommendation_reasons"
      : "",
    /\bwhy\b.*\b(?:buy|purchase|shop|order|get)\b.*\b(?:mysnoozepod|my snooze pod|from you|from your|your store|you)\b|\bwhy should i buy from\b|\bwhy buy from\b/.test(text)
      ? "store_value"
      : "",
  ]).filter((fact) => ALLOWED_FACTS.has(fact));
}

function isSimpleAtomicFactQuery(query = "", context = {}) {
  const text = normalizeAskSnoozerText(query);
  const facts = inferRequestedFacts(query);
  if (facts.length !== 1 || text.split(/\s+/).filter(Boolean).length > 18) return false;
  if (["delivery", "returns", "financing"].includes(facts[0])) return true;
  const deal = context?.askSnoozerWorkingMemory?.activeDeal || {};
  const activeProduct = clean(
    deal?.activeProductHandle ||
    deal?.sessionRecommendation?.productHandle ||
    deal?.acceptedRecommendation?.productHandle ||
    deal?.canonicalRecommendation?.primaryMattressHandle ||
    context?.canonicalRecommendation?.primaryMattressHandle
  );
  if (facts[0] === "warranty" && activeProduct) return true;
  if (facts[0] === "availability" && (activeProduct || resolveCatalogHandle(query))) return true;
  if (facts[0] === "product_sizes" && (activeProduct || resolveCatalogHandle(query))) return true;
  if (facts[0] === "price" && !/\b(?:why|worth|value|compare|difference|save)\b/.test(text)) {
    return Boolean(activeProduct || deal?.activeQuote?.ok || /\b(?:twin|full|queen|king|split|mattress|base|setup)\b/.test(text));
  }
  return false;
}

function resolvePendingCommitmentProtocol({ query = "", context = {} } = {}) {
  const pending = context?.askSnoozerWorkingMemory?.activeDeal?.pendingCommitment;
  if (!pending || clean(pending.status || "pending") !== "pending") return null;
  const text = normalizeAskSnoozerText(query);
  const affirmative = /^(?:yes|yeah|yep|sure|please|do it|do that|show me|go ahead|okay do it|ok do it)[.! ]*$/.test(text);
  const negative = /^(?:no|nope|no thanks|not now|don.t|don.t do that|dont do that)[.! ]*$/.test(text);
  if (!affirmative && !negative) return null;
  const accepted = affirmative;
  return {
    version: MODEL_PLANNER_VERSION,
    authority: "typed_commitment",
    modality: "asserted",
    primaryTask: accepted
      ? pending.type === "find_alternative" ? "alternative_resolution" : "commitment_resolution"
      : "commitment_declined",
    shopperGoal: accepted ? `accept ${clean(pending.type)}` : `decline ${clean(pending.type)}`,
    acts: [{
      type: accepted ? "accept_commitment" : "decline_commitment",
      commitmentId: clean(pending.id),
      commitmentType: clean(pending.type),
      modality: "asserted",
    }],
    productReferences: [],
    comparisonProductHandles: [],
    requestedFacts: [],
    answerRequirements: accepted ? ["preserve_active_decision"] : [],
    requestedPodId: null,
    requiresComposition: accepted,
    confidence: 1,
    validation: {
      source: "typed_commitment",
      acceptedActTypes: [accepted ? "accept_commitment" : "decline_commitment"],
      droppedActs: [],
    },
  };
}

function shouldPlanAskSnoozerWithModel({ query = "", context = {} } = {}) {
  return resolveAskSnoozerSemanticAuthority({ query, context }).mode === SEMANTIC_AUTHORITY.MODEL_SEMANTICS;
}

function resolveAskSnoozerSemanticAuthority({ query = "", context = {} } = {}) {
  const text = normalizeAskSnoozerText(query);
  const atomic = (reason) => ({ mode: SEMANTIC_AUTHORITY.DETERMINISTIC_ATOMIC, reason });
  if (!text) return atomic("empty_message");
  if (/^(?:hi|hello|hey|good (?:morning|afternoon|evening))[!. ]*$/.test(text)) return atomic("greeting");
  if (/\b(?:talk|speak|connect) (?:to|with) (?:a )?(?:human|person|associate)|\bhuman (?:help|support|assistance)\b/.test(text)) {
    return atomic("support_handoff");
  }
  const pending = context?.askSnoozerWorkingMemory?.activeDeal?.pendingCommitment;
  if (pending?.status === "pending" && /^(?:yes|yeah|yep|sure|please|no|nope|no thanks|not now)[.!]?$/.test(text)) {
    return atomic("typed_commitment");
  }
  if (isSimpleAtomicFactQuery(query, context)) return atomic("protected_fact");
  if (/^(?:what(?:'s| is) in|show|review|check|analy[sz]e|inspect)\b.*\bcart\b/.test(text)) return atomic("cart_view");
  if (/^(?:please )?(?:add|put|remove|delete|update|change)\b.*\b(?:cart|basket)\b/.test(text) || /\b(?:add|put|remove|delete|update|change)\b.*\b(?:to|in|from) (?:my|the) (?:cart|basket)\b/.test(text)) {
    return atomic("cart_command");
  }
  if (/^(?:checkout|check out|go to checkout|start checkout|proceed to checkout)[.! ]*$/.test(text)) return atomic("checkout_command");
  if (/\b(?:reward balance|how many points|points balance)\b/.test(text) || /^(?:find|show|check) (?:my )?rewards?[.! ]*$/.test(text)) {
    return atomic("rewards_balance");
  }
  if (/^(?:what is|what's) the cheapest (?:twin|full|queen|king|split king)? ?setup[?!. ]*$/.test(text)) return atomic("exact_price_lookup");
  if (/^what happens if i need help during my session[?!. ]*$/.test(text)) return atomic("session_support");
  if (/^(?:browse products?|show me (?:products?|mattresses?|bases?)|motion base features?)[.! ]*$/.test(text)) {
    return atomic("station_starter");
  }
  if (/^where should i start[?!. ]*$/.test(text)) return atomic("station_starter");
  return { mode: SEMANTIC_AUTHORITY.MODEL_SEMANTICS, reason: "arbitrary_conversation" };
}

function buildModelPlannerInput({ query = "", context = {} } = {}) {
  const memory = context?.askSnoozerWorkingMemory || {};
  const deal = memory?.activeDeal || {};
  const canonical = deal?.canonicalRecommendation || context?.canonicalRecommendation || {};
  const recent = (memory?.conversationFocus?.relevantTurns || context?.recentConversation || [])
    .slice(-6)
    .map((turn) => ({ role: clean(turn?.role), content: clean(turn?.content).slice(0, 360) }))
    .filter((turn) => turn.content);
  return {
    version: MODEL_PLANNER_VERSION,
    shopperMessage: clean(query).slice(0, 1000),
    activeJourney: {
      canonicalRecommendation: {
        podId: clean(canonical?.topPodId || canonical?.podId) || null,
        productHandle: clean(canonical?.primaryMattressHandle || canonical?.productHandle).toLowerCase() || null,
        reasons: Array.isArray(canonical?.reasons) ? canonical.reasons.slice(0, 5) : [],
      },
      activeProductHandle: clean(deal?.activeProductHandle).toLowerCase() || null,
      sessionRecommendationHandle: clean(deal?.sessionRecommendation?.productHandle).toLowerCase() || null,
      comparisonProductHandles: unique(deal?.comparisonProductHandles || []).slice(-3),
      rejectedProductHandles: (deal?.rejectedProducts || [])
        .filter((item) => clean(item?.status || "rejected") === "rejected")
        .map((item) => clean(item?.handle).toLowerCase()),
      size: clean(deal?.activeSize) || null,
      baseDecision: clean(deal?.baseDecision) || null,
      desiredDirection: deal?.desiredDirection || {},
      retainedPreferences: deal?.retainedPreferences || {},
      pendingCommitment: deal?.pendingCommitment || null,
    },
    recentTurns: recent,
    catalog: catalogProducts(),
    deterministicFactHints: inferRequestedFacts(query),
  };
}

function parseJsonObject(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  const text = clean(raw);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}

function normalizeAct(act = {}, defaultModality = "asserted") {
  const type = clean(act?.type).toLowerCase();
  if (!ALLOWED_ACTS.has(type)) return null;
  const handle = resolveCatalogHandle(act?.handle || act?.productHandle || act?.product_handle);
  if (["reject_product", "product_feedback", "explicit_exclusion", "reconsider_product", "accept_recommendation"].includes(type) && !handle) {
    return null;
  }
  const suppliedModality = clean(act?.modality || defaultModality).toLowerCase();
  const modality = ALLOWED_MODALITIES.has(suppliedModality) ? suppliedModality : defaultModality;
  const normalized = { type, modality };
  if (handle) normalized.handle = handle;
  const normalizedToken = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80);
  if (clean(act?.reason)) normalized.reason = normalizedToken(act.reason);
  const feedback = act?.feedback || (type === "product_feedback" ? act?.value || act?.reason || act?.feel : null);
  if (clean(feedback)) normalized.feedback = normalizedToken(feedback);
  let key = act?.key || act?.dimension || act?.attribute;
  let value = act?.value || act?.direction || act?.preference;
  if (type === "desired_direction" && !clean(key)) {
    key = ["feel", "temperature", "response", "motion"].find((candidate) => clean(act?.[candidate])) || key;
    if (key) value = act?.[key];
    if (!key && clean(value)) {
      const directionToken = normalizedToken(value);
      if (["softer", "firmer"].includes(directionToken)) key = "feel";
      else if (["cooler", "warmer"].includes(directionToken)) key = "temperature";
      else if (["more_responsive", "less_responsive"].includes(directionToken)) key = "response";
      else if (["more_motion", "less_motion"].includes(directionToken)) key = "motion";
    }
  }
  if (clean(key)) normalized.key = clean(key).slice(0, 80);
  if (clean(value)) normalized.value = normalizedToken(value).slice(0, 120);
  if (clean(act?.concern)) normalized.concern = clean(act.concern).slice(0, 80);
  if (Number.isFinite(Number(act?.maxAmount))) normalized.maxAmount = Number(act.maxAmount);
  if (clean(act?.commitmentId)) normalized.commitmentId = clean(act.commitmentId).slice(0, 120);
  if (clean(act?.commitmentType)) normalized.commitmentType = clean(act.commitmentType).slice(0, 80);
  return normalized;
}

function validateNormalizedAct(act = {}, { context = {}, protectedFactOnly = false } = {}) {
  if (!act) return { ok: false, reason: "invalid_or_unknown_act" };
  if (protectedFactOnly && STATE_CHANGING_ACTS.has(act.type)) {
    return { ok: false, reason: "protected_fact_scope_conflict" };
  }
  if (
    STATE_CHANGING_ACTS.has(act.type) &&
    !["asserted", "reconsideration"].includes(act.modality) &&
    !(act.type === "request_alternative" && act.modality === "question")
  ) {
    return { ok: false, reason: `non_asserted_${act.modality}` };
  }
  const pending = context?.askSnoozerWorkingMemory?.activeDeal?.pendingCommitment;
  if (["accept_commitment", "decline_commitment"].includes(act.type)) {
    if (!pending || clean(pending.status || "pending") !== "pending") return { ok: false, reason: "no_pending_commitment" };
    if (clean(act.commitmentId) !== clean(pending.id)) return { ok: false, reason: "commitment_id_mismatch" };
  }
  if (act.type === "reconsider_product") {
    const rejected = new Set((context?.askSnoozerWorkingMemory?.activeDeal?.rejectedProducts || [])
      .filter((item) => clean(item?.status || "rejected") === "rejected")
      .map((item) => clean(item?.handle).toLowerCase()));
    if (!rejected.has(clean(act.handle).toLowerCase())) return { ok: false, reason: "product_not_rejected" };
  }
  if (act.type === "product_feedback" && !clean(act.feedback)) return { ok: false, reason: "feedback_missing" };
  if (["desired_direction", "retain_preference"].includes(act.type) && (!clean(act.key) || !clean(act.value))) {
    return { ok: false, reason: "preference_key_or_value_missing" };
  }
  return { ok: true, reason: null };
}

function parseModelPlannerDecision(raw, { query = "", context = {} } = {}) {
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    const error = new Error("Advisor planner returned invalid JSON.");
    error.code = "E_ADVISOR_PLANNER_JSON";
    throw error;
  }
  const hintedFacts = inferRequestedFacts(query);
  const inferredModality = inferUtteranceModality(query);
  const suppliedModality = clean(parsed.modality || parsed.utteranceMode).toLowerCase();
  const explicitShopperAssertion = /\b(?:i want|i need|i prefer|i like|i liked|i do not want|i don.t want|felt too|feels too|was too)\b/.test(
    normalizeAskSnoozerText(query)
  );
  const modality = ["hypothetical", "conditional"].includes(inferredModality)
    ? inferredModality
    : explicitShopperAssertion
      ? "asserted"
      : ALLOWED_MODALITIES.has(suppliedModality) ? suppliedModality : inferredModality;
  const parsedFacts = unique(parsed.requestedFacts || [])
    .map((fact) => clean(fact).toLowerCase())
    .filter((fact) => ALLOWED_FACTS.has(fact) && (
      !PROTECTED_FACTS.has(fact) ||
      hintedFacts.includes(fact) ||
      isModelOnlySemanticRoutingEnabled()
    ));
  const requestedFacts = unique([...hintedFacts, ...parsedFacts]);
  let primaryTask = clean(parsed.primaryTask).toLowerCase();
  if (requestedFacts.length > 1) primaryTask = "compound_fact_answer";
  else if (requestedFacts.includes("durability")) primaryTask = "durability_objection";
  else if (requestedFacts.includes("rewards")) primaryTask = "rewards_explanation";
  else if (requestedFacts.includes("store_value")) primaryTask = "store_value";
  if (!ALLOWED_TASKS.has(primaryTask)) primaryTask = "";
  const productReferences = (Array.isArray(parsed.productReferences) ? parsed.productReferences : [])
    .map((reference) => ({
      handle: resolveCatalogHandle(reference?.handle || reference?.title),
      role: clean(reference?.role || "subject").toLowerCase().slice(0, 40),
    }))
    .filter((reference) => reference.handle);
  const comparisonProductHandles = unique([
    ...(parsed.comparisonProductHandles || []),
    ...productReferences.filter((reference) => reference.role === "comparison").map((reference) => reference.handle),
  ]).map(resolveCatalogHandle).filter(Boolean).slice(0, 3);
  const rawActs = Array.isArray(parsed.acts) ? parsed.acts : [];
  const acts = [];
  const droppedActs = [];
  for (const rawAct of rawActs) {
    const normalized = normalizeAct(rawAct, modality);
    if (normalized && ["hypothetical", "conditional"].includes(modality)) normalized.modality = modality;
    const validation = validateNormalizedAct(normalized, {
      context,
      protectedFactOnly: hintedFacts.length > 0 && modality === "question",
    });
    if (validation.ok) acts.push(normalized);
    else droppedActs.push({
      type: clean(rawAct?.type).toLowerCase() || null,
      handle: clean(rawAct?.handle).toLowerCase() || null,
      modality: clean(rawAct?.modality || modality).toLowerCase() || modality,
      reason: validation.reason,
    });
  }
  // Close a model-semantic bundle before reducing it into journey state. The
  // model has already decided both that the product was rejected and the
  // shopper wants a softer/firmer/cooler direction; this only makes the
  // consequence explicit when the model omitted the redundant reason field.
  const desiredDirectionAct = acts.find((act) => act.type === "desired_direction");
  const impliedRejectionReason = desiredDirectionAct?.key === "feel" && desiredDirectionAct?.value === "softer"
    ? "too_firm"
    : desiredDirectionAct?.key === "feel" && desiredDirectionAct?.value === "firmer"
      ? "too_soft"
      : desiredDirectionAct?.key === "temperature" && desiredDirectionAct?.value === "cooler"
        ? "too_hot"
        : null;
  if (impliedRejectionReason) {
    for (const rejection of acts.filter((act) => act.type === "reject_product" && !clean(act.reason))) {
      rejection.reason = impliedRejectionReason;
      rejection.derivedFrom = "desired_direction";
    }
  }
  const feedbackFromRejection = new Map([
    ["too_firm", "too_firm"],
    ["too_soft", "too_soft"],
    ["too_hot", "too_hot"],
    ["uncomfortable", "uncomfortable"],
    ["did_not_like", "did_not_like"],
  ]);
  for (const rejection of acts.filter((act) => act.type === "reject_product" && feedbackFromRejection.has(act.reason))) {
    if (!acts.some((act) => act.type === "product_feedback" && act.handle === rejection.handle)) {
      acts.push({
        type: "product_feedback",
        modality: rejection.modality,
        handle: rejection.handle,
        feedback: feedbackFromRejection.get(rejection.reason),
        derivedFrom: "reject_product",
      });
    }
  }
  const alternativeRequested = acts.some((act) => act.type === "request_alternative");
  if (alternativeRequested && !acts.some((act) => act.type === "desired_direction")) {
    const directionalRejection = acts.find((act) => act.type === "reject_product" && ["too_firm", "too_soft", "too_hot"].includes(act.reason));
    const direction = directionalRejection?.reason === "too_firm"
      ? { key: "feel", value: "softer" }
      : directionalRejection?.reason === "too_soft"
        ? { key: "feel", value: "firmer" }
        : directionalRejection?.reason === "too_hot"
          ? { key: "temperature", value: "cooler" }
          : null;
    if (direction) acts.push({
      type: "desired_direction",
      modality: directionalRejection.modality,
      ...direction,
      derivedFrom: "reject_product",
    });
  }
  const answerRequirements = unique(parsed.answerRequirements || [])
    .map((requirement) => clean(requirement).toLowerCase())
    .filter((requirement) => ALLOWED_REQUIREMENTS.has(requirement));
  if (requestedFacts.length > 0 && !answerRequirements.includes("answer_all_requested_facts")) {
    answerRequirements.push("answer_all_requested_facts");
  }
  if (requestedFacts.includes("durability") && !answerRequirements.includes("answer_durability")) {
    answerRequirements.push("answer_durability");
  }
  if (requestedFacts.includes("rewards") && !answerRequirements.includes("answer_rewards")) {
    answerRequirements.push("answer_rewards");
  }
  if (requestedFacts.includes("store_value") && !answerRequirements.includes("answer_store_value")) {
    answerRequirements.push("answer_store_value");
  }
  return {
    version: MODEL_PLANNER_VERSION,
    authority: "model_semantics",
    modality,
    primaryTask: primaryTask || null,
    shopperGoal: clean(parsed.shopperGoal).slice(0, 240) || null,
    acts,
    productReferences,
    comparisonProductHandles,
    requestedFacts,
    answerRequirements,
    requestedPodId: clean(parsed.requestedPodId).replace(/^snoozepod\s*/i, "").replace(/^pod[-_\s]*/i, "").slice(0, 20) || null,
    requiresComposition: parsed.requiresComposition !== false,
    confidence: Number.isFinite(Number(parsed.confidence))
      ? Math.max(0, Math.min(1, Number(parsed.confidence)))
      : null,
    validation: {
      source: "model_semantics",
      rawPrimaryTask: clean(parsed.primaryTask).toLowerCase() || null,
      rawActTypes: rawActs.map((act) => clean(act?.type).toLowerCase()).filter(Boolean),
      acceptedActTypes: acts.map((act) => act.type),
      droppedActs,
      rawRequestedFacts: unique(parsed.requestedFacts || []).map((fact) => clean(fact).toLowerCase()),
      acceptedRequestedFacts: requestedFacts,
      inferredModality,
      suppliedModality: suppliedModality || null,
    },
  };
}

module.exports = {
  MODEL_PLANNER_VERSION,
  SEMANTIC_AUTHORITY,
  ALLOWED_TASKS,
  ALLOWED_FACTS,
  buildModelPlannerInput,
  inferRequestedFacts,
  inferUtteranceModality,
  isModelOnlySemanticRoutingEnabled,
  parseModelPlannerDecision,
  resolvePendingCommitmentProtocol,
  resolveAskSnoozerSemanticAuthority,
  resolveCatalogHandle,
  shouldPlanAskSnoozerWithModel,
};
