// services/shopify.js
// Storefront + Admin helpers with retry + lite/full normalizers + signed S3 previews.
// Used by recommendations.js and other service routes.
//
// Tightened for deterministic commerce:
// - Shopify env validation happens at call-time (not require-time) so Lambda can boot safely.
// - Batch handle fetches using GraphQL aliases (1 request instead of N).
// - Price normalization hardened (always numeric where possible).
// - Timeouts configurable via env.
// - Thread 8 hardening:
//   - Deterministic timeout behavior
//   - Stable structured errors for commerce truth layer
//   - No guessed variant/cart IDs
//   - Cart operations stay Shopify-truth only

const axios = require("axios");
const { getAssetPreview, slugify } = require("./assetLoader");

// ──────────────────────────────
// Config
// ──────────────────────────────
const SHOPIFY_DOMAIN = (process.env.SHOPIFY_DOMAIN || "").trim();
const SHOPIFY_STOREFRONT_TOKEN = (process.env.SHOPIFY_STOREFRONT_TOKEN || "").trim();
const SHOPIFY_ADMIN_TOKEN = (process.env.SHOPIFY_ADMIN_TOKEN || "").trim();
const SHOPIFY_API_VERSION = (process.env.SHOPIFY_API_VERSION || "2024-01").trim();

const SHOPIFY_CACHE_TTL_SEC = Number(process.env.SHOPIFY_CACHE_TTL_SEC || 90);
const SHOPIFY_LIST_CACHE_TTL_SEC = Number(
  process.env.SHOPIFY_LIST_CACHE_TTL_SEC || SHOPIFY_CACHE_TTL_SEC || 60
);
const SHOPIFY_PRODUCT_CACHE_TTL_SEC = Number(process.env.SHOPIFY_PRODUCT_CACHE_TTL_SEC || 600);

const SHOPIFY_MAX_PAGE_SIZE = Math.max(
  1,
  Math.min(Number(process.env.SHOPIFY_MAX_PAGE_SIZE || 50), 100)
);

const SHOPIFY_RETRY_MAX = Math.max(0, Number(process.env.SHOPIFY_RETRY_MAX || 1));
const SHOPIFY_LIST_LITE_DEFAULT = (process.env.SHOPIFY_LIST_LITE_DEFAULT || "0") === "1";

// Thread 8 explicit thresholds
const SHOPIFY_TIMEOUT_MS = Math.max(100, Number(process.env.SHOPIFY_TIMEOUT_MS || 800));
const STOREFRONT_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.SHOPIFY_STOREFRONT_TIMEOUT_MS || SHOPIFY_TIMEOUT_MS)
);
const ADMIN_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.SHOPIFY_ADMIN_TIMEOUT_MS || SHOPIFY_TIMEOUT_MS)
);

// Batch query limits (GraphQL query size safety)
const SHOPIFY_HANDLES_BATCH_SIZE = Math.max(
  1,
  Math.min(Number(process.env.SHOPIFY_HANDLES_BATCH_SIZE || 15), 40)
);

// ──────────────────────────────
// Runtime-required config (validated on use)
// ──────────────────────────────
function requireShopifyConfig() {
  const missing = [];
  if (!SHOPIFY_DOMAIN) missing.push("SHOPIFY_DOMAIN");
  if (!SHOPIFY_STOREFRONT_TOKEN) missing.push("SHOPIFY_STOREFRONT_TOKEN");

  if (missing.length) {
    const err = new Error(`Missing required Shopify config: ${missing.join(", ")}`);
    err.code = "SHOPIFY_CONFIG_MISSING";
    err.missing = missing;
    throw err;
  }

  return { domain: SHOPIFY_DOMAIN, sfToken: SHOPIFY_STOREFRONT_TOKEN };
}

function getStorefrontClient() {
  const { domain, sfToken } = requireShopifyConfig();

  if (getStorefrontClient._client) return getStorefrontClient._client;

  const storefront = axios.create({
    baseURL: `https://${domain}/api/${SHOPIFY_API_VERSION}/graphql.json`,
    headers: {
      "X-Shopify-Storefront-Access-Token": sfToken,
      "Content-Type": "application/json",
    },
    timeout: STOREFRONT_TIMEOUT_MS,
  });

  getStorefrontClient._client = storefront;
  return storefront;
}

function getAdminClientOptional() {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_ADMIN_TOKEN) return null;

  if (getAdminClientOptional._client) return getAdminClientOptional._client;

  const admin = axios.create({
    baseURL: `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}`,
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      "Content-Type": "application/json",
    },
    timeout: ADMIN_TIMEOUT_MS,
  });

  getAdminClientOptional._client = admin;
  return admin;
}

// ──────────────────────────────
// Retry + jitter
// ──────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms, spread = 250) =>
  Math.max(0, ms + Math.floor(Math.random() * spread - spread / 2));

function isTimeoutError(err) {
  const code = String(err?.code || "").toUpperCase();
  return code.includes("TIMEOUT") || /timeout/i.test(String(err?.message || ""));
}

function buildShopifyError(message, code, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

async function withRetry(fn, { label, max = SHOPIFY_RETRY_MAX } = {}) {
  let attempt = 0;
  let lastErr;

  while (attempt <= max) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      const retriable =
        status >= 500 ||
        status === 429 ||
        ["ETIMEDOUT", "ECONNRESET", "ECONNABORTED"].includes(e.code) ||
        isTimeoutError(e);

      if (!retriable || attempt === max) break;

      const backoff = jitter(200 + attempt * 250);
      console.log(
        JSON.stringify({
          source: "shopify",
          event: "retry",
          label,
          attempt,
          status,
          code: e.code,
          backoff,
        })
      );

      await sleep(backoff);
      attempt++;
    }
  }

  throw lastErr;
}

// ──────────────────────────────
// In-memory cache
// ──────────────────────────────
const cache = new Map();
const ck = (key) => `shopify:${SHOPIFY_DOMAIN}:${SHOPIFY_API_VERSION}:${key}`;

function setCache(key, value, ttlSec) {
  cache.set(ck(key), { value, exp: Date.now() + ttlSec * 1000 });
}

function getCache(key) {
  const hit = cache.get(ck(key));
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    cache.delete(ck(key));
    return null;
  }
  return hit.value;
}

// ──────────────────────────────
// Helpers
// ──────────────────────────────
function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function trim(text = "", max = 900) {
  const s = (text || "").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function normalizeQueryString(q = "") {
  return String(q || "").replace(/\s+/g, " ").trim();
}

function tokenizeQuery(q = "") {
  return normalizeQueryString(q)
    .toLowerCase()
    .replace(/[^\w\s-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

const first = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

function pickFirstAvailableVariantId(variantEdges = []) {
  const v =
    variantEdges.find((e) => e?.node?.availableForSale)?.node ||
    variantEdges[0]?.node ||
    null;
  return v?.id || null;
}

async function attachPreview(product) {
  try {
    if (!product || typeof product !== "object") return product;

    const name = product?.handle || product?.title || "";
    const slug = slugify(name);
    if (!slug) return product;

    const signed = await getAssetPreview(slug);
    if (signed?.url) {
      product.previewUrl = signed.url;

      if (!product.imageUrl) product.imageUrl = signed.url;
      if (product.image && !product.image.url) product.image.url = signed.url;
    }
  } catch {
    // silent
  }
  return product;
}

// ──────────────────────────────
// ID validation (variant/cart)
// ──────────────────────────────
function isDigits(s) {
  return typeof s === "string" && /^\d+$/.test(s);
}

function isValidVariantGid(id) {
  if (typeof id !== "string") return false;
  const s = id.trim();
  if (!s) return false;
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s)) return false;
  if (s.endsWith("/0")) return false;
  return true;
}

function toVariantGid(raw) {
  if (raw === undefined || raw === null) return null;

  const s = String(raw).trim();
  if (!s) return null;

  if (s.startsWith("gid://")) return isValidVariantGid(s) ? s : null;

  if (isDigits(s)) {
    if (s === "0") return null;
    return `gid://shopify/ProductVariant/${s}`;
  }

  return null;
}

function isValidCartGid(id) {
  if (typeof id !== "string") return false;
  const s = id.trim();
  if (!s) return false;
  return /^gid:\/\/shopify\/Cart\/[A-Za-z0-9+/=._-]+$/.test(s);
}

// ──────────────────────────────
// Normalizers
// ──────────────────────────────
function normalizeProduct(node) {
  if (!node) return null;

  const images = (node.images?.edges || [])
    .map((e) => ({
      id: e.node?.id || null,
      url: e.node?.url || e.node?.originalSrc || null,
      alt: e.node?.altText || "",
    }))
    .filter((i) => i.url);

  const variants = (node.variants?.edges || [])
    .map((e) => e?.node)
    .filter(Boolean)
    .map((v) => {
      const priceAmt = v.price?.amount ?? v.priceV2?.amount;
      const priceCur = v.price?.currencyCode ?? v.priceV2?.currencyCode;

      const compareAmt = v.compareAtPrice?.amount ?? v.compareAtPriceV2?.amount;
      const compareCur = v.compareAtPrice?.currencyCode ?? v.compareAtPriceV2?.currencyCode;

      return {
        id: v.id,
        title: v.title,
        sku: v.sku || null,
        price: toNumber(priceAmt),
        compareAtPrice: toNumber(compareAmt),
        currencyCode: priceCur || compareCur || null,
        available: Boolean(v.availableForSale),
        selectedOptions: (v.selectedOptions || []).map((o) => ({
          name: o.name,
          value: o.value,
        })),
        image: v.image
          ? {
              id: v.image.id || null,
              url: v.image.url || v.image.originalSrc || null,
              alt: v.image.altText || "",
            }
          : null,
      };
    });

  const variantEdges = node.variants?.edges || [];
  const firstAvailableVariantId = pickFirstAvailableVariantId(variantEdges);

  const min = toNumber(node.priceRange?.minVariantPrice?.amount);
  const max = toNumber(node.priceRange?.maxVariantPrice?.amount);
  const currencyCode =
    node.priceRange?.minVariantPrice?.currencyCode ||
    node.priceRange?.maxVariantPrice?.currencyCode ||
    variants.find((v) => v?.currencyCode)?.currencyCode ||
    "USD";

  const available = Boolean((node.variants?.edges || []).some((e) => e?.node?.availableForSale));
  const primaryImageUrl = images?.[0]?.url || null;

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    description: trim(node.description || ""),
    images,
    image: primaryImageUrl
      ? { id: images?.[0]?.id || null, url: primaryImageUrl, alt: images?.[0]?.alt || "" }
      : { id: null, url: null, alt: "" },
    imageUrl: primaryImageUrl,
    price: min,
    variantId: firstAvailableVariantId,
    merchandiseId: firstAvailableVariantId,
    firstAvailableVariantId,
    options: (node.options || []).map((o) => ({
      name: o.name,
      values: o.values || [],
    })),
    variants,
    priceRange: { min, max, currencyCode },
    available,
    tags: node.tags || [],
  };
}

function normalizeProductLite(node) {
  if (!node) return null;

  const min = toNumber(node.priceRange?.minVariantPrice?.amount);
  const max = toNumber(node.priceRange?.maxVariantPrice?.amount);
  const currencyCode =
    node.priceRange?.minVariantPrice?.currencyCode ||
    node.priceRange?.maxVariantPrice?.currencyCode ||
    "USD";

  const available = Boolean((node.variants?.edges || []).some((e) => e?.node?.availableForSale));

  const imgEdge = first(node.images?.edges || []);
  const image = imgEdge?.node
    ? {
        id: imgEdge.node.id || null,
        url: imgEdge.node.url || imgEdge.node.originalSrc || null,
        alt: imgEdge.node.altText || "",
      }
    : { id: null, url: null, alt: "" };

  const variantEdges = node.variants?.edges || [];
  const firstAvailableVariantId = pickFirstAvailableVariantId(variantEdges);

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    image,
    imageUrl: image?.url || null,
    priceRange: { min, max, currencyCode },
    price: min,
    available,
    tags: node.tags || [],
    firstAvailableVariantId,
    variantId: firstAvailableVariantId,
    merchandiseId: firstAvailableVariantId,
  };
}

// ──────────────────────────────
// GraphQL
// ──────────────────────────────
const PRODUCT_FIELDS = `
  id
  title
  handle
  description
  tags
  images(first: 10) { edges { node { id url altText } } }
  options { name values }
  variants(first: 50) {
    edges {
      node {
        id
        title
        sku
        availableForSale
        price: priceV2 { amount currencyCode }
        compareAtPrice: compareAtPriceV2 { amount currencyCode }
        selectedOptions { name value }
        image { id url altText }
      }
    }
  }
  priceRange {
    minVariantPrice { amount currencyCode }
    maxVariantPrice { amount currencyCode }
  }
`;

const PRODUCT_FIELDS_LITE = `
  id
  title
  handle
  tags
  images(first: 1) { edges { node { id url altText } } }
  variants(first: 10) {
    edges {
      node {
        id
        availableForSale
      }
    }
  }
  priceRange {
    minVariantPrice { amount currencyCode }
    maxVariantPrice { amount currencyCode }
  }
`;

const CART_FIELDS = `
  id
  checkoutUrl
  createdAt
  updatedAt
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount { amount currencyCode }
    totalTaxAmount { amount currencyCode }
  }
  lines(first: 50) {
    edges {
      node {
        id
        quantity
        attributes { key value }
        merchandise {
          ... on ProductVariant {
            id
            title
            sku
            availableForSale
            price: priceV2 { amount currencyCode }
            product { id title handle }
            image { id url altText }
          }
        }
      }
    }
  }
`;

function stringifyBrief(x, limit = 1500) {
  try {
    const s = typeof x === "string" ? x : JSON.stringify(x);
    return s.length > limit ? s.slice(0, limit) + "…" : s;
  } catch {
    return String(x || "").slice(0, limit);
  }
}

function extractShopifyGraphQLError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const top = err?.message || "Shopify error";

  if (!data) return `${top}${status ? ` (status ${status})` : ""}`;

  const errs = data?.errors || data?.error || null;
  if (errs) return `${top}${status ? ` (status ${status})` : ""}: ${stringifyBrief(errs)}`;

  return `${top}${status ? ` (status ${status})` : ""}: ${stringifyBrief(data)}`;
}

async function sfQuery(query, variables = {}, { label = "storefront.query" } = {}) {
  const storefront = getStorefrontClient();

  try {
    const run = () => storefront.post("", { query, variables });
    const res = await withRetry(run, { label });

    if (res.data?.errors && Array.isArray(res.data.errors) && res.data.errors.length) {
      throw buildShopifyError(stringifyBrief(res.data.errors), "SHOPIFY_GRAPHQL_ERRORS", {
        graphQLErrors: res.data.errors,
      });
    }

    return res.data?.data;
  } catch (e) {
    const detail = extractShopifyGraphQLError(e);
    console.error(
      JSON.stringify({
        source: "shopify",
        event: "storefront.graphql.error",
        label,
        detail,
        timeoutMs: STOREFRONT_TIMEOUT_MS,
      })
    );

    if (isTimeoutError(e)) {
      throw buildShopifyError(
        `${label} exceeded ${STOREFRONT_TIMEOUT_MS}ms`,
        "SHOPIFY_TIMEOUT",
        { timeoutMs: STOREFRONT_TIMEOUT_MS, label }
      );
    }

    throw buildShopifyError(detail, e?.code || "SHOPIFY_GRAPHQL_FAILED", {
      timeoutMs: STOREFRONT_TIMEOUT_MS,
      label,
      responseStatus: e?.response?.status || null,
      graphQLErrors: e?.graphQLErrors || null,
      userErrors: e?.userErrors || null,
    });
  }
}

function chunkArray(arr, size) {
  const out = [];
  const a = Array.isArray(arr) ? arr : [];
  for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
  return out;
}

function safeAlias(handle) {
  return `h_${String(handle || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 45)}`;
}

// ──────────────────────────────
// Public: fetch + cart + admin
// ──────────────────────────────
async function fetchProducts({
  collection = null,
  limit = 20,
  pageInfo = null,
  q = "",
  lite = SHOPIFY_LIST_LITE_DEFAULT,
} = {}) {
  const { domain } = requireShopifyConfig();

  const firstPage = Math.max(1, Math.min(Number(limit) || 20, SHOPIFY_MAX_PAGE_SIZE));
  const after = pageInfo || null;
  const queryString = normalizeQueryString(q || "");

  console.log(
    JSON.stringify({
      source: "shopify",
      event: "shopify.products.list.args",
      domain,
      apiVersion: SHOPIFY_API_VERSION,
      collection,
      first: firstPage,
      after,
      q: queryString,
      lite: !!lite,
      timeoutMs: STOREFRONT_TIMEOUT_MS,
    })
  );

  const key = `list:${collection || ""}:${firstPage}:${after || ""}:${queryString}:lite=${lite ? 1 : 0}`;
  const cached = getCache(key);

  if (cached) {
    console.log(
      JSON.stringify({
        source: "shopify",
        event: "shopify.products.list",
        cache: true,
        count: (cached.items || []).length,
        lite: !!lite,
      })
    );
    return { ...cached, meta: { ...(cached.meta || {}), fromCache: true } };
  }

  let data;
  const fields = lite ? PRODUCT_FIELDS_LITE : PRODUCT_FIELDS;

  if (collection) {
    const looksNumeric = /^\d+$/.test(collection);
    const looksGid = /^gid:\/\//i.test(collection);

    if (looksGid || looksNumeric) {
      const gid = looksGid ? collection : `gid://shopify/Collection/${collection}`;
      const QUERY = `
        query ($id: ID!, $first:Int!, $after:String, $q:String) {
          node(id: $id) {
            ... on Collection {
              id
              title
              products(first: $first, after: $after, query: $q) {
                pageInfo { hasNextPage hasPreviousPage }
                edges { cursor node { ${fields} } }
              }
            }
          }
        }
      `;
      const d = await sfQuery(
        QUERY,
        { id: gid, first: firstPage, after, q: queryString || null },
        { label: "sf.collectionById.products" }
      );
      data = d?.node?.products;
    } else {
      const QUERY = `
        query ($handle:String!, $first:Int!, $after:String, $q:String) {
          collectionByHandle(handle:$handle) {
            id
            title
            products(first:$first, after:$after, query:$q) {
              pageInfo { hasNextPage hasPreviousPage }
              edges { cursor node { ${fields} } }
            }
          }
        }
      `;
      const d = await sfQuery(
        QUERY,
        { handle: collection, first: firstPage, after, q: queryString || null },
        { label: "sf.collectionByHandle.products" }
      );
      data = d?.collectionByHandle?.products;
    }
  } else {
    const QUERY = `
      query ($first:Int!, $after:String, $q:String) {
        products(first:$first, after:$after, query:$q) {
          pageInfo { hasNextPage hasPreviousPage }
          edges { cursor node { ${fields} } }
        }
      }
    `;
    const d = await sfQuery(
      QUERY,
      { first: firstPage, after, q: queryString || null },
      { label: "sf.products" }
    );
    data = d?.products;
  }

  const edges = data?.edges || [];
  if (edges.length === 0) {
    const tokens = tokenizeQuery(queryString);
    console.log(
      JSON.stringify({
        source: "shopify",
        event: "shopify.products.list.empty",
        domain,
        apiVersion: SHOPIFY_API_VERSION,
        collection,
        q: queryString,
        qTokens: tokens,
        first: firstPage,
        after,
        lite: !!lite,
        note:
          "Storefront returned 0 edges. This can be a legitimate no-match search, or a channel/publication/collection mismatch. If empty happens for broad queries too, check product publication to the Storefront sales channel.",
      })
    );
  }

  const nodes = edges.map((e) => e.node).filter(Boolean);
  const normalize = lite ? normalizeProductLite : normalizeProduct;

  let items = nodes.map(normalize).filter(Boolean);
  items = await Promise.all(items.map(attachPreview));

  const next = data?.pageInfo?.hasNextPage ? edges[edges.length - 1]?.cursor || null : null;

  const result = {
    items,
    page_info: { next, prev: null },
    meta: {
      source: "storefront",
      apiVersion: SHOPIFY_API_VERSION,
      fromCache: false,
      lite: !!lite,
      q: queryString,
      timeoutMs: STOREFRONT_TIMEOUT_MS,
    },
  };

  setCache(key, result, SHOPIFY_LIST_CACHE_TTL_SEC);

  console.log(
    JSON.stringify({
      source: "shopify",
      event: "shopify.products.list",
      cache: false,
      count: items.length,
      lite: !!lite,
    })
  );

  return result;
}

async function fetchProduct({ idOrHandle }) {
  if (!idOrHandle) throw buildShopifyError("idOrHandle is required", "MISSING_ID_OR_HANDLE");
  requireShopifyConfig();

  const key = `one:${String(idOrHandle).trim()}`;
  const cached = getCache(key);

  if (cached) {
    console.log(JSON.stringify({ source: "shopify", event: "shopify.products.one", cache: true }));
    return {
      product: cached,
      meta: {
        source: "storefront",
        apiVersion: SHOPIFY_API_VERSION,
        fromCache: true,
        timeoutMs: STOREFRONT_TIMEOUT_MS,
      },
    };
  }

  const looksNumeric = /^\d+$/.test(idOrHandle);
  const looksGid = /^gid:\/\//i.test(idOrHandle);
  let node;

  if (looksNumeric || looksGid) {
    const gid = looksGid ? idOrHandle : `gid://shopify/Product/${idOrHandle}`;
    const QUERY = `
      query ($id: ID!) {
        node(id:$id) {
          ... on Product { ${PRODUCT_FIELDS} }
        }
      }
    `;
    const d = await sfQuery(QUERY, { id: gid }, { label: "sf.productById" });
    node = d?.node || null;
  } else {
    const QUERY = `
      query ($handle: String!) {
        productByHandle(handle:$handle) { ${PRODUCT_FIELDS} }
      }
    `;
    const d = await sfQuery(QUERY, { handle: idOrHandle }, { label: "sf.productByHandle" });
    node = d?.productByHandle || null;
  }

  let product = normalizeProduct(node);
  if (!product) {
    throw buildShopifyError("Product not found", "PRODUCT_NOT_FOUND");
  }

  product = await attachPreview(product);
  setCache(key, product, SHOPIFY_PRODUCT_CACHE_TTL_SEC);

  console.log(
    JSON.stringify({ source: "shopify", event: "shopify.products.one", cache: false, id: product.id })
  );

  return {
    product,
    meta: {
      source: "storefront",
      apiVersion: SHOPIFY_API_VERSION,
      fromCache: false,
      timeoutMs: STOREFRONT_TIMEOUT_MS,
    },
  };
}

// New: fetch products by an array of handles (batched via GraphQL aliases)
async function fetchProductsByHandles({ handles = [], lite = SHOPIFY_LIST_LITE_DEFAULT } = {}) {
  requireShopifyConfig();

  const list = Array.from(
    new Set((handles || []).map((h) => String(h || "").trim()).filter((h) => h.length > 0))
  );

  if (!list.length) {
    return {
      items: [],
      meta: {
        source: "storefront",
        apiVersion: SHOPIFY_API_VERSION,
        fromCache: false,
        lite: !!lite,
        timeoutMs: STOREFRONT_TIMEOUT_MS,
      },
    };
  }

  const sorted = [...list].sort();
  const key = `byHandles:${sorted.join(",")}:lite=${lite ? 1 : 0}`;
  const cached = getCache(key);

  if (cached) {
    console.log(
      JSON.stringify({
        source: "shopify",
        event: "shopify.products.byHandles",
        cache: true,
        count: (cached.items || []).length,
        lite: !!lite,
      })
    );
    return { ...cached, meta: { ...(cached.meta || {}), fromCache: true } };
  }

  const fields = lite ? PRODUCT_FIELDS_LITE : PRODUCT_FIELDS;
  const normalize = lite ? normalizeProductLite : normalizeProduct;

  const batches = chunkArray(sorted, SHOPIFY_HANDLES_BATCH_SIZE);
  const items = [];

  for (const batch of batches) {
    const parts = batch
      .map((h) => {
        const a = safeAlias(h);
        return `${a}: productByHandle(handle:${JSON.stringify(h)}) { ${fields} }`;
      })
      .join("\n");

    const QUERY = `query { ${parts} }`;

    try {
      const d = await sfQuery(QUERY, {}, { label: "sf.productByHandle.aliasBatch" });

      for (const handle of batch) {
        const a = safeAlias(handle);
        const node = d?.[a] || null;
        const normalized = normalize(node);
        if (normalized) items.push(await attachPreview(normalized));
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          source: "shopify",
          event: "shopify.products.byHandles.batch.error",
          count: batch.length,
          message: e?.message || String(e),
        })
      );

      for (const handle of batch) {
        try {
          const single = await fetchProduct({ idOrHandle: handle });
          if (single?.product) items.push(single.product);
        } catch (err) {
          console.error(
            JSON.stringify({
              source: "shopify",
              event: "shopify.products.byHandles.item.error",
              handle,
              message: err?.message || String(err),
            })
          );
        }
      }
    }
  }

  const result = {
    items,
    meta: {
      source: "storefront",
      apiVersion: SHOPIFY_API_VERSION,
      fromCache: false,
      lite: !!lite,
      timeoutMs: STOREFRONT_TIMEOUT_MS,
    },
  };

  setCache(key, result, SHOPIFY_PRODUCT_CACHE_TTL_SEC);

  console.log(
    JSON.stringify({
      source: "shopify",
      event: "shopify.products.byHandles",
      cache: false,
      count: items.length,
      lite: !!lite,
    })
  );

  return result;
}

// ──────────────────────────────
// Cart ops (create + get + add/update/remove lines)
// ──────────────────────────────
function normalizeCartAttributes(attrs) {
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

  if (!Array.isArray(attrs) || attrs.length === 0) return undefined;

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

function normalizeCartLinesInput(lines = []) {
  const safeLines = (Array.isArray(lines) ? lines : [])
    .map((l) => {
      if (!l || typeof l !== "object") return null;

      const rawId = l.merchandiseId || l.variantId || l.id || l.variant_id;
      const merchandiseId = toVariantGid(rawId);
      const quantity = Math.max(1, Math.floor(Number(l.quantity ?? 1) || 1));

      if (!merchandiseId) return null;

      const attributes = normalizeCartAttributes(l.attributes);
      return attributes ? { merchandiseId, quantity, attributes } : { merchandiseId, quantity };
    })
    .filter(Boolean);

  return safeLines;
}

async function createCart({ lines = [], note = null, buyerIdentity = null } = {}) {
  requireShopifyConfig();

  const safeLines = normalizeCartLinesInput(lines);
  if (safeLines.length === 0) {
    throw buildShopifyError(
      "At least one cart line is required, with a valid Shopify ProductVariant GID (not /0).",
      "NO_LINES"
    );
  }

  console.log(
    JSON.stringify({ source: "shopify", event: "cart.create.request", lineCount: safeLines.length })
  );

  const MUTATION = `
    mutation CartCreate($input: CartInput) {
      cartCreate(input: $input) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const input = {
    lines: safeLines,
    note: note || undefined,
    buyerIdentity: buyerIdentity || undefined,
  };

  const data = await sfQuery(MUTATION, { input }, { label: "sf.cartCreate" });
  const payload = data?.cartCreate;
  const userErrors = payload?.userErrors || [];

  if (!payload?.cart || userErrors.length) {
    console.error("❌ cartCreate userErrors:", userErrors);
    const msg = userErrors.map((e) => e.message).join("; ") || "Failed to create cart";
    throw buildShopifyError(msg, "CART_CREATE_FAILED", { userErrors });
  }

  return payload.cart;
}

async function getCart({ cartId } = {}) {
  requireShopifyConfig();

  if (!cartId || !isValidCartGid(String(cartId))) {
    throw buildShopifyError(
      "cartId is required and must be a valid Shopify Cart GID.",
      "INVALID_CART_ID"
    );
  }

  const QUERY = `query CartGet($id: ID!) { cart(id: $id) { ${CART_FIELDS} } }`;
  const data = await sfQuery(QUERY, { id: String(cartId) }, { label: "sf.cartGet" });

  if (!data?.cart) {
    throw buildShopifyError("Cart not found", "CART_NOT_FOUND");
  }

  return data.cart;
}

async function addCartLines({ cartId, lines = [] } = {}) {
  requireShopifyConfig();

  if (!cartId || !isValidCartGid(String(cartId))) {
    throw buildShopifyError(
      "cartId is required and must be a valid Shopify Cart GID.",
      "INVALID_CART_ID"
    );
  }

  const safeLines = normalizeCartLinesInput(lines);
  if (safeLines.length === 0) {
    throw buildShopifyError(
      "At least one line with a valid Shopify ProductVariant GID (not /0) is required.",
      "NO_LINES"
    );
  }

  const MUTATION = `
    mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await sfQuery(
    MUTATION,
    { cartId: String(cartId), lines: safeLines },
    { label: "sf.cartLinesAdd" }
  );

  const payload = data?.cartLinesAdd;
  const userErrors = payload?.userErrors || [];

  if (!payload?.cart || userErrors.length) {
    const msg = userErrors.map((e) => e.message).join("; ") || "Failed to add lines";
    throw buildShopifyError(msg, "CART_LINES_ADD_FAILED", { userErrors });
  }

  return payload.cart;
}

async function updateCartLines({ cartId, lines = [] } = {}) {
  requireShopifyConfig();

  if (!cartId || !isValidCartGid(String(cartId))) {
    throw buildShopifyError(
      "cartId is required and must be a valid Shopify Cart GID.",
      "INVALID_CART_ID"
    );
  }

  const safeUpdates = (Array.isArray(lines) ? lines : [])
    .map((l) => {
      if (!l || typeof l !== "object") return null;
      const lineId = l.id || l.lineId || null;
      const quantity = Number(l.quantity);
      if (!lineId || !Number.isFinite(quantity) || quantity < 0) return null;
      return { id: String(lineId), quantity: Math.floor(quantity) };
    })
    .filter(Boolean);

  if (!safeUpdates.length) {
    throw buildShopifyError(
      "At least one line update with {id, quantity} is required.",
      "NO_UPDATES"
    );
  }

  const MUTATION = `
    mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await sfQuery(
    MUTATION,
    { cartId: String(cartId), lines: safeUpdates },
    { label: "sf.cartLinesUpdate" }
  );

  const payload = data?.cartLinesUpdate;
  const userErrors = payload?.userErrors || [];

  if (!payload?.cart || userErrors.length) {
    const msg = userErrors.map((e) => e.message).join("; ") || "Failed to update lines";
    throw buildShopifyError(msg, "CART_LINES_UPDATE_FAILED", { userErrors });
  }

  return payload.cart;
}

async function removeCartLines({ cartId, lineIds = [] } = {}) {
  requireShopifyConfig();

  if (!cartId || !isValidCartGid(String(cartId))) {
    throw buildShopifyError(
      "cartId is required and must be a valid Shopify Cart GID.",
      "INVALID_CART_ID"
    );
  }

  const ids = Array.from(new Set((lineIds || []).map((x) => String(x || "").trim()).filter(Boolean)));

  if (!ids.length) {
    throw buildShopifyError(
      "At least one cart line id is required to remove.",
      "NO_LINE_IDS"
    );
  }

  const MUTATION = `
    mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await sfQuery(
    MUTATION,
    { cartId: String(cartId), lineIds: ids },
    { label: "sf.cartLinesRemove" }
  );

  const payload = data?.cartLinesRemove;
  const userErrors = payload?.userErrors || [];

  if (!payload?.cart || userErrors.length) {
    const msg = userErrors.map((e) => e.message).join("; ") || "Failed to remove lines";
    throw buildShopifyError(msg, "CART_LINES_REMOVE_FAILED", { userErrors });
  }

  return payload.cart;
}

// ──────────────────────────────
// Admin helpers (optional)
// ──────────────────────────────
function requireAdmin() {
  const admin = getAdminClientOptional();
  if (!admin) {
    throw buildShopifyError(
      "Shopify Admin client not configured (SHOPIFY_ADMIN_TOKEN or SHOPIFY_DOMAIN missing).",
      "ADMIN_NOT_CONFIGURED"
    );
  }
  return admin;
}

async function listPriceRules() {
  const a = requireAdmin();

  try {
    const res = await withRetry(() => a.get("/price_rules.json"), { label: "admin.listPriceRules" });
    return res?.data?.price_rules || [];
  } catch (e) {
    if (isTimeoutError(e)) {
      throw buildShopifyError(
        `admin.listPriceRules exceeded ${ADMIN_TIMEOUT_MS}ms`,
        "SHOPIFY_TIMEOUT",
        { timeoutMs: ADMIN_TIMEOUT_MS, label: "admin.listPriceRules" }
      );
    }
    throw buildShopifyError(
      extractShopifyGraphQLError(e),
      e?.code || "ADMIN_PRICE_RULES_FAILED",
      { timeoutMs: ADMIN_TIMEOUT_MS }
    );
  }
}

async function createDiscountCode({ code, priceRuleId }) {
  const a = requireAdmin();
  if (!priceRuleId) {
    throw buildShopifyError("priceRuleId is required", "MISSING_PRICE_RULE_ID");
  }

  try {
    const res = await withRetry(
      () =>
        a.post(`/price_rules/${priceRuleId}/discount_codes.json`, {
          discount_code: { code },
        }),
      { label: "admin.createDiscountCode" }
    );

    return res?.data?.discount_code;
  } catch (e) {
    if (isTimeoutError(e)) {
      throw buildShopifyError(
        `admin.createDiscountCode exceeded ${ADMIN_TIMEOUT_MS}ms`,
        "SHOPIFY_TIMEOUT",
        { timeoutMs: ADMIN_TIMEOUT_MS, label: "admin.createDiscountCode" }
      );
    }
    throw buildShopifyError(
      extractShopifyGraphQLError(e),
      e?.code || "ADMIN_DISCOUNT_CREATE_FAILED",
      { timeoutMs: ADMIN_TIMEOUT_MS }
    );
  }
}

module.exports = {
  fetchProducts,
  fetchProduct,
  fetchProductsByHandles,

  // cart
  createCart,
  getCart,
  addCartLines,
  updateCartLines,
  removeCartLines,

  // admin
  listPriceRules,
  createDiscountCode,
};