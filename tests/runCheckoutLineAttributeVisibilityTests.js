const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

async function main() {
  const cartContract = await import(
    pathToFileURL(path.join(root, "omnia-journey/src/lib/cart/cartContract.mjs"))
  );

  const attributes = [
    { key: "Size", value: "King" },
    { key: "_Setup Size", value: "King" },
    { key: "_Variant Option", value: "Split King" },
    { key: "_SnoozePod", value: "SnoozePod 4" },
    { key: "Pillow Size", value: "King" },
  ];
  const line = {
    merchandiseId: "gid://shopify/ProductVariant/987654321",
    quantity: 1,
    attributes,
  };

  assert.deepEqual(
    cartContract.normalizeMutationLine(line).attributes,
    cartContract.normalizeCartAttributes(attributes),
    "private checkout metadata must stay on the Shopify cart line for deterministic comparison"
  );
  assert.equal(
    cartContract.cartLinesEqual([line], [{ ...line, attributes: [...attributes].reverse() }]),
    true,
    "private checkout metadata ordering must not affect cart comparison"
  );
  assert.equal(
    cartContract.cartLinesEqual(
      [line],
      [{ ...line, attributes: attributes.map((attr) => attr.key === "_SnoozePod" ? { ...attr, value: "SnoozePod 1" } : attr) }]
    ),
    false,
    "private setup metadata must still prevent accidental line merges"
  );

  const podBuilder = read("omnia-journey/src/components/PodBuilder.jsx");
  const sleepEssentials = read("omnia-journey/src/pages/SleepEssentials.jsx");
  const cartPage = read("omnia-journey/src/pages/Cart.jsx");

  for (const publicKey of [
    "Setup Size",
    "Variant Option",
    "Mattress",
    "Base",
    "Product",
    "Option",
    "Sleep Essential",
    "SnoozePod",
  ]) {
    assert(
      !podBuilder.includes(`key: "${publicKey}"`),
      `${publicKey} must not be sent as a public checkout line attribute from Pod Builder`
    );
  }

  assert(podBuilder.includes('key: "_Setup Size"'), "Pod Builder must keep private setup-size metadata");
  assert(podBuilder.includes('key: "_Variant Option"'), "Pod Builder must keep private variant metadata");
  assert(podBuilder.includes('key: "_SnoozePod"'), "Pod Builder must keep private SnoozePod metadata");
  assert(podBuilder.includes('key: "Pillow Size"'), "Pillow size should remain visible to shoppers");
  assert(sleepEssentials.includes('key: "_Source"'), "Sleep Essentials source must be private metadata");
  assert(sleepEssentials.includes('key: "_Sleep Essential"'), "Sleep Essentials category must be private metadata");
  assert(cartPage.includes("displayAttributeKey"), "Cart details should display private metadata without underscores");

  console.log("Checkout line attribute visibility checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
