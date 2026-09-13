const { loadShowroomManifest } = require("./showroomManifest");
const {
  normalizeAskSnoozerText,
  parseAskSnoozerSizeLabel,
} = require("./askSnoozerIntents");
const {
  resolveExplicitBaseSelection,
  resolveExplicitProductHandle,
} = require("./askSnoozerWorkingMemory");
const {
  COMMERCE_CONFIGURATION_VERSION,
  resolveApprovedVariant,
  setupSizeForSelection,
} = require("./commerceConfigurationResolver");
const { completeSentences, isCompleteShopperResponse } = require("./askSnoozerResponsePresenter");

const ORCHESTRATOR_VERSION = "2026-09-12.4";
const PRODUCT_VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[^\s/?#]+$/;
const INTERNAL_LANGUAGE = Object.freeze([
  "shopify",
  "canonical",
  "showroom canon",
  "api",
  "backend",
  "s3",
  "retrieval",
  "source of truth",
  "model",
  "database",
  "deterministic",
  "intent",
  "route",
  "fallback",
  "resolver",
  "current verified option",
  "verified adjustable option",
  "exact match",
  "knowledge source",
  "canonicalrecommendation",
  "sessionrecommendation",
  "fact pack",
  "storefront api",
  "active_journey",
  "working memory",
  "intentgroup",
  "groundingsufficient",
  "model composer",
  "cloudwatch",
  "lambda",
  "variant gid",
]);

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function includesProtectedLanguage(text, phrase) {
  const escaped = clean(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(clean(text));
}

function unique(values = []) {
  return [...new Set(values.map((value) => clean(value).toLowerCase()).filter(Boolean))];
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function titleFor(handle = "", manifest = loadShowroomManifest()) {
  const product = (manifest?.products || []).find((item) => clean(item?.handle) === clean(handle));
  return clean(product?.title || handle)
    .replace(/(\d+)\s*["”]/g, "$1-inch")
    .replace(/\s+mattress$/i, " Mattress");
}

function formatMoney(amount, currencyCode = "USD") {
  if (!Number.isFinite(Number(amount))) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: clean(currencyCode) || "USD",
  }).format(Number(amount));
}

function normalizeSize(value = "") {
  return normalizeAskSnoozerText(value).replace(/[^a-z0-9]/g, "");
}

function variantOption(variant = {}, name = "") {
  return clean(
    (variant.selectedOptions || []).find(
      (option) => normalizeAskSnoozerText(option?.name) === normalizeAskSnoozerText(name)
    )?.value
  );
}

function variantAvailable(variant = {}) {
  return variant.available === true || variant.availableForSale === true;
}

function variantPrice(variant = {}) {
  const amount = Number(variant?.price?.amount ?? variant?.price);
  return Number.isFinite(amount) ? amount : null;
}

function variantCurrency(variant = {}, product = {}) {
  return clean(
    variant?.price?.currencyCode ||
      variant?.currencyCode ||
      product?.priceRange?.currencyCode ||
      product?.priceRange?.minVariantPrice?.currencyCode ||
      "USD"
  );
}

function variantMatchesSize(variant = {}, size = "") {
  const wanted = normalizeSize(size);
  if (!wanted) return false;
  const option = normalizeSize(variantOption(variant, "size"));
  const title = normalizeSize(variant?.title);
  if (option) return option === wanted || option.startsWith(wanted) || wanted.startsWith(option);
  return title === wanted || title.startsWith(wanted);
}

function variantMatchesMotion(variant = {}, motionKey = "") {
  const wanted = clean(motionKey).toLowerCase();
  if (!wanted || wanted === "none") return true;
  const aliases = {
    standard: ["standard", "standard motion"],
    half_split: ["half split", "half split motion"],
    full_split: ["full split", "full split motion"],
  }[wanted] || [wanted.replace(/_/g, " ")];
  const values = [variant?.title, variantOption(variant, "motion"), variantOption(variant, "configuration")]
    .map((value) => normalizeAskSnoozerText(value))
    .filter(Boolean);
  const hasMotionDimension = values.some((value) => /motion|split|standard/.test(value));
  if (!hasMotionDimension) return true;
  return values.some((value) => aliases.some((alias) => value.includes(alias)));
}

function resolveExactVariant(product = {}, { size = "", motionKey = "", category = "mattress", setupSize = "" } = {}) {
  const resolution = resolveApprovedVariant({
    product,
    category,
    setupSize: setupSize || setupSizeForSelection(size),
    motionType: motionKey || "standard",
    requestedOption: category === "mattress" ? size : "",
  });
  return resolution.ok ? resolution.variant : null;
}

function buildQuoteProduct(product = {}, { size = "", motionKey = "", category = "mattress", setupSize = "" } = {}) {
  const variant = resolveExactVariant(product, { size, motionKey, category, setupSize });
  if (!variant) return null;
  const price = variantPrice(variant);
  if (!Number.isFinite(price)) return null;
  const currencyCode = variantCurrency(variant, product);
  const selectedOptions = Array.isArray(variant.selectedOptions) ? variant.selectedOptions : [];
  const imageUrl = clean(
    variant?.image?.url || product?.imageUrl || product?.image?.url || product?.images?.[0]?.url
  ) || null;
  return {
    handle: clean(product.handle),
    title: titleFor(product.handle),
    productId: clean(product.id),
    variantId: clean(variant.id),
    variantTitle: clean(variant.title),
    selectedOptions,
    size,
    motionKey: motionKey || null,
    price,
    currencyCode,
    available: true,
    imageUrl,
  };
}

function quoteProductCard(entry = {}, rawProduct = {}, { suppressAddToCart = false } = {}) {
  return {
    ...rawProduct,
    type: "product",
    id: clean(rawProduct.id || entry.productId || entry.handle),
    handle: entry.handle,
    title: entry.title,
    label: entry.title,
    url: `/products/${entry.handle}`,
    href: `/products/${entry.handle}`,
    imageUrl: entry.imageUrl,
    price: entry.price,
    currencyCode: entry.currencyCode,
    priceRange: { min: entry.price, max: entry.price, currencyCode: entry.currencyCode },
    available: true,
    availableForSale: true,
    variants: [
      {
        id: entry.variantId,
        title: entry.variantTitle,
        available: true,
        availableForSale: true,
        price: entry.price,
        currencyCode: entry.currencyCode,
        selectedOptions: entry.selectedOptions,
      },
    ],
    selectedOptions: entry.selectedOptions,
    variantId: entry.variantId,
    merchandiseId: entry.variantId,
    firstAvailableVariantId: entry.variantId,
    exactVariantResolved: true,
    suppressAddToCart: Boolean(suppressAddToCart),
  };
}

function activeMemory(context = {}) {
  return isObject(context?.askSnoozerWorkingMemory) ? context.askSnoozerWorkingMemory : {};
}

function activeDeal(context = {}) {
  return isObject(activeMemory(context)?.activeDeal) ? activeMemory(context).activeDeal : {};
}

function interpretedActs(context = {}) {
  const acts = activeMemory(context)?.lastTransition?.interpretedActs;
  return Array.isArray(acts) ? acts : [];
}

function rejectedHandles(context = {}) {
  return new Set(
    (Array.isArray(activeDeal(context)?.rejectedProducts) ? activeDeal(context).rejectedProducts : [])
      .filter((item) => clean(item?.status || "rejected") === "rejected")
      .map((item) => clean(item?.handle).toLowerCase())
      .filter(Boolean)
  );
}

function activeSessionRecommendationHandle(context = {}) {
  const handle = clean(activeDeal(context)?.sessionRecommendation?.productHandle).toLowerCase();
  return handle && !rejectedHandles(context).has(handle) ? handle : "";
}

function resolveCanonicalHandle(context = {}) {
  return clean(
    activeDeal(context)?.canonicalRecommendation?.primaryMattressHandle ||
      context?.canonicalRecommendation?.primaryMattressHandle
  ).toLowerCase();
}

function canonicalPodName(context = {}) {
  const canonical = activeDeal(context)?.canonicalRecommendation || context?.canonicalRecommendation || {};
  const podId = clean(
    canonical.topPodId ||
      canonical.podId ||
      canonical.recommendation?.topPodId
  ).replace(/^snoozepod\s*/i, "");
  return podId ? `SnoozePod ${podId}` : "your recommended SnoozePod";
}

function resolveActiveHandle(context = {}) {
  const rejected = rejectedHandles(context);
  const candidates = [
    activeDeal(context)?.activeProductHandle,
    activeSessionRecommendationHandle(context),
    activeDeal(context)?.recentProductHandle,
    resolveCanonicalHandle(context),
  ];
  return candidates.map((value) => clean(value).toLowerCase()).find((handle) => handle && !rejected.has(handle)) || "";
}

function resolveComparisonHandles(query = "", context = {}) {
  const explicit = resolveExplicitProductHandle(query);
  const deal = activeDeal(context);
  const existing = Array.isArray(deal.comparisonProductHandles) ? deal.comparisonProductHandles : [];
  const active = resolveActiveHandle(context);
  const canonical = resolveCanonicalHandle(context);
  const rejected = rejectedHandles(context);
  const text = normalizeAskSnoozerText(query);
  const historicalComparison = /\b(?:original recommendation|originally recommend|first recommendation)\b/.test(text);
  const resolved = unique(existing.concat(active, explicit, historicalComparison ? canonical : null))
    .filter((handle) => historicalComparison && handle === canonical ? true : !rejected.has(handle));
  if (/\b(?:compare|compares|comparison|versus|\bvs\b|difference|softer|firmer)\b/.test(text) && resolved.length === 1) {
    const fallback = resolved[0] === "14-hybrid" ? "12-dual-comfort-hybrid" : "14-hybrid";
    if (!rejected.has(fallback)) resolved.push(fallback);
  }
  return resolved.slice(0, 2);
}

function resolveProtectedReference(query = "", context = {}) {
  const text = normalizeAskSnoozerText(query);
  const deal = activeDeal(context);
  const comparison = Array.isArray(deal.comparisonProductHandles)
    ? deal.comparisonProductHandles.filter(Boolean)
    : [];
  const canonical = resolveCanonicalHandle(context);
  const active = resolveActiveHandle(context);
  const explicitActive = clean(deal.activeProductHandle).toLowerCase();
  const quoteHandles = Array.isArray(deal.activeQuote?.items)
    ? deal.activeQuote.items.map((item) => clean(item?.handle).toLowerCase()).filter(Boolean)
    : [];
  let phrase = null;
  let handle = null;
  let source = null;
  if (/\b(?:original recommendation|originally recommend|first recommendation)\b/.test(text)) {
    phrase = "original recommendation";
    handle = canonical;
    source = "canonical_recommendation";
  } else if (/\b(?:your recommendation|current recommendation|mattress you (?:showed|recommended))\b/.test(text)) {
    phrase = "your recommendation";
    handle = activeSessionRecommendationHandle(context) || canonical || active;
    source = activeSessionRecommendationHandle(context) ? "session_recommendation" : "canonical_recommendation";
  } else if (/\b(?:the base we discussed|that base)\b/.test(text)) {
    phrase = "the base we discussed";
    handle = clean(deal.activeBaseHandle || deal.recentBaseHandle || quoteHandles.find((item) => /base/.test(item))).toLowerCase();
    source = "active_base";
  } else if (/\b(?:what you quoted me|that quote|the quote)\b/.test(text)) {
    phrase = "what you quoted me";
    handle = quoteHandles[0] || active;
    source = "active_quote";
  } else if (/\b(?:first one|first option)\b/.test(text)) {
    phrase = "first one";
    handle = comparison[0] || canonical || active;
    source = "comparison_first";
  } else if (/\bcheaper one\b/.test(text)) {
    phrase = "cheaper one";
    handle = quoteHandles[0] || comparison[0] || canonical || active;
    source = "active_quote_or_comparison";
  } else if (/\b(?:the )?other one\b/.test(text)) {
    phrase = "the other one";
    handle = comparison.find((candidate) => candidate !== explicitActive) || deal.recentProductHandle || null;
    source = comparison.length >= 2 || deal.recentProductHandle ? "comparison_other" : "ambiguous_comparison";
  } else if (/\b(?:that one|this one)\b/.test(text)) {
    phrase = "that one";
    if (!explicitActive && comparison.length >= 2) {
      handle = null;
      source = "ambiguous_comparison";
    } else {
      handle = explicitActive || active || comparison[0] || canonical;
      source = "active_product";
    }
  }
  return {
    phrase,
    handle: handle || null,
    source,
    resolved: Boolean(handle),
  };
}

function isTechnicalQuestion(text = "") {
  return /\b(?:technical|architecture|developer|debug|implementation|how are you built)\b/.test(text);
}

function isExplicitMedical(text = "") {
  return /\b(?:diagnose|diagnosis|cure|treat|therapy|medical advice|stop .*cpap|replace .*cpap|sleep apnea|sciatica)\b/.test(text);
}

function responseDepth(text = "", taskType = "") {
  if (/\b(?:quick|brief|short answer|one sentence)\b/.test(text)) return "quick";
  if (/\b(?:deep|detail|walk me through|thorough)\b/.test(text)) return "deep";
  if (["product_comparison", "comparison_value", "canonical_comparison"].includes(taskType) || /\b(?:compare|versus|\bvs\b|difference)\b/.test(text)) return "compare";
  if (/\b(?:why would|what does|how does|explain|notice)\b/.test(text)) return "teach";
  if (/\b(?:would you|which one|what should i|for me)\b/.test(text)) return "coach";
  return "standard";
}

function inferStage(taskType = "", previous = "exploring") {
  if (["cart_add", "cart_review"].includes(taskType)) return "ready";
  if (["price_quote", "bundle_quote", "compatibility"].includes(taskType)) return "configuring";
  if (["value_judgment", "value_objection", "price_value", "comparison_value", "configuration_value", "savings_quote", "advisor_opinion", "compound_product_base", "durability_objection"].includes(taskType)) return "evaluating_value";
  if (["product_comparison", "canonical_comparison", "firmness_compare", "firmness_choice", "advisor_choice"].includes(taskType)) return "comparing";
  if (["canonical_recommendation", "canonical_recall", "session_recommendation_recall", "recommendation_explanation", "recommendation_acceptance", "product_experience", "hybrid_exploration", "configuration_update", "confusion_recovery", "shopper_feedback", "alternative_resolution", "trust_recovery", "reconsider_product", "commitment_declined", "commitment_resolution"].includes(taskType)) return "narrowing";
  return clean(previous) || "exploring";
}

function planAskSnoozerTurn({ query = "", context = {}, referenceContext = context } = {}) {
  const text = normalizeAskSnoozerText(query);
  const deal = activeDeal(context);
  const canonicalHandle = resolveCanonicalHandle(context);
  const referenceResolution = resolveProtectedReference(query, referenceContext);
  const activeHandle = referenceResolution.handle || resolveActiveHandle(context);
  const workingGoal = activeMemory(context)?.activeGoal;
  const continuingPriceGoal =
    workingGoal?.intent === "price_quote" &&
    ["collecting_slots", "ready", "resolving", "presented", "awaiting_decision", "completed"].includes(
      clean(workingGoal?.status)
    );
  const explicitHandle = resolveExplicitProductHandle(query);
  const explicitBase = resolveExplicitBaseSelection(query);
  const parsedSize = parseAskSnoozerSizeLabel(query);
  const acts = interpretedActs(context);
  const actTypes = new Set(acts.map((act) => clean(act?.type)));
  const feedbackHandle = clean(
    acts.find((act) => clean(act?.handle))?.handle ||
      activeMemory(context)?.lastTransition?.stateBefore?.activeProductHandle
  ).toLowerCase();
  const acceptedCommitment = acts.find((act) => act.type === "accept_commitment") || null;
  const declinedCommitment = acts.find((act) => act.type === "decline_commitment") || null;
  const correctionCue = /\b(?:no i meant|not that|other one|you misunderstood|that.s not what i meant|actually|changed my mind|instead|switch|make that|remove|without|mattress[- ]only|failed|try again|go back|return to)\b/.test(text);
  const size =
    parsedSize === "Full" && /\b(?:full|complete|whole) setup\b/.test(text)
      ? clean(deal.activeSize)
      : parsedSize || clean(deal.activeSize);
  const canonicalReference = /\b(?:originally recommend|original recommendation|first recommendation|what did (?:the assessment|you originally) recommend)\b/.test(text);
  const comparisonCue = /\b(?:compare|compares|compared|comparison|versus|\bvs\b|difference between|different from|which one is (?:softer|firmer|better))\b/.test(text);
  const valueCue = /\b(?:worth|value|why (?:does|is|did).*(?:cost|price)|cost that much|extra money|more expensive)\b/.test(text);
  const compoundPriceValueCue = Boolean(
    /\bwhy\b.*\b(?:cost|price|expensive)\b.*\b(?:worth|value)\b/.test(text) ||
    /\b(?:cost|price)\b.*\band\b.*\b(?:worth|value)\b/.test(text)
  );
  const priorActiveHandle = clean(activeMemory(context)?.lastTransition?.stateBefore?.activeProductHandle);
  const hasPriorTurn = Number(activeMemory(context)?.turnIndex || 0) > 1;
  const continuation = Boolean(
    (priorActiveHandle || hasPriorTurn) &&
      activeHandle &&
      (/\b(?:it|that|this|one|setup|with|and what|which one|your recommendation)\b/.test(text) || deal.currentTopic)
  );
  let taskType = "legacy";
  let staleRouteOverride = false;

  if (/^(?:hi|hello|hey|good (?:morning|afternoon|evening))[!. ]*$/.test(text)) taskType = "greeting";
  else if (/\b(?:talk|speak|connect) (?:to|with) (?:a )?(?:human|person|associate)|\bhuman (?:help|support|assistance)\b/.test(text)) taskType = "support_handoff";
  else if (actTypes.has("reconsider_product")) taskType = "reconsider_product";
  else if (actTypes.has("accept_recommendation")) taskType = "recommendation_acceptance";
  else if (actTypes.has("trust_risk")) taskType = "trust_recovery";
  else if (acceptedCommitment?.commitmentType === "find_alternative" || actTypes.has("request_alternative")) taskType = "alternative_resolution";
  else if (acceptedCommitment) taskType = "commitment_resolution";
  else if (declinedCommitment) taskType = "commitment_declined";
  else if (
    actTypes.has("reject_product") ||
    actTypes.has("product_feedback") ||
    (actTypes.has("retain_preference") && actTypes.has("explicit_exclusion"))
  ) taskType = "shopper_feedback";
  else if (actTypes.has("confusion") || /\bconfused\b|\b(?:i am|i'm|im) lost\b|\bgetting lost\b|\b(?:wait,? )?what am i choosing|\bsimplify (?:this|it)\b/.test(text)) taskType = "confusion_recovery";
  else if (/\b(?:you(?:'re| are) not listening|you keep recommending|i already said|stop telling me|this is confusing)\b/.test(text)) taskType = "trust_recovery";
  else if (/^(?:but )?why[?!. ]*$/.test(text) && (activeHandle || deal.sessionRecommendation?.productHandle)) taskType = "recommendation_explanation";
  else if (/\b(?:why that one|why this one|why do you recommend (?:it|that)|why is (?:it|that|this|the .*) better for me|why is that your recommendation|why is this pod recommended)\b/.test(text)) taskType = "recommendation_explanation";
  else if (/\b(?:what do you recommend now|what is your current recommendation|what's your current recommendation|which mattress now)\b/.test(text)) taskType = "session_recommendation_recall";
  else if (/\b(?:remind me (?:what|which) (?:you )?|what did you )recommend(?:ed)?(?: for me)?\b/.test(text)) {
    taskType = deal.sessionRecommendation?.productHandle
      ? "session_recommendation_recall"
      : "canonical_recall";
  }
  else if (actTypes.has("budget_value") || /\b(?:more than i want to spend|over my budget|too expensive|costs too much)\b/.test(text)) taskType = "value_objection";
  else if (explicitHandle && /\b(?:not sure|uncertain)\b.*\b(?:motion|base)\b/.test(text)) taskType = "compound_product_base";
  else if (/\b(?:sag|sagging|body impression|wear out|durability|hold up)\b/.test(text)) taskType = "durability_objection";
  else if (/\b(?:tell me about|show me|what about)\b.*\b(?:your )?hybrids\b|\byour hybrids\b/.test(text)) taskType = "hybrid_exploration";
  else if (parsedSize && /\b(?:i need|i want|make it|go with|size)\b/.test(text) && !/\b(?:price|cost|how much|quote)\b/.test(text)) taskType = "configuration_update";
  else if (/^(?:please )?(?:add|put)\b/.test(text) || /\b(?:add|adding|put|putting)\b.*\b(?:to|in) (?:my|the) cart\b/.test(text)) taskType = "cart_add";
  else if (/\b(?:what(?:'s| is) in|show|review|check)\b.*\bcart\b/.test(text)) taskType = "cart_review";
  else if (canonicalReference && comparisonCue) taskType = "canonical_comparison";
  else if (canonicalReference && /\b(?:cost|price|how much)\b/.test(text)) taskType = "price_quote";
  else if (canonicalReference) taskType = "canonical_recall";
  else if (/\b(?:based on|from) my (?:sleep )?profile\b|\bwhat (?:mattress|would) .*try first\b|\bwhat mattress do you recommend\b|\bwhich pod should i try first\b|\bwhere should i start\b|\bi do not know what to choose\b/.test(text)) taskType = "canonical_recommendation";
  else if (/^(?:okay|ok|yes|please)?[ ,]*(?:go with |choose |make it )?mattress[- ]only[.! ]*$/.test(text)) taskType = "configuration_value";
  else if (
    continuingPriceGoal &&
    text.split(/\s+/).filter(Boolean).length <= 4 &&
    (explicitHandle || Object.keys(explicitBase).length)
  ) taskType = explicitBase.explicitNoBase ? "price_quote" : "bundle_quote";
  else if (/\b(?:how much.*save|save.*how much|savings|difference in price)\b/.test(text)) taskType = "savings_quote";
  else if (valueCue && comparisonCue) taskType = "comparison_value";
  else if (compoundPriceValueCue) taskType = "price_value";
  else if (/\b(?:how much|what would .*cost|price|pricing|quote)\b/.test(text) && /\b(?:with|plus|and)\b.*\b(?:motion|base)\b/.test(text)) taskType = "bundle_quote";
  else if (/\bwhat about with (?:the )?(?:motion|adjustable) base\b/.test(text) && (deal.activeProductHandle || deal.acceptedRecommendation?.productHandle)) taskType = "bundle_quote";
  else if (/\b(?:how much|what would .*cost|price|pricing|quote)\b/.test(text) && /\b(?:full setup|whole setup|complete setup)\b/.test(text)) taskType = "bundle_quote";
  else if (/\b(?:how much|what would .*cost|price|pricing|quote)\b/.test(text) && (deal.activeBaseHandle || deal.activeQuote?.items?.length > 1) && !/\b(?:mattress[- ]only|without (?:the )?base|skip (?:the )?base)\b/.test(text)) taskType = "bundle_quote";
  else if (/\b(?:how much|what would .*cost|price|pricing|quote)\b/.test(text)) taskType = "price_quote";
  else if (/\bwarrant(?:y|ies)\b/.test(text)) taskType = "warranty_explanation";
  else if (/\b(?:make sense together|work together|work with|compatible|compatibility|pair together)\b/.test(text)) taskType = "compatibility";
  else if (/\b(?:what if i skip|skip|without) (?:the )?(?:(?:motion|adjustable) )?base\b/.test(text)) taskType = "configuration_value";
  else if (/\b(?:need the adjustable|need (?:that|the) base|save the money|didn.t notice.*base|more expensive.*better)\b/.test(text)) taskType = "value_judgment";
  else if (/^motion base features?$/.test(text) || /\b(?:what does|what is|explain|why would i want|why)\b.*\b(?:standard motion|adjustable base|motion base)\b|\bwhy would i want it\b/.test(text)) taskType = "base_education";
  else if (/\b(?:liked|prefer|want)\b.*\b(?:elevation|elevated|raised|head up|feet up|medium|soft|firm)\b/.test(text)) taskType = "preference_capture";
  else if (/\b(?:what did i say i liked|what do i prefer|remember what i liked|recall my preference)\b/.test(text)) taskType = "preference_recall";
  else if (/\b(?:which one is (?:softer|firmer).*(?:which|what).*(?:pick|choose)|(?:softer|firmer).*(?:pick|choose).*(?:for me))\b/.test(text)) taskType = "firmness_choice";
  else if (/\b(?:medium|soft|firm)\b.*\b(?:vs|versus|or|compare)\b/.test(text)) taskType = "firmness_compare";
  else if (/\bbest value(?: option)?\b/.test(text)) taskType = "value_judgment";
  else if (/\b(?:which (?:one|mattress) (?:would you|you would) (?:choose|pick)|what would you (?:choose|pick)|would you buy|what would you do|so what would you do)\b/.test(text)) taskType = "advisor_choice";
  else if (/\b(?:firmer mattress|sleep hot|side sleeper|sleep on my side|wake up tired|partner moves|motion separation|what should i look for|cooler mattress)\b/.test(text)) taskType = "sleep_education";
  else if (comparisonCue && valueCue) taskType = "comparison_value";
  else if (comparisonCue) taskType = "product_comparison";
  else if (/\b(?:tell me more|tell me about|actually going to notice|what (?:will i|i will|should i) notice|what does .* feel like|feel when|lie on)\b/.test(text)) taskType = "product_experience";
  else if (isExplicitMedical(text)) taskType = "medical_boundary";

  if (referenceResolution.phrase && !referenceResolution.resolved) {
    taskType = "reference_clarification";
  } else if (taskType === "legacy" && correctionCue && referenceResolution.resolved) {
    taskType = "product_experience";
  } else if (taskType === "legacy" && correctionCue && explicitHandle) {
    taskType = "product_experience";
  } else if (taskType === "legacy" && correctionCue && parsedSize && deal.activeQuote) {
    taskType = (deal.activeQuote.items || []).length > 1 ? "bundle_quote" : "price_quote";
  } else if (taskType === "legacy" && correctionCue && explicitBase.explicitNoBase && deal.activeQuote) {
    taskType = "price_quote";
  } else if (taskType === "legacy" && correctionCue && Object.keys(explicitBase).length && deal.activeQuote) {
    taskType = "bundle_quote";
  } else if (taskType === "legacy" && /\b(?:you misunderstood|that.s not what i meant|no that.s wrong)\b/.test(text)) {
    taskType = "correction_clarification";
  }

  const activeQuoteMatchesGoal = Boolean(
    deal.activeQuote?.cartReady &&
      (!workingGoal?.productHandle || deal.activeQuote.productHandle === workingGoal.productHandle) &&
      (!workingGoal?.size || deal.activeQuote.size === workingGoal.size) &&
      (workingGoal?.baseHandle === undefined || deal.activeQuote.baseHandle === workingGoal.baseHandle) &&
      (!workingGoal?.motionKey || deal.activeQuote.motionKey === workingGoal.motionKey)
  );
  const readyCommercialGoal = Boolean(
    workingGoal?.intent === "price_quote" &&
      clean(workingGoal?.status) === "ready" &&
      Array.isArray(workingGoal?.missingSlots) &&
      workingGoal.missingSlots.length === 0 &&
      !activeQuoteMatchesGoal
  );
  const clearlyChangedSubject = Boolean(
    [
      "canonical_recall",
      "canonical_recommendation",
      "session_recommendation_recall",
      "recommendation_explanation",
      "recommendation_acceptance",
      "product_experience",
      "product_comparison",
      "canonical_comparison",
      "comparison_value",
      "firmness_choice",
      "advisor_choice",
      "base_education",
      "value_judgment",
      "value_objection",
      "price_value",
      "configuration_value",
      "preference_capture",
      "preference_recall",
      "firmness_compare",
      "medical_boundary",
      "cart_review",
      "reference_clarification",
      "correction_clarification",
      "compound_product_base",
      "durability_objection",
      "hybrid_exploration",
      "configuration_update",
      "confusion_recovery",
      "warranty_explanation",
      "shopper_feedback",
      "alternative_resolution",
      "trust_recovery",
      "reconsider_product",
      "commitment_declined",
      "commitment_resolution",
    ].includes(taskType) ||
      /\b(?:return policy|returns?|warranty|delivery|financing|rewards?|snooze sessions?)\b/.test(text)
  );
  const alreadyCompletingCommercialGoal = [
    "price_quote",
    "bundle_quote",
    "savings_quote",
    "compatibility",
    "cart_add",
  ].includes(taskType);
  if (readyCommercialGoal && !clearlyChangedSubject && !alreadyCompletingCommercialGoal) {
    const goalIncludesBase = Boolean(
      workingGoal?.baseHandle ||
        ["mattress_plus_base", "full_pod", "base_only"].includes(clean(workingGoal?.scope))
    );
    taskType = goalIncludesBase ? "bundle_quote" : "price_quote";
    staleRouteOverride = true;
  }

  const unresolvedExplicitProductSubject =
    taskType === "product_experience" &&
    clearlyChangedSubject &&
    !/\b(?:that|this|the)\s+(?:mattress|one|hybrid|foam|product)\b|\b(?:tell me more|what am i going to notice|what (?:will|should) i notice|notice when i lie|notice on it)\b/i.test(query) &&
    !referenceResolution.handle &&
    !explicitHandle;
  const quoteReferenceHandle = canonicalReference
    ? canonicalHandle
    : unresolvedExplicitProductSubject
      ? null
      : ["shopper_feedback", "trust_recovery"].includes(taskType)
        ? feedbackHandle || explicitHandle || null
        : referenceResolution.handle || explicitHandle || activeDeal(context)?.acceptedRecommendation?.productHandle || activeSessionRecommendationHandle(context) || activeHandle || workingGoal?.productHandle || canonicalHandle;
  let comparisonHandles = resolveComparisonHandles(query, referenceContext);
  if (taskType === "hybrid_exploration") {
    comparisonHandles = unique([activeHandle, "12-dual-comfort-hybrid", "14-hybrid"]).slice(0, 3);
  } else if (taskType === "advisor_choice" && comparisonHandles.length < 2) {
    comparisonHandles = unique([
      ...comparisonHandles,
      activeHandle === "14-hybrid" ? "12-all-foam-mattress" : "14-hybrid",
    ]).slice(0, 2);
  } else if (taskType === "canonical_comparison") {
    comparisonHandles = unique([canonicalHandle, activeSessionRecommendationHandle(context) || activeHandle]).slice(0, 2);
  } else if (["alternative_resolution", "trust_recovery", "shopper_feedback"].includes(taskType)) {
    comparisonHandles = unique(activeDeal(context)?.eligibleAlternativeHandles || []).filter(
      (handle) => !rejectedHandles(context).has(handle)
    ).slice(0, 3);
  }
  const needsCommerce = ["price_quote", "price_value", "bundle_quote", "savings_quote", "cart_add"].includes(taskType);
  const needsCompatibility = ["bundle_quote", "compatibility", "cart_add"].includes(taskType);
  const ambiguousSetupPrice =
    taskType === "price_quote" &&
    /\bsetup\b/.test(text) &&
    !canonicalReference &&
    !deal.activeQuote &&
    !deal.activeBaseHandle &&
    !Object.prototype.hasOwnProperty.call(explicitBase, "baseHandle");
  const missingCanonical =
    ["canonical_recommendation", "canonical_recall"].includes(taskType) && !canonicalHandle;
  const missingProductReference =
    ["product_experience", "product_comparison", "canonical_comparison", "comparison_value", "advisor_choice", "firmness_choice", "firmness_compare", "durability_objection", "hybrid_exploration"].includes(taskType) &&
    (((!activeHandle && !explicitHandle) && comparisonHandles.length < 2) || unresolvedExplicitProductSubject);
  const atomicStandaloneCommerce =
    ["price_quote", "bundle_quote", "savings_quote"].includes(taskType) &&
    Number(activeMemory(context)?.turnIndex || 0) <= 1 &&
    !continuation;
  const atomicStandalonePolicy =
    taskType === "warranty_explanation" &&
    !activeHandle &&
    Number(activeMemory(context)?.turnIndex || 0) <= 1 &&
    !continuation;
  const missingCommerceProduct = needsCommerce && !quoteReferenceHandle;
  const handled =
    taskType !== "legacy" &&
    taskType !== "cart_review" &&
    !ambiguousSetupPrice &&
    !missingCanonical &&
    !missingProductReference &&
    !missingCommerceProduct &&
    !atomicStandalonePolicy;
  const stage = inferStage(taskType, deal.stage);
  const depth = responseDepth(text, taskType);
  const modelEligible = [
    "product_experience",
    "product_comparison",
    "canonical_comparison",
    "comparison_value",
    "base_education",
    "value_judgment",
    "value_objection",
    "price_value",
    "configuration_value",
    "advisor_choice",
    "firmness_choice",
    "firmness_compare",
    "compound_product_base",
    "durability_objection",
    "hybrid_exploration",
    "configuration_update",
    "confusion_recovery",
    "compatibility",
    "bundle_quote",
    "warranty_explanation",
    "shopper_feedback",
    "alternative_resolution",
    "trust_recovery",
    "reconsider_product",
    "commitment_declined",
    "commitment_resolution",
    "session_recommendation_recall",
    "recommendation_explanation",
    "recommendation_acceptance",
    "sleep_education",
    "canonical_recommendation",
    "canonical_recall",
  ].includes(taskType);

  return {
    version: ORCHESTRATOR_VERSION,
    taskType,
    continuationOf: continuation ? clean(deal.lastAnsweredQuestionType || deal.currentTopic || "active_conversation") : null,
    references: {
      canonicalRecommendation: canonicalHandle || null,
      activeProductHandle: activeHandle || null,
      requestedProductHandle: quoteReferenceHandle || null,
      comparisonProductHandles: comparisonHandles,
      rejectedProductHandles: Array.from(rejectedHandles(context)),
      sessionRecommendationHandle: activeSessionRecommendationHandle(context) || null,
      acceptedRecommendationHandle: clean(deal?.acceptedRecommendation?.productHandle).toLowerCase() || null,
      feedbackProductHandle: feedbackHandle || null,
      resolution: referenceResolution,
    },
    protectedReferences: [...new Set([
      canonicalReference ? "canonicalRecommendation" : "",
      referenceResolution.resolved ? referenceResolution.source : "",
    ].filter(Boolean))],
    knownFacts: {
      size: size || workingGoal?.size || null,
      baseHandle: Object.prototype.hasOwnProperty.call(explicitBase, "baseHandle")
        ? explicitBase.baseHandle
        : deal.activeBaseHandle ?? workingGoal?.baseHandle ?? null,
      motionKey: explicitBase.motionKey || deal.activeMotionKey || workingGoal?.motionKey || null,
      painPoints: activeMemory(context)?.slots?.painPoints?.value || [],
      baseDecision: clean(deal.baseDecision || deal.decision?.adjustableBase) || null,
      retainedPreferences: isObject(deal.retainedPreferences) ? deal.retainedPreferences : {},
      desiredDirection: isObject(deal.desiredDirection) ? deal.desiredDirection : {},
      budgetContext: isObject(deal.budgetContext) ? deal.budgetContext : {},
      activeConfiguration: isObject(deal.activeConfiguration) ? deal.activeConfiguration : {},
    },
    neededFacts: needsCommerce && !size ? ["size"] : [],
    requiredSources: unique([
      canonicalHandle ? "profile" : "",
      needsCommerce ? "commerce" : "",
      needsCompatibility ? "compatibility" : "",
    ]),
    answerMode: taskType,
    responseDepth: depth,
    needsModel: handled && modelEligible && !atomicStandaloneCommerce,
    atomicCommerceLookup: atomicStandaloneCommerce,
    needsCommerce,
    needsCompatibility,
    needsKnowledge: ["product_experience", "product_comparison", "canonical_comparison", "comparison_value", "base_education", "advisor_choice", "firmness_choice", "compound_product_base", "durability_objection", "hybrid_exploration", "shopper_feedback", "alternative_resolution", "trust_recovery", "reconsider_product", "session_recommendation_recall", "recommendation_explanation", "recommendation_acceptance", "value_objection", "price_value", "configuration_value", "sleep_education"].includes(taskType),
    needsPolicy: ["medical_boundary", "warranty_explanation"].includes(taskType),
    allowedActions: taskType === "cart_add" ? ["add_to_cart"] : [],
    commercialState: {
      activeGoal: clean(workingGoal?.intent) || null,
      goalStatus: clean(workingGoal?.status) || null,
      goalReady: readyCommercialGoal,
      activeQuoteReady: activeQuoteMatchesGoal,
      compatibilityStatus: clean(deal.compatibilityStatus) || "unknown",
      activeGoalStillActionable: Boolean(continuingPriceGoal),
      clearSubjectChange: clearlyChangedSubject,
      requestedScope: clean(workingGoal?.scope) || null,
      quoteInvalidation: clean(deal.activeQuote?.invalidationReason) || null,
    },
    interpretedActs: acts,
    pendingCommitment: isObject(deal.pendingCommitment) ? deal.pendingCommitment : null,
    staleRouteOverride,
    commercialCompletionAttempted: Boolean(
      readyCommercialGoal && ["price_quote", "bundle_quote", "compatibility"].includes(taskType)
    ),
    probe: null,
    recovery: correctionCue || (referenceResolution.phrase && !referenceResolution.resolved)
      ? {
          recognized: taskType !== "legacy",
          type: referenceResolution.phrase
            ? referenceResolution.resolved
              ? "reference_correction"
              : "ambiguous_reference"
            : /\b(?:go back|return to)\b/.test(text)
              ? "product_return"
              : /\b(?:failed|try again)\b/.test(text)
                ? "cart_retry"
              : parsedSize
              ? "size_change"
              : Object.keys(explicitBase).length
                ? "configuration_change"
                : "shopper_correction",
          acknowledgement: taskType !== "reference_clarification" && taskType !== "correction_clarification",
          baseRemoved: Boolean(explicitBase.explicitNoBase),
        }
      : null,
    confidence: handled ? 0.96 : 0.55,
    stage,
    handled,
    medicalBoundary: isExplicitMedical(text),
    technicalLanguageAllowed: isTechnicalQuestion(text),
  };
}

function buildRelevantFactPack({ query = "", context = {}, plan = {} } = {}) {
  const manifest = loadShowroomManifest();
  const byHandle = new Map((manifest?.products || []).map((product) => [clean(product.handle), product]));
  const deal = activeDeal(context);
  const handles = unique([
    plan?.references?.canonicalRecommendation,
    plan?.references?.activeProductHandle,
    plan?.references?.feedbackProductHandle,
    plan?.references?.sessionRecommendationHandle,
    plan?.references?.acceptedRecommendationHandle,
    ...(plan?.references?.comparisonProductHandles || []),
    ...((activeDeal(context)?.rankedAlternatives || []).slice(0, 3).map((candidate) => candidate?.handle)),
    plan?.knownFacts?.baseHandle,
  ]);
  const products = handles.map((handle) => byHandle.get(handle)).filter(Boolean).map((product) => ({
    handle: clean(product.handle),
    title: clean(product.title),
    catalogType: clean(product.catalogType),
    family: clean(product.family),
    active: product.active !== false,
    recommendable: product.recommendable !== false,
    attributes: isObject(product.attributes) ? product.attributes : {},
  }));
  const recentTurns = (activeMemory(context)?.conversationFocus?.relevantTurns || context?.recentConversation || [])
    .slice(-4)
    .map((turn) => ({ role: clean(turn?.role), content: clean(turn?.content).slice(0, 280) }));
  const factPack = {
    version: 2,
    shopperMessage: clean(query),
    shopper: {
      sleepPosition:
        context?.canonicalRecommendation?.normalizedAssessment?.sleepPosition ||
        context?.assessment?.answers?.sleepPosition ||
        null,
      sleepPartner:
        context?.canonicalRecommendation?.normalizedAssessment?.sleepPartner ||
        context?.assessment?.answers?.sleepPartner ||
        context?.assessment?.sleepPartner ||
        null,
      painPoints: plan?.knownFacts?.painPoints || [],
    },
    conversation: {
      stage: plan.stage || "exploring",
      taskType: plan.taskType,
      continuationOf: plan.continuationOf || null,
      responseDepth: plan.responseDepth,
      activeGoal: activeMemory(context)?.activeGoal?.intent || null,
      currentTopic: deal?.currentTopic || null,
      unresolvedDecision: deal?.baseDecision === "undecided" ? "adjustable_base_value" : null,
      recentTurns,
    },
    state: {
      size: plan?.knownFacts?.size || deal?.activeSize || null,
      firmness: activeMemory(context)?.slots?.firmness?.value || null,
      activeProductHandle: deal?.activeProductHandle || null,
      activeConfiguration: deal?.activeConfiguration || null,
      baseDecision: plan?.knownFacts?.baseDecision || null,
      budgetContext: deal?.budgetContext || {},
      pendingCommitment: deal?.pendingCommitment || null,
      restTestObservations: Array.isArray(deal?.restTestObservations) ? deal.restTestObservations.slice(-4) : [],
    },
    recommendation: {
      original: resolveCanonicalHandle(context) || null,
      current: activeSessionRecommendationHandle(context) || deal?.activeProductHandle || null,
      accepted: deal?.acceptedRecommendation || null,
      rankedAlternatives: Array.isArray(deal?.rankedAlternatives) ? deal.rankedAlternatives.slice(0, 4) : [],
      reasons: Array.isArray(deal?.recommendationReasons) ? deal.recommendationReasons : [],
      excludedCandidates: Array.isArray(deal?.excludedCandidates) ? deal.excludedCandidates : [],
      unknowns: Array.isArray(deal?.recommendationUnknowns) ? deal.recommendationUnknowns : [],
    },
    feedback: {
      rejectedProducts: Array.isArray(deal?.rejectedProducts) ? deal.rejectedProducts : [],
      productFeedback: isObject(deal?.productFeedback) ? deal.productFeedback : {},
      retainedPreferences: isObject(deal?.retainedPreferences) ? deal.retainedPreferences : {},
      desiredDirection: isObject(deal?.desiredDirection) ? deal.desiredDirection : {},
      explicitExclusions: Array.from(rejectedHandles(context)),
    },
    products,
    productFacts: [],
    advisorKnowledge: null,
    commerce: deal?.activeQuote || null,
    compatibility: { status: deal?.compatibilityStatus || "unknown", source: "verified_fact" },
    policyFacts: [],
    missingInformation: plan.neededFacts || [],
    prohibited: plan.technicalLanguageAllowed ? [] : INTERNAL_LANGUAGE,
    allowedActions: plan.allowedActions || [],
    classifications: {
      productFacts: "verified_fact",
      commerce: "verified_fact",
      advisorKnowledge: "advisor_interpretation",
      missingInformation: "unknown",
    },
    resolvedReferences: plan?.references?.resolution || null,
    presentationPolicy: plan.presentationPolicy || null,
  };
  factPack.budget = {
    totalChars: JSON.stringify(factPack).length,
    productChars: JSON.stringify(factPack.products).length,
    historyChars: JSON.stringify(recentTurns).length,
    advisorChars: 0,
    policyChars: 0,
  };
  return factPack;
}

async function fetchByHandles(fetchProductsByHandles, handles = []) {
  if (typeof fetchProductsByHandles !== "function" || !handles.length) return [];
  try {
    const response = await fetchProductsByHandles({ handles: unique(handles), lite: false });
    return Array.isArray(response?.items) ? response.items : [];
  } catch (_error) {
    // Catalog/state truth can still produce a safe advisory answer when live
    // merchandise enrichment is unavailable. Commerce remains unresolved and
    // cannot emit price or cart actions without exact variants.
    return [];
  }
}

function buildCompatibility({ mattressHandle = "", motionKey = "", baseHandle = "" } = {}) {
  if (!baseHandle) return { status: "not_applicable", reason: "mattress_only" };
  if (baseHandle !== "premium-motion-adjustable-base") {
    return { status: "compatible", reason: "standard_foundation" };
  }
  if (["half_split", "full_split"].includes(motionKey) && mattressHandle !== "12-dual-comfort-hybrid") {
    return { status: "incompatible", reason: "split_motion_requires_dual_comfort" };
  }
  return { status: "compatible", reason: "approved_motion_pairing" };
}

async function buildQuote({ plan = {}, context = {}, fetchProductsByHandles } = {}) {
  const deal = activeDeal(context);
  const goal = activeMemory(context)?.activeGoal || {};
  const size = clean(plan?.knownFacts?.size || deal.activeSize || goal.size);
  const productHandle = clean(
    plan?.references?.requestedProductHandle ||
      deal?.acceptedRecommendation?.productHandle ||
      deal?.sessionRecommendation?.productHandle ||
      goal.productHandle ||
      resolveCanonicalHandle(context)
  );
  const wantsBundle = ["bundle_quote", "compatibility", "savings_quote"].includes(plan.taskType) ||
    (plan.taskType === "cart_add" && /\b(?:full setup|mattress and base|both)\b/.test(normalizeAskSnoozerText(plan.query)));
  const explicitNoBase = plan?.knownFacts?.baseHandle === null && plan?.knownFacts?.motionKey === "none";
  const baseHandle = wantsBundle && !explicitNoBase
    ? clean(plan?.knownFacts?.baseHandle || deal.activeBaseHandle || goal.baseHandle || "premium-motion-adjustable-base")
    : "";
  const motionKey = baseHandle === "premium-motion-adjustable-base"
    ? clean(plan?.knownFacts?.motionKey || deal.activeMotionKey || goal.motionKey || "standard")
    : "none";
  const missing = [];
  if (!productHandle) missing.push("product");
  if (!size) missing.push("size");
  if (missing.length) {
    return { ok: false, missing, items: [], subtotal: null, currencyCode: "USD", cartReady: false };
  }
  const compatibility = buildCompatibility({ mattressHandle: productHandle, baseHandle, motionKey });
  if (compatibility.status === "incompatible") {
    return {
      ok: false,
      missing: [],
      items: [],
      subtotal: null,
      currencyCode: "USD",
      cartReady: false,
      compatibility,
    };
  }
  const handles = unique([productHandle, baseHandle]);
  const fetched = await fetchByHandles(fetchProductsByHandles, handles);
  const byHandle = new Map(fetched.map((product) => [clean(product.handle).toLowerCase(), product]));
  const items = [];
  const mattressProduct = byHandle.get(productHandle);
  const setupSize = setupSizeForSelection(size);
  const mattress = buildQuoteProduct(mattressProduct, {
    size,
    setupSize,
    motionKey: baseHandle ? motionKey : "none",
    category: "mattress",
  });
  if (mattress) items.push(mattress);
  if (baseHandle) {
    const baseProduct = byHandle.get(baseHandle);
    const base = buildQuoteProduct(baseProduct, {
      size,
      setupSize,
      motionKey,
      category: "adjustable_base",
    });
    if (base) items.push(base);
  }
  const missingHandles = handles.filter((handle) => !items.some((item) => item.handle === handle));
  const currencies = unique(items.map((item) => item.currencyCode));
  const ok = !missingHandles.length && items.length === handles.length && currencies.length === 1;
  const subtotal = ok ? items.reduce((sum, item) => sum + item.price, 0) : null;
  return {
    version: "1.1.0",
    configurationContractVersion: COMMERCE_CONFIGURATION_VERSION,
    ok,
    size,
    setupSize,
    motionKey: baseHandle ? motionKey : "none",
    baseHandle: baseHandle || null,
    productHandle,
    items,
    subtotal,
    currencyCode: currencies[0] || "USD",
    missing: missing.concat(missingHandles.map((handle) => `variant:${handle}`)),
    compatibility,
    cartReady: ok && compatibility.status !== "incompatible" && items.every((item) => PRODUCT_VARIANT_GID.test(item.variantId)),
  };
}

function buildAddAction(item = {}) {
  if (!PRODUCT_VARIANT_GID.test(clean(item.variantId))) return null;
  return {
    type: "add_to_cart",
    label: `Add ${item.title}`,
    payload: {
      merchandiseId: item.variantId,
      variantId: item.variantId,
      quantity: 1,
      handle: item.handle,
      title: item.title,
      imageUrl: item.imageUrl,
      unitPrice: item.price,
      selectedOptions: item.selectedOptions,
    },
  };
}

function shopperFriendlyResponse({ query = "", plan = {}, context = {}, quote = null } = {}) {
  const text = normalizeAskSnoozerText(query);
  const canonical = resolveCanonicalHandle(context);
  const active = plan?.references?.requestedProductHandle || resolveActiveHandle(context) || canonical;
  const activeTitle = titleFor(active);
  const pain = unique(plan?.knownFacts?.painPoints || []);
  const pressurePoints = pain.map((area) => area.replace(/\bshoulders\b/gi, "shoulder").replace(/\bhips\b/gi, "hip"));
  const pressureLanguage = pressurePoints.length
    ? `${pressurePoints.join(" and ")} pressure`
    : "pressure around your shoulders and hips";
  const comparison = plan?.references?.comparisonProductHandles || [];
  const first = comparison[0] || canonical;
  const second = comparison.find((handle) => handle !== first) || (first === "14-hybrid" ? canonical : "14-hybrid");
  const firstTitle = titleFor(first);
  const secondTitle = titleFor(second);
  const rejected = rejectedHandles(context);
  const feedbackHandle = clean(plan?.references?.feedbackProductHandle).toLowerCase();
  const feedbackTitle = titleFor(feedbackHandle);
  const sessionHandle = activeSessionRecommendationHandle(context);
  const sessionTitle = titleFor(sessionHandle);
  const acceptedHandle = clean(activeDeal(context)?.acceptedRecommendation?.productHandle).toLowerCase();
  const acceptedTitle = titleFor(acceptedHandle || sessionHandle || active);
  const recommendationReasonCodes = new Set(
    (activeDeal(context)?.recommendationReasons || []).map((reason) => clean(reason?.code))
  );
  const recommendationWhy = [
    recommendationReasonCodes.has("softer_side_available") ? "it gives you a softer-side option after the previous mattress felt too firm" : "",
    recommendationReasonCodes.has("retains_motion_preference") ? "it keeps the motion setup you liked available" : "",
    recommendationReasonCodes.has("cooling_direction") ? "its verified construction better supports the cooler direction you asked for" : "",
    recommendationReasonCodes.has("partner_friendly") ? "it supports different comfort needs for two sleepers" : "",
  ].filter(Boolean);
  const retainedMotion = activeDeal(context)?.retainedPreferences?.motion?.value === "liked";
  const desired = activeDeal(context)?.desiredDirection || {};
  const savedSize = plan?.knownFacts?.size || activeDeal(context)?.activeSize || null;
  const recoveryPrefix = plan?.recovery?.acknowledgement
    ? plan.recovery.type === "size_change"
      ? "Got it—I updated the size. "
      : plan.recovery.type === "configuration_change"
        ? plan.recovery.baseRemoved
          ? "Got it—I removed the base from this quote. "
          : "Got it—I updated the configuration. "
        : plan.recovery.type === "product_return"
          ? `Got it—we’re back to the ${activeTitle}. `
          : plan.recovery.type === "cart_retry"
            ? "Got it—the first cart action did not complete. "
          : plan.recovery.type === "reference_correction"
          ? `Got it—you mean the ${activeTitle}. `
          : "Thanks for correcting me. "
    : "";

  switch (plan.taskType) {
    case "greeting":
      return "Hi, I’m Snoozer. I can help you compare mattresses, understand your recommendation, price a setup, or continue the choice you were already making.";
    case "support_handoff":
      return "Yes. Use the Human Assistance control to connect with a store associate for personal support.";
    case "sleep_education":
      if (/\b(?:sleep hot|cooler mattress)\b/.test(text)) {
        return `If you sleep hot, compare how quickly heat clears when you change position instead of relying on a cooling label alone. A hybrid such as the ${titleFor(sessionHandle || "14-hybrid")} can feel more breathable because air moves through the coil unit, while foam usually gives closer contouring. I would test temperature together with shoulder and hip comfort so you do not trade pressure relief for airflow.`;
      }
      if (/\b(?:side sleeper|sleep on my side)\b/.test(text)) {
        return "For side sleeping, look for enough pressure relief to let your shoulders and hips settle without letting your waist collapse. Stay on your usual side for several quiet minutes; pressure should ease while your midsection still feels supported. Your own pressure response matters more than the firmness label.";
      }
      if (/\bpartner moves|motion separation\b/.test(text)) {
        return "If your partner moves a lot, prioritize motion isolation and test whether a turn on one side reaches the other. The 12-inch Dual Comfort Hybrid is the most useful comparison when two sleepers also want independent comfort choices; an all-foam construction generally absorbs movement more closely. I would compare both movement and each sleeper’s pressure relief before choosing.";
      }
      if (/\bback pain\b/.test(text)) {
        return "For back discomfort, look for stable support that keeps your midsection from dropping while still allowing the mattress to meet your natural shape. Test your usual sleep position and notice whether pressure builds or your lower back feels unsupported; a firmer label alone is not proof of a better fit. I can help compare comfort and support, but I cannot diagnose the cause of pain or replace a clinician’s guidance.";
      }
      if (/\bfirmer mattress\b/.test(text)) {
        return "Not automatically. A firmer mattress is useful only if your hips sink too far, your midsection feels unsupported, or you struggle to change position; firmness by itself does not guarantee better support. I would choose the feel that keeps you level while still relieving shoulder and hip pressure.";
      }
      return "Waking tired can have many causes, so I would not blame the mattress without testing the basics. Notice whether you wake from pressure, heat, partner movement, or an unsupported position, then compare one change at a time during your Rest Test. If the tiredness is persistent or concerning, discuss it with a clinician rather than treating a mattress as a medical fix.";
    case "session_recommendation_recall":
      if (!sessionHandle) {
        return `Your original assessment recommendation is still ${titleFor(canonical)}, but I do not yet have a different current-session choice grounded in what you have told me. Tell me what you want to change, and I will narrow the eligible options.`;
      }
      return `My current recommendation is the ${sessionTitle}. ${recommendationWhy.length ? `It moved ahead because ${recommendationWhy.join(" and ")}.` : "It is the strongest eligible option after the feedback you gave me during this visit."}`;
    case "recommendation_explanation":
      return `I am recommending the ${sessionTitle || activeTitle} now because ${recommendationWhy.length ? recommendationWhy.join(" and ") : "it best fits the feedback and choices you have made during this visit"}. That is a current-visit recommendation, not a rewrite of what your assessment originally suggested.`;
    case "recommendation_acceptance": {
      const size = savedSize ? ` in ${savedSize}` : "";
      const baseOpen = !activeDeal(context)?.activeConfiguration?.baseHandle && retainedMotion;
      return `Got it—the ${acceptedTitle}${size} is now your mattress choice. ${baseOpen ? "I kept the motion preference open, so the next useful step is to compare mattress-only with Standard Motion." : savedSize ? "I can price the exact configuration next." : "Tell me the size you need, and I can continue to the exact configuration."}`;
    }
    case "value_objection": {
      const activeQuote = quote?.ok ? quote : activeDeal(context)?.activeQuote;
      const baseLine = activeQuote?.items?.find((item) => item.handle === activeQuote?.baseHandle);
      if (activeQuote?.items?.length > 1 && baseLine) {
        const mattressTotal = Number(activeQuote.subtotal) - Number(baseLine.price);
        return `That is a fair concern. The complete setup is ${formatMoney(activeQuote.subtotal, activeQuote.currencyCode)}, but the mattress-only option is ${formatMoney(mattressTotal, activeQuote.currencyCode)} before taxes, delivery, or active discounts. I would keep the base only if elevation gave you a benefit you could clearly feel.`;
      }
      return `That is a fair concern. I will not push the more expensive setup just because it adds features. Let us protect the mattress fit first, then compare only the exact lower-cost configuration that still keeps the choices you said matter.`;
    }
    case "shopper_feedback": {
      const reason = activeDeal(context)?.productFeedback?.[feedbackHandle]?.feel;
      const feeling = reason === "too_firm"
        ? "felt too firm to you"
        : reason === "too_soft"
          ? "felt too soft to you"
          : "did not feel right to you";
      const retained = [savedSize ? `${savedSize} size` : "", retainedMotion ? "the motion features you liked" : ""]
        .filter(Boolean)
        .join(" and ");
      return `The ${feedbackTitle || "mattress"} ${feeling}, so I have taken it off your active list. ${retained ? `I am keeping your ${retained} in the search. ` : ""}Would you like me to find ${desired.feel === "softer" ? "another" : "a"} softer alternative from the mattresses available here?`;
    }
    case "alternative_resolution":
      if (!sessionHandle) {
        return "I have kept the mattresses you ruled out off your list, but I do not have another eligible showroom mattress I can recommend confidently from the current selection. I will not invent an option that is not available. We can revisit one ruled-out mattress or relax one requirement, such as feel or motion, and compare that tradeoff honestly.";
      }
      return `I have kept the mattress you ruled out off your list. The ${sessionTitle} is the strongest eligible next test${retainedMotion ? " while keeping the motion features you liked in the plan" : ""}. It gives you a genuinely different construction and feel, but I will not promise it is softer for your body until you try it. ${savedSize ? `I kept ${savedSize} as your size.` : ""}`.trim();
    case "trust_recovery":
      return `You are right to correct me. The ${feedbackTitle || "mattress you rejected"} is off your active list, and I will not recommend or price it again unless you ask to reconsider it. ${retainedMotion ? "I am keeping the motion features you liked. " : ""}${desired.feel === "softer" ? "The next step is a softer-feeling alternative from the mattresses actually available here." : "I will continue only with eligible alternatives."}`;
    case "commitment_declined":
      return `Got it—I will not take that next step. ${rejected.size ? "The mattress you ruled out stays off your list. " : ""}${savedSize ? `Your ${savedSize} size remains saved for this visit.` : "Your other current choices remain unchanged."}`;
    case "commitment_resolution":
      return `Got it—I am continuing with the ${clean(plan?.pendingCommitment?.type).replace(/_/g, " ") || "next step"} you accepted, using only the products and preferences still active in this visit.`;
    case "reconsider_product":
      return `The ${activeTitle} is back in consideration because you explicitly asked to revisit it. Your earlier feedback is still part of this visit, so we can compare it honestly without pretending that concern disappeared.`;
    case "reference_clarification":
      return "I have two products in view and do not want to guess. Which one do you mean?";
    case "correction_clarification":
      return "Thanks for correcting me. What should I change—the mattress, size, base, or motion setup?";
    case "canonical_recommendation":
    case "canonical_recall":
      if (canonical && rejected.has(canonical)) {
        return `Your assessment originally started with the ${titleFor(canonical)}, but you ruled it out during this visit. ${sessionHandle ? `Your current session recommendation is the ${sessionTitle}.` : "I will keep it as history and find an eligible alternative instead of putting it back on your list."}`;
      }
      return `I would start you with ${canonicalPodName(context)} and the ${titleFor(canonical)}. For a side sleeper focused on shoulder and hip comfort, its closer contour is the better first test. Lie on your side for several quiet minutes and notice whether those pressure points relax without your midsection sinking too far.`;
    case "product_experience":
      if (active === "14-hybrid") {
        return `${recoveryPrefix}On the ${activeTitle}, you should notice a more lifted, responsive feel with easier movement and more airflow than an all-foam mattress. The useful test is whether ${pressureLanguage} eases without your midsection arching or feeling pushed up. If the surface feels too springy or pressure builds at your shoulder, the all-foam option is the better comparison.`;
      }
      if (active === "12-dual-comfort-hybrid") {
        return `${recoveryPrefix}On the ${activeTitle}, you should notice responsive support and easier movement than an all-foam mattress, with independent comfort choices for two sleepers. The useful test is whether ${pressureLanguage} eases on your preferred side while your midsection stays supported. If either sleeper feels pushed up or pressure builds, compare the other comfort setting before deciding.`;
      }
      return `${recoveryPrefix}On the ${activeTitle}, you should notice a deeper, more even cradle around your shoulders and hips, with less bounce when you change position. The useful test is whether ${pressureLanguage} eases while your waist still feels supported. If you feel stuck or your hips drop too far, it is softer than you need.`;
    case "product_comparison":
      return `The ${firstTitle} gives you a closer, steadier contour with less bounce, while the ${secondTitle} feels more lifted, springy, and breathable. For your current visit, I would start with the ${titleFor(sessionHandle || canonical || first || active)} and use your shoulder and hip pressure—not the original assessment alone—to decide.`;
    case "canonical_comparison":
      return `Your original recommendation was the ${firstTitle}, while your current choice is the ${secondTitle}. The original recommendation reflected your assessment; the current choice also reflects what you actually felt and decided during this visit. I would use the ${secondTitle} as the active option and keep the ${firstTitle} only as a comparison point.`;
    case "comparison_value":
      return `The ${firstTitle} and ${secondTitle} differ in construction and feel, so the value question is whether the second option improves something you personally care about. I would favor the ${titleFor(sessionHandle || active || second || first)} for you based on your current feedback, but I would not pay more for features you did not notice or value.`;
    case "price_value": {
      const priced = quote?.ok ? `The current ${quote.size || savedSize || "selected"} configuration is ${formatMoney(quote.subtotal, quote.currencyCode)} before taxes, delivery, or active discounts. ` : "";
      return `${priced}It is worth the added cost only when the selected construction or configuration creates a benefit that matters to you. For your priorities, I would pay the difference only if the feel, responsiveness, or elevation is clearly better during your Rest Test; otherwise I would keep the lower-cost mattress-only choice.`;
    }
    case "advisor_choice":
      if (/\bwould you buy\b/.test(text)) {
        return `For the needs you have described, I would buy the ${titleFor(sessionHandle || canonical || active)} and keep it mattress-only unless elevation clearly improved your comfort during the Rest Test. That is the less expensive setup, and the base is only worth adding if you can name a benefit you actually felt.`;
      }
      return `I would choose the ${titleFor(sessionHandle || canonical || active)} for you based on what you have learned during this visit. Your shoulder and hip pressure during the Rest Test should make the final call, because your live comfort feedback matters more than the assessment starting point.`;
    case "firmness_choice":
      return `Of the two, the ${firstTitle} is the closer-contouring choice and the ${secondTitle} is the more lifted, responsive choice. Based on your current feedback, I would pick the ${titleFor(sessionHandle || active || first)} for you, then use shoulder and hip pressure during the Rest Test to confirm it rather than relying on a firmness label alone.`;
    case "durability_objection":
      return `That is a fair concern. The ${activeTitle} uses supportive base foam and CertiPUR-US certified foams, but neither construction nor certification is a promise that normal softening or body impressions can never happen. Use the support specified for the mattress, keep it protected, and rotate it when the care guidance allows; those basics help prevent uneven wear. If you want a more lifted feel and the reassurance of a coil support unit, compare a hybrid, but I would not move you away from the All Foam solely out of fear before you compare the feel and warranty tradeoff.`;
    case "hybrid_exploration":
      return rejected.has("12-all-foam-mattress")
        ? "The two hybrids worth comparing are the 12-inch Dual Comfort Hybrid and the 14-inch Hybrid. Both combine foam comfort with coil support and airflow; the Dual Comfort is the stronger choice for couples who want different comfort choices by side, while the 14-inch Hybrid is the simpler lifted, responsive alternative. Since you already ruled out the previous mattress, compare these two directly for shoulder pressure and ease of movement."
        : "Given your concern about long-term wear, the two hybrids worth comparing are the 12-inch Dual Comfort Hybrid and the 14-inch Hybrid. Both combine foam comfort with coil support and airflow; the Dual Comfort is the stronger choice for couples who want different comfort choices by side, while the 14-inch Hybrid is the simpler lifted, responsive alternative. A hybrid will feel easier to move on than the All Foam, but it will not give quite the same close contour or motion isolation.";
    case "compound_product_base":
      return `The ${activeTitle} is your current mattress choice, and the motion base is still optional. The mattress does not need motion to deliver its comfort; the base earns its cost only if elevation gives you a benefit you can actually feel for relaxing, reading, or sleeping. I would compare the mattress-only price with Standard Motion before deciding, and I would save the money if elevation did not matter during your Rest Test.`;
    case "configuration_update": {
      const size = plan?.knownFacts?.size || activeDeal(context)?.activeSize;
      const baseOpen = clean(plan?.knownFacts?.baseDecision) === "undecided" || clean(activeDeal(context)?.baseDecision) === "undecided";
      return `${size}—got it. You are looking at the ${activeTitle} in ${size}${baseOpen ? ", and the open question is whether motion is worth adding" : ""}. ${baseOpen ? "I can price it mattress-only or compare it with Standard Motion." : "I can now price the configuration you want."}`;
    }
    case "confusion_recovery": {
      const size = plan?.knownFacts?.size || activeDeal(context)?.activeSize || "your selected size";
      const baseOpen = clean(plan?.knownFacts?.baseDecision) === "undecided" || clean(activeDeal(context)?.baseDecision) === "undecided";
      if (rejected.size) {
        const ruledOut = Array.from(rejected).map(titleFor).filter(Boolean).join(" and ");
        return `Here is the simple version: you ruled out the ${ruledOut} because it did not feel right to you. ${retainedMotion ? "You still like the motion features. " : ""}${desired.feel === "softer" ? "We are now looking for a softer-feeling mattress" : "We are now looking for another eligible mattress"}${size ? ` in ${size}` : ""}.`;
      }
      return `Here is the simple version: you are looking at the ${activeTitle} in ${size}. ${baseOpen ? "The only open decision is whether the motion base is worth adding." : "The mattress and size are already decided."} ${baseOpen ? "I can show the mattress-only price first or compare it with Standard Motion." : "I can price that setup next."}`;
    }
    case "warranty_explanation":
      return `Yes. The ${activeTitle} includes a 10-year limited mattress warranty covering qualifying defects in materials and workmanship, including excessive sagging or uneven wear not caused by misuse. Normal softening, stains, misuse, improper support, and comfort-preference changes after the trial are not covered. Keep your proof of purchase; the approved guidance says separate registration is not required.`;
    case "base_education":
      return `Standard Motion raises and lowers the head and foot of the mattress together. It can make reading, relaxing, getting in and out of bed, or sleeping with gentle elevation more comfortable. I would add it only if you notice a real benefit from elevation; it does not make the mattress itself more pressure-relieving.`;
    case "value_judgment":
      if (/\bbest value(?: option)?\b/.test(text)) {
        const valueTitle = titleFor(sessionHandle || active || canonical);
        const valueSubject = valueTitle ? `the ${valueTitle}` : "the mattress that fits you best";
        return `The best value is ${valueSubject} without paying for features you did not feel. I would get the mattress choice right first and add a motion base only when elevation creates a clear benefit during your Rest Test. A lower total is not a bargain if the mattress misses your comfort needs, and a higher total is not better just because it includes more equipment.`;
      }
      if (/didn.t notice|did not notice/.test(text)) {
        return `Save the money and skip the adjustable base. If elevation did not create a clear comfort or lifestyle benefit during your test, the mattress is doing the important work and the base is not earning its cost.`;
      }
      if (/more expensive.*better/.test(text)) {
        return `No. More expensive is only better when the added feature solves something you care about. For you, mattress fit comes first; I would keep the cheaper mattress-only setup unless elevation gives you a benefit you can actually feel.`;
      }
      return `Based on what you have told me, I would save the money unless you liked sleeping or relaxing with your head or feet elevated. The adjustable base adds positioning, not a better mattress fit, so it is optional rather than necessary for your shoulder and hip pressure.`;
    case "configuration_value":
      return /\b(?:okay|ok|go with|choose|want|make it|mattress[- ]only)\b/.test(text)
        ? `Mattress-only—got it. You are keeping the ${activeTitle}${savedSize ? ` in ${savedSize}` : ""} and removing the motion base from this configuration. The next price should include only the mattress.`
        : `Skipping the motion base leaves you with the same mattress comfort and support; you are only giving up head-and-foot elevation. If elevation did not create a clear benefit for you, I would choose mattress-only and save the money. Your mattress, size, and other preferences stay the same.`;
    case "compatibility":
      if (quote?.compatibility?.status === "incompatible") {
        return `${recoveryPrefix}That split-motion setup does not pair with ${activeTitle}. Split motion needs the dual-comfort mattress configuration. Standard Motion is the compatible adjustable option for this mattress.`;
      }
      return `Yes. The ${activeTitle} and ${titleFor(quote?.baseHandle || "premium-motion-adjustable-base")} are compatible in ${quote?.size || plan?.knownFacts?.size || "the selected"} size with ${quote?.motionKey === "standard" ? "Standard Motion" : "the selected configuration"}. The setup makes sense if you value elevation; otherwise the mattress-only option is the better value.`;
    case "preference_capture":
      if (/elevation|elevated|raised|head up|feet up/.test(text)) {
        return `${recoveryPrefix}That matters. Since you liked the elevated position, the adjustable base is more than an extra feature for you; it supports a comfort preference you actually felt. I would keep Standard Motion in the setup unless independent movement on each side is important.`;
      }
      return `${recoveryPrefix}I’ll use that as your current comfort preference. We can compare the active options against it without changing the mattress originally recommended from your assessment.`;
    case "preference_recall":
      if (activeDeal(context)?.decision?.elevation === "liked") {
        return `You said you liked the elevated position. That is the clearest reason to keep Standard Motion in your setup; it supports a benefit you actually felt.`;
      }
      return `I do not have a clear saved preference from this conversation yet. Tell me what felt better, and I’ll use that in the next comparison.`;
    case "firmness_compare":
      if (/^(?:yes|true|1)$/i.test(clean(
        context?.canonicalRecommendation?.normalizedAssessment?.sleepPartner ||
        context?.assessment?.answers?.sleepPartner ||
        context?.assessment?.sleepPartner
      ))) {
        return `The ${activeTitle} is the right comparison when you and your partner want different firmness levels, because each side can have its own feel. Keep that comfort choice separate from motion separation: firmness changes how each side feels, while the motion setup changes how independently the sides can move. Start with each person’s preferred feel, then decide whether separate elevation earns its cost.`;
      }
      return `For the mattress we are discussing, medium will feel steadier and easier to move on, while soft will allow more shoulder and hip sink. Because pressure relief is your priority, start with soft; move to medium only if your hips feel too low or you feel trapped in the surface.`;
    case "medical_boundary":
      return `I can help compare general comfort, support, pressure, and elevation, but I cannot diagnose or treat a medical condition or tell you to stop prescribed therapy. For a medical concern, use your clinician's guidance; for comfort, I can help you test which position and mattress feel best.`;
    default:
      break;
  }

  if (["price_quote", "price_value", "bundle_quote", "savings_quote", "cart_add"].includes(plan.taskType)) {
    if (!quote?.ok) {
      if (quote?.compatibility?.status === "incompatible") {
        return `${recoveryPrefix}That configuration is not compatible. Split motion needs the dual-comfort mattress. I can price Standard Motion with ${activeTitle}, or price the split setup with the dual-comfort mattress.`;
      }
      if (quote?.missing?.includes("size")) return "What size should I price?";
      const unresolved = (quote?.missing || [])
        .filter((item) => item.startsWith("variant:"))
        .map((item) => titleFor(item.slice("variant:".length)))
        .filter(Boolean);
      return unresolved.length
        ? `${recoveryPrefix}I could not match the exact ${unresolved.join(" and ")} configuration, so I will not show a partial or mismatched total. Your ${quote?.size || plan?.knownFacts?.size || "selected"} size is already saved; the full setup remains open while that line is resolved.`
        : `${recoveryPrefix}I cannot confirm every exact item and price in the ${activeTitle} setup right now, so I will not give you a partial or mismatched total.`;
    }
    const lines = quote.items.map((item) => `${item.title}: ${formatMoney(item.price, item.currencyCode)}`);
    if (plan.taskType === "savings_quote") {
      const baseItem = quote.items.find((item) => item.handle === quote.baseHandle);
      return baseItem
        ? `You would save ${formatMoney(baseItem.price, baseItem.currencyCode)} by skipping the adjustable base. The mattress-only total would be ${formatMoney(quote.subtotal - baseItem.price, quote.currencyCode)} before taxes, delivery, or active discounts.`
        : `The current quote is already mattress-only at ${formatMoney(quote.subtotal, quote.currencyCode)} before taxes, delivery, or active discounts.`;
    }
    if (quote.items.length === 1) {
      return `${recoveryPrefix}The ${quote.size} ${quote.items[0].title} is ${formatMoney(quote.subtotal, quote.currencyCode)} before taxes, delivery, or active discounts.`;
    }
    return `${recoveryPrefix}That ${quote.size} configuration works together. The complete setup is ${formatMoney(quote.subtotal, quote.currencyCode)} before taxes, delivery, or active discounts. ${lines.join("; ")}.`;
  }

  return "";
}

function buildContextualChips({ plan = {}, quote = null } = {}) {
  if (["shopper_feedback", "trust_recovery"].includes(plan.taskType)) {
    return [
      { label: "Find a softer alternative", value: "Yes", type: "prompt" },
      { label: "Not now", value: "No", type: "prompt" },
    ];
  }
  if (plan.taskType === "alternative_resolution") {
    return [
      { label: "Compare eligible options", value: "Compare the eligible alternatives for me.", type: "prompt" },
      { label: "Help me test it", value: "What should I notice when I try that one?", type: "prompt" },
    ];
  }
  if (["commitment_declined", "commitment_resolution", "reconsider_product"].includes(plan.taskType)) return [];
  if (["session_recommendation_recall", "recommendation_explanation"].includes(plan.taskType)) {
    return [
      { label: "Help me test it", value: "What should I notice when I try that one?", type: "prompt" },
      { label: "Choose this mattress", value: "That works. Let's go with that one.", type: "prompt" },
    ];
  }
  if (plan.taskType === "recommendation_acceptance") {
    return [
      { label: "Price mattress only", value: "What is the mattress-only price?", type: "prompt" },
      { label: "Compare with motion", value: "What about with the motion base?", type: "prompt" },
    ];
  }
  if (plan.taskType === "value_objection") {
    return [
      { label: "Show lower-cost setup", value: "Show me the less expensive configuration.", type: "prompt" },
      { label: "Mattress only", value: "What would the mattress cost without the base?", type: "prompt" },
    ];
  }
  if (["price_quote", "bundle_quote", "savings_quote", "cart_add"].includes(plan.taskType) && !quote?.ok) {
    if (quote?.compatibility?.status === "incompatible") {
      return [
        { label: "Price Standard Motion", value: "Price the compatible Standard Motion setup instead.", type: "prompt" },
        { label: "Compare Split Option", value: "Show me the mattress that supports this split setup.", type: "prompt" },
      ];
    }
    if (quote?.missing?.includes("size")) {
      return [{ label: "Choose a size", value: "Help me choose the right size.", type: "prompt" }];
    }
    return [{ label: "Try the full setup again", value: "Try resolving my complete setup again.", type: "prompt" }];
  }
  if (["price_quote", "bundle_quote", "savings_quote"].includes(plan.taskType) && quote?.ok) {
    return quote.items.length > 1
      ? [
          { label: "Mattress only", value: "What would the mattress cost without the base?", type: "prompt" },
          { label: "Save without base", value: "How much would I save if I skip the base?", type: "prompt" },
          { label: "Add full setup", value: "Add this complete setup to my cart.", type: "prompt" },
        ]
      : [
          { label: "Add Standard Motion", value: "What would it cost with Standard Motion?", type: "prompt" },
          { label: "Compare comfort", value: "How does it compare to the 14-inch Hybrid?", type: "prompt" },
        ];
  }
  if (plan.taskType === "compatibility") {
    return [{ label: "Price this setup", value: "What would this full setup cost?", type: "prompt" }];
  }
  if (["product_comparison", "canonical_comparison", "comparison_value", "firmness_choice", "advisor_choice", "product_experience"].includes(plan.taskType)) {
    return [
      { label: "Price my recommendation", value: "What would the King version of your recommendation cost?", type: "prompt" },
      { label: "Help me test it", value: "What should I pay attention to when I try it?", type: "prompt" },
    ];
  }
  if (["base_education", "value_judgment", "price_value", "configuration_value", "preference_capture"].includes(plan.taskType)) {
    return [
      { label: "Price with motion", value: "What would it cost with Standard Motion?", type: "prompt" },
      { label: "Mattress only", value: "What would the mattress cost without the base?", type: "prompt" },
    ];
  }
  if (["compound_product_base", "configuration_update", "confusion_recovery"].includes(plan.taskType)) {
    return [
      { label: "Price mattress only", value: "Show me the mattress-only price.", type: "prompt" },
      { label: "Compare with motion", value: "Compare mattress-only with Standard Motion.", type: "prompt" },
    ];
  }
  if (["durability_objection", "hybrid_exploration"].includes(plan.taskType)) {
    return [
      { label: "Compare hybrids", value: "Compare the Dual Comfort and 14-inch Hybrid for me.", type: "prompt" },
      { label: "Help me test them", value: "What should I notice when I compare them?", type: "prompt" },
    ];
  }
  if (plan.taskType === "warranty_explanation") {
    return [{ label: "Review return policy", value: "What is your return policy?", type: "prompt" }];
  }
  if (["canonical_recommendation", "canonical_recall", "firmness_compare", "preference_recall"].includes(plan.taskType)) {
    return [
      { label: "Compare my options", value: "Compare my recommendation to the next best option.", type: "prompt" },
      { label: "Price my setup", value: "What would the King version of your recommendation cost?", type: "prompt" },
    ];
  }
  if (plan.taskType === "medical_boundary") {
    return [
      { label: "Compare comfort", value: "Help me compare general comfort and support.", type: "prompt" },
      { label: "Talk to a human", value: "Talk to a human", type: "prompt" },
    ];
  }
  return [];
}

function buildSpeech(reply = "") {
  const sentences = completeSentences(reply);
  return clean(sentences.slice(0, 2).join(" "));
}

function adaptResponseDepth(reply = "", depth = "standard") {
  const complete = clean(reply);
  if (depth !== "quick") return complete;
  const firstSentence = complete.match(/^[\s\S]*?[.!?](?:\s|$)/)?.[0];
  return clean(firstSentence || complete);
}

function responseFacetViolations({ reply = "", plan = {}, factPack = null } = {}) {
  const violations = [];
  const lower = clean(reply).toLowerCase();
  const compared = unique(plan?.references?.comparisonProductHandles || []).slice(0, 2);
  const mentionsComparedProducts = compared.length < 2 || compared.every((handle) => {
    const title = titleFor(handle).toLowerCase();
    return lower.includes(title) || lower.includes(title.replace(/\s+mattress$/i, ""));
  });
  if (["product_comparison", "canonical_comparison", "comparison_value"].includes(plan.taskType)) {
    if (!mentionsComparedProducts || !/\b(?:while|whereas|compared|difference|more|less|both|original|current)\b/.test(lower)) {
      violations.push("comparison_incomplete");
    }
  }
  if (plan.taskType === "comparison_value" && !/\b(?:worth|value|pay|spend|save|cost)\b/.test(lower)) {
    violations.push("compound_value_unanswered");
  }
  if (plan.taskType === "price_value") {
    if (!/\b(?:worth|value|pay|spend|save)\b/.test(lower)) violations.push("compound_value_unanswered");
    if (!/\$|\b(?:price|cost|costs|priced)\b/.test(lower)) violations.push("compound_price_unanswered");
  }
  if (plan.taskType === "firmness_choice") {
    if (!/\b(?:soft|firm|contour|plush|sink|lifted)\b/.test(lower)) violations.push("compound_feel_unanswered");
    if (!/\b(?:pick|choose|recommend|favor|favour|would)\b/.test(lower)) violations.push("compound_choice_unanswered");
  }
  if (
    plan.taskType === "firmness_compare" &&
    /^(?:yes|true|1)$/i.test(clean(factPack?.shopper?.sleepPartner))
  ) {
    if (!/\b(?:different firmness|own feel|each side|individual comfort)\b/.test(lower)) {
      violations.push("couple_firmness_unanswered");
    }
    if (!/\b(?:motion|movement|move independently|separate elevation)\b/.test(lower)) {
      violations.push("couple_motion_tradeoff_unanswered");
    }
  }
  if (plan.taskType === "recommendation_explanation" && !/\b(?:because|since|based on|fits?|matches?)\b/.test(lower)) {
    violations.push("recommendation_explanation_incomplete");
  }
  const requestedScope = clean(factPack?.state?.activeConfiguration?.scope || plan?.commercialState?.requestedScope).toLowerCase();
  if (requestedScope === "mattress_only" && /\badd (?:the )?(?:full|complete) setup\b/.test(lower)) {
    violations.push("response_scope_mismatch");
  }
  return violations;
}

function validateResponseConsistency({
  reply = "",
  quote = null,
  products = [],
  actions = [],
  plan = {},
  factPack = null,
  requireCompleteCommerce = true,
} = {}) {
  const violations = [];
  const lower = clean(reply).toLowerCase();
  const rejected = new Set(
    (Array.isArray(factPack?.feedback?.explicitExclusions) ? factPack.feedback.explicitExclusions : plan?.references?.rejectedProductHandles || [])
      .map((handle) => clean(handle).toLowerCase())
      .filter(Boolean)
  );
  for (const product of products) {
    const handle = clean(product?.handle).toLowerCase();
    if (handle && rejected.has(handle)) violations.push(`rejected_product_card:${handle}`);
  }
  for (const action of actions) {
    const handle = clean(action?.payload?.handle || action?.handle).toLowerCase();
    if (handle && rejected.has(handle)) violations.push(`rejected_product_action:${handle}`);
  }
  const sessionRecommendationHandle = clean(factPack?.recommendation?.current).toLowerCase();
  if (sessionRecommendationHandle && rejected.has(sessionRecommendationHandle)) {
    violations.push(`rejected_session_recommendation:${sessionRecommendationHandle}`);
  }
  const recommendationCue = /\b(?:recommend|suggest|choose|go with|start with|best option|good match|great fit|current choice|active choice)\b/;
  const exclusionCue = /\b(?:original recommendation|ruled out|off (?:the|your) list|do not recommend|don.t recommend|will not recommend|not recommending|instead of|anything but|except|rejected|didn.t like|did not like|too firm|too soft)\b/;
  const replySentences = clean(reply).toLowerCase().match(/[^.!?]+[.!?]?/g) || [];
  for (const handle of rejected) {
    const productTitle = titleFor(handle).toLowerCase();
    const productStem = productTitle.replace(/\s+mattress$/i, "");
    const positivelyReintroduced = replySentences.some((sentence) =>
      (sentence.includes(productTitle) || sentence.includes(productStem)) &&
      recommendationCue.test(sentence) &&
      !exclusionCue.test(sentence)
    );
    if (positivelyReintroduced) violations.push(`rejected_product_recommendation:${handle}`);
  }
  if (!plan.technicalLanguageAllowed) {
    for (const phrase of INTERNAL_LANGUAGE) {
      if (includesProtectedLanguage(lower, phrase)) violations.push(`internal_language:${phrase}`);
    }
  }
  if (reply && !isCompleteShopperResponse(reply)) violations.push("incomplete_ending");
  if (clean(reply).endsWith("...")) violations.push("truncated_ending");
  if (/(?:^|\n)\s*(?:[-*+]\s*)?$/.test(String(reply || "")) || /\[[^\]]*$|\([^)]*$/.test(clean(reply))) {
    violations.push("broken_render_fragment");
  }
  if ((clean(reply).match(/\?/g) || []).length > 1) violations.push("too_many_probes");
  if (quote?.ok) {
    const priceAnswer = requireCompleteCommerce && ["price_quote", "price_value", "bundle_quote", "savings_quote", "cart_add"].includes(plan.taskType);
    const mentionedPrices = (clean(reply).match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) || [])
      .map((amount) => Number(amount.replace(/[$,\s]/g, "")))
      .filter(Number.isFinite);
    const mentionsPrice = (value) => mentionedPrices.some((amount) => Math.abs(amount - Number(value)) < 0.005);
    for (const item of quote.items) {
      const card = products.find((product) => product.handle === item.handle);
      if (priceAnswer && (!card || Number(card.price) !== Number(item.price))) violations.push(`price_card_mismatch:${item.handle}`);
      if (priceAnswer && !mentionsPrice(item.price)) {
        violations.push(`price_reply_mismatch:${item.handle}`);
      }
    }
    if (priceAnswer && quote.items.length > 1 && !mentionsPrice(quote.subtotal)) {
      violations.push("subtotal_reply_mismatch");
    }
  }
  if (requireCompleteCommerce && actions.some((action) => action.type === "add_to_cart") && !quote?.cartReady) {
    violations.push("unsafe_cart_action");
  }
  if (requireCompleteCommerce && plan?.protectedReferences?.includes("canonicalRecommendation")) {
    const canonical = plan?.references?.canonicalRecommendation;
    if (canonical && !lower.includes(titleFor(canonical).toLowerCase())) violations.push("canonical_reference_lost");
  }
  const allowedPrices = new Set(
    (quote?.ok ? quote.items.concat([{ price: quote.subtotal, currencyCode: quote.currencyCode }]) : [])
      .map((item) => Number(item.price))
      .filter(Number.isFinite)
  );
  for (const amount of clean(reply).match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) || []) {
    const numericAmount = Number(amount.replace(/[$,\s]/g, ""));
    if (![...allowedPrices].some((allowed) => Math.abs(allowed - numericAmount) < 0.005)) {
      violations.push(`unverified_price:${amount}`);
    }
  }
  const verifiedProducts = Array.isArray(factPack?.products) ? factPack.products : [];
  const permittedTitles = new Set(
    verifiedProducts.map((product) => titleFor(product.handle).toLowerCase()).filter(Boolean)
  );
  const manifest = loadShowroomManifest();
  for (const product of manifest.products || []) {
    const title = titleFor(product.handle).toLowerCase();
    if (title && lower.includes(title) && !permittedTitles.has(title)) {
      violations.push(`unverified_product:${product.handle}`);
    }
  }
  const verifiedSizes = unique([quote?.size || plan?.knownFacts?.size, quote?.setupSize]).map(normalizeSize);
  const mentionedSizes = clean(reply).match(/\b(?:half split queen|half split king|split king|cal king|twin xl|twin|queen|king|full\b(?!\s+(?:setup|quote|configuration)))/gi) || [];
  if (verifiedSizes.length && mentionedSizes.some((size) => {
    const mentioned = normalizeSize(size);
    return !verifiedSizes.some((verified) => mentioned === verified || verified.includes(mentioned) || mentioned.includes(verified));
  })) {
    violations.push("size_mismatch");
  }
  if (quote?.compatibility?.status === "incompatible" && /\b(?:compatible|work together|pair together)\b/.test(lower) && !/\b(?:not|doesn.t|do not|won.t|cannot)\b/.test(lower)) {
    violations.push("compatibility_contradiction");
  }
  if (quote?.motionKey === "standard" && /\b(?:half|full)[ -]split\b/.test(lower)) {
    violations.push("motion_configuration_mismatch");
  }
  const discussedHandles = new Set(unique([
    plan?.references?.activeProductHandle,
    plan?.references?.requestedProductHandle,
    plan?.references?.sessionRecommendationHandle,
    plan?.references?.acceptedRecommendationHandle,
    ...(plan?.references?.comparisonProductHandles || []),
    ...((quote?.items || []).map((item) => item?.handle)),
  ]));
  for (const product of products) {
    const handle = clean(product?.handle).toLowerCase();
    if (handle && discussedHandles.size && !discussedHandles.has(handle)) {
      violations.push(`unrelated_product_card:${handle}`);
    }
  }
  for (const action of actions) {
    const handle = clean(action?.payload?.handle || action?.handle).toLowerCase();
    if (handle && discussedHandles.size && !discussedHandles.has(handle)) {
      violations.push(`wrong_product_action:${handle}`);
    }
  }
  if (clean(factPack?.state?.activeConfiguration?.scope).toLowerCase() === "mattress_only") {
    for (const action of actions) {
      const label = normalizeAskSnoozerText(action?.label || action?.type);
      if (/\b(?:full|complete) setup\b/.test(label)) violations.push("action_scope_mismatch");
    }
  }
  violations.push(...responseFacetViolations({ reply, plan, factPack }));
  return { ok: violations.length === 0, violations };
}

async function resolveAskSnoozerAdvisorTurn({
  query = "",
  context = {},
  plan = null,
  fetchProductsByHandles,
  composeAdvisorResponse,
  loadAdvisorKnowledge,
  requestId = null,
} = {}) {
  const resolvedPlan = plan || planAskSnoozerTurn({ query, context });
  resolvedPlan.query = clean(query);
  if (!resolvedPlan.handled) return null;
  const factPack = buildRelevantFactPack({ query, context, plan: resolvedPlan });
  if (resolvedPlan.needsKnowledge || resolvedPlan.needsPolicy) {
    try {
      const comparisonHandles = ["product_comparison", "canonical_comparison", "comparison_value", "firmness_choice", "firmness_compare", "advisor_choice", "durability_objection", "hybrid_exploration"]
        .includes(resolvedPlan.taskType)
        ? (resolvedPlan.references?.comparisonProductHandles || [])
        : [];
      const requestedHandle = resolvedPlan.references?.requestedProductHandle;
      const knowledge = await loadAdvisorKnowledge?.({
        productHandles: unique([
          requestedHandle || resolvedPlan.references?.activeProductHandle,
          ...comparisonHandles,
        ]),
        taskType: resolvedPlan.taskType,
        query,
      });
      if (knowledge) {
        factPack.advisorKnowledge = knowledge;
        factPack.productFacts = knowledge.productFacts || [];
        factPack.policyFacts = knowledge.policyFacts || [];
      }
    } catch {
      factPack.missingInformation = [...new Set([...(factPack.missingInformation || []), "advisorKnowledge"])];
    }
  }
  let quote = null;
  let rawProducts = [];
  if (resolvedPlan.taskType === "value_objection" && activeDeal(context)?.activeQuote?.ok) {
    quote = activeDeal(context).activeQuote;
    rawProducts = await fetchByHandles(fetchProductsByHandles, quote.items.map((item) => item.handle));
  } else if (resolvedPlan.needsCommerce || resolvedPlan.taskType === "compatibility") {
    quote = await buildQuote({ plan: resolvedPlan, context, fetchProductsByHandles });
    if (quote?.items?.length) {
      rawProducts = await fetchByHandles(fetchProductsByHandles, quote.items.map((item) => item.handle));
    }
  } else if (["canonical_recommendation", "canonical_recall"].includes(resolvedPlan.taskType)) {
    const canonicalHandle = resolveCanonicalHandle(context);
    rawProducts = rejectedHandles(context).has(canonicalHandle)
      ? []
      : await fetchByHandles(fetchProductsByHandles, [canonicalHandle]);
  } else if ([
    "product_comparison",
    "canonical_comparison",
    "comparison_value",
    "firmness_choice",
    "firmness_compare",
    "advisor_choice",
  ].includes(resolvedPlan.taskType)) {
    rawProducts = await fetchByHandles(fetchProductsByHandles, unique([
      resolvedPlan.references?.requestedProductHandle,
      resolvedPlan.references?.activeProductHandle,
      ...(resolvedPlan.references?.comparisonProductHandles || []),
    ]));
  } else if (
    resolvedPlan.taskType === "sleep_education" &&
    /\b(?:which|what) mattress\b|\bmattress (?:fits?|matches?)\b/.test(normalizeAskSnoozerText(query))
  ) {
    rawProducts = await fetchByHandles(fetchProductsByHandles, [
      resolvedPlan.references?.activeProductHandle || resolveCanonicalHandle(context),
    ]);
  } else if (["alternative_resolution", "reconsider_product", "session_recommendation_recall", "recommendation_explanation", "recommendation_acceptance"].includes(resolvedPlan.taskType)) {
    rawProducts = await fetchByHandles(fetchProductsByHandles, [
      clean(activeDeal(context)?.acceptedRecommendation?.productHandle) || activeSessionRecommendationHandle(context) || resolveActiveHandle(context),
    ]);
  }
  const rejected = rejectedHandles(context);
  rawProducts = rawProducts.filter((product) => !rejected.has(clean(product?.handle).toLowerCase()));
  const byHandle = new Map(rawProducts.map((product) => [clean(product.handle).toLowerCase(), product]));
  const fullSetupRequested = Boolean(
    resolvedPlan.taskType === "bundle_quote" ||
    ["mattress_plus_base", "full_pod"].includes(clean(resolvedPlan.commercialState?.requestedScope))
  );
  const suppressPartialProducts = Boolean(fullSetupRequested && !quote?.ok);
  const products = resolvedPlan.taskType === "value_objection"
    ? []
    : suppressPartialProducts
    ? []
    : quote?.items?.length
      ? quote.items.map((item) => quoteProductCard(item, byHandle.get(item.handle) || {}, {
          suppressAddToCart: fullSetupRequested && resolvedPlan.taskType !== "cart_add",
        }))
      : rawProducts;
  factPack.commerce = quote || factPack.commerce;
  factPack.compatibility = quote?.compatibility || factPack.compatibility;
  const composedBaseHandle = quote?.baseHandle || (resolvedPlan.taskType === "compatibility" ? "premium-motion-adjustable-base" : null);
  if (composedBaseHandle && !factPack.products.some((product) => product.handle === composedBaseHandle)) {
    const baseProduct = (loadShowroomManifest().products || []).find((product) => product.handle === composedBaseHandle);
    if (baseProduct) factPack.products.push({
      handle: clean(baseProduct.handle),
      title: clean(baseProduct.title),
      catalogType: clean(baseProduct.catalogType),
      family: clean(baseProduct.family),
      active: baseProduct.active !== false,
      recommendable: baseProduct.recommendable !== false,
      attributes: isObject(baseProduct.attributes) ? baseProduct.attributes : {},
    });
  }
  factPack.budget = {
    totalChars: JSON.stringify(factPack).length,
    productChars: JSON.stringify(factPack.products || []).length,
    historyChars: JSON.stringify(factPack.conversation?.recentTurns || []).length,
    advisorChars: JSON.stringify(factPack.advisorKnowledge || factPack.productFacts || []).length,
    policyChars: JSON.stringify(factPack.policyFacts || []).length,
  };
  const deterministicReply = adaptResponseDepth(
    shopperFriendlyResponse({ query, plan: resolvedPlan, context, quote }),
    resolvedPlan.responseDepth
  );
  const explicitAdd = resolvedPlan.taskType === "cart_add";
  const actions = explicitAdd && quote?.cartReady
    ? quote.items.map(buildAddAction).filter(Boolean)
    : [];
  const chips = buildContextualChips({ plan: resolvedPlan, quote });
  factPack.allowedActions = [
    ...actions.map((action) => clean(action.type)),
    ...chips.map((chip) => clean(chip.label)),
  ].filter(Boolean);
  const deterministicGate = validateResponseConsistency({
    reply: deterministicReply,
    quote,
    products,
    actions,
    plan: resolvedPlan,
    factPack,
  });
  let reply = deterministicReply;
  let speech = buildSpeech(deterministicReply);
  let compositionMode = "deterministic";
  let modelCallCount = 0;
  let modelMs = 0;
  let model = null;
  let compositionFallbackUsed = false;
  let modelGate = null;
  let probe = null;
  let nextActionIntent = null;
  let compositionConfidence = null;
  let modelInputChars = 0;
  let modelSystemChars = 0;
  let modelFactPackChars = 0;
  let fallbackKind = null;
  if (deterministicGate.ok && resolvedPlan.needsModel && typeof composeAdvisorResponse === "function") {
    const modelStartedAt = Date.now();
    modelCallCount = 1;
    try {
      const composed = await composeAdvisorResponse({
        requestId,
        userMessage: query,
        strategy: resolvedPlan,
        factPack,
        deterministicDraft: {
          displayText: deterministicReply,
          speechText: buildSpeech(deterministicReply),
        },
      });
      modelMs = Date.now() - modelStartedAt;
      model = composed?.model || null;
      modelInputChars = Number(composed?.inputChars || 0) || 0;
      modelSystemChars = Number(composed?.systemChars || 0) || 0;
      modelFactPackChars = Number(composed?.factPackChars || factPack?.budget?.totalChars || 0) || 0;
      modelGate = validateResponseConsistency({
        reply: composed?.displayText,
        quote,
        products,
        actions,
        plan: resolvedPlan,
        factPack,
      });
      let composedSpeech = clean(composed?.speechText);
      let speechGate = validateResponseConsistency({
        reply: composedSpeech,
        quote,
        products,
        actions: [],
        plan: resolvedPlan,
        factPack,
        requireCompleteCommerce: false,
      });
      // Voice is a concise rendering of the accepted display answer. If the
      // model's optional spoken summary drops a required facet, derive a
      // sentence-complete summary from the grounded display answer before
      // rejecting the entire shopper response.
      if (modelGate.ok && !speechGate.ok) {
        const groundedSpeech = buildSpeech(composed?.displayText);
        const groundedSpeechGate = validateResponseConsistency({
          reply: groundedSpeech,
          quote,
          products,
          actions: [],
          plan: resolvedPlan,
          factPack,
          requireCompleteCommerce: false,
        });
        if (groundedSpeechGate.ok) {
          composedSpeech = groundedSpeech;
          speechGate = groundedSpeechGate;
        }
      }
      if (!modelGate.ok || !speechGate.ok) {
        modelGate = { ok: false, violations: [...modelGate.violations, ...speechGate.violations.map((item) => `speech:${item}`)] };
        compositionFallbackUsed = true;
        compositionMode = "model_fallback";
        fallbackKind = "validation";
      } else {
        reply = clean(composed.displayText);
        speech = composedSpeech;
        probe = clean(composed.probe) || null;
        compositionConfidence = Number.isFinite(Number(composed.confidence))
          ? Math.max(0, Math.min(1, Number(composed.confidence)))
          : null;
        const proposedAction = clean(composed.nextActionIntent);
        const allowedActionValues = new Set([
          ...actions.flatMap((action) => [action.type, action.label]),
          ...chips.flatMap((chip) => [chip.label, chip.value]),
        ].map((value) => normalizeAskSnoozerText(value)).filter(Boolean));
        nextActionIntent = allowedActionValues.has(normalizeAskSnoozerText(proposedAction))
          ? proposedAction
          : null;
        compositionMode = "model_assisted";
      }
    } catch (error) {
      modelMs = Date.now() - modelStartedAt;
      compositionFallbackUsed = true;
      compositionMode = "model_fallback";
      fallbackKind = Number(error?.status || error?.statusCode) === 429 || /\b(?:429|rate.?limit|tokens per min|tpm)\b/i.test(clean(error?.code || error?.message))
        ? "rate_limit"
        : clean(error?.code) === "E_ADVISOR_COMPOSER_PROBE" || clean(error?.code) === "E_ADVISOR_COMPOSER_CONTRACT"
          ? "validation"
          : "composer_error";
      modelGate = { ok: false, violations: [`composer_error:${clean(error?.code || error?.message || "unknown")}`] };
    }
  }
  const gate = deterministicGate.ok
    ? (compositionMode === "model_assisted" ? modelGate : deterministicGate)
    : deterministicGate;
  if (!gate.ok) {
    return {
      ok: false,
      reply: "I found a conflict in the product details for that answer, so I stopped before showing a price or cart action. Please try that question again.",
      speech: "I found a conflict in the product details, so I stopped before showing a price.",
      products: [],
      actions: [],
      chips: [],
      plan: resolvedPlan,
      factPack,
      quote: null,
      gate,
      fallbackUsed: true,
      source: "consistency_gate",
      compositionMode,
      modelCallCount,
      modelMs,
      model,
      compositionFallbackUsed,
      modelGate,
      probe,
      nextActionIntent,
      compositionConfidence,
      modelInputChars,
      modelSystemChars,
      modelFactPackChars,
      fallbackKind,
      responsePath: "grounded_safe_fallback",
    };
  }
  const responsePath = compositionMode === "model_assisted"
    ? "structured_composer"
    : compositionMode === "model_fallback"
      ? "grounded_safe_fallback"
      : "atomic_deterministic";
  return {
    ok: true,
    reply,
    speech,
    products,
    actions,
    chips,
    plan: resolvedPlan,
    factPack,
    quote,
    gate,
    fallbackUsed: compositionFallbackUsed,
    source: quote
      ? "shopify"
      : factPack.policyFacts?.length
        ? "s3_policy"
        : factPack.productFacts?.length
          ? "s3_product"
          : "advisor",
    compositionMode,
    modelCallCount,
    modelMs,
    model,
    compositionFallbackUsed,
    modelGate,
    probe,
    nextActionIntent,
    compositionConfidence,
    modelInputChars,
    modelSystemChars,
    modelFactPackChars,
    fallbackKind,
    responsePath,
  };
}

module.exports = {
  INTERNAL_LANGUAGE,
  ORCHESTRATOR_VERSION,
  buildQuote,
  buildRelevantFactPack,
  planAskSnoozerTurn,
  resolveProtectedReference,
  resolveAskSnoozerAdvisorTurn,
  resolveExactVariant,
  validateResponseConsistency,
};
