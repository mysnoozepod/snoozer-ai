const PRODUCT_VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[^\s/?#]+$/;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function firstText(values = []) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function selectedOptions(value) {
  return (Array.isArray(value) ? value : [])
    .map((option) => ({ name: text(option?.name), value: text(option?.value) }))
    .filter((option) => option.name && option.value)
    .slice(0, 8);
}

function imageUrl(value) {
  const candidate = text(value);
  if (!candidate) return null;
  if (/^(https?:)?\/\//i.test(candidate) || candidate.startsWith("/") || /^data:image\//i.test(candidate)) {
    return candidate;
  }
  return null;
}

function normalizeVariant(variant = {}) {
  const id = firstText([variant.id, variant.variantId, variant.merchandiseId]);
  if (!PRODUCT_VARIANT_GID.test(id)) return null;
  return {
    id,
    title: text(variant.title) || null,
    available: variant.available === true || variant.availableForSale === true,
    price: finiteNumber(variant?.price?.amount ?? variant.price),
    currencyCode: firstText([variant?.price?.currencyCode, variant.currencyCode]) || "USD",
    selectedOptions: selectedOptions(variant.selectedOptions),
    imageUrl: imageUrl(firstText([variant?.image?.url, variant?.image?.src])),
  };
}

export function isValidProductVariantGid(value) {
  return PRODUCT_VARIANT_GID.test(text(value));
}

export function normalizeAskStationProduct(item = {}) {
  if (!item || typeof item !== "object") return null;
  const handle = firstText([item.handle, item.slug]);
  const id = firstText([item.id, handle, item.title]);
  const title = firstText([item.title, item.name, item.label, handle]);
  if (!id || !title) return null;
  const variants = (Array.isArray(item.variants) ? item.variants : [])
    .map(normalizeVariant)
    .filter(Boolean)
    .slice(0, 50);
  const resolvedId = firstText([
    item.merchandiseId,
    item.variantId,
    item.meta?.merchandiseId,
    item.meta?.variantId,
  ]);
  const exactVariantResolved =
    item.exactVariantResolved === true && isValidProductVariantGid(resolvedId);
  const priceAmount = finiteNumber(item?.price?.amount ?? item.price);
  const rangeMin = finiteNumber(item?.priceRange?.min ?? item?.priceRange?.minVariantPrice?.amount);
  const rangeMax = finiteNumber(item?.priceRange?.max ?? item?.priceRange?.maxVariantPrice?.amount);
  const currencyCode =
    firstText([
      item?.price?.currencyCode,
      item?.price?.currency,
      item?.priceRange?.currencyCode,
      item.currencyCode,
    ]) || "USD";
  const url = firstText([item.url, item.href, item.meta?.url, handle ? `/products/${handle}` : ""]);
  const resolvedImageUrl = imageUrl(
    firstText([
      item.imageUrl,
      item.image?.url,
      item.image?.src,
      item.featuredImage?.url,
      item.images?.[0]?.url,
    ])
  );

  return {
    type: firstText([item.type, item.kind, item.category]) || "product",
    id,
    handle: handle || null,
    title,
    subtitle: firstText([item.subtitle, item.description, item.summary, item.vendor]) || null,
    url: url || null,
    imageUrl: resolvedImageUrl,
    price: priceAmount,
    priceFormatted: text(item?.price?.formatted) || null,
    priceRange: {
      min: rangeMin ?? priceAmount,
      max: rangeMax ?? priceAmount,
      currencyCode,
    },
    available:
      typeof item.available === "boolean"
        ? item.available
        : typeof item.meta?.available === "boolean"
          ? item.meta.available
          : null,
    variants,
    selectedOptions: selectedOptions(item.selectedOptions),
    variantId: exactVariantResolved ? resolvedId : null,
    merchandiseId: exactVariantResolved ? resolvedId : null,
    exactVariantResolved,
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
  };
}

export function normalizeAskStationAction(action = {}) {
  if (!action || typeof action !== "object") return null;
  const type = text(action.type).toLowerCase();
  const allowed = new Set([
    "navigate",
    "start_assessment",
    "open_builder",
    "request_human",
    "view_recommendation",
    "add_to_cart",
  ]);
  if (!allowed.has(type)) return null;
  const label = firstText([action.label, action.title, action.text]);
  if (!label) return null;
  const payload = action.payload && typeof action.payload === "object" ? action.payload : {};
  if (type === "add_to_cart") {
    const merchandiseId = firstText([payload.merchandiseId, payload.variantId]);
    if (!isValidProductVariantGid(merchandiseId)) return null;
    return {
      type,
      label,
      target: null,
      payload: {
        merchandiseId,
        variantId: merchandiseId,
        quantity: Math.max(1, Math.floor(Number(payload.quantity) || 1)),
        handle: text(payload.handle) || null,
        title: text(payload.title) || "Product",
        imageUrl: imageUrl(payload.imageUrl),
        unitPrice: finiteNumber(payload.unitPrice),
        selectedOptions: selectedOptions(payload.selectedOptions),
      },
    };
  }
  return {
    type,
    label,
    target: firstText([action.target, action.url]) || null,
    payload: {},
  };
}

export function buildProductAddAction(product = {}) {
  if (
    product?.exactVariantResolved !== true ||
    product?.available !== true ||
    !isValidProductVariantGid(product?.merchandiseId)
  ) {
    return null;
  }
  return normalizeAskStationAction({
    type: "add_to_cart",
    label: "Add to Cart",
    payload: {
      merchandiseId: product.merchandiseId,
      quantity: 1,
      handle: product.handle,
      title: product.title,
      imageUrl: product.imageUrl,
      unitPrice: product.price,
      selectedOptions: product.selectedOptions,
    },
  });
}

export function buildComparePrompt(product, products = []) {
  const primary = text(product?.handle);
  if (!primary) return "Compare Products";
  const second = (Array.isArray(products) ? products : []).find(
    (candidate) => text(candidate?.handle) && text(candidate?.handle) !== primary
  );
  return second?.handle
    ? `Compare ${primary} with ${text(second.handle)}`
    : `Compare Products with ${primary}`;
}

export function formatProductPrice(product = {}) {
  if (text(product.priceFormatted) && text(product.priceFormatted) !== "-") {
    return text(product.priceFormatted);
  }
  const min = finiteNumber(product?.priceRange?.min ?? product.price);
  const max = finiteNumber(product?.priceRange?.max ?? product.price);
  if (min === null) return "";
  const currencyCode = text(product?.priceRange?.currencyCode) || "USD";
  const format = (amount) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(amount);
    } catch {
      return `$${amount.toFixed(2)}`;
    }
  };
  return max !== null && max !== min ? `${format(min)}–${format(max)}` : format(min);
}

export function cartItemCount(cart = []) {
  return (Array.isArray(cart) ? cart : []).reduce(
    (sum, item) => sum + Math.max(1, Math.floor(Number(item?.quantity) || 1)),
    0
  );
}
