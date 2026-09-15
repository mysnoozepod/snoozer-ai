const { loadShowroomManifest } = require("./showroomManifest");
const { normalizeAskSnoozerText } = require("./askSnoozerIntents");

const MODEL_PLANNER_VERSION = "2026-09-14.2";

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
  "session_recommendation_recall",
  "shopper_feedback",
  "sleep_education",
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
  "financing",
  "price",
  "product_features",
  "product_sizes",
  "recommendation_reasons",
  "returns",
  "warranty",
]);

const ALLOWED_REQUIREMENTS = new Set([
  "acknowledge_feedback",
  "answer_all_requested_facts",
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
    /\bdeliver(?:y|ies|ed)\b|\bhow long.*(?:arrive|get here)\b/.test(text) ? "delivery" : "",
    /\breturn(?:s|ed|ing)?\b|\bsleep trial\b|\bexchange\b/.test(text) ? "returns" : "",
    /\bfinanc(?:e|ing)\b|\bpayment plan\b/.test(text) ? "financing" : "",
    asksProductSizes ? "product_sizes" : "",
    /\b(?:how much|what (?:does|would|will|is).*(?:cost|price)|price|pricing|quote)\b/.test(text) ? "price" : "",
    !asksProductSizes && /\b(?:available|in stock|availability)\b/.test(text) ? "availability" : "",
    /\b(?:compatible|compatibility|work together|work with)\b/.test(text) ? "compatibility" : "",
    /\bwhy\b.*\b(?:choose|chose|recommend|recommended|pod)\b|\bwhy (?:that|this) one\b/.test(text)
      ? "recommendation_reasons"
      : "",
  ]).filter((fact) => ALLOWED_FACTS.has(fact));
}

function isSimpleAtomicFactQuery(query = "", context = {}) {
  const text = normalizeAskSnoozerText(query);
  const facts = inferRequestedFacts(query);
  if (facts.length !== 1 || text.split(/\s+/).filter(Boolean).length > 12) return false;
  if (["delivery", "returns", "financing"].includes(facts[0])) return true;
  const deal = context?.askSnoozerWorkingMemory?.activeDeal || {};
  const activeProduct = clean(
    deal?.activeProductHandle ||
    deal?.sessionRecommendation?.productHandle ||
    deal?.acceptedRecommendation?.productHandle
  );
  if (facts[0] === "warranty" && activeProduct) return true;
  if (facts[0] === "price" && deal?.activeQuote?.ok && activeProduct) {
    return /\b(?:mattress[- ]only|without (?:the )?base|mattress (?:cost|price)|price of (?:the )?mattress)\b/.test(text);
  }
  return false;
}

function shouldPlanAskSnoozerWithModel({ query = "", context = {} } = {}) {
  const text = normalizeAskSnoozerText(query);
  if (!text) return false;
  if (/^(?:hi|hello|hey|good (?:morning|afternoon|evening))[!. ]*$/.test(text)) return false;
  if (/\b(?:talk|speak|connect) (?:to|with) (?:a )?(?:human|person|associate)|\bhuman (?:help|support|assistance)\b/.test(text)) return false;
  const pending = context?.askSnoozerWorkingMemory?.activeDeal?.pendingCommitment;
  if (pending?.status === "pending" && /^(?:yes|yeah|yep|sure|please|no|nope|no thanks|not now)[.!]?$/.test(text)) {
    return false;
  }
  if (isSimpleAtomicFactQuery(query, context)) return false;
  if (/^(?:what(?:'s| is) in|show|review|check)\b.*\bcart\b/.test(text)) return false;
  if (/\b(?:reward balance|how many points|points balance)\b/.test(text)) return false;
  return true;
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

function normalizeAct(act = {}) {
  const type = clean(act?.type).toLowerCase();
  if (!ALLOWED_ACTS.has(type)) return null;
  const handle = resolveCatalogHandle(act?.handle);
  if (["reject_product", "product_feedback", "explicit_exclusion", "reconsider_product", "accept_recommendation"].includes(type) && !handle) {
    return null;
  }
  const normalized = { type };
  if (handle) normalized.handle = handle;
  const normalizedToken = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80);
  if (clean(act?.reason)) normalized.reason = normalizedToken(act.reason);
  if (clean(act?.feedback)) normalized.feedback = normalizedToken(act.feedback);
  if (clean(act?.key)) normalized.key = clean(act.key).slice(0, 80);
  if (clean(act?.value)) normalized.value = normalizedToken(act.value).slice(0, 120);
  if (clean(act?.concern)) normalized.concern = clean(act.concern).slice(0, 80);
  if (Number.isFinite(Number(act?.maxAmount))) normalized.maxAmount = Number(act.maxAmount);
  if (clean(act?.commitmentId)) normalized.commitmentId = clean(act.commitmentId).slice(0, 120);
  if (clean(act?.commitmentType)) normalized.commitmentType = clean(act.commitmentType).slice(0, 80);
  return normalized;
}

function actSupportedByQuery(act = {}, query = "") {
  const text = normalizeAskSnoozerText(query);
  switch (clean(act?.type)) {
    case "accept_commitment":
      return /^(?:yes|yeah|yep|sure|please|do it|go ahead)[.! ]*$/.test(text);
    case "decline_commitment":
      return /^(?:no|nope|no thanks|not now|don.t)[.! ]*$/.test(text);
    case "confusion":
      return /\b(?:confused|confusing|lost|simplify|don.t understand|do not understand)\b/.test(text);
    case "trust_risk":
      return /\b(?:not listening|keep recommending|already said|stop telling|confusing to me|isn.t right for me|is not right for me)\b/.test(text);
    case "explicit_exclusion":
      return /\b(?:anything but|except|stop (?:showing|telling|recommending)|do not (?:show|recommend)|don.t (?:show|recommend)|not interested in)\b/.test(text);
    case "reconsider_product":
      return /\b(?:reconsider|show me .* again|go back to|look at .* again|actually .* (?:first|original|foam|hybrid))\b/.test(text);
    case "request_alternative":
      return /\b(?:something else|anything else|what else|other (?:one|mattress|option)|another (?:one|mattress|option)|alternative|different mattress|find me|recommend .* else|want (?:softer|firmer|cooler))\b/.test(text);
    case "desired_direction":
      return /\b(?:want|need|prefer|looking for|go)\b.*\b(?:softer|firmer|cooler|warmer|less motion|more responsive|less bounce|more support)\b|^(?:softer|firmer|cooler)[.! ]*$/.test(text);
    case "reject_product":
      return /\b(?:too firm|too soft|too hot|uncomfortable|didn.t like|did not like|don.t like|do not like|not for me|rule.*out|take .* off)\b/.test(text);
    case "product_feedback":
      return /\b(?:too firm|too soft|too hot|cool|sinking|floating|supportive|not supportive|comfortable|uncomfortable|liked|didn.t like|did not like|felt)\b/.test(text);
    case "retain_preference":
      return /\b(?:like|liked|love|prefer|keep|still want)\b/.test(text);
    case "accept_recommendation":
      return /\b(?:i.ll take|i will take|go with|choose|accept|that works|sounds good)\b/.test(text);
    case "budget_value":
      return /\b(?:too expensive|over (?:my )?budget|more than i want to spend|costs? too much|save money)\b/.test(text);
    default:
      return false;
  }
}

function parsedFactSupportedByQuery(fact = "", query = "") {
  const text = normalizeAskSnoozerText(query);
  if (fact === "product_features") {
    return /\b(?:feature|feel|construction|material|made of|tell me about|what does .* do|what will i notice)\b/.test(text);
  }
  if (fact === "cart") return /\bcart\b/.test(text);
  return false;
}

function parseModelPlannerDecision(raw, { query = "" } = {}) {
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    const error = new Error("Advisor planner returned invalid JSON.");
    error.code = "E_ADVISOR_PLANNER_JSON";
    throw error;
  }
  const hintedFacts = inferRequestedFacts(query);
  const parsedFacts = unique(parsed.requestedFacts || [])
    .map((fact) => clean(fact).toLowerCase())
    .filter((fact) => ALLOWED_FACTS.has(fact) && parsedFactSupportedByQuery(fact, query));
  const requestedFacts = unique([...hintedFacts, ...parsedFacts]);
  let primaryTask = clean(parsed.primaryTask).toLowerCase();
  if (requestedFacts.length > 1) primaryTask = "compound_fact_answer";
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
  const acts = (Array.isArray(parsed.acts) ? parsed.acts : [])
    .map(normalizeAct)
    .filter((act) => act && actSupportedByQuery(act, query));
  const answerRequirements = unique(parsed.answerRequirements || [])
    .map((requirement) => clean(requirement).toLowerCase())
    .filter((requirement) => ALLOWED_REQUIREMENTS.has(requirement));
  if (requestedFacts.length > 1 && !answerRequirements.includes("answer_all_requested_facts")) {
    answerRequirements.push("answer_all_requested_facts");
  }
  return {
    version: MODEL_PLANNER_VERSION,
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
  };
}

module.exports = {
  MODEL_PLANNER_VERSION,
  ALLOWED_TASKS,
  ALLOWED_FACTS,
  buildModelPlannerInput,
  inferRequestedFacts,
  parseModelPlannerDecision,
  resolveCatalogHandle,
  shouldPlanAskSnoozerWithModel,
};
