const { loadShowroomManifest } = require("./showroomManifest");
const { getKnowledgeManifestEntry } = require("./knowledgeManifest");
const {
  buildClarificationReply,
  buildFallbackReply,
  buildMissingRecommendationReply,
  buildNoGuessReply,
  presentCommerceResponse,
} = require("./askSnoozerResponsePresenter");
const {
  classifyAskSnoozerIntent,
  classifyAskSnoozerPolicySubtype,
  normalizeAskSnoozerText,
  parseAskSnoozerSizeLabel,
} = require("./askSnoozerIntents");

const RECOMMENDATION_TERMS = Object.freeze([
  "what do you recommend",
  "what do you suggest",
  "what should i get",
  "which mattress fits me",
  "which mattress should i get",
  "why this pod",
  "explain my results",
  "what should i try first",
  "recommend a mattress",
]);

const SESSION_GUIDANCE_TERMS = Object.freeze([
  "where should i start",
  "what should i try first",
  "what should i test first",
  "how should i start",
  "during my session",
  "during the session",
]);

const SUPPORT_TERMS = Object.freeze([
  "contact support",
  "contact customer support",
  "customer service",
  "customer support",
  "support email",
  "support phone",
  "talk to someone",
  "speak to someone",
  "human help",
]);

const BOOKING_SUPPORT_TERMS = Object.freeze([
  "need help during my session",
  "help during my session",
  "during my session",
  "during the session",
  "at my session",
]);

const COMMERCE_TERMS = Object.freeze([
  "how much",
  "price",
  "pricing",
  "cost",
  "available",
  "availability",
  "in stock",
  "cheapest",
  "lowest price",
  "budget",
  "monthly payment",
  "monthly payments",
]);

const EDUCATION_TERMS = Object.freeze([
  "good for",
  "helps with",
  "best for",
  "difference",
  "compare",
  "side sleepers",
  "back sleepers",
  "stomach sleepers",
  "sleep hot",
  "snoring",
  "pressure relief",
  "motion isolation",
]);

const NOUNLESS_QUERY_TERMS = Object.freeze(["asdf", "banana", "moon", "nonsense"]);
const LEGACY_PRODUCT_EDUCATION_INTENT_GROUPS = new Set([
  "product_fit",
  "product_compare",
  "couple_conflict",
  "base_elevation",
  "accessory_help",
]);

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function includesAny(text, terms = []) {
  return (terms || []).some((term) => text.includes(normalizeAskSnoozerText(term)));
}

function getShowroomProducts() {
  const manifest = loadShowroomManifest();
  return Array.isArray(manifest.products) ? manifest.products : [];
}

function getProductMap() {
  return new Map(getShowroomProducts().map((product) => [String(product.handle || "").trim(), product]));
}

function getMattressHandles() {
  return getShowroomProducts()
    .filter((product) => String(product.catalogType || "").trim() === "mattress")
    .map((product) => String(product.handle || "").trim());
}

function getBaseHandles() {
  return getShowroomProducts()
    .filter((product) => String(product.catalogType || "").trim() === "base")
    .map((product) => String(product.handle || "").trim());
}

function extractCurrentProductHandle(context = {}) {
  const explicit = String(context?.currentProductHandle || "").trim();
  if (explicit) return explicit;
  const rawPath = String(context?.path || "").trim();
  const match = rawPath.match(/^\/products\/([^/?#]+)/i);
  return match ? String(match[1] || "").trim() : "";
}

function buildHandleMatcherList() {
  return [
    {
      handle: "14-hybrid",
      patterns: [
        /\b14\s*(?:["”]|inch|in|-inch)?\s*hybr(?:id|is)\b/i,
        /\bhybrid 14\b/i,
      ],
    },
    {
      handle: "12-dual-comfort-hybrid",
      patterns: [
        /\b12\s*(?:["”]|inch|in|-inch)?\s*dual comfort(?:\s*hybr(?:id|is))?\b/i,
        /\b12\s*(?:["”]|inch|in|-inch)?\s*hybr(?:id|is)\b/i,
        /\bdual comfort(?:\s*hybr(?:id|is))?\b/i,
      ],
    },
    {
      handle: "12-all-foam-mattress",
      patterns: [/\b12\s*(?:["”]|inch|in|-inch)?\s*all foam\b/i, /\ball foam 12\b/i],
    },
    {
      handle: "10-all-foam-mattress",
      patterns: [/\b10\s*(?:["”]|inch|in|-inch)?\s*all foam\b/i, /\ball foam 10\b/i],
    },
  ];
}

function buildBaseMatcherList() {
  return [
    {
      handle: "platform-base",
      patterns: [/\bplatform base\b/i],
    },
    {
      handle: "storage-base",
      patterns: [/\bstorage base\b/i],
    },
    {
      handle: "premium-motion-adjustable-base",
      patterns: [
        /\bpremium motion adjustable base\b/i,
        /\bpremium motion base\b/i,
        /\badjustable base\b/i,
        /\bmotion base\b/i,
        /\bstandard motion\b/i,
        /\bhalf split motion\b/i,
        /\bfull split motion\b/i,
      ],
    },
  ];
}

function matchHandleByPatterns(text = "", matcherList = []) {
  for (const matcher of matcherList) {
    for (const pattern of matcher.patterns || []) {
      if (pattern.test(text)) return matcher.handle;
    }
  }
  return "";
}

function resolvePolicyTopic(query = "", policySubtype = "") {
  const normalized = normalizeAskSnoozerText(query);

  if (includesAny(normalized, ["privacy", "security"])) return "privacy";
  if (includesAny(normalized, ["snooze session", "book", "booking", "appointment"])) {
    return "booking_session";
  }
  if (includesAny(normalized, ["contact", "support", "customer service"])) {
    return "contact_support";
  }

  switch (String(policySubtype || "").trim()) {
    case "returns":
      return "return_policy";
    case "delivery":
      return "delivery";
    case "warranty":
      return "warranty";
    case "financing":
      return "financing";
    case "pricing":
      return "pricing_guidance";
    default:
      return "";
  }
}

function resolveMotionKey(query = "", context = {}) {
  const normalized = normalizeAskSnoozerText(query);
  const fromContext = normalizeAskSnoozerText(
    context?.canonicalRecommendation?.motionLabel ||
      context?.canonicalRecommendation?.motionKey ||
      context?.motionMode ||
      ""
  );

  if (normalized.includes("full split motion") || fromContext.includes("full_split")) return "full_split";
  if (normalized.includes("half split motion") || normalized.includes("half split") || fromContext.includes("half_split")) {
    return "half_split";
  }
  if (normalized.includes("standard motion") || fromContext.includes("standard")) return "standard";
  if (normalized.includes("no motion") || fromContext.includes("no motion") || fromContext === "none") return "none";
  return "";
}

function resolveCommerceScope(query = "") {
  const normalized = normalizeAskSnoozerText(query);
  const mentionsMattress =
    /\bmattress\b/.test(normalized) ||
    normalized.includes("hybrid") ||
    normalized.includes("foam") ||
    normalized.includes("dual comfort");
  const mentionsBase =
    /\bbase\b/.test(normalized) ||
    normalized.includes("platform") ||
    normalized.includes("storage") ||
    normalized.includes("adjustable");
  const mentionsPod =
    normalized.includes("full pod") ||
    normalized.includes("snoozepod") ||
    normalized.includes("setup");

  if (mentionsPod) return "full_pod";
  if (mentionsMattress && mentionsBase) return "mattress_plus_base";
  if (mentionsBase && !mentionsMattress) return "base_only";
  if (mentionsMattress) return "mattress_only";
  return "unclear";
}

function isPronounOnlyReference(text = "") {
  return /\b(it|this|that one|this one)\b/.test(text);
}

function isRecommendationQuery(text = "") {
  return includesAny(text, RECOMMENDATION_TERMS);
}

function isSessionGuidanceQuery(text = "") {
  return includesAny(text, SESSION_GUIDANCE_TERMS);
}

function isSupportQuery(text = "") {
  return includesAny(text, SUPPORT_TERMS);
}

function isCommerceQuery(text = "", classification = null) {
  const normalized = normalizeAskSnoozerText(text);
  if (includesAny(normalized, COMMERCE_TERMS)) return true;
  const intentGroup = String(classification?.intent_group || "").trim();
  const policySubtype = String(classification?.policy_subtype || "").trim();
  return (
    intentGroup === "size_price" ||
    (intentGroup === "policy_support" && policySubtype === "pricing")
  );
}

function isProductEducationQuery(text = "", classification = null) {
  const normalized = normalizeAskSnoozerText(text);
  const intentGroup = String(classification?.intent_group || "").trim();
  if (includesAny(normalized, EDUCATION_TERMS)) return true;
  return [
    "product_fit",
    "product_compare",
    "couple_conflict",
    "base_elevation",
    "accessory_help",
  ].includes(intentGroup);
}

function isNonsenseFallback(text = "") {
  const normalized = normalizeAskSnoozerText(text);
  return NOUNLESS_QUERY_TERMS.filter((term) => normalized.includes(term)).length >= 2;
}

function buildCandidateProductHandles({
  productHandle = "",
  currentProductHandle = "",
  canonicalRecommendation = null,
} = {}) {
  const mattresses = getMattressHandles();
  return uniqueStrings([
    productHandle,
    currentProductHandle,
    canonicalRecommendation?.primaryMattressHandle,
    ...mattresses.slice(0, 3),
  ]).filter((handle) => mattresses.includes(handle));
}

function extractSlots(query = "", context = {}, classification = null) {
  const normalized = normalizeAskSnoozerText(query);
  const canonicalRecommendation = isObject(context?.canonicalRecommendation)
    ? context.canonicalRecommendation
    : null;
  const currentProductHandle = extractCurrentProductHandle(context);
  const currentProduct = getProductMap().get(currentProductHandle) || null;
  const currentIsBase = String(currentProduct?.catalogType || "").trim() === "base";
  let productHandle = matchHandleByPatterns(normalized, buildHandleMatcherList());
  let baseHandle = matchHandleByPatterns(normalized, buildBaseMatcherList());
  const size = parseAskSnoozerSizeLabel(query) || String(canonicalRecommendation?.normalizedAssessment?.size || "").trim();
  const scope = resolveCommerceScope(query);
  const motionKey = resolveMotionKey(query, context);
  const policyTopic = resolvePolicyTopic(query, classification?.policy_subtype || "");
  const sessionTopic = isSessionGuidanceQuery(normalized) ? "where_to_start" : "";

  if (!productHandle && currentProductHandle && !currentIsBase && isPronounOnlyReference(normalized)) {
    productHandle = currentProductHandle;
  }

  if (!baseHandle && currentProductHandle && currentIsBase && isPronounOnlyReference(normalized)) {
    baseHandle = currentProductHandle;
  }

  if (!productHandle && canonicalRecommendation?.primaryMattressHandle && isPronounOnlyReference(normalized)) {
    productHandle = canonicalRecommendation.primaryMattressHandle;
  }

  if (!baseHandle && canonicalRecommendation?.baseHandle && (scope === "base_only" || normalized.includes("base"))) {
    baseHandle = canonicalRecommendation.baseHandle;
  }

  if (!baseHandle && scope === "base_only" && currentIsBase) {
    baseHandle = currentProductHandle;
  }

  return {
    productHandle: productHandle || null,
    baseHandle: baseHandle || null,
    size: size || null,
    motionKey: motionKey || null,
    scope,
    policyTopic: policyTopic || null,
    sessionTopic: sessionTopic || null,
    currentProductHandle: currentProductHandle || null,
    candidateProductHandles: buildCandidateProductHandles({
      productHandle,
      currentProductHandle: currentIsBase ? "" : currentProductHandle,
      canonicalRecommendation,
    }),
  };
}

function buildMissingSlots(decision, query = "", context = {}) {
  const normalized = normalizeAskSnoozerText(query);
  const slots = decision.slots || {};
  const missing = [];

  if (decision.intentGroup === "policy" && !slots.policyTopic) {
    missing.push("policyTopic");
  }

  if (decision.intentGroup === "recommendation" && !isObject(context?.canonicalRecommendation)) {
    missing.push("assessment");
  }

  if (decision.intentGroup === "commerce") {
    const priceLike = includesAny(normalized, COMMERCE_TERMS);
    if (priceLike && !slots.productHandle && slots.scope !== "base_only") {
      missing.push("productHandle");
    }
    if (priceLike && ["mattress_plus_base", "full_pod"].includes(slots.scope) && !slots.baseHandle) {
      missing.push("baseHandle");
    }
    if (priceLike && !slots.size) {
      missing.push("size");
    }
  }

  return uniqueStrings(missing);
}

function resolveSourceOfTruth({
  intentGroup = "",
  slots = {},
  context = {},
} = {}) {
  if (intentGroup === "policy") return "s3_policy";
  if (intentGroup === "recommendation") {
    return isObject(context?.canonicalRecommendation) ? "canon" : "fallback";
  }
  if (intentGroup === "session_guidance") return "session_prep";
  if (intentGroup === "commerce") return "shopify";
  if (intentGroup === "product_education") {
    return slots.productHandle || slots.baseHandle
      ? "s3_product"
      : isObject(context?.canonicalRecommendation)
        ? "canon"
        : "s3_product";
  }
  if (intentGroup === "sleep_education") return "openai";
  return "fallback";
}

function adjustClassificationForQualityGate(classification = null, normalizedQuery = "") {
  if (!isObject(classification)) return classification;

  const intentGroup = String(classification.intent_group || "").trim();
  if (
    isProductEducationQuery(normalizedQuery, classification) &&
    !LEGACY_PRODUCT_EDUCATION_INTENT_GROUPS.has(intentGroup)
  ) {
    return {
      ...classification,
      intent: "product_question",
      intent_group: "product_fit",
    };
  }

  return classification;
}

function routeAskSnoozerQuestion({
  query = "",
  context = {},
  classification = null,
} = {}) {
  const normalized = normalizeAskSnoozerText(query);
  const rawClassification =
    classification ||
    classifyAskSnoozerIntent(query, {
      path: context?.path || "/",
      page_type: context?.page_type || context?.pageType || "unknown",
      surface: context?.surface || "ask_snoozer",
    });
  const resolvedClassification = adjustClassificationForQualityGate(rawClassification, normalized);
  const slots = extractSlots(query, context, resolvedClassification);
  let intentGroup = "fallback";

  if (isRecommendationQuery(normalized)) {
    intentGroup = "recommendation";
  } else if (isNonsenseFallback(normalized)) {
    intentGroup = "fallback";
  } else if (
    isSessionGuidanceQuery(normalized) &&
    (isObject(context?.sessionPrep) || String(context?.bookingStatus || "").trim())
  ) {
    intentGroup = "session_guidance";
  } else if (isSupportQuery(normalized) || includesAny(normalized, BOOKING_SUPPORT_TERMS)) {
    intentGroup = "support";
  } else if (isCommerceQuery(normalized, resolvedClassification)) {
    intentGroup = "commerce";
  } else if (
    String(resolvedClassification?.intent_group || "").trim() === "policy_support" &&
    String(resolvedClassification?.policy_subtype || "").trim() !== "pricing"
  ) {
    intentGroup = "policy";
  } else if (isProductEducationQuery(normalized, resolvedClassification)) {
    intentGroup = "product_education";
  } else if (normalized && !isNonsenseFallback(normalized) && normalized.split(/\s+/).length >= 2) {
    intentGroup = "sleep_education";
  }

  const missingSlots = buildMissingSlots(
    {
      intentGroup,
      slots,
    },
    query,
    context
  );
  const sourceOfTruth = resolveSourceOfTruth({
    intentGroup,
    slots,
    context,
  });
  const isCheapestUnscopedCommerce =
    intentGroup === "commerce" &&
    (normalized.includes("cheapest") || normalized.includes("lowest price")) &&
    !slots.productHandle &&
    !slots.baseHandle;
  const shouldAskClarifyingQuestion =
    missingSlots.length > 0 &&
    ["commerce", "policy"].includes(intentGroup) &&
    !isCheapestUnscopedCommerce;
  const shouldUseOpenAI =
    intentGroup === "sleep_education" ||
    (intentGroup === "fallback" && normalized && !isNonsenseFallback(normalized));
  const knowledgeKeys =
    intentGroup === "policy" && slots.policyTopic
      ? (getKnowledgeManifestEntry("policies", slots.policyTopic)?.sourceKeys || []).slice()
      : intentGroup === "product_education" && slots.productHandle
        ? (getKnowledgeManifestEntry("products", slots.productHandle)?.sourceKeys || []).slice()
        : intentGroup === "product_education" && slots.baseHandle
          ? (getKnowledgeManifestEntry("bases", slots.baseHandle)?.sourceKeys || []).slice()
          : intentGroup === "session_guidance" && slots.sessionTopic
            ? (getKnowledgeManifestEntry("sessionGuidance", slots.sessionTopic)?.sourceKeys || []).slice()
            : [];

  return {
    intentGroup,
    intent: String(resolvedClassification?.intent || "fallback").trim() || "fallback",
    confidence:
      typeof resolvedClassification?.confidence === "number"
        ? resolvedClassification.confidence
        : 0.42,
    slots,
    missingSlots,
    sourceOfTruth,
    shouldUseOpenAI,
    shouldAskClarifyingQuestion,
    knowledgeKeys,
    classification: resolvedClassification,
  };
}

function buildAskSnoozerClarificationReply(decision = {}) {
  return buildClarificationReply(decision);
}

function buildAskSnoozerFallbackReply() {
  return buildFallbackReply();
}

function buildAskSnoozerMissingRecommendationReply() {
  return buildMissingRecommendationReply();
}

function normalizeSizeKey(value = "") {
  return normalizeAskSnoozerText(value).replace(/[^a-z0-9]/g, "");
}

function findVariantForSize(product = null, sizeLabel = "") {
  const wanted = normalizeSizeKey(sizeLabel);
  if (!wanted || !Array.isArray(product?.variants)) return null;
  const accepted = new Set([wanted]);
  if (wanted === "queen") accepted.add("queen2pc");
  if (wanted === "king") {
    accepted.add("king2pc");
    accepted.add("splitking");
  }
  if (wanted === "twinxl") accepted.add("twinextra long");

  return (
    product.variants.find((variant) => {
      const selectedOptions = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
      return selectedOptions.some((option) => {
        if (normalizeAskSnoozerText(option?.name || "") !== "size") return false;
        const optionKey = normalizeSizeKey(option?.value || "");
        return Array.from(accepted).some(
          (acceptedKey) =>
            optionKey === acceptedKey ||
            optionKey.startsWith(acceptedKey) ||
            acceptedKey.startsWith(optionKey)
        );
      });
    }) || null
  );
}

function inferVariantPrice(variant = null, product = null) {
  const candidate =
    variant?.price ??
    product?.priceRange?.min ??
    product?.price ??
    null;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : null;
}

function inferCurrencyCode(variant = null, product = null) {
  return (
    String(
      variant?.currencyCode ||
        product?.priceRange?.currencyCode ||
        product?.currencyCode ||
        "USD"
    ).trim() || "USD"
  );
}

function buildResolvedProducts(products = [], sizeLabel = "") {
  return products
    .filter(Boolean)
    .map((product) => {
      const variant =
        findVariantForSize(product, sizeLabel) ||
        (Array.isArray(product?.variants)
          ? product.variants.find((item) => item?.available) || product.variants[0]
          : null);
      return {
        product,
        handle: String(product?.handle || "").trim(),
        title: String(product?.title || product?.label || "").trim(),
        href: `/products/${String(product?.handle || "").trim()}`,
        variant,
        variantId: String(variant?.id || product?.variantId || "").trim(),
        variantTitle: String(variant?.title || "").trim(),
        price: inferVariantPrice(variant, product),
        currencyCode: inferCurrencyCode(variant, product),
        available:
          typeof variant?.available === "boolean"
            ? variant.available
            : typeof product?.available === "boolean"
              ? product.available
              : typeof product?.availableForSale === "boolean"
                ? product.availableForSale
                : null,
      };
    })
    .filter((entry) => entry.handle);
}

async function resolveAskSnoozerCommerceResponse({
  query = "",
  decision = {},
  fetchProductsByHandles,
} = {}) {
  if (typeof fetchProductsByHandles !== "function") {
    return {
      ok: false,
      answerType: "fallback",
      sourceOfTruth: "fallback",
      factsResolved: false,
      fallbackUsed: true,
      missingSlots: ["shopify"],
      confidence: Number(decision?.confidence || 0),
      reply: buildNoGuessReply("pricing"),
      reason: "shopify_unavailable",
      products: [],
    };
  }

  const normalized = normalizeAskSnoozerText(query);
  const slots = isObject(decision?.slots) ? decision.slots : {};
  const missingSlots = Array.isArray(decision?.missingSlots) ? decision.missingSlots : [];
  const isCheapestQuestion =
    normalized.includes("cheapest") || normalized.includes("lowest price");

  if (isCheapestQuestion && !slots.productHandle && !slots.baseHandle) {
    return {
      ok: true,
      answerType: "clarification",
      sourceOfTruth: "shopify",
      factsResolved: false,
      fallbackUsed: false,
      missingSlots: [],
      confidence: Number(decision?.confidence || 0),
      reply: "Do you want the cheapest mattress-only option, or the cheapest full setup with a base?",
      reason: "cheapest_scope_unclear",
      products: [],
    };
  }

  if (decision?.shouldAskClarifyingQuestion || missingSlots.length) {
    return {
      ok: true,
      answerType: "clarification",
      sourceOfTruth: "shopify",
      factsResolved: false,
      fallbackUsed: false,
      missingSlots,
      confidence: Number(decision?.confidence || 0),
      reply: buildAskSnoozerClarificationReply(decision),
      reason: "missing_slots",
      products: [],
    };
  }

  const handles = uniqueStrings([slots.productHandle, slots.baseHandle]);
  if (!handles.length) {
    return {
      ok: true,
      answerType: "clarification",
      sourceOfTruth: "shopify",
      factsResolved: false,
      fallbackUsed: false,
      missingSlots: ["productHandle"],
      confidence: Number(decision?.confidence || 0),
      reply: buildAskSnoozerClarificationReply({
        ...decision,
        missingSlots: ["productHandle"],
      }),
      reason: "no_handle",
      products: [],
    };
  }

  const response = await fetchProductsByHandles({ handles, lite: false });
  const fetchedProducts = Array.isArray(response?.items) ? response.items : [];
  const resolved = buildResolvedProducts(fetchedProducts, slots.size || "");
  const byHandle = new Map(resolved.map((entry) => [entry.handle, entry]));
  const mattressEntry = slots.productHandle ? byHandle.get(slots.productHandle) || null : null;
  const baseEntry = slots.baseHandle ? byHandle.get(slots.baseHandle) || null : null;
  const isAvailabilityQuestion =
    normalized.includes("available") || normalized.includes("availability") || normalized.includes("in stock");

  if (isAvailabilityQuestion) {
    const primaryEntry =
      mattressEntry || baseEntry || resolved[0] || null;
    if (!primaryEntry) {
      return {
        ok: false,
        answerType: "fallback",
        sourceOfTruth: "shopify",
        factsResolved: false,
        fallbackUsed: true,
        missingSlots: [],
        confidence: Number(decision?.confidence || 0),
        reply: buildNoGuessReply("pricing"),
        reason: "product_not_found",
        products: [],
      };
    }
    const availabilityReply =
      primaryEntry.available === true
        ? presentCommerceResponse({
            decision,
            resolution: {
              ...decision,
              ...{ products: [primaryEntry], reason: "availability", size: slots.size || null },
            },
          })
        : primaryEntry.available === false
          ? presentCommerceResponse({
              decision,
              resolution: {
                ...decision,
                ...{ products: [primaryEntry], reason: "availability", size: slots.size || null },
              },
            })
          : buildNoGuessReply("pricing");

    return {
      ok: true,
      answerType: "commerce_price",
      sourceOfTruth: "shopify",
      factsResolved: primaryEntry.available !== null,
      fallbackUsed: false,
      missingSlots: [],
      confidence: Number(decision?.confidence || 0),
      reply: availabilityReply,
      reason: "availability",
      products: primaryEntry ? [primaryEntry] : [],
      resolvedProductHandle: mattressEntry?.handle || null,
      resolvedBaseHandle: baseEntry?.handle || null,
      size: slots.size || null,
    };
  }

  if (["mattress_plus_base", "full_pod"].includes(slots.scope)) {
    if (!mattressEntry || !baseEntry) {
      return {
        ok: true,
        answerType: "clarification",
        sourceOfTruth: "shopify",
        factsResolved: false,
        fallbackUsed: false,
        missingSlots: ["baseHandle"],
        confidence: Number(decision?.confidence || 0),
        reply: buildAskSnoozerClarificationReply({
          ...decision,
          missingSlots: ["baseHandle"],
        }),
        reason: "missing_bundle_parts",
        products: [],
      };
    }

    if (!Number.isFinite(mattressEntry.price) || !Number.isFinite(baseEntry.price)) {
      return {
        ok: false,
        answerType: "fallback",
        sourceOfTruth: "shopify",
        factsResolved: false,
        fallbackUsed: true,
        missingSlots: [],
        confidence: Number(decision?.confidence || 0),
        reply: buildNoGuessReply("pricing"),
        reason: "bundle_price_missing",
        products: [mattressEntry, baseEntry].filter(Boolean),
      };
    }

    const subtotal = mattressEntry.price + baseEntry.price;
    return {
      ok: true,
      answerType: "commerce_price",
      sourceOfTruth: "shopify",
      factsResolved: true,
      fallbackUsed: false,
      missingSlots: [],
      confidence: Number(decision?.confidence || 0),
      reply: presentCommerceResponse({
        decision,
        resolution: {
          products: [mattressEntry, baseEntry],
          reason: "bundle_price_resolved",
          itemizedTotal: subtotal,
          size: slots.size || null,
        },
      }),
      reason: "bundle_price_resolved",
      products: [mattressEntry, baseEntry],
      resolvedProductHandle: mattressEntry.handle,
      resolvedBaseHandle: baseEntry.handle,
      size: slots.size || null,
      itemizedTotal: subtotal,
    };
  }

  const primaryEntry = slots.scope === "base_only" ? baseEntry || resolved[0] || null : mattressEntry || resolved[0] || null;
  if (!primaryEntry) {
    return {
      ok: false,
      answerType: "fallback",
      sourceOfTruth: "shopify",
      factsResolved: false,
      fallbackUsed: true,
      missingSlots: [],
      confidence: Number(decision?.confidence || 0),
      reply: buildNoGuessReply("pricing"),
      reason: "single_price_missing_product",
      products: [],
    };
  }

  if (!Number.isFinite(primaryEntry.price)) {
    return {
      ok: false,
      answerType: "fallback",
      sourceOfTruth: "shopify",
      factsResolved: false,
      fallbackUsed: true,
      missingSlots: [],
      confidence: Number(decision?.confidence || 0),
      reply: buildNoGuessReply("pricing"),
      reason: "single_price_missing_variant",
      products: [primaryEntry],
    };
  }

  return {
    ok: true,
    answerType: "commerce_price",
    sourceOfTruth: "shopify",
    factsResolved: true,
    fallbackUsed: false,
    missingSlots: [],
    confidence: Number(decision?.confidence || 0),
    reply: presentCommerceResponse({
      decision,
      resolution: {
        products: [primaryEntry],
        reason: "single_price_resolved",
        size: slots.size || null,
      },
    }),
    reason: "single_price_resolved",
    products: [primaryEntry],
    resolvedProductHandle: primaryEntry.handle,
    resolvedBaseHandle: slots.scope === "base_only" ? primaryEntry.handle : null,
    size: slots.size || null,
  };
}

module.exports = {
  buildAskSnoozerClarificationReply,
  buildAskSnoozerFallbackReply,
  buildAskSnoozerMissingRecommendationReply,
  routeAskSnoozerQuestion,
  resolveAskSnoozerCommerceResponse,
};
