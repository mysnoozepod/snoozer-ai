import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import {
  CHECKOUT_LOUNGE_MESSAGE,
  canInitiateCheckout,
  canViewFinancing,
  canViewPodNavigation,
  shouldShowCheckoutLoungeHandoff,
} from "@/device/deviceActionGuards";
import { emitDeviceHumanHelp } from "@/device/deviceActivityTracker";
import { getPodNumber, makePodRoute, normalizePodId } from "@/device/podRouteUtils";
import { useDeviceMode } from "@/device/useDeviceMode";
import { useStore } from "@/lib/useStore";
import { useSnoozer } from "@/Layout";
import { getShopperId } from "@/state/sessionStore";
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

function safeSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Session storage is a convenience; cart truth remains in Shopify.
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
  const raw = String(v ?? "").trim();
  const normalized = normalizePodId(raw);
  if (normalized) return getPodNumber(normalized);
  const podMatch = raw.match(/\bpod[-\s]*([1-5])\b/i);
  if (podMatch) return podMatch[1];
  const snoozePodMatch = raw.match(/\bsnoozepod\s*([1-5])\b/i);
  return snoozePodMatch?.[1] || null;
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

function pickShopperAttributes(attrs) {
  const allow = new Set([
    "Size",
    "Base",
    "Motion",
    "Dual Comfort",
    "Left Feel",
    "Right Feel",
    "Setup Size",
    "Variant Option",
    "Pillow Size",
    "Sleep Essential",
  ]);

  const order = [
    "Size",
    "Setup Size",
    "Variant Option",
    "Base",
    "Motion",
    "Dual Comfort",
    "Left Feel",
    "Right Feel",
    "Pillow Size",
    "Sleep Essential",
  ];

  return normalizeAttributes(attrs)
    .filter((attr) => !attr.key.startsWith("_") && allow.has(attr.key))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

function cleanValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
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

function originatingPodFromCart(items) {
  for (const item of Array.isArray(items) ? items : []) {
    const value = attributeValue(item?.attributes, ["_SnoozePod", "SnoozePod"]);
    const podId = toPodId(value);
    if (podId) return podId;
  }
  return null;
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
  const recommendations = useStore((s) => s.recommendations);
  const syncCartFromShopify = useStore((s) => s.syncCartFromShopify);
  const cartMutationPending = useStore((s) => s.cartMutationPending);
  const cartMutationOperation = useStore((s) => s.cartMutationOperation);
  const cartError = useStore((s) => s.cartError);
  const clearCartError = useStore((s) => s.clearCartError);

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [cartSyncing, setCartSyncing] = useState(false);
  const [toast, setToast] = useState("");
  const [checkoutFailed, setCheckoutFailed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const checkoutLockRef = useRef(false);

  const shopperId = getShopperId() || "guest";
  const checkoutAllowed = canInitiateCheckout(device);
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
    const locationPodId = toPodId(location.state?.originPodId);
    if (locationPodId) return locationPodId;

    const cartPodId = originatingPodFromCart(cartItems);
    if (cartPodId) return cartPodId;

    const storedPodId = toPodId(safeGet("snooze.cartOriginPodId"));
    if (storedPodId) return storedPodId;

    const parsed =
      recommendations && typeof recommendations === "object"
        ? recommendations
        : safeParseJson(safeGet("snooze.recommendations"));
    const pods = Array.isArray(parsed?.pods) ? parsed.pods : [];
    const first = pods[0] || null;
    return first ? toPodId(first.podId ?? first.id) : null;
  }, [cartItems, location.state, recommendations]);
  const continuePodRoute = useMemo(
    () => makePodRoute(continuePodId),
    [continuePodId]
  );
  const podNavigationAllowed = Boolean(
    continuePodRoute && canViewPodNavigation(device, continuePodRoute)
  );

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
    rewards.status === "loading"
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

  useEffect(() => {
    if (continuePodId) safeSet("snooze.cartOriginPodId", continuePodId);
  }, [continuePodId]);

  async function handleCheckout() {
    if (checkoutLockRef.current || checkoutLoading) return;

    if (!checkoutAllowed) {
      setToast(CHECKOUT_LOUNGE_MESSAGE);
      return;
    }

    if (!cartItems.length) {
      setToast("Your cart is empty.");
      return;
    }

    checkoutLockRef.current = true;
    setCheckoutLoading(true);
    setToast("");
    setCheckoutFailed(false);

    try {
      try {
        if (api?.ensureSession) await api.ensureSession();
      } catch {
        // Session creation is best-effort; checkout prep still owns the final contract.
      }

      const prepared = await prepareCheckoutCart?.({ sourcePage: "cart-page" });
      const newCheckoutUrl = prepared?.checkoutUrl || null;

      if (!newCheckoutUrl) {
        setCheckoutFailed(true);
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

      void Promise.resolve(
        snoozer?.sayHud?.({
          speech: "Your SnoozePod is ready. Continuing to secure checkout.",
          captions: "Your SnoozePod is ready. Continuing to secure checkout.",
          state: "celebrate",
          priority: "high",
          ttlMs: 5000,
          actions: [],
        })
      ).catch(() => {});
      window.location.assign(newCheckoutUrl);
    } catch (err) {
      console.error("Checkout failed:", err);
      setCheckoutFailed(true);
      api
        .trackCRMEvent({
          shopperId,
          event: "cart_checkout_error",
          score: -10,
          context: { reason: "exception", message: err?.message || String(err) },
        })
        .catch(() => {});
    } finally {
      checkoutLockRef.current = false;
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

  async function retryCartRefresh() {
    if (busy) return;
    clearCartError?.();
    setCheckoutFailed(false);
    setCartSyncing(true);
    setToast("");
    try {
      await syncCartFromShopify?.({ sourcePage: "cart-page-retry" });
      setToast("Cart refreshed from Shopify.");
    } catch {
      setCheckoutFailed(true);
    } finally {
      setCartSyncing(false);
    }
  }

  function handleTalkToHuman() {
    emitDeviceHumanHelp(true, { reason: "humanHelp", sourcePage: "cart-page" });
    window.setTimeout(() => {
      emitDeviceHumanHelp(false, { reason: "humanHelp", sourcePage: "cart-page" });
    }, 90000);
    setToast("Please ask a showroom sleep specialist for checkout help. Your cart is saved.");
  }

  return (
    <ShowroomPageShell className="pb-6">
      <ShowroomTopRail className="items-center">
        <ShowroomBrandMark />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => snoozer?.openRewards?.()}
            className="inline-flex min-h-[44px] items-center rounded-full border border-violet-200 bg-violet-50 px-4 text-sm font-black text-violet-800"
          >
            {rewards.status === "loading" ? "Sleep Points" : `${rewardPoints} Sleep Points`}
          </button>
          <span
            className={`hidden min-h-[44px] items-center rounded-full px-4 text-sm font-black sm:inline-flex ${
              cartItems.length
                ? "border border-emerald-100 bg-emerald-50 text-emerald-800"
                : "border border-slate-200 bg-white text-slate-600"
            }`}
          >
            {cartItems.length ? "Ready to review" : "Cart empty"}
          </span>
        </div>
      </ShowroomTopRail>

      <div className="mx-auto max-w-[1460px] px-4 pb-4 pt-2 md:px-6">
        <ShowroomFrame className="overflow-visible p-4 md:p-5">
          <div
            className={`grid gap-4 ${
              cartItems.length ? "xl:grid-cols-[minmax(0,1fr)_400px]" : ""
            }`}
          >
            <section className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                <div>
                  <ShowroomEyebrow>Checkout</ShowroomEyebrow>
                  <h1 className="mt-1 text-[1.9rem] font-black tracking-tight text-slate-950 md:text-[2.35rem]">
                    Review Your SnoozePod
                  </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                {podNavigationAllowed ? (
                  <Link
                    to={continuePodRoute}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-[14px] border border-blue-100 bg-white px-4 text-sm font-black text-[#1A66D2] transition hover:bg-blue-50"
                  >
                    ← Back to SnoozePod
                  </Link>
                ) : null}
                {cartItems.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-[14px] px-3 text-sm font-black text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                    disabled={busy}
                  >
                    Clear Cart
                  </button>
                ) : null}
                </div>
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

              {cartError || checkoutFailed ? (
                <div
                  role="alert"
                  className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950"
                >
                  <span className="font-bold">
                    We couldn&apos;t refresh your cart right now. Your selections are still saved.
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="min-h-[44px] rounded-[14px] border border-amber-300 bg-white px-4 font-black"
                      onClick={checkoutFailed ? handleCheckout : retryCartRefresh}
                      disabled={busy}
                    >
                      Try Again
                    </button>
                    <button
                      type="button"
                      className="min-h-[44px] rounded-[14px] px-4 font-black text-amber-950"
                      onClick={handleTalkToHuman}
                    >
                      Talk to Human
                    </button>
                  </span>
                </div>
              ) : null}

              {activeMessage ? (
                <div className="mt-4 rounded-[18px] border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-black text-blue-800">
                  {activeMessage}
                </div>
              ) : null}

              <div className="mt-3 space-y-3" aria-busy={busy ? "true" : "false"}>
                {cartItems.length === 0 ? (
                  <ShowroomPanel className="p-7 md:p-10">
                    <div className="text-[1.6rem] font-black text-slate-950">
                      {cartSyncing ? "Checking your cart..." : "Your cart is empty."}
                    </div>
                    {podNavigationAllowed ? (
                      <div className="mt-5 flex flex-wrap gap-3">
                        <Link
                          to={continuePodRoute}
                          className="inline-flex min-h-[50px] items-center rounded-[16px] bg-[#1A66D2] px-5 text-sm font-black text-white shadow-[0_18px_38px_rgba(26,102,210,0.22)] transition hover:bg-[#1550A0]"
                        >
                          Return to SnoozePod
                        </Link>
                        <Link
                          to={`${continuePodRoute}?stage=build&buildStep=essentials`}
                          className="inline-flex min-h-[50px] items-center rounded-[16px] border border-blue-200 bg-white px-5 text-sm font-black text-[#1A66D2]"
                        >
                          Browse Sleep Essentials
                        </Link>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleTalkToHuman}
                        className="mt-5 inline-flex min-h-[50px] items-center rounded-[16px] bg-[#1A66D2] px-5 text-sm font-black text-white"
                      >
                        Talk to Human
                      </button>
                    )}
                  </ShowroomPanel>
                ) : (
                  cartItems.map((item, idx) => {
                    const id = itemKey(item, idx);
                    const title = item.title || "Item";
                    const image = safeImage(item);
                    const qty = Number(item.quantity ?? item.qty ?? 1) || 1;
                    const unit = Number(item.unitPrice ?? item.price ?? 0) || 0;
                    const shopperAttributes = pickShopperAttributes(item?.attributes);

                    return (
                      <ShowroomPanel key={id} className="p-3 md:p-4">
                        <div className="grid gap-4 md:grid-cols-[112px_minmax(0,1fr)_135px_170px] md:items-center">
                          <img
                            src={image}
                            alt={title}
                            className="h-[96px] w-[112px] rounded-[18px] border border-slate-200 bg-white object-contain p-1"
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
                            {shopperAttributes.length ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {shopperAttributes.map((attr) => (
                                  <span
                                    key={`${id}-${attr.key}-${attr.value}`}
                                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                                  >
                                    {attr.key}: {attr.value}
                                  </span>
                                ))}
                              </div>
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

                      </ShowroomPanel>
                    );
                  })
                )}
              </div>
            </section>

            {cartItems.length ? (
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
                        {rewards.status === "ready"
                          ? `${rewardPoints} Sleep Points earned`
                          : `${rewardPoints} Sleep Points`}
                      </div>
                      {rewards.status !== "ready" ? (
                        <p className="mt-1 text-xs font-semibold text-violet-700">{rewardStatus}</p>
                      ) : null}
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
                          View financing options
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
                  <p className="border-t border-slate-200 pt-3 text-xs font-semibold leading-5 text-slate-500">
                    Final shipping and tax are calculated by Shopify during secure checkout.
                  </p>
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
                    {checkoutLoading ? "Refreshing checkout..." : "Continue to Secure Checkout →"}
                  </button>
                )}

                <div className="mt-4 text-center text-sm font-semibold text-slate-500">
                  Secure checkout powered by Shopify
                </div>

              </ShowroomPanel>

              <ShowroomPanel className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-black text-slate-950">Need purchase help?</div>
                  <p className="mt-1 text-sm text-slate-600">Pricing, financing, or checkout assistance.</p>
                </div>
                <button
                  type="button"
                  onClick={handleTalkToHuman}
                  className="min-h-[44px] rounded-[14px] border border-blue-200 bg-white px-4 text-sm font-black text-[#1A66D2]"
                >
                  Talk to Human
                </button>
              </ShowroomPanel>
            </aside>
            ) : null}
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
