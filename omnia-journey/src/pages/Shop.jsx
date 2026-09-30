import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  Search,
  ShoppingCart,
  Sparkles,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import CommerceHeader from "@/components/showroom/CommerceHeader";
import HumanAssistanceControl from "@/components/HumanAssistanceControl";
import RewardsPill from "@/components/RewardsPill";
import {
  ShowroomPageShell,
  ShowroomPanel,
} from "@/components/showroom/ShowroomPrimitives";
import { canNavigateTo } from "@/device/deviceActionGuards";
import { useDeviceMode } from "@/device/useDeviceMode";
import { getShowroomCommerceCatalog } from "@/lib/api";
import { confirmedCartItemCount } from "@/lib/cart/cartAuthority.mjs";
import { commerceNavigationState, resolveCommerceOrigin } from "@/lib/commerceNavigation";
import { useStore } from "@/lib/useStore";
import { useSnoozer } from "@/Layout";
import { getShopperId } from "@/state/sessionStore";

const SORT_OPTIONS = [
  { value: "featured", label: "Featured" },
  { value: "price-low", label: "Price: Low to High" },
  { value: "price-high", label: "Price: High to Low" },
  { value: "name", label: "Name" },
];

function money(value, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Price available in store";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function productImages(product) {
  const source = [
    ...(Array.isArray(product?.images) ? product.images : []),
    product?.featuredImage,
    product?.image,
    product?.imageUrl,
  ];
  const seen = new Set();
  return source
    .map((item) => ({
      url: String(item?.url || item?.imageUrl || (typeof item === "string" ? item : "")).trim(),
      alt: String(item?.alt || item?.altText || product?.title || "Product").trim(),
    }))
    .filter((item) => item.url && !seen.has(item.url) && seen.add(item.url));
}

function variantsFor(product) {
  return Array.isArray(product?.variants) ? product.variants : [];
}

function variantId(variant, product) {
  return String(
    variant?.id || variant?.merchandiseId || product?.firstAvailableVariantId || product?.variantId || ""
  ).trim();
}

function variantAvailable(variant) {
  return variant?.available !== false && variant?.availableForSale !== false;
}

function variantLabel(variant) {
  const selected = Array.isArray(variant?.selectedOptions)
    ? variant.selectedOptions.map((option) => `${option.name}: ${option.value}`).join(" · ")
    : "";
  return selected || String(variant?.title || "Default option");
}

function lowestPrice(product) {
  return Number(product?.priceRange?.min ?? product?.price ?? 0) || 0;
}

function recommendationHandles(recommendations, explicitHandles) {
  const values = [
    ...(Array.isArray(explicitHandles) ? explicitHandles : []),
    ...(Array.isArray(recommendations?.pods)
      ? recommendations.pods.flatMap((pod) => [pod?.mattressHandle, pod?.handle, pod?.productHandle])
      : []),
  ];
  return new Set(values.map((value) => String(value || "").trim()).filter(Boolean));
}

function CatalogSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-shop-loading="true">
      {Array.from({ length: 9 }, (_, index) => (
        <ShowroomPanel key={index} className="min-h-[390px] overflow-hidden p-0">
          <div className="h-52 animate-pulse bg-[#e8efff]" />
          <div className="space-y-3 p-4">
            <div className="h-5 w-4/5 animate-pulse rounded-full bg-slate-200" />
            <div className="h-4 w-2/5 animate-pulse rounded-full bg-slate-100" />
            <div className="h-7 w-1/3 animate-pulse rounded-full bg-[#dce6ff]" />
            <div className="h-12 animate-pulse rounded-xl bg-[#dce6ff]" />
          </div>
        </ShowroomPanel>
      ))}
    </div>
  );
}

function QuickView({ product, open, onOpenChange, onAdd, onViewDetails, adding, inCart, canViewDetails }) {
  const images = useMemo(() => productImages(product), [product]);
  const variants = useMemo(() => variantsFor(product), [product]);
  const firstAvailable = useMemo(
    () => variants.find(variantAvailable) || null,
    [variants]
  );
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [activeImage, setActiveImage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setSelectedVariantId(firstAvailable ? variantId(firstAvailable, product) : "");
    setActiveImage(0);
    setImageFailed(false);
  }, [firstAvailable, product]);

  const selectedVariant = variants.find((variant) => variantId(variant, product) === selectedVariantId) || firstAvailable;
  const selectedPrice = selectedVariant?.price ?? product?.priceRange?.min ?? product?.price;
  const selectedCurrency = selectedVariant?.currencyCode || product?.priceRange?.currencyCode || "USD";
  const selectedAvailable = Boolean(selectedVariant && variantAvailable(selectedVariant));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content
          className="fixed bottom-0 right-0 top-0 z-[120] flex w-full max-w-[570px] flex-col overflow-hidden border-l border-white/80 bg-[#f8faff] shadow-[-24px_0_70px_rgba(24,43,96,0.2)] focus:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right"
          data-shop-quick-view="true"
        >
          <div className="flex items-center justify-between border-b border-[#dce5fb] bg-white/90 px-5 py-4">
            <div>
              <div className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-[#2f57e8]">Quick View</div>
              <Dialog.Title className="mt-1 text-xl font-black text-slate-950">{product?.title || "Product"}</Dialog.Title>
            </div>
            <Dialog.Close className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]" aria-label="Close Quick View">
              <X className="h-5 w-5" aria-hidden="true" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="relative flex min-h-[280px] items-center justify-center overflow-hidden rounded-[26px] border border-white bg-white p-5 shadow-[0_18px_50px_rgba(40,63,126,0.09)]">
              {images[activeImage]?.url && !imageFailed ? (
                <img
                  src={images[activeImage].url}
                  alt={images[activeImage].alt}
                  className="h-[270px] w-full object-contain"
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <div className="flex h-[270px] w-full items-center justify-center rounded-2xl bg-slate-100 text-sm font-bold text-slate-500">Image unavailable</div>
              )}
            </div>

            {images.length > 1 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Product images">
                {images.map((image, index) => (
                  <button
                    key={image.url}
                    type="button"
                    onClick={() => { setActiveImage(index); setImageFailed(false); }}
                    className={`flex h-16 w-20 shrink-0 items-center justify-center rounded-xl border bg-white p-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff] ${index === activeImage ? "border-[#2f57e8]" : "border-slate-200"}`}
                    aria-label={`View product image ${index + 1}`}
                  >
                    <img src={image.url} alt="" className="h-full w-full object-contain" />
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-black text-[#2f57e8]">{product?.commerceCategoryLabel}</div>
                <div className="mt-1 text-[1.85rem] font-black tracking-tight text-slate-950">{money(selectedPrice, selectedCurrency)}</div>
              </div>
              {inCart ? (
                <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-800"><Check className="h-4 w-4" /> In Your Cart</span>
              ) : null}
            </div>

            <Dialog.Description className="mt-3 text-sm font-semibold leading-6 text-slate-600">
              {product?.description || "Select an available option to add this product to your showroom cart."}
            </Dialog.Description>

            <label className="mt-5 block text-sm font-black text-slate-800" htmlFor="shop-quick-view-variant">Choose an available option</label>
            <select
              id="shop-quick-view-variant"
              value={selectedVariantId}
              onChange={(event) => setSelectedVariantId(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]"
              disabled={!variants.length}
            >
              {variants.map((variant) => (
                <option key={variantId(variant, product)} value={variantId(variant, product)} disabled={!variantAvailable(variant)}>
                  {variantLabel(variant)} — {variantAvailable(variant) ? money(variant.price, variant.currencyCode) : "Unavailable"}
                </option>
              ))}
            </select>

            {!selectedAvailable ? (
              <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900" role="status">This option is currently unavailable from Shopify.</p>
            ) : null}
          </div>

          <div className="border-t border-[#dce5fb] bg-white p-5">
            <button
              type="button"
              onClick={() => onAdd(product, selectedVariant)}
              disabled={!selectedAvailable || adding}
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-[#2f57e8] px-5 text-base font-black text-white shadow-[0_18px_38px_rgba(47,87,232,0.24)] transition hover:bg-[#203fc1] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff] disabled:opacity-55"
            >
              {adding ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShoppingCart className="h-5 w-5" />}
              {adding ? "Adding to Cart..." : "Add to Cart"}
            </button>
            {canViewDetails ? (
              <button
                type="button"
                onClick={() => onViewDetails(product)}
                className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[18px] border border-[#b7c8ff] bg-white px-5 text-sm font-black text-[#2f57e8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]"
              >
                View Full Details <ArrowRight className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function Shop() {
  const navigate = useNavigate();
  const location = useLocation();
  const device = useDeviceMode();
  const { openRewards } = useSnoozer() || {};
  const shopperId = getShopperId() || "";
  const cart = useStore((state) => state.cart || []);
  const recommendations = useStore((state) => state.recommendations);
  const recommendedProductHandles = useStore((state) => state.recommendedProductHandles || []);
  const addLinesToAuthoritativeCart = useStore((state) => state.addLinesToAuthoritativeCart);
  const syncCartFromShopify = useStore((state) => state.syncCartFromShopify);

  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const [quickViewProduct, setQuickViewProduct] = useState(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [failedImages, setFailedImages] = useState(() => new Set());
  const quickViewTriggerRef = useRef(null);

  const hydrate = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getShowroomCommerceCatalog();
      if (!Array.isArray(next?.products)) throw new Error("The approved catalog response was incomplete.");
      setCatalog(next);
      void syncCartFromShopify?.({ sourcePage: "shop" }).catch(() => {});
    } catch (requestError) {
      setError(requestError?.message || "Products are temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [syncCartFromShopify]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const cartCount = useMemo(() => confirmedCartItemCount(cart), [cart]);
  const cartVariantIds = useMemo(
    () => new Set(cart.map((item) => String(item?.merchandiseId || item?.variantId || "")).filter(Boolean)),
    [cart]
  );
  const recommendedHandles = useMemo(
    () => recommendationHandles(recommendations, recommendedProductHandles),
    [recommendations, recommendedProductHandles]
  );
  const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
  const allProducts = Array.isArray(catalog?.products) ? catalog.products : [];
  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = allProducts.filter((product) => {
      if (activeCategory !== "all" && product.commerceCategoryId !== activeCategory) return false;
      if (!needle) return true;
      const searchable = [
        product.title,
        product.handle,
        product.description,
        product.commerceCategoryLabel,
        ...(Array.isArray(product.tags) ? product.tags : []),
      ].join(" ").toLowerCase();
      return searchable.includes(needle);
    });

    return [...filtered].sort((a, b) => {
      if (sort === "price-low") return lowestPrice(a) - lowestPrice(b) || a.featuredRank - b.featuredRank;
      if (sort === "price-high") return lowestPrice(b) - lowestPrice(a) || a.featuredRank - b.featuredRank;
      if (sort === "name") return String(a.title || "").localeCompare(String(b.title || ""));
      return Number(a.featuredRank || 0) - Number(b.featuredRank || 0);
    });
  }, [activeCategory, allProducts, query, sort]);

  const origin = resolveCommerceOrigin(location.state, "/results");

  async function addProduct(product, variant) {
    const merchandiseId = variantId(variant, product);
    if (!merchandiseId || !variantAvailable(variant)) return;
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const isEssential = ["pillows", "sheets_bedding", "protectors"].includes(product.commerceCategoryId);
      await addLinesToAuthoritativeCart({
        sourcePage: "shop",
        lines: [{
          merchandiseId,
          quantity: 1,
          attributes: [
            { key: "_Source", value: "Shop" },
            { key: "_Shop Category", value: product.commerceCategoryId },
            ...(isEssential ? [{ key: "_Sleep Essential", value: product.commerceCategoryId }] : []),
          ],
        }],
      });
      setNotice(`${product.title} added to your Shopify cart.`);
      setQuickViewProduct(null);
    } catch (mutationError) {
      setError(mutationError?.message || "We could not add that product to your cart.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <ShowroomPageShell className="min-h-screen pb-8" data-shop-page="true">
      <div className="mx-auto w-full max-w-[1480px] px-4 py-3 md:px-5">
        <CommerceHeader
          active="shop"
          cartCount={cartCount}
          rewards={shopperId ? <RewardsPill shopperId={shopperId} onClick={openRewards} placement="inline" /> : null}
          humanHelp={<HumanAssistanceControl compact showNoticeMessage={false} sourcePage="/shop" />}
        />
      </div>

      <main className="mx-auto w-full max-w-[1480px] px-4 pb-8 md:px-5">
        <ShowroomPanel className="overflow-hidden p-0" data-shop-hero="true">
          <div className="grid min-h-[190px] items-center gap-4 bg-[radial-gradient(circle_at_78%_20%,rgba(183,205,255,0.78),transparent_36%),linear-gradient(135deg,#ffffff,#edf3ff)] px-6 py-5 md:grid-cols-[minmax(0,1fr)_340px] md:px-8">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.22em] text-[#2f57e8]">MySnoozePod Shop</div>
              <h1 className="mt-2 max-w-2xl text-[clamp(2rem,4vw,3.2rem)] font-black leading-[0.95] tracking-tight text-slate-950">Find what fits your best sleep.</h1>
              <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-600 md:text-base">Browse the mattresses, bases, pillows, bedding, and protectors approved for this showroom.</p>
              {origin.path !== "/results" || location.state?.commerceOrigin ? (
                <button type="button" onClick={() => navigate(origin.path)} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-2xl border border-[#c8d5ff] bg-white px-4 text-sm font-black text-[#2f57e8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]">
                  <ArrowLeft className="h-4 w-4" /> {origin.label}
                </button>
              ) : null}
            </div>
            <button type="button" onClick={() => navigate("/ask-snoozer", { state: commerceNavigationState(location) })} className="group flex min-h-[120px] items-center gap-4 rounded-[28px] border border-white/90 bg-white/82 px-5 text-left shadow-[0_18px_50px_rgba(40,63,126,0.1)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]">
              <img src="/snoozer-avatar.png" alt="Snoozer" className="h-24 w-24 shrink-0 object-contain" />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-black text-slate-950">Need help choosing?</span>
                <span className="mt-1 block text-sm font-semibold leading-5 text-slate-600">Ask Snoozer for guidance grounded in your sleep profile.</span>
              </span>
              <ChevronRight className="h-5 w-5 text-[#2f57e8] transition group-hover:translate-x-1" />
            </button>
          </div>
        </ShowroomPanel>

        {notice ? <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-900" role="status">{notice}</div> : null}
        {error && catalog ? <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950" role="alert">{error}</div> : null}

        <div className="mt-3 grid items-start gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <ShowroomPanel className="sticky top-3 hidden p-3 lg:block" data-shop-categories="true">
            <div className="px-2 pb-2 text-[0.68rem] font-black uppercase tracking-[0.2em] text-slate-400">Shop by Category</div>
            {[{ id: "all", label: "All Products", handles: allProducts.map((product) => product.handle) }, ...categories].map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                aria-current={activeCategory === category.id ? "true" : undefined}
                className={`mt-1 flex min-h-12 w-full items-center justify-between rounded-2xl px-3 text-left text-sm font-black transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff] ${activeCategory === category.id ? "bg-[#2f57e8] text-white shadow-[0_12px_28px_rgba(47,87,232,0.24)]" : "text-slate-700 hover:bg-[#eef3ff]"}`}
              >
                <span>{category.label}</span><span className={activeCategory === category.id ? "text-white/80" : "text-slate-400"}>{category.handles?.length || 0}</span>
              </button>
            ))}
          </ShowroomPanel>

          <div className="min-w-0">
            <ShowroomPanel className="p-3" data-shop-toolbar="true">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <label className="relative block">
                  <span className="sr-only">Search products</span>
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#2f57e8]" aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search products, features, or brands..."
                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff]"
                  />
                </label>
                <label className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-500">
                  Sort by
                  <select value={sort} onChange={(event) => setSort(event.target.value)} className="min-h-10 min-w-0 flex-1 bg-transparent text-sm font-black text-slate-900 focus:outline-none" aria-label="Sort products">
                    {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="Product categories">
                {[{ id: "all", label: "All Products" }, ...categories].map((category) => (
                  <button key={category.id} type="button" onClick={() => setActiveCategory(category.id)} className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-black ${activeCategory === category.id ? "border-[#2f57e8] bg-[#2f57e8] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{category.label}</button>
                ))}
              </div>
            </ShowroomPanel>

            <div className="mt-3 flex items-center justify-between gap-3 px-1">
              <div>
                <h2 className="text-2xl font-black text-slate-950">{activeCategory === "all" ? "All Products" : categories.find((category) => category.id === activeCategory)?.label}</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">{visibleProducts.length} approved {visibleProducts.length === 1 ? "product" : "products"}</p>
              </div>
            </div>

            <div className="mt-3">
              {loading ? (
                <CatalogSkeleton />
              ) : error && !catalog ? (
                <ShowroomPanel className="flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center" data-shop-error="true">
                  <Loader2 className="h-8 w-8 text-[#2f57e8]" />
                  <div className="text-xl font-black text-slate-950">Products are temporarily unavailable.</div>
                  <p className="max-w-lg text-sm font-semibold text-slate-600">No products are shown until the approved Shopify catalog is available.</p>
                  <button type="button" onClick={hydrate} className="min-h-12 rounded-2xl bg-[#2f57e8] px-5 font-black text-white">Try Again</button>
                </ShowroomPanel>
              ) : visibleProducts.length ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-shop-product-grid="true">
                  {visibleProducts.map((product, index) => {
                    const images = productImages(product);
                    const imageFailed = failedImages.has(product.handle);
                    const productVariants = variantsFor(product);
                    const availableVariant = productVariants.find(variantAvailable);
                    const inCart = productVariants.some((variant) => cartVariantIds.has(variantId(variant, product)));
                    const recommended = recommendedHandles.has(product.handle);
                    return (
                      <ShowroomPanel key={product.handle} className="flex min-h-[420px] flex-col overflow-hidden p-0" data-shop-product-card={product.handle}>
                        <button type="button" onClick={(event) => { quickViewTriggerRef.current = event.currentTarget; setQuickViewProduct(product); }} className="relative flex h-52 items-center justify-center bg-[linear-gradient(145deg,#f8faff,#edf3ff)] p-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#9db2ff]" aria-label={`Quick View ${product.title}`}>
                          <span className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
                            {recommended ? <span className="inline-flex min-h-7 items-center gap-1 rounded-full bg-[#2f57e8] px-3 text-[11px] font-black text-white"><Sparkles className="h-3.5 w-3.5" /> Recommended for You</span> : null}
                            {inCart ? <span className="inline-flex min-h-7 items-center gap-1 rounded-full bg-emerald-600 px-3 text-[11px] font-black text-white"><Check className="h-3.5 w-3.5" /> In Your Cart</span> : null}
                          </span>
                          {images[0]?.url && !imageFailed ? (
                            <img src={images[0].url} alt={images[0].alt} loading={index < 6 ? "eager" : "lazy"} decoding="async" className="h-full w-full object-contain" onError={() => setFailedImages((current) => new Set(current).add(product.handle))} />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center rounded-2xl bg-white/70 text-sm font-bold text-slate-500">Image unavailable</span>
                          )}
                        </button>
                        <div className="flex flex-1 flex-col p-4">
                          <div className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-[#2f57e8]">{product.commerceCategoryLabel}</div>
                          <h3 className="mt-1 text-[1.05rem] font-black leading-tight text-slate-950">{product.title}</h3>
                          <div className="mt-2 text-xl font-black text-[#2f57e8]">{money(lowestPrice(product), product?.priceRange?.currencyCode)}</div>
                          <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">{product.description || "View available Shopify options and product details."}</p>
                          <div className="mt-auto pt-4">
                            <button type="button" onClick={(event) => { quickViewTriggerRef.current = event.currentTarget; setQuickViewProduct(product); }} disabled={!availableVariant} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#2f57e8] px-4 text-sm font-black text-white transition hover:bg-[#203fc1] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9db2ff] disabled:bg-slate-300">
                              {availableVariant ? "Quick View" : "Unavailable"}<ArrowRight className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </ShowroomPanel>
                    );
                  })}
                </div>
              ) : (
                <ShowroomPanel className="flex min-h-64 items-center justify-center p-8 text-center">
                  <div><div className="text-xl font-black text-slate-950">No approved products match.</div><p className="mt-2 text-sm font-semibold text-slate-600">Try another category or search term.</p></div>
                </ShowroomPanel>
              )}
            </div>
          </div>
        </div>
      </main>

      {quickViewProduct ? (
        <QuickView
          product={quickViewProduct}
          open={Boolean(quickViewProduct)}
          onOpenChange={(open) => {
            if (open) return;
            setQuickViewProduct(null);
            window.requestAnimationFrame(() => quickViewTriggerRef.current?.focus());
          }}
          onAdd={addProduct}
          onViewDetails={(product) => {
            setQuickViewProduct(null);
            navigate(`/products/${product.handle}`, { state: commerceNavigationState(location) });
          }}
          adding={adding}
          canViewDetails={canNavigateTo(device, `/products/${quickViewProduct.handle}`)}
          inCart={variantsFor(quickViewProduct).some((variant) => cartVariantIds.has(variantId(variant, quickViewProduct)))}
        />
      ) : null}
    </ShowroomPageShell>
  );
}
