"use strict";

const PRODUCT_VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[^\s/?#]+$/;
const CART_GID = /^gid:\/\/shopify\/Cart\/[^\s/#?]+(?:\?key=[^#\s]+)?$/;

const STARTER_INTENTS = Object.freeze({
  rewards: "find_rewards",
  cart: "analyze_cart",
  compare: "compare_products",
  motion: "motion_base_features",
  browse: "browse_products",
});

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeQuery(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").replace(/\s+/g, " ");
}

function unique(values = []) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function detectStationIntent(query = "") {
  const text = normalizeQuery(query);
  if (!text) return null;
  if (/\b(find|show|check|explain)\b.*\brewards?\b|^find rewards?$/.test(text)) {
    return STARTER_INTENTS.rewards;
  }
  if (/\b(analy[sz]e|review|inspect|what is in|what s in|show)\b.*\bcart\b|^analy[sz]e my cart$/.test(text)) {
    return STARTER_INTENTS.cart;
  }
  if (/^compare\b/.test(text) || /\bcompare\b.*\b(products?|mattresses?|bases?)\b/.test(text)) {
    return STARTER_INTENTS.compare;
  }
  if (/\b(motion|adjustable)\b.*\b(base|features?)\b|^motion base features?$/.test(text)) {
    return STARTER_INTENTS.motion;
  }
  if (/\b(browse|show me|explore)\b.*\b(products?|mattresses?|bases?)\b|^browse products?$/.test(text)) {
    return STARTER_INTENTS.browse;
  }
  if (/^show me more$/.test(text)) return STARTER_INTENTS.browse;
  return null;
}

function money(value, currencyCode = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: clean(currencyCode) || "USD",
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function imageUrl(product = {}) {
  return clean(
    product.imageUrl ||
      product.image?.url ||
      product.image?.src ||
      product.images?.[0]?.url ||
      product.images?.[0]?.src
  ) || null;
}

function normalizeSelectedOptions(options = []) {
  return (Array.isArray(options) ? options : [])
    .map((option) => ({ name: clean(option?.name), value: clean(option?.value) }))
    .filter((option) => option.name && option.value)
    .slice(0, 8);
}

function normalizeVariants(product = {}) {
  return (Array.isArray(product.variants) ? product.variants : [])
    .map((variant) => {
      const id = clean(variant?.id || variant?.variantId || variant?.merchandiseId);
      if (!PRODUCT_VARIANT_GID.test(id)) return null;
      const amount = Number(variant?.price?.amount ?? variant?.price);
      return {
        id,
        title: clean(variant?.title) || null,
        available: variant?.available === true || variant?.availableForSale === true,
        price: Number.isFinite(amount) ? amount : null,
        currencyCode:
          clean(variant?.price?.currencyCode || variant?.currencyCode) ||
          clean(product?.priceRange?.currencyCode) ||
          "USD",
        selectedOptions: normalizeSelectedOptions(variant?.selectedOptions),
      };
    })
    .filter(Boolean)
    .slice(0, 50);
}

function requestedSize(query = "") {
  const text = normalizeQuery(query).replace(/\btwin\s+xl\b/g, "twinxl");
  const match = text.match(/\b(twinxl|twin|full|queen|king)\b/);
  if (!match) return "";
  return match[1] === "twinxl" ? "Twin XL" : `${match[1][0].toUpperCase()}${match[1].slice(1)}`;
}

function variantMatchesSize(variant, size) {
  const wanted = normalizeQuery(size).replace(/\s+/g, "");
  if (!wanted) return false;
  return normalizeSelectedOptions(variant?.selectedOptions).some((option) => {
    if (normalizeQuery(option.name) !== "size") return false;
    const actual = normalizeQuery(option.value).replace(/\s+/g, "");
    return actual === wanted;
  });
}

function resolveExactVariant(product = {}, query = "") {
  const variants = normalizeVariants(product).filter((variant) => variant.available);
  const size = requestedSize(query);
  if (size) {
    const matches = variants.filter((variant) => variantMatchesSize(variant, size));
    return matches.length === 1 ? matches[0] : null;
  }
  return variants.length === 1 ? variants[0] : null;
}

function normalizePriceRange(product = {}) {
  const min = Number(product?.priceRange?.min ?? product?.priceRange?.minVariantPrice?.amount ?? product?.price);
  const max = Number(product?.priceRange?.max ?? product?.priceRange?.maxVariantPrice?.amount ?? product?.price);
  const currencyCode =
    clean(
      product?.priceRange?.currencyCode ||
        product?.priceRange?.minVariantPrice?.currencyCode ||
        product?.priceRange?.maxVariantPrice?.currencyCode
    ) || "USD";
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : Number.isFinite(min) ? min : null,
    currencyCode,
  };
}

function stationProduct(product = {}, { query = "", descriptor = "" } = {}) {
  const handle = clean(product.handle);
  if (!handle) return null;
  const variants = normalizeVariants(product);
  const exactVariant = resolveExactVariant({ ...product, variants }, query);
  const priceRange = normalizePriceRange(product);
  const description = clean(descriptor || product.subtitle || product.description).slice(0, 220) || null;
  return {
    type: clean(product.type || product.catalogType) || "product",
    id: clean(product.id) || handle,
    handle,
    title: clean(product.title || product.name) || handle,
    subtitle: description,
    url: `/products/${handle}`,
    href: `/products/${handle}`,
    imageUrl: imageUrl(product),
    image: imageUrl(product) ? { url: imageUrl(product), alt: clean(product.image?.alt) || clean(product.title) } : null,
    priceRange,
    price: exactVariant?.price ?? priceRange.min,
    currencyCode: exactVariant?.currencyCode || priceRange.currencyCode,
    available:
      typeof product.available === "boolean"
        ? product.available
        : variants.some((variant) => variant.available),
    variants,
    selectedOptions: exactVariant?.selectedOptions || [],
    variantId: exactVariant?.id || null,
    merchandiseId: exactVariant?.id || null,
    exactVariantResolved: Boolean(exactVariant),
  };
}

function productHandlesFromContext(context = {}) {
  const canonical = context?.canonicalRecommendation || context?.recommendation || {};
  return unique([
    ...(Array.isArray(context.recommendedProductHandles) ? context.recommendedProductHandles : []),
    canonical.primaryMattressHandle,
    canonical.baseHandle,
    canonical.topProductHandle,
  ]);
}

function manifestProducts(manifest = {}) {
  return (Array.isArray(manifest.products) ? manifest.products : []).filter(
    (product) => product?.active !== false && product?.recommendable !== false
  );
}

function chooseBrowseHandles(context = {}, manifest = {}, offset = 0) {
  const allowed = manifestProducts(manifest).map((product) => clean(product.handle));
  const ordered = unique(productHandlesFromContext(context).concat(allowed)).filter((handle) =>
    allowed.includes(handle)
  );
  if (!ordered.length) return [];
  const start = Math.max(0, Number(offset) || 0) % ordered.length;
  return ordered.concat(ordered).slice(start, start + Math.min(3, ordered.length));
}

function extractHandles(query = "", manifest = {}, context = {}) {
  const text = normalizeQuery(query);
  const allowed = manifestProducts(manifest).map((product) => clean(product.handle));
  const named = allowed.filter((handle) => {
    const title = manifestProducts(manifest).find((product) => product.handle === handle)?.title || "";
    return text.includes(normalizeQuery(handle)) || (title && text.includes(normalizeQuery(title)));
  });
  const explicit = Array.isArray(context?.comparisonProductHandles)
    ? context.comparisonProductHandles.filter((handle) => allowed.includes(clean(handle)))
    : [];
  return unique(explicit.concat(named)).slice(0, 2);
}

async function fetchProducts(fetchProductsByHandles, handles) {
  if (typeof fetchProductsByHandles !== "function" || !handles.length) return [];
  const response = await fetchProductsByHandles({ handles, lite: false });
  const items = Array.isArray(response?.items) ? response.items : [];
  const byHandle = new Map(items.map((item) => [clean(item?.handle), item]));
  return handles.map((handle) => byHandle.get(handle)).filter(Boolean);
}

function cartLines(cart = {}) {
  const edges = Array.isArray(cart?.lines?.edges) ? cart.lines.edges : [];
  return edges.map((edge) => edge?.node).filter(Boolean);
}

function cartLineProduct(line = {}) {
  const merchandise = line?.merchandise || {};
  const product = merchandise?.product || {};
  const merchandiseId = clean(merchandise.id);
  const amount = Number(merchandise?.price?.amount);
  return {
    type: "product",
    id: clean(product.id) || clean(product.handle) || merchandiseId,
    handle: clean(product.handle),
    title: clean(product.title) || "Cart item",
    subtitle: clean(merchandise.title) || null,
    url: product.handle ? `/products/${product.handle}` : null,
    href: product.handle ? `/products/${product.handle}` : null,
    imageUrl: imageUrl(merchandise),
    image: imageUrl(merchandise) ? { url: imageUrl(merchandise), alt: clean(product.title) } : null,
    price: Number.isFinite(amount) ? amount : null,
    currencyCode: clean(merchandise?.price?.currencyCode) || "USD",
    priceRange: {
      min: Number.isFinite(amount) ? amount : null,
      max: Number.isFinite(amount) ? amount : null,
      currencyCode: clean(merchandise?.price?.currencyCode) || "USD",
    },
    available: merchandise.availableForSale === true,
    variants: PRODUCT_VARIANT_GID.test(merchandiseId)
      ? [{
          id: merchandiseId,
          title: clean(merchandise.title) || null,
          available: merchandise.availableForSale === true,
          price: Number.isFinite(amount) ? amount : null,
          currencyCode: clean(merchandise?.price?.currencyCode) || "USD",
          selectedOptions: [],
        }]
      : [],
    selectedOptions: [],
    variantId: PRODUCT_VARIANT_GID.test(merchandiseId) ? merchandiseId : null,
    merchandiseId: PRODUCT_VARIANT_GID.test(merchandiseId) ? merchandiseId : null,
    exactVariantResolved: PRODUCT_VARIANT_GID.test(merchandiseId),
    quantity: Math.max(1, Number(line.quantity) || 1),
  };
}

function response(intent, reply, extra = {}) {
  const spokenSource = clean(extra.speech || reply);
  const spokenSentences = spokenSource.match(/[^.!?]+[.!?]+/g) || [spokenSource];
  return {
    intent,
    reply,
    speech: clean(spokenSentences.slice(0, 2).join(" ")),
    products: Array.isArray(extra.products) ? extra.products : [],
    actions: Array.isArray(extra.actions) ? extra.actions : [],
    chips: Array.isArray(extra.chips) ? extra.chips : [],
    contextPatch: extra.contextPatch || {},
    grounded: extra.grounded !== false,
    source: extra.source || "mixed",
    fallbackUsed: Boolean(extra.fallbackUsed),
    reason: clean(extra.reason),
  };
}

async function rewardsResponse({ identity, rewardsService }) {
  if (!identity?.profileId || !identity?.shopperId) {
    return response(
      STARTER_INTENTS.rewards,
      "I can check rewards after you unlock this station with your Snooze Code. I will not guess a balance without a connected profile.",
      { grounded: false, source: "rewards", reason: "reward_identity_missing" }
    );
  }
  try {
    const [summary, offers] = await Promise.all([
      rewardsService.getRewardSummary(identity),
      rewardsService.getRewardOffers(identity),
    ]);
    const points = Number(summary?.availableSleepPoints);
    const unlocked = (Array.isArray(offers) ? offers : []).filter(
      (offer) => offer?.unlocked === true && clean(offer?.status) === "unlocked"
    );
    const badge = clean(summary?.currentBadge?.label);
    const pointsText = Number.isFinite(points)
      ? `You have ${points.toLocaleString("en-US")} available Sleep Point${points === 1 ? "" : "s"}`
      : "Your rewards profile is connected";
    const badgeText = badge ? ` and your current badge is ${badge}` : "";
    const offerText = unlocked.length
      ? `. Active offer${unlocked.length === 1 ? "" : "s"}: ${unlocked.map((offer) => clean(offer.label)).filter(Boolean).join(", ")}`
      : ". You do not have an unlocked offer showing right now";
    return response(
      STARTER_INTENTS.rewards,
      `${pointsText}${badgeText}${offerText}.`,
      {
        speech: `${pointsText}${badgeText}.`,
        source: "rewards",
        contextPatch: { rewards: { summary, offers: unlocked } },
      }
    );
  } catch {
    return response(
      STARTER_INTENTS.rewards,
      "Rewards are temporarily unavailable. Your showroom experience can continue, and I have not assumed a balance.",
      { grounded: false, source: "rewards", fallbackUsed: true, reason: "rewards_unavailable" }
    );
  }
}

async function cartResponse({ context, shopify }) {
  const cartId = clean(context?.cartId);
  if (!CART_GID.test(cartId)) {
    return response(
      STARTER_INTENTS.cart,
      "Your cart is empty right now. I can browse a few products or help narrow a recommendation next.",
      {
        source: "shopify",
        chips: [{ label: "Browse Products", value: "Browse Products" }],
      }
    );
  }
  try {
    const cart = await shopify.getCart({ cartId });
    const lines = cartLines(cart);
    if (!lines.length) {
      return response(
        STARTER_INTENTS.cart,
        "Your cart is empty right now. I can browse a few products or help narrow a recommendation next.",
        { source: "shopify", chips: [{ label: "Browse Products", value: "Browse Products" }] }
      );
    }
    const products = lines.map(cartLineProduct).filter((product) => product.handle);
    const totalQuantity = lines.reduce((sum, line) => sum + Math.max(1, Number(line.quantity) || 1), 0);
    const labels = lines
      .map((line) => {
        const productTitle = clean(line?.merchandise?.product?.title) || "item";
        const variantTitle = clean(line?.merchandise?.title);
        const quantity = Math.max(1, Number(line.quantity) || 1);
        return `${quantity} ${productTitle}${variantTitle && variantTitle !== "Default Title" ? ` (${variantTitle})` : ""}`;
      })
      .join(", ");
    const total = cart?.cost?.totalAmount;
    const totalText = money(total?.amount, total?.currencyCode);
    return response(
      STARTER_INTENTS.cart,
      `Your cart has ${totalQuantity} item${totalQuantity === 1 ? "" : "s"}: ${labels}.${totalText ? ` Current total: ${totalText}.` : ""}`,
      {
        speech: `Your cart has ${totalQuantity} item${totalQuantity === 1 ? "" : "s"}${totalText ? ` totaling ${totalText}` : ""}.`,
        products,
        source: "shopify",
        contextPatch: { cartSummary: { totalQuantity, total: totalText || null } },
      }
    );
  } catch (error) {
    if (["CART_NOT_FOUND", "INVALID_CART_ID"].includes(clean(error?.code).toUpperCase())) {
      return response(
        STARTER_INTENTS.cart,
        "I could not find an active cart for this session. I can browse products or help rebuild it without guessing what was there.",
        { source: "shopify", grounded: false, reason: "cart_not_found" }
      );
    }
    return response(
      STARTER_INTENTS.cart,
      "I cannot verify the cart right now. I have not used an old total or guessed what is inside it.",
      { source: "shopify", grounded: false, fallbackUsed: true, reason: "cart_unavailable" }
    );
  }
}

async function browseResponse({ query, context, manifest, fetchProductsByHandles }) {
  const offset = /^show me more$/i.test(clean(query)) ? 3 : 0;
  const handles = chooseBrowseHandles(context, manifest, offset);
  try {
    const products = (await fetchProducts(fetchProductsByHandles, handles))
      .map((product) => stationProduct(product, { query }))
      .filter(Boolean);
    if (!products.length) throw new Error("NO_VERIFIED_PRODUCTS");
    return response(
      STARTER_INTENTS.browse,
      `Here are ${products.length} MySnoozePod options to explore. The cards show current prices and availability.`,
      {
        products,
        source: "shopify",
        chips: [{ label: "Show me more", value: "Show me more" }],
        contextPatch: { lastBrowseHandles: products.map((product) => product.handle) },
      }
    );
  } catch {
    return response(
      STARTER_INTENTS.browse,
      "I cannot load the current products right now, so I will not guess at a price or availability. Please try again.",
      { source: "shopify", grounded: false, fallbackUsed: true, reason: "browse_unavailable" }
    );
  }
}

async function motionResponse({ query, manifest, fetchProductsByHandles }) {
  const base = manifestProducts(manifest).find(
    (product) => product.catalogType === "base" && product.attributes?.supportsMotion === true
  );
  if (!base) {
    return response(
      STARTER_INTENTS.motion,
      "I do not have a motion-base option available to show right now.",
      { source: "canon", grounded: false, reason: "motion_base_missing" }
    );
  }
  try {
    const fetched = await fetchProducts(fetchProductsByHandles, [base.handle]);
    const product = stationProduct(fetched[0], {
      query,
      descriptor: "Adjustable base with Standard Motion and supported split-motion configurations.",
    });
    if (!product) throw new Error("MOTION_PRODUCT_UNAVAILABLE");
    return response(
      STARTER_INTENTS.motion,
      `${product.title} supports Standard Motion plus half-split and full-split configurations, subject to size and mattress compatibility. Tell me the size and mattress you want, and I can price the matching setup.`,
      {
        speech: `${product.title} is the current adjustable motion-base option. Tell me your size and I can check the exact configuration.`,
        products: [product],
        source: "mixed",
      }
    );
  } catch {
    return response(
      STARTER_INTENTS.motion,
      "I found the motion-base option, but I cannot confirm its current price or availability right now. I will not guess those details.",
      { source: "mixed", grounded: false, fallbackUsed: true, reason: "motion_product_unavailable" }
    );
  }
}

async function compareResponse({ query, context, manifest, fetchProductsByHandles }) {
  const handles = extractHandles(query, manifest, context);
  if (handles.length < 2) {
    const candidates = chooseBrowseHandles(context, manifest, 0).slice(0, 3);
    let products = [];
    try {
      products = (await fetchProducts(fetchProductsByHandles, candidates))
        .map((product) => stationProduct(product, { query }))
        .filter(Boolean);
    } catch {
      products = [];
    }
    return response(
      STARTER_INTENTS.compare,
      "Which two MySnoozePod products would you like to compare? Choose from the grounded options below or name both products.",
      { products, source: products.length ? "mixed" : "canon", grounded: false, reason: "comparison_products_needed" }
    );
  }
  try {
    const fetched = await fetchProducts(fetchProductsByHandles, handles);
    const products = fetched.map((product) => stationProduct(product, { query })).filter(Boolean);
    if (products.length !== 2) throw new Error("COMPARISON_PRODUCT_UNAVAILABLE");
    const manifestByHandle = new Map(manifestProducts(manifest).map((product) => [product.handle, product]));
    const summaries = products.map((product) => {
      const canon = manifestByHandle.get(product.handle) || {};
      const attributes = Object.entries(canon.attributes || {})
        .filter(([, value]) => value === true)
        .map(([key]) => key.replace(/([A-Z])/g, " $1").toLowerCase())
        .slice(0, 3);
      const range = product.priceRange;
      const price = money(range?.min, range?.currencyCode);
      return `${product.title}: ${attributes.length ? attributes.join(", ") : "verified catalog option"}${price ? `; starts at ${price}` : ""}; ${product.available ? "available" : "not currently available"}`;
    });
    return response(
      STARTER_INTENTS.compare,
      `${summaries.join(". ")}. This comparison does not change the mattress saved from your assessment.`,
      {
        speech: `I compared ${products[0].title} and ${products[1].title}. The full verified comparison is on screen.`,
        products,
        source: "mixed",
      }
    );
  } catch {
    return response(
      STARTER_INTENTS.compare,
      "I cannot verify both products right now, so I will not manufacture a comparison. Please try again.",
      { source: "mixed", grounded: false, fallbackUsed: true, reason: "comparison_unavailable" }
    );
  }
}

async function resolveAskSnoozerStationResponse({
  query = "",
  context = {},
  identity = null,
  rewardsService = null,
  shopify = null,
  manifest = null,
  fetchProductsByHandles = null,
} = {}) {
  const intent = detectStationIntent(query);
  if (!intent) return null;
  if (intent === STARTER_INTENTS.rewards) {
    return rewardsResponse({ identity, rewardsService: rewardsService || {} });
  }
  if (intent === STARTER_INTENTS.cart) {
    return cartResponse({ context, shopify: shopify || {} });
  }
  if (!manifest) {
    return response(intent, "I cannot load the verified showroom catalog right now. Please try again.", {
      grounded: false,
      fallbackUsed: true,
      reason: "showroom_manifest_unavailable",
    });
  }
  if (intent === STARTER_INTENTS.browse) {
    return browseResponse({ query, context, manifest, fetchProductsByHandles });
  }
  if (intent === STARTER_INTENTS.motion) {
    return motionResponse({ query, manifest, fetchProductsByHandles });
  }
  return compareResponse({ query, context, manifest, fetchProductsByHandles });
}

module.exports = {
  CART_GID,
  PRODUCT_VARIANT_GID,
  STARTER_INTENTS,
  chooseBrowseHandles,
  detectStationIntent,
  extractHandles,
  normalizeVariants,
  requestedSize,
  resolveAskSnoozerStationResponse,
  resolveExactVariant,
  stationProduct,
};
