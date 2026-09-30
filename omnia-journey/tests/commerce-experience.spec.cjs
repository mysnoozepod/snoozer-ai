const { test, expect } = require("@playwright/test");

const API_ROOT = "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod";
const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='320'%3E%3Crect width='500' height='320' rx='30' fill='%23eef3ff'/%3E%3Cpath d='M90 170h320v70H90z' fill='%232f57e8'/%3E%3C/svg%3E";

function variant(id, title, price, available = true, optionName = "Size") {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    title,
    price: String(price),
    currencyCode: "USD",
    available,
    availableForSale: available,
    selectedOptions: [{ name: optionName, value: title }],
  };
}
function product(handle, title, categoryId, categoryLabel, price, variants) {
  return {
    handle,
    title,
    description: `${title} uses verified Shopify product details for showroom comparison.`,
    imageUrl: image,
    images: [{ url: image, alt: title }, { url: `${image}#two`, alt: `${title} alternate` }],
    variants,
    priceRange: { min: price, max: Math.max(...variants.map((item) => Number(item.price))), currencyCode: "USD" },
    available: variants.some((item) => item.available),
    tags: [`category:${categoryId}`],
    commerceCategoryId: categoryId,
    commerceCategoryLabel: categoryLabel,
  };
}

const products = [
  product("14-hybrid", '14" Hybrid Mattress', "mattresses", "Mattresses", 3199, [variant("1001", "Queen", 3199), variant("1002", "King", 3599), variant("1003", "California King", 3699, false)]),
  product("premium-motion-adjustable-base", "Premium Motion Adjustable Base", "bases", "Bases", 2799, [variant("2001", "Queen", 2799)]),
  product("carboncool-omniphase-pillow", "CarbonCool Omniphase Pillow", "pillows", "Pillows", 169, [variant("3001", "Queen", 169, true, "Pillow Size")]),
  product("hyper-cotton-sheet-set", "Hyper Cotton Sheet Set", "sheets_bedding", "Bedding & Sheets", 229, [variant("4001", "King", 229)]),
  product("ver-tex-mattress-protector", "Ver-Tex Mattress Protector", "protectors", "Protectors", 149, [variant("5001", "King", 149)]),
  product("storage-base", "Storage Base", "bases", "Bases", 999, [variant("6001", "Queen", 999)]),
];

function catalog() {
  const ids = [
    ["mattresses", "Mattresses"], ["bases", "Bases"], ["pillows", "Pillows"],
    ["sheets_bedding", "Bedding & Sheets"], ["protectors", "Protectors"],
  ];
  return {
    source: "shopify",
    categories: ids.map(([id, label]) => ({ id, label, handles: products.filter((item) => item.commerceCategoryId === id).map((item) => item.handle) })),
    products: products.map((item, featuredRank) => ({ ...item, featuredRank })),
    missingHandles: [],
  };
}

function cartLine({ id, variantId, title, handle, price, attributes = [], quantity = 1 }) {
  return {
    id: `gid://shopify/CartLine/${id}`,
    quantity,
    attributes,
    merchandise: {
      id: variantId,
      title: "Selected option",
      image: { url: image, altText: title },
      product: { title, handle },
      price: { amount: String(price), currencyCode: "USD" },
    },
  };
}

function mixedCart() {
  return [
    cartLine({ id: "mattress", variantId: "gid://shopify/ProductVariant/9001", title: '14" Hybrid Mattress', handle: "14-hybrid", price: 3199, attributes: [{ key: "_SnoozePod", value: "SnoozePod 3" }, { key: "_Mattress", value: '14" Hybrid' }, { key: "Size", value: "King" }] }),
    cartLine({ id: "base", variantId: "gid://shopify/ProductVariant/9002", title: "Premium Motion Adjustable Base", handle: "premium-motion-adjustable-base", price: 2799, attributes: [{ key: "_SnoozePod", value: "SnoozePod 3" }, { key: "_Base", value: "Adjustable Base" }, { key: "Size", value: "King" }] }),
    cartLine({ id: "pillow", variantId: "gid://shopify/ProductVariant/3001", title: "CarbonCool Omniphase Pillow", handle: "carboncool-omniphase-pillow", price: 169, attributes: [{ key: "_Source", value: "Sleep Essentials" }, { key: "_Sleep Essential", value: "pillows" }] }),
    cartLine({ id: "sheets", variantId: "gid://shopify/ProductVariant/4001", title: "Hyper Cotton Sheet Set", handle: "hyper-cotton-sheet-set", price: 229, attributes: [{ key: "_Source", value: "Sleep Essentials" }, { key: "_Sleep Essential", value: "sheets_bedding" }] }),
    cartLine({ id: "other", variantId: "gid://shopify/ProductVariant/6001", title: "Storage Base", handle: "storage-base", price: 999, attributes: [{ key: "_Source", value: "Shop" }, { key: "_Shop Category", value: "bases" }] }),
  ];
}

function cartPayload(lines) {
  return {
    cart: {
      id: "gid://shopify/Cart/commerce",
      checkoutUrl: "https://checkout.example.test/commerce",
      lines: { nodes: lines },
    },
  };
}

async function installMocks(page, options = {}) {
  let lines = [...(options.initialLines || [])];
  const calls = { adds: [], updates: [], removes: [], clears: 0, checkout: 0 };
  await page.addInitScript(() => {
    sessionStorage.setItem("snooze.shopperId", "commerce-shopper");
    sessionStorage.setItem("snooze.snoozeCode", "2468");
    sessionStorage.setItem("snooze.sessionId", "commerce-session");
    sessionStorage.setItem("snooze.rewardsIdentityLink.v1", "commerce-shopper:commerce-session");
    sessionStorage.setItem("snooze.sessionState.v1", JSON.stringify({ version: 2, shopperId: "commerce-shopper", snoozeCode: "2468", sessionId: "commerce-session" }));
    sessionStorage.setItem("snooze.recommendations", JSON.stringify({ pods: [{ mattressHandle: "14-hybrid" }] }));
  });
  await page.route(`${API_ROOT}/**`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "*" } });
    const path = new URL(route.request().url()).pathname.replace(/^\/prod/, "");
    let body = {}; try { body = JSON.parse(route.request().postData() || "{}"); } catch {}
    const reply = (payload, status = 200) => route.fulfill({ status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(payload) });
    if (path === "/shopify/showroom/catalog") {
      if (options.catalogDelay) await new Promise((resolve) => setTimeout(resolve, options.catalogDelay));
      if (options.catalogFailure) return reply({ message: "Catalog unavailable" }, 503);
      const nextCatalog = catalog();
      if (options.imageFailure) {
        const broken = nextCatalog.products.find((item) => item.handle === "carboncool-omniphase-pillow");
        broken.imageUrl = "https://invalid.test/missing.png";
        broken.images = [{ url: "https://invalid.test/missing.png", alt: broken.title }];
      }
      return reply({ catalog: nextCatalog });
    }
    if (path === "/shopify/cart/owned/resolve") return reply(cartPayload(lines));
    if (path === "/shopify/cart/owned/addLines") {
      calls.adds.push(body);
      const requested = body.lines[0];
      const match = products.flatMap((item) => item.variants.map((variant) => ({ product: item, variant }))).find((item) => item.variant.id === requested.merchandiseId);
      lines.push(cartLine({ id: `added-${lines.length}`, variantId: requested.merchandiseId, title: match.product.title, handle: match.product.handle, price: match.variant.price, attributes: requested.attributes }));
      return reply(cartPayload(lines));
    }
    if (path === "/shopify/cart/owned/updateLines") {
      calls.updates.push(body);
      for (const update of body.lines || []) lines = lines.map((line) => line.id === update.id ? { ...line, quantity: update.quantity } : line);
      return reply(cartPayload(lines));
    }
    if (path === "/shopify/cart/owned/removeLines") {
      calls.removes.push(body);
      lines = lines.filter((line) => !(body.lineIds || []).includes(line.id));
      return reply(cartPayload(lines));
    }
    if (path === "/shopify/cart/owned/clear") { calls.clears += 1; lines = []; return reply(cartPayload(lines)); }
    if (path === "/shopify/cart/owned/replace") return reply(cartPayload(lines));
    if (path === "/shopify/cart/owned/prepareCheckout") {
      calls.checkout += 1;
      if (options.checkoutFailure) return reply({ message: "Checkout unavailable" }, 503);
      return reply(cartPayload(lines));
    }
    if (path.startsWith("/rewards/")) return reply({ summary: { availableSleepPoints: 320 } });
    if (path.startsWith("/journey/")) return reply({ activeJourney: { journeyId: "commerce-journey", revision: 1 } });
    if (path === "/session/start") return reply({ session_id: "commerce-session" });
    return reply({});
  });
  await page.route("https://checkout.example.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Shopify Checkout</title><h1>Secure checkout</h1>" }));
  await page.route("https://invalid.test/**", (route) => route.abort());
  return { calls, lines: () => lines };
}

test("Shop renders only the approved catalog and supports search, sort, Quick View, variants, and cart", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const mocks = await installMocks(page);
  await page.goto("/shop", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-shop-product-card]')).toHaveCount(products.length);
  await expect(page.getByText("Unapproved Product", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-commerce-header="true"] img[alt="MySnoozePod"]')).toHaveAttribute("src", /mysnoozepod-logo-welcome/);

  await page.getByPlaceholder("Search products, features, or brands...").fill("CarbonCool");
  await expect(page.locator('[data-shop-product-card]')).toHaveCount(1);
  await expect(page.locator('[data-shop-product-card="carboncool-omniphase-pillow"]')).toBeVisible();
  await page.getByPlaceholder("Search products, features, or brands...").fill("");
  await page.getByLabel("Sort products").selectOption("price-high");
  await expect(page.locator('[data-shop-product-card]').first()).toHaveAttribute("data-shop-product-card", "14-hybrid");

  const trigger = page.getByRole("button", { name: 'Quick View 14" Hybrid Mattress' });
  await trigger.focus();
  await trigger.click();
  const quick = page.locator('[data-shop-quick-view="true"]');
  await expect(quick).toBeVisible();
  await expect(quick).toContainText('14" Hybrid Mattress');
  await expect(quick.getByRole("option", { name: /California King.*Unavailable/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(quick).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByLabel("Choose an available option").selectOption("gid://shopify/ProductVariant/1002");
  await quick.getByRole("button", { name: "Add to Cart" }).click();
  await expect(page.getByText(/added to your Shopify cart/)).toBeVisible();
  expect(mocks.calls.adds).toHaveLength(1);
  expect(mocks.calls.adds[0].lines[0].merchandiseId).toBe("gid://shopify/ProductVariant/1002");
  expect(mocks.calls.adds[0].lines[0].attributes).toEqual(expect.arrayContaining([{ key: "_Source", value: "Shop" }]));
  await expect(page.getByRole("button", { name: /Cart 1 item/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("Shop keeps its shell visible during loading and shows an explicit catalog failure", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installMocks(page, { catalogDelay: 1500, catalogFailure: true });
  await page.goto("/shop", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-commerce-header="true"]')).toBeVisible();
  await expect(page.locator('[data-shop-loading="true"]')).toBeVisible();
  await expect(page.locator('[data-shop-error="true"]')).toContainText("Products are temporarily unavailable.");
  await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
});

test("Shop image failure keeps the product and commerce actions readable", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await installMocks(page, { imageFailure: true });
  await page.goto("/shop", { waitUntil: "domcontentloaded" });
  const card = page.locator('[data-shop-product-card="carboncool-omniphase-pillow"]');
  await expect(card.getByText("Image unavailable", { exact: true })).toBeVisible();
  await expect(card.getByText("CarbonCool Omniphase Pillow", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Quick View", exact: true })).toBeEnabled();
});

test("Cart deterministically groups mixed lines, hides private metadata, preserves origin, and uses Shopify mutations", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const mocks = await installMocks(page, { initialLines: mixedCart() });
  await page.goto("/shop", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-shop-product-card]')).toHaveCount(products.length);
  await page.getByRole("button", { name: /Cart 5 items/ }).click();

  await expect(page.getByRole("heading", { name: "Review your sleep setup." })).toBeVisible();
  await expect(page.locator('[data-cart-group="snoozepod"] [data-cart-line]')).toHaveCount(2);
  await expect(page.locator('[data-cart-group="sleep-essentials"] [data-cart-line]')).toHaveCount(2);
  await expect(page.locator('[data-cart-group="other"] [data-cart-line]')).toHaveCount(1);
  await expect(page.getByText("_SnoozePod", { exact: true })).toHaveCount(0);
  await expect(page.getByText("_Source", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Continue Shopping/ })).toHaveAttribute("href", "/shop");

  const other = page.locator('[data-cart-group="other"]');
  await other.getByRole("button", { name: /Increase Storage Base.*quantity/ }).click();
  await expect.poll(() => mocks.calls.updates.length).toBe(1);
  expect(mocks.calls.updates[0].lines[0].id).toBe("gid://shopify/CartLine/other");
  await other.getByRole("button", { name: "Remove" }).click();
  await expect.poll(() => mocks.calls.removes.length).toBe(1);
  await expect(page.locator('[data-cart-group="other"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Clear Cart" }).click();
  await expect(page.getByText("Clear every item from this Shopify cart?")).toBeVisible();
  expect(mocks.calls.clears).toBe(0);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(mocks.calls.clears).toBe(0);

  await page.getByRole("button", { name: /Continue to Secure Checkout/ }).click();
  await expect(page).toHaveURL("https://checkout.example.test/commerce");
  expect(mocks.calls.checkout).toBe(1);
});

test("Cart only clears after confirmation and keeps confirmed items when checkout preparation fails", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const mocks = await installMocks(page, { initialLines: mixedCart(), checkoutFailure: true });
  await page.goto("/cart", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: /Continue to Secure Checkout/ }).click();
  await expect(page.getByText("We couldn't refresh your cart right now. Your selections are still saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.locator("[data-cart-line]")).toHaveCount(5);
  expect(mocks.calls.checkout).toBe(1);

  await page.getByRole("button", { name: "Clear Cart" }).click();
  await expect(page.getByText("Clear every item from this Shopify cart?")).toBeVisible();
  expect(mocks.calls.clears).toBe(0);
  await page.getByRole("button", { name: "Confirm Clear Cart" }).click();
  await expect.poll(() => mocks.calls.clears).toBe(1);
  await expect(page.getByText("Cart cleared.")).toBeVisible();
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
});

for (const viewport of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }, { width: 1366, height: 768 }]) {
  test(`Shop has no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installMocks(page);
    await page.goto("/shop", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-shop-product-grid="true"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (viewport.width === 1024) {
      await page.getByRole("button", { name: 'Quick View 14" Hybrid Mattress' }).click();
      await expect(page.locator('[data-shop-quick-view="true"]')).toBeVisible();
      await expect(page.locator('[data-shop-quick-view="true"]').getByRole("button", { name: "Add to Cart" })).toBeVisible();
    }
  });

  test(`Cart remains usable without horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installMocks(page, { initialLines: mixedCart() });
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Review your sleep setup." })).toBeVisible();
    await expect(page.locator('[data-cart-group="snoozepod"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue to Secure Checkout/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
