import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  commerceNavigationState,
  resolveCommerceOrigin,
} from "../src/lib/commerceNavigation.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [shop, cart, header, navigation, api, routes, manifest, layout] = await Promise.all([
  read("../src/pages/Shop.jsx"),
  read("../src/pages/Cart.jsx"),
  read("../src/components/showroom/CommerceHeader.jsx"),
  read("../src/lib/commerceNavigation.js"),
  read("../src/lib/api.js"),
  read("../src/main.jsx"),
  read("../src/device/deviceRegistry.manifest.js"),
  read("../src/Layout.jsx"),
]);

for (const expected of [
  'path="shop"', "getShowroomCommerceCatalog", 'data-shop-page="true"',
  'data-shop-quick-view="true"', "addLinesToAuthoritativeCart", 'key: "_Source", value: "Shop"',
  "Recommended for You", "In Your Cart", "Price: Low to High", "Price: High to Low",
]) assert.ok(`${routes}${shop}${api}`.includes(expected), `missing Shop contract: ${expected}`);

for (const expected of [
  'data-commerce-header="true"', 'label="Shop"', 'label="Ask Snoozer"',
  "commerceNavigationState(location)", "mysnoozepod-logo-welcome.png",
]) assert.ok(header.includes(expected), `missing commerce header contract: ${expected}`);

for (const expected of [
  'return "sleep-essentials"', 'return "snoozepod"', 'return "other"',
  'data-cart-group={group.key}', "Review your sleep setup.", "Order Summary",
  "prepareCheckoutCart", 'state: "celebrate"', 'priority: "high"', "ttlMs: 5000", "actions: []",
]) assert.ok(cart.includes(expected), `missing Cart contract: ${expected}`);

assert.equal(cart.includes("buildStep=essentials"), false, "Cart must not return to the removed Pod Essentials step");
assert.equal(cart.includes("Sleep Points earned"), false, "Cart must not invent purchase-earned points");
assert.ok(cart.includes('!attr.key.startsWith("_")'), "private Shopify attributes must stay hidden");
assert.ok(navigation.includes("SAFE_COMMERCE_PATHS"));
assert.ok(navigation.includes('raw.startsWith("//")'));
assert.ok(manifest.includes('"/shop"'));
assert.ok(layout.includes('pathname.startsWith("/shop")'));

for (const [pathname, expectedPath, expectedLabel] of [
  ["/shop", "/shop", "Continue Shopping"],
  ["/sleep-essentials", "/sleep-essentials", "Back to Sleep Essentials"],
  ["/pod/pod-3", "/pod/pod-3", "Back to SnoozePod"],
  ["/ask-snoozer", "/ask-snoozer", "Back to Ask Snoozer"],
]) {
  const state = commerceNavigationState({ pathname, search: "", hash: "" });
  const resolved = resolveCommerceOrigin(state, "/shop");
  assert.equal(resolved.path, expectedPath, `safe commerce origin should preserve ${pathname}`);
  assert.equal(resolved.label, expectedLabel, `safe commerce origin should label ${pathname}`);
}

assert.deepEqual(
  resolveCommerceOrigin({ commerceOrigin: { path: "//evil.example/checkout", label: "Leave" } }, "/shop"),
  { path: "/shop", label: "Continue Shopping" },
  "protocol-relative origins must fall back to Shop"
);
assert.deepEqual(
  resolveCommerceOrigin({ commerceOrigin: { path: "https://evil.example/checkout", label: "Leave" } }, "/shop"),
  { path: "/shop", label: "Continue Shopping" },
  "external origins must fall back to Shop"
);

console.log("Commerce experience source tests passed: Shop, shared navigation, semantic Cart, safe origins, Shopify handoff, and device ownership.");
