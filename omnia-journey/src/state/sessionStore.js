// src/state/sessionStore.js
// Minimal, durable session state for Snoozer flows.
// Purpose:
// - Persist threadId across refresh
// - Persist cartId + checkoutUrl across refresh (cart-first behavior)
// - Persist last known assistant context/contextPatch (optional)
// - Provide a tiny subscribe API + optional React hook
//
// NOTE:
// Some pages were importing getCartSession/setCartSession/clearCartSession.
// This file now exports those helpers as a thin compatibility layer
// on top of the canonical session state.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "snooze.sessionState.v1";

const LEGACY_KEYS = {
  threadId: "snooze.threadId",
  sessionId: "snooze.sessionId",
  shopperId: "snooze.shopperId",
  cartId: "snooze.cartId",
  checkoutUrl: "snooze.checkoutUrl",
  accessCode: "snooze.accessCode",

  shopifyCartId: "snooze.shopify.cartId",
  shopifyCheckoutUrl: "snooze.shopify.checkoutUrl",
};

const CART_SESSION_KEY = "snooze.cartSession.v1";

const DEFAULT_STATE = Object.freeze({
  version: 1,
  threadId: null,
  sessionId: null,
  shopperId: null,
  cartId: null,
  checkoutUrl: null,
  lastCartUpdatedAt: null,
  context: null,
  contextPatch: null,
});

const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
}

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeGetItem(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeRemoveItem(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return null;
  }
}

function makeThreadId(prefix = "web") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function mergeState(base, patch) {
  const out = { ...(base || {}) };
  const p = patch && typeof patch === "object" ? patch : {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function isValidCartGid(value) {
  return /^gid:\/\/shopify\/Cart\/[^/?#\s]+$/i.test(String(value || "").trim());
}

function extractCartGid(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (isValidCartGid(trimmed)) return trimmed;

    const match = trimmed.match(/gid:\/\/shopify\/Cart\/[^/?#\s]+/i);
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

function normalizeCheckoutUrl(value) {
  const s = String(value || "").trim();
  return s || null;
}

function migrateLegacyInto(state) {
  const out = { ...(state || {}) };

  if (!out.threadId) {
    const legacyThread = safeGetItem(LEGACY_KEYS.threadId);
    if (legacyThread) out.threadId = legacyThread;
  }

  if (!out.shopperId) {
    const shopperId = safeGetItem(LEGACY_KEYS.shopperId);
    const accessCode = safeGetItem(LEGACY_KEYS.accessCode);
    if (shopperId) out.shopperId = shopperId;
    else if (accessCode) out.shopperId = accessCode;
  }

  if (!out.sessionId) {
    const legacySessionId = safeGetItem(LEGACY_KEYS.sessionId);
    if (legacySessionId) out.sessionId = legacySessionId;
  }

  if (!out.cartId) {
    const zustandCartId = extractCartGid(safeGetItem(LEGACY_KEYS.shopifyCartId));
    const legacyCartId = extractCartGid(safeGetItem(LEGACY_KEYS.cartId));
    if (zustandCartId) out.cartId = zustandCartId;
    else if (legacyCartId) out.cartId = legacyCartId;
  } else {
    out.cartId = extractCartGid(out.cartId);
  }

  if (!out.checkoutUrl) {
    const zustandCheckout = normalizeCheckoutUrl(
      safeGetItem(LEGACY_KEYS.shopifyCheckoutUrl)
    );
    const legacyCheckout = normalizeCheckoutUrl(safeGetItem(LEGACY_KEYS.checkoutUrl));
    if (zustandCheckout) out.checkoutUrl = zustandCheckout;
    else if (legacyCheckout) out.checkoutUrl = legacyCheckout;
  } else {
    out.checkoutUrl = normalizeCheckoutUrl(out.checkoutUrl);
  }

  const legacyCartSession = safeJsonParse(safeGetItem(CART_SESSION_KEY));
  if (legacyCartSession && typeof legacyCartSession === "object") {
    const legacySessionCartId = extractCartGid(legacyCartSession.cartId);
    const legacySessionCheckout = normalizeCheckoutUrl(legacyCartSession.checkoutUrl);

    if (!out.cartId && legacySessionCartId) out.cartId = legacySessionCartId;
    if (!out.checkoutUrl && legacySessionCheckout) out.checkoutUrl = legacySessionCheckout;
  }

  return out;
}

function loadRawState() {
  const raw = safeGetItem(STORAGE_KEY);
  const parsed = safeJsonParse(raw);
  const merged = mergeState(DEFAULT_STATE, parsed || {});
  return migrateLegacyInto(merged);
}

let _state = loadRawState();

function persistCanonicalMirrors(next) {
  if (next.threadId) {
    safeSetItem(LEGACY_KEYS.threadId, String(next.threadId));
  } else {
    safeRemoveItem(LEGACY_KEYS.threadId);
  }

  if (next.sessionId) {
    safeSetItem(LEGACY_KEYS.sessionId, String(next.sessionId));
  } else {
    safeRemoveItem(LEGACY_KEYS.sessionId);
  }

  if (next.shopperId) {
    safeSetItem(LEGACY_KEYS.shopperId, String(next.shopperId));
    safeSetItem(LEGACY_KEYS.accessCode, String(next.shopperId));
  } else {
    safeRemoveItem(LEGACY_KEYS.shopperId);
    safeRemoveItem(LEGACY_KEYS.accessCode);
  }

  if (next.cartId) {
    safeSetItem(LEGACY_KEYS.cartId, String(next.cartId));
    safeSetItem(LEGACY_KEYS.shopifyCartId, String(next.cartId));
  } else {
    safeRemoveItem(LEGACY_KEYS.cartId);
    safeRemoveItem(LEGACY_KEYS.shopifyCartId);
  }

  if (next.checkoutUrl) {
    safeSetItem(LEGACY_KEYS.checkoutUrl, String(next.checkoutUrl));
    safeSetItem(LEGACY_KEYS.shopifyCheckoutUrl, String(next.checkoutUrl));
  } else {
    safeRemoveItem(LEGACY_KEYS.checkoutUrl);
    safeRemoveItem(LEGACY_KEYS.shopifyCheckoutUrl);
  }
}

function persistCompatCartSession(next, extras = {}) {
  safeSetItem(
    CART_SESSION_KEY,
    JSON.stringify({
      cartId: next.cartId || null,
      checkoutUrl: next.checkoutUrl || null,
      lineDigest: extras.lineDigest || null,
      updatedAt: extras.updatedAt || Date.now(),
    })
  );
}

function persistState(next) {
  const merged = mergeState(DEFAULT_STATE, next || {});
  const normalized = {
    ...merged,
    cartId: extractCartGid(merged.cartId),
    checkoutUrl: normalizeCheckoutUrl(merged.checkoutUrl),
  };

  _state = normalized;
  safeSetItem(STORAGE_KEY, JSON.stringify(_state));
  persistCanonicalMirrors(_state);
  emit();
}

export function getSessionState() {
  return _state;
}

export function setSessionState(patch = {}) {
  const next = mergeState(_state, patch);

  if (Object.prototype.hasOwnProperty.call(patch, "cartId")) {
    next.cartId = extractCartGid(patch.cartId);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "checkoutUrl")) {
    next.checkoutUrl = normalizeCheckoutUrl(patch.checkoutUrl);
  }

  persistState(next);

  if (
    Object.prototype.hasOwnProperty.call(patch, "cartId") ||
    Object.prototype.hasOwnProperty.call(patch, "checkoutUrl")
  ) {
    persistCompatCartSession(getSessionState());
  }
}

export function resetSessionState() {
  _state = { ...DEFAULT_STATE };
  safeRemoveItem(STORAGE_KEY);

  safeRemoveItem(LEGACY_KEYS.threadId);
  safeRemoveItem(LEGACY_KEYS.sessionId);
  safeRemoveItem(LEGACY_KEYS.shopperId);
  safeRemoveItem(LEGACY_KEYS.accessCode);
  safeRemoveItem(LEGACY_KEYS.cartId);
  safeRemoveItem(LEGACY_KEYS.checkoutUrl);
  safeRemoveItem(LEGACY_KEYS.shopifyCartId);
  safeRemoveItem(LEGACY_KEYS.shopifyCheckoutUrl);
  safeRemoveItem(CART_SESSION_KEY);

  emit();
}

export function ensureSessionThreadId() {
  const cur = getSessionState();
  if (cur.threadId && String(cur.threadId).trim()) return cur.threadId;

  const tid = makeThreadId("web");
  setSessionState({ threadId: tid });
  return tid;
}

export function setShopperId(shopperId) {
  const id = shopperId && String(shopperId).trim() ? String(shopperId).trim() : null;
  setSessionState({ shopperId: id });
}

export function getShopperId() {
  const shopperId = String(getSessionState()?.shopperId || "").trim();
  if (shopperId) return shopperId;
  const legacyShopperId = String(safeGetItem(LEGACY_KEYS.shopperId) || "").trim();
  if (legacyShopperId) return legacyShopperId;
  const accessCode = String(safeGetItem(LEGACY_KEYS.accessCode) || "").trim();
  return accessCode || null;
}

export function getAccessCode() {
  return getShopperId();
}

export function setAccessCode(accessCode) {
  setShopperId(accessCode);
  return getShopperId();
}

export function setSessionLinkId(sessionId) {
  const id = sessionId && String(sessionId).trim() ? String(sessionId).trim() : null;
  setSessionState({ sessionId: id });
  return getSessionState();
}

/**
 * Canonical cart identity setter (preferred).
 * Only accepts a real Shopify Cart GID for cartId.
 */
export function setCartIdentity({ cartId, checkoutUrl } = {}) {
  const nextCartId = extractCartGid(cartId);
  const nextCheckoutUrl = normalizeCheckoutUrl(checkoutUrl);

  const patch = {
    lastCartUpdatedAt: nowIso(),
  };

  if (cartId !== undefined) {
    patch.cartId = nextCartId;
  }

  if (checkoutUrl !== undefined) {
    patch.checkoutUrl = nextCheckoutUrl;
  }

  setSessionState(patch);

  persistCompatCartSession(getSessionState());

  return getSessionState();
}

/**
 * Apply assistant response fields that matter for persistence.
 * Supports these shapes:
 * - { thread_id, context, contextPatch }
 * - { threadId, context, contextPatch }
 * - { cartId, checkoutUrl }
 * - { contextPatch: { cartId, lastCheckoutUrl } }
 * - { contextPatch: { ids: { cartId }, checkoutUrl } }
 */
export function applyAssistantResponse(resp) {
  const r = resp && typeof resp === "object" ? resp : {};

  const threadId =
    r.thread_id || r.threadId || r.data?.thread_id || r.data?.threadId || null;

  const contextPatch =
    (r.contextPatch && typeof r.contextPatch === "object" ? r.contextPatch : null) ||
    (r.data?.contextPatch && typeof r.data.contextPatch === "object"
      ? r.data.contextPatch
      : null) ||
    null;

  const context =
    (r.context && typeof r.context === "object" ? r.context : null) ||
    (r.data?.context && typeof r.data.context === "object" ? r.data.context : null) ||
    null;

  const cartId = extractCartGid(
    r.cartId ||
      r.cart_id ||
      r.data?.cartId ||
      r.data?.cart_id ||
      contextPatch?.cartId ||
      contextPatch?.cart_id ||
      contextPatch?.ids?.cartId ||
      contextPatch?.ids?.cart_id ||
      contextPatch?.ids?.cart ||
      null
  );

  const checkoutUrl = normalizeCheckoutUrl(
    r.checkoutUrl ||
      r.checkout_url ||
      r.data?.checkoutUrl ||
      r.data?.checkout_url ||
      contextPatch?.lastCheckoutUrl ||
      contextPatch?.checkoutUrl ||
      contextPatch?.checkout_url ||
      contextPatch?.urls?.checkoutUrl ||
      contextPatch?.urls?.checkout_url ||
      null
  );

  const patch = {};

  if (threadId && String(threadId).trim()) patch.threadId = String(threadId).trim();
  if (contextPatch) patch.contextPatch = contextPatch;
  if (context) patch.context = context;

  if (cartId !== null) patch.cartId = cartId;
  if (checkoutUrl !== null) patch.checkoutUrl = checkoutUrl;

  if (patch.cartId !== undefined || patch.checkoutUrl !== undefined) {
    patch.lastCartUpdatedAt = nowIso();
  }

  if (Object.keys(patch).length) {
    setSessionState(patch);

    if (patch.cartId !== undefined || patch.checkoutUrl !== undefined) {
      persistCompatCartSession(getSessionState());
    }
  }

  return getSessionState();
}

export function subscribeSessionState(cb) {
  if (typeof cb !== "function") return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSessionStore(selector = (s) => s) {
  const snap = useSyncExternalStore(
    subscribeSessionState,
    () => selector(getSessionState()),
    () => selector(getSessionState())
  );
  return snap;
}

export function getCartSession() {
  const s = getSessionState();
  const snap = safeJsonParse(safeGetItem(CART_SESSION_KEY)) || {};

  const cartId =
    s.cartId ||
    extractCartGid(snap.cartId) ||
    extractCartGid(safeGetItem(LEGACY_KEYS.shopifyCartId)) ||
    extractCartGid(safeGetItem(LEGACY_KEYS.cartId)) ||
    null;

  const checkoutUrl =
    s.checkoutUrl ||
    normalizeCheckoutUrl(snap.checkoutUrl) ||
    normalizeCheckoutUrl(safeGetItem(LEGACY_KEYS.shopifyCheckoutUrl)) ||
    normalizeCheckoutUrl(safeGetItem(LEGACY_KEYS.checkoutUrl)) ||
    null;

  return {
    cartId,
    checkoutUrl,
    lineDigest: snap.lineDigest || null,
    updatedAt: snap.updatedAt || null,
  };
}

export function setCartSession(payload = {}) {
  const p = payload && typeof payload === "object" ? payload : {};
  const cartId = p.cartId !== undefined ? extractCartGid(p.cartId) : null;
  const checkoutUrl =
    p.checkoutUrl !== undefined ? normalizeCheckoutUrl(p.checkoutUrl) : null;

  setCartIdentity({ cartId, checkoutUrl });

  safeSetItem(
    CART_SESSION_KEY,
    JSON.stringify({
      cartId,
      checkoutUrl,
      lineDigest: p.lineDigest || null,
      updatedAt: p.updatedAt || Date.now(),
    })
  );

  emit();
  return getCartSession();
}

export function clearCartSession() {
  safeRemoveItem(CART_SESSION_KEY);

  setSessionState({
    cartId: null,
    checkoutUrl: null,
    lastCartUpdatedAt: nowIso(),
  });

  safeRemoveItem(LEGACY_KEYS.cartId);
  safeRemoveItem(LEGACY_KEYS.checkoutUrl);
  safeRemoveItem(LEGACY_KEYS.shopifyCartId);
  safeRemoveItem(LEGACY_KEYS.shopifyCheckoutUrl);

  emit();
}

export const sessionStore = {
  get: getSessionState,
  set: setSessionState,
  reset: resetSessionState,
  ensureThreadId: ensureSessionThreadId,
  setShopperId,
  getShopperId,
  getAccessCode,
  setAccessCode,
  setSessionLinkId,
  setCartIdentity,
  applyAssistantResponse,
  subscribe: subscribeSessionState,

  getCartSession,
  setCartSession,
  clearCartSession,
};
