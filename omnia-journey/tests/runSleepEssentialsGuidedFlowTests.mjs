import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [
  builderSource,
  pageSource,
  podSource,
  welcomeSource,
  sleepLibSource,
  variantSource,
  apiSource,
  layoutSource,
  rewardsPillSource,
  primitivesSource,
  catalogServiceSource,
  catalogManifestSource,
] = await Promise.all([
  readSource("../src/components/PodBuilder.jsx"),
  readSource("../src/pages/SleepEssentials.jsx"),
  readSource("../src/pages/Pod.jsx"),
  readSource("../src/pages/Welcome.jsx"),
  readSource("../src/lib/sleepEssentials.js"),
  readSource("../src/lib/cart/variantResolution.mjs"),
  readSource("../src/lib/api.js"),
  readSource("../src/Layout.jsx"),
  readSource("../src/components/RewardsPill.jsx"),
  readSource("../src/components/showroom/ShowroomPrimitives.jsx"),
  readSource("../../services/sleepEssentialsCatalog.js"),
  readSource("../../data/sleep-essentials-catalog.v1.json"),
]);

for (const removed of [
  'label: "Pillows"',
  'label: "Sheets"',
  'label: "Mattress Protectors"',
  'data-sleep-essentials-step="combined"',
  'data-sleep-essentials-card-row="three"',
  "recommendedEssentialChoices",
  "selectedEssentials",
  "skippedEssentials",
  "api.getSleepEssentialsCatalog()",
  "recordRewardAccessoriesProgress",
  "completeRewardAccessories",
  'sourceSurface: "pod_customize"',
]) {
  assert.equal(builderSource.includes(removed), false, `Pod Customize must not own Sleep Essentials: ${removed}`);
}

assert.ok(apiSource.includes("getSleepEssentialsCatalog"), "the approved Sleep Essentials API must remain wired");
assert.ok(builderSource.includes("safeVariantId(variant)"), "only safe available Shopify variants may be selected");
assert.ok(variantSource.includes("requestedOptionForConfiguration"), "setup compatibility must be checked");
assert.ok(variantSource.includes("resolveApprovedVariant"), "approved variants must be resolved deterministically");
assert.ok(builderSource.includes("resolveMattressSizeFromCart"), "cart mattress variants must resolve back to exact sizes");
assert.ok(builderSource.includes("cartMattressSize || initialSelections.size"), "cart size must initialize Customize");
assert.ok(builderSource.includes("synchronizeCoreCartLines"), "Pod cart synchronization must be explicitly core-only");
assert.equal(builderSource.includes("Choose your size, motion setup, and sleep essentials"), false);

for (const expected of [
  'data-sleep-essentials-device="storefront"',
  'role="tablist"',
  'data-sleep-essentials-category-rail="true"',
  'data-category-state={active ? "current" : "idle"}',
  'data-sleep-essentials-concierge="true"',
  'src="/snoozer-avatar.png"',
  'data-sleep-essentials-toolbar="true"',
  'data-sleep-essentials-sort="true"',
  'data-sleep-essentials-cart-summary="true"',
  'data-sleep-essentials-footer="true"',
  'brandImageSrc={sharpMySnoozePodLogo}',
  'data-sleep-essentials-product-grid="true"',
  "sortedProducts.map((product, index)",
  "In Your Cart",
  '"In Cart"',
  '"Add to Cart"',
  "syncCartFromShopify",
  "cartVariantIds.has(merchandiseId)",
  'sourcePage: "sleep-essentials"',
  'action: "reviewed_no_selection"',
  "recordedCategoryViewsRef",
  "completionAttemptedRef",
  "completeRewardAccessories",
  "confirmedCartItemCount(cart)",
  "ShowroomDownstreamHeader",
  'placement="inline"',
  'getSleepEssentialsVariantLabel(activeCategoryId)',
  'cartVariant || variants.find',
  'Image unavailable',
  'loading={index < 3 ? "eager" : "lazy"}',
  'decoding="async"',
  'navigate("/cart")',
  "View Cart",
]) {
  assert.ok(pageSource.includes(expected), `missing dedicated Sleep Essentials contract: ${expected}`);
}

for (const expected of [
  "getSleepEssentialsVariantLabel",
  "SLEEP_ESSENTIAL_SORT_OPTIONS",
  "sortSleepEssentialProducts",
  'value: "featured"',
  'value: "price-low"',
  'value: "price-high"',
  'value: "name"',
  'return "Pillow Size"',
  'return "Set Size"',
  'return "Mattress Size"',
]) {
  assert.ok(sleepLibSource.includes(expected), `missing deterministic Sleep Essentials storefront contract: ${expected}`);
}

assert.equal(pageSource.includes("WHY TRY IT"), false, "product-specific claims must not be invented");
assert.equal(pageSource.includes("Why Try It"), false, "product-specific claims must not be invented");
assert.equal(pageSource.includes("mb-2 inline-flex min-h-10"), false, "duplicate top return control must be removed");
assert.ok(pageSource.includes('bg-[#2f57e8]'), "Sleep Essentials actions must use the canonical blue");

for (const removed of [
  "INITIAL_PRODUCT_LIMIT",
  "expandedCategories",
  "products.slice(",
  "View More",
  "Show Curated",
]) {
  assert.equal(pageSource.includes(removed), false, `removed assortment limiter still present: ${removed}`);
}

const catalogManifest = JSON.parse(catalogManifestSource);
const approvedHandles = catalogManifest.categories.flatMap((category) => category.handles);
assert.deepEqual(catalogManifest.categories.map((category) => category.handles.length), [37, 8, 7]);
assert.equal(approvedHandles.length, 52, "the complete verified accessory manifest must remain present");
assert.equal(new Set(approvedHandles).size, approvedHandles.length, "approved handles must be unique");
assert.equal(catalogServiceSource.includes("SHOWROOM_PRODUCT_LIMIT"), false, "the old global cap must be removed");
assert.ok(catalogServiceSource.includes("selectApprovedAssortment(document, new Set(byHandle.keys()))"));
assert.ok(catalogServiceSource.includes("document.categories.map"));
assert.equal(catalogServiceSource.includes("slice(0, 3)"), false, "backend must not impose a category allocation");
assert.ok(layoutSource.includes("pageUsesDownstreamHeader"));
assert.ok(layoutSource.includes("!pageUsesDownstreamHeader"));
assert.ok(primitivesSource.includes('data-showroom-downstream-header="true"'));
assert.ok(rewardsPillSource.includes('placement === "inline"'));
assert.ok(podSource.includes("ShowroomDownstreamHeader"), "Pod must use the shared downstream header");
assert.ok(podSource.includes('placement="inline"'), "Pod rewards must be integrated into its header");

for (const removed of [
  "Save choice",
  "Review without a selection",
  "categories reviewed",
  "categories explored",
  "Review all three categories",
  "Complete Sleep Essentials",
  "Finish Sleep Essentials",
  "Snoozer's guidance",
  "What to notice",
]) {
  assert.equal(pageSource.includes(removed), false, `removed catalog copy still present: ${removed}`);
}

assert.ok(sleepLibSource.includes("getSleepEssentialsFinishPath"));
assert.ok(sleepLibSource.includes('buildPodCustomizeReturnPath(podId, "review")'));
assert.ok(podSource.includes('params.get("stage")'), "Pod return context must restore its requested stage");
assert.ok(podSource.includes('params.get("buildStep")'), "Pod return context must restore its requested Customize step");
assert.ok(podSource.includes("hydratedPodIdRef.current !== pid"), "recommendation hydration must not reset the current Pod session");
assert.equal(welcomeSource.includes("starts automatically after the fourth digit"), false);

console.log("Sleep Essentials storefront tests passed: full approved catalog, shared cart truth, Pod continuity, background rewards, sorting, and clean navigation.");
