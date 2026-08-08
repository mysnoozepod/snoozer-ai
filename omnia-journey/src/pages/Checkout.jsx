import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CHECKOUT_LOUNGE_MESSAGE, canInitiateCheckout } from "@/device/deviceActionGuards";
import { useDeviceMode } from "@/device/useDeviceMode";
import { api } from "@/lib/api";
import { useStore } from "@/lib/useStore";
import { getShopperId } from "@/state/sessionStore";

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

function safeImage(item) {
  return item?.imageUrl || item?.image || item?.image?.url || "/no-image.svg";
}

export default function Checkout() {
  useParams(); // Route compatibility for /checkout/:id.
  const device = useDeviceMode();
  const checkoutAllowed = canInitiateCheckout(device);
  const cartItems = useStore((state) => state.cart || []);
  const cartId = useStore((state) => state.cartId || null);
  const syncCartFromShopify = useStore((state) => state.syncCartFromShopify);
  const prepareCheckoutCart = useStore((state) => state.prepareCheckoutCart);
  const cartMutationPending = useStore((state) => state.cartMutationPending);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const shopperId = getShopperId() || "guest";

  const total = useMemo(
    () =>
      cartItems.reduce((sum, item) => {
        const unit = Number(item.unitPrice ?? item.price ?? 0);
        const quantity = Number(item.quantity ?? item.qty ?? 1);
        return sum + (Number.isFinite(unit) ? unit : 0) * (Number.isFinite(quantity) ? quantity : 1);
      }, 0),
    [cartItems]
  );

  useEffect(() => {
    syncCartFromShopify?.({ sourcePage: "checkout-lounge" }).catch((err) => {
      console.warn("[cart]", {
        operation: "cart_fetch",
        sourcePage: "checkout-lounge",
        cartIdPresent: Boolean(cartId),
        errorCode: err?.code || err?.name || err?.status || "CART_FETCH_FAILED",
      });
    });
  }, [cartId, syncCartFromShopify]);

  async function createCheckout() {
    if (loading || cartMutationPending) return;
    setError("");

    if (!checkoutAllowed) {
      setError(CHECKOUT_LOUNGE_MESSAGE);
      return;
    }
    if (!cartItems.length) {
      setError("Your cart is empty.");
      return;
    }

    setLoading(true);
    try {
      try {
        await api.ensureSession?.();
      } catch {
        // Session correlation is best effort; Shopify still owns checkout truth.
      }

      const prepared = await prepareCheckoutCart?.({ sourcePage: "checkout-lounge" });
      if (!prepared?.checkoutUrl) {
        throw Object.assign(new Error("Checkout URL unavailable."), {
          code: "CHECKOUT_URL_MISSING",
        });
      }

      api
        .trackCRMEvent({
          shopperId,
          event: "checkout",
          score: 25,
          context: { lineCount: prepared.items?.length || cartItems.length },
        })
        .catch(() => {});

      window.location.assign(prepared.checkoutUrl);
    } catch (err) {
      console.warn("[cart]", {
        operation: "checkout_prepare",
        sourcePage: "checkout-lounge",
        errorCode: err?.code || err?.name || err?.status || "CHECKOUT_PREPARE_FAILED",
      });
      setError("Checkout is temporarily unavailable. Please try again.");
      api
        .trackCRMEvent({
          shopperId,
          event: "checkout_error",
          score: -10,
          context: { reason: err?.code || "checkout_prepare_failed" },
        })
        .catch(() => {});
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow">
      <h1 className="mb-2 text-2xl font-bold">Review Your Cart</h1>
      <p className="mb-6 text-sm text-gray-600">Total: {formatMoney(total)}</p>

      {!checkoutAllowed ? (
        <div className="mb-6 rounded-2xl border border-[#d7e3ff] bg-[#f7faff] p-4 text-sm font-semibold leading-6 text-slate-700">
          {CHECKOUT_LOUNGE_MESSAGE}
        </div>
      ) : null}

      {!cartItems.length ? (
        <p className="text-gray-500">Your cart is empty.</p>
      ) : (
        <>
          {cartItems.map((item, index) => {
            const key = item.lineId || item.id || `${item.title || "item"}-${index}`;
            const title = item.title || "Untitled";
            const quantity = Number(item.quantity ?? item.qty ?? 1) || 1;
            const unit = Number(item.unitPrice ?? item.price ?? 0) || 0;
            return (
              <div key={key} className="mb-4 flex items-center border-b pb-4">
                <img
                  src={safeImage(item)}
                  alt={title}
                  className="mr-4 h-16 w-16 rounded object-cover"
                  onError={(event) => {
                    event.currentTarget.src = "/no-image.svg";
                  }}
                />
                <div className="flex-1">
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-gray-600">
                    Qty: {quantity} x {formatMoney(unit)}
                  </p>
                </div>
                <p className="font-semibold">{formatMoney(unit * quantity)}</p>
              </div>
            );
          })}

          <div className="mt-6 border-t pt-6">
            <p className="mb-4 text-sm text-gray-600">
              Discount codes can be entered securely in Shopify checkout.
            </p>
            {error ? (
              <p className="mb-4 text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <Button
              onClick={createCheckout}
              disabled={loading || cartMutationPending || !checkoutAllowed}
              className="w-full rounded-lg bg-indigo-600 py-3 text-white transition hover:bg-indigo-700 disabled:opacity-70"
            >
              {loading || cartMutationPending ? "Processing..." : "Proceed to Checkout"}
            </Button>
            <div className="mt-3 text-xs text-gray-500">Checkout will open in Shopify.</div>
          </div>
        </>
      )}
    </div>
  );
}
