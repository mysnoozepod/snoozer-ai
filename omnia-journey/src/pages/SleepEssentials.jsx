import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BedSingle, Loader2, MessageCircle, ShoppingCart } from "lucide-react";

import { useSnoozer } from "@/Layout";
import HumanAssistanceControl from "@/components/HumanAssistanceControl";
import RewardsPill from "@/components/RewardsPill";
import {
  completeRewardAccessories,
  getRewardAccessoriesProgress,
  getSleepEssentialsCatalog,
  recordRewardAccessoriesProgress,
} from "@/lib/api";
import {
  getSafeSleepEssentialsReturnPath,
  getSleepEssentialsJourneyId,
  getSleepEssentialsVariantLabel,
  normalizeSleepEssentialsCategory,
  SLEEP_ESSENTIAL_CATEGORIES,
  SLEEP_ESSENTIAL_SORT_OPTIONS,
  sortSleepEssentialProducts,
} from "@/lib/sleepEssentials";
import { useStore } from "@/lib/useStore";
import { confirmedCartItemCount } from "@/lib/cart/cartAuthority.mjs";
import { getShopperId } from "@/state/sessionStore";
import { refreshRewardsState } from "@/state/rewardsStore";
import {
  ShowroomCartBadge,
  ShowroomDownstreamHeader,
  ShowroomPageShell,
  ShowroomPanel,
} from "@/components/showroom/ShowroomPrimitives";
import sharpMySnoozePodLogo from "@/assets/mysnoozepod-logo-welcome.png";

function formatMoney(value, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Price available in store";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function getProductImage(product) {
  return String(
    product?.imageUrl || product?.image?.url || product?.featuredImage?.url || product?.images?.[0]?.url || ""
  ).trim();
}

function getAvailableVariants(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.filter((variant) => variant?.available !== false && variant?.availableForSale !== false);
}

function getVariantId(variant, product) {
  return String(
    variant?.id || variant?.merchandiseId || product?.merchandiseId || product?.variantId || product?.firstAvailableVariantId || ""
  ).trim();
}

function normalizeReviewedCategories(progress) {
  const reviewed = progress?.reviewedCategoryIds || progress?.reviewedCategories || progress?.categories || [];
  if (Array.isArray(reviewed)) {
    return new Set(reviewed.map((item) => String(item?.categoryId || item || "").trim()));
  }
  return new Set(Object.keys(reviewed || {}).filter((key) => reviewed[key]));
}

function getSavedPodSelections(returnTo) {
  try {
    const safeReturn = getSafeSleepEssentialsReturnPath(returnTo, "");
    if (!safeReturn) return [];
    const url = new URL(safeReturn, "https://showroom.mysnoozepod.com");
    const podId = url.pathname.split("/").filter(Boolean).at(-1) || "";
    const numericPodId = podId.replace(/^pod-/, "");
    const keys = [`snooze.podBuilder.${podId}`, `snooze.podBuilder.${numericPodId}`];
    for (const key of keys) {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const saved = JSON.parse(raw);
      const selections = Object.values(saved?.selectedEssentials || {}).filter(
        (selection) => selection?.handle && String(selection?.variantId || "").startsWith("gid://shopify/ProductVariant/")
      );
      if (selections.length) return selections;
    }
  } catch {
    // Optional Pod continuity only; Shopify remains authoritative.
  }
  return [];
}

function ProductBadge({ children }) {
  return (
    <span
      className="inline-flex min-h-7 items-center rounded-full border border-emerald-300 bg-emerald-100 px-3 text-xs font-black text-emerald-800 shadow-sm"
      data-sleep-essentials-badge="in-cart"
    >
      {children}
    </span>
  );
}

function LoadingGrid() {
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3 min-[1420px]:grid-cols-4" data-sleep-essentials-product-grid="true" data-sleep-essentials-loading="true">
      <span className="sr-only">Loading products...</span>
      {Array.from({ length: 6 }, (_, index) => (
        <ShowroomPanel key={index} className="min-h-[410px] overflow-hidden p-0">
          <div className="h-56 animate-pulse bg-[#e8efff]" />
          <div className="space-y-3 p-4">
            <div className="h-5 w-4/5 animate-pulse rounded-full bg-slate-200" />
            <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-6 w-24 animate-pulse rounded-full bg-[#dce6ff]" />
            <div className="h-12 animate-pulse rounded-xl bg-[#dce6ff]" />
          </div>
        </ShowroomPanel>
      ))}
    </div>
  );
}

export default function SleepEssentials() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openRewards, openSnoozer } = useSnoozer() || {};
  const shopperId = getShopperId() || "";
  const journeyId = getSleepEssentialsJourneyId(shopperId);
  const activeCategoryId = normalizeSleepEssentialsCategory(searchParams.get("category"));
  const returnTo = getSafeSleepEssentialsReturnPath(searchParams.get("returnTo"), "/results");
  const enteredFromPod = returnTo.startsWith("/pod/");

  const cart = useStore((state) => state.cart);
  const addLinesToAuthoritativeCart = useStore((state) => state.addLinesToAuthoritativeCart);
  const syncCartFromShopify = useStore((state) => state.syncCartFromShopify);

  const [catalog, setCatalog] = useState(null);
  const [progress, setProgress] = useState(null);
  const [selectedVariants, setSelectedVariants] = useState({});
  const [sortKey, setSortKey] = useState("featured");
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState("");
  const [error, setError] = useState("");
  const [failedImages, setFailedImages] = useState(() => new Set());
  const recordedCategoryViewsRef = useRef(new Set());
  const completionAttemptedRef = useRef(false);

  const cartVariantIds = useMemo(
    () => new Set((cart || []).map((item) => String(item?.merchandiseId || item?.variantId || "")).filter(Boolean)),
    [cart]
  );
  const cartCount = useMemo(() => confirmedCartItemCount(cart), [cart]);

  const hydrate = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [catalogResponse, progressResponse] = await Promise.all([
        getSleepEssentialsCatalog(),
        journeyId ? getRewardAccessoriesProgress({ journeyId }) : Promise.resolve(null),
      ]);
      setCatalog(catalogResponse);
      setProgress(progressResponse);
      void syncCartFromShopify?.({ sourcePage: "sleep-essentials" }).catch((syncError) => {
        console.warn("[sleep-essentials] Shopify cart refresh unavailable", {
          code: syncError?.code || syncError?.name || "CART_FETCH_FAILED",
        });
      });
    } catch (err) {
      console.warn("[sleep-essentials] Unable to load storefront catalog", err);
      setError(err?.message || "Products are temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [journeyId, syncCartFromShopify]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    recordedCategoryViewsRef.current.clear();
    completionAttemptedRef.current = false;
  }, [journeyId]);

  useEffect(() => {
    const podSelections = getSavedPodSelections(returnTo);
    if (!podSelections.length) return;
    setSelectedVariants((current) => ({
      ...Object.fromEntries(podSelections.map((selection) => [selection.handle, selection.variantId])),
      ...current,
    }));
  }, [returnTo]);

  const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
  const activeCategory =
    categories.find((category) => category.id === activeCategoryId) ||
    SLEEP_ESSENTIAL_CATEGORIES.find((category) => category.id === activeCategoryId) ||
    SLEEP_ESSENTIAL_CATEGORIES[0];
  const products = Array.isArray(activeCategory?.products) ? activeCategory.products : [];
  const sortedProducts = useMemo(
    () => sortSleepEssentialProducts(products, sortKey),
    [products, sortKey]
  );
  const reviewedCategories = normalizeReviewedCategories(progress);
  const allReviewed = SLEEP_ESSENTIAL_CATEGORIES.every((category) => reviewedCategories.has(category.id));
  const variantLabel = getSleepEssentialsVariantLabel(activeCategoryId);

  useEffect(() => {
    if (loading || !journeyId || !activeCategoryId) return;
    if (reviewedCategories.has(activeCategoryId)) return;
    if (recordedCategoryViewsRef.current.has(activeCategoryId)) return;
    recordedCategoryViewsRef.current.add(activeCategoryId);
    void recordRewardAccessoriesProgress({
      journeyId,
      categoryId: activeCategoryId,
      action: "reviewed_no_selection",
      productHandle: null,
      variantId: null,
      sourceSurface: "sleep_essentials",
    })
      .then(setProgress)
      .catch((visitError) => {
        console.warn("[rewards] Sleep Essentials category visit was not recorded", {
          categoryId: activeCategoryId,
          code: visitError?.code || visitError?.name || "REWARD_ACCESSORIES_PROGRESS_FAILED",
        });
      });
  }, [activeCategoryId, journeyId, loading, reviewedCategories]);

  useEffect(() => {
    if (!allReviewed || !journeyId || progress?.completed || completionAttemptedRef.current) return;
    completionAttemptedRef.current = true;
    void completeRewardAccessories({ journeyId, sourceSurface: "sleep_essentials" })
      .then((result) => {
        setProgress((current) => ({ ...current, completed: true, result }));
        void refreshRewardsState({ force: true }).catch(() => {});
      })
      .catch((rewardError) => {
        console.warn("[rewards] Sleep Essentials completion was not recorded", {
          code: rewardError?.code || rewardError?.name || "REWARD_ACCESSORIES_COMPLETION_FAILED",
        });
      });
  }, [allReviewed, journeyId, progress?.completed]);

  const selectCategory = (categoryId) => {
    const next = new URLSearchParams(searchParams);
    next.set("category", categoryId);
    setSearchParams(next, { replace: true });
    setError("");
  };

  const addProduct = async (product, selectedVariant) => {
    if (!journeyId) {
      setError("Enter your Snooze Code before adding Sleep Essentials to your shared cart.");
      return;
    }
    const merchandiseId = getVariantId(selectedVariant, product);
    if (!merchandiseId) {
      setError("Choose an available option before adding this item.");
      return;
    }
    if (cartVariantIds.has(merchandiseId)) return;

    const key = `added_to_cart:${product.handle}`;
    setWorkingKey(key);
    setError("");
    try {
      await addLinesToAuthoritativeCart({
        sourcePage: "sleep-essentials",
        lines: [{
          merchandiseId,
          quantity: 1,
          attributes: [
            { key: "_Source", value: "Sleep Essentials" },
            { key: "_Sleep Essential", value: activeCategoryId },
          ],
        }],
      });
      try {
        const next = await recordRewardAccessoriesProgress({
          journeyId,
          categoryId: activeCategoryId,
          action: "added_to_cart",
          productHandle: product.handle,
          variantId: merchandiseId,
          sourceSurface: "sleep_essentials",
        });
        setProgress(next);
      } catch (rewardError) {
        console.warn("[rewards] Accessory is in cart but progress was not recorded", {
          categoryId: activeCategoryId,
          code: rewardError?.code || rewardError?.name || "REWARD_ACCESSORIES_PROGRESS_FAILED",
        });
      }
    } catch (err) {
      setError(err?.message || "We could not add that item to your showroom cart.");
    } finally {
      setWorkingKey("");
    }
  };

  return (
    <ShowroomPageShell className="min-h-screen pb-0">
      <div className="mx-auto w-full max-w-[1480px] px-5 py-2.5">
        <ShowroomDownstreamHeader
          brandImageSrc={sharpMySnoozePodLogo}
          rewards={shopperId ? <RewardsPill shopperId={shopperId} onClick={openRewards} placement="inline" /> : null}
          humanHelp={<HumanAssistanceControl compact showNoticeMessage={false} sourcePage="/sleep-essentials" />}
          cart={<ShowroomCartBadge count={cartCount} quiet onClick={() => navigate("/cart")} />}
        />
      </div>

      <main className="mx-auto w-full max-w-[1480px] px-5 pb-32" data-sleep-essentials-device="storefront">
        <ShowroomPanel className="p-4 md:p-5" data-sleep-essentials-intro="true">
          <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-[#2f57e8]">Sleep Essentials</div>
              <h1 className="mt-1 text-[clamp(1.8rem,3.2vw,2.75rem)] font-black leading-none tracking-tight text-slate-950">Complete your sleep setup.</h1>
              <p className="mt-2 text-sm font-semibold text-slate-600 md:text-base">Browse pillows, bedding, and mattress protection for your sleep setup.</p>
            </div>
            <button
              type="button"
              onClick={openSnoozer}
              className="group flex min-h-[92px] items-center gap-3 rounded-[24px] border border-[#d8e3ff] bg-[linear-gradient(135deg,#f8faff,#eaf1ff)] px-4 text-left transition hover:border-[#9db2ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]"
              data-sleep-essentials-concierge="true"
            >
              <img src="/snoozer-avatar.png" alt="Snoozer" className="h-16 w-16 shrink-0 object-contain" />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-black text-slate-950">Need help choosing?</span>
                <span className="mt-0.5 block text-sm font-semibold text-slate-600">Ask Snoozer for product guidance.</span>
              </span>
              <MessageCircle className="h-5 w-5 shrink-0 text-[#2f57e8] transition group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          </div>
        </ShowroomPanel>

        <ShowroomPanel className="mt-3 p-2" data-sleep-essentials-category-rail="true">
          <div className="grid gap-2 md:grid-cols-3" role="tablist" aria-label="Sleep Essential categories">
            {SLEEP_ESSENTIAL_CATEGORIES.map((category) => {
              const active = category.id === activeCategoryId;
              const loadedCategory = categories.find((item) => item.id === category.id);
              const productCount = Array.isArray(loadedCategory?.products) ? loadedCategory.products.length : 0;
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`${category.label}, ${productCount} products${active ? ", current" : ""}`}
                  data-category-state={active ? "current" : "idle"}
                  onClick={() => selectCategory(category.id)}
                  className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff] ${active ? "border-[#2f57e8] bg-[#2f57e8] text-white shadow-[0_10px_24px_rgba(47,87,232,0.2)]" : "border-slate-200 bg-white text-slate-800 hover:border-[#9db2ff]"}`}
                >
                  <span className="font-black leading-tight">{category.label}</span>
                  <span className={`shrink-0 text-xs font-bold ${active ? "text-white/85" : "text-slate-500"}`}>{productCount} products</span>
                </button>
              );
            })}
          </div>
        </ShowroomPanel>

        <section className="mt-3" data-sleep-essentials-category={activeCategoryId}>
          <ShowroomPanel className="flex flex-wrap items-center justify-between gap-3 p-4" data-sleep-essentials-toolbar="true">
            <div>
              <h2 className="text-[clamp(1.35rem,2vw,1.8rem)] font-black leading-none text-slate-950">{activeCategory.label}</h2>
              <p className="mt-1 text-sm font-bold text-slate-500">{products.length} products</p>
            </div>
            <label className="flex min-h-12 items-center gap-2 text-sm font-bold text-slate-600">
              Sort by
              <select
                aria-label="Sort products"
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value)}
                className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-sm font-extrabold text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]"
                data-sleep-essentials-sort="true"
              >
                {SLEEP_ESSENTIAL_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </ShowroomPanel>

          {error && catalog ? <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 font-semibold text-amber-900" role="alert">{error}</div> : null}

          {loading ? (
            <LoadingGrid />
          ) : error && !catalog ? (
            <ShowroomPanel className="mt-3 flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center" data-sleep-essentials-error="catalog">
              <Loader2 className="h-7 w-7 text-[#2f57e8]" aria-hidden="true" />
              <div className="text-lg font-black text-slate-900">Products are temporarily unavailable.</div>
              <p className="max-w-xl text-sm font-semibold text-slate-600">Your cart and showroom progress are safe. Try loading the approved assortment again.</p>
              <button type="button" onClick={hydrate} className="min-h-12 rounded-xl bg-[#2f57e8] px-5 font-black text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]">Try Again</button>
            </ShowroomPanel>
          ) : sortedProducts.length ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3 min-[1420px]:grid-cols-4" data-sleep-essentials-product-grid="true">
              {sortedProducts.map((product, index) => {
                const variants = getAvailableVariants(product);
                const cartVariant = variants.find((variant) => cartVariantIds.has(getVariantId(variant, product)));
                const selectedVariant = cartVariant || variants.find((variant) => getVariantId(variant, product) === selectedVariants[product.handle]) || variants[0] || null;
                const selectedVariantId = getVariantId(selectedVariant, product);
                const image = getProductImage(product);
                const price = selectedVariant?.price ?? product?.price ?? product?.priceRange?.min;
                const currency = selectedVariant?.currencyCode || product?.priceRange?.currencyCode || "USD";
                const busy = workingKey === `added_to_cart:${product.handle}`;
                const inCart = Boolean(selectedVariantId && cartVariantIds.has(selectedVariantId));
                return (
                  <ShowroomPanel key={product.handle} className="flex min-h-[430px] flex-col overflow-hidden p-0" data-sleep-essentials-product-card={product.handle}>
                    <div className="relative flex h-56 items-center justify-center bg-[linear-gradient(145deg,#f8faff,#eef3ff)] p-4" data-sleep-essentials-product-image="true">
                      {inCart ? <div className="absolute left-3 top-3 z-10"><ProductBadge>In Your Cart</ProductBadge></div> : null}
                      {image && !failedImages.has(product.handle) ? (
                        <img
                          src={image}
                          alt={product.title}
                          loading={index < 3 ? "eager" : "lazy"}
                          decoding="async"
                          className="h-full w-full object-contain"
                          onError={() => setFailedImages((current) => new Set(current).add(product.handle))}
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-[#6f8bdc]" role="img" aria-label={`Image unavailable for ${product.title}`}>
                          <BedSingle className="h-14 w-14" />
                          <span className="text-xs font-black uppercase tracking-[0.12em]">Image unavailable</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="min-h-[2.7rem] text-[clamp(1rem,1.4vw,1.2rem)] font-black leading-tight text-slate-950">{product.title}</h3>
                      <div className="mt-2 text-xl font-black text-[#2f57e8]">{formatMoney(price, currency)}</div>
                      {variants.length > 1 ? (
                        <label className="mt-3 block text-xs font-black uppercase tracking-[0.1em] text-slate-600">
                          {variantLabel}
                          <select aria-label={`${product.title} ${variantLabel}`} value={selectedVariantId} onChange={(event) => setSelectedVariants((current) => ({ ...current, [product.handle]: event.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-bold normal-case tracking-normal text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]">
                            {variants.map((variant) => <option key={getVariantId(variant, product)} value={getVariantId(variant, product)}>{variant.title}</option>)}
                          </select>
                        </label>
                      ) : selectedVariant ? (
                        <div className="mt-3 min-h-12 rounded-xl border border-[#dce6ff] bg-[#f7f9ff] px-3 py-2">
                          <div className="text-[0.65rem] font-black uppercase tracking-[0.1em] text-slate-500">{variantLabel}</div>
                          <div className="mt-0.5 font-extrabold text-slate-800">{selectedVariant.title}</div>
                        </div>
                      ) : null}
                      <button type="button" disabled={busy || inCart || !journeyId || !selectedVariantId} onClick={() => addProduct(product, selectedVariant)} className={`mt-auto min-h-12 rounded-xl px-4 pt-0.5 text-base font-black transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff] disabled:cursor-not-allowed ${inCart ? "border border-emerald-300 bg-emerald-100 text-emerald-800" : "bg-[#2f57e8] text-white disabled:opacity-50"}`}>
                        {busy ? "Adding..." : inCart ? "In Cart" : "Add to Cart"}
                      </button>
                    </div>
                  </ShowroomPanel>
                );
              })}
            </div>
          ) : (
            <ShowroomPanel className="mt-3 flex min-h-48 items-center justify-center p-6 text-center font-semibold text-slate-600">No approved products are available in this category right now.</ShowroomPanel>
          )}
        </section>

        <div className="h-4" aria-hidden="true" />
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 px-5">
        <ShowroomPanel className="pointer-events-auto mx-auto flex w-full max-w-[1440px] items-center justify-between gap-3 p-3.5 shadow-[0_18px_44px_rgba(30,55,110,0.2)]" data-sleep-essentials-footer="true">
          <button type="button" onClick={() => navigate(returnTo)} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 font-black text-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]">
            <ArrowLeft className="h-5 w-5" /> {enteredFromPod ? "Return to Pod" : "Back"}
          </button>
          <div className="hidden items-center gap-2 text-center font-black text-slate-800 sm:flex" role="status" aria-live="polite" data-sleep-essentials-cart-summary="true">
            <ShoppingCart className="h-5 w-5 text-[#2f57e8]" aria-hidden="true" />
            {cartCount} {cartCount === 1 ? "item" : "items"}
          </div>
          <button type="button" onClick={() => navigate("/cart")} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#2f57e8] px-6 font-black text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]">
            View Cart <ArrowRight className="h-5 w-5" />
          </button>
        </ShowroomPanel>
      </div>
    </ShowroomPageShell>
  );
}
