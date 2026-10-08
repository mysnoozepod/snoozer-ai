const { loadTrustedAdvisorFactPack } = require("./askSnoozerAdvisorFactPack");
const { composeTrustedAdvisorResponse, parseTrustedAdvisorComposition } = require("./askSnoozerModelComposer");
const { planTrustedAdvisorTurnWithModel } = require("./askSnoozerModelPlannerRuntime");
const { FINAL_MODEL, FINAL_REASONING_EFFORT, callOpenAIResponses } = require("./openaiModelRuntime");
const { loadShowroomManifest } = require("./showroomManifest");
const { snoozerConversationModelSchema, validateConversationResponse } = require("./askSnoozerConversationContracts");
const { conversationToolDefinitions, executeConversationTool, groundedHandlesFromToolResult } = require("./askSnoozerConversationTools");
const { compactConversationState, existingReferenceHandles, normalizedConversationHistory } = require("./askSnoozerConversationState");
const { buildCartAction } = require("./askSnoozerConfigurationQuote");

const CONVERSATION_CORE_VERSION = "conversation-core.v1";
const EXPECTED_MODEL = "gpt-6.1-sol";
let modelCircuit = { failures: 0, openedAt: 0 };

function clean(value) { return String(value == null ? "" : value).trim(); }
function unique(values = []) { return [...new Set(values.map((value) => clean(value).toLowerCase()).filter(Boolean))]; }
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
      env.ASK_SNOOZER_CONVERSATION_CORE_MODEL_TIMEOUT_MS || (Number(env.MODEL_TIMEOUT_MS) - 1000),
      25000,
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

function buildConversationEnvelope({ message = "", context = {}, history = [], manifest = loadShowroomManifest() } = {}) {
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
    approvedProducts: (manifest?.products || []).filter((item) => item?.active !== false).map((item) => ({
      handle: item.handle, title: item.title, category: item.catalogType, family: item.family,
    })),
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
    "Never invent a product, handle, fact, price, variant, availability state, policy, assessment, recommendation, quote, or commitment.",
    "Live commerce tool results control price, variants, availability, cart, and checkout. Curated facts control product attributes. Missing facts remain unknown.",
    "Answer completely and give a clear recommendation when grounded evidence supports one.",
    "Do not claim an assessment or prior recommendation unless it exists in journey or conversation state.",
    "Hypothetical and conditional language is non-mutating. Only propose accepted, rejected, or cart-confirmed decisions when explicitly stated.",
    "For every preference or decision proposal, copy a short exact phrase from the current shopper message into evidence.",
    "A product mentioned as an example is not automatically recommended. A rejected product stays rejected unless explicitly restored.",
    "Never promise medical outcomes. Give qualified product guidance and recommend medical evaluation for worsening or significant pain.",
    "Do not expose internal terms such as model, tool, API, database, Shopify, S3, source of truth, backend, or resolver.",
    "If a source fails, state the exact shopper-facing limitation. Clarify only genuine ambiguity.",
    "Keep the shopper-facing reply concise, normally no more than 120 words, while still answering every part of the request.",
    "Return the strict structured response. The server derives speech, captions, and HUD delivery fields. Product handles must come from tool results or the supplied reference ledger.",
    "Every non-general claim must cite the successful source tool and source key.",
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
    };
  }
  return JSON.stringify({
    ok: Boolean(result?.ok), tool: clean(result?.name),
    ...(result?.ok ? { data } : { error: clean(result?.error || "tool_failed") }),
  }).slice(0, 12000);
}

function responseProducts(response, toolResults, manifest = {}) {
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
    });
  }
  return [...wanted].map((handle) => byHandle.get(handle)).filter(Boolean);
}

function latestCompleteQuote(toolResults) {
  return [...toolResults].reverse().find((result) => result?.ok && result?.name === "quote_configuration" && result?.data?.ok)?.data || null;
}

function validatedActions(response, toolResults) {
  const actions = [];
  for (const proposal of response?.actionProposals || []) {
    if (proposal.type === "add_to_cart") {
      const action = buildCartAction(latestCompleteQuote(toolResults));
      if (action) actions.push(action);
    } else {
      actions.push({ type: proposal.type, label: proposal.label, target: proposal.target || null, payload: {} });
    }
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

function withToolDeadline(promise, timeoutMs, name) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, name, error: "tool_timeout", latencyMs: timeoutMs }), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function verifiedPriceAmounts(toolResults = []) {
  const values = new Set();
  const visit = (value, key = "") => {
    if (value == null) return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key));
    if (typeof value === "object") return Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
    if (/price|subtotal|amount|total/i.test(key) && Number.isFinite(Number(value))) {
      values.add(Number(value).toFixed(2));
    }
  };
  for (const result of toolResults.filter((item) => item?.ok)) visit(result.data);
  return values;
}

function validateReplyPriceClaims(response = {}, toolResults = [], message = "") {
  const verified = verifiedPriceAmounts(toolResults);
  const sourceAmounts = [...verified].map(Number).filter(Number.isFinite);
  for (let left = 0; left < sourceAmounts.length; left += 1) {
    for (let right = left + 1; right < sourceAmounts.length; right += 1) {
      verified.add(Math.abs(sourceAmounts[left] - sourceAmounts[right]).toFixed(2));
    }
  }
  for (const match of clean(message).matchAll(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/g)) {
    verified.add(Number(match[1].replace(/,/g, "")).toFixed(2));
  }
  const prices = [...clean(response?.reply).matchAll(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/g)]
    .map((match) => Number(match[1].replace(/,/g, "")).toFixed(2));
  return unique(prices.filter((price) => !verified.has(price))).map((price) => `price_not_grounded:${price}`);
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
  env = process.env, toolOverrides = {},
} = {}) {
  const startedAt = Date.now();
  const config = getConversationCoreConfig(env);
  const deadlineAt = startedAt + config.totalTimeoutMs;
  if (config.model !== EXPECTED_MODEL) {
    const error = new Error(`Conversation Core requires ${EXPECTED_MODEL}; configured model is ${config.model || "missing"}.`);
    error.code = "CONVERSATION_CORE_MODEL_MISMATCH";
    throw error;
  }
  if (!circuitAvailable(config)) return fallbackResult("model_circuit_open", [], [], config, startedAt);

  const manifest = toolOverrides.manifest || loadShowroomManifest();
  const envelope = buildConversationEnvelope({ message, context, history, manifest });
  const input = [{ role: "user", content: JSON.stringify(envelope) }];
  const modelCalls = [];
  const toolResults = [];
  let toolRounds = 0;
  let totalToolCalls = 0;
  let finalValidation = null;
  let failureReason = null;
  try {
    while (modelCalls.length < config.maxToolRounds + 2) {
      const remaining = config.totalTimeoutMs - (Date.now() - startedAt);
      if (remaining < 750) { failureReason = "conversation_core_deadline"; break; }
      const modelStartedAt = Date.now();
      const response = await runtime({
        reqId: `${requestId || "conversation_core"}_${modelCalls.length + 1}`,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        instructions: buildCoreInstructions(),
        input,
        tools: conversationToolDefinitions,
        text: { format: { type: "json_schema", name: "snoozer_conversation_response", strict: true, schema: snoozerConversationModelSchema } },
        maxOutputTokens: 2600,
        timeoutMs: Math.min(config.modelTimeoutMs, remaining),
        deadlineAt,
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
        const toolBudgetMs = Math.max(250, Math.min(8000, config.totalTimeoutMs - (Date.now() - startedAt) - 500));
        const results = await Promise.all(response.functionCalls.map((call) => withToolDeadline(
          executeConversationTool(call.name, call.arguments, {
            event, identity, shopify, rewardsService, manifest, ...toolOverrides,
          }),
          toolBudgetMs,
          call.name
        )));
        toolResults.push(...results);
        response.functionCalls.forEach((call, index) => input.push({
          type: "function_call_output", call_id: call.callId, output: toolOutputForModel(results[index]),
        }));
        continue;
      }
      finalValidation = validateConversationResponse(response.text, {
        message,
        groundedProductHandles: unique(toolResults.flatMap(groundedHandlesFromToolResult)),
        existingReferenceHandles: existingReferenceHandles(context),
        rejectedProductHandles: compactConversationState(context).rejectedProductHandles,
        successfulTools: toolResults.filter((result) => result.ok).map((result) => result.name),
        manifest,
      });
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
      finalValidation.errors.push(...validateReplyPriceClaims(finalValidation.value, toolResults, message));
      const discoveredProducts = toolResults
        .filter((result) => result?.ok && result?.name === "discover_products")
        .flatMap((result) => result?.data?.products || []);
      if (finalValidation.value?.fallback?.used === true && discoveredProducts.length > 0) {
        finalValidation.errors.push("fallback_contradicts_grounded_products");
      }
      finalValidation.valid = finalValidation.errors.length === 0;
      if (!finalValidation.valid) {
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
      return {
        ok: true,
        status: validated.fallback.used ? "fallback" : "answered",
        ...validated,
        products: responseProducts(validated, toolResults, manifest),
        actions: validatedActions(validated, toolResults),
        quote: latestCompleteQuote(toolResults),
        toolResults,
        stateValidation: finalValidation.stateValidation,
        telemetry: telemetry({ config, modelCalls, toolResults, toolRounds, totalToolCalls, startedAt, finalValidation }),
      };
    }
  } catch (error) {
    noteModelFailure(config);
    failureReason = clean(error?.code || error?.message || "model_failure");
    log("ask-snoozer.conversation-core", "model_failure", { requestId, failureReason, model: config.model });
  }
  return fallbackResult(failureReason || "conversation_core_failure", toolResults, modelCalls, config, startedAt, finalValidation, toolRounds, totalToolCalls);
}

function telemetry({ config, modelCalls, toolResults, toolRounds, totalToolCalls, startedAt, finalValidation, fallbackReason = null }) {
  return {
    coreVersion: CONVERSATION_CORE_VERSION, mode: config.mode, model: config.model, reasoningEffort: config.reasoningEffort,
    modelCallCount: modelCalls.length, modelMs: modelCalls.reduce((sum, call) => sum + call.latencyMs, 0),
    toolRounds, toolCallCount: totalToolCalls,
    tools: toolResults.map((result) => ({
      name: result.name,
      ok: result.ok,
      latencyMs: result.latencyMs,
      error: result.ok ? null : result.error,
      summary: result.ok ? toolTelemetrySummary(result) : null,
    })),
    retrievalMs: toolResults.reduce((sum, result) => sum + Number(result.latencyMs || 0), 0),
    totalMs: Date.now() - startedAt, usage: aggregateUsage(modelCalls),
    validationErrors: finalValidation?.errors || [],
    acceptedStateProposals: finalValidation ? finalValidation.stateValidation.acceptedPreferenceCount + finalValidation.stateValidation.acceptedDecisionCount : 0,
    rejectedStateProposals: finalValidation ? finalValidation.stateValidation.rejectedPreferences.length + finalValidation.stateValidation.rejectedDecisions.length : 0,
    fallbackReason,
  };
}

function fallbackResult(reason, toolResults, modelCalls, config, startedAt, finalValidation = null, toolRounds = 0, totalToolCalls = 0) {
  const reply = safeFallback({ reason, toolResults });
  return {
    ok: false, status: "fallback", reply, speech: reply, captions: reply, state: "warning", priority: "high", ttlMs: 7000,
    responseMode: "safe_fallback", productHandles: [], products: [], chips: [], actionProposals: [], actions: [], preferences: [], decisions: [], references: {}, claims: [],
    fallback: { used: true, reason }, quote: null, toolResults, stateValidation: finalValidation?.stateValidation || null,
    telemetry: telemetry({ config, modelCalls, toolResults, toolRounds, totalToolCalls, startedAt, finalValidation, fallbackReason: reason }),
  };
}

module.exports = {
  CONVERSATION_CORE_VERSION,
  EXPECTED_MODEL,
  buildConversationEnvelope,
  composeTrustedAdvisorResponse,
  getConversationCoreConfig,
  isConversationCoreActive,
  loadTrustedAdvisorFactPack,
  parseTrustedAdvisorComposition,
  planTrustedAdvisorTurnWithModel,
  runSnoozerConversationCore,
};
