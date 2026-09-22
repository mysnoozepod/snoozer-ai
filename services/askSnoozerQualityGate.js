const {
  buildClarificationReply,
  buildFallbackReply,
  buildMissingRecommendationReply,
  buildNoGuessReply,
  presentCommerceResponse,
} = require("./askSnoozerResponsePresenter");
const { normalizeAskSnoozerText } = require("./askSnoozerIntents");
const { buildProductCardTruth } = require("./askSnoozerProductCardTruth");

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim()).filter(Boolean)));
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

function buildResolvedProducts(products = [], sizeLabel = "") {
  return products
    .filter(Boolean)
    .map((product) => {
      const card = buildProductCardTruth(product, { activeSize: sizeLabel });
      if (!card) return null;
      const variant = card.exactVariantResolved
        ? (card.variants || []).find((item) => item.id === card.variantId) || null
        : null;
      return {
        product: card,
        handle: card.handle,
        title: card.title,
        href: card.href,
        variant,
        variantId: card.variantId || "",
        variantTitle: String(variant?.title || "").trim(),
        selectedOptions: card.selectedOptions || [],
        exactVariantResolved: card.exactVariantResolved,
        price: card.price,
        currencyCode: card.currencyCode,
        available: card.available,
        activeSize: card.activeSize,
        pricingMode: card.pricingMode,
        priceLabel: card.priceLabel,
        availabilityResolved: card.availabilityResolved,
      };
    })
    .filter((entry) => entry?.handle);
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
  resolveAskSnoozerCommerceResponse,
};
