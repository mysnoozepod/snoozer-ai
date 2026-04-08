import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useStore } from "@/lib/useStore";
import { getSessionState, setCartIdentity } from "@/state/sessionStore";

function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function toPodId(v) {
  const s = String(v ?? "").trim();
  return s || "1";
}

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
  const r = res || {};
  return r.cart || r.data?.cart || (r.id && r.lines ? r : null) || null;
}

function normalizeServerLines(cartObj) {
  const edges =
    cartObj?.lines?.edges ||
    cartObj?.lines ||
    cartObj?.data?.lines?.edges ||
    [];
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

function normalizeAttributes(attrs) {
  if (!Array.isArray(attrs)) return [];
  return attrs
    .map((a) => ({
      key: String(a?.key || "").trim(),
      value: String(a?.value || "").trim(),
    }))
    .filter((a) => a.key && a.value);
}

function pickKeyAttributes(attrs) {
  const allow = new Set([
    "Size",
    "Mattress",
    "Base",
    "Motion",
    "Dual Comfort",
    "Left Feel",
    "Right Feel",
    "SnoozePod",
  ]);

  const list = normalizeAttributes(attrs).filter((a) => allow.has(a.key));

  const order = [
    "SnoozePod",
    "Size",
    "Mattress",
    "Base",
    "Motion",
    "Dual Comfort",
    "Left Feel",
    "Right Feel",
  ];

  list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return list;
}

export default function Cart() {
  const cartItems = useStore((s) => s.cart || []);
  const updateCart = useStore((s) => s.updateCart);
  const removeFromCart = useStore((s) => s.removeFromCart);
  const clearCart = useStore((s) => s.clearCart);

  const cartId = useStore((s) => s.cartId || null);
  const checkoutUrl = useStore((s) => s.checkoutUrl || null);
  const setCartMeta = useStore((s) => s.setCartMeta);
  const clearCartMeta = useStore((s) => s.clearCartMeta);

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [toast, setToast] = useState("");

  const shopperId = (() => {
    try {
      return sessionStorage.getItem("snooze.accessCode") || "guest";
    } catch {
      return "guest";
    }
  })();

  const continuePodId = useMemo(() => {
    const raw = safeGet("snooze.recommendations");
    const parsed = raw ? safeParseJson(raw) : null;
    const pods = Array.isArray(parsed?.pods) ? parsed.pods : [];
    const first = pods[0] || null;
    return first ? toPodId(first.podId ?? first.id) : "1";
  }, []);

  const bestCheckoutUrl = useMemo(() => {
    const legacy = getSessionState?.() || {};
    return checkoutUrl || legacy?.checkoutUrl || null;
  }, [checkoutUrl]);

  const total = useMemo(() => {
    return (Array.isArray(cartItems) ? cartItems : []).reduce((acc, item) => {
      const unit = Number(item.unitPrice ?? item.price ?? 0);
      const qty = Number(item.quantity ?? item.qty ?? 1);
      return (
        acc +
        (Number.isFinite(unit) ? unit : 0) * (Number.isFinite(qty) ? qty : 1)
      );
    }, 0);
  }, [cartItems]);

  const cartLines = useMemo(() => {
    return (Array.isArray(cartItems) ? cartItems : [])
      .map((item) => {
        const gid = toVariantGid(item.merchandiseId || item.variantId || item.id);
        const quantity = Math.max(1, Number(item.quantity ?? item.qty ?? 1) || 1);
        if (!gid) return null;
        return { merchandiseId: gid, quantity };
      })
      .filter(Boolean);
  }, [cartItems]);

  const localDigest = useMemo(() => digestLines(cartLines), [cartLines]);

  async function handleCheckout() {
    if (checkoutLoading) return;

    if (!cartItems.length) {
      setToast("Your cart is empty.");
      return;
    }

    if (!cartLines.length) {
      setToast("Valid variant IDs not found.");
      api
        .trackCRMEvent({
          shopperId,
          event: "cart_checkout_error",
          score: -10,
          context: { reason: "no_valid_lines" },
        })
        .catch(() => {});
      return;
    }

    setCheckoutLoading(true);
    setToast("");

    try {
      try {
        if (api?.ensureSession) await api.ensureSession();
      } catch {
        // ignore
      }

      const legacy = getSessionState?.() || {};
      const bestCartId = cartId || legacy?.cartId || null;
      const bestUrl = checkoutUrl || legacy?.checkoutUrl || null;

      if (bestCartId && bestUrl) {
        try {
          const serverRes = await api.getCart(bestCartId);
          const cartObj = extractCartFromGetCartResponse(serverRes);
          const serverLines = normalizeServerLines(cartObj);
          const serverDigest = digestLines(serverLines);

          if (serverDigest && serverDigest === localDigest) {
            setCartMeta?.({ cartId: bestCartId, checkoutUrl: bestUrl });
            setCartIdentity?.({ cartId: bestCartId, checkoutUrl: bestUrl });

            api
              .trackCRMEvent({
                shopperId,
                event: "cart_checkout_reuse_url",
                score: 10,
                context: { lineCount: cartLines.length },
              })
              .catch(() => {});

            window.location.assign(bestUrl);
            return;
          }
        } catch {
          // fall through
        }
      }

      const res = await api.createCart({ lines: cartLines });

      const cartObj = res?.cart || res?.data?.cart || null;
      const newCartId = res?.cartId || res?.id || cartObj?.id || null;
      const newCheckoutUrl = res?.checkoutUrl || cartObj?.checkoutUrl || null;

      if (!newCheckoutUrl) {
        setToast("Checkout is unavailable.");
        api
          .trackCRMEvent({
            shopperId,
            event: "cart_checkout_error",
            score: -10,
            context: { reason: "missing_checkout_url" },
          })
          .catch(() => {});
        return;
      }

      setCartMeta?.({ cartId: newCartId, checkoutUrl: newCheckoutUrl });
      setCartIdentity?.({ cartId: newCartId, checkoutUrl: newCheckoutUrl });

      api
        .trackCRMEvent({
          shopperId,
          event: "cart_checkout",
          score: 25,
          context: { lineCount: cartLines.length },
        })
        .catch(() => {});

      window.location.assign(newCheckoutUrl);
    } catch (err) {
      console.error("Checkout failed:", err);
      setToast(err?.message || "Checkout failed.");
      api
        .trackCRMEvent({
          shopperId,
          event: "cart_checkout_error",
          score: -10,
          context: { reason: "exception", message: err?.message || String(err) },
        })
        .catch(() => {});
    } finally {
      setCheckoutLoading(false);
    }
  }

  function handleClearCart() {
    clearCart?.();
    clearCartMeta?.();
    setCartIdentity?.({ cartId: null, checkoutUrl: null });

    setToast("Cart cleared.");
    api
      .trackCRMEvent({
        shopperId,
        event: "cart_clear",
        score: 0,
      })
      .catch(() => {});
  }

  return (
    <section className="min-h-screen bg-gradient-to-b from-[#E8ECF5] to-white py-8">
      <div className="mx-auto max-w-4xl px-4">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
            Cart
          </h1>

          <div className="flex items-center gap-3">
            <Link
              to={`/pod/${encodeURIComponent(continuePodId)}`}
              className="text-sm font-semibold text-indigo-700 underline hover:text-indigo-900"
            >
              Continue Testing
            </Link>

            <Link
              to="/snoozepod"
              className="text-sm font-semibold text-indigo-700 underline hover:text-indigo-900"
            >
              View SnoozePod
            </Link>

            {bestCheckoutUrl ? (
              <a
                href={bestCheckoutUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-indigo-700 underline hover:text-indigo-900"
              >
                Open Checkout
              </a>
            ) : null}

            {cartItems.length > 0 ? (
              <button
                onClick={handleClearCart}
                className="text-sm font-semibold text-gray-600 underline hover:text-gray-900"
                disabled={checkoutLoading}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          {cartItems.length === 0 ? (
            <p className="text-gray-600">Your cart is empty.</p>
          ) : (
            <div>
              <div className="space-y-4">
                {cartItems.map((item, idx) => {
                  const id =
                    item.merchandiseId ||
                    item.variantId ||
                    item.id ||
                    `${item?.title || "item"}-${idx}`;

                  const title = item.title || "Item";
                  const image = safeImage(item);
                  const qty = Number(item.quantity ?? item.qty ?? 1) || 1;
                  const unit = Number(item.unitPrice ?? item.price ?? 0) || 0;
                  const attrs = pickKeyAttributes(item?.attributes);

                  return (
                    <div
                      key={id}
                      className="flex gap-4 rounded-2xl border bg-gray-50 p-4"
                    >
                      <img
                        src={image}
                        alt={title}
                        className="h-20 w-20 rounded-xl border bg-white object-cover"
                        onError={(e) => {
                          e.currentTarget.src = "/no-image.svg";
                        }}
                      />

                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-lg font-extrabold text-gray-900">
                          {title}
                        </h2>
                        <p className="text-sm text-gray-600">
                          {formatMoney(unit)} each
                        </p>

                        {attrs.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {attrs.map((a) => (
                              <span
                                key={`${a.key}-${a.value}`}
                                className="inline-flex items-center rounded-full border bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700"
                              >
                                {a.key}: {a.value}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        <div className="mt-3 flex items-center gap-3">
                          <label className="text-sm text-gray-600">Qty</label>
                          <input
                            type="number"
                            min={1}
                            value={qty}
                            onChange={(e) => {
                              const next = Math.max(1, Number(e.target.value) || 1);
                              try {
                                updateCart?.(id, next);
                              } catch {
                                // no-op
                              }
                            }}
                            className="h-10 w-20 rounded-xl border bg-white px-2 text-sm"
                            disabled={checkoutLoading}
                          />

                          <button
                            onClick={() => id && removeFromCart?.(id)}
                            className="text-sm font-semibold text-red-700 hover:underline"
                            disabled={checkoutLoading}
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="text-right font-extrabold text-gray-900">
                        {formatMoney(unit * qty)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex items-center justify-between">
                <div className="text-sm text-gray-600">Final review.</div>
                <div className="text-xl font-extrabold text-gray-900">
                  Total: {formatMoney(total)}
                </div>
              </div>

              <div className="mt-5">
                <button
                  onClick={handleCheckout}
                  disabled={checkoutLoading || !cartItems.length}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-6 py-3 font-extrabold text-white transition hover:bg-indigo-700 disabled:opacity-60 md:w-auto"
                >
                  {checkoutLoading ? "Processing..." : "Checkout"}
                </button>
              </div>
            </div>
          )}
        </div>

        {toast ? (
          <div
            role="status"
            className="fixed bottom-4 right-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
          >
            {toast}
          </div>
        ) : null}
      </div>
    </section>
  );
}