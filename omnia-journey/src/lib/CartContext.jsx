// src/lib/CartContext.jsx
// Cart adapter/context for the Snoozer frontend.
//
// Goals:
// - Single source of truth for cartItems in the UI
// - Durable session identity (cartId + checkoutUrl) via sessionStore
// - Optional server sync with Shopify cart endpoints (create/get/add/update/remove)
// - Keep the rest of the app dumb: pages just call useCart()

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createCart as apiCreateCart,
  getCart as apiGetCart,
  addLinesToCart as apiAddLinesToCart,
  updateCartLines as apiUpdateCartLines,
  removeCartLines as apiRemoveCartLines,
} from "@/lib/api";

import {
  getSessionState,
  setCartIdentity,
  ensureSessionThreadId,
  subscribeSessionState,
} from "@/state/sessionStore";

const CART_ITEMS_KEY = "snooze.cartItems.v1";

const CartContext = createContext(null);

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadCartItems() {
  try {
    const raw = sessionStorage.getItem(CART_ITEMS_KEY);
    const parsed = safeJsonParse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistCartItems(items) {
  try {
    sessionStorage.setItem(
      CART_ITEMS_KEY,
      JSON.stringify(Array.isArray(items) ? items : [])
    );
  } catch {
    // ignore
  }
}

function toVariantGid(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s)) return s;
  if (/^\d+$/.test(s) && s !== "0") return `gid://shopify/ProductVariant/${s}`;
  return null;
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;

  const variantId = toVariantGid(raw.variantId || raw.merchandiseId || raw.id);
  if (!variantId) return null;

  const quantity = Math.max(
    1,
    Math.floor(Number(raw.quantity ?? raw.qty ?? 1) || 1)
  );

  return {
    // IMPORTANT: key by variantId always (stable)
    id: variantId,
    variantId,
    merchandiseId: variantId,

    // Shopify cart line id (only exists after server sync)
    lineId: raw.lineId ? String(raw.lineId) : null,

    handle: raw.handle ? String(raw.handle) : null,
    title: raw.title ? String(raw.title) : "Untitled",
    imageUrl: raw.imageUrl || raw.image || "/no-image.svg",
    unitPrice: Number(raw.unitPrice ?? raw.price ?? 0) || 0,
    quantity,
  };
}

function mergeAdd(items, incoming) {
  const next = Array.isArray(items) ? [...items] : [];
  const add = normalizeItem(incoming);
  if (!add) return next;

  const idx = next.findIndex((x) => (x?.variantId || x?.id) === add.variantId);
  if (idx >= 0) {
    const cur = next[idx];
    next[idx] = {
      ...cur,
      ...add,
      quantity: Math.max(
        1,
        (Number(cur.quantity) || 1) + (Number(add.quantity) || 1)
      ),
      // don't trash lineId if we already have it
      lineId: cur?.lineId || add?.lineId || null,
    };
    return next;
  }

  next.push(add);
  return next;
}

function cartToItems(cart) {
  const edges = cart?.lines?.edges || [];
  const out = [];

  for (const e of edges) {
    const n = e?.node;
    const lineId = n?.id || null;
    const qty = Number(n?.quantity) || 1;

    const merch = n?.merchandise;
    const variantId = toVariantGid(merch?.id);
    if (!variantId) continue;

    const title =
      merch?.product?.title && merch?.title && merch.title !== "Default Title"
        ? `${merch.product.title} — ${merch.title}`
        : merch?.product?.title || merch?.title || "Untitled";

    const handle = merch?.product?.handle || null;
    const unitPrice = Number(merch?.price?.amount) || 0;

    const img =
      merch?.image?.url || merch?.image?.originalSrc || "/no-image.svg";

    out.push({
      id: variantId,
      variantId,
      merchandiseId: variantId,
      lineId: lineId ? String(lineId) : null,
      handle,
      title,
      imageUrl: img,
      unitPrice,
      quantity: Math.max(1, Math.floor(qty)),
    });
  }

  return out;
}

function extractCartIdentity(payload) {
  // payload shapes we expect:
  // { cart, cartId, checkoutUrl }
  // OR { data:{ cart } }
  const cart = payload?.cart || payload?.data?.cart || null;
  const cartId = payload?.cartId || payload?.id || cart?.id || null;
  const checkoutUrl = payload?.checkoutUrl || cart?.checkoutUrl || null;
  return { cart, cartId, checkoutUrl };
}

function findByAnyId(items, id) {
  const key = String(id || "");
  if (!key) return null;
  const list = Array.isArray(items) ? items : [];
  return (
    list.find(
      (x) =>
        String(x?.id || "") === key ||
        String(x?.variantId || "") === key ||
        String(x?.merchandiseId || "") === key
    ) || null
  );
}

export function CartProvider({ children }) {
  // Local UI cart (fast)
  const [cartItems, setCartItems] = useState(() => loadCartItems());

  // Session identity (durable)
  const [cartId, setCartId] = useState(() => getSessionState()?.cartId || null);
  const [checkoutUrl, setCheckoutUrl] = useState(
    () => getSessionState()?.checkoutUrl || null
  );

  // Prevent sync stampedes
  const syncingRef = useRef(false);

  // Keep a live ref to cartItems so callbacks never depend on stale closures
  const cartItemsRef = useRef(cartItems);
  useEffect(() => {
    cartItemsRef.current = cartItems;
  }, [cartItems]);

  // Keep sessionStore values live inside this provider
  useEffect(() => {
    const unsub = subscribeSessionState(() => {
      const s = getSessionState();
      setCartId(s?.cartId || null);
      setCheckoutUrl(s?.checkoutUrl || null);
    });
    return unsub;
  }, []);

  // Persist cartItems for refresh durability
  useEffect(() => {
    persistCartItems(cartItems);
  }, [cartItems]);

  // Ensure we always have a threadId available for Snoozer calls
  useEffect(() => {
    ensureSessionThreadId();
  }, []);

  const syncFromServer = useCallback(async () => {
    if (!cartId) return;
    if (syncingRef.current) return;

    syncingRef.current = true;
    try {
      const payload = await apiGetCart(cartId);
      const { cart, cartId: returnedId, checkoutUrl: cu } = extractCartIdentity(payload);

      if (cart) {
        const items = cartToItems(cart);
        setCartItems(items);

        // If the backend/cart returned an id/url, persist it
        if (returnedId || cu) {
          setCartIdentity({
            cartId: returnedId || cart.id || cartId,
            checkoutUrl: cu || cart.checkoutUrl || null,
          });
        }
      }
    } catch {
      // cart gone/invalid: drop identity, keep local UI cart
      setCartIdentity({ cartId: null, checkoutUrl: null });
    } finally {
      syncingRef.current = false;
    }
  }, [cartId]);

  // On mount, if we have a server cartId, hydrate UI cart from server
  useEffect(() => {
    syncFromServer();
  }, [syncFromServer]);

  const addToCart = useCallback(
    async (item) => {
      const normalized = normalizeItem(item);
      if (!normalized) return false;

      // 1) Update UI immediately
      setCartItems((prev) => mergeAdd(prev, normalized));

      // 2) Try to sync to Shopify cart
      const line = {
        merchandiseId: normalized.merchandiseId,
        quantity: normalized.quantity,
      };

      try {
        if (!cartId) {
          const payload = await apiCreateCart({ lines: [line] });
          const { cart, cartId: newId, checkoutUrl: newUrl } =
            extractCartIdentity(payload);

          if (newId || newUrl) {
            setCartIdentity({
              cartId: newId || cart?.id || null,
              checkoutUrl: newUrl || cart?.checkoutUrl || null,
            });
          }

          if (cart) setCartItems(cartToItems(cart));
          return true;
        }

        const payload = await apiAddLinesToCart({ cartId, lines: [line] });
        const { cart, checkoutUrl: newUrl } = extractCartIdentity(payload);

        if (newUrl) setCartIdentity({ cartId, checkoutUrl: newUrl });
        if (cart) setCartItems(cartToItems(cart));

        return true;
      } catch {
        // keep local cart state even if server sync fails
        return true;
      }
    },
    [cartId]
  );

  const updateCart = useCallback(
    async (id, quantity) => {
      const qty = Math.max(0, Math.floor(Number(quantity) || 0));

      // Capture current lineId BEFORE we mutate state (avoid stale closure + react batching weirdness)
      const current = findByAnyId(cartItemsRef.current, id);
      const lineId = current?.lineId || null;

      // Update UI immediately
      setCartItems((prev) => {
        const next = (Array.isArray(prev) ? prev : []).map((x) => ({ ...x }));
        const idx = next.findIndex(
          (x) =>
            String(x?.id || "") === String(id) ||
            String(x?.variantId || "") === String(id) ||
            String(x?.merchandiseId || "") === String(id)
        );
        if (idx < 0) return next;

        if (qty === 0) {
          next.splice(idx, 1);
          return next;
        }

        next[idx].quantity = qty;
        return next;
      });

      // Server sync if possible (requires cartId + lineId)
      if (!cartId) return;
      if (!lineId) return;

      try {
        if (qty === 0) {
          const payload = await apiRemoveCartLines({
            cartId,
            lineIds: [lineId],
          });

          const { cart, checkoutUrl: newUrl } = extractCartIdentity(payload);
          if (newUrl) setCartIdentity({ cartId, checkoutUrl: newUrl });
          if (cart) setCartItems(cartToItems(cart));
          return;
        }

        // IMPORTANT: api.updateCartLines expects [{ lineId, quantity }]
        const payload = await apiUpdateCartLines({
          cartId,
          lines: [{ lineId, quantity: qty }],
        });

        const { cart, checkoutUrl: newUrl } = extractCartIdentity(payload);
        if (newUrl) setCartIdentity({ cartId, checkoutUrl: newUrl });
        if (cart) setCartItems(cartToItems(cart));
      } catch {
        // ignore server sync failure
      }
    },
    [cartId]
  );

  const removeFromCart = useCallback(
    async (id) => {
      // Capture lineId BEFORE we mutate state
      const current = findByAnyId(cartItemsRef.current, id);
      const lineId = current?.lineId || null;

      // Update UI immediately
      setCartItems((prev) => {
        const next = (Array.isArray(prev) ? prev : []).filter((x) => {
          const match =
            String(x?.id || "") === String(id) ||
            String(x?.variantId || "") === String(id) ||
            String(x?.merchandiseId || "") === String(id);
          return !match;
        });
        return next;
      });

      // Server sync if possible
      if (!cartId) return;
      if (!lineId) return;

      try {
        const payload = await apiRemoveCartLines({
          cartId,
          lineIds: [lineId],
        });

        const { cart, checkoutUrl: newUrl } = extractCartIdentity(payload);
        if (newUrl) setCartIdentity({ cartId, checkoutUrl: newUrl });
        if (cart) setCartItems(cartToItems(cart));
      } catch {
        // ignore
      }
    },
    [cartId]
  );

  const clearCart = useCallback(async () => {
    setCartItems([]);
    setCartIdentity({ cartId: null, checkoutUrl: null });

    try {
      sessionStorage.removeItem(CART_ITEMS_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({
      cartItems: Array.isArray(cartItems) ? cartItems : [],
      cartId,
      checkoutUrl,

      addToCart,
      updateCart,
      removeFromCart,
      clearCart,

      syncFromServer,
    }),
    [
      cartItems,
      cartId,
      checkoutUrl,
      addToCart,
      updateCart,
      removeFromCart,
      clearCart,
      syncFromServer,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
