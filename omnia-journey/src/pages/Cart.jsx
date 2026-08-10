import React, { useEffect, useMemo, useState } from "react";
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
import { useSnoozer } from "@/Layout";
import { getSessionState, getShopperId } from "@/state/sessionStore";
import {
  refreshRewardsState,
  useRewardsState,
} from "@/state/rewardsStore";
import {
  ShowroomBrandMark,
  ShowroomEyebrow,
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

function safeImage(item) {
  return item?.imageUrl || item?.image || item?.image?.url || "/no-image.svg";
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

function attributeValue(attrs, keys) {
  const wanted = Array.isArray(keys) ? keys : [keys];
  const normalized = normalizeAttributes(attrs);
  const found = normalized.find((attr) => wanted.includes(attr.key));
  return found?.value || "";
}

function pickTechnicalAttributes(attrs) {
  const allow = new Set([
    "SnoozePod",
    "_SnoozePod",
    "Size",
    "Mattress",
    "_Mattress",
    "Base",
    "_Base",
    "Motion",
    "Dual Comfort",
    "Left Feel",
    "Right Feel",
    "Product",
    "_Product",
    "Option",
    "_Option",
    "Setup Size",
    "_Setup Size",
    "Variant Option",
    "_Variant Option",
    "Pillow Size",
    "Sleep Essential",
    "_Sleep Essential",
  ]);

  const order = [
    "SnoozePod",
    "_SnoozePod",
    "Size",
    "Setup Size",
    "_Setup Size",
    "Variant Option",
    "_Variant Option",
    "Mattress",
    "_Mattress",
    "Base",
    "_Base",
    "Motion",
    "Dual Comfort",
    "Left Feel",
    "Right Feel",
    "Product",
    "_Product",
    "Option",
    "_Option",
    "Pillow Size",
    "Sleep Essential",
    "_Sleep Essential",
  ];

  return normalizeAttributes(attrs)
    .filter((attr) => allow.has(attr.key))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

function cleanValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayAttributeKey(key) {
  return String(key || "").replace(/^_+/, "");
}

function cartLineConfiguration(item) {
  const attrs = normalizeAttributes(item?.attributes);
  const size = cleanValue(attributeValue(attrs, ["_Setup Size", "Setup Size", "Size"]));
  const variant = cleanValue(attributeValue(attrs, ["_Variant Option", "Variant Option"]));
  const base = cleanValue(attributeValue(attrs, ["_Base", "Base"]));
  const motion = cleanValue(attributeValue(attrs, "Motion"));
  const pillowSize = cleanValue(attributeValue(attrs, "Pillow Size"));
  const essential = cleanValue(
    attributeValue(attrs, ["_Sleep Essential", "Sleep Essential", "_Product", "Product", "_Option", "Option"])
  );
  const title = cleanValue(item?.title);
  const pieces = [];
  const baseLower = base.toLowerCase();
  const motionLower = motion.toLowerCase();
  const variantLower = variant.toLowerCase();

  if (baseLower.includes("adjustable")) {
    if (variantLower.includes("2pc") || variantLower.includes("2-piece")) {
      pieces.push(`${size || "King"} · 2-Piece Split Adjustable Setup`);
    } else if (motionLower.includes("full split")) {
      pieces.push(`${size || variant || "Split King"} · Full Split Setup`);
    } else {
      pieces.push(`${size || variant || "Selected size"} · Adjustable Base`);
    }
  } else if (variantLower.includes("split king")) {
    pieces.push(motionLower.includes("full split") ? "Split King · Full Split Setup" : "Split King");
  } else if (size) {
    pieces.push(size);
  } else if (variant) {
    pieces.push(variant);
  }

  if (pillowSize && !pieces.some((piece) => piece.toLowerCase().includes(pillowSize.toLowerCase()))) {
    pieces.push(pillowSize);
  }

  if (essential && !title.toLowerCase().includes(essential.toLowerCase())) {
    pieces.push(essential);
  }

  if (!pieces.length && base) pieces.push(base);
  if (!pieces.length && motion) pieces.push(motion);
  return pieces.filter(Boolean).join(" · ") || "Configured for your SnoozePod";
}

function mutationMessage(operation, checkoutLoading, cartSyncing) {
  if (checkoutLoading) return "Refreshing checkout...";
  if (cartSyncing) return "Syncing your SnoozePod...";
  if (operation === "clear") return "Clearing cart...";
  if (operation === "remove") return "Removing item...";
  if (operation === "update") return "Updating your SnoozePod...";
  if (operation) return "Updating your SnoozePod...";
  return "";
}

function itemKey(item, idx) {
  return (
    item.lineId ||
    item.id ||
    item.merchandiseId ||
    item.variantId ||
    `${item?.title || "item"}-${idx}`
  );
}

export default function Cart() {
  const location = useLocation();
  const device = useDeviceMode();
  const snoozer = useSnoozer();
  const rewards = useRewardsState();
  const cartItems = useStore((s) => s.cart || []);
  const updateCart = useStore((s) => s.updateCart);
  const removeFromCart = useStore((s) => s.removeFromCart);
  const clearCart = useStore((s) => s.clearCart);
  const prepareCheckoutCart = useStore((s) => s.prepareCheckoutCart);

  const cartId = useStore((s) => s.cartId || null);
  const checkoutUrl = useStore((s) => s.checkoutUrl || null);
  const recommendations = useStore((s) => s.recommendations);
  const syncCartFromShopify = useStore((s) => s.syncCartFromShopify);
  const cartMutationPending = useStore((s) => s.cartMutationPending);
  const cartMutationOperation = useStore((s) => s.cartMutationOperation);
  const cartError = useStore((s) => s.cartError);
  const clearCartError = useStore((s) => s.clearCartError);

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [cartSyncing, setCartSyncing] = useState(false);
  const [toast, setToast] = useState("");
  const [expandedLines, setExpandedLines] = useState({});
  const [confirmClear, setConfirmClear] = useState(false);

  const shopperId = getShopperId() || "guest";
  const checkoutAllowed = canInitiateCheckout(device);
  const checkoutUrlAllowed = canOpenCheckoutUrl(device);
  const podNavigationAllowed = canViewPodNavigation(device);
  const financingAllowed = canViewFinancing(device);
  const showCheckoutHandoff =
    shouldShowCheckoutLoungeHandoff(device) || Boolean(location.state?.checkoutHandoff);
  const busy = checkoutLoading || cartMutationPending;

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
      return acc + (Number.isFinite(unit) ? unit : 0) * (Number.isFinite(qty) ? qty : 1);
    }, 0);
  }, [cartItems]);

  const totalItems = useMemo(() => {
    return (Array.isArray(cartItems) ? cartItems : []).reduce((sum, item) => {
      const qty = Number(item.quantity ?? item.qty ?? 1);
      return sum + (Number.isFinite(qty) ? qty : 1);
    }, 0);
  }, [cartItems]);

  const activeMessage = mutationMessage(cartMutationOperation, checkoutLoading, cartSyncing);
  const rewardPoints = Number(rewards?.summary?.availableSleepPoints || 0);
  const rewardStatus =
    rewards.status === "ready"
      ? "Rewards available"
      : rewards.status === "loading"
        ? "Checking rewards..."
        : rewards.status === "error"
          ? "Rewards unavailable"
          : "Check rewards";

  useEffect(() => {
    let alive = true;
    setCartSyncing(true);

    syncCartFromShopify?.({ sourcePage: "cart-page" })
      .catch((err) => {
        console.warn("[cart] cart page restore failed", {
          operation: "cart_fetch",
          sourcePage: "cart-page",
          cartId,
          errorCode: err?.code || err?.name || err?.status || "CART_FETCH_FAILED",
        });
      })
      .finally(() => {
        if (alive) setCartSyncing(false);
      });

    return () => {
      alive = false;
    };
  }, [cartId, syncCartFromShopify]);

  useEffect(() => {
    if (shopperId && shopperId !== "guest") void refreshRewardsState();
  }, [shopperId]);

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

    setCheckoutLoading(true);
    setToast("");

    try {
      try {
        if (api?.ensureSession) await api.ensureSession();
      } catch {
        // Session creation is best-effort; checkout prep still owns the final contract.
      }

      const prepared = await prepareCheckoutCart?.({ sourcePage: "cart-page" });
      const newCheckoutUrl = prepared?.checkoutUrl || null;

      if (!newCheckoutUrl) {
        setToast("Checkout is temporarily unavailable. Please try again.");
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

      api
        .trackCRMEvent({
          shopperId,
          event: "cart_checkout",
          score: 25,
          context: { lineCount: prepared?.items?.length || cartItems.length },
        })
        .catch(() => {});

      window.location.assign(newCheckoutUrl);
    } catch (err) {
      console.error("Checkout failed:", err);
      setToast("Checkout is temporarily unavailable. Your cart is still saved. Please try again.");
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

  async function handleClearCart() {
    if (cartMutationPending) return;
    setToast("");
    clearCartError?.();
    try {
      await clearCart?.();
      setConfirmClear(false);
      setToast("Cart cleared.");
      api.trackCRMEvent({ shopperId, event: "cart_clear", score: 0 }).catch(() => {});
    } catch {
      setToast("We couldn't clear your cart. Your confirmed items are still here. Try again.");
    }
  }

  async function handleQuantity(id, nextQty) {
    if (busy) return;
    const next = Math.max(1, Number(nextQty) || 1);
    try {
      setToast("");
      await updateCart?.(id, next);
    } catch {
      setToast("We couldn't update that quantity. Shopify's confirmed quantity is still here.");
    }
  }

  async function handleRemove(id) {
    if (busy || !id) return;
    try {
      setToast("");
      await removeFromCart?.(id);
    } catch {
      setToast("We couldn't remove that item. Shopify's confirmed cart is still here.");
    }
  }

  return (
    <ShowroomPageShell className="pb-8">
      <ShowroomTopRail className="items-center">
        <ShowroomBrandMark />
        <span
          className={`inline-flex min-h-[44px] items-center rounded-full px-5 text-sm font-black ${
            cartItems.length
              ? "border border-emerald-100 bg-emerald-50 text-emerald-800"
              : "border border-slate-200 bg-white text-slate-600"
          }`}
        >
          {cartItems.length ? "Checkout ready" : "Cart empty"}
        </span>
      </ShowroomTopRail>

      <div className="mx-auto max-w-[1460px] px-4 pb-6 pt-2 md:px-6">
        <ShowroomFrame className="overflow-visible p-4 md:p-6">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
            <section className="min-w-0">
              <h1 className="text-[2.25rem] font-black tracking-tight text-slate-950 md:text-[3rem]">
                Review your SnoozePod before checkout.
              </h1>
              <p className="mt-2 max-w-3xl text-[1rem] leading-7 text-slate-600">
                Everything look good? You&apos;re one step away from better sleep.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2 rounded-[18px] border border-slate-200 bg-white/80 p-2 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
                {podNavigationAllowed ? (
                  <Link
                    to={continuePodRoute}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-[14px] px-4 text-sm font-black text-[#1A66D2] transition hover:bg-blue-50"
                  >
                    ← Back to SnoozePod
                  </Link>
                ) : null}
                {financingAllowed ? (
                  <Link
                    to="/financing"
                    className="inline-flex min-h-[44px] items-center justify-center rounded-[14px] px-4 text-sm font-black text-[#1A66D2] transition hover:bg-blue-50"
                  >
                    Financing
                  </Link>
                ) : null}
                {cartItems.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="ml-auto inline-flex min-h-[44px] items-center justify-center rounded-[14px] px-4 text-sm font-black text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                    disabled={busy}
                  >
                    Clear Cart
                  </button>
                ) : null}
              </div>

              {confirmClear ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-950">
                  <span>Clear every item from this Shopify cart?</span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="min-h-[44px] rounded-[14px] border border-red-200 bg-white px-4 font-black"
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleClearCart}
                      className="min-h-[44px] rounded-[14px] bg-red-600 px-4 font-black text-white"
                      disabled={busy}
                    >
                      Confirm Clear Cart
                    </button>
                  </span>
                </div>
              ) : null}

              {cartError ? (
                <div
                  role="alert"
                  className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950"
                >
                  <span>
                    {typeof cartError === "string"
                      ? cartError
                      : cartError?.message || "The cart could not be refreshed."}
                  </span>
                  <button
                    type="button"
                    className="min-h-[44px] rounded-[14px] border border-amber-300 bg-white px-4 font-black"
                    onClick={async () => {
                      clearCartError?.();
                      setCartSyncing(true);
                      try {
                        await syncCartFromShopify?.({ sourcePage: "cart-page-retry" });
                        setToast("Cart refreshed from Shopify.");
                      } catch {
                        setToast("Your cart could not be restored. Please try again.");
                      } finally {
                        setCartSyncing(false);
                      }
                    }}
                    disabled={cartMutationPending}
                  >
                    Retry
                  </button>
                </div>
              ) : null}

              {activeMessage ? (
                <div className="mt-4 rounded-[18px] border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-black text-blue-800">
                  {activeMessage}
                </div>
              ) : null}

              <div className="mt-5 space-y-3">
                {cartItems.length === 0 ? (
                  <ShowroomPanel className="p-7">
                    <div className="text-[1.35rem] font-black text-slate-950">
                      {cartSyncing ? "Checking your cart..." : "Your cart is empty."}
                    </div>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      {podNavigationAllowed
                        ? "Add your mattress, base, and sleep essentials from a pod, then come back here for checkout review."
                        : "A sleep specialist can help you add your showroom setup."}
                    </p>
                    {podNavigationAllowed ? (
                      <Link
                        to={continuePodRoute}
                        className="mt-5 inline-flex min-h-[48px] items-center rounded-[16px] bg-[#1A66D2] px-5 text-sm font-black text-white shadow-[0_18px_38px_rgba(26,102,210,0.22)] transition hover:bg-[#1550A0]"
                      >
                        Go to SnoozePod {continuePodId}
                      </Link>
                    ) : null}
                  </ShowroomPanel>
                ) : (
                  cartItems.map((item, idx) => {
                    const id = itemKey(item, idx);
                    const title = item.title || "Item";
                    const image = safeImage(item);
                    const qty = Number(item.quantity ?? item.qty ?? 1) || 1;
                    const unit = Number(item.unitPrice ?? item.price ?? 0) || 0;
                    const technical = pickTechnicalAttributes(item?.attributes);
                    const expanded = Boolean(expandedLines[id]);

                    return (
                      <ShowroomPanel key={id} className="p-3 md:p-4">
                        <div className="grid gap-4 md:grid-cols-[120px_minmax(0,1fr)_160px_170px] md:items-center">
                          <img
                            src={image}
                            alt={title}
                            className="h-[104px] w-[120px] rounded-[18px] border border-slate-200 bg-white object-cover"
                            onError={(e) => {
                              e.currentTarget.src = "/no-image.svg";
                            }}
                          />

                          <div className="min-w-0">
                            <h2 className="text-[1.15rem] font-black leading-tight text-slate-950 md:text-[1.25rem]">
                              {title}
                            </h2>
                            <p className="mt-1 text-sm font-semibold leading-5 text-slate-600">
                              {cartLineConfiguration(item)}
                            </p>
                            {technical.length ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedLines((prev) => ({ ...prev, [id]: !prev[id] }))
                                }
                                className="mt-2 min-h-[36px] rounded-full text-sm font-black text-[#1A66D2]"
                              >
                                {expanded ? "Hide details" : "View details"}
                              </button>
                            ) : null}
                          </div>

                          <div className="text-left md:text-right">
                            <div className="text-[0.72rem] font-black uppercase tracking-[0.16em] text-slate-400">
                              Line Price
                            </div>
                            <div className="mt-1 text-xl font-black text-slate-950">
                              {formatMoney(unit * qty)}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 md:justify-end">
                            <div className="inline-flex min-h-[48px] items-center overflow-hidden rounded-[16px] border border-slate-200 bg-white">
                              <button
                                type="button"
                                onClick={() => handleQuantity(id, qty - 1)}
                                className="min-h-[48px] min-w-[48px] text-xl font-black text-slate-700 disabled:opacity-40"
                                disabled={busy || qty <= 1}
                                aria-label={`Decrease ${title} quantity`}
                              >
                                −
                              </button>
                              <span className="min-w-[42px] text-center text-base font-black text-slate-950">
                                {qty}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleQuantity(id, qty + 1)}
                                className="min-h-[48px] min-w-[48px] text-xl font-black text-slate-700 disabled:opacity-40"
                                disabled={busy}
                                aria-label={`Increase ${title} quantity`}
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemove(id)}
                              className="min-h-[44px] rounded-[14px] px-3 text-sm font-black text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                              disabled={busy}
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        {expanded && technical.length ? (
                          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                            {technical.map((attr) => (
                              <span
                                key={`${id}-${attr.key}-${attr.value}`}
                                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                              >
                                {displayAttributeKey(attr.key)}: {attr.value}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </ShowroomPanel>
                    );
                  })
                )}
              </div>
            </section>

            <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
              <ShowroomPanel className="p-5 md:p-6">
                <ShowroomEyebrow>Your Total</ShowroomEyebrow>
                <div className="mt-2 text-[2.1rem] font-black tracking-tight text-slate-950">
                  {formatMoney(total)}
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  {totalItems} {totalItems === 1 ? "item" : "items"}
                </p>

                <div className="mt-5 rounded-[20px] border border-violet-100 bg-violet-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">
                        Rewards
                      </div>
                      <div className="mt-1 text-lg font-black text-violet-800">
                        {rewardPoints} Sleep Points
                      </div>
                      <p className="mt-1 text-xs font-semibold text-violet-700">{rewardStatus}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => snoozer?.openRewards?.()}
                      className="min-h-[44px] rounded-[14px] border border-violet-200 bg-white px-4 text-sm font-black text-violet-800"
                    >
                      View Rewards
                    </button>
                  </div>
                </div>

                {financingAllowed ? (
                  <Link
                    to="/financing"
                    className="mt-4 flex min-h-[68px] items-center justify-between rounded-[20px] border border-blue-100 bg-blue-50 px-4 text-sm font-black text-slate-900"
                  >
                    <span>
                      Flexible financing available
                      <span className="mt-1 block text-xs font-semibold text-slate-600">
                        Review available payment options.
                      </span>
                    </span>
                    <span className="text-xl text-[#1A66D2]">›</span>
                  </Link>
                ) : null}

                <div className="mt-5 space-y-3 border-t border-slate-200 pt-4">
                  <div className="flex justify-between gap-3 text-sm text-slate-600">
                    <span>Subtotal</span>
                    <span className="font-black text-slate-950">{formatMoney(total)}</span>
                  </div>
                  <div className="flex justify-between gap-3 text-sm text-slate-600">
                    <span>Shipping</span>
                    <span className="font-semibold">Calculated at checkout</span>
                  </div>
                  <div className="flex items-end justify-between gap-3 border-t border-slate-200 pt-4">
                    <span className="text-lg font-black text-slate-950">Total</span>
                    <span className="text-right">
                      <span className="mr-2 text-xs font-black uppercase text-slate-500">USD</span>
                      <span className="text-[1.8rem] font-black text-slate-950">
                        {formatMoney(total)}
                      </span>
                    </span>
                  </div>
                </div>

                {showCheckoutHandoff ? (
                  <div className="mt-5 rounded-[20px] border border-[#d7e3ff] bg-[#f7faff] p-4">
                    <div className="text-[0.72rem] font-black uppercase tracking-[0.18em] text-[#2f57e8]">
                      Continue at the Checkout Lounge
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                      {CHECKOUT_LOUNGE_MESSAGE}
                    </p>
                    <div className="mt-3 rounded-[16px] border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
                        Snooze Code
                      </div>
                      <div className="mt-1 text-sm font-black text-slate-900">
                        {displaySnoozeCode || "Not checked in yet"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleCheckout}
                    disabled={busy || !cartItems.length}
                    className="mt-5 inline-flex min-h-[58px] w-full items-center justify-center rounded-[18px] bg-[#1A66D2] px-6 text-base font-black text-white shadow-[0_18px_38px_rgba(26,102,210,0.22)] transition hover:bg-[#1550A0] disabled:opacity-60"
                  >
                    {checkoutLoading ? "Refreshing checkout..." : "Continue to Checkout"}
                  </button>
                )}

                <div className="mt-4 text-center text-sm font-semibold text-slate-500">
                  Secure checkout powered by Shopify
                </div>

                {bestCheckoutUrl && checkoutUrlAllowed ? (
                  <a
                    href={bestCheckoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-[14px] border border-slate-200 bg-white text-sm font-black text-slate-700"
                  >
                    Open current checkout link
                  </a>
                ) : null}
              </ShowroomPanel>

              <ShowroomPanel className="flex items-center gap-3 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xl">
                  💤
                </div>
                <div>
                  <div className="font-black text-slate-950">Give everything one last look.</div>
                  <p className="mt-1 text-sm leading-5 text-slate-600">
                    Snoozer is here if you need anything before checkout.
                  </p>
                </div>
              </ShowroomPanel>
            </aside>
          </div>
        </ShowroomFrame>

        {toast ? (
          <div
            role="status"
            className="fixed bottom-4 right-4 z-[80] max-w-sm rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
          >
            {toast}
          </div>
        ) : null}
      </div>
    </ShowroomPageShell>
  );
}
