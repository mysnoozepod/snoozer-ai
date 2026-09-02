const { canonicalizeHudHref } = require("./askSnoozerRoutes");

function cleanText(value = "") {
  return typeof value === "string" ? value.trim() : "";
}

function pickIntent(canonical = {}) {
  return (
    cleanText(canonical?.metadata?.qualityGate?.intent) ||
    cleanText(canonical?.meta?.qualityGate?.intent) ||
    cleanText(canonical?.meta?.intent) ||
    "fallback"
  );
}

function productHref(product = {}) {
  const explicit = canonicalizeHudHref(product?.meta?.url || product?.href || "");
  if (explicit) return explicit;

  const handle = cleanText(product?.handle);
  return handle ? canonicalizeHudHref(`/products/${handle}`) : "";
}

function adaptProduct(product = {}) {
  const handle = cleanText(product?.handle);
  const href = productHref(product);
  if (!handle || !href) return null;

  return {
    title: cleanText(product?.title) || "View product",
    handle,
    href,
    reason: cleanText(product?.reason || product?.subtitle),
    tags: Array.isArray(product?.tags) ? product.tags.slice(0, 3) : [],
  };
}

function adaptAction(action = {}) {
  if (!action || typeof action !== "object") return null;

  const href = canonicalizeHudHref(action.href || action.url || "");
  const label = cleanText(action.label || action.title);
  if (!href || !label) return null;

  return {
    label,
    href,
    type: cleanText(action.type) || "page",
  };
}

function buildLegacyHudAskPayload(canonical = {}, request = {}, latencyMs = 0) {
  const qualityGate =
    canonical?.metadata?.qualityGate && typeof canonical.metadata.qualityGate === "object"
      ? canonical.metadata.qualityGate
      : canonical?.meta?.qualityGate && typeof canonical.meta.qualityGate === "object"
      ? canonical.meta.qualityGate
      : {};
  const metrics =
    canonical?.metadata?.metrics && typeof canonical.metadata.metrics === "object"
      ? canonical.metadata.metrics
      : canonical?.meta?.metrics && typeof canonical.meta.metrics === "object"
        ? canonical.meta.metrics
        : {};
  const products = Array.isArray(canonical?.products)
    ? canonical.products.map(adaptProduct).filter(Boolean)
    : [];
  const actions = Array.isArray(canonical?.actions)
    ? canonical.actions.map(adaptAction).filter(Boolean)
    : [];
  const reply =
    cleanText(canonical?.reply || canonical?.message?.text) ||
    "I couldn't load that answer right now. Try again, take the Snooze Assessment, browse mattresses, or book a Snooze Session.";

  return {
    status: canonical?.ok === false ? "fallback" : "ok",
    reply,
    intent: pickIntent(canonical),
    intent_group: cleanText(qualityGate.intentGroup || canonical?.meta?.intent_group),
    confidence: Number.isFinite(Number(qualityGate.confidence))
      ? Number(qualityGate.confidence)
      : null,
    policy_subtype: cleanText(canonical?.meta?.policy_subtype),
    chips: Array.isArray(canonical?.chips) ? canonical.chips.slice(0, 8) : [],
    actions,
    products,
    collections: [],
    pages: [],
    thread_id: cleanText(canonical?.thread_id || canonical?.sessionId || request?.sessionId),
    meta: {
      path: cleanText(request?.path) || "/",
      page_type: cleanText(request?.pageType) || "unknown",
      surface: cleanText(request?.surface) || "shopify_header",
      shared_brain_route: "/ask-snoozer",
      answer_strategy: cleanText(
        canonical?.metadata?.answerStrategy || canonical?.meta?.answer_strategy
      ),
      answer_source_type: cleanText(
        canonical?.metadata?.answerSourceType || canonical?.meta?.answer_source_type
      ),
      answer_source_key:
        canonical?.metadata?.answerSourceKey || canonical?.meta?.answer_source_key || null,
      answer_grounded: Boolean(
        canonical?.metadata?.answerGrounded || canonical?.meta?.answer_grounded
      ),
      canonical_top_pod_id:
        canonical?.context?.canonicalRecommendation?.topPodId || null,
      canonical_primary_mattress_handle:
        canonical?.context?.canonicalRecommendation?.primaryMattressHandle || null,
      canonical_base_handle:
        canonical?.context?.canonicalRecommendation?.baseHandle || null,
      source_of_truth: cleanText(qualityGate.sourceOfTruth),
      answer_type: cleanText(qualityGate.answerType),
      protected_truth_required: Boolean(qualityGate.protectedTruthRequired),
      facts_resolved: Boolean(qualityGate.factsResolved),
      fallback_used: Boolean(metrics.fallbackUsed || canonical?.ok === false),
      model_used: Number(metrics.modelMs || 0) > 0,
      latency_ms: Math.max(0, Number(metrics.totalMs || latencyMs || 0)),
      failure_reason: cleanText(qualityGate.reason || canonical?.error?.code),
    },
  };
}

function buildLegacyHudAskFallback(request = {}, latencyMs = 0) {
  return buildLegacyHudAskPayload(
    {
      ok: false,
      status: "error",
      reply:
        "I couldn't load that answer right now. Try again, take the Snooze Assessment, browse mattresses, or book a Snooze Session.",
      products: [],
      actions: [],
      meta: {
        qualityGate: {
          intent: "fallback",
          intentGroup: "fallback_unclear",
          sourceOfTruth: "fallback",
          answerType: "safe_fallback",
          protectedTruthRequired: false,
          factsResolved: false,
          reason: "SHARED_ASK_UNAVAILABLE",
        },
      },
      metadata: {
        metrics: {
          totalMs: latencyMs,
          modelMs: 0,
          fallbackUsed: true,
        },
      },
      error: { code: "SHARED_ASK_UNAVAILABLE" },
    },
    request,
    latencyMs
  );
}

module.exports = {
  buildLegacyHudAskPayload,
  buildLegacyHudAskFallback,
};
