import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildComparePrompt,
  buildProductAddAction,
  cartItemCount,
  formatProductPrice,
  isValidProductVariantGid,
  normalizeAskStationAction,
  normalizeAskStationProduct,
} from "../src/lib/snoozer/askSnoozerStationContract.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, "../src/pages/AskSnoozer.jsx"), "utf8");
const adapter = fs.readFileSync(path.join(here, "../src/lib/snoozer/askSnoozerPage.js"), "utf8");
const layout = fs.readFileSync(path.join(here, "../src/Layout.jsx"), "utf8");
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

const starterBlock = page.match(/const QUICK_STARTERS = \[([\s\S]*?)\n\];/)?.[1] || "";
const labels = [...starterBlock.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
check(labels.join("|") === "Find Rewards|Analyze My Cart|Compare Products|Motion Base Features|Browse Products", "quick starters have the exact five labels");
check(!starterBlock.includes("Talk to Human") && !starterBlock.includes("Talk to a human"), "Talk to Human is not a default starter");

const heroIndex = page.indexOf('data-ask-section="hero"');
const transcriptIndex = page.indexOf('data-ask-section="transcript"');
const composerIndex = page.indexOf('data-ask-section="composer"');
check(heroIndex >= 0 && heroIndex < transcriptIndex && transcriptIndex < composerIndex, "visual order is hero, transcript, composer");
check((page.match(/src="\/snoozer-avatar\.png"/g) || []).length === 1, "only one Snoozer avatar renders");
check(!page.includes("<footer") && !page.includes("View Results</ Beneath"), "Ask page has no footer band");
check(page.includes("ShowroomDownstreamHeader") && page.includes("RewardsPill") && page.includes("ShowroomCartBadge"), "header has rewards, centered brand primitive, and cart");
check(layout.includes("pageUsesDownstreamHeader || pageUsesAskStation") && layout.includes("!pageOwnsRewardsControl"), "shared floating Rewards control is suppressed when Ask owns the header control");
check(layout.includes('right: pageUsesAskStation ? 16 : "auto"') && layout.includes("bottom: pageUsesAskStation") && page.includes('className="flex min-h-0 flex-col pb-24"'), "Ask places Brandy at lower right with reserved space below the composer");
check(page.includes("getRewardSummary()") && page.includes("Number.isFinite(points)"), "reward pill reads actual summary and gates numeric display");
check(page.includes('sendMessage("Find Rewards", { command: createShowroomCommand("find_rewards") })'), "reward pill sends the typed rewards command");
check(starterBlock.includes('createShowroomCommand("find_rewards")') && starterBlock.includes('createShowroomCommand("browse_products", { offset: 0 })'), "quick starters carry typed command definitions");
check(page.includes('createShowroomCommand("compare_products", { productHandles:') && page.includes('createShowroomCommand("product_sizes", { productHandle: item.handle })'), "product cards send exact typed compare and size commands");
check(page.includes("state.cart || []") && page.includes("cartItemCount(cart)"), "cart pill uses authoritative cart state");
check(page.includes("canMutateCart(device)") && page.includes("isDeviceActionAllowed(device, action)"), "cart actions preserve device guards");
check(!page.includes("canInitiateCheckout") && !page.includes("checkoutUrl"), "Ask page has no checkout initiation path");
check(page.includes("sayHud({") && page.includes(".catch(() => {})"), "voice failure cannot suppress visual output");
check(page.includes("Working on that…") && page.includes("requestAnimationFrame"), "thinking state and first-visible-feedback boundary remain instrumented");
check(page.includes("sendAskSnoozerQualityTiming") && page.includes("ASK_SNOOZER_VOICE_TIMING_EVENT"), "display and TTS timing events are reported without changing the UI");
check(page.includes("canRetry: true") && page.includes("composeFallbackReply"), "network failure retains customer-safe retry");
check(page.includes("retryRequest = { message: content, command }") && page.includes("command: request.command || null"), "retry preserves the original command object");
check(adapter.includes("storeState?.cart") && !adapter.includes("storeState?.snoozepod) ? storeState.snoozepod"), "Ask context uses authoritative cart lines");
check(adapter.includes("normalizeAskStationProduct") && adapter.includes("normalizeAskStationAction"), "adapter uses the safe rich response contract");
check(adapter.includes('type === "command"') && adapter.includes("command: normalizedCommand"), "command chips and requests preserve typed command metadata");
check(adapter.includes('buildCommandChip("Return policy", "policy_fact"') && adapter.includes('buildCommandChip("Queen pricing", "price_quote"'), "deterministic adaptive chips use typed policy and price commands");

const exactId = "gid://shopify/ProductVariant/123";
const normalized = normalizeAskStationProduct({
  id: "gid://shopify/Product/1", handle: "14-hybrid", title: "14 Hybrid", image: { url: "https://cdn.example/p.jpg" },
  price: 999, priceRange: { min: 999, max: 1299, currencyCode: "USD" }, available: true,
  variants: [{ id: exactId, title: "Queen", available: true, price: 999, currencyCode: "USD", selectedOptions: [{ name: "Size", value: "Queen" }] }],
  exactVariantResolved: true, merchandiseId: exactId, selectedOptions: [{ name: "Size", value: "Queen" }],
});
check(normalized.handle === "14-hybrid" && normalized.imageUrl && normalized.priceRange.max === 1299, "product normalization preserves handle, image, and price range");
check(normalized.available === true && normalized.variants[0].selectedOptions[0].value === "Queen", "availability, variants, and selected options survive normalization");
check(normalized.merchandiseId === exactId && normalized.exactVariantResolved, "exact merchandise identity survives only with resolution proof");
check(formatProductPrice(normalized) === "$999.00", "resolved variant displays its exact verified price rather than the product range");
check(formatProductPrice({ pricingMode: "starting_at", priceRange: { min: 549, max: 1099, currencyCode: "USD" } }) === "From $549.00", "unknown-size product uses starting-price language");
check(formatProductPrice({ pricingMode: "unresolved", priceRange: { min: 549, max: 1099, currencyCode: "USD" } }) === "Exact price unavailable", "unresolved exact configuration never displays the product minimum");
check(formatProductPrice({ pricingMode: "exact_variant", price: 1099, priceRange: { min: 549, max: 1099, currencyCode: "USD" } }) === "$1,099.00", "exact variant card displays the exact active-size price");

const add = buildProductAddAction(normalized);
check(add?.type === "add_to_cart" && add.payload.merchandiseId === exactId, "exact product creates structured add_to_cart action");
check(buildProductAddAction({ ...normalized, exactVariantResolved: false }) === null, "unresolved configuration cannot create cart action");
check(buildProductAddAction({ ...normalized, available: false }) === null, "unavailable product cannot create cart action");
check(normalizeAskStationAction({ type: "add_to_cart", label: "Add", payload: { merchandiseId: "123" } }) === null, "invalid variant ID is rejected");
check(isValidProductVariantGid(exactId) && !isValidProductVariantGid("gid://shopify/Product/123"), "variant GID validation is exact");
check(!JSON.stringify(normalized).includes("firstAvailableVariantId"), "first-available identity is not treated as selected configuration");
const comparePrompt = buildComparePrompt(normalized, [
  normalized,
  { handle: "12-all-foam-mattress", title: "12-inch All Foam Mattress" },
]);
check(comparePrompt === "Compare 14 Hybrid with 12-inch All Foam Mattress", "Compare uses shopper-facing product names");
check(!comparePrompt.includes("14-hybrid") && !comparePrompt.includes("12-all-foam-mattress"), "Compare does not expose product handles");
check(cartItemCount([{ quantity: 2 }, { quantity: 1 }]) === 3, "cart count sums authoritative quantities");

console.log(`Ask Snoozer station frontend tests passed (${checks} checks).`);
