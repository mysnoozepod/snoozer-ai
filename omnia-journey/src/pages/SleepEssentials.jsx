import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BedSingle, CheckCircle2, Loader2, ShoppingCart } from "lucide-react";

import { useSnoozer } from "@/Layout";
import {
  completeRewardAccessories,
  getRewardAccessoriesProgress,
  getSleepEssentialsCatalog,
  recordRewardAccessoriesProgress,
} from "@/lib/api";
import {
  getSafeSleepEssentialsReturnPath,
  getSleepEssentialsFinishPath,
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

const INITIAL_PRODUCT_LIMIT = 3;

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

function readAssessmentValue(assessment, ...keys) {
  for (const key of keys) {
    const direct = assessment?.[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim();
    const nested = assessment?.answers?.[key];
    if (nested !== undefined && nested !== null && String(nested).trim()) return String(nested).trim();
  }
  return "";
}

function buildCategoryGuidance(assessment, categoryId) {
  if (categoryId === "pillows") {
    const position = readAssessmentValue(assessment, "sleepPosition", "position", "primarySleepPosition");
    return position
      ? `You told me you sleep mostly ${position.toLowerCase()}. Start with these approved pillow options and compare what feels supportive.`
      : "Here are three approved pillow options to compare without overcomplicating the choice.";
  }
  if (categoryId === "sheets_bedding") {
    const temperature = readAssessmentValue(assessment, "sleepTemperature", "temperature", "sleepsHot");
    return temperature
      ? `You mentioned ${temperature.toLowerCase()} sleep. Compare these approved bedding options with that in mind.`
      : "These approved bedding options are a quick way to finish the setup you are building.";
  }
  return "A protector can be added here to help complete the mattress setup already in your showroom cart.";
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

export default function SleepEssentials() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { sayHud } = useSnoozer() || {};
  const shopperId = getShopperId() || "";
  const journeyId = getSleepEssentialsJourneyId(shopperId);
  const activeCategoryId = normalizeSleepEssentialsCategory(searchParams.get("category"));
  const returnTo = getSafeSleepEssentialsReturnPath(searchParams.get("returnTo"), "/results");
  const finishTo = getSleepEssentialsFinishPath(searchParams.get("returnTo"), "/results");
  const enteredFromPod = returnTo.startsWith("/pod/");

  const cart = useStore((state) => state.cart);
  const assessment = useStore((state) => state.assessment);
  const addLinesToAuthoritativeCart = useStore((state) => state.addLinesToAuthoritativeCart);
  const syncCartFromShopify = useStore((state) => state.syncCartFromShopify);

  const [catalog, setCatalog] = useState(null);
  const [progress, setProgress] = useState(null);
  const [selectedVariants, setSelectedVariants] = useState({});
  const [expandedCategories, setExpandedCategories] = useState({});
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState("");
  const [error, setError] = useState("");
  const recordedCategoryViewsRef = useRef(new Set());

  const cartVariantIds = useMemo(
    () => new Set((cart || []).map((item) => String(item?.merchandiseId || item?.variantId || "")).filter(Boolean)),
    [cart]
  );
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
      console.warn("[sleep-essentials] Unable to load showroom catalog", err);
      setError(err?.message || "Sleep Essentials are temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [journeyId, syncCartFromShopify]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
  const displayedProducts = expandedCategories[activeCategoryId] ? products : products.slice(0, INITIAL_PRODUCT_LIMIT);
  const reviewedCategories = normalizeReviewedCategories(progress);
  const allReviewed = SLEEP_ESSENTIAL_CATEGORIES.every((category) => reviewedCategories.has(category.id));
  const guidance = buildCategoryGuidance(assessment, activeCategoryId);

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

  const categoryHasSelection = useCallback(
    (categoryId) => {
      const category = categories.find((item) => item.id === categoryId);
      return (category?.products || []).some((product) =>
        getAvailableVariants(product).some((variant) => {
          const variantId = getVariantId(variant, product);
          return cartVariantIds.has(variantId) || selectedVariants[product.handle] === variantId;
        })
      );
    },
    [cartVariantIds, categories, selectedVariants]
  );

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

  const finishExperience = async () => {
    if (workingKey) return;
    setWorkingKey("finish");
    setError("");
    try {
      if (allReviewed && journeyId && !progress?.completed) {
        const result = await completeRewardAccessories({ journeyId, sourceSurface: "sleep_essentials" });
        await refreshRewardsState({ force: true });
        setProgress((current) => ({ ...current, completed: true, result }));
        void sayHud?.({
          speech: "Your Sleep Essentials visit is saved. Let's keep going.",
          captions: "Your Sleep Essentials visit is saved. Let's keep going.",
          state: "celebrate",
          priority: "normal",
          ttlMs: 3500,
        });
      }
    } catch (rewardError) {
      console.warn("[rewards] Sleep Essentials completion was not recorded", {
        code: rewardError?.code || rewardError?.name || "REWARD_ACCESSORIES_COMPLETION_FAILED",
      });
    } finally {
      navigate(finishTo);
    }
  };

  return (
    <ShowroomPageShell className="min-h-screen pb-4">
      <ShowroomTopRail className="mx-auto max-w-[1480px] justify-between px-5 py-2.5">
        <button type="button" onClick={() => navigate(returnTo)} className="inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 font-extrabold text-slate-800 hover:bg-white">
          <ArrowLeft className="h-5 w-5" /> {enteredFromPod ? "Return to Pod" : "Back to showroom"}
        </button>
        <ShowroomBrandMark imageClassName="w-[172px] md:w-[195px]" />
        <button type="button" onClick={() => navigate("/cart")} className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white bg-white/80 px-4 font-extrabold text-slate-900 shadow-sm" data-sleep-essentials-cart-count={cartCount}>
          <ShoppingCart className="h-5 w-5 text-[#2f57e8]" /> {cartCount} items
        </button>
      </ShowroomTopRail>

      <main className="mx-auto w-full max-w-[1480px] px-5" data-sleep-essentials-device="curated">
        <ShowroomPanel className="p-4 md:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-[#2f57e8]">Sleep Essentials</div>
              <h1 className="mt-1 text-[clamp(1.75rem,3vw,2.6rem)] font-black leading-none tracking-tight text-slate-950">Finish your sleep setup.</h1>
            </div>
            {products.length > INITIAL_PRODUCT_LIMIT ? (
              <button type="button" onClick={() => setExpandedCategories((current) => ({ ...current, [activeCategoryId]: !current[activeCategoryId] }))} className="min-h-10 rounded-xl px-3 text-sm font-black text-[#315cf6] hover:bg-[#eef3ff]">
                {expandedCategories[activeCategoryId] ? "Show Curated" : "View More"}
              </button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3" role="tablist" aria-label="Sleep Essential categories">
            {SLEEP_ESSENTIAL_CATEGORIES.map((category) => {
              const active = category.id === activeCategoryId;
              const selected = categoryHasSelection(category.id);
              return (
                <button key={category.id} type="button" role="tab" aria-selected={active} onClick={() => selectCategory(category.id)} className={`flex min-h-14 items-center justify-between rounded-2xl border px-4 text-left text-[clamp(0.9rem,1.3vw,1.08rem)] font-black transition ${active ? "border-[#315df3] bg-[#eef2ff] text-[#244ce0] shadow-sm" : "border-slate-200 bg-white text-slate-800 hover:border-[#b8c8ff]"}`}>
                  <span>{category.label}</span>
                  {selected ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <ArrowRight className="h-5 w-5" />}
                </button>
              );
            })}
          </div>
        </ShowroomPanel>

        <section className="mt-3" data-sleep-essentials-category={activeCategoryId}>
          <div className="mb-2 flex items-center gap-2 rounded-2xl border border-[#dce6ff] bg-[#f4f7ff] px-4 py-2.5 text-sm font-bold leading-snug text-slate-700">
            <span className="shrink-0 font-black text-[#315cf6]">Snoozer:</span><span>{guidance}</span>
          </div>

          {error ? <div className="mb-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 font-semibold text-amber-900">{error} <button type="button" onClick={hydrate} className="ml-2 underline">Try again</button></div> : null}

          {loading ? (
            <ShowroomPanel className="flex min-h-64 items-center justify-center gap-3 text-slate-600"><Loader2 className="h-6 w-6 animate-spin" /> Loading live Sleep Essentials...</ShowroomPanel>
          ) : displayedProducts.length ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" data-sleep-essentials-product-grid="true">
              {displayedProducts.map((product) => {
                const variants = getAvailableVariants(product);
                const cartVariant = variants.find((variant) => cartVariantIds.has(getVariantId(variant, product)));
                const selectedVariant = variants.find((variant) => getVariantId(variant, product) === selectedVariants[product.handle]) || cartVariant || variants[0] || null;
                const selectedVariantId = getVariantId(selectedVariant, product);
                const image = getProductImage(product);
                const price = selectedVariant?.price ?? product?.price ?? product?.priceRange?.min;
                const currency = selectedVariant?.currencyCode || product?.priceRange?.currencyCode || "USD";
                const busy = workingKey === `added_to_cart:${product.handle}`;
                const inCart = Boolean(selectedVariantId && cartVariantIds.has(selectedVariantId));
                return (
                  <ShowroomPanel key={product.handle} className="flex min-h-[310px] flex-col overflow-hidden p-0" data-sleep-essentials-product-card={product.handle}>
                    <div className="flex h-36 items-center justify-center bg-[linear-gradient(145deg,#f7f9ff,#eef3ff)] p-3">
                      {image ? <img src={image} alt={product.title} className="h-full w-full object-contain" /> : <BedSingle className="h-14 w-14 text-[#8ba6ef]" />}
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <h2 className="line-clamp-2 text-[clamp(1rem,1.45vw,1.25rem)] font-black leading-tight text-slate-950">{product.title}</h2>
                      <div className="mt-1.5 text-xl font-black text-[#2f57e8]">{formatMoney(price, currency)}</div>
                      {variants.length > 1 ? (
                        <select aria-label={`${product.title} option`} value={selectedVariantId} onChange={(event) => setSelectedVariants((current) => ({ ...current, [product.handle]: event.target.value }))} className="mt-2 min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base font-bold">
                          {variants.map((variant) => <option key={getVariantId(variant, product)} value={getVariantId(variant, product)}>{variant.title}</option>)}
                        </select>
                      ) : null}
                      <button type="button" disabled={busy || inCart || !journeyId || !selectedVariantId} onClick={() => addProduct(product, selectedVariant)} className={`mt-auto min-h-12 rounded-xl px-4 pt-0.5 text-base font-black transition disabled:cursor-not-allowed ${inCart ? "bg-emerald-100 text-emerald-800" : "bg-[#315df3] text-white disabled:opacity-50"}`}>
                        {busy ? "Adding..." : inCart ? "✓ In Cart" : "Add to Cart"}
                      </button>
                    </div>
                  </ShowroomPanel>
                );
              })}
            </div>
          ) : (
            <ShowroomPanel className="flex min-h-48 items-center justify-center p-6 text-center text-slate-600">No approved products are available in this category right now.</ShowroomPanel>
          )}
        </section>

        <ShowroomPanel className="sticky bottom-3 z-10 mt-3 flex items-center justify-between gap-3 p-3.5 shadow-[0_18px_44px_rgba(30,55,110,0.18)]">
          <button type="button" onClick={() => navigate(returnTo)} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 font-black text-slate-800">
            <ArrowLeft className="h-5 w-5" /> {enteredFromPod ? "Return to Pod" : "Back"}
          </button>
          <button type="button" onClick={finishExperience} disabled={Boolean(workingKey)} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#315df3] px-6 font-black text-white disabled:opacity-50">
            {workingKey === "finish" ? "Finishing..." : "Finish Sleep Essentials"} <ArrowRight className="h-5 w-5" />
          </button>
        </ShowroomPanel>
      </main>
    </ShowroomPageShell>
  );
}
