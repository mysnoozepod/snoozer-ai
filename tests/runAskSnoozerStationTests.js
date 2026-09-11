"use strict";

const assert = require("assert");
const {
  STARTER_INTENTS,
  chooseBrowseHandles,
  detectStationIntent,
  extractHandles,
  resolveAskSnoozerStationResponse,
  resolveExactVariant,
  stationProduct,
} = require("../services/askSnoozerStation");

const manifest = {
  products: [
    { handle: "12-dual-comfort-hybrid", title: "12 Dual Comfort Hybrid", catalogType: "mattress", active: true, recommendable: true, attributes: { dualComfort: true, cooling: true } },
    { handle: "14-hybrid", title: "14 Hybrid", catalogType: "mattress", active: true, recommendable: true, attributes: { cooling: true } },
    { handle: "12-all-foam-mattress", title: "12 All Foam Mattress", catalogType: "mattress", active: true, recommendable: true, attributes: { pressureRelief: true } },
    { handle: "premium-motion-adjustable-base", title: "Premium Motion Adjustable Base", catalogType: "base", active: true, recommendable: true, attributes: { supportsMotion: true, supportsSplitMotion: true } },
  ],
};

const gid = (suffix) => `gid://shopify/ProductVariant/${suffix}`;
const products = Object.fromEntries(manifest.products.map((item, index) => [item.handle, {
  id: `gid://shopify/Product/${index + 1}`,
  handle: item.handle,
  title: item.title,
  description: `Verified ${item.title} description`,
  imageUrl: `https://cdn.example/${item.handle}.jpg`,
  available: true,
  priceRange: { min: 500 + index * 100, max: 900 + index * 100, currencyCode: "USD" },
  variants: [
    { id: gid(`${index + 1}01`), title: "Queen", price: 700 + index * 100, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "Queen" }] },
    { id: gid(`${index + 1}02`), title: "King", price: 900 + index * 100, currencyCode: "USD", available: true, selectedOptions: [{ name: "Size", value: "King" }] },
  ],
}]));

async function fetchProductsByHandles({ handles }) {
  return { items: handles.map((handle) => products[handle]).filter(Boolean) };
}

async function run() {
  let checks = 0;
  const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

  check(detectStationIntent("Find Rewards") === STARTER_INTENTS.rewards, "Find Rewards routes deterministically");
  check(detectStationIntent("Analyze My Cart") === STARTER_INTENTS.cart, "Analyze My Cart routes deterministically");
  check(detectStationIntent("Compare Products") === STARTER_INTENTS.compare, "Compare Products routes deterministically");
  check(detectStationIntent("Motion Base Features") === STARTER_INTENTS.motion, "Motion Base Features routes deterministically");
  check(detectStationIntent("Browse Products") === STARTER_INTENTS.browse, "Browse Products routes deterministically");
  check(detectStationIntent("Compare 14-hybrid with 12-all-foam-mattress") === STARTER_INTENTS.compare, "handle comparison stays in station lane");
  check(detectStationIntent("What is your return policy?") === null, "non-station questions preserve the main Ask router");

  const rewards = await resolveAskSnoozerStationResponse({
    query: "Find Rewards",
    identity: { profileId: "PROFILE#1", shopperId: "SHOPPER#1" },
    rewardsService: {
      getRewardSummary: async () => ({ availableSleepPoints: 250, currentBadge: { label: "Dreamer" } }),
      getRewardOffers: async () => [{ label: "Sleep Set", unlocked: true, status: "unlocked" }, { label: "Locked", unlocked: false, status: "locked" }],
    },
  });
  check(rewards.reply.includes("250") && rewards.reply.includes("Sleep Set"), "known rewards use service values");
  check(!rewards.reply.includes("Locked"), "locked offers are not presented as active");
  check(rewards.contextPatch.rewards.summary.availableSleepPoints === 250, "verified summary survives in context");

  const missingRewards = await resolveAskSnoozerStationResponse({ query: "Find Rewards", identity: null });
  check(missingRewards.reply.includes("will not guess") && !missingRewards.reply.includes("0"), "missing rewards identity never fabricates zero");

  const unavailableRewards = await resolveAskSnoozerStationResponse({
    query: "Find Rewards",
    identity: { profileId: "P", shopperId: "S" },
    rewardsService: { getRewardSummary: async () => { throw new Error("offline"); }, getRewardOffers: async () => [] },
  });
  check(unavailableRewards.fallbackUsed && unavailableRewards.reply.includes("not assumed"), "reward failure is customer-safe");

  const emptyCart = await resolveAskSnoozerStationResponse({ query: "Analyze My Cart", context: {} });
  check(emptyCart.reply.includes("empty") && emptyCart.products.length === 0, "missing cart identity yields grounded empty state without products");

  const cart = {
    id: "gid://shopify/Cart/test-cart",
    cost: { totalAmount: { amount: "1799.00", currencyCode: "USD" } },
    lines: { edges: [{ node: {
      quantity: 2,
      merchandise: {
        id: gid("501"), title: "Queen", availableForSale: true,
        price: { amount: "899.50", currencyCode: "USD" },
        product: { id: "gid://shopify/Product/50", title: "14 Hybrid", handle: "14-hybrid" },
        image: { url: "https://cdn.example/cart.jpg" },
      },
    } }] },
  };
  const populatedCart = await resolveAskSnoozerStationResponse({
    query: "Analyze My Cart",
    context: { cartId: cart.id },
    shopify: { getCart: async ({ cartId }) => { assert.strictEqual(cartId, cart.id); return cart; } },
  });
  check(populatedCart.reply.includes("2 14 Hybrid") && populatedCart.reply.includes("$1,799.00"), "cart analysis uses exact lines and verified total");
  check(populatedCart.products[0].merchandiseId === gid("501"), "cart line preserves exact merchandise identity");
  check(populatedCart.products[0].quantity === 2, "cart line preserves authoritative quantity");

  const cartFailure = await resolveAskSnoozerStationResponse({
    query: "Analyze My Cart", context: { cartId: cart.id }, shopify: { getCart: async () => { throw new Error("offline"); } },
  });
  check(cartFailure.fallbackUsed && cartFailure.reply.includes("cannot verify"), "cart network failure does not use cached truth");

  const browse = await resolveAskSnoozerStationResponse({
    query: "Browse Products",
    context: { recommendedProductHandles: ["14-hybrid"] },
    manifest,
    fetchProductsByHandles,
  });
  check(browse.products.length === 3, "browse response is restrained to three products");
  check(browse.products[0].handle === "14-hybrid", "browse prioritizes grounded recommendation context");
  check(browse.products.every((product) => manifest.products.some((item) => item.handle === product.handle)), "browse never escapes catalog boundaries");
  check(browse.products.every((product) => product.exactVariantResolved === false), "multi-variant browse never guesses a configuration");

  const queenBrowse = await resolveAskSnoozerStationResponse({ query: "Browse Products Queen", context: {}, manifest, fetchProductsByHandles });
  check(queenBrowse.products.every((product) => product.exactVariantResolved && product.selectedOptions[0].value === "Queen"), "explicit size resolves exact variants");

  const moreHandles = chooseBrowseHandles({}, manifest, 3);
  check(moreHandles[0] === "premium-motion-adjustable-base" && moreHandles.length === 3, "show-more pagination advances without dumping the catalog");

  const motion = await resolveAskSnoozerStationResponse({ query: "Motion Base Features", manifest, fetchProductsByHandles });
  check(motion.products.length === 1 && motion.products[0].handle === "premium-motion-adjustable-base", "motion starter grounds the exact approved base");
  check(motion.reply.includes("subject to size and mattress compatibility"), "motion answer avoids unconditional feature claims");

  const comparePrompt = await resolveAskSnoozerStationResponse({ query: "Compare Products", context: {}, manifest, fetchProductsByHandles });
  check(comparePrompt.reason === "comparison_products_needed" && comparePrompt.products.length === 3, "comparison asks for two grounded products when unclear");

  const compared = await resolveAskSnoozerStationResponse({
    query: "Compare Products",
    context: { comparisonProductHandles: ["12-all-foam-mattress", "14-hybrid"] },
    manifest,
    fetchProductsByHandles,
  });
  check(compared.products.length === 2 && compared.reply.includes("does not change the mattress saved from your assessment"), "comparison preserves the saved recommendation in shopper language");
  check(compared.reply.includes("starts at") && compared.source === "mixed", "comparison combines canon attributes with Shopify pricing");

  const extracted = extractHandles("Compare 12-all-foam-mattress with 14-hybrid", manifest, {});
  check(extracted.join(",") === "14-hybrid,12-all-foam-mattress" || extracted.join(",") === "12-all-foam-mattress,14-hybrid", "only manifest handles are extracted");
  check(extractHandles("Compare outside-brand with 14-hybrid", manifest, {}).length === 1, "unknown outside brand is not mapped");

  const exact = resolveExactVariant(products["14-hybrid"], "Queen");
  check(exact?.id === gid("201"), "exact requested size resolves the matching available variant");
  check(resolveExactVariant(products["14-hybrid"], "") === null, "multi-variant product requires configuration");
  const single = { ...products["14-hybrid"], variants: [products["14-hybrid"].variants[0]] };
  check(resolveExactVariant(single, "")?.id === gid("201"), "single available configuration is exact");
  const safeProduct = stationProduct({ ...single, variants: [{ ...single.variants[0], id: "201" }] });
  check(safeProduct.exactVariantResolved === false && safeProduct.merchandiseId === null, "non-GID variant identity is rejected");
  check(motion.speech.length < motion.reply.length, "rich visual response keeps spoken summary concise");

  console.log(`Ask Snoozer station backend tests passed (${checks} checks).`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
