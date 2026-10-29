const { loadTrustedAdvisorFactPack } = require("./askSnoozerAdvisorFactPack");
const { composeTrustedAdvisorResponse, parseTrustedAdvisorComposition } = require("./askSnoozerModelComposer");
const { planTrustedAdvisorTurnWithModel } = require("./askSnoozerModelPlannerRuntime");
const { FINAL_MODEL, FINAL_REASONING_EFFORT, callOpenAIResponses } = require("./openaiModelRuntime");
const { loadShowroomManifest } = require("./showroomManifest");
const { snoozerConversationModelSchema, validateConversationResponse } = require("./askSnoozerConversationContracts");
const { conversationToolDefinitions, executeConversationTool, groundedHandlesFromToolResult } = require("./askSnoozerConversationTools");
const { compactConversationState, existingReferenceHandles, normalizedConversationHistory } = require("./askSnoozerConversationState");
const { buildCartAction } = require("./askSnoozerConfigurationQuote");
const { buildProductCardTruth } = require("./askSnoozerProductCardTruth");

const CONVERSATION_CORE_VERSION = "conversation-core.v1.4";
const EXPECTED_MODEL = "gpt-6.1-sol";
const RESPONSE_RESERVE_MS = 2500;
let modelCircuit = { failures: 0, openedAt: 0 };

function clean(value) { return String(value == null ? "" : value).trim(); }
function unique(values = []) { return [...new Set(values.map((value) => clean(value).toLowerCase()).filter(Boolean))]; }
function normalizedProductPhrase(value) {
  return clean(value).toLowerCase().replace(/\"/g, " inch ").replace(/[^a-z0-9]+/g, " ").trim();
}

function claimSourceHints(toolResults = []) {
  return toolResults.filter((result) => result?.ok).map((result) => {
    const data = result.data || {};
    const keys = unique([
      data.source,
      ...groundedHandlesFromToolResult(result),
      ...(data.productFacts || []).map((item) => item?.sourceKey),
    ]);
    return keys.length ? `${result.name}: ${keys.join(", ")}` : null;
  }).filter(Boolean).join("; ").slice(0, 1200);
}

const CLAIM_SOURCE_TOOL_NAMES = Object.freeze({
  product: ["get_product_facts", "discover_products"],
  commerce: ["get_live_commerce", "quote_configuration", "discover_products"],
  compatibility: ["quote_configuration"],
  policy: ["get_policy"],
  rewards: ["get_rewards"],
  cart: ["get_cart"],
});

function canonicalClaimSourceKey(claim = {}, result = {}, manifest = loadShowroomManifest()) {
  const data = result?.data || {};
  if (result.name === "quote_configuration") {
    return [data.productHandle, data.baseHandle, data.size, data.motionKey]
      .map((value) => clean(value).toLowerCase().replace(/\s+/g, "_"))
      .filter(Boolean)
      .join(":");
  }
  if (clean(claim.kind) === "commerce" && clean(data.source)) return clean(data.source);
  const handles = groundedHandlesFromToolResult(result);
  const claimText = clean(claim.value).toLowerCase();
  const normalizedClaimText = normalizedProductPhrase(claim.value);
  const mentioned = handles.find((handle) => {
    if (claimText.includes(handle)) return true;
    const title = clean((manifest?.products || []).find((item) => item?.handle === handle)?.title).toLowerCase();
    const normalizedTitle = normalizedProductPhrase(title);
    return Boolean(normalizedTitle && normalizedClaimText.includes(normalizedTitle));
  });
  if (mentioned) return mentioned;
  if (handles.length === 1) return handles[0];
  return clean(data.source);
}

function repairClaimSourceMetadata(response = {}, toolResults = [], errors = [], manifest = loadShowroomManifest()) {
  const affectedKinds = new Set(errors
    .filter((error) => /^claim_source_(?:missing|invalid):/.test(error))
    .map((error) => error.split(":")[1]));
  let repairCount = 0;
  const claims = (response.claims || []).map((claim) => {
    const kind = clean(claim?.kind);
    if (!affectedKinds.has(kind)) return claim;
    const allowedTools = CLAIM_SOURCE_TOOL_NAMES[kind] || [];
    const currentSourceTool = clean(claim?.sourceTool);
    const result = toolResults.find((item) => item?.ok && item.name === currentSourceTool && allowedTools.includes(item.name))
      || allowedTools.map((name) => toolResults.find((item) => item?.ok && item.name === name)).find(Boolean);
    if (!result) return claim;
    const sourceKey = canonicalClaimSourceKey(claim, result, manifest);
    if (!sourceKey || (result.name === currentSourceTool && sourceKey === clean(claim.sourceKey))) return claim;
    repairCount += 1;
    return { ...claim, sourceTool: result.name, sourceKey };
  });
  return { value: { ...response, claims }, repairCount };
}
function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function getConversationCoreConfig(env = process.env) {
  const legacyFlag = clean(env.ASK_SNOOZER_MODEL_ONLY).toLowerCase();
  const encodedMode = legacyFlag === "cc_shadow"
    ? "shadow"
    : legacyFlag === "cc_active"
      ? "active"
      : "legacy";
  return {
    mode: clean(env.ASK_SNOOZER_CONVERSATION_CORE_MODE || encodedMode).toLowerCase(),
    model: clean(env.ASK_SNOOZER_CONVERSATION_CORE_MODEL || env.OPENAI_FINAL_MODEL || FINAL_MODEL),
    reasoningEffort: clean(env.ASK_SNOOZER_CONVERSATION_CORE_REASONING_EFFORT || env.OPENAI_FINAL_REASONING_EFFORT || FINAL_REASONING_EFFORT || "low"),
    maxToolRounds: boundedInt(env.ASK_SNOOZER_CONVERSATION_CORE_MAX_TOOL_ROUNDS, 3, 0, 3),
    maxToolCalls: boundedInt(env.ASK_SNOOZER_CONVERSATION_CORE_MAX_TOOL_CALLS, 6, 1, 10),
    totalTimeoutMs: boundedInt(
      env.ASK_SNOOZER_CONVERSATION_CORE_TOTAL_TIMEOUT_MS || env.MODEL_TIMEOUT_MS,
      26000,
      5000,
      45000
    ),
    modelTimeoutMs: boundedInt(
      env.ASK_SNOOZER_CONVERSATION_CORE_MODEL_TIMEOUT_MS || env.OPENAI_TIMEOUT_MS || 18000,
      18000,
      1000,
      30000
    ),
    breakerThreshold: boundedInt(env.ASK_SNOOZER_CONVERSATION_CORE_BREAKER_THRESHOLD, 4, 1, 20),
    breakerCooldownMs: boundedInt(env.ASK_SNOOZER_CONVERSATION_CORE_BREAKER_COOLDOWN_MS, 30000, 1000, 300000),
  };
}

function isConversationCoreActive(env = process.env) {
  return ["active", "shadow"].includes(getConversationCoreConfig(env).mode);
}

function circuitAvailable(config, now = Date.now()) {
  if (modelCircuit.failures < config.breakerThreshold) return true;
  if (now - modelCircuit.openedAt >= config.breakerCooldownMs) {
    modelCircuit = { failures: 0, openedAt: 0 };
    return true;
  }
  return false;
}
function noteModelSuccess() { modelCircuit = { failures: 0, openedAt: 0 }; }
function noteModelFailure(config) {
  modelCircuit.failures += 1;
  if (modelCircuit.failures >= config.breakerThreshold && !modelCircuit.openedAt) modelCircuit.openedAt = Date.now();
}

function buildConversationEnvelope({ message = "", context = {}, history = [], manifest = loadShowroomManifest(), preparedEvidence = [] } = {}) {
  const recentTurns = normalizedConversationHistory(history, context?.recentConversation || [], message);
  return {
    version: CONVERSATION_CORE_VERSION,
    shopperMessage: clean(message).slice(0, 1800),
    recentTurns,
    conversationState: compactConversationState(context),
    journey: {
      stage: clean(context?.activeJourney?.journeyStage || "exploring"),
      currentSurface: clean(context?.activeJourney?.currentSurface || context?.pageType || "ask_snoozer"),
      canonicalRecommendation: context?.activeJourney?.canonicalRecommendation || context?.canonicalRecommendation || null,
      activeConfiguration: context?.activeJourney?.activeConfiguration || null,
      quoteStatus: context?.activeJourney?.activeQuote?.status || null,
    },
    approvedProducts: (manifest?.products || [])
      .filter((item) => item?.active !== false)
      .map((item) => ({ handle: item.handle, title: item.title, category: item.catalogType })),
    preparedEvidence,
  };
}

function buildCoreInstructions() {
  return [
    "You are Snoozer, MySnoozePod's expert showroom mattress advisor and the single conversational reasoner for free-form shopper language.",
    "Understand and answer the whole request; never reduce it to a task label.",
    "Use conversationState to resolve grounded references such as those two, the first one, the other mattress, the cheaper option, and that setup.",
    "When recommendations are requested and candidates do not exist, call discover_products. Missing handles require discovery, not failure.",
    "discover_products already returns approved candidates, verified product facts when available, and live commerce cards for the requested size. Do not repeat those reads unless a required fact is actually missing.",
    "Treat discover_products curatedAttributes, matchReasons, and commerce fields as verified grounding. An optional product-document limitation restricts unsupported details; it does not erase an otherwise approved, eligible product.",
    "If discover_products returns products, do not claim that no eligible or verified products were found. Recommend from the verified fields that are present and clearly leave missing details unknown.",
    "When several independent sources are required, request their tools together in one parallel tool round.",
    "Use tools for every product-specific, price, availability, variant, compatibility, policy, rewards, or cart claim.",
    "Understand affordability conversationally. A vague concern means price-sensitive with no invented numeric cap; an exact, approximate, under, stretch, reduced, increased, or removed budget must retain that qualifier accurately.",
    "When affordability changes after a recommendation, preserve comfort, partner, size, rejection, and comparison history; verify the current recommendation's price and use discover_products for eligible alternatives when the shopper asks to spend less or find affordable options.",
    "For vague affordability use discover_products pricePreference lower_cost with budgetMax null. For the least expensive eligible option use lowest_price. Use a numeric budgetMax only when the shopper actually supplied or explicitly accepted that limit.",
    "Do not discard an existing recommendation only because price matters. Explain its verified fit and price, compare verified lower-cost tradeoffs, and ask one budget clarification only when it would materially narrow the choice.",
    "A hypothetical dollar amount is not an approved budget and must not change preference state. Price no longer being an issue removes the active budget preference.",
    "Prepared evidence is already verified for this turn. Cite its tool and do not call get_product_facts again for the same handles unless a required fact is absent.",
    "A prepared quote_configuration result is authoritative for that exact mattress, base, size, motion, compatibility, line prices, and subtotal; do not request the same quote again. If it is incompatible, explain its verified reason without naming a replacement product unless separate prepared evidence grounds that replacement.",
    "If prepared get_product_facts evidence lists a handle in missingHandles, its optional curated product document is unavailable. Do not repeat the same facts call; use other verified evidence and state the limitation when relevant.",
    "Never invent a product, handle, fact, price, variant, availability state, policy, assessment, recommendation, quote, or commitment.",
    "Live commerce tool results control price, variants, availability, cart, and checkout. Curated facts control product attributes. Missing facts remain unknown.",
    "Answer first. For comparisons, lead with the verdict, connect it to the shopper's stated needs, then give only the useful supporting differences and one practical next step.",
    "Keep shopper and partner preferences separate. Honor exclusions throughout the visit and never re-recommend a rejected product unless the shopper explicitly restores it.",
    "When a later clarification identifies an ambiguous product reference, do not attach the earlier ambiguous label to that product as fact. Recap only the explicit exclusion and its verified or shopper-stated reason.",
    "Do not claim an assessment or prior recommendation unless it exists in journey or conversation state.",
    "Hypothetical and conditional language is non-mutating. Only propose accepted, rejected, or cart-confirmed decisions when explicitly stated.",
    "For every preference or decision proposal, copy a short exact phrase from the current shopper message into evidence.",
    "A product mentioned as an example is not automatically recommended. A rejected product stays rejected unless explicitly restored.",
    "Never promise medical outcomes. Give qualified product guidance; mention medical evaluation only when pain is worsening or significant, not as a repeated boilerplate caveat.",
    "Return plain shopper-facing text only: no Markdown markers, headings, HTML, tables, or raw formatting syntax.",
    "Do not expose internal terms such as model, tool, API, database, Shopify, S3, source of truth, backend, or resolver.",
    "If a source fails, state the exact shopper-facing limitation. Clarify only genuine ambiguity.",
    "Keep the shopper-facing reply concise, normally no more than 120 words, while still answering every part of the request.",
    "Return the strict structured response. The server derives speech, captions, and HUD delivery fields. Product handles must come from tool results or the supplied reference ledger.",
    "Every non-general claim must cite the successful source tool and source key.",
    "For every dollar amount in reply, add a monetaryClaims entry. Classify verified_product_price, verified_starting_at_price, verified_exact_variant_price, verified_bundle_subtotal, shopper_budget, hypothetical_spending_example, suggested_budget_threshold, or unverified_product_price exactly.",
    "Verified commerce money requires its authoritative tool and source key. Shopper budgets and hypothetical amounts require an exact shopperEvidence phrase from the current message. Suggested budget thresholds require no product handle or source tool and must be phrased explicitly as a budget question or spending threshold, never as a product price.",
    "Never relabel an unsupported product price as a budget or hypothetical amount. If commerce is unavailable, omit the amount and state that live pricing could not be verified.",
    "Before proposing add_to_cart, call quote_configuration. Only a complete cartReady result can produce a cart proposal; the server builds the cart lines.",
  ].join(" ");
}

function toolOutputForModel(result) {
  const compactCommerce = (product = {}) => ({
    handle: product?.handle || null,
    title: product?.title || null,
    subtitle: product?.subtitle || null,
    priceRange: product?.priceRange || null,
    price: product?.price ?? null,
    currencyCode: product?.currencyCode || product?.priceRange?.currencyCode || null,
    pricingMode: product?.pricingMode || null,
    activeSize: product?.activeSize || null,
    selectedOptions: product?.selectedOptions || [],
    variantId: product?.variantId || null,
    exactVariantResolved: product?.exactVariantResolved === true,
    availabilityResolved: product?.availabilityResolved === true,
    available: product?.available ?? null,
  });
  const compactProduct = (item = {}) => ({
    handle: item?.handle || item?.commerce?.handle || null,
    title: item?.title || item?.commerce?.title || null,
    family: item?.family || null,
    curatedAttributes: item?.curatedAttributes || null,
    matchScore: item?.matchScore ?? null,
    matchReasons: item?.matchReasons || [],
    commerce: item?.commerce ? compactCommerce(item.commerce) : compactCommerce(item),
    verifiedFacts: Array.isArray(item?.verifiedFacts) ? item.verifiedFacts.slice(0, 7) : [],
  });
  let data = result?.data;
  if (result?.ok && result?.name === "discover_products") {
    data = {
      source: data?.source || null,
      limitations: data?.limitations || [],
      selection: data?.selection || null,
      products: (data?.products || []).map(compactProduct),
    };
  } else if (result?.ok && result?.name === "get_live_commerce") {
    data = {
      source: data?.source || null,
      missingHandles: data?.missingHandles || [],
      products: (data?.products || []).map(compactCommerce),
    };
  } else if (result?.ok && result?.name === "get_product_facts") {
    data = {
      source: "curated_product_knowledge",
      productFacts: (data?.productFacts || []).map((item) => ({
        handle: item?.handle || null,
        status: item?.status || null,
        facts: Array.isArray(item?.facts) ? item.facts.slice(0, 7) : [],
      })),
      requestedHandles: data?.requestedHandles || [],
      missingHandles: data?.missingHandles || [],
    };
  }
  return JSON.stringify({
    ok: Boolean(result?.ok),
    tool: clean(result?.name),
    evidenceStatus: clean(result?.evidenceStatus || (result?.ok ? "verified" : "failed")),
    evidence: result?.evidence || null,
    ...(result?.ok
      ? { data }
      : {
          error: clean(result?.error || "tool_failed"),
          errorType: clean(result?.errorType || "unknown"),
          retryable: result?.retryable === true,
        }),
  }).slice(0, 12000);
}

function cardPresentationPolicy(response, context = {}, toolResults = [], message = "") {
  const wanted = unique(response?.productHandles || []);
  if (!wanted.length) return { show: false, reason: "no_product_handles", handles: [] };
  if (response?.responseMode === "clarification") return { show: false, reason: "clarification", handles: wanted };
  const existing = new Set(unique(compactConversationState(context)?.references?.presentedProductHandles || []));
  const hasNew = wanted.some((handle) => !existing.has(handle));
  const hasCommerceClaim = (response?.claims || []).some((claim) => ["commerce", "compatibility"].includes(claim?.kind));
  const commerceRequested = /\b(?:price|cost|availability|available|in stock|stock|compatible|compatibility|configuration|buy|cart|checkout)\b/i.test(clean(message));
  const hasFreshCommerceEvidence = toolResults.some((result) => (
    result?.ok && result?.prepared !== true && ["get_live_commerce", "quote_configuration"].includes(result?.name)
  ));
  const commerceNeeded = hasFreshCommerceEvidence || (hasCommerceClaim && commerceRequested);
  const actionable = (response?.actionProposals || []).some((action) => action?.type === "add_to_cart");
  if (hasNew) return { show: true, reason: "new_product", handles: wanted };
  if (commerceNeeded) return { show: true, reason: "commerce_confirmation", handles: wanted };
  if (actionable) return { show: true, reason: "actionable_configuration", handles: wanted };
  return { show: false, reason: "unchanged_repeat", handles: wanted };
}

function sizeFromContext(context = {}) {
  const state = compactConversationState(context);
  const preference = (state.preferences || []).find((item) => item?.subject !== "partner" && item?.key === "size" && item?.status !== "removed");
  return clean(preference?.value || context?.activeJourney?.activeConfiguration?.size || context?.askSnoozerWorkingMemory?.activeDeal?.activeSize);
}

async function responseProducts(response, toolResults, manifest = {}, { shopify, context = {}, message = "" } = {}) {
  const presentation = cardPresentationPolicy(response, context, toolResults, message);
  if (!presentation.show) return { products: [], presentation, enrichment: { status: "suppressed", requested: presentation.handles.length, displayed: 0, latencyMs: 0 } };
  const wanted = new Set(unique(response?.productHandles || []));
  const byHandle = new Map();
  for (const result of toolResults) {
    if (!result?.ok) continue;
    for (const item of result?.data?.products || []) {
      const product = item?.commerce?.handle ? item.commerce : item;
      const handle = clean(product?.handle).toLowerCase();
      if (handle && wanted.has(handle) && !byHandle.has(handle)) byHandle.set(handle, product);
    }
  }
  const missing = [...wanted].filter((handle) => !byHandle.has(handle));
  const hydrationStartedAt = Date.now();
  let hydrationError = null;
  if (missing.length && typeof shopify?.fetchProductsByHandles === "function") {
    try {
      const result = await shopify.fetchProductsByHandles({ handles: missing, lite: false });
      for (const product of result?.items || []) {
        const card = buildProductCardTruth(product, { activeSize: sizeFromContext(context) });
        const handle = clean(card?.handle).toLowerCase();
        if (handle && wanted.has(handle)) byHandle.set(handle, card);
      }
    } catch (error) {
      hydrationError = clean(error?.code || error?.message || "commerce_hydration_failed");
    }
  }
  for (const definition of manifest?.products || []) {
    const handle = clean(definition?.handle).toLowerCase();
    if (!handle || !wanted.has(handle) || byHandle.has(handle) || definition?.active === false) continue;
    byHandle.set(handle, {
      id: handle,
      handle,
      title: clean(definition?.title) || handle,
      type: clean(definition?.catalogType) || "product",
      url: clean(definition?.shopifyPath) || `/products/${handle}`,
      href: clean(definition?.shopifyPath) || `/products/${handle}`,
      price: null,
      priceRange: { min: null, max: null, currencyCode: "USD" },
      currencyCode: "USD",
      pricingMode: "unresolved",
      priceLabel: null,
      variantId: null,
      exactVariantResolved: false,
      availabilityResolved: false,
      available: null,
      imageUrl: null,
    });
  }
  const products = [...wanted].map((handle) => byHandle.get(handle)).filter(Boolean);
  return {
    products,
    presentation,
    enrichment: {
      status: hydrationError ? "degraded" : products.length === wanted.size ? "complete" : "partial",
      requested: wanted.size,
      displayed: products.length,
      hydratedHandles: missing.filter((handle) => byHandle.get(handle)?.pricingMode !== "unresolved"),
      unresolvedHandles: [...wanted].filter((handle) => byHandle.get(handle)?.pricingMode === "unresolved"),
      imageMissingHandles: [...wanted].filter((handle) => !byHandle.get(handle)?.imageUrl),
      availabilityUnknownHandles: [...wanted].filter((handle) => byHandle.get(handle)?.availabilityResolved !== true && typeof byHandle.get(handle)?.available !== "boolean"),
      freshnessStatus: hydrationError ? "unverified" : "request_scope_verified",
      error: hydrationError,
      latencyMs: Date.now() - hydrationStartedAt,
    },
  };
}

function latestCompleteQuote(toolResults) {
  return [...toolResults].reverse().find((result) => result?.ok && result?.name === "quote_configuration" && result?.data?.ok)?.data || null;
}

function validatedActions(response, toolResults, message = "") {
  const actions = [];
  for (const proposal of response?.actionProposals || []) {
    if (proposal.type === "add_to_cart") {
      const action = buildCartAction(latestCompleteQuote(toolResults));
      if (action) actions.push(action);
    } else {
      actions.push({ type: proposal.type, label: proposal.label, target: proposal.target || null, payload: {} });
    }
  }
  const quote = latestCompleteQuote(toolResults);
  const explicitQuoteRequest = /\b(?:how much|price|pricing|cost|quote)\b/i.test(clean(message));
  if (explicitQuoteRequest && quote && !actions.some((action) => action.type === "add_to_cart")) {
    const action = buildCartAction(quote);
    if (action) actions.push(action);
  }
  return actions;
}

function aggregateUsage(calls = []) {
  const tokens = calls.reduce((acc, call) => ({
    prompt: acc.prompt + Number(call?.tokens?.prompt || 0),
    cached: acc.cached + Number(call?.tokens?.cached || 0),
    completion: acc.completion + Number(call?.tokens?.completion || 0),
    reasoning: acc.reasoning + Number(call?.tokens?.reasoning || 0),
    total: acc.total + Number(call?.tokens?.total || 0),
  }), { prompt: 0, cached: 0, completion: 0, reasoning: 0, total: 0 });
  tokens.estimatedCostUsd = ((tokens.prompt - Math.min(tokens.prompt, tokens.cached)) * 2 + Math.min(tokens.prompt, tokens.cached) * 0.1 + tokens.completion * 10) / 1_000_000;
  return tokens;
}

function safeFallback({ reason, toolResults = [] } = {}) {
  if (/response_validation:.*(?:price_not_grounded|money_|budget_|hypothetical_|suggested_budget_)/i.test(clean(reason))) {
    return "I couldn't safely verify every amount in that answer, so I left the uncertain amount out. I haven't changed your recommendation or cart. What maximum mattress budget should I use?";
  }
  const discovery = toolResults.find((result) => result?.ok && result?.name === "discover_products" && result?.data?.products?.length);
  if (discovery) {
    const names = discovery.data.products.slice(0, 2).map((item) => item.title).filter(Boolean);
    if (names.length) return `I found ${names.join(" and ")} as grounded options, but I couldn't complete the explanation just now. I can retry without changing your selections.`;
  }
  const emptyDiscovery = toolResults.find((result) => result?.ok && result?.name === "discover_products" && !result?.data?.products?.length);
  if (emptyDiscovery) return "I couldn't find an eligible showroom mattress that matches those constraints, so I won't invent one. We can adjust the budget, size, or another preference and try again.";
  const failedCommerce = toolResults.find((result) => !result?.ok && ["get_live_commerce", "quote_configuration"].includes(result?.name));
  if (failedCommerce) return "I couldn't verify the live price or availability for that setup, so I did not create a quote or cart action. Please try again in a moment.";
  return reason === "model_circuit_open"
    ? "Snoozer is temporarily reconnecting. I haven't changed your recommendations or cart; please try again in a moment."
    : "I couldn't complete that answer reliably, so I stopped instead of guessing. Please try again in a moment.";
}

function withToolDeadline(task, timeoutMs, name) {
  const boundedTimeoutMs = Math.max(1, Math.floor(Number(timeoutMs) || 1));
  const controller = new AbortController();
  let timer;
  let timedOut = false;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(Object.assign(new Error(`${name} exceeded ${boundedTimeoutMs}ms`), { code: "TOOL_TIMEOUT" }));
      resolve({
        ok: false,
        name,
        error: "tool_timeout",
        errorType: "timeout",
        retryable: true,
        evidenceStatus: "failed",
        latencyMs: boundedTimeoutMs,
        aborted: true,
      });
    }, boundedTimeoutMs);
  });
  return Promise.race([
    Promise.resolve().then(() => task(controller.signal)),
    timeout,
  ]).finally(() => {
    clearTimeout(timer);
    if (!timedOut) controller.abort(Object.assign(new Error("tool_complete"), { code: "TOOL_COMPLETE" }));
  });
}

function normalizedToolArguments(name, rawArgs) {
  let value = rawArgs;
  if (typeof rawArgs === "string") {
    try { value = JSON.parse(rawArgs); } catch { value = rawArgs; }
  }
  const normalize = (input, key = "") => {
    if (Array.isArray(input)) {
      const values = input.map((item) => normalize(item));
      return ["productHandles", "factClasses", "exclusions", "pressureAreas"].includes(key)
        ? values.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
        : values;
    }
    if (!input || typeof input !== "object") return typeof input === "string" ? clean(input) : input;
    return Object.keys(input).sort().reduce((out, childKey) => {
      out[childKey] = normalize(input[childKey], childKey);
      return out;
    }, {});
  };
  return `${name}:${JSON.stringify(normalize(value))}`;
}

function createRequestToolExecutor({ deps, deadlineAt }) {
  const cache = new Map();
  const stats = {
    proposalCount: 0,
    executionCount: 0,
    duplicateCallsAvoided: 0,
    evidenceReuseHits: 0,
  };
  const execute = async (name, args, { prepared = false, timeoutMs = 8000 } = {}) => {
    stats.proposalCount += 1;
    const key = normalizedToolArguments(name, args);
    const existing = cache.get(key);
    if (existing) {
      stats.duplicateCallsAvoided += 1;
      stats.evidenceReuseHits += 1;
      const result = await existing;
      return {
        ...result,
        prepared,
        reused: true,
        duplicateSuppressed: true,
        executed: false,
        originalLatencyMs: Number((result.originalLatencyMs ?? result.latencyMs) || 0),
        latencyMs: 0,
      };
    }
    stats.executionCount += 1;
    const remainingMs = Math.max(1, deadlineAt - Date.now());
    const promise = withToolDeadline(
      (signal) => executeConversationTool(name, args, { ...deps, signal }),
      Math.min(timeoutMs, remainingMs),
      name
    ).then((result) => ({
      ...result,
      prepared,
      reused: false,
      duplicateSuppressed: false,
      executed: true,
      originalLatencyMs: Number(result?.latencyMs || 0),
    }));
    cache.set(key, promise);
    return promise;
  };
  return { execute, stats };
}

function normalizedReferenceText(value) {
  return clean(value).toLowerCase().replace(/["”″']/g, " inch ").replace(/[^a-z0-9]+/g, " ").trim();
}

function mentionedApprovedHandles(message = "", manifest = {}) {
  const normalizedMessage = normalizedReferenceText(message);
  if (!normalizedMessage) return [];
  return unique((manifest?.products || [])
    .filter((item) => item?.active !== false)
    .filter((item) => {
      const title = normalizedReferenceText(item?.title);
      const handle = normalizedReferenceText(item?.handle);
      return (title && normalizedMessage.includes(title)) || (handle && normalizedMessage.includes(handle));
    })
    .map((item) => item.handle));
}

function preparedSize(message = "", context = {}) {
  const state = compactConversationState(context);
  const configured = clean(
    context?.activeJourney?.activeConfiguration?.size ||
    context?.askSnoozerWorkingMemory?.activeDeal?.activeConfiguration?.size ||
    Object.values(state.preferences || {}).find((item) => item?.key === "size" && item?.status !== "removed")?.value
  );
  if (configured) return configured;
  const match = clean(message).match(/\b(twin\s*xl|california\s*king|cal\s*king|split\s*king|twin|full|queen|king)\b/i);
  return match ? match[1].replace(/\s+/g, " ") : null;
}

function preparedMotionKey(message = "", context = {}) {
  const configured = clean(
    context?.activeJourney?.activeConfiguration?.motionKey ||
    context?.activeJourney?.activeConfiguration?.motionConfiguration ||
    context?.askSnoozerWorkingMemory?.activeDeal?.activeConfiguration?.motionKey ||
    context?.askSnoozerWorkingMemory?.activeDeal?.activeConfiguration?.motionConfiguration
  ).toLowerCase();
  if (configured) return configured;
  const normalized = normalizedReferenceText(message);
  if (/\bhalf split motion\b/.test(normalized)) return "half_split";
  if (/\bfull split motion\b/.test(normalized)) return "full_split";
  if (/\bstandard motion\b/.test(normalized)) return "standard";
  return null;
}

function preparedConfiguration(message = "", context = {}, manifest = {}, handles = []) {
  const definitions = new Map((manifest?.products || []).map((item) => [clean(item?.handle).toLowerCase(), item]));
  const mattressHandle = handles.find((handle) => definitions.get(handle)?.catalogType === "mattress") || null;
  const baseHandle = handles.find((handle) => definitions.get(handle)?.catalogType === "base") || null;
  const size = preparedSize(message, context);
  const motionKey = preparedMotionKey(message, context);
  const deal = context?.askSnoozerWorkingMemory?.activeDeal || {};
  const baseDecision = clean(
    context?.activeJourney?.activeConfiguration?.baseDecision ||
    deal?.activeConfiguration?.baseDecision ||
    deal?.baseDecision
  ).toLowerCase();
  const mattressOnly = baseDecision === "mattress_only" ||
    /\b(?:mattress[- ]only|just (?:the )?mattress|only (?:the )?mattress|without (?:the )?(?:(?:motion|adjustable) )?base|skip (?:the )?(?:(?:motion|adjustable) )?base)\b/i.test(clean(message));
  if (mattressHandle && size && mattressOnly) {
    return { mattressHandle, baseHandle: null, size, motionKey: "none" };
  }
  return mattressHandle && baseHandle && size && motionKey
    ? { mattressHandle, baseHandle, size, motionKey }
    : null;
}

function amountKey(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : null;
}

function dollarAmounts(value) {
  return [...clean(value).matchAll(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/g)]
    .map((match) => amountKey(match[1].replace(/,/g, "")))
    .filter(Boolean);
}

function statementAmounts(value) {
  const text = clean(value).toLowerCase();
  const amounts = new Set(dollarAmounts(text));
  for (const match of text.matchAll(/\b([0-9][0-9,]{2,})(?:\.\d{1,2})?\b/g)) {
    const amount = amountKey(match[1].replace(/,/g, ""));
    if (amount) amounts.add(amount);
  }
  const small = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  };
  for (const match of text.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(grand|thousand|hundred)\b/g)) {
    const multiplier = match[2] === "hundred" ? 100 : 1000;
    amounts.add(amountKey(small[match[1]] * multiplier));
  }
  return amounts;
}

function replyHasEvidence(reply, evidence) {
  const haystack = clean(reply).toLowerCase().replace(/\s+/g, " ");
  const needle = clean(evidence).toLowerCase().replace(/\s+/g, " ");
  return Boolean(needle && haystack.includes(needle));
}

function shopperHasEvidence(message, evidence) {
  const haystack = clean(message).toLowerCase().replace(/\s+/g, " ");
  const needle = clean(evidence).toLowerCase().replace(/\s+/g, " ");
  return Boolean(needle && haystack.includes(needle));
}

function commerceCards(toolResults = [], sourceTool = "") {
  const cards = [];
  for (const result of toolResults) {
    if (!result?.ok || (sourceTool && result.name !== sourceTool)) continue;
    if (result.name === "quote_configuration") {
      for (const item of result?.data?.items || []) {
        cards.push({
          tool: result.name,
          card: {
            ...item,
            exactVariantResolved: true,
            priceRange: {
              min: item?.price,
              max: item?.price,
              currencyCode: item?.currencyCode || result?.data?.currencyCode || "USD",
            },
          },
        });
      }
      continue;
    }
    if (!["discover_products", "get_live_commerce"].includes(result.name)) continue;
    for (const item of result?.data?.products || []) {
      cards.push({ tool: result.name, card: item?.commerce?.handle ? item.commerce : item });
    }
  }
  return cards;
}

function verifiedMonetaryClaim(claim = {}, toolResults = []) {
  const semantic = clean(claim.semantic);
  const expected = amountKey(claim.amount);
  const sourceTool = clean(claim.sourceTool);
  const sourceKey = clean(claim.sourceKey).toLowerCase();
  const currencyCode = clean(claim.currencyCode).toUpperCase();
  if (!expected || !sourceTool || !sourceKey || !currencyCode) return false;
  if (semantic === "verified_bundle_subtotal") {
    return toolResults.some((result) => (
      result?.ok && result.name === sourceTool && result.name === "quote_configuration" &&
      result?.data?.ok === true && result?.data?.cartReady === true &&
      amountKey(result?.data?.subtotal) === expected &&
      clean(result?.data?.currencyCode || "USD").toUpperCase() === currencyCode
    ));
  }
  return commerceCards(toolResults, sourceTool).some(({ card }) => {
    const handle = clean(card?.handle).toLowerCase();
    if (!handle || ![sourceKey, clean(claim.productHandle).toLowerCase()].filter(Boolean).includes(handle)) return false;
    if (clean(card?.currencyCode || card?.priceRange?.currencyCode || "USD").toUpperCase() !== currencyCode) return false;
    const exact = card?.exactVariantResolved === true && amountKey(card?.price) === expected;
    const starting = card?.pricingMode === "starting_at" && amountKey(card?.priceRange?.min) === expected;
    const product = exact || (
      amountKey(card?.priceRange?.min) === expected &&
      amountKey(card?.priceRange?.max) === expected
    );
    if (semantic === "verified_exact_variant_price") return exact;
    if (semantic === "verified_starting_at_price") return starting;
    return semantic === "verified_product_price" && product;
  });
}

function validateReplyMonetaryClaims(response = {}, toolResults = [], message = "") {
  const errors = [];
  const reply = clean(response?.reply);
  const replyAmounts = dollarAmounts(reply);
  const claims = Array.isArray(response?.monetaryClaims) ? response.monetaryClaims : [];
  const currentMessageAmounts = statementAmounts(message);
  const verifiedKinds = new Set([
    "verified_product_price", "verified_starting_at_price", "verified_exact_variant_price", "verified_bundle_subtotal",
  ]);
  for (const amount of replyAmounts) {
    if (!claims.some((claim) => amountKey(claim?.amount) === amount)) errors.push(`money_provenance_missing:${amount}`);
  }
  for (const claim of claims) {
    const semantic = clean(claim?.semantic);
    const amount = amountKey(claim?.amount);
    if (!amount) {
      errors.push("money_amount_invalid");
      continue;
    }
    if (!replyAmounts.includes(amount) || !replyHasEvidence(reply, claim?.evidence) || !dollarAmounts(claim?.evidence).includes(amount)) {
      errors.push(`money_reply_evidence_missing:${amount}`);
      continue;
    }
    if (verifiedKinds.has(semantic)) {
      if (!verifiedMonetaryClaim(claim, toolResults)) errors.push(`price_not_grounded:${amount}`);
      continue;
    }
    if (["shopper_budget", "hypothetical_spending_example"].includes(semantic)) {
      const shopperEvidence = clean(claim?.shopperEvidence);
      const replyEvidence = clean(claim?.evidence);
      if (
        clean(claim?.productHandle) || clean(claim?.sourceTool) || clean(claim?.sourceKey) ||
        !shopperHasEvidence(message, shopperEvidence) ||
        !statementAmounts(shopperEvidence).has(amount) ||
        !currentMessageAmounts.has(amount) ||
        !/\b(?:budget|maximum|under|below|up to|spend|range|target|cap|limit|hypothetical)\b/i.test(replyEvidence) ||
        /\b(?:costs?|priced|price is|sells? for)\b/i.test(replyEvidence)
      ) {
        errors.push(`budget_not_grounded:${amount}`);
      } else if (
        semantic === "hypothetical_spending_example" &&
        !/\b(?:what if|would|could|suppose|hypothetical|if i|if we)\b/i.test(message)
      ) {
        errors.push(`hypothetical_not_grounded:${amount}`);
      }
      continue;
    }
    if (semantic === "suggested_budget_threshold") {
      const evidence = clean(claim?.evidence);
      if (
        clean(claim?.productHandle) || clean(claim?.sourceTool) || clean(claim?.sourceKey) || clean(claim?.shopperEvidence) ||
        !/\b(?:budget|maximum|under|below|up to|spend|range|target|cap)\b/i.test(evidence) ||
        /\b(?:costs?|priced|price is|sells? for)\b/i.test(evidence)
      ) {
        errors.push(`suggested_budget_invalid:${amount}`);
      }
      continue;
    }
    errors.push(`${semantic === "unverified_product_price" ? "price_not_grounded" : "money_semantic_invalid"}:${amount}`);
  }
  return unique(errors);
}

function toolTelemetrySummary(result = {}) {
  const data = result?.data || {};
  if (result?.name === "discover_products") {
    return {
      productCount: Array.isArray(data.products) ? data.products.length : 0,
      productHandles: (data.products || []).map((item) => item?.handle || item?.commerce?.handle).filter(Boolean).slice(0, 6),
      limitationCount: Array.isArray(data.limitations) ? data.limitations.length : 0,
    };
  }
  if (result?.name === "get_product_facts") {
    return { productFactCount: Array.isArray(data.productFacts) ? data.productFacts.length : 0 };
  }
  if (result?.name === "get_live_commerce") {
    return {
      productCount: Array.isArray(data.products) ? data.products.length : 0,
      missingCount: Array.isArray(data.missingHandles) ? data.missingHandles.length : 0,
    };
  }
  if (result?.name === "quote_configuration") {
    return { status: data.status || null, cartReady: data.cartReady === true };
  }
  return null;
}

function hasUsableNonDiscoveryEvidence(result = {}) {
  if (!result?.ok) return false;
  const data = result.data || {};
  if (["get_policy", "get_rewards", "get_cart"].includes(result.name)) return Object.keys(data).length > 0;
  if (result.name === "quote_configuration") return Boolean(data.status || data.compatibility?.status);
  if (result.name === "get_live_commerce") return Array.isArray(data.products) && data.products.length > 0;
  if (result.name === "get_product_facts") return Array.isArray(data.productFacts) && data.productFacts.length > 0;
  return false;
}

async function runSnoozerConversationCore({
  requestId, message = "", history = [], context = {}, event = null, identity = null,
  shopify, rewardsService = null, log = () => {}, runtime = callOpenAIResponses,
  env = process.env, toolOverrides = {}, remainingTimeMs = null,
} = {}) {
  const startedAt = Date.now();
  const config = getConversationCoreConfig(env);
  const lambdaBudgetMs = remainingTimeMs !== null && remainingTimeMs !== undefined && Number.isFinite(Number(remainingTimeMs))
    ? Math.max(0, Number(remainingTimeMs) - 5000)
    : Number.MAX_SAFE_INTEGER;
  const deadlineAt = startedAt + Math.min(config.totalTimeoutMs, lambdaBudgetMs);
  if (config.model !== EXPECTED_MODEL) {
    const error = new Error(`Conversation Core requires ${EXPECTED_MODEL}; configured model is ${config.model || "missing"}.`);
    error.code = "CONVERSATION_CORE_MODEL_MISMATCH";
    throw error;
  }
  if (lambdaBudgetMs < RESPONSE_RESERVE_MS + 750) {
    return fallbackResult("lambda_deadline_insufficient", [], [], config, startedAt);
  }
  if (!circuitAvailable(config)) return fallbackResult("model_circuit_open", [], [], config, startedAt);

  const manifest = toolOverrides.manifest || loadShowroomManifest();
  const toolResults = [];
  let toolExecutionMs = 0;
  const toolExecutor = createRequestToolExecutor({
    deps: { event, identity, shopify, rewardsService, manifest, ...toolOverrides },
    deadlineAt,
  });
  const rejected = new Set(compactConversationState(context).rejectedProductHandles || []);
  const historicalProductRecall = /\b(?:original|originally|assessment)\b.*\b(?:recommend|recommended|recommendation|suggested)\b|\b(?:recommend|recommended|recommendation|suggested)\b.*\b(?:original|originally|assessment)\b/i.test(message);
  const canonicalRecommendationHandles = historicalProductRecall ? [
    context?.activeJourney?.canonicalRecommendation?.primaryMattressHandle,
    context?.canonicalRecommendation?.primaryMattressHandle,
  ] : [];
  const preparedHandles = unique([
    ...existingReferenceHandles(context),
    ...canonicalRecommendationHandles,
    ...mentionedApprovedHandles(message, manifest),
  ])
    .filter((handle) => historicalProductRecall || !rejected.has(handle))
    .slice(0, 4);
  const activeSize = preparedSize(message, context);
  const activeConfiguration = preparedConfiguration(message, context, manifest, preparedHandles);
  let preparedEvidence = [];
  if (preparedHandles.length) {
    const preparedStartedAt = Date.now();
    const preparedRequests = [
      ["get_product_facts", {
        productHandles: preparedHandles,
        factClasses: ["product_features", "comfort", "support", "temperature", "partner_fit"],
      }],
      ...(activeConfiguration ? [["quote_configuration", activeConfiguration]] : activeSize ? [["get_live_commerce", {
        productHandles: preparedHandles,
        size: activeSize,
        motionKey: null,
      }]] : []),
    ];
    const preparedBudgetMs = Math.max(1, Math.min(8000, deadlineAt - Date.now() - RESPONSE_RESERVE_MS));
    const preparedResults = await Promise.all(preparedRequests.map(([name, args]) => (
      toolExecutor.execute(name, args, { prepared: true, timeoutMs: preparedBudgetMs })
    )));
    toolResults.push(...preparedResults);
    preparedEvidence = preparedResults.filter((result) => result.ok).map((result) => JSON.parse(toolOutputForModel(result)));
    toolExecutionMs += Date.now() - preparedStartedAt;
  }
  const preModelMs = Date.now() - startedAt;
  const envelope = buildConversationEnvelope({ message, context, history, manifest, preparedEvidence });
  const input = [{ role: "user", content: JSON.stringify(envelope) }];
  const modelCalls = [];
  let toolRounds = 0;
  let totalToolCalls = 0;
  let finalValidation = null;
  let failureReason = null;
  let recoveryAttempts = 0;
  let recoveryKind = null;
  let provenanceMetadataRepairs = 0;
  let validationMs = 0;
  let productHydrationMs = 0;
  let transportFailure = null;
  try {
    while (modelCalls.length < config.maxToolRounds + 2) {
      const remaining = deadlineAt - Date.now();
      if (remaining < RESPONSE_RESERVE_MS + 500) { failureReason = "conversation_core_deadline"; break; }
      const modelStartedAt = Date.now();
      const response = await runtime({
        reqId: `${requestId || "conversation_core"}_${modelCalls.length + 1}`,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        instructions: buildCoreInstructions(),
        input,
        tools: conversationToolDefinitions,
        text: {
          verbosity: "low",
          format: { type: "json_schema", name: "snoozer_conversation_response", strict: true, schema: snoozerConversationModelSchema },
        },
        maxOutputTokens: 1800,
        timeoutMs: Math.min(config.modelTimeoutMs, Math.max(500, remaining - RESPONSE_RESERVE_MS)),
        deadlineAt,
        telemetryContext: {
          circuitState: modelCircuit.openedAt ? "open" : modelCircuit.failures ? "degraded" : "closed",
          verifiedRetrievalCompleted: toolResults.some((result) => result?.ok),
          consequentialActionStarted: false,
          recoveryResult: recoveryAttempts ? "correction_in_progress" : null,
        },
        parallelToolCalls: true,
        store: false,
      });
      modelCalls.push({ ...response, latencyMs: Date.now() - modelStartedAt });
      noteModelSuccess();
      if (response.functionCalls.length) {
        if (toolRounds >= config.maxToolRounds) { failureReason = "tool_round_limit"; break; }
        if (totalToolCalls + response.functionCalls.length > config.maxToolCalls) { failureReason = "tool_call_limit"; break; }
        toolRounds += 1;
        totalToolCalls += response.functionCalls.length;
        input.push(...response.output);
        const toolBudgetMs = Math.max(1, Math.min(8000, deadlineAt - Date.now() - RESPONSE_RESERVE_MS));
        const toolRoundStartedAt = Date.now();
        const results = await Promise.all(response.functionCalls.map((call) => (
          toolExecutor.execute(call.name, call.arguments, { timeoutMs: toolBudgetMs })
        )));
        toolExecutionMs += Date.now() - toolRoundStartedAt;
        toolResults.push(...results);
        response.functionCalls.forEach((call, index) => input.push({
          type: "function_call_output", call_id: call.callId, output: toolOutputForModel(results[index]),
        }));
        continue;
      }
      const validationStartedAt = Date.now();
      const validationOptions = {
        message,
        groundedProductHandles: unique(toolResults.flatMap(groundedHandlesFromToolResult)),
        existingReferenceHandles: existingReferenceHandles(context),
        rejectedProductHandles: compactConversationState(context).rejectedProductHandles,
        successfulTools: toolResults.filter((result) => result.ok).map((result) => result.name),
        successfulToolResults: toolResults.filter((result) => result.ok),
        manifest,
      };
      finalValidation = validateConversationResponse(response.text, validationOptions);
      const provenanceErrors = unique(finalValidation.errors).filter((error) => /^claim_source_(?:missing|invalid):/.test(error));
      if (provenanceErrors.length) {
        const repaired = repairClaimSourceMetadata(finalValidation.value, toolResults, provenanceErrors, manifest);
        if (repaired.repairCount > 0) {
          provenanceMetadataRepairs += repaired.repairCount;
          finalValidation = validateConversationResponse(repaired.value, validationOptions);
        }
      }
      if (
        finalValidation.value?.fallback?.used === true &&
        toolResults.some(hasUsableNonDiscoveryEvidence)
      ) {
        finalValidation.value.fallback = { used: false, reason: null };
        finalValidation.value.responseMode = "answer";
        finalValidation.value.state = "speaking";
        finalValidation.value.priority = "normal";
        finalValidation.value.ttlMs = 5000;
      }
      const responseText = clean(response.text);
      if (!context?.assessment && /\b(?:your|the) assessment\b|originally recommended from your assessment/i.test(responseText)) finalValidation.errors.push("fabricated_assessment_history");
      if (/\b(?:will|guaranteed to) cure\b/i.test(responseText)) finalValidation.errors.push("medical_guarantee");
      finalValidation.errors.push(...validateReplyMonetaryClaims(finalValidation.value, toolResults, message));
      validationMs += Date.now() - validationStartedAt;
      const discoveredProducts = toolResults
        .filter((result) => result?.ok && result?.name === "discover_products")
        .flatMap((result) => result?.data?.products || []);
      if (finalValidation.value?.fallback?.used === true && discoveredProducts.length > 0) {
        finalValidation.errors.push("fallback_contradicts_grounded_products");
      }
      finalValidation.valid = finalValidation.errors.length === 0;
      if (!finalValidation.valid) {
        const monetaryErrors = unique(finalValidation.errors).filter((error) => (
          /^(?:price_not_grounded|money_|budget_|hypothetical_|suggested_budget_)/.test(error)
        ));
        if (
          monetaryErrors.length &&
          recoveryAttempts < 1 &&
          modelCalls.length < config.maxToolRounds + 1 &&
          deadlineAt - Date.now() >= 3000
        ) {
          recoveryAttempts += 1;
          recoveryKind = "monetary_claim_correction";
          input.push(...response.output);
          input.push({
            role: "user",
            content: `Correction required: ${monetaryErrors.join(", ")}. Rebuild the answer using the authoritative commerce evidence already supplied. Every dollar amount needs accurate monetaryClaims provenance. Do not relabel a product price as a budget or hypothetical amount. Omit any unsupported amount, preserve valid guidance and state proposals only if still supported, and return the strict structured response without requesting another tool unless evidence is actually missing.`,
          });
          continue;
        }
        const provenanceErrors = unique(finalValidation.errors).filter((error) => /^claim_source_(?:missing|invalid):/.test(error));
        if (
          provenanceErrors.length &&
          toolResults.some(hasUsableNonDiscoveryEvidence) &&
          recoveryAttempts < 1 &&
          modelCalls.length < config.maxToolRounds + 1 &&
          deadlineAt - Date.now() >= 3000
        ) {
          recoveryAttempts += 1;
          recoveryKind = "claim_provenance_correction";
          const sourceHints = claimSourceHints(toolResults);
          input.push(...response.output);
          input.push({
            role: "user",
            content: `Correction required: ${provenanceErrors.join(", ")}. Rebuild the answer using only the authoritative evidence already supplied. Every non-general claim must use the successful source tool and one of these exact allowed source keys: ${sourceHints || "none"}. For product-specific claims, prefer that product's exact handle. Compatibility claims require quote_configuration evidence for the exact mattress, base, size, and motion. Remove or state unknown for any unsupported claim. Do not invent a source key, product fact, compatibility result, price, or availability. Return the strict structured response.`,
          });
          continue;
        }
        if (
          finalValidation.errors.includes("fallback_contradicts_grounded_products") &&
          modelCalls.length < config.maxToolRounds + 1 &&
          deadlineAt - Date.now() >= 2500
        ) {
          input.push(...response.output);
          input.push({
            role: "user",
            content: "Correction required: discover_products returned approved eligible products. Do not use a no-products fallback. Answer from the verified fields already supplied, keep unknown details unknown, and return the strict structured response.",
          });
          continue;
        }
        noteModelFailure(config);
        failureReason = `response_validation:${unique(finalValidation.errors).join(",")}`;
        break;
      }
      const validated = finalValidation.value;
      const hydrationStartedAt = Date.now();
      const productResult = await responseProducts(validated, toolResults, manifest, { shopify, context, message });
      productHydrationMs += Date.now() - hydrationStartedAt;
      const finalTelemetry = telemetry({
        config, modelCalls, toolResults, toolRounds, totalToolCalls, startedAt, finalValidation,
        recoveryAttempts, recoverySucceeded: recoveryAttempts > 0, preModelMs, validationMs, productHydrationMs, toolExecutionMs,
        recoveryKind,
        toolExecutionStats: toolExecutor.stats,
      });
      finalTelemetry.cardPresentation = productResult.presentation;
      finalTelemetry.cardEnrichment = productResult.enrichment;
      finalTelemetry.provenanceMetadataRepairs = provenanceMetadataRepairs;
      finalTelemetry.preparedContext = {
        enabled: preparedHandles.length > 0,
        handles: preparedHandles,
        size: activeSize,
        configurationPrepared: Boolean(activeConfiguration),
        tools: toolResults.filter((result) => result.prepared).map((result) => ({ name: result.name, ok: result.ok, latencyMs: result.latencyMs })),
        ok: toolResults.filter((result) => result.prepared).every((result) => result.ok),
        latencyMs: Math.max(0, ...toolResults.filter((result) => result.prepared).map((result) => Number(result.latencyMs || 0))),
      };
      return {
        ok: true,
        status: validated.fallback.used ? "fallback" : "answered",
        ...validated,
        products: productResult.products,
        actions: validatedActions(validated, toolResults, message),
        quote: latestCompleteQuote(toolResults),
        toolResults,
        stateValidation: finalValidation.stateValidation,
        telemetry: finalTelemetry,
      };
    }
  } catch (error) {
    noteModelFailure(config);
    failureReason = clean(error?.code || error?.message || "model_failure");
    transportFailure = error?.openaiFailure || null;
    log("ask-snoozer.conversation-core", "model_failure", { requestId, failureReason, model: config.model, transportFailure });
  }
  return fallbackResult(
    failureReason || "conversation_core_failure", toolResults, modelCalls, config, startedAt,
    finalValidation, toolRounds, totalToolCalls, recoveryAttempts, {
      preModelMs, validationMs, productHydrationMs, toolExecutionMs, transportFailure,
      recoveryKind,
      toolExecutionStats: toolExecutor.stats,
    }
  );
}

function telemetry({
  config, modelCalls, toolResults, toolRounds, totalToolCalls, startedAt, finalValidation,
  fallbackReason = null, recoveryAttempts = 0, recoverySucceeded = false,
  recoveryKind = null,
  preModelMs = 0, validationMs = 0, productHydrationMs = 0, toolExecutionMs = 0, transportFailure = null,
  toolExecutionStats = {},
}) {
  const retrievalWorkMs = toolResults
    .filter((result) => result?.executed !== false)
    .reduce((sum, result) => sum + Number(result.originalLatencyMs ?? result.latencyMs ?? 0), 0);
  return {
    coreVersion: CONVERSATION_CORE_VERSION, mode: config.mode, model: config.model, reasoningEffort: config.reasoningEffort,
    modelCallCount: modelCalls.length, modelMs: modelCalls.reduce((sum, call) => sum + call.latencyMs, 0),
    toolRounds,
    toolCallCount: totalToolCalls,
    toolProposalCount: Number(toolExecutionStats.proposalCount || totalToolCalls),
    toolExecutionCount: Number(toolExecutionStats.executionCount || 0),
    duplicateCallsAvoided: Number(toolExecutionStats.duplicateCallsAvoided || 0),
    preparedEvidenceHits: Number(toolExecutionStats.evidenceReuseHits || 0),
    tools: toolResults.map((result) => ({
      name: result.name,
      ok: result.ok,
      latencyMs: result.latencyMs,
      originalLatencyMs: result.originalLatencyMs ?? result.latencyMs,
      evidenceStatus: result.evidenceStatus || (result.ok ? "verified" : "failed"),
      errorType: result.ok ? null : result.errorType || "unknown",
      retryable: result.retryable === true,
      prepared: result.prepared === true,
      reused: result.reused === true,
      duplicateSuppressed: result.duplicateSuppressed === true,
      error: result.ok ? null : result.error,
      summary: result.ok ? toolTelemetrySummary(result) : null,
    })),
    retrievalMs: toolExecutionMs,
    retrievalWallMs: toolExecutionMs,
    retrievalWorkMs,
    totalMs: Date.now() - startedAt, usage: aggregateUsage(modelCalls),
    lifecycle: {
      preModelMs,
      toolExecutionMs,
      validationMs,
      productHydrationMs,
      postModelMs: Math.max(0, Date.now() - startedAt - modelCalls.reduce((sum, call) => sum + call.latencyMs, 0)),
    },
    transportFailure,
    validationErrors: finalValidation?.errors || [],
    acceptedStateProposals: finalValidation ? finalValidation.stateValidation.acceptedPreferenceCount + finalValidation.stateValidation.acceptedDecisionCount : 0,
    rejectedStateProposals: finalValidation ? finalValidation.stateValidation.rejectedPreferences.length + finalValidation.stateValidation.rejectedDecisions.length : 0,
    fallbackReason,
    recovery: {
      attempted: recoveryAttempts > 0,
      attempts: recoveryAttempts,
      succeeded: recoverySucceeded === true,
      kind: recoveryAttempts > 0 ? recoveryKind || "model_correction" : null,
    },
  };
}

function fallbackResult(reason, toolResults, modelCalls, config, startedAt, finalValidation = null, toolRounds = 0, totalToolCalls = 0, recoveryAttempts = 0, extraTelemetry = {}) {
  const reply = safeFallback({ reason, toolResults });
  const verifiedProducts = toolResults
    .filter((result) => result?.ok && ["discover_products", "get_live_commerce"].includes(result.name))
    .flatMap((result) => result?.data?.products || [])
    .map((item) => item?.commerce || item)
    .filter((item) => item?.handle)
    .slice(0, 2);
  return {
    ok: false, status: "fallback", reply, speech: reply, captions: reply, state: "warning", priority: "high", ttlMs: 7000,
    responseMode: "safe_fallback", productHandles: verifiedProducts.map((item) => item.handle), products: verifiedProducts, chips: [], actionProposals: [], actions: [], preferences: [], decisions: [], references: {}, claims: [], monetaryClaims: [],
    fallback: { used: true, reason }, quote: null, toolResults, stateValidation: finalValidation?.stateValidation || null,
    telemetry: telemetry({
      config, modelCalls, toolResults, toolRounds, totalToolCalls, startedAt, finalValidation,
      fallbackReason: reason, recoveryAttempts, recoverySucceeded: false, ...extraTelemetry,
    }),
  };
}

module.exports = {
  CONVERSATION_CORE_VERSION,
  EXPECTED_MODEL,
  buildConversationEnvelope,
  cardPresentationPolicy,
  composeTrustedAdvisorResponse,
  getConversationCoreConfig,
  isConversationCoreActive,
  loadTrustedAdvisorFactPack,
  parseTrustedAdvisorComposition,
  planTrustedAdvisorTurnWithModel,
  responseProducts,
  runSnoozerConversationCore,
  validateReplyMonetaryClaims,
  withToolDeadline,
};
