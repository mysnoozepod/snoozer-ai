const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function product(options) {
  return {
    variants: options.map((option, index) => ({
      id: `gid://shopify/ProductVariant/${1000 + index}`,
      title: option.title || option.value,
      selectedOptions: [{ name: "Size", value: option.value }],
      availableForSale: option.available !== false,
    })),
  };
}

async function main() {
  const variantResolution = await import(
    pathToFileURL(path.join(root, "omnia-journey/src/lib/cart/variantResolution.mjs"))
  );
  const cartContract = await import(
    pathToFileURL(path.join(root, "omnia-journey/src/lib/cart/cartContract.mjs"))
  );

  const sizeProduct = product([
    { value: "Twin XL" },
    { value: "Queen" },
    { value: "King" },
    { value: "Split King" },
    { value: "King (2pc)" },
  ]);

  const standardMattress = variantResolution.resolveApprovedVariant({
    product: sizeProduct,
    category: "mattress",
    setupSize: "King",
    motionType: "standard",
  });
  assert.equal(standardMattress.ok, true);
  assert.equal(standardMattress.actualOption, "King");

  const standardBase = variantResolution.resolveApprovedVariant({
    product: sizeProduct,
    category: "adjustable_base",
    setupSize: "King",
    motionType: "standard",
  });
  assert.equal(standardBase.ok, true);
  assert.equal(standardBase.actualOption, "King (2pc)");

  for (const category of ["mattress", "sheets", "protector"]) {
    const resolved = variantResolution.resolveApprovedVariant({
      product: sizeProduct,
      category,
      setupSize: "King",
      motionType: "full_split",
    });
    assert.equal(resolved.ok, true, `${category} should resolve exactly`);
    assert.equal(resolved.actualOption, "Split King", `${category} must use Split King`);
  }

  const splitBase = variantResolution.resolveApprovedVariant({
    product: sizeProduct,
    category: "adjustable_base",
    setupSize: "King",
    motionType: "full_split",
  });
  assert.equal(splitBase.actualOption, "King (2pc)");

  const queenPillow = variantResolution.resolveApprovedVariant({
    product: sizeProduct,
    category: "pillow",
    setupSize: "King",
    motionType: "full_split",
    requestedOption: "Queen",
  });
  assert.equal(queenPillow.ok, true);
  assert.equal(queenPillow.actualOption, "Queen");

  const missing = variantResolution.resolveApprovedVariant({
    product: product([{ value: "Twin XL" }, { value: "Queen" }]),
    category: "mattress",
    setupSize: "King",
    motionType: "full_split",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "EXACT_OPTION_NOT_FOUND");
  assert.equal(missing.variantId, undefined, "missing exact options must never use the first variant");

  const unavailable = variantResolution.resolveApprovedVariant({
    product: product([{ value: "Split King", available: false }, { value: "Twin XL" }]),
    category: "protector",
    setupSize: "King",
    motionType: "full_split",
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.reason, "EXACT_OPTION_UNAVAILABLE");

  const similarButInvalid = variantResolution.resolveApprovedVariant({
    product: product([{ value: "Split King (2pc)" }, { value: "Queen" }]),
    category: "sheets",
    setupSize: "King",
    motionType: "full_split",
  });
  assert.equal(similarButInvalid.ok, false);
  assert.equal(similarButInvalid.reason, "EXACT_OPTION_NOT_FOUND");

  const attributesA = [
    { key: "Setup", value: "SnoozePod 4" },
    { key: "Variant Option", value: "Split King" },
  ];
  const attributesReordered = [...attributesA].reverse();
  const attributesB = [
    { key: "Setup", value: "SnoozePod 1" },
    { key: "Variant Option", value: "Split King" },
  ];
  const line = {
    merchandiseId: "gid://shopify/ProductVariant/1003",
    quantity: 1,
    attributes: attributesA,
  };

  assert.equal(
    cartContract.cartLinesEqual([line], [{ ...line, attributes: attributesReordered }]),
    true,
    "attribute ordering must not invalidate an otherwise identical cart"
  );
  assert.equal(
    cartContract.cartLinesEqual([line], [{ ...line, attributes: attributesB }]),
    false,
    "different setup attributes must remain distinct"
  );
  assert.equal(
    cartContract.cartLinesEqual([line], [{ ...line, quantity: 2 }]),
    false,
    "quantity changes must invalidate checkout reuse"
  );
  assert.notEqual(
    cartContract.plannedCartLineKey(line),
    cartContract.plannedCartLineKey({ ...line, attributes: attributesB }),
    "planned lines must not merge by variant alone"
  );
  assert.deepEqual(
    cartContract.normalizeMutationLine(line).attributes,
    cartContract.normalizeCartAttributes(attributesA),
    "checkout recreation must retain normalized line attributes"
  );

  const builder = read("omnia-journey/src/components/PodBuilder.jsx");
  const mainSource = read("omnia-journey/src/main.jsx");
  const checkout = read("omnia-journey/src/pages/Checkout.jsx");
  const store = read("omnia-journey/src/lib/useStore.js");
  assert(!builder.includes("variants[0]"), "Pod Builder must not contain first-variant fallback");
  assert(builder.includes('quantity: 1'), "King (2pc) base must remain one Shopify line at quantity 1");
  assert(builder.includes('key: "Variant Option"'), "cart lines must describe the resolved variant");
  assert(builder.includes('key: "Setup Size"'), "cart lines must preserve setup intent separately");
  assert(!mainSource.includes("<CartProvider"), "the legacy CartProvider must not be mounted");
  assert(checkout.includes("prepareCheckoutCart"), "checkout must use the lossless cart handoff");
  assert(!checkout.includes("discountCode"), "checkout must not turn typed discounts into notes");
  assert(store.includes("serializeCartMutation"), "cart mutations must be serialized");
  assert(store.includes("api.clearShopperCart"), "signed-in clear must mutate the profile-owned cart");
  assert(store.includes("cartLinesEqual(desiredLines, serverLines)"), "checkout reuse must compare full lines");

  console.log("Commerce correctness regression checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
