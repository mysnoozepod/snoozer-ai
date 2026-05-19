const ASK_SNOOZER_INTENT_TAXONOMY = Object.freeze({
  product_fit: Object.freeze({
    strategy: "recommend_products",
    route_family: "products",
    allowed_product_families: ["mattress"],
    fallback_behavior: "guide_then_assessment",
    default_action_bias: ["assessment"],
  }),
  product_compare: Object.freeze({
    strategy: "compare_products",
    route_family: "products",
    allowed_product_families: ["mattress"],
    fallback_behavior: "guide_then_assessment",
    default_action_bias: ["assessment"],
  }),
  size_price: Object.freeze({
    strategy: "recommend_products",
    route_family: "products",
    allowed_product_families: ["mattress"],
    fallback_behavior: "guide_then_assessment",
    default_action_bias: ["assessment"],
  }),
  couple_conflict: Object.freeze({
    strategy: "recommend_products",
    route_family: "products",
    allowed_product_families: ["mattress"],
    fallback_behavior: "assessment_first",
    default_action_bias: ["assessment", "booking"],
  }),
  base_elevation: Object.freeze({
    strategy: "recommend_products",
    route_family: "products",
    allowed_product_families: ["adjustable-base", "mattress"],
    fallback_behavior: "guide_then_booking",
    default_action_bias: ["booking", "assessment"],
  }),
  assessment_handoff: Object.freeze({
    strategy: "handoff_assessment",
    route_family: "actions",
    allowed_product_families: [],
    fallback_behavior: "assessment_only",
    default_action_bias: ["assessment"],
  }),
  booking_handoff: Object.freeze({
    strategy: "handoff_booking",
    route_family: "actions",
    allowed_product_families: [],
    fallback_behavior: "booking_only",
    default_action_bias: ["booking"],
  }),
  policy_support: Object.freeze({
    strategy: "guide_policy",
    route_family: "actions",
    allowed_product_families: [],
    fallback_behavior: "guide_only",
    default_action_bias: ["booking"],
  }),
  cart_confidence: Object.freeze({
    strategy: "guide_cart_confidence",
    route_family: "actions",
    allowed_product_families: [],
    fallback_behavior: "guide_then_assessment",
    default_action_bias: ["assessment", "booking"],
  }),
  fallback_unclear: Object.freeze({
    strategy: "fallback_guide",
    route_family: "fallback",
    allowed_product_families: [],
    fallback_behavior: "guide_only",
    default_action_bias: ["assessment"],
  }),
});

const LEGACY_INTENT_GROUP_MAP = Object.freeze({
  default: "fallback_unclear",
  sleep_hot: "product_fit",
  firm_support: "product_fit",
  back_pain: "product_fit",
  snoring: "base_elevation",
  compare_mattresses: "product_compare",
  assessment_help: "assessment_handoff",
  booking_help: "booking_handoff",
  budget_value: "size_price",
  size_help: "size_price",
  queen_size: "size_price",
  king_size: "size_price",
  split_king: "size_price",
  twin_xl: "size_price",
  full_size: "size_price",
  couple_conflict: "couple_conflict",
  policy_support: "policy_support",
  cart_confidence: "cart_confidence",
  fallback: "fallback_unclear",
});

const CONFIDENCE_BY_LABEL = Object.freeze({
  high: 0.92,
  medium: 0.72,
  low: 0.42,
});

const PARTNER_TERMS = Object.freeze([
  "wife",
  "husband",
  "partner",
  "spouse",
  "we both",
  "one of us",
  "both of us",
  "my wife",
  "my husband",
  "my partner",
]);

const DIFFERENCE_TERMS = Object.freeze([
  "different firmness",
  "different comfort",
  "different feel",
  "i like soft",
  "i like firm",
  "she likes firm",
  "she likes soft",
  "he likes firm",
  "he likes soft",
  "my wife likes firm",
  "my wife likes soft",
  "my husband likes firm",
  "my husband likes soft",
  "my partner likes firm",
  "my partner likes soft",
  "we like different",
  "we need different",
  "not the same",
]);

const SIDE_CONFLICT_TERMS = Object.freeze([
  "each side",
  "both sides",
  "one side",
  "two sides",
  "left side",
  "right side",
]);

const ASSESSMENT_TERMS = Object.freeze([
  "take snooze assessment",
  "snooze assessment",
  "assessment",
  "quiz",
  "help me choose",
  "help me choose a mattress",
  "help me find a good mattress",
  "help me find the right mattress",
  "i need help choosing",
  "what mattress should i get",
  "where should i start",
  "recommend a mattress",
  "find me a good bed",
  "i need a good mattress",
  "help me pick",
  "what should i get",
  "not sure",
  "confused",
  "match me",
  "recommend for me",
]);

const BOOKING_TERMS = Object.freeze([
  "book",
  "book snooze session",
  "appointment",
  "try this in person",
  "try in person",
  "test the mattress",
  "showroom",
  "snooze session",
  "visit",
  "test this",
  "try before buying",
]);

const POLICY_TERMS = Object.freeze([
  "finance",
  "refund",
  "refunds",
  "shipping",
  "return",
  "exchange",
  "returnable",
  "trial",
  "trial period",
  "sleep trial",
  "100 night trial",
  "100-night trial",
  "how long can i try it",
  "how long do i have to return it",
  "can i try it for 100 nights",
  "dont like",
  "don't like",
  "delivery work",
  "delivery take",
  "how long does delivery take",
  "warranty",
  "warranties",
  "financing",
  "no money down",
  "monthly payment",
  "monthly payments",
  "payments",
  "pay over time",
  "payment plan",
  "payment plans",
  "deliver",
  "delivery",
  "how fast can i get my mattress",
  "free delivery",
  "delivery free",
  "register",
  "registration",
  "product registration",
  "warranty registration",
  "warranty claim",
  "warranty claims",
  "file a warranty claim",
  "setup",
  "policy",
]);

const POLICY_RETURNS_TERMS = Object.freeze([
  "return",
  "returns",
  "returnable",
  "refund",
  "refunds",
  "exchange",
  "trial",
  "trial period",
  "sleep trial",
  "100 night trial",
  "100-night trial",
  "comfort trial",
  "how long can i try it",
  "how long do i have to return it",
  "can i try it for 100 nights",
  "dont like",
  "don't like",
  "motion bases",
  "pillows",
]);

const POLICY_DELIVERY_TERMS = Object.freeze([
  "deliver",
  "delivery",
  "shipping",
  "setup",
  "set up",
  "white glove",
  "remove my old mattress",
  "mattress removal",
  "old bed",
  "old mattress",
  "how fast can i get my mattress",
  "free delivery",
  "delivery free",
  "track",
  "schedule",
]);

const POLICY_WARRANTY_TERMS = Object.freeze([
  "warranty",
  "warranties",
  "register",
  "registration",
  "product registration",
  "warranty registration",
  "coverage",
  "claim",
  "claims",
  "warranty claim",
  "warranty claims",
  "file a warranty claim",
  "guarantee",
  "defect",
  "defects",
  "sagging",
]);

const POLICY_FINANCING_TERMS = Object.freeze([
  "finance",
  "financing",
  "no money down",
  "monthly payment",
  "monthly payments",
  "payment plan",
  "payment plans",
  "pay over time",
  "shop pay",
  "affirm",
  "synchrony",
  "0% apr",
  "apr",
]);

const POLICY_PRICING_TERMS = Object.freeze([
  "how much",
  "price",
  "cost",
  "pricing",
  "fee",
  "fees",
]);

const CART_TERMS = Object.freeze([
  "am i choosing right",
  "should i buy this",
  "is this right",
  "before i checkout",
  "ready to order",
  "ready to buy",
  "cart",
]);

const BASE_ELEVATION_TERMS = Object.freeze([
  "snore",
  "snoring",
  "elevation",
  "raise my head",
  "raise head",
  "head up",
  "elevate",
  "adjustable base",
  "adjustable bed",
  "zero gravity",
]);

const PRODUCT_COMPARE_TERMS = Object.freeze([
  "compare",
  "foam vs hybrid",
  "difference",
  "versus",
  " vs ",
  "better than",
  "this or that",
]);

const BACK_PAIN_TERMS = Object.freeze([
  "back pain",
  "back hurts",
  "lower back",
  "pressure",
  "alignment",
  "pressure relief",
  "pressure points",
  "sore",
  "soreness",
  "wake up sore",
  "wake up uncomfortable",
  "uncomfortable",
]);

const SIDE_SLEEPER_TERMS = Object.freeze([
  "side sleeper",
  "sleep on my side",
  "sleep on my side and",
]);

const RESTLESS_SLEEP_TERMS = Object.freeze([
  "toss and turn",
  "tossing and turning",
  "restless",
]);

const FIRM_SUPPORT_TERMS = Object.freeze([
  "firm",
  "support",
  "too soft",
]);

const HOT_TERMS = Object.freeze([
  "sleep hot",
  "hot",
  "cooling",
  "sweat",
  "warm",
]);

const BUDGET_TERMS = Object.freeze([
  "cheap",
  "affordable",
  "budget",
  "value",
  "lowest price",
  "best price",
  "inexpensive",
  "not expensive",
  "least expensive",
  "low price",
  "how much",
  "price",
  "cost",
]);

const SIZE_HELP_TERMS = Object.freeze([
  "size",
  "mattress size",
  "half split",
  "half split mattress",
  "split mattress",
  "what is a split mattress",
  "whats a split mattress",
  "what is half split",
  "split head mattress",
  "flex head mattress",
  "why would i need a split mattress",
  "do couples need split mattress",
]);

function normalizeAskSnoozerText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sanitizeAskSnoozerPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function normalizeAskSnoozerPageType(value, path = "/") {
  const normalized = normalizeAskSnoozerText(value);
  if (normalized === "index") return "home";

  if (
    normalized === "home" ||
    normalized === "collection" ||
    normalized === "product" ||
    normalized === "page" ||
    normalized === "cart" ||
    normalized === "search" ||
    normalized === "unknown"
  ) {
    return normalized;
  }

  const normalizedPath = sanitizeAskSnoozerPath(path).toLowerCase();
  if (normalizedPath === "/") return "home";
  if (normalizedPath === "/cart" || normalizedPath.startsWith("/cart/")) return "cart";
  if (normalizedPath === "/search" || normalizedPath.startsWith("/search/")) return "search";
  if (normalizedPath.startsWith("/collections/")) return "collection";
  if (normalizedPath.startsWith("/products/")) return "product";
  if (normalizedPath.startsWith("/pages/")) return "page";
  return "unknown";
}

function includesAny(text, phrases = []) {
  return phrases.some((phrase) => text.includes(phrase));
}

function parseAskSnoozerSizeLabel(value) {
  const text = normalizeAskSnoozerText(value);
  const sizeMatchers = [
    ["split cal king", "Split Cal King"],
    ["half split king", "Half Split King"],
    ["split king", "Split King"],
    ["cal king", "Cal King"],
    ["half split queen", "Half Split Queen"],
    ["twin xl", "Twin XL"],
    ["queen", "Queen"],
    ["king", "King"],
    ["full", "Full"],
    ["twin", "Twin"],
  ];

  for (const [needle, label] of sizeMatchers) {
    if (text.includes(needle)) return label;
  }

  return "";
}

function hasAskSnoozerBudgetSignal(value) {
  return includesAny(normalizeAskSnoozerText(value), BUDGET_TERMS);
}

function classifyAskSnoozerPolicySubtype(value) {
  const text = normalizeAskSnoozerText(value);
  if (!text) return "general_policy";

  if (includesAny(text, POLICY_RETURNS_TERMS)) return "returns";
  if (includesAny(text, POLICY_WARRANTY_TERMS)) return "warranty";
  if (includesAny(text, POLICY_FINANCING_TERMS)) return "financing";

  if (
    includesAny(text, POLICY_DELIVERY_TERMS) ||
    (text.includes("how much") && text.includes("delivery"))
  ) {
    return "delivery";
  }

  if (includesAny(text, POLICY_PRICING_TERMS)) return "pricing";
  return "general_policy";
}

function inferLegacyIntentFromSize(sizeLabel = "") {
  switch (String(sizeLabel || "").trim()) {
    case "Split King":
    case "Half Split King":
      return "split_king";
    case "Twin XL":
      return "twin_xl";
    case "Queen":
    case "Half Split Queen":
      return "queen_size";
    case "King":
    case "Cal King":
    case "Split Cal King":
      return "king_size";
    case "Full":
      return "full_size";
    default:
      return "size_help";
  }
}

function buildClassification({
  intent,
  intentGroup,
  confidenceLabel,
  signals,
  productBias = [],
  actionBias = [],
  notes = [],
  sizeLabel = "",
  budgetSignal = false,
  policySubtype = "",
} = {}) {
  const groupMeta =
    ASK_SNOOZER_INTENT_TAXONOMY[intentGroup] ||
    ASK_SNOOZER_INTENT_TAXONOMY.fallback_unclear;

  return {
    intent,
    intent_group: intentGroup,
    primary_intent: intentGroup,
    confidence: CONFIDENCE_BY_LABEL[confidenceLabel] || CONFIDENCE_BY_LABEL.low,
    confidence_label: confidenceLabel || "low",
    signals: Array.from(new Set((signals || []).filter(Boolean))),
    strategy: groupMeta.strategy,
    route_family: groupMeta.route_family,
    allowed_product_families: Array.from(new Set(groupMeta.allowed_product_families || [])),
    fallback_behavior: groupMeta.fallback_behavior,
    product_bias: Array.from(new Set(productBias.filter(Boolean))),
    action_bias: Array.from(
      new Set([...(groupMeta.default_action_bias || []), ...(actionBias || [])].filter(Boolean))
    ),
    notes: Array.from(new Set((notes || []).filter(Boolean))),
    size_label: String(sizeLabel || "").trim(),
    budget_signal: Boolean(budgetSignal),
    policy_subtype: String(policySubtype || "").trim(),
  };
}

function classifyAskSnoozerIntent(input, context = {}) {
  const text = normalizeAskSnoozerText(
    typeof input === "string" ? input : input?.query || input?.text || ""
  );
  const path = sanitizeAskSnoozerPath(context.path || "/");
  const pageType = normalizeAskSnoozerPageType(context.page_type, path);
  const surface = normalizeAskSnoozerText(context.surface || "shopify_header") || "shopify_header";
  const notes = [`page:${pageType}`, `surface:${surface}`];
  const sizeLabel = parseAskSnoozerSizeLabel(text);
  const budgetSignal = hasAskSnoozerBudgetSignal(text);

  if (!text) {
    return buildClassification({
      intent: "default",
      intentGroup: "fallback_unclear",
      confidenceLabel: "medium",
      signals: ["empty_query"],
      actionBias: ["assessment"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  const partnerSignal = includesAny(text, PARTNER_TERMS);
  const sideConflictSignal = includesAny(text, SIDE_CONFLICT_TERMS);
  const differenceSignal =
    includesAny(text, DIFFERENCE_TERMS) ||
    (/soft/.test(text) && /firm/.test(text)) ||
    (partnerSignal && /(different|opposite|one of us|both of us|but)/.test(text));
  const sideSleeperSignal = includesAny(text, SIDE_SLEEPER_TERMS);
  const sorenessSignal = includesAny(text, BACK_PAIN_TERMS);
  const restlessSignal = includesAny(text, RESTLESS_SLEEP_TERMS);

  if ((partnerSignal && differenceSignal) || (differenceSignal && sideConflictSignal)) {
    return buildClassification({
      intent: "couple_conflict",
      intentGroup: "couple_conflict",
      confidenceLabel: "high",
      signals: [
        partnerSignal ? "partner" : "",
        sideConflictSignal ? "split_sides" : "",
        "comfort_conflict",
      ].filter(Boolean),
      productBias: ["dual_comfort", "partner_flexibility", "split_options"],
      actionBias: ["assessment", "booking"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  if (includesAny(text, ASSESSMENT_TERMS)) {
    return buildClassification({
      intent: "assessment_help",
      intentGroup: "assessment_handoff",
      confidenceLabel: "high",
      signals: ["assessment"],
      actionBias: ["assessment"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  if (includesAny(text, BOOKING_TERMS)) {
    return buildClassification({
      intent: "booking_help",
      intentGroup: "booking_handoff",
      confidenceLabel: "high",
      signals: ["booking"],
      actionBias: ["booking"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  if (includesAny(text, POLICY_TERMS)) {
    const policySubtype = classifyAskSnoozerPolicySubtype(text);
    return buildClassification({
      intent: "policy_support",
      intentGroup: "policy_support",
      confidenceLabel: "high",
      signals: ["policy", policySubtype].filter(Boolean),
      actionBias: ["booking"],
      notes,
      sizeLabel,
      budgetSignal,
      policySubtype,
    });
  }

  if (pageType === "cart" || includesAny(text, CART_TERMS)) {
    return buildClassification({
      intent: "cart_confidence",
      intentGroup: "cart_confidence",
      confidenceLabel: pageType === "cart" ? "high" : "medium",
      signals: ["cart_confidence"],
      actionBias: ["assessment", "booking"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  if (includesAny(text, BASE_ELEVATION_TERMS) || /\bbase\b/.test(text)) {
    return buildClassification({
      intent: "snoring",
      intentGroup: "base_elevation",
      confidenceLabel: includesAny(text, BASE_ELEVATION_TERMS) ? "high" : "medium",
      signals: ["base_elevation"],
      productBias: ["adjustable_base", "elevation"],
      actionBias: ["booking", "assessment"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  if (
    includesAny(text, PRODUCT_COMPARE_TERMS) ||
    (text.includes("foam") && text.includes("hybrid"))
  ) {
    return buildClassification({
      intent: "compare_mattresses",
      intentGroup: "product_compare",
      confidenceLabel: "high",
      signals: ["compare"],
      productBias: ["foam", "hybrid", "balanced"],
      actionBias: ["assessment"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  if (budgetSignal || sizeLabel || includesAny(text, SIZE_HELP_TERMS)) {
    const intent = budgetSignal ? "budget_value" : inferLegacyIntentFromSize(sizeLabel);
    return buildClassification({
      intent,
      intentGroup: "size_price",
      confidenceLabel: sizeLabel || budgetSignal ? "high" : "medium",
      signals: [budgetSignal ? "budget" : "", sizeLabel ? "size" : "size_help"].filter(Boolean),
      productBias: sizeLabel ? [normalizeAskSnoozerText(sizeLabel), "verified_variants"] : ["value"],
      actionBias: ["assessment"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  if (includesAny(text, BACK_PAIN_TERMS)) {
    return buildClassification({
      intent: "back_pain",
      intentGroup: "product_fit",
      confidenceLabel: "high",
      signals: [
        "back_pain",
        sorenessSignal ? "soreness" : "",
        sideSleeperSignal ? "side_sleeper" : "",
      ].filter(Boolean),
      productBias: ["alignment", "pressure_relief", "support"],
      actionBias: ["assessment"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  if (sideSleeperSignal || restlessSignal) {
    return buildClassification({
      intent: "back_pain",
      intentGroup: "product_fit",
      confidenceLabel: sideSleeperSignal || restlessSignal ? "medium" : "low",
      signals: [
        sideSleeperSignal ? "side_sleeper" : "",
        restlessSignal ? "restless_sleep" : "",
      ].filter(Boolean),
      productBias: ["pressure_relief", "support", "alignment"],
      actionBias: ["assessment"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  if (includesAny(text, FIRM_SUPPORT_TERMS)) {
    return buildClassification({
      intent: "firm_support",
      intentGroup: "product_fit",
      confidenceLabel: "high",
      signals: ["firm_support"],
      productBias: ["support", "alignment"],
      actionBias: ["assessment"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  if (includesAny(text, HOT_TERMS)) {
    return buildClassification({
      intent: "sleep_hot",
      intentGroup: "product_fit",
      confidenceLabel: "high",
      signals: ["cooling"],
      productBias: ["cooling", "hybrid", "breathable"],
      actionBias: ["assessment"],
      notes,
      sizeLabel,
      budgetSignal,
    });
  }

  return buildClassification({
    intent: "fallback",
    intentGroup: "fallback_unclear",
    confidenceLabel: "low",
    signals: ["unclear"],
    actionBias: ["assessment"],
    notes,
    sizeLabel,
    budgetSignal,
  });
}

module.exports = {
  ASK_SNOOZER_INTENT_TAXONOMY,
  LEGACY_INTENT_GROUP_MAP,
  classifyAskSnoozerIntent,
  classifyAskSnoozerPolicySubtype,
  hasAskSnoozerBudgetSignal,
  normalizeAskSnoozerText,
  parseAskSnoozerSizeLabel,
};
