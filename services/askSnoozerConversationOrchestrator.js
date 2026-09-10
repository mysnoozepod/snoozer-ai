const { loadShowroomManifest } = require("./showroomManifest");
const {
  normalizeAskSnoozerText,
  parseAskSnoozerSizeLabel,
} = require("./askSnoozerIntents");
const {
  resolveExplicitBaseSelection,
  resolveExplicitProductHandle,
} = require("./askSnoozerWorkingMemory");

const ORCHESTRATOR_VERSION = "2026-09-09.1";
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
]);

function clean(value) {
  return String(value == null ? "" : value).trim();
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

function resolveExactVariant(product = {}, { size = "", motionKey = "" } = {}) {
  const variants = (Array.isArray(product?.variants) ? product.variants : []).filter(
    (variant) => variantAvailable(variant) && PRODUCT_VARIANT_GID.test(clean(variant?.id))
  );
  let matches = size ? variants.filter((variant) => variantMatchesSize(variant, size)) : variants;
  if (motionKey && motionKey !== "none") {
    const motionMatches = matches.filter((variant) => variantMatchesMotion(variant, motionKey));
    if (motionMatches.length) matches = motionMatches;
  }
  return matches.length === 1 ? matches[0] : null;
}

function buildQuoteProduct(product = {}, { size = "", motionKey = "" } = {}) {
  const variant = resolveExactVariant(product, { size, motionKey });
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

function quoteProductCard(entry = {}, rawProduct = {}) {
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
  };
}

function activeMemory(context = {}) {
  return isObject(context?.askSnoozerWorkingMemory) ? context.askSnoozerWorkingMemory : {};
}

function activeDeal(context = {}) {
  return isObject(activeMemory(context)?.activeDeal) ? activeMemory(context).activeDeal : {};
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
  return clean(
    activeDeal(context)?.activeProductHandle ||
      activeDeal(context)?.recentProductHandle ||
      resolveCanonicalHandle(context)
  ).toLowerCase();
}

function resolveComparisonHandles(query = "", context = {}) {
  const explicit = resolveExplicitProductHandle(query);
  const deal = activeDeal(context);
  const existing = Array.isArray(deal.comparisonProductHandles) ? deal.comparisonProductHandles : [];
  const active = resolveActiveHandle(context);
  const canonical = resolveCanonicalHandle(context);
  const resolved = unique(existing.concat(active, explicit, canonical));
  if (/\b(?:compare|compares|comparison|versus|\bvs\b)\b/.test(normalizeAskSnoozerText(query)) && resolved.length === 1) {
    resolved.push(resolved[0] === "14-hybrid" ? "12-all-foam-mattress" : "14-hybrid");
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
  const quoteHandles = Array.isArray(deal.activeQuote?.items)
    ? deal.activeQuote.items.map((item) => clean(item?.handle).toLowerCase()).filter(Boolean)
    : [];
  let phrase = null;
  let handle = null;
  let source = null;
  if (/\b(?:your recommendation|mattress you (?:showed|recommended)|original recommendation)\b/.test(text)) {
    phrase = "your recommendation";
    handle = canonical;
    source = "canonical_recommendation";
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
  } else if (/\b(?:that one|this one)\b/.test(text)) {
    phrase = "that one";
    handle = active || comparison[0] || canonical;
    source = "active_product";
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
  if (taskType === "product_comparison" || /\b(?:compare|versus|\bvs\b)\b/.test(text)) return "compare";
  if (/\b(?:why would|what does|how does|explain|notice)\b/.test(text)) return "teach";
  if (/\b(?:would you|which one|what should i|for me)\b/.test(text)) return "coach";
  return "standard";
}

function inferStage(taskType = "", previous = "exploring") {
  if (["cart_add", "cart_review"].includes(taskType)) return "ready";
  if (["price_quote", "bundle_quote", "compatibility"].includes(taskType)) return "configuring";
  if (["value_judgment", "savings_quote", "advisor_opinion"].includes(taskType)) return "evaluating_value";
  if (["product_comparison", "firmness_compare", "advisor_choice"].includes(taskType)) return "comparing";
  if (["canonical_recommendation", "canonical_recall", "product_experience"].includes(taskType)) return "narrowing";
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
    ["collecting_slots", "ready", "completed"].includes(clean(workingGoal?.status));
  const explicitHandle = resolveExplicitProductHandle(query);
  const explicitBase = resolveExplicitBaseSelection(query);
  const parsedSize = parseAskSnoozerSizeLabel(query);
  const size =
    parsedSize === "Full" && /\b(?:full|complete|whole) setup\b/.test(text)
      ? clean(deal.activeSize)
      : parsedSize || clean(deal.activeSize);
  const canonicalReference = /\b(?:your recommendation|originally recommend|original recommendation|recommend for me again|what did you recommend|remind me what you.*recommend(?:ed|ation)?)\b/.test(text);
  const continuation = Boolean(
    activeHandle &&
      (/\b(?:it|that|this|one|setup|with|and what|which one|your recommendation)\b/.test(text) || deal.currentTopic)
  );
  let taskType = "legacy";

  if (/^(?:please )?(?:add|put)\b/.test(text) || /\b(?:add|put)\b.*\b(?:to|in) (?:my|the) cart\b/.test(text)) taskType = "cart_add";
  else if (/\b(?:what(?:'s| is) in|show|review|check)\b.*\bcart\b/.test(text)) taskType = "cart_review";
  else if (canonicalReference && /\b(?:cost|price|how much)\b/.test(text)) taskType = "price_quote";
  else if (canonicalReference) taskType = "canonical_recall";
  else if (/\b(?:based on|from) my (?:sleep )?profile\b|\bwhat (?:mattress|would) .*try first\b/.test(text)) taskType = "canonical_recommendation";
  else if (
    continuingPriceGoal &&
    text.split(/\s+/).filter(Boolean).length <= 4 &&
    (explicitHandle || Object.keys(explicitBase).length)
  ) taskType = "bundle_quote";
  else if (/\b(?:how much.*save|save.*how much|savings|difference in price)\b/.test(text)) taskType = "savings_quote";
  else if (/\b(?:how much|what would .*cost|price|pricing|quote)\b/.test(text) && /\b(?:with|plus|and)\b.*\b(?:motion|base)\b/.test(text)) taskType = "bundle_quote";
  else if (/\b(?:how much|what would .*cost|price|pricing|quote)\b/.test(text) && /\b(?:full setup|whole setup|complete setup)\b/.test(text)) taskType = "bundle_quote";
  else if (/\b(?:how much|what would .*cost|price|pricing|quote)\b/.test(text) && (deal.activeBaseHandle || deal.activeQuote?.items?.length > 1) && !/\b(?:mattress only|without (?:the )?base|skip (?:the )?base)\b/.test(text)) taskType = "bundle_quote";
  else if (/\b(?:how much|what would .*cost|price|pricing|quote)\b/.test(text)) taskType = "price_quote";
  else if (/\b(?:make sense together|work together|work with|compatible|compatibility|pair together)\b/.test(text)) taskType = "compatibility";
  else if (/\b(?:need the adjustable|need (?:that|the) base|save the money|didn.t notice.*base|more expensive.*better)\b/.test(text)) taskType = "value_judgment";
  else if (/\b(?:what does|what is|explain|why would i want|why)\b.*\b(?:standard motion|adjustable base|motion base)\b|\bwhy would i want it\b/.test(text)) taskType = "base_education";
  else if (/\b(?:liked|prefer|want)\b.*\b(?:elevation|elevated|raised|head up|feet up|medium|soft|firm)\b/.test(text)) taskType = "preference_capture";
  else if (/\b(?:what did i say i liked|what do i prefer|remember what i liked|recall my preference)\b/.test(text)) taskType = "preference_recall";
  else if (/\b(?:medium|soft|firm)\b.*\b(?:vs|versus|or|compare)\b/.test(text)) taskType = "firmness_compare";
  else if (/\b(?:which one (?:would you|you would) choose|what would you choose|would you buy|what would you do)\b/.test(text)) taskType = "advisor_choice";
  else if (/\b(?:compare|compares|compared|comparison|versus|\bvs\b)\b/.test(text)) taskType = "product_comparison";
  else if (/\b(?:tell me more|actually going to notice|what (?:will i|i will) notice|feel when|lie on)\b/.test(text)) taskType = "product_experience";
  else if (isExplicitMedical(text)) taskType = "medical_boundary";

  const quoteReferenceHandle = canonicalReference
    ? canonicalHandle
    : referenceResolution.handle || explicitHandle || activeHandle || canonicalHandle;
  const comparisonHandles = resolveComparisonHandles(query, referenceContext);
  const needsCommerce = ["price_quote", "bundle_quote", "savings_quote", "cart_add"].includes(taskType);
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
    ["product_experience", "product_comparison", "advisor_choice", "firmness_compare"].includes(taskType) &&
    !activeHandle &&
    !explicitHandle;
  // Keep established deterministic commerce handling for a fresh, standalone
  // catalog question. The advisor owns canonical-reference requests and true
  // multi-turn continuation, where commercial memory and judgment matter.
  const freshStandaloneCommerce =
    needsCommerce &&
    Number(activeMemory(context)?.turnIndex || 0) <= 1 &&
    !canonicalReference;
  const handled =
    taskType !== "legacy" &&
    taskType !== "cart_review" &&
    !ambiguousSetupPrice &&
    !missingCanonical &&
    !missingProductReference &&
    !freshStandaloneCommerce;
  const stage = inferStage(taskType, deal.stage);
  const depth = responseDepth(text, taskType);
  const flexibleLanguageCue = /\b(?:deep|in detail|walk me through|talk me through|i(?:'m| am) torn|help me understand|in your own words|why does that matter|convince me)\b/.test(text);
  const modelEligible = [
    "product_experience",
    "product_comparison",
    "base_education",
    "value_judgment",
    "advisor_choice",
    "firmness_compare",
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
      resolution: referenceResolution,
    },
    protectedReferences: [...new Set([
      canonicalReference ? "canonicalRecommendation" : "",
      referenceResolution.resolved ? referenceResolution.source : "",
    ].filter(Boolean))],
    knownFacts: {
      size: size || null,
      baseHandle: Object.prototype.hasOwnProperty.call(explicitBase, "baseHandle")
        ? explicitBase.baseHandle
        : deal.activeBaseHandle || null,
      motionKey: explicitBase.motionKey || deal.activeMotionKey || null,
      painPoints: activeMemory(context)?.slots?.painPoints?.value || [],
    },
    neededFacts: needsCommerce && !size ? ["size"] : [],
    requiredSources: unique([
      canonicalHandle ? "profile" : "",
      needsCommerce ? "commerce" : "",
      needsCompatibility ? "compatibility" : "",
    ]),
    answerMode: taskType,
    responseDepth: depth,
    needsModel: handled && modelEligible && flexibleLanguageCue,
    needsCommerce,
    needsCompatibility,
    needsKnowledge: ["product_experience", "product_comparison", "base_education"].includes(taskType),
    needsPolicy: taskType === "medical_boundary",
    allowedActions: taskType === "cart_add" ? ["add_to_cart"] : [],
    probe: null,
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
  const handles = unique([
    plan?.references?.canonicalRecommendation,
    plan?.references?.activeProductHandle,
    ...(plan?.references?.comparisonProductHandles || []),
    plan?.knownFacts?.baseHandle,
  ]);
  const products = handles.map((handle) => byHandle.get(handle)).filter(Boolean);
  const conversationContext = {
    stage: plan.stage || "exploring",
    taskType: plan.taskType,
    continuationOf: plan.continuationOf || null,
    responseDepth: plan.responseDepth,
    activeGoal: activeMemory(context)?.activeGoal?.intent || null,
    preference: activeDeal(context)?.decision || null,
    referenceResolution: plan?.references?.resolution || null,
  };
  const verifiedCommercialFacts = {
    canonicalRecommendation: context?.canonicalRecommendation || null,
    products,
    quote: activeDeal(context)?.activeQuote || null,
    compatibility: activeDeal(context)?.compatibilityStatus || "unknown",
    cart: context?.cartSummary || null,
    rewards: context?.rewards || null,
  };
  return {
    shopper: {
      size: plan?.knownFacts?.size || null,
      firmness: activeMemory(context)?.slots?.firmness?.value || null,
      painPoints: plan?.knownFacts?.painPoints || [],
      sleepPosition:
        context?.canonicalRecommendation?.normalizedAssessment?.sleepPosition ||
        context?.assessment?.answers?.sleepPosition ||
        null,
    },
    canonicalRecommendation: context?.canonicalRecommendation || null,
    products,
    comparison: plan?.references?.comparisonProductHandles || [],
    commerce: activeDeal(context)?.activeQuote || null,
    compatibility: activeDeal(context)?.compatibilityStatus || "unknown",
    policy: plan.medicalBoundary ? "general_comfort_only" : null,
    rewards: context?.rewards || null,
    cart: context?.cartSummary || null,
    unresolved: plan.neededFacts || [],
    prohibited: plan.technicalLanguageAllowed ? [] : INTERNAL_LANGUAGE,
    query: clean(query),
    verifiedCommercialFacts,
    conversationContext,
    permittedJudgment: {
      compareVerifiedProducts: ["product_comparison", "firmness_compare", "advisor_choice"].includes(plan.taskType),
      recommendLowerCost: ["value_judgment", "advisor_choice"].includes(plan.taskType),
      explainExperience: ["product_experience", "base_education"].includes(plan.taskType),
      introduceCommercialFacts: false,
    },
    missingUnknown: plan.neededFacts || [],
    allowedActions: plan.allowedActions || [],
    resolvedReferences: plan?.references?.resolution || null,
  };
}

async function fetchByHandles(fetchProductsByHandles, handles = []) {
  if (typeof fetchProductsByHandles !== "function") return [];
  const response = await fetchProductsByHandles({ handles: unique(handles), lite: false });
  return Array.isArray(response?.items) ? response.items : [];
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
  const size = clean(plan?.knownFacts?.size || deal.activeSize);
  const productHandle = clean(plan?.references?.requestedProductHandle || resolveCanonicalHandle(context));
  const wantsBundle = ["bundle_quote", "compatibility", "savings_quote"].includes(plan.taskType) ||
    (plan.taskType === "cart_add" && /\b(?:full setup|mattress and base|both)\b/.test(normalizeAskSnoozerText(plan.query)));
  const explicitNoBase = plan?.knownFacts?.baseHandle === null && plan?.knownFacts?.motionKey === "none";
  const baseHandle = wantsBundle && !explicitNoBase
    ? clean(plan?.knownFacts?.baseHandle || deal.activeBaseHandle || "premium-motion-adjustable-base")
    : "";
  const motionKey = baseHandle === "premium-motion-adjustable-base"
    ? clean(plan?.knownFacts?.motionKey || deal.activeMotionKey || "standard")
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
  const mattress = buildQuoteProduct(mattressProduct, { size, motionKey: "none" });
  if (mattress) items.push(mattress);
  if (baseHandle) {
    const baseProduct = byHandle.get(baseHandle);
    const base = buildQuoteProduct(baseProduct, { size, motionKey });
    if (base) items.push(base);
  }
  const missingHandles = handles.filter((handle) => !items.some((item) => item.handle === handle));
  const currencies = unique(items.map((item) => item.currencyCode));
  const ok = !missingHandles.length && items.length === handles.length && currencies.length === 1;
  const subtotal = ok ? items.reduce((sum, item) => sum + item.price, 0) : null;
  return {
    version: "1.0.0",
    ok,
    size,
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

  switch (plan.taskType) {
    case "canonical_recommendation":
    case "canonical_recall":
      return `I would start you with ${canonicalPodName(context)} and the ${titleFor(canonical)}. For a side sleeper focused on shoulder and hip comfort, its closer contour is the better first test. Lie on your side for several quiet minutes and notice whether those pressure points relax without your midsection sinking too far.`;
    case "product_experience":
      if (active === "14-hybrid") {
        return `On the ${activeTitle}, you should notice a more lifted, responsive feel with easier movement and more airflow than an all-foam mattress. The useful test is whether ${pressureLanguage} eases without your midsection arching or feeling pushed up. If the surface feels too springy or pressure builds at your shoulder, the all-foam option is the better comparison.`;
      }
      if (active === "12-dual-comfort-hybrid") {
        return `On the ${activeTitle}, you should notice responsive support and easier movement than an all-foam mattress, with independent comfort choices for two sleepers. The useful test is whether ${pressureLanguage} eases on your preferred side while your midsection stays supported. If either sleeper feels pushed up or pressure builds, compare the other comfort setting before deciding.`;
      }
      return `On the ${activeTitle}, you should notice a deeper, more even cradle around your shoulders and hips, with less bounce when you change position. The useful test is whether ${pressureLanguage} eases while your waist still feels supported. If you feel stuck or your hips drop too far, it is softer than you need.`;
    case "product_comparison":
      return `The ${firstTitle} gives you a closer, steadier contour with less bounce, while the ${secondTitle} feels more lifted, springy, and breathable. For your shoulder and hip pressure, I would try the ${titleFor(canonical)} first; choose the 14-inch Hybrid only if you prefer more lift and easier movement enough to trade away some of that close contour.`;
    case "advisor_choice":
      if (/\bwould you buy\b/.test(text)) {
        return `For the needs you have described, I would buy the ${titleFor(canonical)} and keep it mattress-only unless elevation clearly improved your comfort during the Rest Test. That is the less expensive setup, and the base is only worth adding if you can name a benefit you actually felt.`;
      }
      return `I would choose the ${titleFor(canonical)} for you. Shoulder and hip pressure is primarily a contouring test, and the foam option is the stronger fit for that need. The 14-inch Hybrid is the better alternative only if you dislike a close foam feel and want more lift and bounce.`;
    case "base_education":
      return `Standard Motion raises and lowers the head and foot of the mattress together. It can make reading, relaxing, getting in and out of bed, or sleeping with gentle elevation more comfortable. I would add it only if you notice a real benefit from elevation; it does not make the mattress itself more pressure-relieving.`;
    case "value_judgment":
      if (/didn.t notice|did not notice/.test(text)) {
        return `Save the money and skip the adjustable base. If elevation did not create a clear comfort or lifestyle benefit during your test, the mattress is doing the important work and the base is not earning its cost.`;
      }
      if (/more expensive.*better/.test(text)) {
        return `No. More expensive is only better when the added feature solves something you care about. For you, mattress fit comes first; I would keep the cheaper mattress-only setup unless elevation gives you a benefit you can actually feel.`;
      }
      return `Based on what you have told me, I would save the money unless you liked sleeping or relaxing with your head or feet elevated. The adjustable base adds positioning, not a better mattress fit, so it is optional rather than necessary for your shoulder and hip pressure.`;
    case "compatibility":
      if (quote?.compatibility?.status === "incompatible") {
        return `That split-motion setup does not pair with ${activeTitle}. Split motion needs the dual-comfort mattress configuration. Standard Motion is the compatible adjustable option for this mattress.`;
      }
      return `Yes. The ${activeTitle} and ${titleFor(quote?.baseHandle || "premium-motion-adjustable-base")} are compatible in ${quote?.size || plan?.knownFacts?.size || "the selected"} size with ${quote?.motionKey === "standard" ? "Standard Motion" : "the selected configuration"}. The setup makes sense if you value elevation; otherwise the mattress-only option is the better value.`;
    case "preference_capture":
      if (/elevation|elevated|raised|head up|feet up/.test(text)) {
        return `That matters. Since you liked the elevated position, the adjustable base is more than an extra feature for you; it supports a comfort preference you actually felt. I would keep Standard Motion in the setup unless independent movement on each side is important.`;
      }
      return `I’ll use that as your current comfort preference. We can compare the active options against it without changing the mattress originally recommended from your assessment.`;
    case "preference_recall":
      if (activeDeal(context)?.decision?.elevation === "liked") {
        return `You said you liked the elevated position. That is the clearest reason to keep Standard Motion in your setup; it supports a benefit you actually felt.`;
      }
      return `I do not have a clear saved preference from this conversation yet. Tell me what felt better, and I’ll use that in the next comparison.`;
    case "firmness_compare":
      return `For the mattress we are discussing, medium will feel steadier and easier to move on, while soft will allow more shoulder and hip sink. Because pressure relief is your priority, start with soft; move to medium only if your hips feel too low or you feel trapped in the surface.`;
    case "medical_boundary":
      return `I can help compare general comfort, support, pressure, and elevation, but I cannot diagnose or treat a medical condition or tell you to stop prescribed therapy. For a medical concern, use your clinician's guidance; for comfort, I can help you test which position and mattress feel best.`;
    default:
      break;
  }

  if (["price_quote", "bundle_quote", "savings_quote", "cart_add"].includes(plan.taskType)) {
    if (!quote?.ok) {
      if (quote?.compatibility?.status === "incompatible") {
        return `That configuration is not compatible. Split motion needs the dual-comfort mattress. I can price Standard Motion with ${activeTitle}, or price the split setup with the dual-comfort mattress.`;
      }
      if (quote?.missing?.includes("size")) return "What size should I price?";
      return `I cannot confirm every exact item and price in the ${activeTitle} setup right now, so I will not give you a partial or mismatched total.`;
    }
    const lines = quote.items.map((item) => `${item.title}: ${formatMoney(item.price, item.currencyCode)}`);
    if (plan.taskType === "savings_quote") {
      const baseItem = quote.items.find((item) => item.handle === quote.baseHandle);
      return baseItem
        ? `You would save ${formatMoney(baseItem.price, baseItem.currencyCode)} by skipping the adjustable base. The mattress-only total would be ${formatMoney(quote.subtotal - baseItem.price, quote.currencyCode)} before taxes, delivery, or active discounts.`
        : `The current quote is already mattress-only at ${formatMoney(quote.subtotal, quote.currencyCode)} before taxes, delivery, or active discounts.`;
    }
    if (quote.items.length === 1) {
      return `The ${quote.size} ${quote.items[0].title} is ${formatMoney(quote.subtotal, quote.currencyCode)} before taxes, delivery, or active discounts.`;
    }
    return `The ${quote.size} setup is ${formatMoney(quote.subtotal, quote.currencyCode)} before taxes, delivery, or active discounts. ${lines.join("; ")}.`;
  }

  return "";
}

function buildContextualChips({ plan = {}, quote = null } = {}) {
  if (["price_quote", "bundle_quote", "savings_quote", "cart_add"].includes(plan.taskType) && !quote?.ok) {
    return [
      { label: "Confirm my size", value: "Help me confirm the right size and price.", type: "prompt" },
      { label: "Talk to a human", value: "Talk to a human", type: "prompt" },
    ];
  }
  if (["price_quote", "bundle_quote", "savings_quote"].includes(plan.taskType) && quote?.ok) {
    return quote.items.length > 1
      ? [
          { label: "Mattress only", value: "What would the mattress cost without the base?", type: "prompt" },
          { label: "Save without base", value: "How much would I save if I skip the base?", type: "prompt" },
          { label: "Check compatibility", value: "Does this setup work together?", type: "prompt" },
        ]
      : [
          { label: "Add Standard Motion", value: "What would it cost with Standard Motion?", type: "prompt" },
          { label: "Compare comfort", value: "How does it compare to the 14-inch Hybrid?", type: "prompt" },
        ];
  }
  if (plan.taskType === "compatibility") {
    return [{ label: "Price this setup", value: "What would this full setup cost?", type: "prompt" }];
  }
  if (["product_comparison", "advisor_choice", "product_experience"].includes(plan.taskType)) {
    return [
      { label: "Price my recommendation", value: "What would the King version of your recommendation cost?", type: "prompt" },
      { label: "Help me test it", value: "What should I pay attention to when I try it?", type: "prompt" },
    ];
  }
  if (["base_education", "value_judgment", "preference_capture"].includes(plan.taskType)) {
    return [
      { label: "Price with motion", value: "What would it cost with Standard Motion?", type: "prompt" },
      { label: "Mattress only", value: "What would the mattress cost without the base?", type: "prompt" },
    ];
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
  const sentences = clean(reply).match(/[^.!?]+[.!?]+/g) || [clean(reply)];
  return clean(sentences.slice(0, 2).join(" ")).slice(0, 320);
}

function adaptResponseDepth(reply = "", depth = "standard") {
  const complete = clean(reply);
  if (depth !== "quick") return complete;
  const firstSentence = complete.match(/^[\s\S]*?[.!?](?:\s|$)/)?.[0];
  return clean(firstSentence || complete);
}

function validateResponseConsistency({ reply = "", quote = null, products = [], actions = [], plan = {}, factPack = null } = {}) {
  const violations = [];
  const lower = clean(reply).toLowerCase();
  if (!plan.technicalLanguageAllowed) {
    for (const phrase of INTERNAL_LANGUAGE) {
      if (lower.includes(phrase)) violations.push(`internal_language:${phrase}`);
    }
  }
  if (reply && !/[.!?]$/.test(clean(reply))) violations.push("incomplete_ending");
  if (clean(reply).endsWith("...")) violations.push("truncated_ending");
  if ((clean(reply).match(/\?/g) || []).length > 1) violations.push("too_many_probes");
  if (quote?.ok) {
    const priceAnswer = ["price_quote", "bundle_quote", "savings_quote", "cart_add"].includes(plan.taskType);
    for (const item of quote.items) {
      const card = products.find((product) => product.handle === item.handle);
      if (!card || Number(card.price) !== Number(item.price)) violations.push(`price_card_mismatch:${item.handle}`);
      if (priceAnswer && !lower.includes(formatMoney(item.price, item.currencyCode).toLowerCase())) {
        violations.push(`price_reply_mismatch:${item.handle}`);
      }
    }
    if (priceAnswer && quote.items.length > 1 && !lower.includes(formatMoney(quote.subtotal, quote.currencyCode).toLowerCase())) {
      violations.push("subtotal_reply_mismatch");
    }
  }
  if (actions.some((action) => action.type === "add_to_cart") && !quote?.cartReady) {
    violations.push("unsafe_cart_action");
  }
  if (plan?.protectedReferences?.includes("canonicalRecommendation")) {
    const canonical = plan?.references?.canonicalRecommendation;
    if (canonical && !lower.includes(titleFor(canonical).toLowerCase())) violations.push("canonical_reference_lost");
  }
  const allowedPrices = new Set(
    (quote?.ok ? quote.items.concat([{ price: quote.subtotal, currencyCode: quote.currencyCode }]) : [])
      .map((item) => formatMoney(item.price, item.currencyCode).toLowerCase())
      .filter(Boolean)
  );
  for (const amount of clean(reply).match(/\$\d[\d,]*(?:\.\d{2})?/g) || []) {
    if (!allowedPrices.has(amount.toLowerCase())) violations.push(`unverified_price:${amount}`);
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
  const verifiedSize = clean(quote?.size || plan?.knownFacts?.size);
  const mentionedSizes = clean(reply).match(/\b(?:twin xl|twin|full|queen|king)\b/gi) || [];
  if (verifiedSize && mentionedSizes.some((size) => normalizeSize(size) !== normalizeSize(verifiedSize))) {
    violations.push("size_mismatch");
  }
  if (quote?.compatibility?.status === "incompatible" && /\b(?:compatible|work together|pair together)\b/.test(lower) && !/\b(?:not|doesn.t|do not|won.t|cannot)\b/.test(lower)) {
    violations.push("compatibility_contradiction");
  }
  if (quote?.motionKey === "standard" && /\b(?:half|full)[ -]split\b/.test(lower)) {
    violations.push("motion_configuration_mismatch");
  }
  return { ok: violations.length === 0, violations };
}

async function resolveAskSnoozerAdvisorTurn({
  query = "",
  context = {},
  plan = null,
  fetchProductsByHandles,
  composeAdvisorResponse,
  requestId = null,
} = {}) {
  const resolvedPlan = plan || planAskSnoozerTurn({ query, context });
  resolvedPlan.query = clean(query);
  if (!resolvedPlan.handled) return null;
  const factPack = buildRelevantFactPack({ query, context, plan: resolvedPlan });
  let quote = null;
  let rawProducts = [];
  if (resolvedPlan.needsCommerce || resolvedPlan.taskType === "compatibility") {
    quote = await buildQuote({ plan: resolvedPlan, context, fetchProductsByHandles });
    if (quote?.items?.length) {
      rawProducts = await fetchByHandles(fetchProductsByHandles, quote.items.map((item) => item.handle));
    }
  } else if (["canonical_recommendation", "canonical_recall"].includes(resolvedPlan.taskType)) {
    rawProducts = await fetchByHandles(fetchProductsByHandles, [resolveCanonicalHandle(context)]);
  }
  const byHandle = new Map(rawProducts.map((product) => [clean(product.handle).toLowerCase(), product]));
  const products = quote?.items?.length
    ? quote.items.map((item) => quoteProductCard(item, byHandle.get(item.handle) || {}))
    : rawProducts;
  factPack.commerce = quote || factPack.commerce;
  factPack.compatibility = quote?.compatibility?.status || factPack.compatibility;
  const composedBaseHandle = quote?.baseHandle || (resolvedPlan.taskType === "compatibility" ? "premium-motion-adjustable-base" : null);
  if (composedBaseHandle && !factPack.products.some((product) => product.handle === composedBaseHandle)) {
    const baseProduct = (loadShowroomManifest().products || []).find((product) => product.handle === composedBaseHandle);
    if (baseProduct) factPack.products.push(baseProduct);
  }
  factPack.verifiedCommercialFacts.quote = quote || factPack.verifiedCommercialFacts.quote;
  factPack.verifiedCommercialFacts.compatibility = factPack.compatibility;
  factPack.verifiedCommercialFacts.products = factPack.products;
  const deterministicReply = adaptResponseDepth(
    shopperFriendlyResponse({ query, plan: resolvedPlan, context, quote }),
    resolvedPlan.responseDepth
  );
  const explicitAdd = resolvedPlan.taskType === "cart_add";
  const actions = explicitAdd && quote?.cartReady
    ? quote.items.map(buildAddAction).filter(Boolean)
    : [];
  const chips = buildContextualChips({ plan: resolvedPlan, quote });
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
      modelGate = validateResponseConsistency({
        reply: composed?.displayText,
        quote,
        products,
        actions,
        plan: resolvedPlan,
        factPack,
      });
      const speechGate = validateResponseConsistency({
        reply: composed?.speechText,
        quote,
        products,
        actions: [],
        plan: resolvedPlan,
        factPack,
      });
      if (!modelGate.ok || !speechGate.ok) {
        modelGate = { ok: false, violations: [...modelGate.violations, ...speechGate.violations.map((item) => `speech:${item}`)] };
        compositionFallbackUsed = true;
      } else {
        reply = clean(composed.displayText);
        speech = clean(composed.speechText);
        compositionMode = "model_assisted";
      }
    } catch (error) {
      modelMs = Date.now() - modelStartedAt;
      compositionFallbackUsed = true;
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
    };
  }
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
    source: quote ? "shopify" : "advisor",
    compositionMode,
    modelCallCount,
    modelMs,
    model,
    compositionFallbackUsed,
    modelGate,
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
