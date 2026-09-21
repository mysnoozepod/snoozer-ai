"use strict";

const {
  resolveApprovedVariant,
  setupSizeForSelection,
} = require("./commerceConfigurationResolver");

const PRODUCT_VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[^\s/?#]+$/;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeSelectedOptions(options = []) {
  return (Array.isArray(options) ? options : [])
    .map((option) => ({ name: clean(option?.name), value: clean(option?.value) }))
    .filter((option) => option.name && option.value)
    .slice(0, 8);
}

function normalizeVariants(product = {}) {
  const source = Array.isArray(product?.variants)
    ? product.variants
    : Array.isArray(product?.variants?.nodes)
      ? product.variants.nodes
      : Array.isArray(product?.variants?.edges)
        ? product.variants.edges.map((edge) => edge?.node).filter(Boolean)
        : [];
  return source.map((variant) => {
    const id = clean(variant?.id || variant?.variantId || variant?.merchandiseId);
    if (!PRODUCT_VARIANT_GID.test(id)) return null;
    const amount = Number(variant?.price?.amount ?? variant?.price);
    return {
      ...variant,
      id,
      title: clean(variant?.title) || null,
      available: variant?.available === true || variant?.availableForSale === true,
      availableForSale: variant?.available === true || variant?.availableForSale === true,
      price: Number.isFinite(amount) ? amount : null,
      currencyCode: clean(variant?.price?.currencyCode || variant?.currencyCode) || "USD",
      selectedOptions: normalizeSelectedOptions(variant?.selectedOptions),
    };
  }).filter(Boolean);
}

function normalizePriceRange(product = {}) {
  const min = Number(product?.priceRange?.min ?? product?.priceRange?.minVariantPrice?.amount);
  const max = Number(product?.priceRange?.max ?? product?.priceRange?.maxVariantPrice?.amount);
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : Number.isFinite(min) ? min : null,
    currencyCode: clean(
      product?.priceRange?.currencyCode ||
      product?.priceRange?.minVariantPrice?.currencyCode ||
      product?.priceRange?.maxVariantPrice?.currencyCode
    ) || "USD",
  };
}

function commerceCategory(product = {}, explicitCategory = "") {
  const value = clean(explicitCategory || product?.catalogType || product?.productType || product?.type).toLowerCase();
  if (/\b(?:base|adjustable)\b/.test(value) || /adjustable-base/.test(clean(product?.handle))) return "adjustable_base";
  if (/\bpillow\b/.test(value)) return "pillow";
  if (/\bsheet/.test(value)) return "sheets";
  if (/\bprotector\b/.test(value)) return "protector";
  return "mattress";
}

function imageUrl(product = {}, variant = null) {
  return clean(
    variant?.image?.url ||
    product?.imageUrl ||
    product?.image?.url ||
    product?.featuredImage?.url ||
    product?.images?.[0]?.url
  ) || null;
}

function buildProductCardTruth(product = {}, {
  activeSize = "",
  motionType = "standard",
  category = "",
  descriptor = "",
} = {}) {
  const handle = clean(product?.handle);
  if (!handle) return null;
  const variants = normalizeVariants(product);
  const priceRange = normalizePriceRange(product);
  const requestedSize = clean(activeSize);
  const resolvedCategory = commerceCategory(product, category);
  const base = {
    ...product,
    type: clean(product?.type || product?.catalogType) || "product",
    id: clean(product?.id) || handle,
    handle,
    title: clean(product?.title || product?.name) || handle,
    subtitle: clean(descriptor || product?.subtitle || product?.description).slice(0, 220) || null,
    url: `/products/${handle}`,
    href: `/products/${handle}`,
    imageUrl: imageUrl(product),
    priceRange,
    variants,
    aggregateAvailable:
      typeof product?.available === "boolean"
        ? product.available
        : typeof product?.availableForSale === "boolean"
          ? product.availableForSale
          : variants.some((variant) => variant.availableForSale),
  };

  if (!requestedSize) {
    return {
      ...base,
      price: null,
      currencyCode: priceRange.currencyCode,
      pricingMode: "starting_at",
      priceLabel: "From",
      activeSize: null,
      selectedOptions: [],
      variantId: null,
      merchandiseId: null,
      exactVariantResolved: false,
      availabilityResolved: false,
      available: base.aggregateAvailable,
      pricingReason: Number.isFinite(priceRange.min) ? "active_size_unknown" : "starting_price_unavailable",
    };
  }

  const resolution = resolveApprovedVariant({
    product: { ...product, variants },
    category: resolvedCategory,
    setupSize: setupSizeForSelection(requestedSize),
    motionType: clean(motionType) || "standard",
    requestedOption: resolvedCategory === "mattress" ? requestedSize : "",
  });
  const variant = resolution.ok ? resolution.variant : null;
  const price = Number(variant?.price?.amount ?? variant?.price);
  if (!variant || !Number.isFinite(price)) {
    return {
      ...base,
      price: null,
      currencyCode: priceRange.currencyCode,
      pricingMode: "unresolved",
      priceLabel: null,
      activeSize: requestedSize,
      selectedOptions: [],
      variantId: null,
      merchandiseId: null,
      exactVariantResolved: false,
      availabilityResolved: false,
      available: null,
      pricingReason: resolution.reason || "EXACT_VARIANT_PRICE_MISSING",
    };
  }
  const variantId = clean(resolution.variantId || variant.id);
  const selectedOptions = normalizeSelectedOptions(variant.selectedOptions);
  return {
    ...base,
    imageUrl: imageUrl(product, variant),
    price,
    currencyCode: clean(variant?.price?.currencyCode || variant?.currencyCode) || priceRange.currencyCode,
    pricingMode: "exact_variant",
    priceLabel: null,
    activeSize: requestedSize,
    selectedOptions,
    variantId,
    merchandiseId: variantId,
    firstAvailableVariantId: variantId,
    exactVariantResolved: true,
    availabilityResolved: true,
    available: true,
    availableForSale: true,
    pricingReason: "exact_variant_resolved",
  };
}

module.exports = {
  PRODUCT_VARIANT_GID,
  buildProductCardTruth,
  normalizePriceRange,
  normalizeSelectedOptions,
  normalizeVariants,
};
