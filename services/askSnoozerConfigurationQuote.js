const { loadShowroomManifest } = require("./showroomManifest");
const {
  COMMERCE_CONFIGURATION_VERSION,
  resolveApprovedVariant,
  setupSizeForSelection,
} = require("./commerceConfigurationResolver");

const PRODUCT_VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[^\s/?#]+$/;
const CONFIGURATION_QUOTE_VERSION = "2.0.0";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values = []) {
  return [...new Set(values.map((value) => clean(value).toLowerCase()).filter(Boolean))];
}

function productTitle(handle = "", manifest = loadShowroomManifest()) {
  const product = (manifest?.products || []).find((item) => clean(item?.handle) === clean(handle));
  return clean(product?.title || handle)
    .replace(/(\d+)\s*["”]/g, "$1-inch")
    .replace(/\s+mattress$/i, " Mattress");
}

function variantPrice(variant = {}) {
  const amount = Number(variant?.price?.amount ?? variant?.price);
  return Number.isFinite(amount) ? amount : null;
}

function variantCurrency(variant = {}, product = {}) {
  return clean(
    variant?.price?.currencyCode ||
      variant?.currencyCode ||
      product?.priceRange?.currencyCode ||
      product?.priceRange?.minVariantPrice?.currencyCode ||
      "USD"
  );
}

function productDefinition(handle, manifest = loadShowroomManifest()) {
  return (manifest?.products || []).find(
    (item) => item?.active !== false && clean(item?.handle).toLowerCase() === clean(handle).toLowerCase()
  ) || null;
}

function resolveConfigurationCompatibility({
  mattressHandle = "",
  baseHandle = "",
  motionKey = "none",
  size = "",
  manifest = loadShowroomManifest(),
} = {}) {
  const mattress = productDefinition(mattressHandle, manifest);
  const base = baseHandle ? productDefinition(baseHandle, manifest) : null;
  if (!mattress || mattress.catalogType !== "mattress") {
    return { status: "unresolved", reason: "mattress_not_approved" };
  }
  if (!baseHandle) return { status: "not_applicable", reason: "mattress_only" };
  if (!base || base.catalogType !== "base") {
    return { status: "unresolved", reason: "base_not_approved" };
  }

  const mode = (manifest?.assessmentSchema?.motionModes || []).find(
    (item) => clean(item?.key) === clean(motionKey || "none")
  );
  if (!mode) return { status: "unresolved", reason: "motion_mode_not_approved" };
  if (size && Array.isArray(mode.allowedSizes) && !mode.allowedSizes.includes(size)) {
    return { status: "incompatible", reason: "motion_size_not_supported" };
  }
  if (mode.requiresBaseType && clean(base.family) !== clean(mode.requiresBaseType)) {
    return { status: "incompatible", reason: "motion_requires_different_base" };
  }
  if (mode.requiresDualComfort && mattress?.attributes?.dualComfort !== true) {
    return { status: "incompatible", reason: "split_motion_requires_dual_comfort" };
  }
  if (clean(motionKey) !== "none" && base?.attributes?.supportsMotion !== true) {
    return { status: "incompatible", reason: "base_does_not_support_motion" };
  }
  if (["half_split", "full_split"].includes(clean(motionKey)) && base?.attributes?.supportsSplitMotion !== true) {
    return { status: "incompatible", reason: "base_does_not_support_split_motion" };
  }
  return {
    status: "compatible",
    reason: base?.attributes?.supportsMotion === true ? "approved_motion_pairing" : "standard_foundation",
  };
}

function buildQuoteProduct(product = {}, {
  size = "",
  motionKey = "none",
  category = "mattress",
  setupSize = "",
  manifest = loadShowroomManifest(),
} = {}) {
  const definition = productDefinition(product?.handle, manifest);
  if (!definition) return null;
  const resolution = resolveApprovedVariant({
    product,
    category,
    setupSize: setupSize || setupSizeForSelection(size),
    motionType: motionKey || "standard",
    requestedOption: category === "mattress" ? size : "",
  });
  if (!resolution.ok) return null;
  const variant = resolution.variant;
  const price = variantPrice(variant);
  const variantId = clean(resolution.variantId || variant?.id);
  if (!Number.isFinite(price) || !PRODUCT_VARIANT_GID.test(variantId)) return null;
  return {
    handle: clean(product.handle).toLowerCase(),
    title: productTitle(product.handle, manifest),
    productId: clean(product.id),
    variantId,
    variantTitle: clean(variant.title),
    selectedOptions: Array.isArray(variant.selectedOptions) ? variant.selectedOptions : [],
    size,
    motionKey: motionKey || null,
    price,
    currencyCode: variantCurrency(variant, product),
    available: true,
    imageUrl: clean(
      variant?.image?.url || product?.imageUrl || product?.image?.url || product?.images?.[0]?.url
    ) || null,
  };
}

async function quoteConfiguration({
  mattressHandle = "",
  baseHandle = "",
  size = "",
  motionKey = "none",
  fetchProductsByHandles,
  manifest = loadShowroomManifest(),
} = {}) {
  const normalizedMattress = clean(mattressHandle).toLowerCase();
  const normalizedBase = clean(baseHandle).toLowerCase();
  const normalizedMotion = normalizedBase ? clean(motionKey || "standard").toLowerCase() : "none";
  const missing = [];
  if (!normalizedMattress) missing.push("product");
  if (!clean(size)) missing.push("size");
  if (missing.length) {
    return {
      version: CONFIGURATION_QUOTE_VERSION,
      productHandle: normalizedMattress || null,
      baseHandle: normalizedBase || null,
      size: clean(size) || null,
      motionKey: normalizedMotion,
      status: "partial",
      ok: false,
      missing,
      items: [],
      subtotal: null,
      currencyCode: "USD",
      cartReady: false,
      compatibility: { status: "unresolved", reason: "configuration_incomplete" },
    };
  }

  const compatibility = resolveConfigurationCompatibility({
    mattressHandle: normalizedMattress,
    baseHandle: normalizedBase,
    motionKey: normalizedMotion,
    size: clean(size),
    manifest,
  });
  if (compatibility.status === "incompatible" || compatibility.status === "unresolved") {
    return {
      version: CONFIGURATION_QUOTE_VERSION,
      productHandle: normalizedMattress,
      baseHandle: normalizedBase || null,
      size: clean(size),
      motionKey: normalizedMotion,
      status: compatibility.status,
      ok: false,
      missing: [],
      items: [],
      subtotal: null,
      currencyCode: "USD",
      cartReady: false,
      compatibility,
    };
  }

  const handles = unique([normalizedMattress, normalizedBase]);
  let fetched = [];
  try {
    const result = typeof fetchProductsByHandles === "function"
      ? await fetchProductsByHandles({ handles, lite: false })
      : null;
    fetched = Array.isArray(result?.items) ? result.items : [];
  } catch {
    fetched = [];
  }
  const byHandle = new Map(fetched.map((product) => [clean(product?.handle).toLowerCase(), product]));
  const setupSize = setupSizeForSelection(size);
  const items = [];
  const mattress = buildQuoteProduct(byHandle.get(normalizedMattress), {
    size: clean(size), setupSize, motionKey: normalizedMotion, category: "mattress", manifest,
  });
  if (mattress) items.push(mattress);
  if (normalizedBase) {
    const base = buildQuoteProduct(byHandle.get(normalizedBase), {
      size: clean(size), setupSize, motionKey: normalizedMotion, category: "adjustable_base", manifest,
    });
    if (base) items.push(base);
  }
  const unresolvedHandles = handles.filter((handle) => !items.some((item) => item.handle === handle));
  const currencies = unique(items.map((item) => item.currencyCode));
  const ok = !unresolvedHandles.length && items.length === handles.length && currencies.length === 1;
  return {
    version: CONFIGURATION_QUOTE_VERSION,
    configurationContractVersion: COMMERCE_CONFIGURATION_VERSION,
    status: ok ? "complete" : "partial",
    ok,
    size: clean(size),
    setupSize,
    motionKey: normalizedMotion,
    baseHandle: normalizedBase || null,
    productHandle: normalizedMattress,
    items,
    subtotal: ok ? items.reduce((sum, item) => sum + item.price, 0) : null,
    currencyCode: currencies[0] || "USD",
    missing: unresolvedHandles.map((handle) => `variant:${handle}`),
    compatibility,
    cartReady: ok && items.every((item) => PRODUCT_VARIANT_GID.test(item.variantId)),
  };
}

function buildCartAction(quote = {}) {
  if (!quote?.ok || !quote?.cartReady || !Array.isArray(quote?.items) || !quote.items.length) return null;
  const lines = quote.items.map((item) => ({
    merchandiseId: item.variantId,
    variantId: item.variantId,
    quantity: 1,
    handle: item.handle,
    title: item.title,
    imageUrl: item.imageUrl,
    unitPrice: item.price,
    selectedOptions: item.selectedOptions,
  }));
  if (lines.some((line) => !PRODUCT_VARIANT_GID.test(clean(line.merchandiseId)))) return null;
  return {
    type: "add_to_cart",
    label: lines.length > 1 ? "Add complete setup" : `Add ${lines[0].title}`,
    payload: {
      scope: lines.length > 1 ? "bundle" : "product",
      title: lines.length > 1 ? "Complete setup" : lines[0].title,
      itemCount: lines.length,
      lines,
    },
  };
}

module.exports = {
  CONFIGURATION_QUOTE_VERSION,
  PRODUCT_VARIANT_GID,
  buildCartAction,
  buildQuoteProduct,
  quoteConfiguration,
  resolveConfigurationCompatibility,
};
