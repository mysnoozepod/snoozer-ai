// routes/shopifyRoutes.js
const {
  fetchProducts,
  fetchProduct,
  createCart,
  getCart,
  addCartLines,
  updateCartLines,
  removeCartLines,
} = require("../services/shopify");
const { getSleepEssentialsCatalog } = require("../services/sleepEssentialsCatalog");
const shopperCart = require("../services/shopperCart");

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const ROUTE_TIMEOUT_MS = Math.max(100, Number(process.env.SHOPIFY_TIMEOUT_MS || 800));

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function parseBody(event = {}) {
  let raw = event.body || "";

  if (event.isBase64Encoded && typeof raw === "string") {
    try {
      raw = Buffer.from(raw, "base64").toString("utf-8");
    } catch {
      // ignore
    }
  }

  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      // ignore
    }
  }

  return {};
}

function parseQuery(event = {}) {
  const qs =
    event.queryStringParameters ||
    (event.rawQueryString &&
      Object.fromEntries(new URLSearchParams(event.rawQueryString))) ||
    {};

  return qs || {};
}

function parseBool(v, def = false) {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function clampInt(n, { min = 1, max = 50, def = 10 } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return def;
  const i = Math.floor(x);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function getHeader(headers = {}, name = "") {
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return undefined;
}

function getTraceId(event = {}) {
  return (
    getHeader(event.headers, "x-trace-id") ||
    getHeader(event.headers, "X-Trace-Id") ||
    event.requestContext?.requestId ||
    `trc_${Math.random().toString(36).slice(2, 10)}`
  );
}

function tokenizeQuery(q = "") {
  return String(q || "")
    .toLowerCase()
    .replace(/[^\w\s-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function toOrQuery(q = "") {
  const tokens = tokenizeQuery(q);
  if (!tokens.length) return "";
  return tokens.join(" OR ");
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;

  return Promise.race([
    Promise.resolve().then(() => promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} exceeded ${timeoutMs}ms`);
        err.code = "SHOPIFY_ROUTE_TIMEOUT";
        err.timeoutMs = timeoutMs;
        reject(err);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isTimeoutError(err) {
  const code = String(err?.code || "").toUpperCase();
  return code.includes("TIMEOUT") || /timeout/i.test(String(err?.message || ""));
}

function buildMeta(event, extra = {}) {
  return {
    traceId: getTraceId(event),
    timeoutMs: ROUTE_TIMEOUT_MS,
    ...extra,
  };
}

// unified inputs (accept GET query or POST body)
function getListArgs(event = {}) {
  const qs = parseQuery(event);
  const body = parseBody(event);

  const from = (k, fallback = undefined) =>
    body[k] !== undefined ? body[k] : qs[k] !== undefined ? qs[k] : fallback;

  const collection = from("collection", null);
  const limitRaw = from("limit", from("first", undefined));
  const page_info = from("page_info", from("after", null));
  const q = (from("q", "") || "").toString();

  const liteRaw = from("lite", undefined);
  const lite = liteRaw === undefined ? undefined : parseBool(liteRaw, false);

  const fallbackRaw = from("fallback", undefined);
  const fallback = fallbackRaw === undefined ? true : parseBool(fallbackRaw, true);

  const limit = limitRaw != null ? clampInt(limitRaw, { min: 1, max: 50, def: 10 }) : undefined;

  return { collection, limit, page_info, q, lite, fallback };
}

// Extract trailing segment we consider the id/handle, regardless of route shape
function extractIdOrHandle(event = {}) {
  const p = event.pathParameters || {};
  const direct = p.idOrHandle || p.id || p.handle || p.productId || p.slug || null;

  if (direct) return decodeURIComponent(String(direct));

  const path = String(event.path || event.rawPath || "");
  const m = path.match(/\/shopify\/(?:products|product)\/([^/?#]+)/i);
  if (m && m[1]) return decodeURIComponent(m[1]);

  return null;
}

function coerceObjectPayload(data) {
  if (!data) return { data: null, wrapped: true };
  if (Array.isArray(data)) return { data: { items: data }, wrapped: true };
  if (typeof data === "object") return { data, wrapped: false };
  return { data: { value: data }, wrapped: true };
}

// ─────────────────────────────────────────────────────────────
// ID validation / normalization
// ─────────────────────────────────────────────────────────────

// Variant GID: gid://shopify/ProductVariant/123 (never /0)
function isValidVariantGid(id) {
  if (typeof id !== "string") return false;
  const s = id.trim();
  if (!s) return false;
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s)) return false;
  if (s.endsWith("/0")) return false;
  return true;
}

function isDigits(s) {
  return typeof s === "string" && /^\d+$/.test(s);
}

function toVariantGid(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (s.startsWith("gid://")) {
    return isValidVariantGid(s) ? s : null;
  }

  if (isDigits(s)) {
    if (s === "0") return null;
    return `gid://shopify/ProductVariant/${s}`;
  }

  return null;
}

// Cart GID: gid://shopify/Cart/<token>
function isValidCartGid(id) {
  if (typeof id !== "string") return false;
  const s = id.trim();
  if (!s) return false;
  return /^gid:\/\/shopify\/Cart\/[A-Za-z0-9+/=._-]+$/.test(s);
}

// ─────────────────────────────────────────────────────────────
// Cart line normalization (attributes + qty hardening)
// ─────────────────────────────────────────────────────────────
function normalizeAttributes(attrs) {
  if (!attrs) return null;

  if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
    const out = Object.entries(attrs)
      .map(([k, v]) => {
        const key = String(k ?? "").trim();
        const value = String(v ?? "").trim();
        if (!key || !value) return null;
        return { key, value };
      })
      .filter(Boolean);
    return out.length ? out : null;
  }

  if (!Array.isArray(attrs) || attrs.length === 0) return null;

  const out = attrs
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

  return out.length ? out : null;
}

function normalizeLinesFromBody(body = {}) {
  let lines = Array.isArray(body.lines) ? body.lines : null;

  if (!lines || lines.length === 0) {
    const variantId = body.variantId || body.merchandiseId || null;
    const quantity = Math.max(1, Math.floor(Number(body.quantity ?? 1) || 1));

    if (variantId) {
      lines = [
        {
          merchandiseId: variantId,
          quantity,
          attributes: body.attributes || undefined,
        },
      ];
    }
  }

  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    return { lines: null, error: "lines array is required" };
  }

  const normalized = lines
    .map((l) => {
      const rawId = l?.merchandiseId || l?.variantId || l?.id || l?.variant_id;
      const merchandiseId = toVariantGid(rawId);
      const quantity = Math.max(1, Math.floor(Number(l?.quantity ?? 1) || 1));
      const attributes = normalizeAttributes(l?.attributes);

      if (!merchandiseId) {
        return {
          __bad: true,
          reason: "Invalid merchandiseId",
          rawId: rawId ?? null,
          quantity,
        };
      }

      const out = { merchandiseId, quantity };
      if (attributes && attributes.length) out.attributes = attributes;
      return out;
    })
    .filter(Boolean);

  const bad = normalized.find((x) => x && x.__bad);
  if (bad) {
    return {
      lines: null,
      error: "Invalid merchandiseId",
      badLine: bad,
    };
  }

  return { lines: normalized, error: null };
}

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function countItems(data) {
  if (Array.isArray(data?.items)) return data.items.length;
  if (Array.isArray(data?.products)) return data.products.length;
  if (Array.isArray(data?.edges)) return data.edges.length;
  if (Array.isArray(data?.nodes)) return data.nodes.length;
  return 0;
}

// ─────────────────────────────────────────────────────────────
// List products: GET/POST /shopify/listProducts
// Supports: collection, limit, page_info, q, lite, fallback
//
// HARDENED:
// - If q returns 0 results, attempt a token OR search before falling back to q=""
// - Always inject traceId diagnostics in meta
// ─────────────────────────────────────────────────────────────
async function listProducts(event = {}) {
  const traceId = getTraceId(event);

  try {
    const { collection, limit, page_info, q, lite, fallback } = getListArgs(event);
    const q0 = (q || "").toString().trim();

    const attempts = [];
    if (q0) attempts.push({ label: "primary", q: q0 });
    if (q0) {
      const orQ = toOrQuery(q0);
      if (orQ && orQ !== q0) attempts.push({ label: "or_tokens", q: orQ });
    }
    attempts.push({ label: "browse", q: "" });

    const plan = fallback === false ? attempts.slice(0, 1) : attempts;

    let data = null;
    let usedAttempt = null;

    for (let i = 0; i < plan.length; i++) {
      const a = plan[i];
      const resp = await withTimeout(
        fetchProducts({
          collection,
          limit,
          pageInfo: page_info,
          q: a.q,
          lite,
        }),
        ROUTE_TIMEOUT_MS,
        "shopify.listProducts"
      );

      const { data: obj } = coerceObjectPayload(resp);
      const c = countItems(obj);

      usedAttempt = { ...a, count: c };

      if (c > 0 || a.q === "") {
        data = obj;
        break;
      }
    }

    if (!data) {
      const resp = await withTimeout(
        fetchProducts({
          collection,
          limit,
          pageInfo: page_info,
          q: q0,
          lite,
        }),
        ROUTE_TIMEOUT_MS,
        "shopify.listProducts"
      );
      const { data: obj } = coerceObjectPayload(resp);
      data = obj;
      usedAttempt = { label: "primary_forced", q: q0, count: countItems(data) };
    }

    data.meta = {
      ...(data.meta || {}),
      traceId,
      requestedQuery: q0,
      attemptUsed: usedAttempt?.label || null,
      effectiveQuery: usedAttempt?.q ?? q0,
      attemptCount: usedAttempt?.count ?? countItems(data),
      fallbackEnabled: fallback !== false,
      timeoutMs: ROUTE_TIMEOUT_MS,
    };

    const isSearch = !!(q0 && q0.trim());
    const maxAge = isSearch ? 20 : 60;

    return json(200, data, {
      "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}`,
      "X-Trace-Id": traceId,
    });
  } catch (err) {
    const msg = err?.message || "Unknown error";
    const status = isTimeoutError(err) ? 504 : /not found|invalid|missing/i.test(msg) ? 400 : 500;

    return json(
      status,
      {
        error: isTimeoutError(err) ? "List timed out" : "List failed",
        message: msg,
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }
}

// ─────────────────────────────────────────────────────────────
// One product (by numeric ID or handle)
// Accepts idOrHandle via path OR { idOrHandle } in POST body.
// ─────────────────────────────────────────────────────────────
async function getProduct(event = {}) {
  const traceId = getTraceId(event);

  try {
    const body = parseBody(event);
    const idOrHandle = body.idOrHandle || extractIdOrHandle(event);

    if (!idOrHandle) {
      return json(
        400,
        {
          error: "Missing idOrHandle.",
          path: event.path || event.rawPath || "",
          meta: buildMeta(event),
        },
        { "X-Trace-Id": traceId }
      );
    }

    const resp = await withTimeout(
      fetchProduct({ idOrHandle }),
      ROUTE_TIMEOUT_MS,
      "shopify.getProduct"
    );
    const { data } = coerceObjectPayload(resp);

    if (!data || (data.product == null && data.id == null && data.title == null)) {
      return json(
        404,
        { error: "Not Found", idOrHandle, meta: buildMeta(event) },
        { "X-Trace-Id": traceId }
      );
    }

    data.meta = { ...(data.meta || {}), traceId, timeoutMs: ROUTE_TIMEOUT_MS };

    return json(200, data, {
      "Cache-Control": "public, max-age=120, s-maxage=120",
      "X-Trace-Id": traceId,
    });
  } catch (err) {
    return json(
      isTimeoutError(err) ? 504 : 500,
      {
        error: isTimeoutError(err) ? "Get product timed out" : "Get product failed",
        message: err?.message || "Unknown error",
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Create cart (RPC): POST /shopify/createCart
// ─────────────────────────────────────────────────────────────
async function createCartRoute(event = {}) {
  const traceId = getTraceId(event);
  const body = parseBody(event);

  const { lines, error, badLine } = normalizeLinesFromBody(body);

  if (!lines) {
    const isInvalidId = error === "Invalid merchandiseId";
    return json(
      400,
      {
        error: error || "lines array is required",
        message: isInvalidId
          ? "Cart line is missing a valid Shopify ProductVariant ID or GID. Re-select the item and size and try again."
          : "Provide either lines[] or a variantId plus quantity so I can build the cart.",
        ...(badLine ? { badLine } : {}),
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }

  try {
    const cart = await withTimeout(
      createCart({
        lines,
        note: body.note || null,
        buyerIdentity: body.buyerIdentity || null,
      }),
      ROUTE_TIMEOUT_MS,
      "shopify.createCart"
    );

    return json(
      200,
      {
        cart,
        cartId: cart?.id || null,
        id: cart?.id || null,
        checkoutUrl: cart?.checkoutUrl || null,
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  } catch (err) {
    return json(
      isTimeoutError(err) ? 504 : 400,
      {
        error: isTimeoutError(err) ? "Cart creation timed out" : "Cart creation failed",
        message: err?.message || "Unknown error",
        userErrors: err?.userErrors || [],
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Persistent cart routes
// ─────────────────────────────────────────────────────────────
async function getCartRoute(event = {}) {
  const traceId = getTraceId(event);
  const body = parseBody(event);
  const cartId = body.cartId || body.id || null;

  if (!cartId || !isValidCartGid(String(cartId))) {
    return json(
      400,
      {
        error: "Invalid cartId",
        message: "Provide a valid Shopify Cart GID (gid://shopify/Cart/...).",
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }

  try {
    const cart = await withTimeout(
      getCart({ cartId: String(cartId) }),
      ROUTE_TIMEOUT_MS,
      "shopify.getCart"
    );

    return json(
      200,
      {
        cart,
        cartId: cart?.id || null,
        id: cart?.id || null,
        checkoutUrl: cart?.checkoutUrl || null,
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  } catch (err) {
    return json(
      isTimeoutError(err) ? 504 : 400,
      {
        error: isTimeoutError(err) ? "Cart fetch timed out" : "Cart fetch failed",
        message: err?.message || "Unknown error",
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }
}

async function addCartLinesRoute(event = {}) {
  const traceId = getTraceId(event);
  const body = parseBody(event);
  const cartId = body.cartId || body.id || null;

  if (!cartId || !isValidCartGid(String(cartId))) {
    return json(
      400,
      {
        error: "Invalid cartId",
        message: "Provide a valid Shopify Cart GID (gid://shopify/Cart/...).",
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }

  const { lines, error, badLine } = normalizeLinesFromBody(body);
  if (!lines) {
    return json(
      400,
      {
        error: error || "lines array is required",
        message: "Provide lines[] (or variantId plus quantity) with a valid ProductVariant ID or GID.",
        ...(badLine ? { badLine } : {}),
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }

  try {
    const cart = await withTimeout(
      addCartLines({ cartId: String(cartId), lines }),
      ROUTE_TIMEOUT_MS,
      "shopify.addCartLines"
    );

    return json(
      200,
      {
        cart,
        cartId: cart?.id || null,
        id: cart?.id || null,
        checkoutUrl: cart?.checkoutUrl || null,
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  } catch (err) {
    return json(
      isTimeoutError(err) ? 504 : 400,
      {
        error: isTimeoutError(err) ? "Add lines timed out" : "Add lines failed",
        message: err?.message || "Unknown error",
        userErrors: err?.userErrors || [],
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }
}

async function updateCartLinesRoute(event = {}) {
  const traceId = getTraceId(event);
  const body = parseBody(event);
  const cartId = body.cartId || body.id || null;

  if (!cartId || !isValidCartGid(String(cartId))) {
    return json(
      400,
      {
        error: "Invalid cartId",
        message: "Provide a valid Shopify Cart GID (gid://shopify/Cart/...).",
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }

  const lines = Array.isArray(body.lines) ? body.lines : null;
  if (!lines || !lines.length) {
    return json(
      400,
      {
        error: "lines array is required",
        message: "Provide lines:[{id, quantity}] to update quantities.",
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }

  const normalized = lines
    .map((l) => {
      const id = l?.id || l?.lineId || null;
      const quantity = Number(l?.quantity);
      if (!id || !Number.isFinite(quantity) || quantity < 0) return null;
      return { id: String(id), quantity: Math.floor(quantity) };
    })
    .filter(Boolean);

  if (!normalized.length) {
    return json(
      400,
      {
        error: "Invalid lines",
        message: "Provide valid line updates like { id, quantity }.",
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }

  try {
    const cart = await withTimeout(
      updateCartLines({ cartId: String(cartId), lines: normalized }),
      ROUTE_TIMEOUT_MS,
      "shopify.updateCartLines"
    );

    return json(
      200,
      {
        cart,
        cartId: cart?.id || null,
        id: cart?.id || null,
        checkoutUrl: cart?.checkoutUrl || null,
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  } catch (err) {
    return json(
      isTimeoutError(err) ? 504 : 400,
      {
        error: isTimeoutError(err) ? "Update lines timed out" : "Update lines failed",
        message: err?.message || "Unknown error",
        userErrors: err?.userErrors || [],
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }
}

async function removeCartLinesRoute(event = {}) {
  const traceId = getTraceId(event);
  const body = parseBody(event);
  const cartId = body.cartId || body.id || null;

  if (!cartId || !isValidCartGid(String(cartId))) {
    return json(
      400,
      {
        error: "Invalid cartId",
        message: "Provide a valid Shopify Cart GID (gid://shopify/Cart/...).",
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }

  const lineIds = Array.isArray(body.lineIds) ? body.lineIds : null;
  const ids = Array.from(new Set((lineIds || []).map((x) => String(x || "").trim()).filter(Boolean)));

  if (!ids.length) {
    return json(
      400,
      {
        error: "lineIds array is required",
        message: "Provide lineIds:[...] to remove cart lines.",
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }

  try {
    const cart = await withTimeout(
      removeCartLines({ cartId: String(cartId), lineIds: ids }),
      ROUTE_TIMEOUT_MS,
      "shopify.removeCartLines"
    );

    return json(
      200,
      {
        cart,
        cartId: cart?.id || null,
        id: cart?.id || null,
        checkoutUrl: cart?.checkoutUrl || null,
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  } catch (err) {
    return json(
      isTimeoutError(err) ? 504 : 400,
      {
        error: isTimeoutError(err) ? "Remove lines timed out" : "Remove lines failed",
        message: err?.message || "Unknown error",
        userErrors: err?.userErrors || [],
        meta: buildMeta(event),
      },
      { "X-Trace-Id": traceId }
    );
  }
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

async function handleShopifyRoute({ event, method, routePath }) {
  if (method === "POST" && routePath.startsWith("/shopify/cart/owned/")) {
    const body = parseBody(event);
    try {
      let result;
      if (routePath === "/shopify/cart/owned/resolve") {
        result = await shopperCart.resolveShopperCart(event);
      } else if (routePath === "/shopify/cart/owned/addLines") {
        const normalized = normalizeLinesFromBody(body);
        if (!normalized.lines) {
          return json(400, { error: normalized.error || "Invalid lines", meta: buildMeta(event) });
        }
        result = await shopperCart.addShopperCartLines(event, normalized.lines);
      } else if (routePath === "/shopify/cart/owned/updateLines") {
        const lines = (Array.isArray(body.lines) ? body.lines : [])
          .map((line) => ({ id: clean(line?.id || line?.lineId), quantity: Number(line?.quantity) }))
          .filter((line) => line.id && Number.isFinite(line.quantity) && line.quantity >= 0);
        if (!lines.length) return json(400, { error: "Invalid lines", meta: buildMeta(event) });
        result = await shopperCart.updateShopperCartLines(event, lines);
      } else if (routePath === "/shopify/cart/owned/removeLines") {
        const lineIds = [...new Set((body.lineIds || []).map(clean).filter(Boolean))];
        if (!lineIds.length) return json(400, { error: "Invalid lineIds", meta: buildMeta(event) });
        result = await shopperCart.removeShopperCartLines(event, lineIds);
      } else {
        return null;
      }
      return json(200, { ...result, meta: buildMeta(event) });
    } catch (err) {
      return json(Number(err?.statusCode) || 400, {
        error: err?.code || "SHOPPER_CART_FAILED",
        message: err?.message || "The shopper cart request failed.",
        meta: buildMeta(event),
      });
    }
  }

  if (method === "POST" && routePath === "/shopify/sleepEssentials/catalog") {
    try {
      const body = parseBody(event);
      const catalog = await withTimeout(
        getSleepEssentialsCatalog({ categoryId: body.categoryId }),
        Math.max(ROUTE_TIMEOUT_MS, 3000),
        "shopify.sleepEssentialsCatalog"
      );
      return json(200, { catalog, meta: buildMeta(event) });
    } catch (err) {
      return json(Number(err?.statusCode) || (isTimeoutError(err) ? 504 : 500), {
        error: err?.code || "SLEEP_ESSENTIALS_CATALOG_FAILED",
        message: err?.message || "Sleep Essentials catalog could not be loaded.",
        meta: buildMeta(event),
      });
    }
  }

  if (method === "POST" && routePath === "/shopify/listProducts") {
    return withTimeout(
      listProducts(event),
      ROUTE_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify listProducts exceeded ${ROUTE_TIMEOUT_MS}ms`
    );
  }

  if (method === "POST" && routePath === "/shopify/getProduct") {
    return withTimeout(
      getProduct(event),
      ROUTE_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify getProduct exceeded ${ROUTE_TIMEOUT_MS}ms`
    );
  }

  if (method === "POST" && (routePath === "/shopify/createCart" || routePath === "/shopify/cart")) {
    return withTimeout(
      createCartRoute(event),
      ROUTE_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify createCart exceeded ${ROUTE_TIMEOUT_MS}ms`
    );
  }

  if (method === "POST" && routePath === "/shopify/cart/get") {
    return withTimeout(
      getCartRoute(event),
      ROUTE_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify getCart exceeded ${ROUTE_TIMEOUT_MS}ms`
    );
  }

  if (method === "POST" && routePath === "/shopify/cart/addLines") {
    return withTimeout(
      addCartLinesRoute(event),
      ROUTE_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify addCartLines exceeded ${ROUTE_TIMEOUT_MS}ms`
    );
  }

  if (method === "POST" && routePath === "/shopify/cart/updateLines") {
    return withTimeout(
      updateCartLinesRoute(event),
      ROUTE_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify updateCartLines exceeded ${ROUTE_TIMEOUT_MS}ms`
    );
  }

  if (method === "POST" && routePath === "/shopify/cart/removeLines") {
    return withTimeout(
      removeCartLinesRoute(event),
      ROUTE_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify removeCartLines exceeded ${ROUTE_TIMEOUT_MS}ms`
    );
  }

  return null;
}

module.exports = {
  listProducts,
  getProduct,

  // cart create (legacy name kept)
  createCart: createCartRoute,

  // persistent cart ops
  getCart: getCartRoute,
  addCartLines: addCartLinesRoute,
  updateCartLines: updateCartLinesRoute,
  removeCartLines: removeCartLinesRoute,
  handleShopifyRoute,
};
