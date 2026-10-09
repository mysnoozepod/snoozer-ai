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
const commerceHeader = fs.readFileSync(path.join(here, "../src/components/showroom/CommerceHeader.jsx"), "utf8");
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

const starterBlock = page.match(/const QUICK_STARTERS = \[([\s\S]*?)\n\];/)?.[1] || "";
const labels = [...starterBlock.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
check(labels.join("|") === "Compare Products|What’s in My Cart?|Find a Product|Motion Base Help|Show My Rewards", "quick starters use the exact five human labels");
check(!starterBlock.includes("Talk to Human") && !starterBlock.includes("Talk to a human"), "Talk to Human is not a default starter");

const advisorIndex = page.indexOf('data-ask-section="advisor"');
const workspaceIndex = page.indexOf('data-ask-section="answer-workspace"');
const transcriptIndex = page.indexOf('data-ask-section="transcript"');
const composerIndex = page.indexOf('data-ask-section="composer"');
check(advisorIndex >= 0 && advisorIndex < workspaceIndex && workspaceIndex < transcriptIndex && transcriptIndex < composerIndex, "visual order is advisor identity, answer workspace, transcript, composer");
check(page.includes('data-ask-snoozer-workspace="true"') && page.includes("h-[100dvh]") && page.includes("overflow-hidden"), "Ask owns a fixed showroom viewport shell");
check(page.includes('className="h-[142px] w-[142px] object-contain xl:h-[156px] xl:w-[156px]"'), "advisor Snoozer has substantial dedicated-page presence");
check(page.includes("What can I help you figure out?") && !page.includes("Chat with Snoozer"), "advisor invitation replaces generic chat framing");
check(!page.includes("Advisor workspace") && !page.includes("Your latest answer stays in focus."), "internal workspace language is not exposed to shoppers");
check(page.includes('role="region" aria-label="Ask Snoozer answers"') && page.includes("overflow-y-auto overscroll-contain"), "only the answer workspace owns conversation scrolling");
check((page.match(/<textarea/g) || []).length === 1 && page.includes('aria-label="Ask Snoozer"'), "there is exactly one labeled shopper composer");
check(page.includes("Ask Snoozer anything about your sleep setup…"), "composer uses the concise advisor prompt without decorative inputs");
check(page.includes("CommerceHeader") && commerceHeader.includes('mysnoozepod-logo-welcome.png'), "Ask uses the shared header with the accepted sharp logo asset");
check(!page.includes("<footer") && !page.includes("View Results</ Beneath"), "Ask page has no footer band");
check(page.includes("CommerceHeader") && page.includes("RewardsPill") && page.includes("cartCount={authoritativeCartCount}"), "header has shared Shop, Ask Snoozer, rewards, and authoritative cart state");
check(layout.includes("pageUsesDownstreamHeader || pageUsesAskStation") && layout.includes("!pageOwnsRewardsControl"), "shared floating Rewards control is suppressed when Ask owns the header control");
check(layout.includes('right: pageUsesAskStation ? 16 : "auto"') && layout.includes("bottom: pageUsesAskStation") && page.includes("pb-[82px]"), "Ask places Brandy at lower right with reserved space below the composer");
check(page.includes("getRewardSummary()") && page.includes("Number.isFinite(points)"), "reward pill reads actual summary and gates numeric display");
check(page.includes('sendMessage("Find Rewards", { command: createShowroomCommand("find_rewards") })'), "reward pill sends the typed rewards command");
check(starterBlock.includes('createShowroomCommand("find_rewards")') && starterBlock.includes('createShowroomCommand("browse_products", { offset: 0 })'), "quick starters carry typed command definitions");
check(page.includes('createShowroomCommand("compare_products", { productHandles:') && page.includes('createShowroomCommand("product_sizes", { productHandle: item.handle })'), "product cards send exact typed compare and size commands");
check(page.includes("state.cart || []") && page.includes("cartItemCount(cart)"), "cart pill uses authoritative cart state");
check(page.includes("canMutateCart(device)") && page.includes("isDeviceActionAllowed(device, action)"), "cart actions preserve device guards");
check(!page.includes("canInitiateCheckout") && !page.includes("checkoutUrl"), "Ask page has no checkout initiation path");
check(page.includes("sayHud({") && page.includes(".catch(() => {})"), "voice failure cannot suppress visual output");
check(page.includes("Snoozer is thinking…") && page.includes("requestAnimationFrame") && page.includes("motion-reduce:animate-none"), "thinking state and first-visible-feedback boundary remain instrumented with reduced-motion safety");
check(page.includes("sendAskSnoozerQualityTiming") && page.includes("ASK_SNOOZER_VOICE_TIMING_EVENT"), "display and TTS timing events are reported without changing the UI");
check(page.includes("canRetry: true") && page.includes("composeFallbackReply"), "network failure retains customer-safe retry");
check(page.includes("temporary issue") && !page.includes('value === "fallback") return "answered"'), "fallback responses are labeled as temporary issues");
check(page.includes("retryRequest = { message: content, command, comparisonProductHandles }") && page.includes("comparisonProductHandles: request.comparisonProductHandles || []"), "retry preserves the original command and comparison scope");
check(adapter.includes("VITE_ASK_SNOOZER_TIMEOUT_MS || 30000"), "Ask client timeout covers the backend model envelope");
check(adapter.includes("storeState?.cart") && !adapter.includes("storeState?.snoozepod) ? storeState.snoozepod"), "Ask context uses authoritative cart lines");
check(adapter.includes("normalizeAskStationProduct") && adapter.includes("normalizeAskStationAction"), "adapter uses the safe rich response contract");
check(adapter.includes('type === "command"') && adapter.includes("command: normalizedCommand"), "command chips and requests preserve typed command metadata");
check(adapter.includes('buildCommandChip("Return policy", "policy_fact"') && adapter.includes('buildCommandChip("Queen pricing", "price_quote"'), "deterministic adaptive chips use typed policy and price commands");
check(page.includes('createShowroomCommand("analyze_cart")') && page.includes('createShowroomCommand("motion_base_features")'), "human starter labels preserve their exact typed backend commands");
check(page.includes('data-ask-message="latest-answer"') && page.includes('data-ask-history="earlier"'), "latest answer dominates while prior turns remain visible");
check(page.includes('data-ask-product-card="true"') && page.includes("h-[106px] w-[116px]") && page.includes("min-h-11"), "recommendation cards use showroom-scale imagery and touch targets");
check(page.includes('bg-[#2f57e8]') && !page.includes('bg-[#16315F] text-white'), "canonical blue owns primary actions instead of legacy Ask navy");

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
check(formatProductPrice({ pricingMode: "unresolved", priceRange: { min: 549, max: 1099, currencyCode: "USD" } }) === "Price not currently verified", "unresolved exact configuration never displays the product minimum or implies out-of-stock");
check(adapter.includes("sanitizeShopperCopy") && adapter.includes("replace(/<[^>]*>/g"), "adapter strips formatting artifacts and unsafe HTML before display or speech");
check(formatProductPrice({ pricingMode: "exact_variant", price: 1099, priceRange: { min: 549, max: 1099, currencyCode: "USD" } }) === "$1,099.00", "exact variant card displays the exact active-size price");

const add = buildProductAddAction(normalized);
check(add?.type === "add_to_cart" && add.payload.merchandiseId === exactId, "exact product creates structured add_to_cart action");
check(buildProductAddAction({ ...normalized, exactVariantResolved: false }) === null, "unresolved configuration cannot create cart action");
check(buildProductAddAction({ ...normalized, available: false }) === null, "unavailable product cannot create cart action");
check(normalizeAskStationAction({ type: "add_to_cart", label: "Add", payload: { merchandiseId: "123" } }) === null, "invalid variant ID is rejected");
const bundleAction = normalizeAskStationAction({
  type: "add_to_cart",
  label: "Add complete setup to cart",
  payload: {
    scope: "complete_setup",
    lines: [
      { merchandiseId: "gid://shopify/ProductVariant/123", title: "Mattress" },
      { merchandiseId: "gid://shopify/ProductVariant/456", title: "Motion base" },
    ],
  },
});
check(bundleAction?.payload?.lines?.length === 2 && bundleAction.payload.scope === "complete_setup", "bundle action preserves every exact Shopify line in one mutation payload");
check(normalizeAskStationAction({ type: "add_to_cart", label: "Bad bundle", payload: { lines: [{ merchandiseId: exactId }, { merchandiseId: "bad" }] } }) === null, "bundle action is rejected when any line lacks an exact variant GID");
check(isValidProductVariantGid(exactId) && !isValidProductVariantGid("gid://shopify/Product/123"), "variant GID validation is exact");
check(!JSON.stringify(normalized).includes("firstAvailableVariantId"), "first-available identity is not treated as selected configuration");
const comparePrompt = buildComparePrompt(normalized, [
  normalized,
  { handle: "12-all-foam-mattress", title: "12-inch All Foam Mattress" },
]);
check(comparePrompt === "Compare 14 Hybrid with 12-inch All Foam Mattress", "Compare uses shopper-facing product names");
check(!comparePrompt.includes("14-hybrid") && !comparePrompt.includes("12-all-foam-mattress"), "Compare does not expose product handles");
check(page.includes("sendMessage(buildComparePrompt(selected, siblings)"), "product-card comparisons send distinct shopper-facing questions for accurate telemetry");
check(page.includes('addLinesToAuthoritativeCart({ lines: action.payload.lines, sourcePage: "ask-snoozer" })'), "complete setup actions use one authoritative multi-line cart mutation");
check(cartItemCount([{ quantity: 2 }, { quantity: 1 }]) === 3, "cart count sums authoritative quantities");

console.log(`Ask Snoozer station frontend tests passed (${checks} checks).`);
