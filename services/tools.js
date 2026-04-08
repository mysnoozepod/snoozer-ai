// services/tools.js
// 🛠 Snoozer Tool Functions (Detinistic + Shopify source-of-truth)
//
// Goals:
// - Keep existing tool names for backwards compatibility.
// - Shopify is the source of truth for price + availability + carts + checkout.
// - NO static/bundle pricing.
// - Deterministic, stable outputs.
// - Respect Thread 8 timeout/guardrail rules.
//
// Notes:
// - getTotalPrice removed (intentionally).
// - getProductPrice pulls live Shopify product and resolves the correct variant.
// - createCheckout is cart-first via API Gateway routes.
// - conversationState is best-effort warm-cache; SCO is Dynamo in index.js.

const axios = require("axios");

let conversationState = {};
try {
  conversationState = require("./conversationState");
} catch {
  conversationState = {};
}

const getMemory =
  conversationState.getMemory ||
  conversationState.getThreadMemory ||
  conversationState.getSession ||
  conversationState.getThreadState ||
  (() => null);

const updateMemory = conversationState.updateMemory || (() => null);

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------
const SHOPIFY_TIMEOUT_MS = Math.max(100, Number(process.env.SHOPIFY_TIMEOUT_MS || 800));
const TOOL_DEFAULT_TIMEOUT_MS = Math.max(100, Number(process.env.TOOL_DEFAULT_TIMEOUT_MS || 3000));

// -----------------------------------------------------------------------------
// Timeout wrapper (tools return structured error objects)
// -----------------------------------------------------------------------------
async function withTimeout(promise, ms = TOOL_DEFAULT_TIMEOUT_MS, fallback = null) {
  let timer;
  const timeoutResult =
    fallback ||
    {
      error: "TOOL_TIMEOUT",
      message: "Tool timed out.",
      timeoutMs: ms,
    };

  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(timeoutResult), ms);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Basic helpers
// -----------------------------------------------------------------------------
function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function normalizeApiBase(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

function joinUrl(base, path) {
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}

function getApiBase() {
  return normalizeApiBase(process.env.API_GATEWAY_HOST || "");
}

function unwrapApiEnvelope(payload) {
  // index.js sometimes returns { ok, status, data, error, traceId } envelopes.
  // shopifyRoutes returns plain objects. This supports both.
  if (payload && payload.ok !== undefined && payload.data !== undefined) return payload.data;
  return payload;
}

function extractErrorMessage(err) {
  try {
    const data = err?.response?.data;
    if (!data) return err?.message || "Unknown error";

    if (typeof data === "string") return data.slice(0, 400);
    if (data?.message) return String(data.message);
    if (data?.error?.message) return String(data.error.message);
    if (data?.data?.message) return String(data.data.message);

    return JSON.stringify(data).slice(0, 400);
  } catch {
    return err?.message || "Unknown error";
  }
}

function buildToolError(error, message, extra = {}) {
  return {
    error,
    message,
    ...extra,
  };
}

function normalizeSizeKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/^california king$/, "cal king");
}

// -----------------------------------------------------------------------------
// State (conversationState only; no shadow caches)
// -----------------------------------------------------------------------------
function getThreadState(thread_id) {
  if (!thread_id) return {};
  try {
    const s = getMemory(thread_id);
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}

function setThreadState(thread_id, patch = {}) {
  if (!thread_id) return;
  try {
    updateMemory(thread_id, patch || {});
  } catch {
    // ignore: warm-cache only
  }
}

// -----------------------------------------------------------------------------
// Prefer SCO context over warm-cache
// -----------------------------------------------------------------------------
function resolveCartId({ cartId, thread_id, context } = {}) {
  const ctxCartId = String(context?.ids?.cartId || "").trim();
  if (ctxCartId) return ctxCartId;

  const state = getThreadState(thread_id);
  const memCartId = String(state?.ids?.cartId || "").trim();
  if (memCartId) return memCartId;

  const direct = String(cartId || "").trim();
  return direct || null;
}

function resolveLastHandles({ thread_id, context } = {}) {
  const ctxLastViewed = String(context?.cartState?.lastViewedHandle || "").trim();
  const ctxLastAdded = String(context?.cartState?.lastAddedHandle || "").trim();

  const state = getThreadState(thread_id);
  const memLastViewed = String(state?.cartState?.lastViewedHandle || "").trim();
  const memLastAdded = String(state?.cartState?.lastAddedHandle || "").trim();

  return {
    lastViewedHandle: ctxLastViewed || memLastViewed || "",
    lastAddedHandle: ctxLastAdded || memLastAdded || "",
  };
}

// -----------------------------------------------------------------------------
// Shopify ID normalization (accept numeric or GID; ban /0)
// -----------------------------------------------------------------------------
function isDigits(s) {
  return typeof s === "string" && /^\d+$/.test(s);
}

function isValidVariantGid(id) {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(trimmed)) return false;
  if (trimmed.endsWith("/0")) return false;
  return true;
}

function toVariantGid(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (s.startsWith("gid://")) return isValidVariantGid(s) ? s : null;
  if (isDigits(s)) return s === "0" ? null : `gid://shopify/ProductVariant/${s}`;

  return null;
}

// -----------------------------------------------------------------------------
// Cart line normalization
// Shopify Storefront expects attributes as [{ key, value }]
// -----------------------------------------------------------------------------
function normalizeAttributes(attrs) {
  if (!attrs) return undefined;

  // Allow object form: { Size: "Queen" }
  if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
    const out = Object.entries(attrs)
      .map(([k, v]) => {
        const key = String(k ?? "").trim();
        const value = String(v ?? "").trim();
        if (!key || !value) return null;
        return { key, value };
      })
      .filter(Boolean);
    return out.length ? out : undefined;
  }

  if (!Array.isArray(attrs) || attrs.length === 0) return undefined;

  const normalized = attrs
    .map((a) => {
      if (Array.isArray(a) && a.length >= 2) {
        const key = String(a[0] ?? "").trim();
        const value = String(a[1] ?? "").trim();
        if (!key || !value) return null;
        return { key, value };
      }

      if (a && typeof a === "object") {
        const key = String(a.key ?? a.name ?? "").trim();
        const value = String(a.value ?? "").trim();
        if (!key || !value) return null;
        return { key, value };
      }

      return null;
    })
    .filter(Boolean);

  return normalized.length ? normalized : undefined;
}

function normalizeLines(lines, { fallbackVariantId = null, fallbackQty = 1 } = {}) {
  let payloadLines = Array.isArray(lines) ? lines : null;

  if (!payloadLines || payloadLines.length === 0) {
    const gid = toVariantGid(fallbackVariantId);
    if (!gid) return null;

    return [
      {
        merchandiseId: gid,
        quantity: Math.max(1, Math.floor(Number(fallbackQty) || 1)),
      },
    ];
  }

  const normalized = payloadLines
    .map((l) => {
      const rawId = l?.merchandiseId || l?.variantId || l?.id || l?.variant_id || null;
      const merchandiseId = toVariantGid(rawId);
      const quantity = Math.max(1, Math.floor(Number(l?.quantity || 1) || 1));
      const attributes = normalizeAttributes(l?.attributes);

      if (!merchandiseId) return null;
      return attributes ? { merchandiseId, quantity, attributes } : { merchandiseId, quantity };
    })
    .filter(Boolean);

  return normalized.length ? normalized : null;
}

// -----------------------------------------------------------------------------
// Cart summary (small + stable for HUD / UI)
// -----------------------------------------------------------------------------
function summarizeCart(cart) {
  if (!cart || typeof cart !== "object") return null;

  const edges = Array.isArray(cart?.lines?.edges) ? cart.lines.edges : [];
  const lines = edges
    .map((e) => e?.node)
    .filter(Boolean)
    .map((n) => {
      const merch = n?.merchandise || {};
      const prod = merch?.product || {};
      const title = prod?.title || merch?.title || "Item";
      const handle = prod?.handle || null;

      return {
        lineId: n?.id || null,
        quantity: Number(n?.quantity ?? 0) || 0,
        title,
        handle,
        variantId: merch?.id || null,
        variantTitle: merch?.title || null,
      };
    });

  const totalQty = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);

  const subtotalAmount = cart?.cost?.subtotalAmount?.amount;
  const totalAmount = cart?.cost?.totalAmount?.amount;
  const currency =
    cart?.cost?.totalAmount?.currencyCode ||
    cart?.cost?.subtotalAmount?.currencyCode ||
    "USD";

  const toNum = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };

  return {
    cartId: cart?.id || null,
    checkoutUrl: cart?.checkoutUrl || null,
    itemCount: lines.length,
    totalQuantity: totalQty,
    subtotal: toNum(subtotalAmount),
    total: toNum(totalAmount),
    currencyCode: currency,
    lines: lines.slice(0, 50),
  };
}

// -----------------------------------------------------------------------------
// Backend Shopify helpers (via API Gateway -> /shopify/getProduct)
// -----------------------------------------------------------------------------
async function backendGetProduct({ idOrHandle }) {
  const apiBase = getApiBase();
  if (!apiBase) {
    return buildToolError(
      "MISSING_API_GATEWAY_HOST",
      "Backend Shopify service is not configured (API_GATEWAY_HOST is missing)."
    );
  }

  try {
    const resp = await axios.post(
      joinUrl(apiBase, "/shopify/getProduct"),
      { idOrHandle },
      { headers: { "Content-Type": "application/json" }, timeout: SHOPIFY_TIMEOUT_MS }
    );

    const data = unwrapApiEnvelope(resp.data);

    const product =
      data?.product ||
      data?.data?.product ||
      data?.productByHandle ||
      data?.productById ||
      null;

    return { product, raw: data };
  } catch (err) {
    return buildToolError("SHOPIFY_GET_PRODUCT_FAILED", extractErrorMessage(err), {
      timeoutMs: SHOPIFY_TIMEOUT_MS,
    });
  }
}

function pickVariantFromProductByOptions(product, options) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (!variants.length) return null;

  const want = isObject(options) ? options : null;
  if (!want) {
    const avail = variants.find((v) => v?.available) || variants[0];
    return avail?.id || null;
  }

  const wantLower = {};
  for (const [k, v] of Object.entries(want)) {
    const nk = String(k || "").trim().toLowerCase();
    const nv = normalizeSizeKey(v);
    if (nk && nv) wantLower[nk] = nv;
  }

  const match = variants.find((v) => {
    const so = Array.isArray(v?.selectedOptions) ? v.selectedOptions : [];
    if (!so.length) return false;

    const have = {};
    for (const s of so) {
      const n = String(s?.name || "").trim().toLowerCase();
      const val = normalizeSizeKey(s?.value || "");
      if (n && val) have[n] = val;
    }

    return Object.entries(wantLower).every(([k2, v2]) => have[k2] === v2);
  });

  return (match || variants.find((v) => v?.available) || variants[0])?.id || null;
}

// -----------------------------------------------------------------------------
// Live Shopify pricing (source-of-truth tool)
// -----------------------------------------------------------------------------
async function getProductPrice({ idOrHandle, handle, variantId, options, thread_id, context } = {}) {
  const state = getThreadState(thread_id);
  const { lastViewedHandle, lastAddedHandle } = resolveLastHandles({ thread_id, context });

  const resolvedIdOrHandle = idOrHandle || handle || lastViewedHandle || lastAddedHandle || null;

  if (!resolvedIdOrHandle && !variantId) {
    return buildToolError(
      "MISSING_PRODUCT_REF",
      "Provide a product handle (or idOrHandle), or a variantId."
    );
  }

  const out = await backendGetProduct({ idOrHandle: resolvedIdOrHandle || String(variantId) });
  if (out?.error) return out;

  const product = out?.product;
  if (!product) {
    return buildToolError("PRODUCT_NOT_FOUND", "No product returned from Shopify.");
  }

  // Determine the variant to price
  let pickedVariantId = variantId ? toVariantGid(variantId) : null;

  if (!pickedVariantId) {
    const candidate = pickVariantFromProductByOptions(product, options);
    pickedVariantId = toVariantGid(candidate);
  }

  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variant =
    (pickedVariantId &&
      variants.find((v) => String(v?.id || "").trim() === String(pickedVariantId).trim())) ||
    variants.find((v) => v?.available) ||
    variants[0] ||
    null;

  const price =
    typeof variant?.price === "number"
      ? variant.price
      : Number(variant?.price ?? product?.price ?? product?.priceRange?.min ?? NaN);

  const compareAt =
    typeof variant?.compareAtPrice === "number"
      ? variant.compareAtPrice
      : Number(variant?.compareAtPrice ?? NaN);

  const currency = product?.priceRange?.currencyCode || variant?.currencyCode || "USD";

  const result = {
    handle: product?.handle || "",
    title: product?.title || "",
    variantId: variant?.id || pickedVariantId || null,
    variantTitle: variant?.title || null,
    price: Number.isFinite(price) ? price : null,
    compareAtPrice: Number.isFinite(compareAt) ? compareAt : null,
    currencyCode: currency,
    available: variant?.available ?? product?.available ?? null,
  };

  if (thread_id) {
    const prevCartState = isObject(state?.cartState) ? state.cartState : {};
    setThreadState(thread_id, {
      cartState: {
        ...prevCartState,
        lastViewedHandle: result.handle || lastViewedHandle || "",
      },
      pricing: {
        lastSeen: {
          handle: result.handle || null,
          variantId: result.variantId || null,
          amount: result.price,
          currencyCode: result.currencyCode || "USD",
          ts: new Date().toISOString(),
        },
      },
      lastTotal: Number.isFinite(result.price) ? result.price : undefined,
    });
  }

  return {
    ...result,
    message:
      result.price != null
        ? `${result.title}${result.variantTitle ? ` (${result.variantTitle})` : ""} is $${result.price} ${result.currencyCode}.`
        : `I found ${result.title}, but couldn't reliably parse a price.`,
  };
}

// -----------------------------------------------------------------------------
// Financing (simple, deterministic math)
// -----------------------------------------------------------------------------
async function getFinancingOptions({ total, months, thread_id } = {}) {
  const state = getThreadState(thread_id);
  const numericMonths = Number(months);
  const numericTotal = Number(total ?? state?.pricing?.lastSeen?.amount ?? state?.lastTotal ?? 0);

  if (!numericTotal || !numericMonths || numericMonths <= 0) {
    return buildToolError(
      "INVALID_FINANCING_INPUT",
      "Please provide a valid total price and financing term in months."
    );
  }

  const interestRate = 0.0;
  const monthly = (numericTotal / numericMonths).toFixed(2);

  if (thread_id) {
    setThreadState(thread_id, {
      financing: { total: numericTotal, months: numericMonths, monthly, interestRate },
    });
  }

  return {
    total: numericTotal,
    months: numericMonths,
    monthly,
    interestRate,
    message: `$${monthly} per month for ${numericMonths} months, interest-free.`,
  };
}

// -----------------------------------------------------------------------------
// Delivery (stubby but deterministic)
// -----------------------------------------------------------------------------
async function getDeliveryTime({ zipCode, thread_id } = {}) {
  const state = getThreadState(thread_id);
  const zip = zipCode || state?.zipCode || null;

  if (!zip || typeof zip !== "string" || zip.length < 3) {
    return buildToolError(
      "INVALID_ZIP",
      "Please enter at least the first 3 digits of the delivery zip code."
    );
  }

  const estimatedDays = zip.startsWith("9") ? 7 : 3;

  if (thread_id) {
    setThreadState(thread_id, { zipCode: zip, deliveryEstimate: estimatedDays });
  }

  return {
    zipCode: zip,
    estimatedDays,
    message: `Estimated delivery to ${zip} in about ${estimatedDays} business days.`,
  };
}

// -----------------------------------------------------------------------------
// Rewards (simple, deterministic)
// -----------------------------------------------------------------------------
async function getRewardEarnings({ subtotal, thread_id } = {}) {
  const state = getThreadState(thread_id);
  const total = Number(subtotal ?? state?.pricing?.lastSeen?.amount ?? state?.lastTotal ?? 0);

  if (!total || Number.isNaN(total)) {
    return buildToolError(
      "INVALID_SUBTOTAL",
      "Please provide a valid subtotal to calculate rewards."
    );
  }

  const multiplier = 3;
  const points = Math.floor(total * multiplier);

  if (thread_id) {
    setThreadState(thread_id, { lastRewards: points });
  }

  return {
    subtotal: total,
    points,
    message: `Earn ${points} Snoozer Rewards Points on this purchase.`,
  };
}

// -----------------------------------------------------------------------------
// Feature Compare (static copy; deterministic)
// -----------------------------------------------------------------------------
async function getFeatureCompare({ category } = {}) {
  const comparisons = {
    pressure_relief: {
      AllFoam: "Excellent pressure relief with contouring memory foam.",
      DualComfort: "Balanced pressure relief from coils plus comfort foams.",
    },
    cooling: {
      AllFoam: "Less airflow and tends to retain more body heat.",
      DualComfort: "Better airflow through the coil core to help you sleep cooler.",
    },
    motion_transfer: {
      AllFoam: "Superior motion isolation; partner movement is minimized.",
      DualComfort: "Very good, but you may feel a touch more movement from the coil unit.",
    },
    durability: {
      AllFoam: "High-density foams; performs best if rotated regularly.",
      DualComfort: "Reinforced coils plus foams; strong long-term support when cared for.",
    },
    edge_support: {
      AllFoam: "Softer edges that can compress more when you sit or sleep there.",
      DualComfort: "Stronger perimeter support from the coil system; edges feel more secure.",
    },
  };

  const result = comparisons[category];
  if (!result) {
    return buildToolError(
      "UNKNOWN_CATEGORY",
      "Choose a valid feature to compare: pressure_relief, cooling, motion_transfer, durability, or edge_support."
    );
  }

  return {
    category,
    details: result,
    message: `Here’s the comparison for ${category}: All Foam – ${result.AllFoam} Dual Comfort – ${result.DualComfort}`,
  };
}

// -----------------------------------------------------------------------------
// Cart / Checkout (persistent cart-first via API Gateway)
// -----------------------------------------------------------------------------
function extractCartFromApiResponse(payload) {
  if (!payload) return null;

  if (payload.ok !== undefined && payload.data !== undefined) {
    const inner = payload.data;

    if (inner?.id && inner?.checkoutUrl) return inner;
    if (inner?.cart?.id && inner?.cart?.checkoutUrl) return inner.cart;
    if (inner?.data?.id && inner?.data?.checkoutUrl) return inner.data;
    if (inner?.data?.cart?.id && inner?.data?.cart?.checkoutUrl) return inner.data.cart;

    return null;
  }

  if (payload?.id && payload?.checkoutUrl) return payload;
  if (payload?.cart?.id && payload?.cart?.checkoutUrl) return payload.cart;
  if (payload?.data?.id && payload?.data?.checkoutUrl) return payload.data;
  if (payload?.data?.cart?.id && payload?.data?.cart?.checkoutUrl) return payload.data.cart;

  return null;
}

function shouldFallbackFromAddLines(error) {
  const status = error?.response?.status;
  const bodyStr = (() => {
    try {
      return JSON.stringify(error?.response?.data || "");
    } catch {
      return "";
    }
  })();

  if (status === 404) return true;
  if (status === 400 && /INVALID_CART_ID|CART_NOT_FOUND|Cart not found|cartId/i.test(bodyStr)) return true;

  return false;
}

/**
 * createCheckout (compat tool name)
 * - Adds to existing cart if possible; else creates cart.
 * - Returns checkoutUrl and contextPatch that aligns with SCO shape.
 */
async function createCheckout({ variantId, quantity = 1, lines, thread_id, context } = {}) {
  const apiBase = getApiBase();
  if (!apiBase) {
    return buildToolError(
      "MISSING_API_GATEWAY_HOST",
      "Backend cart service is not configured (API_GATEWAY_HOST is missing)."
    );
  }

  const state = getThreadState(thread_id);
  const existingCartId =
    resolveCartId({ thread_id, context }) || String(state?.ids?.cartId || "").trim() || null;

  const normalizedLines = normalizeLines(lines, {
    fallbackVariantId: variantId,
    fallbackQty: quantity,
  });

  if (!normalizedLines || !normalizedLines.length) {
    return buildToolError(
      "MISSING_LINES",
      "Please pick a specific item and size first so I can add it to your cart."
    );
  }

  const urlAdd = joinUrl(apiBase, "/shopify/cart/addLines");
  const urlCreate = joinUrl(apiBase, "/shopify/createCart");

  try {
    let cart = null;

    if (existingCartId) {
      try {
        const resp = await axios.post(
          urlAdd,
          { cartId: existingCartId, lines: normalizedLines },
          { headers: { "Content-Type": "application/json" }, timeout: SHOPIFY_TIMEOUT_MS }
        );
        cart = extractCartFromApiResponse(resp.data);
      } catch (e) {
        if (!shouldFallbackFromAddLines(e)) throw e;
        cart = null;
      }
    }

    if (!cart) {
      const resp2 = await axios.post(
        urlCreate,
        { lines: normalizedLines },
        { headers: { "Content-Type": "application/json" }, timeout: SHOPIFY_TIMEOUT_MS }
      );
      cart = extractCartFromApiResponse(resp2.data);
    }

    if (!cart || !cart.id || !cart.checkoutUrl) {
      return buildToolError("CART_RESPONSE_INVALID", "Cart response missing id or checkoutUrl.");
    }

    const patch = {
      ids: { cartId: cart.id },
      checkoutUrl: cart.checkoutUrl,
    };

    if (thread_id) setThreadState(thread_id, patch);

    const cartSummary = summarizeCart(cart);

    return {
      cartId: cart.id,
      checkoutUrl: cart.checkoutUrl,
      cart,
      cartSummary,
      contextPatch: patch,
      message: "Added to your cart. You can keep shopping, or open the cart when you’re ready.",
    };
  } catch (err) {
    return buildToolError(
      "CART_OPERATION_FAILED",
      extractErrorMessage(err) ||
        "I hit a snag adding that to your cart. Try again in a moment, or re-select the item and size and try again.",
      { timeoutMs: SHOPIFY_TIMEOUT_MS }
    );
  }
}

async function getCart({ cartId, thread_id, context } = {}) {
  const apiBase = getApiBase();
  if (!apiBase) {
    return buildToolError(
      "MISSING_API_GATEWAY_HOST",
      "Backend cart service is not configured (API_GATEWAY_HOST is missing)."
    );
  }

  const id = resolveCartId({ cartId, thread_id, context });

  if (!id) {
    return buildToolError("MISSING_CART_ID", "No cart found yet. Add an item first.");
  }

  try {
    const resp = await axios.post(
      joinUrl(apiBase, "/shopify/cart/get"),
      { cartId: id },
      { headers: { "Content-Type": "application/json" }, timeout: SHOPIFY_TIMEOUT_MS }
    );

    const cart = extractCartFromApiResponse(resp.data) || unwrapApiEnvelope(resp.data) || resp.data;

    if (thread_id && cart?.id) {
      const patch = {
        ids: { cartId: cart.id },
        checkoutUrl: cart.checkoutUrl || "",
      };
      setThreadState(thread_id, patch);
    }

    const cartSummary = summarizeCart(cart);

    return {
      cartId: cart?.id || id,
      checkoutUrl: cart?.checkoutUrl || "",
      cart,
      cartSummary,
      contextPatch: cart?.id
        ? {
            ids: { cartId: cart.id },
            checkoutUrl: cart.checkoutUrl || "",
          }
        : undefined,
      message: cartSummary
        ? `You have ${cartSummary.totalQuantity} item${cartSummary.totalQuantity === 1 ? "" : "s"} in your cart.`
        : "Here’s your cart.",
    };
  } catch (err) {
    return buildToolError("CART_FETCH_FAILED", extractErrorMessage(err) || "Unable to fetch cart.", {
      timeoutMs: SHOPIFY_TIMEOUT_MS,
    });
  }
}

function normalizeUpdateLines(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  const out = arr
    .map((l) => {
      if (!l || typeof l !== "object") return null;
      const id = String(l.id || l.lineId || "").trim();
      const quantity = Number(l.quantity);
      if (!id) return null;
      if (!Number.isFinite(quantity) || quantity < 0) return null;
      return { id, quantity: Math.floor(quantity) };
    })
    .filter(Boolean);
  return out.length ? out : null;
}

async function updateCartLinesTool({ cartId, lines, thread_id, context } = {}) {
  const apiBase = getApiBase();
  if (!apiBase) {
    return buildToolError(
      "MISSING_API_GATEWAY_HOST",
      "Backend cart service is not configured (API_GATEWAY_HOST is missing)."
    );
  }

  const id = resolveCartId({ cartId, thread_id, context });

  if (!id) {
    return buildToolError("MISSING_CART_ID", "No cart found yet. Add an item first.");
  }

  const safeLines = normalizeUpdateLines(lines);
  if (!safeLines) {
    return buildToolError(
      "MISSING_LINES",
      "Provide lines:[{id, quantity}] to update quantities."
    );
  }

  try {
    const resp = await axios.post(
      joinUrl(apiBase, "/shopify/cart/updateLines"),
      { cartId: id, lines: safeLines },
      { headers: { "Content-Type": "application/json" }, timeout: SHOPIFY_TIMEOUT_MS }
    );

    const cart = extractCartFromApiResponse(resp.data) || unwrapApiEnvelope(resp.data) || resp.data;

    if (!cart || !cart.id) {
      return buildToolError("CART_RESPONSE_INVALID", "Update response missing cart.");
    }

    const patch = {
      ids: { cartId: cart.id },
      checkoutUrl: cart.checkoutUrl || "",
    };

    if (thread_id) setThreadState(thread_id, patch);

    const cartSummary = summarizeCart(cart);

    return {
      cartId: cart.id,
      checkoutUrl: cart.checkoutUrl || "",
      cart,
      cartSummary,
      contextPatch: patch,
      message: "Updated your cart.",
    };
  } catch (err) {
    return buildToolError(
      "CART_UPDATE_FAILED",
      extractErrorMessage(err) || "Unable to update cart lines.",
      { timeoutMs: SHOPIFY_TIMEOUT_MS }
    );
  }
}

function normalizeLineIds(lineIds) {
  const src = Array.isArray(lineIds) ? lineIds : [];
  const ids = Array.from(new Set(src.map((x) => String(x || "").trim()).filter(Boolean)));
  return ids.length ? ids : null;
}

async function removeCartLinesTool({ cartId, lineIds, ids, thread_id, context } = {}) {
  const apiBase = getApiBase();
  if (!apiBase) {
    return buildToolError(
      "MISSING_API_GATEWAY_HOST",
      "Backend cart service is not configured (API_GATEWAY_HOST is missing)."
    );
  }

  const id = resolveCartId({ cartId, thread_id, context });

  if (!id) {
    return buildToolError("MISSING_CART_ID", "No cart found yet. Add an item first.");
  }

  const normalizedIds = normalizeLineIds(lineIds || ids);

  if (!normalizedIds) {
    return buildToolError(
      "MISSING_LINE_IDS",
      "Provide lineIds:[...] to remove cart lines."
    );
  }

  try {
    const resp = await axios.post(
      joinUrl(apiBase, "/shopify/cart/removeLines"),
      { cartId: id, lineIds: normalizedIds },
      { headers: { "Content-Type": "application/json" }, timeout: SHOPIFY_TIMEOUT_MS }
    );

    const cart = extractCartFromApiResponse(resp.data) || unwrapApiEnvelope(resp.data) || resp.data;

    if (!cart || !cart.id) {
      return buildToolError("CART_RESPONSE_INVALID", "Remove response missing cart.");
    }

    const patch = {
      ids: { cartId: cart.id },
      checkoutUrl: cart.checkoutUrl || "",
    };

    if (thread_id) setThreadState(thread_id, patch);

    const cartSummary = summarizeCart(cart);

    return {
      cartId: cart.id,
      checkoutUrl: cart.checkoutUrl || "",
      cart,
      cartSummary,
      contextPatch: patch,
      message: "Removed that from your cart.",
    };
  } catch (err) {
    return buildToolError(
      "CART_REMOVE_FAILED",
      extractErrorMessage(err) || "Unable to remove cart lines.",
      { timeoutMs: SHOPIFY_TIMEOUT_MS }
    );
  }
}

// -----------------------------------------------------------------------------
// Exports (wrapped in timeout guard)
// -----------------------------------------------------------------------------
module.exports = {
  // Shopify live pricing
  getProductPrice: (...args) =>
    withTimeout(getProductPrice(...args), SHOPIFY_TIMEOUT_MS, {
      error: "TOOL_TIMEOUT",
      tool: "getProductPrice",
      message: "Pricing tool timed out.",
      timeoutMs: SHOPIFY_TIMEOUT_MS,
    }),

  // Deterministic helpers
  getFinancingOptions: (...args) =>
    withTimeout(getFinancingOptions(...args), TOOL_DEFAULT_TIMEOUT_MS, {
      error: "TOOL_TIMEOUT",
      tool: "getFinancingOptions",
      message: "Financing tool timed out.",
      timeoutMs: TOOL_DEFAULT_TIMEOUT_MS,
    }),
  getDeliveryTime: (...args) =>
    withTimeout(getDeliveryTime(...args), TOOL_DEFAULT_TIMEOUT_MS, {
      error: "TOOL_TIMEOUT",
      tool: "getDeliveryTime",
      message: "Delivery tool timed out.",
      timeoutMs: TOOL_DEFAULT_TIMEOUT_MS,
    }),
  getRewardEarnings: (...args) =>
    withTimeout(getRewardEarnings(...args), TOOL_DEFAULT_TIMEOUT_MS, {
      error: "TOOL_TIMEOUT",
      tool: "getRewardEarnings",
      message: "Rewards tool timed out.",
      timeoutMs: TOOL_DEFAULT_TIMEOUT_MS,
    }),
  getFeatureCompare: (...args) =>
    withTimeout(getFeatureCompare(...args), TOOL_DEFAULT_TIMEOUT_MS, {
      error: "TOOL_TIMEOUT",
      tool: "getFeatureCompare",
      message: "Compare tool timed out.",
      timeoutMs: TOOL_DEFAULT_TIMEOUT_MS,
    }),

  // cart-first behavior (still named createCheckout for compatibility)
  createCheckout: (...args) =>
    withTimeout(createCheckout(...args), SHOPIFY_TIMEOUT_MS, {
      error: "TOOL_TIMEOUT",
      tool: "createCheckout",
      message: "Cart tool timed out.",
      timeoutMs: SHOPIFY_TIMEOUT_MS,
    }),

  // cart ops
  getCart: (...args) =>
    withTimeout(getCart(...args), SHOPIFY_TIMEOUT_MS, {
      error: "TOOL_TIMEOUT",
      tool: "getCart",
      message: "Cart fetch timed out.",
      timeoutMs: SHOPIFY_TIMEOUT_MS,
    }),
  updateCartLines: (...args) =>
    withTimeout(updateCartLinesTool(...args), SHOPIFY_TIMEOUT_MS, {
      error: "TOOL_TIMEOUT",
      tool: "updateCartLines",
      message: "Cart update timed out.",
      timeoutMs: SHOPIFY_TIMEOUT_MS,
    }),
  removeCartLines: (...args) =>
    withTimeout(removeCartLinesTool(...args), SHOPIFY_TIMEOUT_MS, {
      error: "TOOL_TIMEOUT",
      tool: "removeCartLines",
      message: "Cart remove timed out.",
      timeoutMs: SHOPIFY_TIMEOUT_MS,
    }),

  // expose for deterministic higher layers if needed
  summarizeCart,
};