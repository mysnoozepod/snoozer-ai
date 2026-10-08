const { getShowroomCommerceCatalog } = require("./showroomCommerceCatalog");
const { buildProductCardTruth } = require("./askSnoozerProductCardTruth");
const { loadTrustedAdvisorFactPack } = require("./askSnoozerAdvisorFactPack");
const { resolveAskSnoozerPolicyTruth } = require("./askSnoozerPolicy");
const { quoteConfiguration } = require("./askSnoozerConfigurationQuote");
const shopperCart = require("./shopperCart");

const TOOL_NAMES = Object.freeze([
  "discover_products",
  "get_product_facts",
  "get_live_commerce",
  "quote_configuration",
  "get_policy",
  "get_rewards",
  "get_cart",
]);

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values = []) {
  return [...new Set(values.map((value) => clean(value).toLowerCase()).filter(Boolean))];
}

function schema(properties, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}

function nullableString(description) {
  return { type: ["string", "null"], description };
}

const conversationToolDefinitions = [
  {
    type: "function",
    name: "discover_products",
    description: "Find eligible, actually carried mattresses using the shopper's stated needs. Returns approved handles with live catalog data and verified product facts when available.",
    strict: true,
    parameters: schema({
      sleepPosition: nullableString("side, back, stomach, combination, or null"),
      temperature: nullableString("cooler, neutral, warmer, sleeps_hot, or null"),
      pressureAreas: { type: "array", items: { type: "string" }, maxItems: 6 },
      firmness: nullableString("soft, medium, firm, or null"),
      partnerConsiderations: nullableString("Partner needs or null."),
      size: nullableString("Requested mattress size or null."),
      budgetMax: { type: ["number", "null"], minimum: 0 },
      exclusions: { type: "array", items: { type: "string" }, maxItems: 8 },
      limit: { type: "integer", minimum: 1, maximum: 4 },
    }),
  },
  {
    type: "function",
    name: "get_product_facts",
    description: "Retrieve curated, approved product knowledge for known showroom product handles.",
    strict: true,
    parameters: schema({
      productHandles: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
      factClasses: { type: "array", items: { type: "string" }, maxItems: 8 },
    }),
  },
  {
    type: "function",
    name: "get_live_commerce",
    description: "Retrieve Shopify-authoritative variants, availability, and price status for approved handles.",
    strict: true,
    parameters: schema({
      productHandles: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      size: nullableString("Exact requested size or null for starting-at pricing."),
      motionKey: nullableString("Motion configuration or null."),
    }),
  },
  {
    type: "function",
    name: "quote_configuration",
    description: "Validate mattress/base compatibility and retrieve a complete live Shopify configuration quote. Never returns a subtotal for a partial setup.",
    strict: true,
    parameters: schema({
      mattressHandle: { type: "string" },
      baseHandle: nullableString("Approved base handle, or null for mattress only."),
      size: { type: "string" },
      motionKey: { type: "string" },
    }),
  },
  {
    type: "function",
    name: "get_policy",
    description: "Retrieve an approved delivery, returns, warranty, or financing policy fact.",
    strict: true,
    parameters: schema({
      topic: { type: "string", enum: ["delivery", "returns", "warranty", "financing"] },
      question: { type: "string" },
    }),
  },
  {
    type: "function",
    name: "get_rewards",
    description: "Retrieve the authorized shopper's current rewards summary and offers.",
    strict: true,
    parameters: schema({ reason: { type: "string" } }),
  },
  {
    type: "function",
    name: "get_cart",
    description: "Read the authorized shopper's current Shopify cart. This tool cannot mutate it.",
    strict: true,
    parameters: schema({ reason: { type: "string" } }),
  },
];

function approvedProductMap(manifest = {}) {
  return new Map((manifest?.products || [])
    .filter((item) => item?.active !== false)
    .map((item) => [clean(item.handle).toLowerCase(), item]));
}

function normalizeArgs(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(clean(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const TOOL_ARGUMENT_KEYS = Object.freeze({
  discover_products: ["sleepPosition", "temperature", "pressureAreas", "firmness", "partnerConsiderations", "size", "budgetMax", "exclusions", "limit"],
  get_product_facts: ["productHandles", "factClasses"],
  get_live_commerce: ["productHandles", "size", "motionKey"],
  quote_configuration: ["mattressHandle", "baseHandle", "size", "motionKey"],
  get_policy: ["topic", "question"],
  get_rewards: ["reason"],
  get_cart: ["reason"],
});

function validateToolArguments(name, args) {
  const expected = TOOL_ARGUMENT_KEYS[name];
  if (!expected || !args || typeof args !== "object" || Array.isArray(args)) return "tool_arguments_invalid";
  const keys = Object.keys(args);
  if (keys.some((key) => !expected.includes(key)) || expected.some((key) => !keys.includes(key))) return "tool_arguments_shape_invalid";
  const nullableStringKeys = {
    discover_products: ["sleepPosition", "temperature", "firmness", "partnerConsiderations", "size"],
    get_live_commerce: ["size", "motionKey"],
    quote_configuration: ["baseHandle"],
  }[name] || [];
  if (nullableStringKeys.some((key) => args[key] !== null && typeof args[key] !== "string")) return "tool_arguments_type_invalid";
  if (name === "discover_products") {
    if (!Array.isArray(args.pressureAreas) || !Array.isArray(args.exclusions)) return "tool_arguments_type_invalid";
    if (args.budgetMax !== null && (!Number.isFinite(Number(args.budgetMax)) || Number(args.budgetMax) < 0)) return "tool_arguments_type_invalid";
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 4) return "tool_arguments_type_invalid";
  }
  if (["get_product_facts", "get_live_commerce"].includes(name) && !Array.isArray(args.productHandles)) return "tool_arguments_type_invalid";
  if (name === "get_product_facts" && !Array.isArray(args.factClasses)) return "tool_arguments_type_invalid";
  if (name === "quote_configuration" && ["mattressHandle", "size", "motionKey"].some((key) => typeof args[key] !== "string" || !clean(args[key]))) return "tool_arguments_type_invalid";
  if (name === "get_policy" && (!["delivery", "returns", "warranty", "financing"].includes(args.topic) || typeof args.question !== "string")) return "tool_arguments_type_invalid";
  if (["get_rewards", "get_cart"].includes(name) && typeof args.reason !== "string") return "tool_arguments_type_invalid";
  return null;
}

function scoreProduct(definition = {}, input = {}) {
  let score = 0;
  const reasons = [];
  const position = clean(input.sleepPosition).toLowerCase();
  const temperature = clean(input.temperature).toLowerCase();
  const firmness = clean(input.firmness).toLowerCase();
  const pressure = unique(input.pressureAreas || []);
  if (position === "side" && ["foam", "dual"].includes(definition.family)) {
    score += 24;
    reasons.push("approved side-sleeper pressure-relief rule");
  }
  if (["back", "stomach"].includes(position) && definition.family === "hybrid") {
    score += 22;
    reasons.push("approved back/stomach support rule");
  }
  if (["sleeps_hot", "cooler", "hot"].includes(temperature) && definition?.attributes?.cooling === true) {
    score += 26;
    reasons.push("curated cooling attribute");
  }
  if (firmness === "firm" && definition.family === "hybrid") {
    score += 16;
    reasons.push("approved firmer-hybrid rule");
  }
  if (firmness === "soft" && ["foam", "dual"].includes(definition.family)) {
    score += 14;
    reasons.push("approved softer foam/dual rule");
  }
  if (pressure.length && ["foam", "dual"].includes(definition.family)) {
    score += 12;
    reasons.push("foam candidate for pressure-relief rest testing");
  }
  if (clean(input.partnerConsiderations) && definition?.attributes?.preferredForPartnerSleep === true) {
    score += 20;
    reasons.push("curated partner-sleep attribute");
  }
  return { score, reasons };
}

async function discoverProducts(args, deps) {
  const catalog = await (deps.getShowroomCommerceCatalog || getShowroomCommerceCatalog)({}, {
    shopify: deps.shopify,
    showroomManifest: deps.manifest,
  });
  const definitions = approvedProductMap(deps.manifest);
  const exclusions = new Set(unique(args.exclusions || []));
  const limit = Math.max(1, Math.min(4, Number(args.limit) || 2));
  let ranked = (catalog.products || [])
    .filter((product) => definitions.get(clean(product.handle).toLowerCase())?.catalogType === "mattress")
    .filter((product) => definitions.get(clean(product.handle).toLowerCase())?.recommendable !== false)
    .filter((product) => !exclusions.has(clean(product.handle).toLowerCase()))
    .map((product, index) => {
      const definition = definitions.get(clean(product.handle).toLowerCase());
      const scored = scoreProduct(definition, args);
      return { product, definition, score: scored.score, reasons: scored.reasons, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  if (args.budgetMax !== null && args.budgetMax !== undefined && Number.isFinite(Number(args.budgetMax)) && args.size) {
    ranked = ranked.filter(({ product }) => {
      const card = buildProductCardTruth(product, { activeSize: args.size });
      return !Number.isFinite(Number(card?.price)) || Number(card.price) <= Number(args.budgetMax);
    });
  }
  ranked = ranked.slice(0, limit);
  const handles = ranked.map((item) => clean(item.product.handle).toLowerCase());
  const factPack = await (deps.loadTrustedAdvisorFactPack || loadTrustedAdvisorFactPack)({
    productHandles: handles,
    query: "product discovery",
    requestedFacts: ["product_features"],
    productFactsOverride: deps.productFactsOverride,
  });
  const factsByHandle = new Map((factPack?.productFacts || []).map((item) => [clean(item.handle).toLowerCase(), item]));
  return {
    source: "approved_showroom_catalog",
    catalogVersion: catalog.catalogVersion,
    limitations: handles.filter((handle) => !factsByHandle.has(handle)).map((handle) => ({ handle, reason: "curated_product_document_unavailable" })),
    products: ranked.map(({ product, definition, score, reasons }) => ({
      handle: clean(product.handle).toLowerCase(),
      title: clean(product.title || definition.title),
      family: definition.family,
      curatedAttributes: definition.attributes || {},
      matchScore: score,
      matchReasons: reasons,
      commerce: buildProductCardTruth(product, { activeSize: clean(args.size) }),
      verifiedFacts: factsByHandle.get(clean(product.handle).toLowerCase())?.facts || [],
    })),
  };
}

async function executeConversationTool(name, rawArgs, deps = {}) {
  const startedAt = Date.now();
  const args = normalizeArgs(rawArgs);
  if (!TOOL_NAMES.includes(name)) {
    return { ok: false, name, error: "tool_not_allowlisted", latencyMs: Date.now() - startedAt };
  }
  const argumentError = validateToolArguments(name, args);
  if (argumentError) return { ok: false, name, error: argumentError, latencyMs: Date.now() - startedAt };
  const definitions = approvedProductMap(deps.manifest);
  const assertHandles = (handles) => {
    const normalized = unique(handles || []);
    if (!normalized.length || normalized.some((handle) => !definitions.has(handle))) {
      throw Object.assign(new Error("One or more product handles are not approved."), { code: "TOOL_PRODUCT_NOT_APPROVED" });
    }
    return normalized;
  };
  try {
    let data;
    if (name === "discover_products") {
      data = await discoverProducts(args, deps);
    } else if (name === "get_product_facts") {
      const handles = assertHandles(args.productHandles);
      data = await (deps.loadTrustedAdvisorFactPack || loadTrustedAdvisorFactPack)({
        productHandles: handles,
        query: "product facts",
        requestedFacts: Array.isArray(args.factClasses) ? args.factClasses : [],
        productFactsOverride: deps.productFactsOverride,
      });
    } else if (name === "get_live_commerce") {
      const handles = assertHandles(args.productHandles);
      const result = await deps.shopify.fetchProductsByHandles({ handles, lite: false });
      data = {
        source: "shopify_storefront",
        products: (result?.items || []).map((product) => buildProductCardTruth(product, {
          activeSize: clean(args.size),
          motionType: clean(args.motionKey || "standard"),
        })),
        missingHandles: handles.filter((handle) => !(result?.items || []).some((item) => clean(item?.handle).toLowerCase() === handle)),
      };
    } else if (name === "quote_configuration") {
      assertHandles([args.mattressHandle, ...(args.baseHandle ? [args.baseHandle] : [])]);
      data = await (deps.quoteConfiguration || quoteConfiguration)({
        mattressHandle: args.mattressHandle,
        baseHandle: args.baseHandle || "",
        size: args.size,
        motionKey: args.motionKey,
        fetchProductsByHandles: deps.shopify.fetchProductsByHandles,
        manifest: deps.manifest,
      });
    } else if (name === "get_policy") {
      data = await (deps.resolvePolicyTruth || resolveAskSnoozerPolicyTruth)({ topic: args.topic, query: args.question });
    } else if (name === "get_rewards") {
      if (!deps.identity?.profileId || !deps.rewardsService) throw Object.assign(new Error("Rewards identity is unavailable."), { code: "REWARDS_IDENTITY_MISSING" });
      const [summary, offers] = await Promise.all([
        deps.rewardsService.getRewardSummary(deps.identity),
        deps.rewardsService.getRewardOffers(deps.identity),
      ]);
      data = { source: "rewards_repository", summary, offers: Array.isArray(offers) ? offers : [] };
    } else if (name === "get_cart") {
      data = await (deps.resolveShopperCart || shopperCart.resolveShopperCart)(deps.event, { shopify: deps.shopify });
    }
    return { ok: true, name, data, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      name,
      error: clean(error?.code || error?.message || "tool_failed").slice(0, 160),
      latencyMs: Date.now() - startedAt,
    };
  }
}

function groundedHandlesFromToolResult(result = {}) {
  if (!result?.ok) return [];
  const data = result.data || {};
  return unique([
    ...(data.products || []).map((item) => item?.handle || item?.commerce?.handle),
    ...(data.productFacts || []).map((item) => item?.handle),
    ...(data.items || []).map((item) => item?.handle),
    data.productHandle,
    data.baseHandle,
  ]);
}

module.exports = {
  TOOL_NAMES,
  conversationToolDefinitions,
  executeConversationTool,
  groundedHandlesFromToolResult,
  scoreProduct,
  validateToolArguments,
};
