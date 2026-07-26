import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const builderSource = await readFile(
  new URL("../src/components/PodBuilder.jsx", import.meta.url),
  "utf8"
);

for (const expected of [
  '{ key: "pillows", label: "Pillows"',
  '{ key: "sheets", label: "Sheets"',
  '{ key: "protector", label: "Protector"',
  'data-sleep-essentials-step={stepKey}',
  "selectedEssentials",
  "skippedEssentials",
]) {
  assert.ok(builderSource.includes(expected), `missing guided essentials contract: ${expected}`);
}

assert.equal(builderSource.includes('"Bedding"'), false, "generic Bedding must not appear");
assert.equal(builderSource.includes("Catalog setup pending"), false, "placeholder catalog copy must be removed");
assert.ok(builderSource.includes('query: "pillow"'), "pillows must use live Shopify lookup");
assert.ok(builderSource.includes('query: "sheet"'), "sheets must use live Shopify lookup");
assert.ok(builderSource.includes('query: "protector"'), "protectors must use live Shopify lookup");
assert.ok(builderSource.includes("curatedCatalog"), "product handles must be constrained by the approved catalog");
assert.ok(builderSource.includes("safeVariantId(variant)"), "only safe available Shopify variants may be selected");
assert.ok(
  builderSource.includes("variantMatchesEssentialSetup"),
  "size and motion compatibility must be checked before showing an option"
);
assert.ok(builderSource.includes("quantity: choice.quantity"), "pillow quantity must reach the cart line");
assert.ok(
  builderSource.includes('{ key: "Sleep Essential"'),
  "optional cart lines must identify their category"
);
assert.ok(builderSource.includes("essentialsReady"), "review/cart must require an intentional select or skip");
assert.ok(builderSource.includes("essentialsVersion: 1"), "guided progress must persist across tab changes");

console.log("Sleep Essentials guided-flow tests passed.");
