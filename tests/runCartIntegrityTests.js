const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, needle, message) {
  assert(source.includes(needle), message || `Expected source to include ${needle}`);
}

function assertNotIncludes(source, needle, message) {
  assert(!source.includes(needle), message || `Expected source not to include ${needle}`);
}

const api = read("omnia-journey/src/lib/api.js");
const useStore = read("omnia-journey/src/lib/useStore.js");
const usePodCart = read("omnia-journey/src/hooks/usePodCart.js");
const podBuilder = read("omnia-journey/src/components/PodBuilder.jsx");
const cartPage = read("omnia-journey/src/pages/Cart.jsx");
const checkoutPage = read("omnia-journey/src/pages/Checkout.jsx");
const resetPolicies = read("omnia-journey/src/device/resetPolicies.js");

assertIncludes(
  api,
  "root?.cartLinesAdd?.cart",
  "api.normalizeCartPayload must expose nested Shopify cartLinesAdd cart payloads."
);
assertIncludes(
  api,
  "root?.cartCreate?.cart",
  "api.normalizeCartPayload must expose nested Shopify cartCreate cart payloads."
);

assertIncludes(
  useStore,
  "addLinesToAuthoritativeCart",
  "useStore must expose authoritative Shopify cart line mutation helper."
);
assertIncludes(
  useStore,
  "syncCartFromShopify",
  "useStore must expose authoritative Shopify cart restore helper."
);
assertIncludes(
  useStore,
  "shopifyCartToItems",
  "useStore must hydrate display lines from Shopify cart lines."
);
assertIncludes(
  useStore,
  "cartTotalQuantity",
  "useStore must derive total quantity from the Shopify cart payload."
);

assertIncludes(
  usePodCart,
  "state.cart",
  "Pod header cart count must read authoritative cart state."
);
assertNotIncludes(
  usePodCart,
  "state.snoozepod",
  "Pod header cart count must not read the local build plan."
);

assertIncludes(
  podBuilder,
  "addLinesToAuthoritativeCart",
  "Pod Builder Add This Setup must mutate the authoritative Shopify cart."
);
assertNotIncludes(
  podBuilder,
  "addToSnoozePod",
  "Pod Builder must not add committed setups to the local snoozepod plan."
);
assertIncludes(
  podBuilder,
  "isAddingToCart",
  "Pod Builder must guard duplicate Add This Setup submissions."
);
assertIncludes(
  podBuilder,
  "We couldn't add that setup",
  "Pod Builder must expose a recoverable failed-cart-mutation message."
);

assertIncludes(
  cartPage,
  "syncCartFromShopify",
  "Cart page must restore authoritative Shopify cart state."
);
assertIncludes(
  cartPage,
  "item.lineId",
  "Cart page must prefer Shopify cart line IDs for updates/removals."
);

assertIncludes(
  checkoutPage,
  "syncCartFromShopify",
  "Checkout Lounge must restore authoritative Shopify cart state."
);

assertIncludes(
  resetPolicies,
  "cartId",
  "Device reset policy must preserve Shopify cart ID."
);
assertIncludes(
  resetPolicies,
  "checkoutUrl",
  "Device reset policy must preserve Shopify checkout URL."
);

console.log("Cart integrity regression checks passed.");
