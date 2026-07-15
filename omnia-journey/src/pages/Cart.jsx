import React, { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import {
  CHECKOUT_LOUNGE_MESSAGE,
  canInitiateCheckout,
  canOpenCheckoutUrl,
  canViewFinancing,
  canViewPodNavigation,
  shouldShowCheckoutLoungeHandoff,
} from "@/device/deviceActionGuards";
import { getPodNumber, makePodRoute, normalizePodId } from "@/device/podRouteUtils";
import { useDeviceMode } from "@/device/useDeviceMode";
import { useStore } from "@/lib/useStore";
import { getSessionState, getShopperId } from "@/state/sessionStore";
import {
  ShowroomBrandMark,
  ShowroomCartBadge,
  ShowroomEyebrow,
  ShowroomFooterAction,
  ShowroomFrame,
  ShowroomPageShell,
  ShowroomPanel,
  ShowroomTopRail,
} from "@/components/showroom/ShowroomPrimitives";

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
  const normalized = normalizePodId(v);
  if (normalized) return getPodNumber(normalized) || "1";
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
  const location = useLocation();
  const device = useDeviceMode();
  const cartItems = useStore((s) => s.cart || []);
  const updateCart = useStore((s) => s.updateCart);
  const removeFromCart = useStore((s) => s.removeFromCart);
  const clearCart = useStore((s) => s.clearCart);

  const cartId = useStore((s) => s.cartId || null);
  const checkoutUrl = useStore((s) => s.checkoutUrl || null);
  const recommendations = useStore((s) => s.recommendations);
  const setCartMeta = useStore((s) => s.setCartMeta);
  const clearCartMeta = useStore((s) => s.clearCartMeta);

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [toast, setToast] = useState("");

  const shopperId = getShopperId() || "guest";
  const checkoutAllowed = canInitiateCheckout(device);
  const checkoutUrlAllowed = canOpenCheckoutUrl(device);
  const podNavigationAllowed = canViewPodNavigation(device);
  const financingAllowed = canViewFinancing(device);
  const showCheckoutHandoff =
    shouldShowCheckoutLoungeHandoff(device) || Boolean(location.state?.checkoutHandoff);

  const displaySnoozeCode = useMemo(() => {
    const stored =
      safeGet("snoozeCode") ||
      safeGet("snoozer_snooze_code") ||
      safeGet("snoozer_access_code") ||
      safeGet("snoozer_shopper_id");
    if (stored) return stored;
    return shopperId && shopperId !== "guest" ? shopperId : "";
  }, [shopperId]);

  const continuePodId = useMemo(() => {
    const parsed =
      recommendations && typeof recommendations === "object"
        ? recommendations
        : safeParseJson(safeGet("snooze.recommendations"));
    const pods = Array.isArray(parsed?.pods) ? parsed.pods : [];
    const first = pods[0] || null;
    return first ? toPodId(first.podId ?? first.id) : "1";
  }, [recommendations]);
  const continuePodRoute = useMemo(
    () => makePodRoute(continuePodId) || "/pod/pod-1",
    [continuePodId]
  );

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

  const totalItems = useMemo(() => {
    return (Array.isArray(cartItems) ? cartItems : []).reduce((sum, item) => {
      const qty = Number(item.quantity ?? item.qty ?? 1);
      return sum + (Number.isFinite(qty) ? qty : 1);
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

    if (!checkoutAllowed) {
      setToast(CHECKOUT_LOUNGE_MESSAGE);
      return;
    }

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
    <ShowroomPageShell className="pb-8">
      <ShowroomTopRail className="items-center">
        <ShowroomBrandMark />
        <ShowroomCartBadge count={totalItems} quiet />
      </ShowroomTopRail>

      <div className="mx-auto max-w-[1380px] px-4 pb-6 pt-2 md:px-6">
        <ShowroomFrame className="overflow-hidden p-4 md:p-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_340px]">
            <div className="min-w-0">
              <ShowroomEyebrow>Your SnoozePod</ShowroomEyebrow>
              <h1 className="mt-2 text-[2.1rem] font-black tracking-tight text-slate-900 md:text-[2.8rem]">
                Review your setup before checkout.
              </h1>
              <p className="mt-2 max-w-2xl text-[0.95rem] leading-6 text-slate-600 md:text-[1rem]">
                Keep what you want, adjust quantities, then head to checkout when you&apos;re ready.
              </p>

              <div className="mt-4 flex flex-wrap gap-2.5">
                {podNavigationAllowed ? (
                  <>
                    <Link
                      to={continuePodRoute}
                      className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50"
                    >
                      Continue Testing
                    </Link>
                    <Link
                      to={continuePodRoute}
                      className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50"
                    >
                      View Assigned Pod
                    </Link>
                  </>
                ) : null}
                {bestCheckoutUrl && checkoutUrlAllowed ? (
                  <a
                    href={bestCheckoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50"
                  >
                    Open Checkout
                  </a>
                ) : null}
                {financingAllowed ? (
                  <Link
                    to="/financing"
                    className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50"
                  >
                    Financing
                  </Link>
                ) : null}
                {cartItems.length > 0 ? (
                  <button
                    onClick={handleClearCart}
                    className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                    disabled={checkoutLoading}
                  >
                    Clear Cart
                  </button>
                ) : null}
              </div>

              <div className="mt-4 space-y-3">
                {cartItems.length === 0 ? (
                  <ShowroomPanel className="p-6">
                    <div className="text-[1.2rem] font-black text-slate-900">Your cart is empty.</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {podNavigationAllowed
                        ? "Add a mattress or base from a pod to see it here."
                        : "A sleep specialist can help you add your showroom setup."}
                    </p>
                    {podNavigationAllowed ? (
                      <div className="mt-4">
                        <Link
                          to={continuePodRoute}
                          className="inline-flex rounded-[18px] bg-[#1A66D2] px-5 py-3 text-sm font-black text-white shadow-[0_18px_38px_rgba(26,102,210,0.22)] transition hover:bg-[#1550A0]"
                        >
                          Go to SnoozePod {continuePodId}
                        </Link>
                      </div>
                    ) : null}
                  </ShowroomPanel>
                ) : (
                  cartItems.map((item, idx) => {
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
                      <ShowroomPanel key={id} className="p-4 md:p-5">
                        <div className="flex flex-col gap-4 md:flex-row">
                          <img
                            src={image}
                            alt={title}
                            className="h-24 w-24 rounded-[22px] border border-slate-200 bg-white object-cover"
                            onError={(e) => {
                              e.currentTarget.src = "/no-image.svg";
                            }}
                          />

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h2 className="truncate text-[1.15rem] font-black text-slate-900 md:text-[1.25rem]">
                                  {title}
                                </h2>
                                <p className="mt-1 text-sm font-semibold text-slate-500">
                                  {formatMoney(unit)} each
                                </p>
                              </div>

                              <div className="text-right text-lg font-black text-slate-900">
                                {formatMoney(unit * qty)}
                              </div>
                            </div>

                            {attrs.length ? (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {attrs.map((a) => (
                                  <span
                                    key={`${a.key}-${a.value}`}
                                    className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                                  >
                                    {a.key}: {a.value}
                                  </span>
                                ))}
                              </div>
                            ) : null}

                            <div className="mt-4 flex flex-wrap items-center gap-3">
                              <label className="text-sm font-semibold text-slate-500">Qty</label>
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
                                className="h-10 w-20 rounded-[14px] border border-slate-200 bg-white px-3 text-sm font-semibold"
                                disabled={checkoutLoading}
                              />

                              <button
                                onClick={() => id && removeFromCart?.(id)}
                                className="text-sm font-extrabold text-red-700 transition hover:text-red-800 hover:underline"
                                disabled={checkoutLoading}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      </ShowroomPanel>
                    );
                  })
                )}
              </div>
            </div>

            <div className="space-y-3">
              <ShowroomPanel className="p-5">
                <ShowroomEyebrow>Order Summary</ShowroomEyebrow>
                <div className="mt-2 text-[1.55rem] font-black tracking-tight text-slate-900">
                  {formatMoney(total)}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {checkoutAllowed
                    ? "Final review before you move into checkout."
                    : "Your setup is saved for the Checkout Lounge."}
                </p>

                <div className="mt-4 grid gap-2">
                  <div className="rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
                      Items
                    </div>
                    <div className="mt-1 text-base font-black text-slate-900">{totalItems}</div>
                  </div>
                  <div className="rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
                      Checkout
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-600">
                      {checkoutAllowed
                        ? "You'll continue using the existing checkout flow."
                        : "Continue at the Checkout Lounge to complete checkout."}
                    </div>
                  </div>
                </div>

                {showCheckoutHandoff ? (
                  <div className="mt-5 rounded-[22px] border border-[#d7e3ff] bg-[#f7faff] p-4">
                    <div className="text-[0.72rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
                      Continue at the Checkout Lounge
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                      {CHECKOUT_LOUNGE_MESSAGE}
                    </p>
                    <div className="mt-3 grid gap-2">
                      <div className="rounded-[16px] border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
                          Snooze Code
                        </div>
                        <div className="mt-1 text-sm font-black text-slate-900">
                          {displaySnoozeCode || "Not checked in yet"}
                        </div>
                      </div>
                      <div className="rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-600">
                        Cart ID, checkout URL, Snooze Code, and session identity stay preserved.
                      </div>
                      <div className="rounded-[16px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-900">
                        QR continuation is not wired in this app yet. A sleep specialist can help you
                        continue at the Checkout Lounge.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setToast("A sleep specialist can help you continue at the Checkout Lounge.")
                      }
                      className="mt-4 inline-flex w-full items-center justify-center rounded-[18px] border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-50"
                    >
                      Talk to Human
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleCheckout}
                    disabled={checkoutLoading || !cartItems.length}
                    className="mt-5 inline-flex w-full items-center justify-center rounded-[18px] bg-[#1A66D2] px-6 py-3.5 text-base font-black text-white transition hover:bg-[#1550A0] disabled:opacity-60"
                  >
                    {checkoutLoading ? "Processing..." : "Checkout"}
                  </button>
                )}
              </ShowroomPanel>

              {podNavigationAllowed ? (
                <ShowroomFooterAction
                  label="Back to SnoozePod"
                  onClick={() => {
                    window.location.assign(continuePodRoute);
                  }}
                />
              ) : null}
            </div>
          </div>
        </ShowroomFrame>

        {toast ? (
          <div
            role="status"
            className="fixed bottom-4 right-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
          >
            {toast}
          </div>
        ) : null}
      </div>
    </ShowroomPageShell>
  );
}
