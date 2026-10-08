const assert = require("assert");
const {
  buildCartAction,
  quoteConfiguration,
  resolveConfigurationCompatibility,
} = require("../services/askSnoozerConfigurationQuote");

function product(handle, options) {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    variants: options.map(({ title, price, id }) => ({
      id: `gid://shopify/ProductVariant/${id}`,
      title,
      availableForSale: true,
      selectedOptions: [{ name: "Size", value: title }],
      price: { amount: String(price), currencyCode: "USD" },
    })),
  };
}

const products = new Map([
  ["14-hybrid", product("14-hybrid", [{ title: "Queen", price: 2399, id: 1401 }])],
  ["12-dual-comfort-hybrid", product("12-dual-comfort-hybrid", [{ title: "Queen", price: 2499, id: 1201 }])],
  ["premium-motion-adjustable-base", product("premium-motion-adjustable-base", [
    { title: "Queen (2pc)", price: 2199, id: 9002 },
  ])],
]);

async function fetchProductsByHandles({ handles }) {
  return { items: handles.map((handle) => products.get(handle)).filter(Boolean) };
}

async function main() {
  assert.deepStrictEqual(
    resolveConfigurationCompatibility({
      mattressHandle: "14-hybrid",
      baseHandle: "premium-motion-adjustable-base",
      motionKey: "half_split",
      size: "Queen",
    }),
    { status: "incompatible", reason: "split_motion_requires_dual_comfort" }
  );

  const incomplete = await quoteConfiguration({ mattressHandle: "14-hybrid", fetchProductsByHandles });
  assert.equal(incomplete.status, "partial");
  assert.equal(incomplete.subtotal, null);
  assert.equal(incomplete.cartReady, false);

  const incompatible = await quoteConfiguration({
    mattressHandle: "14-hybrid",
    baseHandle: "premium-motion-adjustable-base",
    size: "Queen",
    motionKey: "half_split",
    fetchProductsByHandles,
  });
  assert.equal(incompatible.status, "incompatible");
  assert.equal(buildCartAction(incompatible), null);

  const complete = await quoteConfiguration({
    mattressHandle: "12-dual-comfort-hybrid",
    baseHandle: "premium-motion-adjustable-base",
    size: "Queen",
    motionKey: "half_split",
    fetchProductsByHandles,
  });
  assert.equal(complete.status, "complete");
  assert.equal(complete.subtotal, 4698);
  assert.equal(complete.items.length, 2);
  assert.equal(complete.cartReady, true);
  const action = buildCartAction(complete);
  assert.equal(action.payload.lines.length, 2);
  assert(action.payload.lines.every((line) => /^gid:\/\/shopify\/ProductVariant\//.test(line.merchandiseId)));

  console.log("Ask Snoozer configuration quote characterization tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
