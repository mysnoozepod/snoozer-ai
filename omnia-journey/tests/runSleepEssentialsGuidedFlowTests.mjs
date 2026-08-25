import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [builderSource, pageSource, podSource, welcomeSource, sleepLibSource, variantSource, apiSource] = await Promise.all([
  readSource("../src/components/PodBuilder.jsx"),
  readSource("../src/pages/SleepEssentials.jsx"),
  readSource("../src/pages/Pod.jsx"),
  readSource("../src/pages/Welcome.jsx"),
  readSource("../src/lib/sleepEssentials.js"),
  readSource("../src/lib/cart/variantResolution.mjs"),
  readSource("../src/lib/api.js"),
]);

for (const expected of [
  'label: "Pillows"',
  'label: "Sheets"',
  'label: "Mattress Protectors"',
  'data-sleep-essentials-step="combined"',
  'data-sleep-essentials-card-row="three"',
  'ESSENTIAL_CARD_KEYS = Object.freeze(["pillows", "sheets", "protector"])',
  "recommendedEssentialChoices",
  "selectedEssentials",
  "skippedEssentials",
]) {
  assert.ok(builderSource.includes(expected), `missing Pod essentials contract: ${expected}`);
}

assert.ok(builderSource.includes("api.getSleepEssentialsCatalog()"), "Pod must use the approved live catalog endpoint");
assert.ok(apiSource.includes("getSleepEssentialsCatalog"), "the approved Sleep Essentials API must remain wired");
assert.ok(builderSource.includes("safeVariantId(variant)"), "only safe available Shopify variants may be selected");
assert.ok(builderSource.includes("resolveCuratedSheetVariant"), "composite sheet variants must resolve deterministically for the selected mattress size");
assert.ok(variantSource.includes("requestedOptionForConfiguration"), "setup compatibility must be checked");
assert.ok(variantSource.includes("resolveApprovedVariant"), "approved variants must be resolved deterministically");
assert.ok(builderSource.includes("resolveMattressSizeFromCart"), "cart mattress variants must resolve back to exact sizes");
assert.ok(builderSource.includes("cartMattressSize || initialSelections.size"), "cart size must initialize Customize");
assert.ok(builderSource.includes("cartVariantIds.has(choice.variantId)"), "Pod selection must read shared cart truth");
assert.ok(builderSource.includes("quantity: choice.quantity"), "pillow quantity must reach the cart line");
assert.ok(builderSource.includes('{ key: "_Sleep Essential"'), "optional cart lines must identify their category");
assert.equal(builderSource.includes("Choose your size, motion setup, and sleep essentials"), false);

for (const expected of [
  'data-sleep-essentials-device="curated"',
  "products.slice(0, INITIAL_PRODUCT_LIMIT)",
  'role="tablist"',
  'data-sleep-essentials-product-grid="true"',
  '"✓ In Cart"',
  '"Add to Cart"',
  "syncCartFromShopify",
  "cartVariantIds.has(merchandiseId)",
  'sourcePage: "sleep-essentials"',
  'action: "reviewed_no_selection"',
  "recordedCategoryViewsRef",
  "Finish Sleep Essentials",
  "getSleepEssentialsFinishPath",
]) {
  assert.ok(pageSource.includes(expected), `missing dedicated Sleep Essentials contract: ${expected}`);
}

for (const removed of [
  "Save choice",
  "Review without a selection",
  "categories reviewed",
  "Review all three categories",
  "Complete Sleep Essentials",
  "Complete your sleep setup.",
]) {
  assert.equal(pageSource.includes(removed), false, `removed catalog copy still present: ${removed}`);
}

assert.ok(sleepLibSource.includes("getSleepEssentialsFinishPath"));
assert.ok(sleepLibSource.includes('buildPodCustomizeReturnPath(podId, "review")'));
assert.ok(podSource.includes('params.get("stage")'), "Pod return context must restore its requested stage");
assert.ok(podSource.includes('params.get("buildStep")'), "Pod return context must restore its requested Customize step");
assert.ok(podSource.includes("hydratedPodIdRef.current !== pid"), "recommendation hydration must not reset the current Pod session");
assert.equal(welcomeSource.includes("starts automatically after the fourth digit"), false);

console.log("Sleep Essentials Phase 3 tests passed: curated device, shared cart truth, Pod continuity, rewards idempotency, and clean navigation.");
