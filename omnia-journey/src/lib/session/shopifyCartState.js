import { getSessionState, setCartIdentity } from "@/state/sessionStore";

const LEGACY_KEYS = {
  cartId: "snooze.cartId",
  checkoutUrl: "snooze.checkoutUrl",
  shopifyCartId: "snooze.shopify.cartId",
  shopifyCheckoutUrl: "snooze.shopify.checkoutUrl",
};

function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    sessionStorage.setItem(key, String(value || ""));
  } catch {
    // ignore
  }
}

function safeRemove(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function isShopifyCartGid(value) {
  return /^gid:\/\/shopify\/Cart\/[^/?#\s]+$/i.test(String(value || "").trim());
}

export function extractShopifyCartGid(value) {
  if (!value) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (isShopifyCartGid(trimmed)) return trimmed;

    const match = trimmed.match(/gid:\/\/shopify\/Cart\/[^/?#\s]+/i);
    return match?.[0] && isShopifyCartGid(match[0]) ? match[0] : "";
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
      const gid = extractShopifyCartGid(candidate);
      if (gid) return gid;
    }
  }

  return "";
}

export function normalizeCheckoutUrl(value) {
  const text = String(value || "").trim();
  return text || "";
}

export function getStoredShopifyCartIdentity() {
  const session = getSessionState?.() || {};
  const cartId =
    extractShopifyCartGid(session?.cartId) ||
    extractShopifyCartGid(safeGet(LEGACY_KEYS.shopifyCartId)) ||
    extractShopifyCartGid(safeGet(LEGACY_KEYS.cartId)) ||
    "";
  const checkoutUrl =
    normalizeCheckoutUrl(session?.checkoutUrl) ||
    normalizeCheckoutUrl(safeGet(LEGACY_KEYS.shopifyCheckoutUrl)) ||
    normalizeCheckoutUrl(safeGet(LEGACY_KEYS.checkoutUrl)) ||
    "";

  return {
    cartId,
    checkoutUrl,
  };
}

export function persistShopifyCartIdentity({ cartId, checkoutUrl } = {}) {
  const nextCartId =
    cartId !== undefined ? extractShopifyCartGid(cartId) : getStoredShopifyCartIdentity().cartId;
  const nextCheckoutUrl =
    checkoutUrl !== undefined
      ? normalizeCheckoutUrl(checkoutUrl)
      : getStoredShopifyCartIdentity().checkoutUrl;

  if (nextCartId) {
    safeSet(LEGACY_KEYS.cartId, nextCartId);
    safeSet(LEGACY_KEYS.shopifyCartId, nextCartId);
  } else if (cartId !== undefined) {
    safeRemove(LEGACY_KEYS.cartId);
    safeRemove(LEGACY_KEYS.shopifyCartId);
  }

  if (nextCheckoutUrl) {
    safeSet(LEGACY_KEYS.checkoutUrl, nextCheckoutUrl);
    safeSet(LEGACY_KEYS.shopifyCheckoutUrl, nextCheckoutUrl);
  } else if (checkoutUrl !== undefined) {
    safeRemove(LEGACY_KEYS.checkoutUrl);
    safeRemove(LEGACY_KEYS.shopifyCheckoutUrl);
  }

  setCartIdentity?.({
    cartId: nextCartId || null,
    checkoutUrl: nextCheckoutUrl || null,
  });

  return {
    cartId: nextCartId,
    checkoutUrl: nextCheckoutUrl,
  };
}

export function clearStoredShopifyCartIdentity() {
  safeRemove(LEGACY_KEYS.cartId);
  safeRemove(LEGACY_KEYS.shopifyCartId);
  safeRemove(LEGACY_KEYS.checkoutUrl);
  safeRemove(LEGACY_KEYS.shopifyCheckoutUrl);

  setCartIdentity?.({
    cartId: null,
    checkoutUrl: null,
  });

  return {
    cartId: "",
    checkoutUrl: "",
  };
}
