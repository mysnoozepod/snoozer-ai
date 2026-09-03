// src/lib/useStore.js
import { create } from "zustand";
import { api } from "@/lib/api";
import { getSessionState } from "@/state/sessionStore";
import { emitDeviceCartMutation } from "@/device/deviceActivityTracker";
import {
  clearStoredShopifyCartIdentity,
  extractShopifyCartGid,
  getStoredShopifyCartIdentity,
  persistShopifyCartIdentity,
} from "@/lib/session/shopifyCartState";
import {
  cartItemIdentity,
  cartItemsToMutationLines,
  cartLinesEqual,
  normalizeCartAttributes,
  normalizeMutationLine,
  serverCartToMutationLines,
} from "@/lib/cart/cartContract.mjs";

const STORAGE_KEYS = {
  activeTab: "snooze.activeTab",
  exploreFilters: "snooze.exploreFilters",
  exploreItems: "snooze.exploreItems",

  cart: "snooze.cart",
  cartId: "snooze.shopify.cartId",
  checkoutUrl: "snooze.shopify.checkoutUrl",

  snoozepod: "snooze.snoozepod",
  snoozepodMeta: "snooze.snoozepod.meta",

  progress: "snooze.progress",
  xp: "snooze.xp",

  assessment: "snooze.assessment",
  assessmentSummary: "snooze.assessmentSummary",
  recommendations: "snooze.recommendations",
  recommendedProducts: "snooze.recommendedProducts",
  recommendedProductHandles: "snooze.recommendedProductHandles",
};

function load(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;

    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function saveText(key, value) {
  try {
    sessionStorage.setItem(key, String(value || ""));
  } catch {
    // ignore
  }
}

function track(event, props = {}) {
  try {
    console.log("📊", event, props);
    window.analytics?.track?.(event, props);
  } catch {
    // no-op
  }
}

const DEFAULT_PROGRESS = {
  checkIn: false,
  assessment: false,
  explore: false,
  checkout: false,
};

const XP_VALUES = {
  checkIn: 100,
  assessment: 500,
  explore: 200,
  checkout: 300,
};

function toVariantGid(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  if (s.startsWith("gid://")) {
    return /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s) ? s : null;
  }

  if (/^\d+$/.test(s) && s !== "0") {
    return `gid://shopify/ProductVariant/${s}`;
  }

  return null;
}

function extractCartGid(v) {
  return extractShopifyCartGid(v) || null;
}

function markCartMutation(active, operation) {
  emitDeviceCartMutation(Boolean(active), {
    reason: "cartMutation",
    operation,
  });
}

let cartMutationTail = Promise.resolve();

function customerSafeCartError(operation) {
  const messages = {
    cart_line_update: "We couldn't update that quantity. Your cart was refreshed so you can try again.",
    cart_line_remove: "We couldn't remove that item. Your cart was refreshed so you can try again.",
    cart_clear: "We couldn't clear your cart. Your current cart is still available so you can try again.",
    checkout_prepare: "Checkout is temporarily unavailable. Your cart is still saved.",
  };
  return messages[operation] || "We couldn't update your cart. Please try again.";
}

function serializeCartMutation(set, operation, task) {
  const run = cartMutationTail.catch(() => {}).then(async () => {
    markCartMutation(true, operation);
    set({ cartMutationPending: true, cartMutationOperation: operation, cartError: null });
    try {
      return await task();
    } catch (error) {
      set({ cartError: customerSafeCartError(operation) });
      throw error;
    } finally {
      markCartMutation(false, operation);
      set({ cartMutationPending: false, cartMutationOperation: null });
    }
  });
  cartMutationTail = run.catch(() => {});
  return run;
}

function getStoredCartGid() {
  return getStoredShopifyCartIdentity().cartId || null;
}

function persistCartMeta({ cartId, checkoutUrl } = {}) {
  const persisted = persistShopifyCartIdentity({ cartId, checkoutUrl });

  return {
    cartId: persisted.cartId || null,
    checkoutUrl: persisted.checkoutUrl || null,
  };
}

function toNumberMoney(x) {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  const n = Number(String(x ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeCartItem(item) {
  if (!item || typeof item !== "object") return null;

  const rawId =
    item.merchandiseId ||
    item.variantId ||
    item.variant_id ||
    item.firstAvailableVariantId ||
    item.id ||
    null;

  const merchandiseId = toVariantGid(rawId);
  if (!merchandiseId) return null;

  const qtyRaw = item.quantity ?? item.qty ?? item.count ?? 1;
  const quantity =
    typeof qtyRaw === "number" && Number.isFinite(qtyRaw) && qtyRaw > 0
      ? Math.floor(qtyRaw)
      : Math.floor(Number(qtyRaw) || 1);

  const title = item.title || "Untitled";

  const imageUrl =
    item.imageUrl ||
    item.image ||
    item.previewUrl ||
    item.images?.[0]?.url ||
    "/no-image.svg";

  const unitPrice = toNumberMoney(
    item.unitPrice ?? item.price ?? item.priceNumber ?? 0
  );

  const lineId = String(item.lineId || "").startsWith("gid://shopify/CartLine/")
    ? String(item.lineId)
    : String(item.id || "").startsWith("gid://shopify/CartLine/")
      ? String(item.id)
      : null;
  const attributes = normalizeCartAttributes(item.attributes);
  const identity = cartItemIdentity({ lineId, merchandiseId, attributes }) || merchandiseId;

  return {
    id: String(identity),
    lineId,
    merchandiseId: String(merchandiseId),
    title,
    imageUrl,
    unitPrice,
    quantity: quantity > 0 ? quantity : 1,
    handle: item.handle || null,
    attributes: attributes.length ? attributes : undefined,
  };
}

function mergeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const merged = new Map();

  for (const raw of rawItems) {
    const item = normalizeCartItem(raw);
    if (!item) continue;

    const identity = cartItemIdentity(item) || item.id;
    const existing = merged.get(identity);
    if (existing) {
      merged.set(identity, {
        ...existing,
        quantity: (existing.quantity || 1) + (item.quantity || 1),
      });
    } else {
      merged.set(identity, item);
    }
  }

  return Array.from(merged.values());
}

const DEFAULT_SNOOZEPOD_META = {
  couponCode: "",
  rewardsPointsApplied: 0,
};

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

function extractCartObject(payload) {
  const root = payload && typeof payload === "object" ? payload : null;
  if (!root) return null;

  return (
    root?.cart ||
    root?.data?.cart ||
    root?.cartCreate?.cart ||
    root?.cartLinesAdd?.cart ||
    root?.cartLinesUpdate?.cart ||
    root?.cartLinesRemove?.cart ||
    root?.result?.cart ||
    (root?.id && root?.lines ? root : null) ||
    null
  );
}

function flattenCartLines(lines) {
  if (Array.isArray(lines?.edges)) {
    return lines.edges.map((edge) => edge?.node || edge).filter(Boolean);
  }
  if (Array.isArray(lines?.nodes)) return lines.nodes.filter(Boolean);
  if (Array.isArray(lines)) return lines.map((line) => line?.node || line).filter(Boolean);
  return [];
}

function lineImageUrl(line, merchandise) {
  return (
    merchandise?.image?.url ||
    merchandise?.image?.src ||
    merchandise?.product?.featuredImage?.url ||
    merchandise?.product?.featuredImage?.src ||
    line?.imageUrl ||
    line?.image ||
    "/no-image.svg"
  );
}

function lineUnitPrice(line, quantity) {
  const amount =
    line?.cost?.amountPerQuantity?.amount ??
    line?.merchandise?.price?.amount ??
    line?.merchandise?.priceV2?.amount ??
    line?.unitPrice ??
    line?.price ??
    null;

  if (amount != null) return toNumberMoney(amount);

  const total = toNumberMoney(line?.cost?.totalAmount?.amount);
  return total && quantity ? total / quantity : 0;
}

function shopifyCartToItems(cart) {
  const lines = flattenCartLines(cart?.lines);

  return lines
    .map((line) => {
      const merchandise = line?.merchandise || {};
      const merchandiseId = toVariantGid(
        merchandise?.id || line?.merchandiseId || line?.variantId
      );
      if (!merchandiseId) return null;

      const quantity = Math.max(1, Math.floor(Number(line?.quantity) || 1));
      const variantTitle = String(merchandise?.title || "").trim();
      const productTitle = String(
        merchandise?.product?.title || line?.title || "Item"
      ).trim();
      const title =
        variantTitle && !/^default title$/i.test(variantTitle)
          ? `${productTitle} - ${variantTitle}`
          : productTitle;

      return {
        id: line?.id || merchandiseId,
        lineId: line?.id || null,
        merchandiseId,
        title,
        imageUrl: lineImageUrl(line, merchandise),
        unitPrice: lineUnitPrice(line, quantity),
        quantity,
        handle: merchandise?.product?.handle || line?.handle || null,
        attributes: normalizeCartAttributes(line?.attributes),
      };
    })
    .filter(Boolean);
}

function cartTotalQuantity(cart, items = []) {
  const direct = Number(cart?.totalQuantity);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

function cartLineCount(cart, items = []) {
  const lines = flattenCartLines(cart?.lines);
  return lines.length || items.length;
}

function logCartOperation({
  operation,
  cartId,
  sourcePage = "unknown",
  requestedLineCount = 0,
  cart = null,
  ok = true,
  startedAt = Date.now(),
  error = null,
} = {}) {
  const items = cart ? shopifyCartToItems(cart) : [];
  const payload = {
    operation,
    cartId: extractCartGid(cartId || cart?.id) || null,
    sourcePage,
    requestedLineCount,
    returnedLineCount: cart ? cartLineCount(cart, items) : 0,
    returnedTotalQuantity: cart ? cartTotalQuantity(cart, items) : 0,
    success: !!ok,
    duration: Date.now() - startedAt,
    errorCode: error?.code || error?.name || error?.status || null,
  };

  try {
    const logger = ok ? console.info : console.warn;
    logger("[cart]", payload);
  } catch {
    // ignore
  }
}

function findCartItemByAnyId(items, id) {
  const key = String(id || "");
  if (!key) return null;
  return (Array.isArray(items) ? items : []).find(
    (item) =>
      String(item?.lineId || "") === key ||
      String(item?.id || "") === key ||
      String(item?.merchandiseId || "") === key ||
      String(item?.variantId || "") === key
  );
}

function shouldAutoSyncShopifyCart() {
  try {
    const v = import.meta?.env?.VITE_CART_SYNC;
    if (v === "0" || v === "false") return false;
    return true;
  } catch {
    return true;
  }
}

const initialCartIdentity = getStoredShopifyCartIdentity();
const initialCartId = extractCartGid(initialCartIdentity.cartId);
const initialCheckoutUrl = initialCartIdentity.checkoutUrl || null;

if (initialCartId) {
  persistCartMeta({ cartId: initialCartId, checkoutUrl: initialCheckoutUrl });
}

export const useStore = create((set, get) => ({
  activeTab: load(STORAGE_KEYS.activeTab, "Explore"),
  filters: load(STORAGE_KEYS.exploreFilters, {}),
  exploreItems: load(STORAGE_KEYS.exploreItems, []),

  cart: mergeItems(load(STORAGE_KEYS.cart, [])),
  cartId: initialCartId || null,
  checkoutUrl: initialCheckoutUrl || null,
  cartOwnerShopperId: null,
  cartMutationPending: false,
  cartMutationOperation: null,
  cartError: null,

  snoozepod: mergeItems(load(STORAGE_KEYS.snoozepod, [])),
  snoozepodMeta: (() => {
    const m = load(STORAGE_KEYS.snoozepodMeta, DEFAULT_SNOOZEPOD_META);
    if (!m || typeof m !== "object") return { ...DEFAULT_SNOOZEPOD_META };
    return {
      couponCode: String(m.couponCode || ""),
      rewardsPointsApplied: Math.max(
        0,
        Math.floor(Number(m.rewardsPointsApplied) || 0)
      ),
    };
  })(),

  assessment: load(STORAGE_KEYS.assessment, null),
  assessmentSummary: load(STORAGE_KEYS.assessmentSummary, ""),
  recommendations: load(STORAGE_KEYS.recommendations, null),
  recommendedProducts: load(STORAGE_KEYS.recommendedProducts, []),
  recommendedProductHandles: load(STORAGE_KEYS.recommendedProductHandles, []),

  badges: {
    Explore: false,
    Compare: false,
    Financing: false,
    FAQs: false,
    Cart: false,
  },

  progress: load(STORAGE_KEYS.progress, DEFAULT_PROGRESS),
  xp: load(STORAGE_KEYS.xp, 0),

  resetShopperScopedState: () => {
    set({
      filters: {},
      exploreItems: [],
      cart: [],
      cartOwnerShopperId: null,
      snoozepod: [],
      snoozepodMeta: { ...DEFAULT_SNOOZEPOD_META },
      assessment: null,
      assessmentSummary: "",
      recommendations: null,
      recommendedProducts: [],
      recommendedProductHandles: [],
      progress: { ...DEFAULT_PROGRESS },
      xp: 0,
      badges: {
        Explore: false,
        Compare: false,
        Financing: false,
        FAQs: false,
        Cart: false,
      },
    });
  },

  setTab: (tab) => {
    set((state) => ({
      activeTab: tab,
      badges: { ...state.badges, [tab]: false },
    }));
    saveJSON(STORAGE_KEYS.activeTab, tab);
    track("snoozer_tab_view", { tab });
  },

  setFilters: (f) => {
    const next = { ...get().filters, ...f };
    set((state) => ({
      filters: next,
      badges: { ...state.badges, Explore: true },
    }));
    saveJSON(STORAGE_KEYS.exploreFilters, next);
    track("snoozer_set_filters", { filters: next });
    track("snoozer_tab_badge_set", { tab: "Explore" });
  },

  setExploreItems: (items) => {
    const list = Array.isArray(items) ? items : [];
    set((state) => ({
      exploreItems: list,
      badges: { ...state.badges, Explore: true },
    }));
    saveJSON(STORAGE_KEYS.exploreItems, list);
    track("snoozer_show_products", { count: list.length });
    track("snoozer_tab_badge_set", { tab: "Explore" });
  },

  setCartMeta: ({ cartId, checkoutUrl } = {}) => {
    const persisted = persistCartMeta({ cartId, checkoutUrl });
    const nextCartId = persisted.cartId;
    const nextCheckoutUrl =
      persisted.checkoutUrl ||
      (checkoutUrl ? String(checkoutUrl) : null);

    set((state) => ({
      cartId: nextCartId || state.cartId || null,
      checkoutUrl: nextCheckoutUrl || state.checkoutUrl || null,
    }));

    if (!nextCartId && cartId) {
      track("snoozer_cart_meta_rejected", {
        reason: "invalid_cart_gid",
        rawCartId: String(cartId),
      });
    }

    track("snoozer_cart_meta_set", {
      hasCartId: !!(nextCartId || get().cartId),
      hasCheckoutUrl: !!(nextCheckoutUrl || get().checkoutUrl),
    });
  },

  clearCartMeta: () => {
    set({ cartId: null, checkoutUrl: null });
    clearStoredShopifyCartIdentity();
    track("snoozer_cart_meta_clear");
  },

  applyAuthoritativeCartPayload: (
    payload,
    {
      fallbackCartId = null,
      sourcePage = "unknown",
      operation = "cart_apply",
      requestedLineCount = 0,
      startedAt = Date.now(),
    } = {}
  ) => {
    const cart = extractCartObject(payload);
    const meta = extractCartMeta(payload);
    const cartId = meta.cartId || extractCartGid(fallbackCartId) || extractCartGid(cart?.id);
    const checkoutUrl = meta.checkoutUrl || cart?.checkoutUrl || null;
    const items = cart ? shopifyCartToItems(cart) : get().cart || [];

    if (cartId || checkoutUrl) {
      get().setCartMeta({ cartId, checkoutUrl });
    }

    set((state) => ({
      cart: items,
      badges: { ...state.badges, Cart: cartTotalQuantity(cart, items) > 0 },
    }));
    saveJSON(STORAGE_KEYS.cart, items);

    logCartOperation({
      operation,
      cartId,
      sourcePage,
      requestedLineCount,
      cart,
      ok: true,
      startedAt,
    });

    return {
      ok: true,
      cart,
      cartId: cartId || null,
      checkoutUrl: checkoutUrl ? String(checkoutUrl) : null,
      items,
      totalQuantity: cartTotalQuantity(cart, items),
    };
  },

  syncCartFromShopify: async ({ sourcePage = "unknown" } = {}) => {
    const startedAt = Date.now();
    const state = get();
    const shopperId = String(getSessionState()?.shopperId || "").trim();
    const cartId = extractCartGid(state.cartId) || getStoredCartGid();

    if (shopperId && state.cartOwnerShopperId !== shopperId) {
      set((s) => ({ cart: [], cartOwnerShopperId: shopperId, badges: { ...s.badges, Cart: false } }));
      saveJSON(STORAGE_KEYS.cart, []);
    }

    if (!shopperId && !cartId) {
      if ((state.cart || []).length) {
        set((s) => ({ cart: [], badges: { ...s.badges, Cart: false } }));
        saveJSON(STORAGE_KEYS.cart, []);
      }
      logCartOperation({
        operation: "cart_restore_skipped",
        sourcePage,
        ok: true,
        startedAt,
      });
      return { ok: false, skipped: true, reason: "NO_CART_ID" };
    }

    markCartMutation(true, "syncCartFromShopify");
    try {
      const response = shopperId
        ? await api.resolveShopperCart()
        : await api.getCart(cartId);
      if (shopperId && !response?.cart) {
        set((s) => ({ cart: [], cartOwnerShopperId: shopperId, badges: { ...s.badges, Cart: false } }));
        saveJSON(STORAGE_KEYS.cart, []);
        get().clearCartMeta();
        return { ok: true, cart: null, items: [], reason: response?.reason || "NO_OWNED_CART" };
      }
      return get().applyAuthoritativeCartPayload(response, {
        fallbackCartId: cartId,
        sourcePage,
        operation: "cart_fetch",
        startedAt,
      });
    } catch (err) {
      logCartOperation({
        operation: "cart_fetch",
        cartId,
        sourcePage,
        ok: false,
        startedAt,
        error: err,
      });
      // Shopify remains authoritative, but a transient fetch must not erase a
      // same-shopper recovery cache. Shopper changes are cleared before fetch.
      throw err;
    } finally {
      markCartMutation(false, "syncCartFromShopify");
    }
  },

  addLinesToAuthoritativeCart: async ({
    lines = [],
    sourcePage = "unknown",
  } = {}) => serializeCartMutation(set, "cart_line_add", async () => {
    if (!shouldAutoSyncShopifyCart()) {
      throw new Error("Shopify cart sync is disabled.");
    }

    const finalLines = (Array.isArray(lines) ? lines : [])
      .map(normalizeMutationLine)
      .filter(Boolean);

    if (!finalLines.length) {
      throw new Error("No valid Shopify merchandise lines were provided.");
    }

    const startedAt = Date.now();
    const state = get();
    const existingCartId = extractCartGid(state.cartId) || getStoredCartGid();
    const operation = existingCartId ? "cart_line_add" : "cart_create";

    try {
      try {
        if (api?.ensureSession) await api.ensureSession();
      } catch {
        // session best-effort only; cart mutation still owns success/failure
      }

      const shopperId = String(getSessionState()?.shopperId || "").trim();
      const response = shopperId
        ? await api.addLinesToShopperCart({ lines: finalLines })
        : existingCartId
          ? await api.addLinesToCart({ cartId: existingCartId, lines: finalLines })
          : await api.createCart({ lines: finalLines });

      let applied = get().applyAuthoritativeCartPayload(response, {
        fallbackCartId: existingCartId,
        sourcePage,
        operation,
        requestedLineCount: finalLines.length,
        startedAt,
      });

      if (applied.cartId && !extractCartObject(response)) {
        const fresh = await api.getCart(applied.cartId);
        applied = get().applyAuthoritativeCartPayload(fresh, {
          fallbackCartId: applied.cartId,
          sourcePage,
          operation: "cart_fetch_after_mutation",
          requestedLineCount: finalLines.length,
          startedAt,
        });
      }

      track("snoozer_tab_badge_set", { tab: "Cart" });
      return applied;
    } catch (err) {
      logCartOperation({
        operation,
        cartId: existingCartId,
        sourcePage,
        requestedLineCount: finalLines.length,
        ok: false,
        startedAt,
        error: err,
      });
      track("snoozer_shopify_cart_sync_error", {
        operation,
        message: err?.message || String(err),
      });
      throw err;
    }
  }),

  syncShopifyCartAdd: async (normalizedItem) => {
    if (!normalizedItem?.merchandiseId) return null;
    return get().addLinesToAuthoritativeCart({
      lines: [normalizedItem],
      sourcePage: "legacy-add-to-cart",
    });
  },

  applySnoozerCartMeta: ({ cartId, checkoutUrl } = {}) => {
    if (!cartId && !checkoutUrl) return;
    get().setCartMeta({ cartId, checkoutUrl });
    track("snoozer_cart_meta_from_assistant", {
      hasCartId: !!extractCartGid(cartId),
      hasCheckoutUrl: !!checkoutUrl,
    });
  },

  addToCart: async (item) => {
    const normalized = normalizeCartItem(item);

    if (!normalized) {
      track("snoozer_action", {
        type: "cart_add_invalid",
        reason: "missing_or_invalid_variant_gid",
        raw: {
          id: item?.id,
          variantId: item?.variantId,
          merchandiseId: item?.merchandiseId,
        },
      });
      return false;
    }

    try {
      await get().addLinesToAuthoritativeCart({
        lines: [normalized],
        sourcePage: "legacy-add-to-cart",
      });
      track("snoozer_action", {
        type: "cart_add",
        id: normalized.id,
        merchandiseId: normalized.merchandiseId,
        quantity: normalized.quantity,
      });
      return true;
    } catch (err) {
      track("snoozer_action", {
        type: "cart_add_failed",
        id: normalized.id,
        merchandiseId: normalized.merchandiseId,
        errorCode: err?.code || err?.name || err?.status || "CART_ADD_FAILED",
      });
      return false;
    }
  },

  updateCart: async (id, quantity) => serializeCartMutation(set, "cart_line_update", async () => {
    const key = String(id || "");
    const q = Math.max(1, Math.floor(Number(quantity) || 1));
    if (!key) {
      throw Object.assign(new Error("A valid cart line is required."), { code: "MISSING_CART_LINE_ID" });
    }

    const state = get();
    const item = findCartItemByAnyId(state.cart, key);
    const cartId = extractCartGid(state.cartId) || getStoredCartGid();
    const lineId = item?.lineId || item?.id || null;

    if (!cartId || !lineId) {
      logCartOperation({
        operation: "cart_line_update",
        cartId,
        sourcePage: "cart-page",
        ok: false,
        error: { code: "MISSING_CART_LINE_ID" },
      });
      throw Object.assign(new Error("A valid Shopify cart line is required."), {
        code: "MISSING_CART_LINE_ID",
      });
    }

    const startedAt = Date.now();
    try {
      const shopperId = String(getSessionState()?.shopperId || "").trim();
      const response = shopperId
        ? await api.updateShopperCartLines({ lines: [{ id: lineId, quantity: q }] })
        : await api.updateCartLines({ cartId, lines: [{ id: lineId, quantity: q }] });
      get().applyAuthoritativeCartPayload(response, {
        fallbackCartId: cartId,
        sourcePage: "cart-page",
        operation: "cart_line_update",
        requestedLineCount: 1,
        startedAt,
      });
      track("snoozer_action", { type: "cart_update", id: key, quantity: q });
    } catch (err) {
      logCartOperation({
        operation: "cart_line_update",
        cartId,
        sourcePage: "cart-page",
        requestedLineCount: 1,
        ok: false,
        startedAt,
        error: err,
      });
      try {
        await get().syncCartFromShopify({ sourcePage: "cart-update-recovery" });
      } catch {
        // Preserve the original mutation failure; the cached cart remains visible.
      }
      throw err;
    }
  }),

  removeFromCart: async (id) => serializeCartMutation(set, "cart_line_remove", async () => {
    const key = String(id || "");
    if (!key) {
      throw Object.assign(new Error("A valid cart line is required."), { code: "MISSING_CART_LINE_ID" });
    }

    const state = get();
    const item = findCartItemByAnyId(state.cart, key);
    const cartId = extractCartGid(state.cartId) || getStoredCartGid();
    const lineId = item?.lineId || item?.id || null;

    if (!cartId || !lineId) {
      logCartOperation({
        operation: "cart_line_remove",
        cartId,
        sourcePage: "cart-page",
        ok: false,
        error: { code: "MISSING_CART_LINE_ID" },
      });
      throw Object.assign(new Error("A valid Shopify cart line is required."), {
        code: "MISSING_CART_LINE_ID",
      });
    }

    const startedAt = Date.now();
    try {
      const shopperId = String(getSessionState()?.shopperId || "").trim();
      const response = shopperId
        ? await api.removeShopperCartLines({ lineIds: [lineId] })
        : await api.removeCartLines({ cartId, lineIds: [lineId] });
      get().applyAuthoritativeCartPayload(response, {
        fallbackCartId: cartId,
        sourcePage: "cart-page",
        operation: "cart_line_remove",
        requestedLineCount: 1,
        startedAt,
      });
      track("snoozer_action", { type: "cart_remove", id: key });
    } catch (err) {
      logCartOperation({
        operation: "cart_line_remove",
        cartId,
        sourcePage: "cart-page",
        requestedLineCount: 1,
        ok: false,
        startedAt,
        error: err,
      });
      try {
        await get().syncCartFromShopify({ sourcePage: "cart-remove-recovery" });
      } catch {
        // Preserve the original mutation failure; the cached cart remains visible.
      }
      throw err;
    }
  }),

  clearCart: async () => serializeCartMutation(set, "cart_clear", async () => {
    const state = get();
    const shopperId = String(getSessionState()?.shopperId || "").trim();
    const cartId = extractCartGid(state.cartId) || getStoredCartGid();
    if (!cartId && !shopperId) return { ok: true, skipped: true, reason: "CART_ALREADY_EMPTY" };

    const startedAt = Date.now();
    try {
      const response = shopperId
        ? await api.clearShopperCart()
        : await api.clearCart({ cartId });
      const confirmedEmptyWithoutCart =
        response?.cleared === true && !extractCartObject(response);
      if (confirmedEmptyWithoutCart) {
        set((current) => ({
          cart: [],
          cartId: null,
          checkoutUrl: null,
          badges: { ...current.badges, Cart: false },
        }));
        saveJSON(STORAGE_KEYS.cart, []);
        clearStoredShopifyCartIdentity();
      }
      const applied = get().applyAuthoritativeCartPayload(response, {
        fallbackCartId: cartId,
        sourcePage: "cart-page",
        operation: "cart_clear",
        startedAt,
      });
      if (applied.totalQuantity !== 0 || applied.items.length !== 0) {
        throw Object.assign(new Error("Shopify did not confirm an empty cart."), {
          code: "AUTHORITATIVE_CART_NOT_EMPTY",
        });
      }
      track("snoozer_action", { type: "cart_clear" });
      return applied;
    } catch (err) {
      logCartOperation({
        operation: "cart_clear",
        cartId,
        sourcePage: "cart-page",
        ok: false,
        startedAt,
        error: err,
      });
      try {
        await get().syncCartFromShopify({ sourcePage: "cart-clear-recovery" });
      } catch {
        // Preserve the last confirmed cart and checkout link for retry.
      }
      throw err;
    }
  }),

  prepareCheckoutCart: async ({ sourcePage = "checkout" } = {}) =>
    serializeCartMutation(set, "checkout_prepare", async () => {
      const startedAt = Date.now();
      const desiredLines = cartItemsToMutationLines(get().cart);
      if (!desiredLines.length) {
        throw Object.assign(new Error("Your cart is empty."), { code: "CART_EMPTY" });
      }

      const shopperId = String(getSessionState()?.shopperId || "").trim();
      const cartId = extractCartGid(get().cartId) || getStoredCartGid();
      let authoritative = null;
      try {
        const response = shopperId
          ? await api.resolveShopperCart()
          : cartId
            ? await api.getCart(cartId)
            : null;
        authoritative = extractCartObject(response);
      } catch (error) {
        logCartOperation({
          operation: "checkout_cart_fetch",
          cartId,
          sourcePage,
          ok: false,
          startedAt,
          error,
        });
      }

      const serverLines = authoritative ? serverCartToMutationLines(authoritative) : [];
      const reusable =
        authoritative?.checkoutUrl && cartLinesEqual(desiredLines, serverLines);
      let reconciled;
      if (reusable) {
        reconciled = get().applyAuthoritativeCartPayload({ cart: authoritative }, {
          fallbackCartId: cartId,
          sourcePage,
          operation: "checkout_reuse",
          requestedLineCount: desiredLines.length,
          startedAt,
        });
      }

      if (!reusable && authoritative && !cartLinesEqual(desiredLines, serverLines)) {
        console.warn("[cart]", {
          operation: "checkout_attribute_mismatch",
          sourcePage,
          requestedLineCount: desiredLines.length,
          serverLineCount: serverLines.length,
        });
      }

      if (!reusable) {
        const replacement = shopperId
          ? await api.replaceShopperCart({ lines: desiredLines })
          : await api.createCart({ lines: desiredLines });
        reconciled = get().applyAuthoritativeCartPayload(replacement, {
          sourcePage,
          operation: "checkout_cart_recreate",
          requestedLineCount: desiredLines.length,
          startedAt,
        });
      }

      if (!shopperId) return reconciled;

      const correlated = await api.prepareShopperCheckout();
      return get().applyAuthoritativeCartPayload(correlated, {
        fallbackCartId: reconciled?.cartId || cartId,
        sourcePage,
        operation: "checkout_identity_correlation",
        requestedLineCount: desiredLines.length,
        startedAt,
      });
    }),

  clearCartError: () => set({ cartError: null }),

  getCartSubtotal: () => {
    const cart = get().cart || [];
    return cart.reduce((sum, item) => {
      const unit = Number(item.unitPrice) || 0;
      const qty = Number(item.quantity) || 1;
      return sum + unit * qty;
    }, 0);
  },

  getCartLineCount: () => {
    const cart = get().cart || [];
    return cart.reduce((n, item) => n + (Number(item.quantity) || 0), 0);
  },

  addToSnoozePod: (item) => {
    const current = get().snoozepod || [];
    const normalized = normalizeCartItem(item);

    if (!normalized) {
      track("snoozer_action", {
        type: "snoozepod_add_invalid",
        reason: "missing_or_invalid_variant_gid",
        raw: {
          id: item?.id,
          variantId: item?.variantId,
          merchandiseId: item?.merchandiseId,
        },
      });
      return;
    }

    const existing = current.find((p) => p.id === normalized.id);
    const next = existing
      ? current.map((p) =>
          p.id === normalized.id
            ? { ...p, quantity: (p.quantity || 1) + (normalized.quantity || 1) }
            : p
        )
      : [...current, normalized];

    set({ snoozepod: next });
    saveJSON(STORAGE_KEYS.snoozepod, next);

    track("snoozer_action", {
      type: "snoozepod_add",
      id: normalized.id,
      merchandiseId: normalized.merchandiseId,
      quantity: normalized.quantity,
    });
  },

  setSnoozePodQty: (id, quantity) => {
    const key = String(id || "");
    const q = Math.max(0, Math.floor(Number(quantity) || 0));
    if (!key) return;

    const next = (get().snoozepod || [])
      .map((p) => (p.id === key ? { ...p, quantity: q } : p))
      .filter((p) => (p.quantity || 0) > 0);

    set({ snoozepod: next });
    saveJSON(STORAGE_KEYS.snoozepod, next);

    track("snoozer_action", { type: "snoozepod_qty", id: key, quantity: q });
  },

  removeFromSnoozePod: (id) => {
    const key = String(id || "");
    if (!key) return;

    const next = (get().snoozepod || []).filter((p) => p.id !== key);
    set({ snoozepod: next });
    saveJSON(STORAGE_KEYS.snoozepod, next);

    track("snoozer_action", { type: "snoozepod_remove", id: key });
  },

  clearSnoozePod: () => {
    set({ snoozepod: [] });
    saveJSON(STORAGE_KEYS.snoozepod, []);
    track("snoozer_action", { type: "snoozepod_clear" });
  },

  getSnoozePodSubtotal: () => {
    const plan = get().snoozepod || [];
    return plan.reduce((sum, item) => {
      const unit = Number(item.unitPrice) || 0;
      const qty = Number(item.quantity) || 1;
      return sum + unit * qty;
    }, 0);
  },

  getSnoozePodLineCount: () => {
    const plan = get().snoozepod || [];
    return plan.reduce((n, item) => n + (Number(item.quantity) || 0), 0);
  },

  applySnoozePodCoupon: (code) => {
    const next = {
      ...get().snoozepodMeta,
      couponCode: String(code || "").trim(),
    };
    set({ snoozepodMeta: next });
    saveJSON(STORAGE_KEYS.snoozepodMeta, next);
    track("snoozer_action", {
      type: "snoozepod_coupon",
      code: next.couponCode || "",
    });
  },

  applySnoozePodRewards: (points) => {
    const p = Math.max(0, Math.floor(Number(points) || 0));
    const next = { ...get().snoozepodMeta, rewardsPointsApplied: p };
    set({ snoozepodMeta: next });
    saveJSON(STORAGE_KEYS.snoozepodMeta, next);
    track("snoozer_action", { type: "snoozepod_rewards_apply", points: p });
  },

  getSnoozePodEstimatedTotal: ({ dollarsPerPoint = 0.01 } = {}) => {
    const subtotal = get().getSnoozePodSubtotal();
    const meta = get().snoozepodMeta || DEFAULT_SNOOZEPOD_META;

    const points = Math.max(0, Math.floor(Number(meta.rewardsPointsApplied) || 0));
    const rewardDiscount = Math.max(0, points * Number(dollarsPerPoint || 0));

    const total = Math.max(0, subtotal - rewardDiscount);
    return {
      subtotal,
      rewardDiscount,
      total,
      couponCode: meta.couponCode || "",
      points,
    };
  },

  commitSnoozePodToCart: ({ clearPlan = false } = {}) => {
    markCartMutation(true, "commitSnoozePodToCart");
    const plan = get().snoozepod || [];
    if (!plan.length) {
      track("snoozer_action", { type: "snoozepod_commit_empty" });
      markCartMutation(false, "commitSnoozePodToCart");
      return { committed: 0 };
    }

    const currentCart = get().cart || [];
    const merged = new Map();

    for (const c of currentCart) {
      const item = normalizeCartItem(c);
      if (!item) continue;
      merged.set(cartItemIdentity(item) || item.id, item);
    }

    for (const p of plan) {
      const item = normalizeCartItem(p);
      if (!item) continue;

      const identity = cartItemIdentity(item) || item.id;
      const existing = merged.get(identity);
      if (existing) {
        merged.set(identity, {
          ...existing,
          quantity: (existing.quantity || 1) + (item.quantity || 1),
        });
      } else {
        merged.set(identity, item);
      }
    }

    const nextCart = Array.from(merged.values());

    set((state) => ({
      cart: nextCart,
      badges: { ...state.badges, Cart: true },
      snoozepod: clearPlan ? [] : state.snoozepod,
    }));

    saveJSON(STORAGE_KEYS.cart, nextCart);
    if (clearPlan) saveJSON(STORAGE_KEYS.snoozepod, []);

    track("snoozer_action", {
      type: "snoozepod_commit",
      committedLines: plan.length,
      clearPlan: !!clearPlan,
    });
    track("snoozer_tab_badge_set", { tab: "Cart" });

    markCartMutation(false, "commitSnoozePodToCart");
    return { committed: plan.length };
  },

  setAssessment: (assessment) => {
    set({ assessment });
    saveJSON(STORAGE_KEYS.assessment, assessment || {});
    track("snoozer_assessment_set", { hasAssessment: !!assessment });
  },

  setAssessmentSummary: (summary) => {
    const value = summary || "";
    set({ assessmentSummary: value });
    saveText(STORAGE_KEYS.assessmentSummary, value);
    track("snoozer_assessment_summary_set", { hasSummary: !!value });
  },

  setRecommendations: (recommendations) => {
    const next =
      recommendations && typeof recommendations === "object" ? recommendations : null;
    set({ recommendations: next });
    saveJSON(STORAGE_KEYS.recommendations, next || {});
    track("snoozer_recommendations_set", {
      podCount: Array.isArray(next?.pods) ? next.pods.length : 0,
    });
  },

  setRecommendedProducts: (products) => {
    const list = Array.isArray(products) ? products : [];
    set({ recommendedProducts: list });
    saveJSON(STORAGE_KEYS.recommendedProducts, list);
    track("snoozer_recommended_products_set", { count: list.length });
  },

  setRecommendedProductHandles: (handles) => {
    const list = Array.isArray(handles) ? handles.filter(Boolean) : [];
    set({ recommendedProductHandles: list });
    saveJSON(STORAGE_KEYS.recommendedProductHandles, list);
    track("snoozer_recommended_handles_set", { count: list.length });
  },

  completeStep: (step, extras = {}) => {
    const prog = { ...get().progress };
    if (prog[step]) return;

    prog[step] = true;
    const gained = XP_VALUES[step] || 0;
    const nextXP = (get().xp || 0) + gained;

    set({ progress: prog, xp: nextXP });
    saveJSON(STORAGE_KEYS.progress, prog);
    saveJSON(STORAGE_KEYS.xp, nextXP);

    track("snoozer_progress_step", { step, gained, xp: nextXP, ...extras });
  },

  resetJourney: () => {
    set({ progress: DEFAULT_PROGRESS, xp: 0 });
    saveJSON(STORAGE_KEYS.progress, DEFAULT_PROGRESS);
    saveJSON(STORAGE_KEYS.xp, 0);
    track("snoozer_progress_reset");
  },
}));
