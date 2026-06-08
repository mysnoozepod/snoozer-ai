// src/lib/api.js
// Frontend API client aligned to RPC-style backend endpoints.
// Adds: cart helpers (getCart, addLines, updateLines, removeLines) + stronger normalization.
// Adds: lightweight session bootstrapping + automatic x-session-id header when available.
//
// FIXES (2026-03-01):
// - HUD response compatibility (speech/captions/state/priority/ttlMs/actions)
// - Pod mode: attempt to inject podId into request body/context to satisfy strict anchoring
//
// FIXES (2026-03-04):
// - Stronger product normalization for image/featuredImage/images/media payload shapes
// - getProducts() and getProductById() now return normalized product objects with stable image fields
//
// FIXES (2026-03-12):
// - Cart GID normalization + persistence safety
// - createCart/addLines/getCart now preserve/return canonical gid://shopify/Cart/... ids
// - sessionStore context patch compatibility
//
// FIXES (2026-03-14):
// - Added voice welcome helper for Polly-backed welcome audio
// - Supports audio blob responses, JSON audioUrl responses, and JSON/base64 audio payloads
//
// FIXES (2026-03-25):
// - Stronger product list payload normalization for out.products / out.result.items / nested shapes
// - Added getProductsIndexByHandle() for one-pass image lookup in Results/Pod UI
// - getProductById() now falls back to exact-handle search from listProducts when getProduct misses

import { getSessionState, setCartIdentity } from "@/state/sessionStore";

let API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "";
if (API_BASE && !/\/(prod|staging|dev)$/i.test(API_BASE)) {
  API_BASE += "/prod";
}

const DEFAULT_TIMEOUT = Number(import.meta.env.VITE_API_TIMEOUT_MS || 20000);
const RETRY_BACKOFF_MS = 600;

const CACHE_KEYS = {
  assessETag: "snooze.assessmentQuestions.etag",
  assessBody: "snooze.assessmentQuestions.body",
};

const SESSION_KEY = "snooze.sessionId";
const CART_ID_KEYS = ["snooze.shopify.cartId", "snooze.cartId"];
const CHECKOUT_URL_KEYS = ["snooze.shopify.checkoutUrl", "snooze.checkoutUrl"];

let _sessionPromise = null;

export function getSessionId() {
  try {
    const s = typeof getSessionState === "function" ? getSessionState() : null;
    const id = s?.sessionId || s?.session_id || s?.id || null;
    if (id) return String(id);
  } catch {
    // ignore
  }

  try {
    const ss = sessionStorage.getItem(SESSION_KEY);
    if (ss) return String(ss);
  } catch {
    // ignore
  }

  try {
    const ls = localStorage.getItem(SESSION_KEY);
    if (ls) return String(ls);
  } catch {
    // ignore
  }

  return null;
}

export async function ensureSession({ force = false } = {}) {
  const existing = getSessionId();
  if (existing && !force) return existing;

  if (_sessionPromise && !force) return _sessionPromise;

  _sessionPromise = (async () => {
    const raw = await retryableRequest("/session/start", {
      method: "POST",
      body: { origin: "web" },
    });

    const data = unwrap(raw) || raw || {};
    const id = data.sessionId || data.session_id || data.id || null;
    if (!id) return null;

    try {
      sessionStorage.setItem(SESSION_KEY, String(id));
    } catch {
      // ignore
    }
    try {
      localStorage.setItem(SESSION_KEY, String(id));
    } catch {
      // ignore
    }

    return String(id);
  })();

  try {
    return await _sessionPromise;
  } finally {
    _sessionPromise = null;
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function startTimeout(controller, ms = DEFAULT_TIMEOUT) {
  const t = setTimeout(() => controller.abort(), ms);
  return () => clearTimeout(t);
}

function unwrap(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (Object.prototype.hasOwnProperty.call(payload, "data")) return payload.data;
  return payload;
}

function bestErrorMessage(data, status) {
  if (!data) return `HTTP ${status}`;
  if (typeof data === "string") return data;

  const direct =
    data.message ||
    data.error?.message ||
    data.error?.error?.message ||
    data.error ||
    data.msg;

  if (typeof direct === "string" && direct.trim()) return direct;

  try {
    return JSON.stringify(data);
  } catch {
    return `HTTP ${status}`;
  }
}

function stripSlashes(s) {
  return String(s || "").replace(/^\/+|\/+$/g, "");
}

function joinUrl(base, path) {
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  if (!b) return `/${p}`;
  return `${b}/${p}`;
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  return [];
}

function firstNonEmptyString(values) {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

function flattenConnectionArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.nodes)) return value.nodes;
  if (Array.isArray(value?.edges)) {
    return value.edges.map((e) => e?.node).filter(Boolean);
  }
  return [];
}

function normalizeImageNode(node) {
  if (!node) return null;

  const url = firstNonEmptyString([
    node?.url,
    node?.src,
    node?.originalSrc,
    node?.transformedSrc,
    node?.image?.url,
    node?.image?.src,
    node?.preview?.image?.url,
    node?.preview?.image?.src,
    node?.node?.url,
    node?.node?.src,
  ]);

  if (!url) return null;

  return {
    url,
    altText: firstNonEmptyString([
      node?.altText,
      node?.alt,
      node?.image?.altText,
      node?.image?.alt,
      node?.node?.altText,
      node?.node?.alt,
    ]),
  };
}

function extractNormalizedImages(product) {
  const rawCandidates = [
    ...flattenConnectionArray(product?.images),
    ...flattenConnectionArray(product?.media),
  ];

  const featuredCandidates = [
    product?.featuredImage,
    product?.featured_image,
    product?.image,
  ];

  const normalized = [];

  for (const raw of [...featuredCandidates, ...rawCandidates]) {
    const img = normalizeImageNode(raw);
    if (img?.url) normalized.push(img);
  }

  const deduped = [];
  const seen = new Set();

  for (const img of normalized) {
    if (!img?.url) continue;
    if (seen.has(img.url)) continue;
    seen.add(img.url);
    deduped.push(img);
  }

  return deduped;
}

function normalizeVariantNode(variant) {
  if (!variant || typeof variant !== "object") return null;

  const id = firstNonEmptyString([
    variant?.id,
    variant?.variantId,
    variant?.variant_id,
    variant?.shopifyVariantId,
  ]);

  const title = firstNonEmptyString([variant?.title, variant?.name]);
  const availableForSale =
    typeof variant?.availableForSale === "boolean"
      ? variant.availableForSale
      : typeof variant?.available === "boolean"
      ? variant.available
      : typeof variant?.available_for_sale === "boolean"
      ? variant.available_for_sale
      : undefined;

  const price = firstNonEmptyString([
    variant?.price?.amount,
    variant?.price,
    variant?.amount,
    variant?.priceV2?.amount,
  ]);

  const compareAtPrice = firstNonEmptyString([
    variant?.compareAtPrice?.amount,
    variant?.compareAtPrice,
    variant?.compareAtPriceV2?.amount,
  ]);

  const image = normalizeImageNode(
    variant?.image || variant?.featuredImage || variant?.featured_image
  );

  return {
    ...variant,
    id: id || variant?.id || null,
    title,
    availableForSale,
    price,
    compareAtPrice,
    image: image?.url || "",
    imageUrl: image?.url || "",
    featuredImage: image || null,
  };
}

function normalizeProduct(product) {
  if (!product || typeof product !== "object") return product;

  const images = extractNormalizedImages(product);
  const featuredImage = images[0] || null;

  const variantsRaw = flattenConnectionArray(product?.variants);
  const variants = variantsRaw.map(normalizeVariantNode).filter(Boolean);

  const handle = firstNonEmptyString([
    product?.handle,
    product?.slug,
    product?.productHandle,
    product?.shopifyHandle,
  ]);

  const title = firstNonEmptyString([
    product?.title,
    product?.name,
    product?.productTitle,
  ]);

  const description = firstNonEmptyString([
    product?.description,
    product?.descriptionHtml,
    product?.body_html,
    product?.bodyHtml,
  ]);

  return {
    ...product,
    handle,
    title,
    description,
    image: featuredImage?.url || "",
    imageUrl: featuredImage?.url || "",
    featuredImage,
    images,
    variants,
  };
}

function normalizeProducts(items) {
  return asArray(items).map(normalizeProduct).filter(Boolean);
}

function extractProductsArray(payload) {
  const out = unwrap(payload) || payload || {};

  if (Array.isArray(out)) return out;
  if (Array.isArray(out?.items)) return out.items;
  if (Array.isArray(out?.products)) return out.products;
  if (Array.isArray(out?.data)) return out.data;
  if (Array.isArray(out?.result?.items)) return out.result.items;
  if (Array.isArray(out?.result?.products)) return out.result.products;
  if (Array.isArray(out?.payload?.items)) return out.payload.items;
  if (Array.isArray(out?.payload?.products)) return out.payload.products;

  return [];
}

function buildProductsResponse(payload) {
  const out = unwrap(payload) || payload || {};
  const items = normalizeProducts(extractProductsArray(out));
  const page_info =
    out?.page_info ||
    out?.pageInfo ||
    out?.cursor ||
    out?.pagination?.page_info ||
    null;

  return { items, page_info };
}

function buildRequestHeaders(method = "POST", headers = {}) {
  return {
    Accept: "application/json",
    ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
    ...(getSessionId() ? { "x-session-id": getSessionId() } : {}),
    ...(globalThis?.crypto?.randomUUID ? { "x-request-id": crypto.randomUUID() } : {}),
    ...(headers || {}),
  };
}

async function request(path, { method = "POST", query, body, headers } = {}) {
  if (!API_BASE) throw new Error("API base not configured (VITE_API_BASE missing)");

  const cleanPath = `/${stripSlashes(path)}`;
  let url = joinUrl(API_BASE, cleanPath);

  if (query && Object.keys(query).length) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null) qs.append(k, String(v));
    }
    url += `?${qs.toString()}`;
  }

  const controller = new AbortController();
  const clear = startTimeout(controller);

  try {
    const res = await fetch(url, {
      method,
      headers: buildRequestHeaders(method, headers),
      body: body != null && method !== "GET" ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");

    const data = isJson
      ? await res.json().catch(() => ({}))
      : await res.text().catch(() => "");

    if (!res.ok) {
      const err = new Error(bestErrorMessage(data, res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return { data, res };
  } finally {
    clear();
  }
}

async function retryableRequest(path, opts, retries = 1) {
  try {
    const { data } = await request(path, opts);
    return data;
  } catch (err) {
    const msg = err?.message || "";
    const isAbort = err?.name === "AbortError";
    const isNet = /network|failed|abort|timeout/i.test(msg);

    if (retries > 0 && (isAbort || isNet)) {
      console.warn("[api] retry backoff →", RETRY_BACKOFF_MS, "ms");
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      return retryableRequest(path, opts, retries - 1);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// Voice helpers
// ─────────────────────────────────────────────────────────────
function base64ToBlob(base64, mimeType = "audio/mpeg") {
  const clean = String(base64 || "").replace(/^data:[^;]+;base64,/, "");
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

function extractVoicePayload(payload) {
  const root = unwrap(payload) || payload || {};

  return {
    audioUrl:
      root?.audioUrl ||
      root?.url ||
      root?.signedUrl ||
      root?.s3Url ||
      root?.fileUrl ||
      null,
    audioBase64:
      root?.audioBase64 ||
      root?.base64 ||
      root?.audioContent ||
      root?.audio ||
      null,
    contentType:
      root?.contentType ||
      root?.mimeType ||
      root?.content_type ||
      "audio/mpeg",
    voiceId: root?.voiceId || root?.voice || null,
    requestId: root?.requestId || root?.traceId || null,
    raw: root,
  };
}

export async function synthesizeWelcomeVoice({
  shopperId = "guest",
  text,
  ssml,
  voiceId = "Ruth",
  engine = "generative",
  format = "mp3",
} = {}) {
  if (!API_BASE) throw new Error("API base not configured (VITE_API_BASE missing)");

  const cleanPath = "/voice/welcome";
  const url = joinUrl(API_BASE, cleanPath);

  const controller = new AbortController();
  const clear = startTimeout(controller, DEFAULT_TIMEOUT);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...buildRequestHeaders("POST"),
        Accept: "audio/mpeg, audio/*, application/json",
      },
      body: JSON.stringify({
        shopperId,
        ...(text ? { text } : {}),
        ...(ssml ? { ssml } : {}),
        ...(voiceId ? { voiceId } : {}),
        ...(engine ? { engine } : {}),
        ...(format ? { format } : {}),
      }),
      signal: controller.signal,
    });

    const contentType = (res.headers.get("content-type") || "").toLowerCase();

    if (!res.ok) {
      let errPayload = null;

      if (contentType.includes("application/json")) {
        errPayload = await res.json().catch(() => null);
      } else {
        errPayload = await res.text().catch(() => null);
      }

      const err = new Error(bestErrorMessage(errPayload, res.status));
      err.status = res.status;
      err.data = errPayload;
      throw err;
    }

    if (
      contentType.startsWith("audio/") ||
      contentType.includes("application/octet-stream")
    ) {
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      return {
        ok: true,
        mode: "blob",
        blob,
        objectUrl,
        audioUrl: objectUrl,
        contentType: blob.type || contentType || "audio/mpeg",
        cleanup: () => {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch {
            // ignore
          }
        },
      };
    }

    const payload = await res.json().catch(() => ({}));
    const voice = extractVoicePayload(payload);

    if (voice.audioUrl) {
      return {
        ok: true,
        mode: "url",
        audioUrl: String(voice.audioUrl),
        objectUrl: null,
        blob: null,
        contentType: voice.contentType,
        voiceId: voice.voiceId,
        requestId: voice.requestId,
        raw: voice.raw,
        cleanup: () => {},
      };
    }

    if (voice.audioBase64) {
      const blob = base64ToBlob(voice.audioBase64, voice.contentType);
      const objectUrl = URL.createObjectURL(blob);

      return {
        ok: true,
        mode: "base64",
        blob,
        objectUrl,
        audioUrl: objectUrl,
        contentType: blob.type || voice.contentType || "audio/mpeg",
        voiceId: voice.voiceId,
        requestId: voice.requestId,
        raw: voice.raw,
        cleanup: () => {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch {
            // ignore
          }
        },
      };
    }

    throw new Error("voice/welcome: backend returned no playable audio.");
  } finally {
    clear();
  }
}

// ─────────────────────────────────────────────────────────────
// Shopify helpers: IDs + cart lines normalization
// ─────────────────────────────────────────────────────────────
function isValidVariantGid(id) {
  if (!id) return false;
  const s = String(id).trim();
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s)) return false;
  if (s.endsWith("/0")) return false;
  return true;
}

function toVariantGid(id) {
  if (id === undefined || id === null) return null;
  const s = String(id).trim();
  if (!s) return null;

  if (s.startsWith("gid://")) {
    return isValidVariantGid(s) ? s : null;
  }

  if (/^\d+$/.test(s)) {
    if (s === "0") return null;
    return `gid://shopify/ProductVariant/${s}`;
  }

  return null;
}

function isValidCartGid(id) {
  if (!id) return false;
  const s = String(id).trim();
  return /^gid:\/\/shopify\/Cart\/[^/?#\s]+$/i.test(s);
}

function extractCartGid(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (isValidCartGid(s)) return s;

    const match = s.match(/gid:\/\/shopify\/Cart\/[^/?#\s]+/i);
    return match?.[0] && isValidCartGid(match[0]) ? match[0] : null;
  }

  if (typeof value === "object") {
    const candidates = [
      value?.id,
      value?.cartId,
      value?.cart?.id,
      value?.data?.id,
      value?.data?.cartId,
      value?.data?.cart?.id,
      value?.result?.cart?.id,
      value?.contextPatch?.ids?.cartId,
      value?.contextPatch?.cartId,
    ];

    for (const candidate of candidates) {
      const gid = extractCartGid(candidate);
      if (gid) return gid;
    }
  }

  return null;
}

function persistCartIdentity(cartId, checkoutUrl = null) {
  const gid = extractCartGid(cartId);

  if (gid) {
    for (const key of CART_ID_KEYS) {
      try {
        sessionStorage.setItem(key, gid);
      } catch {
        // ignore
      }
    }

    try {
      if (typeof setCartIdentity === "function") {
        setCartIdentity({
          cartId: gid,
          ...(checkoutUrl ? { checkoutUrl: String(checkoutUrl) } : {}),
        });
      }
    } catch {
      // ignore
    }
  }

  if (checkoutUrl) {
    for (const key of CHECKOUT_URL_KEYS) {
      try {
        sessionStorage.setItem(key, String(checkoutUrl));
      } catch {
        // ignore
      }
    }

    try {
      if (typeof setCartIdentity === "function") {
        setCartIdentity({
          ...(gid ? { cartId: gid } : {}),
          checkoutUrl: String(checkoutUrl),
        });
      }
    } catch {
      // ignore
    }
  }

  return gid;
}

function normalizeAttributes(attrs) {
  if (!attrs) return undefined;

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

  if (!Array.isArray(attrs) || !attrs.length) return undefined;

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

  return out.length ? out : undefined;
}

function normalizeCartLines({
  variantId,
  merchandiseId,
  quantity = 1,
  lines,
  attributes,
} = {}) {
  const out = [];

  if (Array.isArray(lines) && lines.length) {
    for (const rawLine of lines) {
      if (!rawLine || typeof rawLine !== "object") continue;

      const rawId =
        rawLine.merchandiseId ||
        rawLine.merchandise_id ||
        rawLine.variantId ||
        rawLine.variant_id ||
        rawLine.id;

      const merch = toVariantGid(rawId);
      if (!merch) continue;

      const qty = Number(rawLine.quantity ?? quantity ?? 1);
      const attrs = normalizeAttributes(rawLine.attributes);

      const line = {
        merchandiseId: merch,
        quantity: qty > 0 ? Math.floor(qty) : 1,
      };
      if (attrs && attrs.length) line.attributes = attrs;

      out.push(line);
    }
    return out;
  }

  const single = toVariantGid(merchandiseId || variantId);
  if (!single) return [];

  const qty = Number(quantity) || 1;
  const attrs = normalizeAttributes(attributes);

  const line = {
    merchandiseId: single,
    quantity: qty > 0 ? Math.floor(qty) : 1,
  };
  if (attrs && attrs.length) line.attributes = attrs;

  return [line];
}

function extractCartMeta(payload) {
  const root = payload && typeof payload === "object" ? payload : null;

  const cart =
    root?.cart ||
    root?.data?.cart ||
    root?.cartCreate?.cart ||
    root?.cartLinesAdd?.cart ||
    root?.cartLinesUpdate?.cart ||
    root?.cartLinesRemove?.cart ||
    root?.result?.cart ||
    null;

  const cartId = extractCartGid(
    cart?.id ||
      root?.cartId ||
      root?.data?.cartId ||
      root?.contextPatch?.ids?.cartId ||
      root?.contextPatch?.cartId ||
      null
  );

  const checkoutUrl =
    cart?.checkoutUrl ||
    root?.checkoutUrl ||
    root?.data?.checkoutUrl ||
    root?.contextPatch?.checkoutUrl ||
    null;

  return {
    cartId: cartId || null,
    checkoutUrl: checkoutUrl ? String(checkoutUrl) : null,
  };
}

function normalizeCartPayload(payload, fallbackCartId = null) {
  const root = payload && typeof payload === "object" ? payload : {};
  const meta = extractCartMeta(root);
  const cartId = meta.cartId || extractCartGid(fallbackCartId) || null;
  const checkoutUrl = meta.checkoutUrl || null;

  if (cartId || checkoutUrl) {
    persistCartIdentity(cartId, checkoutUrl);
  }

  return {
    ...root,
    ...(cartId ? { cartId } : {}),
    ...(checkoutUrl ? { checkoutUrl } : {}),
    cart:
      root?.cart ||
      root?.data?.cart ||
      (root?.cart ? root.cart : undefined),
  };
}

// ─────────────────────────────────────────────────────────────
// Shopify RPCs
// ─────────────────────────────────────────────────────────────
async function rpc(name, payload, init = {}) {
  const { data } = await request(`/shopify/${name}`, {
    method: init.method || "POST",
    body: payload,
    headers: init.headers,
    query: init.query,
  });
  return unwrap(data);
}

// Products
export async function getProducts({
  collection = null,
  limit = 12,
  page_info = null,
  q = "",
  lite,
} = {}) {
  const out = await rpc("listProducts", { collection, limit, page_info, q, lite });
  return buildProductsResponse(out);
}

export async function getProductsIndexByHandle({
  collection = null,
  limit = 250,
  q = "",
  lite = true,
} = {}) {
  const { items } = await getProducts({ collection, limit, q, lite });
  const index = {};

  for (const product of items || []) {
    const handle = String(product?.handle || "").trim();
    if (handle && !index[handle]) {
      index[handle] = product;
    }
  }

  return index;
}

export async function getProductById(idOrHandle) {
  if (!idOrHandle) throw new Error("idOrHandle required");

  const requested = String(idOrHandle).trim();
  const out = await rpc("getProduct", { idOrHandle: requested });
  const product = normalizeProduct(out?.data || out?.product || out);

  if (product?.handle || product?.imageUrl || product?.featuredImage?.url) {
    return product;
  }

  const { items } = await getProducts({ q: requested, limit: 100, lite: true });
  const exact =
    items.find((p) => String(p?.handle || "").trim() === requested) ||
    items.find((p) => String(p?.id || "").trim() === requested) ||
    null;

  return exact ? normalizeProduct(exact) : product;
}

// Cart: create + get + add/update/remove
export async function createCart({
  variantId,
  merchandiseId,
  quantity = 1,
  lines,
  attributes,
  note = null,
  buyerIdentity = null,
  currencyCode,
} = {}) {
  const finalLines = normalizeCartLines({
    variantId,
    merchandiseId,
    quantity,
    lines,
    attributes,
  });

  if (!finalLines.length) {
    throw new Error(
      "createCart: could not build any valid lines (missing/invalid ProductVariant IDs)."
    );
  }

  const out = await rpc("createCart", {
    lines: finalLines,
    note,
    buyerIdentity,
    currencyCode,
  });

  const normalized = normalizeCartPayload(out);
  if (!normalized?.cartId) {
    throw new Error("createCart: backend did not return a valid Shopify Cart GID.");
  }

  return normalized;
}

export async function getCart(cartId) {
  const gid = extractCartGid(cartId);
  if (!gid) throw new Error("getCart: valid Shopify Cart GID required");

  const out = await rpc("cart/get", { cartId: gid });
  return normalizeCartPayload(out, gid);
}

export async function addLinesToCart({
  cartId,
  variantId,
  merchandiseId,
  quantity = 1,
  lines,
  attributes,
} = {}) {
  const gid = extractCartGid(cartId);
  if (!gid) throw new Error("addLinesToCart: valid Shopify Cart GID required");

  const finalLines = normalizeCartLines({
    variantId,
    merchandiseId,
    quantity,
    lines,
    attributes,
  });

  if (!finalLines.length) {
    throw new Error(
      "addLinesToCart: no valid lines (missing/invalid ProductVariant IDs)."
    );
  }

  const out = await rpc("cart/addLines", { cartId: gid, lines: finalLines });
  return normalizeCartPayload(out, gid);
}

export async function updateCartLines({ cartId, lines } = {}) {
  const gid = extractCartGid(cartId);
  if (!gid) throw new Error("updateCartLines: valid Shopify Cart GID required");
  if (!Array.isArray(lines) || !lines.length) {
    throw new Error("updateCartLines: lines[] required");
  }

  const cleaned = lines
    .map((l) => ({
      id: l?.id || l?.lineId || null,
      quantity: Number(l?.quantity),
    }))
    .filter((l) => l.id && Number.isFinite(l.quantity) && l.quantity >= 0)
    .map((l) => ({ ...l, quantity: Math.floor(l.quantity) }));

  if (!cleaned.length) throw new Error("updateCartLines: no valid line updates");

  const out = await rpc("cart/updateLines", { cartId: gid, lines: cleaned });
  return normalizeCartPayload(out, gid);
}

export async function removeCartLines({ cartId, lineIds } = {}) {
  const gid = extractCartGid(cartId);
  if (!gid) throw new Error("removeCartLines: valid Shopify Cart GID required");

  const ids = Array.isArray(lineIds) ? lineIds.filter(Boolean).map(String) : [];
  if (!ids.length) throw new Error("removeCartLines: lineIds[] required");

  const out = await rpc("cart/removeLines", { cartId: gid, lineIds: ids });
  return normalizeCartPayload(out, gid);
}

// ─────────────────────────────────────────────────────────────
// Rewards
// ─────────────────────────────────────────────────────────────
export const getRewardBalance = async (shopperId) => {
  const raw = await retryableRequest(
    `/rewards/balance/${encodeURIComponent(shopperId)}`,
    { method: "GET" }
  );

  const data = unwrap(raw) || {};
  const rewards = data?.context?.rewards;

  if (rewards && typeof rewards.balance === "number") {
    if (data.balance == null) data.balance = rewards.balance;
    if (data.points == null) data.points = rewards.balance;
  }

  return data;
};

export const earnRewardPoints = async (payload) => {
  const raw = await retryableRequest("/rewards/earn", { method: "POST", body: payload });

  const data = unwrap(raw) || {};
  const rewards = data?.context?.rewards;

  if (rewards && typeof rewards.balance === "number") {
    if (data.balance == null) data.balance = rewards.balance;
    if (data.points == null) data.points = rewards.balance;
  }

  return data;
};

export const redeemRewardPoints = async (payload) => {
  const raw = await retryableRequest("/rewards/redeem", {
    method: "POST",
    body: payload,
  });

  const data = unwrap(raw) || {};
  const rewards = data?.context?.rewards;

  if (rewards && typeof rewards.balance === "number") {
    if (data.balance == null) data.balance = rewards.balance;
    if (data.points == null) data.points = rewards.balance;
  }

  return data;
};

// ─────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────
export const health = async () =>
  unwrap(await retryableRequest("/health", { method: "GET" }));

// ─────────────────────────────────────────────────────────────
// Snoozer Assistant
// ─────────────────────────────────────────────────────────────
function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function looksLikeHudResponse(x) {
  if (!isObject(x)) return false;
  return typeof x.speech === "string" || typeof x.captions === "string";
}

function derivePodId({ mode, podId, zone, context } = {}) {
  const m = String(mode || "").toLowerCase().trim();
  if (m !== "pod") return null;

  const direct =
    podId ??
    context?.podId ??
    context?.pod_id ??
    context?.zone?.podId ??
    context?.zone?.id ??
    null;

  if (direct != null) {
    const s = String(direct).trim();
    if (s) return s;
  }

  if (zone != null) {
    const z = String(zone).trim();
    if (/^\d+$/.test(z)) return z;
    const m2 = z.match(/(\d{1,3})/);
    if (m2 && m2[1]) return String(m2[1]);
  }

  return null;
}

async function askSnoozerInternal({
  message,
  thread_id,
  mode,
  shopperId,
  sessionId,
  zone,
  podId,
  context = {},
} = {}) {
  if (!message?.trim()) throw new Error("message required");

  let sid = sessionId || getSessionId();
  if (!sid) {
    sid = await ensureSession().catch(() => null);
  }

  const start = Date.now();
  console.log("🧠 [askSnoozer] →", message, "| mode:", mode);

  const ctx = context && typeof context === "object" ? { ...context } : {};

  const derivedPodId = derivePodId({ mode, podId, zone, context: ctx });
  if (derivedPodId) {
    if (!ctx.podId) ctx.podId = derivedPodId;
  }

  const body = {
    message,
    thread_id,
    mode,
    shopperId,
    sessionId: sid || sessionId || null,
    zone,
    ...(derivedPodId ? { podId: derivedPodId } : {}),
    context: ctx,
  };

  try {
    const raw = await retryableRequest("/ask-snoozer", { method: "POST", body });

    const top = unwrap(raw) || {};
    const contract = top?.response || top?.data?.response || top;

    const isHud = looksLikeHudResponse(contract);

    const replyText = isHud
      ? (String(contract?.speech || contract?.captions || "").trim() ||
          "No response from Snoozer.")
      : (
          contract?.reply ||
          contract?.text ||
          contract?.message?.text ||
          contract?.message?.content ||
          "No response from Snoozer."
        );

    const actions = Array.isArray(contract?.actions) ? contract.actions : [];
    const products = Array.isArray(contract?.products)
      ? contract.products
      : Array.isArray(contract?.data?.products)
      ? contract.data.products
      : [];

    const meta = contract?.meta || {};
    const model = contract?.model || contract?.message?.model || null;
    const tokens = contract?.tokens || contract?.message?.tokens || null;
    const s3Prompts = contract?.s3Prompts || contract?.s3_prompts || [];
    const traceId = contract?.traceId || top?.traceId || null;

    const status = isHud
      ? String(contract?.state || "").toLowerCase().trim() === "warning"
        ? "error"
        : "completed"
      : contract?.status || "completed";

    const mergedContext =
      contract?.context && typeof contract.context === "object"
        ? contract.context
        : ctx || null;

    const threadId = contract?.thread_id || thread_id || null;

    const cartMeta = extractCartMeta(contract);
    if (cartMeta.cartId || cartMeta.checkoutUrl) {
      persistCartIdentity(cartMeta.cartId, cartMeta.checkoutUrl);
    }

    console.log(
      "💬 [askSnoozer] ←",
      replyText,
      "| path:",
      meta.path,
      "| latency:",
      meta.latency_ms,
      "ms",
      isHud ? "| HUD:" : ""
    );

    return {
      ok: status !== "error",
      reply: replyText,
      text: replyText,

      ...(isHud
        ? {
            hud: {
              speech: contract?.speech ?? null,
              captions: contract?.captions ?? null,
              state: contract?.state ?? null,
              priority: contract?.priority ?? null,
              ttlMs: contract?.ttlMs ?? null,
            },
          }
        : {}),

      actions,
      products,
      thread_id: threadId,
      status,
      meta,
      model,
      tokens,
      s3Prompts,
      traceId,

      context: mergedContext,
      contextPatch: contract?.contextPatch || null,
      cartId: cartMeta.cartId || null,
      checkoutUrl: cartMeta.checkoutUrl || null,
      cart: contract?.cart || null,

      message: contract?.message || {},
      raw: contract,
      rawTop: top,
    };
  } catch (err) {
    console.error("❌ [askSnoozer] Failed:", err);
    return {
      ok: false,
      reply: "Snoozer hit a snag. Try again shortly.",
      text: "Snoozer hit a snag. Try again shortly.",
      actions: [],
      products: [],
      error: err?.message || String(err),
    };
  } finally {
    console.log(`🧩 askSnoozer runtime: ${Date.now() - start}ms`);
  }
}

/**
 * Public askSnoozer:
 * Supports BOTH call styles:
 * 1) askSnoozer("hi", { mode, context })
 * 2) askSnoozer({ message:"hi", mode, context })
 */
export async function askSnoozer(messageOrPayload, opts = {}) {
  if (messageOrPayload && typeof messageOrPayload === "object") {
    return askSnoozerInternal(messageOrPayload);
  }
  return askSnoozerInternal({ message: messageOrPayload, ...(opts || {}) });
}

// ─────────────────────────────────────────────────────────────
// Assessment (cached questions + snapshot results)
// ─────────────────────────────────────────────────────────────
export async function getAssessmentQuestions() {
  const etag = sessionStorage.getItem(CACHE_KEYS.assessETag) || "";

  try {
    const { data, res } = await request("/assessment-questions", {
      method: "GET",
      headers: etag ? { "If-None-Match": etag } : undefined,
    });

    const payload = unwrap(data);
    const normalized = Array.isArray(payload)
      ? { questions: payload }
      : payload?.questions
      ? payload
      : { questions: [] };

    const newETag = res.headers.get("etag");
    if (newETag) sessionStorage.setItem(CACHE_KEYS.assessETag, newETag);

    try {
      sessionStorage.setItem(CACHE_KEYS.assessBody, JSON.stringify(normalized));
    } catch {}

    return normalized;
  } catch (err) {
    if (err.status === 304) {
      try {
        const cached = sessionStorage.getItem(CACHE_KEYS.assessBody);
        if (cached) return JSON.parse(cached);
      } catch {}

      const { data } = await request("/assessment-questions", { method: "GET" });
      const payload = unwrap(data);

      const normalized = Array.isArray(payload)
        ? { questions: payload }
        : payload?.questions
        ? payload
        : { questions: [] };

      sessionStorage.setItem(CACHE_KEYS.assessBody, JSON.stringify(normalized));
      return normalized;
    }

    throw err;
  }
}

export const saveAssessment = (shopperId, answers, origin) =>
  (async () => {
    const raw = await retryableRequest("/assessment", {
      method: "POST",
      body: { shopperId, answers, origin },
    });
    return unwrap(raw);
  })();

export async function getAssessment(shopperId) {
  try {
    const { data } = await request(`/assessment/${encodeURIComponent(shopperId)}`, {
      method: "GET",
    });
    return unwrap(data);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────
// CRM: Lead + Contact Event Tracking
// ─────────────────────────────────────────────────────────────
export const trackCRMEvent = (payload) =>
  (async () =>
    unwrap(
      await retryableRequest("/crm/track-event", { method: "POST", body: payload })
    ))();

// ─────────────────────────────────────────────────────────────
// Recommendations + IoT
// ─────────────────────────────────────────────────────────────
export const getRecommendations = async (shopperId = "guest") => {
  const raw = await retryableRequest(
    `/recommendations/${encodeURIComponent(shopperId)}`,
    { method: "GET" }
  );
  return unwrap(raw);
};

export const resolveRecommendations = async (payload = {}) => {
  const raw = await retryableRequest("/recommendations/resolve", {
    method: "POST",
    body: payload,
  });
  return unwrap(raw);
};

export const triggerIotScene = (payload) =>
  (async () =>
    unwrap(
      await retryableRequest("/iot/trigger-scene", { method: "POST", body: payload })
    ))();

// ─────────────────────────────────────────────────────────────
// Namespace Export
// ─────────────────────────────────────────────────────────────
export const api = {
  // session
  ensureSession,
  getSessionId,

  // products
  getProducts,
  getProductsIndexByHandle,
  getProductById,

  // cart
  createCart,
  getCart,
  addLinesToCart,
  updateCartLines,
  removeCartLines,

  // rewards
  getRewardBalance,
  earnRewardPoints,
  redeemRewardPoints,

  // system
  health,

  // assistant
  askSnoozer,

  // voice
  synthesizeWelcomeVoice,

  // assessment
  getAssessmentQuestions,
  saveAssessment,
  getAssessment,

  // crm + integrations
  trackCRMEvent,
  getRecommendations,
  resolveRecommendations,
  triggerIotScene,
};

if (import.meta.env.DEV) {
  console.log("[api] base =", API_BASE, "| timeout =", DEFAULT_TIMEOUT, "ms");
}
