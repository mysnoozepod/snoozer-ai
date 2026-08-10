import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BedSingle,
  Check,
  CheckCircle2,
  Loader2,
  PackageCheck,
  ShoppingCart,
} from "lucide-react";

import { useSnoozer } from "@/Layout";
import {
  completeRewardAccessories,
  getRewardAccessoriesProgress,
  getSleepEssentialsCatalog,
  recordRewardAccessoriesProgress,
} from "@/lib/api";
import {
  getSafeSleepEssentialsReturnPath,
  getSleepEssentialsJourneyId,
  normalizeSleepEssentialsCategory,
  SLEEP_ESSENTIAL_CATEGORIES,
} from "@/lib/sleepEssentials";
import { useStore } from "@/lib/useStore";
import { getShopperId } from "@/state/sessionStore";
import { refreshRewardsState } from "@/state/rewardsStore";
import {
  ShowroomBrandMark,
  ShowroomPageShell,
  ShowroomPanel,
  ShowroomTopRail,
} from "@/components/showroom/ShowroomPrimitives";

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
    product?.imageUrl ||
      product?.image?.url ||
      product?.featuredImage?.url ||
      product?.images?.[0]?.url ||
      ""
  ).trim();
}

function getAvailableVariants(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.filter((variant) => variant?.available !== false && variant?.availableForSale !== false);
}

function getVariantId(variant, product) {
  return String(
    variant?.id ||
      variant?.merchandiseId ||
      product?.merchandiseId ||
      product?.variantId ||
      product?.firstAvailableVariantId ||
      ""
  ).trim();
}

function normalizeReviewedCategories(progress) {
  const reviewed =
    progress?.reviewedCategoryIds ||
    progress?.reviewedCategories ||
    progress?.categories ||
    [];
  if (Array.isArray(reviewed)) {
    return new Set(reviewed.map((item) => String(item?.categoryId || item || "").trim()));
  }
  return new Set(Object.keys(reviewed || {}).filter((key) => reviewed[key]));
}

export default function SleepEssentials() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { sayHud } = useSnoozer() || {};
  const shopperId = getShopperId() || "";
  const journeyId = getSleepEssentialsJourneyId(shopperId);
  const activeCategoryId = normalizeSleepEssentialsCategory(searchParams.get("category"));
  const returnTo = getSafeSleepEssentialsReturnPath(searchParams.get("returnTo"), "/results");

  const cart = useStore((state) => state.cart);
  const addLinesToAuthoritativeCart = useStore(
    (state) => state.addLinesToAuthoritativeCart
  );

  const [catalog, setCatalog] = useState(null);
  const [progress, setProgress] = useState(null);
  const [selectedVariants, setSelectedVariants] = useState({});
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState("");
  const [error, setError] = useState("");
  const [celebrated, setCelebrated] = useState(false);

  const cartCount = useMemo(
    () => (cart || []).reduce((sum, item) => sum + Math.max(1, Number(item?.quantity) || 1), 0),
    [cart]
  );

  const hydrate = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [catalogResponse, progressResponse] = await Promise.all([
        getSleepEssentialsCatalog(),
        journeyId
          ? getRewardAccessoriesProgress({ journeyId })
          : Promise.resolve(null),
      ]);
      setCatalog(catalogResponse);
      setProgress(progressResponse);
    } catch (err) {
      console.warn("[sleep-essentials] Unable to load showroom catalog", err);
      setError(err?.message || "Sleep Essentials are temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
  const activeCategory =
    categories.find((category) => category.id === activeCategoryId) ||
    SLEEP_ESSENTIAL_CATEGORIES.find((category) => category.id === activeCategoryId) ||
    SLEEP_ESSENTIAL_CATEGORIES[0];
  const products = Array.isArray(activeCategory?.products) ? activeCategory.products : [];
  const reviewedCategories = normalizeReviewedCategories(progress);
  const allReviewed = SLEEP_ESSENTIAL_CATEGORIES.every((category) =>
    reviewedCategories.has(category.id)
  );

  const selectCategory = (categoryId) => {
    const next = new URLSearchParams(searchParams);
    next.set("category", categoryId);
    setSearchParams(next, { replace: true });
    setError("");
  };

  const recordProgress = async ({ action, product, variant }) => {
    if (!journeyId) {
      setError("Enter your Snooze Code before saving Sleep Essentials progress.");
      return null;
    }
    const key = `${action}:${product?.handle || activeCategoryId}`;
    setWorkingKey(key);
    setError("");
    try {
      const next = await recordRewardAccessoriesProgress({
        journeyId,
        categoryId: activeCategoryId,
        action,
        productHandle: product?.handle || null,
        variantId: getVariantId(variant, product) || null,
        sourceSurface: "sleep_essentials",
      });
      setProgress(next);
      return next;
    } catch (err) {
      setError(err?.message || "We could not save that Sleep Essentials step.");
      return null;
    } finally {
      setWorkingKey("");
    }
  };

  const addProduct = async (product) => {
    if (!journeyId) {
      setError("Enter your Snooze Code before adding Sleep Essentials to your shared cart.");
      return;
    }
    const available = getAvailableVariants(product);
    const variant =
      available.find((item) => item.id === selectedVariants[product.handle]) ||
      available[0] ||
      null;
    const merchandiseId = getVariantId(variant, product);
    if (!merchandiseId) {
      setError("Choose an available option before adding this item.");
      return;
    }
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
      const next = await recordRewardAccessoriesProgress({
        journeyId,
        categoryId: activeCategoryId,
        action: "added_to_cart",
        productHandle: product.handle,
        variantId: merchandiseId,
        sourceSurface: "sleep_essentials",
      });
      setProgress(next);
    } catch (err) {
      setError(err?.message || "We could not add that item to your showroom cart.");
    } finally {
      setWorkingKey("");
    }
  };

  const completeJourney = async () => {
    if (!allReviewed || !journeyId) return;
    setWorkingKey("complete");
    setError("");
    try {
      const result = await completeRewardAccessories({
        journeyId,
        sourceSurface: "sleep_essentials",
      });
      await refreshRewardsState({ force: true });
      setCelebrated(true);
      await sayHud?.({
        speech: "Sleep Essentials complete. Your confirmed reward is now in your Snooze Profile.",
        captions: "Sleep Essentials complete. Your confirmed reward is now in your Snooze Profile.",
        state: "celebrate",
        priority: "normal",
        ttlMs: 5000,
      });
      setProgress((current) => ({ ...current, completed: true, result }));
    } catch (err) {
      setError(err?.message || "Your progress is safe, but completion could not be confirmed.");
    } finally {
      setWorkingKey("");
    }
  };

  return (
    <ShowroomPageShell className="min-h-screen pb-8">
      <ShowroomTopRail className="mx-auto max-w-[1480px] justify-between px-5 py-4">
        <button
          type="button"
          onClick={() => navigate(returnTo)}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 font-extrabold text-slate-800 hover:bg-white"
        >
          <ArrowLeft className="h-5 w-5" /> Back to showroom
        </button>
        <ShowroomBrandMark imageClassName="w-[190px] md:w-[220px]" />
        <button
          type="button"
          onClick={() => navigate("/cart")}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white bg-white/80 px-4 font-extrabold text-slate-900 shadow-sm"
        >
          <ShoppingCart className="h-5 w-5 text-[#2f57e8]" /> {cartCount} items
        </button>
      </ShowroomTopRail>

      <main className="mx-auto w-full max-w-[1480px] px-5">
        <ShowroomPanel className="overflow-hidden p-5 md:p-7">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="text-sm font-black uppercase tracking-[0.2em] text-[#2f57e8]">
                Sleep Essentials
              </div>
              <h1 className="mt-2 text-[clamp(2rem,4vw,3.6rem)] font-black leading-none tracking-tight text-slate-950">
                Complete your sleep setup.
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-6 text-slate-600 md:text-lg">
                Compare pillows, bedding, and protectors with live Shopify options. Review every category your way.
              </p>
            </div>
            <div className="rounded-2xl border border-[#dce6ff] bg-[#f4f7ff] px-4 py-3 text-sm font-bold text-slate-700">
              {reviewedCategories.size} of {SLEEP_ESSENTIAL_CATEGORIES.length} categories reviewed
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {SLEEP_ESSENTIAL_CATEGORIES.map((category) => {
              const active = category.id === activeCategoryId;
              const reviewed = reviewedCategories.has(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => selectCategory(category.id)}
                  className={`flex min-h-14 items-center justify-between rounded-2xl border px-4 text-left font-black transition ${
                    active
                      ? "border-[#315df3] bg-[#eef2ff] text-[#244ce0]"
                      : "border-slate-200 bg-white text-slate-800 hover:border-[#b8c8ff]"
                  }`}
                >
                  <span>{category.label}</span>
                  {reviewed ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <ArrowRight className="h-5 w-5" />}
                </button>
              );
            })}
          </div>
        </ShowroomPanel>

        <section className="mt-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <h2 className="text-2xl font-black text-slate-950">{activeCategory.label}</h2>
              <p className="mt-1 text-slate-600">{activeCategory.description}</p>
            </div>
            <button
              type="button"
              disabled={workingKey !== "" || loading}
              onClick={() => recordProgress({ action: "reviewed_no_selection" })}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 font-extrabold text-slate-700 disabled:opacity-50"
            >
              Review without a selection
            </button>
          </div>

          {error ? (
            <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 font-semibold text-amber-900">
              {error} <button type="button" onClick={hydrate} className="ml-2 underline">Try again</button>
            </div>
          ) : null}

          {loading ? (
            <ShowroomPanel className="flex min-h-64 items-center justify-center gap-3 text-slate-600">
              <Loader2 className="h-6 w-6 animate-spin" /> Loading live Sleep Essentials...
            </ShowroomPanel>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => {
                const variants = getAvailableVariants(product);
                const selectedVariant =
                  variants.find((variant) => variant.id === selectedVariants[product.handle]) || variants[0];
                const image = getProductImage(product);
                const price = selectedVariant?.price ?? product?.price ?? product?.priceRange?.min;
                const currency = selectedVariant?.currencyCode || product?.priceRange?.currencyCode || "USD";
                const busy = workingKey.endsWith(`:${product.handle}`);
                return (
                  <ShowroomPanel key={product.handle} className="flex min-h-[350px] flex-col overflow-hidden p-0">
                    <div className="flex h-40 items-center justify-center bg-[linear-gradient(145deg,#f7f9ff,#eef3ff)] p-4">
                      {image ? (
                        <img src={image} alt={product.title} className="h-full w-full object-contain" />
                      ) : (
                        <BedSingle className="h-14 w-14 text-[#8ba6ef]" />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <h3 className="text-xl font-black leading-tight text-slate-950">{product.title}</h3>
                      <div className="mt-2 text-lg font-black text-[#2f57e8]">{formatMoney(price, currency)}</div>
                      {variants.length > 1 ? (
                        <select
                          value={selectedVariant?.id || ""}
                          onChange={(event) => setSelectedVariants((current) => ({ ...current, [product.handle]: event.target.value }))}
                          className="mt-3 min-h-11 rounded-xl border border-slate-300 bg-white px-3 font-semibold"
                        >
                          {variants.map((variant) => (
                            <option key={variant.id} value={variant.id}>{variant.title}</option>
                          ))}
                        </select>
                      ) : null}
                      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
                        <button
                          type="button"
                          disabled={busy || !journeyId}
                          onClick={() => recordProgress({ action: "saved_selection", product, variant: selectedVariant })}
                          className="min-h-12 rounded-xl border border-[#adc1ff] bg-white px-3 font-black text-[#3158d8] disabled:opacity-50"
                        >
                          Save choice
                        </button>
                        <button
                          type="button"
                          disabled={busy || !journeyId || !getVariantId(selectedVariant, product)}
                          onClick={() => addProduct(product)}
                          className="min-h-12 rounded-xl bg-[#315df3] px-3 font-black text-white disabled:opacity-50"
                        >
                          {busy ? "Saving..." : "Add to cart"}
                        </button>
                      </div>
                    </div>
                  </ShowroomPanel>
                );
              })}
            </div>
          )}

          {!loading && !products.length ? (
            <ShowroomPanel className="flex min-h-48 items-center justify-center p-6 text-center text-slate-600">
              No live products are available in this category right now.
            </ShowroomPanel>
          ) : null}
        </section>

        <ShowroomPanel className="mt-4 flex flex-col items-center justify-between gap-4 p-5 md:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eef3ff] text-[#315df3]">
              {celebrated || progress?.completed ? <Check className="h-6 w-6" /> : <PackageCheck className="h-6 w-6" />}
            </div>
            <div>
              <div className="font-black text-slate-950">
                {celebrated || progress?.completed ? "Sleep Essentials complete" : "Review all three categories"}
              </div>
              <div className="text-sm text-slate-600">
                Adding to cart is optional. Your confirmed progress is saved to your Snooze Profile.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate(returnTo)} className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-black text-slate-800">
              Return to Pod Customize
            </button>
            <button
              type="button"
              onClick={completeJourney}
              disabled={!allReviewed || workingKey !== "" || Boolean(progress?.completed)}
              className="min-h-12 rounded-xl bg-[#315df3] px-6 font-black text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              {progress?.completed ? "Reward confirmed" : workingKey === "complete" ? "Confirming..." : "Complete Sleep Essentials"}
            </button>
          </div>
        </ShowroomPanel>
      </main>
    </ShowroomPageShell>
  );
}
