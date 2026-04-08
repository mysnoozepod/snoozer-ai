// src/pages/Checkout.jsx
import React, { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useStore } from "@/lib/useStore";
import { getSessionState, setCartIdentity } from "@/state/sessionStore";

function formatMoney(amount, currency = "USD") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "$0.00";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function toVariantGid(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith("gid://shopify/ProductVariant/")) return s;
  if (/^\d+$/.test(s) && s !== "0") return `gid://shopify/ProductVariant/${s}`;
  return null;
}

function safeImage(item) {
  return item?.imageUrl || item?.image || item?.image?.url || "/no-image.svg";
}

function digestLines(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((l) => `${l.merchandiseId}:${l.quantity}`)
    .sort()
    .join("|");
}

function extractCartFromGetCartResponse(res) {
  // api.getCart(cartId) could return:
  // { cart: {...} } OR { data:{ cart } } OR { ...cart }
  const r = res || {};
  return r.cart || r.data?.cart || (r.id && r.lines ? r : null) || null;
}

function normalizeServerLines(cartObj) {
  const edges = cartObj?.lines?.edges || cartObj?.lines || cartObj?.data?.lines?.edges || [];
  const out = [];

  if (Array.isArray(edges)) {
    for (const e of edges) {
      const node = e?.node || e;
      const merch = node?.merchandise?.id || node?.merchandiseId || null;
      const qty = Number(node?.quantity);
      if (!merch) continue;

      out.push({
        merchandiseId: String(merch),
        quantity: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1,
      });
    }
  }

  return out;
}

export default function Checkout() {
  // kept for route compatibility if you ever use /checkout/:id
  const { id } = useParams(); // eslint-disable-line no-unused-vars

  // ✅ Cart comes from zustand (matches Cart.jsx + Explore.jsx + ProductDetail.jsx)
  const cartItems = useStore((s) => s.cart || []);

  // ✅ Shopify cart identity stored in zustand
  const cartId = useStore((s) => s.cartId || null);
  const checkoutUrl = useStore((s) => s.checkoutUrl || null);
  const setCartMeta = useStore((s) => s.setCartMeta);

  const [discountCode, setDiscountCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const shopperId = (() => {
    try {
      return sessionStorage.getItem("snooze.accessCode") || "guest";
    } catch {
      return "guest";
    }
  })();

  const total = useMemo(() => {
    return (Array.isArray(cartItems) ? cartItems : []).reduce((acc, item) => {
      const unit = Number(item.unitPrice ?? item.price ?? 0);
      const qty = Number(item.quantity ?? item.qty ?? 1);
      return acc + (Number.isFinite(unit) ? unit : 0) * (Number.isFinite(qty) ? qty : 1);
    }, 0);
  }, [cartItems]);

  const cartLines = useMemo(() => {
    return (Array.isArray(cartItems) ? cartItems : [])
      .map((item) => {
        const raw = item.merchandiseId || item.variantId || item.id;
        const merchandiseId = toVariantGid(raw);
        if (!merchandiseId) return null;

        const quantity = Number(item.quantity ?? item.qty ?? 1);
        return {
          merchandiseId,
          quantity: quantity > 0 ? Math.floor(quantity) : 1,
        };
      })
      .filter(Boolean);
  }, [cartItems]);

  const localDigest = useMemo(() => digestLines(cartLines), [cartLines]);

  async function createCheckout() {
    setError("");
    setToast("");

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      setError("Your cart is empty.");
      return;
    }

    if (!cartLines.length) {
      setError("Missing valid variant IDs. Remove & re-add the item(s).");
      api
        .trackCRMEvent({
          shopperId,
          event: "checkout_error",
          score: -10,
          context: { reason: "no_valid_lines" },
        })
        .catch(() => {});
      return;
    }

    setLoading(true);
    try {
      // Best-effort: helps backend correlate state/logs
      try {
        if (api?.ensureSession) await api.ensureSession();
      } catch {
        // ignore
      }

      // 1) If we have a persisted cartId+checkoutUrl, validate it still matches current cart contents.
      // Prefer zustand identity, then legacy sessionStore.
      const session = getSessionState?.() || {};
      const existingCartId = cartId || session?.cartId || null;
      const existingCheckoutUrl = checkoutUrl || session?.checkoutUrl || null;

      if (existingCartId && existingCheckoutUrl) {
        try {
          const serverRes = await api.getCart(existingCartId);
          const cartObj = extractCartFromGetCartResponse(serverRes);
          const serverLines = normalizeServerLines(cartObj);
          const serverDigest = digestLines(serverLines);

          if (serverDigest && serverDigest === localDigest) {
            // Keep both stores warm
            setCartMeta?.({ cartId: existingCartId, checkoutUrl: existingCheckoutUrl });
            setCartIdentity?.({ cartId: existingCartId, checkoutUrl: existingCheckoutUrl });

            api
              .trackCRMEvent({
                shopperId,
                event: "checkout_reuse_url",
                score: 10,
                context: { lineCount: cartLines.length },
              })
              .catch(() => {});

            window.location.assign(existingCheckoutUrl);
            return;
          }
        } catch {
          // validation failed → fall through and create a new cart
        }
      }

      // 2) Create a fresh Shopify cart and redirect
      const res = await api.createCart({
        lines: cartLines,
        note: discountCode ? `Discount code entered: ${discountCode}` : null,
      });

      const cartObj = res?.cart || res?.data?.cart || null;
      const newCartId = res?.cartId || res?.id || cartObj?.id || null;
      const newCheckoutUrl = res?.checkoutUrl || cartObj?.checkoutUrl || null;

      if (!newCheckoutUrl) {
        console.error("❌ Missing checkoutUrl in cart response:", res);
        setError("Checkout is temporarily unavailable. Please try again in a moment.");
        api
          .trackCRMEvent({
            shopperId,
            event: "checkout_error",
            score: -10,
            context: { reason: "missing_checkout_url" },
          })
          .catch(() => {});
        return;
      }

      // Persist identity for reuse across refresh (zustand + legacy)
      setCartMeta?.({ cartId: newCartId, checkoutUrl: newCheckoutUrl });
      setCartIdentity?.({ cartId: newCartId, checkoutUrl: newCheckoutUrl });

      api
        .trackCRMEvent({
          shopperId,
          event: "checkout",
          score: 25,
          context: { lineCount: cartLines.length },
        })
        .catch(() => {});

      window.location.assign(newCheckoutUrl);
    } catch (err) {
      console.error("❌ Checkout error:", err);
      setError(err?.message || "Checkout failed. Please try again in a moment.");
      api
        .trackCRMEvent({
          shopperId,
          event: "checkout_error",
          score: -10,
          context: { reason: "exception", message: err?.message || String(err) },
        })
        .catch(() => {});
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white rounded-2xl shadow">
      <h1 className="text-2xl font-bold mb-2">Review Your Cart</h1>
      <p className="text-sm text-gray-600 mb-6">Total: {formatMoney(total)}</p>

      {cartItems.length === 0 ? (
        <p className="text-gray-500">Your cart is empty.</p>
      ) : (
        <>
          {cartItems.map((item, idx) => {
            const key =
              item.id ||
              item.merchandiseId ||
              item.variantId ||
              `${item?.title || "item"}-${idx}`;

            const title = item.title || "Untitled";
            const image = safeImage(item);
            const qty = Number(item.quantity ?? item.qty ?? 1) || 1;
            const unit = Number(item.unitPrice ?? item.price ?? 0) || 0;

            return (
              <div key={key} className="flex items-center mb-4 border-b pb-4">
                <img
                  src={image}
                  alt={title}
                  className="w-16 h-16 object-cover rounded mr-4"
                  onError={(e) => {
                    e.currentTarget.src = "/no-image.svg";
                  }}
                />
                <div className="flex-1">
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-gray-600">
                    Qty: {qty} × {formatMoney(unit)}
                  </p>
                </div>
                <p className="font-semibold">{formatMoney(unit * qty)}</p>
              </div>
            );
          })}

          <div className="mt-6 border-t pt-6">
            <label htmlFor="discount" className="block mb-2 font-medium">
              Discount code (applied during checkout)
            </label>
            <input
              id="discount"
              type="text"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
              placeholder="Enter code if you have one"
              className="w-full border px-3 py-2 rounded mb-4"
              disabled={loading}
            />

            {error && (
              <p className="mb-4 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <Button
              onClick={createCheckout}
              disabled={loading || !cartItems.length}
              className="w-full py-3 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition disabled:opacity-70"
            >
              {loading ? "Processing…" : "Proceed to Checkout"}
            </Button>

            <div className="mt-3 text-xs text-gray-500">
              Checkout will open in Shopify.
            </div>
          </div>
        </>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
