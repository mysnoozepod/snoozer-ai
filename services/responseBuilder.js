// services/responseBuilder.js
// Canonical response envelope for Snoozer Ã¢â€ â€™ Frontend contract.
// Deterministic principles:
// - Always return the same envelope shape.
// - Normalize products in a cart-safe way (preserve GIDs; also provide numeric aliases).
// - Avoid brittle assumptions about Shopify shapes.
// - Keep "raw" optional; index.js should already debug-gate it.
//
// Extended:
// - Add HUD response builder (speech/captions/state/priority/ttlMs/actions/voiceStyle) for showroom mode.
// - Thread 8 hardening:
//   - Carry retrieval/model/fallback metrics in the canonical envelope
//   - Enforce stable success/error shapes
//   - Prevent loose HUD payloads from escaping the backend boundary

function baseEnvelope() {
  return {
    ok: true,
    status: "completed",
    reply: "",
    message: {
      text: "",
      raw: null,
      tokens: null,
    },
    products: [],
    context: {
      shopperId: null,
      sessionId: null,
      zone: null,
      assessment: null,
      rewards: null,
    },
    actions: [],
    metadata: {
      requestId: null,
      latencyMs: null,
      model: null,
      source: {
        s3Prompts: [],
        shopifyProducts: 0,
      },
      metrics: {
        retrievalMs: 0,
        modelMs: 0,
        totalMs: 0,
        fallbackUsed: false,
      },
    },
    error: null,
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Helpers
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function stripShopifyGidPrefix(rawId, prefix) {
  const s = String(rawId || "").trim();
  if (!s) return null;
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

function toNumericShopifyId(rawId) {
  const s = String(rawId || "").trim();
  if (!s) return null;
  if (s.startsWith("gid://")) return s.split("/").pop() || null;
  return /^\d+$/.test(s) ? s : null;
}

function safeText(s, max = 5000) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "...";
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeHudStateValue(v, fallback = "speaking") {
  const s = String(v || "").trim().toLowerCase();
  const allowed = ["idle", "listening", "thinking", "speaking", "celebrate", "warning"];
  return allowed.includes(s) ? s : fallback;
}

function normalizeHudPriorityValue(v, fallback = "normal") {
  const s = String(v || "").trim().toLowerCase();
  const allowed = ["low", "normal", "high"];
  return allowed.includes(s) ? s : fallback;
}

function normalizeHudVoiceStyleValue(v, fallback = "default") {
  const s = String(v || "").trim().toLowerCase();
  return s === "calm" ? "calm" : fallback;
}

function normalizeMetrics({
  latencyMs = null,
  retrievalMs = 0,
  modelMs = 0,
  totalMs = null,
  fallbackUsed = false,
} = {}) {
  const safeLatency = typeof latencyMs === "number" && Number.isFinite(latencyMs) ? Math.max(0, latencyMs) : null;
  const safeRetrievalMs = Math.max(0, safeNumber(retrievalMs, 0));
  const safeModelMs = Math.max(0, safeNumber(modelMs, 0));
  const safeTotalMs =
    typeof totalMs === "number" && Number.isFinite(totalMs)
      ? Math.max(0, totalMs)
      : safeLatency !== null
      ? safeLatency
      : safeRetrievalMs + safeModelMs;

  return {
    retrievalMs: safeRetrievalMs,
    modelMs: safeModelMs,
    totalMs: safeTotalMs,
    fallbackUsed: Boolean(fallbackUsed),
  };
}

function normalizeError(code, message, details = null) {
  return {
    code: String(code || "UNKNOWN_ERROR"),
    message: safeText(message || "Something went wrong.", 2000),
    details,
  };
}

function pickImage(shopifyProduct) {
  const image =
    shopifyProduct?.image ||
    (Array.isArray(shopifyProduct?.images) ? shopifyProduct.images[0] : null) ||
    null;

  const url =
    image?.url ||
    image?.src ||
    shopifyProduct?.imageUrl ||
    shopifyProduct?.previewUrl ||
    null;

  const alt = image?.altText || image?.alt || shopifyProduct?.title || "Product image";

  return {
    url: url || "/no-image.svg",
    alt,
  };
}

function parsePrice(shopifyProduct) {
  const rawPrice =
    shopifyProduct?.price ??
    shopifyProduct?.minPrice ??
    shopifyProduct?.priceRange?.min ??
    shopifyProduct?.variants?.[0]?.price ??
    shopifyProduct?.variants?.[0]?.price?.amount ??
    null;

  let amount = null;
  let currency = "USD";

  if (shopifyProduct?.price?.currencyCode) currency = String(shopifyProduct.price.currencyCode);
  if (shopifyProduct?.priceRange?.currencyCode) currency = String(shopifyProduct.priceRange.currencyCode);

  if (typeof rawPrice === "number" && Number.isFinite(rawPrice)) {
    amount = rawPrice;
  } else if (rawPrice && typeof rawPrice === "object") {
    if (rawPrice.amount != null) {
      const n = Number(rawPrice.amount);
      if (Number.isFinite(n)) amount = n;
    }
    if (rawPrice.currencyCode) currency = String(rawPrice.currencyCode);
    if (rawPrice.currency) currency = String(rawPrice.currency);
  } else if (rawPrice != null) {
    const parsed = Number(rawPrice);
    if (Number.isFinite(parsed)) amount = parsed;
  }

  let formatted = "-";
  if (typeof amount === "number" && Number.isFinite(amount)) {
    try {
      formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
      }).format(amount);
    } catch {
      formatted = `$${amount}`;
    }
  }

  return { amount, currency, formatted };
}

function pickVariantIds(shopifyProduct) {
  const variantIdRaw =
    shopifyProduct?.variantId ||
    shopifyProduct?.merchandiseId ||
    shopifyProduct?.firstAvailableVariantId ||
    shopifyProduct?.variants?.[0]?.id ||
    shopifyProduct?.variants?.[0]?.variantId ||
    null;

  const firstAvailableVariantIdRaw =
    shopifyProduct?.firstAvailableVariantId ||
    shopifyProduct?.variantId ||
    shopifyProduct?.merchandiseId ||
    null;

  const merchandiseIdRaw =
    shopifyProduct?.merchandiseId ||
    shopifyProduct?.variantId ||
    firstAvailableVariantIdRaw ||
    null;

  const variantId = variantIdRaw ? String(variantIdRaw).trim() : null;
  const firstAvailableVariantId = firstAvailableVariantIdRaw ? String(firstAvailableVariantIdRaw).trim() : null;
  const merchandiseId = merchandiseIdRaw ? String(merchandiseIdRaw).trim() : null;

  return {
    variantId,
    firstAvailableVariantId,
    merchandiseId,
    numericVariantId: toNumericShopifyId(variantId),
    numericFirstAvailableVariantId: toNumericShopifyId(firstAvailableVariantId),
  };
}

function normalizeProduct(shopifyProduct) {
  if (!shopifyProduct) return null;

  const idRaw = shopifyProduct.id || shopifyProduct.productId || shopifyProduct.shopifyId || null;

  const shopifyProductGid =
    String(idRaw || "").startsWith("gid://shopify/Product/")
      ? String(idRaw)
      : shopifyProduct?.meta?.shopifyId || (String(idRaw || "").startsWith("gid://") ? String(idRaw) : null);

  const id =
    shopifyProduct.id && /^\d+$/.test(String(shopifyProduct.id))
      ? String(shopifyProduct.id)
      : (shopifyProductGid ? stripShopifyGidPrefix(shopifyProductGid, "gid://shopify/Product/") : null) ||
        toNumericShopifyId(idRaw) ||
        null;

  const image = pickImage(shopifyProduct);
  const price = parsePrice(shopifyProduct);
  const variants = pickVariantIds(shopifyProduct);

  return {
    id,
    handle: shopifyProduct.handle || null,
    title: shopifyProduct.title || shopifyProduct.name || "Untitled product",
    subtitle: shopifyProduct.subtitle || shopifyProduct.vendor || null,
    price,
    image,
    tags: Array.isArray(shopifyProduct.tags) ? shopifyProduct.tags : [],
    meta: {
      shopifyId: shopifyProductGid || (idRaw ? String(idRaw) : null),
      productType: shopifyProduct.productType || shopifyProduct?.meta?.productType || null,
      vendor: shopifyProduct.vendor || shopifyProduct?.meta?.vendor || null,
      available:
        typeof shopifyProduct.available === "boolean"
          ? shopifyProduct.available
          : typeof shopifyProduct.availableForSale === "boolean"
          ? shopifyProduct.availableForSale
          : true,
      url: shopifyProduct.onlineStoreUrl || shopifyProduct?.meta?.url || null,
      previewUrl: shopifyProduct.previewUrl || shopifyProduct?.meta?.previewUrl || null,
      variantId: variants.variantId || null,
      merchandiseId: variants.merchandiseId || null,
      firstAvailableVariantId: variants.firstAvailableVariantId || null,
      numericVariantId: variants.numericVariantId || null,
      numericFirstAvailableVariantId: variants.numericFirstAvailableVariantId || null,
    },
  };
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((a) => {
      if (typeof a === "string") return a;
      if (isObject(a)) return a;
      return null;
    })
    .filter(Boolean)
    .slice(0, 25);
}

function normalizeHudActions(actions) {
  return normalizeActions(actions).slice(0, 12);
}

function buildCanonicalContext(context = {}) {
  return {
    ...(context && typeof context === "object" ? context : {}),
    shopperId: context?.shopperId || null,
    sessionId: context?.sessionId || null,
    zone: context?.zone || null,
    assessment: context?.assessment || null,
    rewards: context?.rewards || null,
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Builders
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function buildSuccessResponse({
  requestId,
  latencyMs,
  model,
  text,
  rawMessage = null,
  tokens = null,
  products = [],
  context = {},
  actions = [],
  s3Prompts = [],
  metrics = {},
}) {
  const env = baseEnvelope();
  const normalizedMetrics = normalizeMetrics({
    latencyMs,
    ...metrics,
  });

  env.ok = true;
  env.status = "completed";
  env.reply = safeText(text || "", 8000);
  env.message.text = env.reply;
  env.message.raw = rawMessage;
  env.message.tokens = tokens || null;

  env.products = (products || []).map(normalizeProduct).filter(Boolean);
  env.context = buildCanonicalContext(context);
  env.actions = normalizeActions(actions);

  env.metadata.requestId = requestId || null;
  env.metadata.latencyMs = normalizedMetrics.totalMs;
  env.metadata.model = model || null;
  env.metadata.source.s3Prompts = Array.isArray(s3Prompts) ? s3Prompts.slice(0, 25) : [];
  env.metadata.source.shopifyProducts = env.products.length;
  env.metadata.metrics = normalizedMetrics;

  env.error = null;

  return env;
}

function buildErrorResponse({
  requestId,
  latencyMs,
  context = {},
  code = "UNKNOWN_ERROR",
  message = "Something went wrong.",
  details = null,
  metrics = {},
}) {
  const env = baseEnvelope();
  const normalizedMetrics = normalizeMetrics({
    latencyMs,
    fallbackUsed: true,
    ...metrics,
  });

  env.ok = false;
  env.status = "error";
  env.reply = safeText(message || "Something went wrong.", 2000);
  env.message = null;
  env.products = [];
  env.actions = [];
  env.context = buildCanonicalContext(context);

  env.metadata.requestId = requestId || null;
  env.metadata.latencyMs = normalizedMetrics.totalMs;
  env.metadata.model = null;
  env.metadata.metrics = normalizedMetrics;

  env.error = normalizeError(code, message, details);

  return env;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// HUD builder
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
//
// Converts the canonical envelope into the Snoozer HUD response contract.
//
// Contract:
// {
//   speech: string,
//   captions: string,
//   state: "idle|listening|thinking|speaking|celebrate|warning",
//   priority: "low|normal|high",
//   ttlMs: number,
//   actions: [],
//   voiceStyle: "default|calm"
// }
//
// Notes:
// - captions MUST always exist even if voice fails.
// - speech is what we attempt to TTS (can match captions).
// - defaults:
//    ok=true => speaking/normal/5000/default
//    ok=false => warning/high/7000/default
// - opts allows deterministic page/event overrides without rewriting the full envelope.
function buildHudResponseFromEnvelope(envelope, opts = {}) {
  const env = isObject(envelope) ? envelope : baseEnvelope();

  const {
    state = null,
    priority = null,
    ttlMs = null,
    voiceStyle = null,
    speech = null,
    captions = null,
    actions = null,
    defaultSpeech = "I'm here. Tell me what you want to do next.",
  } = opts;

  const status = String(env.status || "").toLowerCase().trim();
  const hasErr = Boolean(env.error) || status === "error" || env.ok === false;
  const ok = !hasErr;

  const derivedText =
    safeText(
      pickFirst(env?.message?.text, env?.reply, env?.error?.message, defaultSpeech),
      8000
    ).trim() || defaultSpeech;

  const finalSpeech =
    safeText(pickFirst(speech, captions, derivedText), 1200).trim() || defaultSpeech;

  const finalCaptions =
    safeText(pickFirst(captions, speech, derivedText), 1800).trim() || finalSpeech;

  const derivedState = ok ? "speaking" : "warning";
  const derivedPriority = ok ? "normal" : "high";
  const derivedTtl = ok ? 5000 : 7000;
  const derivedVoiceStyle = normalizeHudVoiceStyleValue(env?.hud?.voiceStyle, "default");

  const finalState = normalizeHudStateValue(state, derivedState);
  const finalPriority = normalizeHudPriorityValue(priority, derivedPriority);

  const finalTtl = clampNumber(ttlMs, 1000, 15000, derivedTtl);

  const finalVoiceStyle = normalizeHudVoiceStyleValue(
    pickFirst(voiceStyle, env?.hud?.voiceStyle),
    derivedVoiceStyle
  );

  const finalActions = normalizeHudActions(Array.isArray(actions) ? actions : env.actions);

  return {
    speech: finalSpeech,
    captions: finalCaptions,
    state: finalState,
    priority: finalPriority,
    ttlMs: finalTtl,
    actions: finalActions,
    voiceStyle: finalVoiceStyle,
  };
}

module.exports = {
  buildSuccessResponse,
  buildErrorResponse,
  normalizeProduct,

  // HUD
  buildHudResponseFromEnvelope,
};

