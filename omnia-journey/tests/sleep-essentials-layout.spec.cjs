const { test, expect } = require("@playwright/test");

const API_ROOT = "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod";
const CATEGORY_IDS = ["pillows", "sheets_bedding", "protectors"];

function variant(id, title, price, available = true) {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    title,
    price: String(price),
    currencyCode: "USD",
    available,
    availableForSale: available,
  };
}

function product(handle, title, variants, imageUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='240'%3E%3Crect width='400' height='240' rx='30' fill='%23e8efff'/%3E%3Cpath d='M80 150h240v40H80z' fill='%232f57e8'/%3E%3C/svg%3E") {
  return { handle, title, imageUrl, variants };
}

function createCatalog({ emptyCategory = "" } = {}) {
  return {
    categories: [
      {
        id: "pillows",
        label: "Pillows",
        description: "Compare support, shape, and temperature feel.",
        products: emptyCategory === "pillows" ? [] : [
          product("showroom-pillow", "Showroom Support Pillow", [
            variant("101", "Standard", 79),
            variant("102", "Queen", 89),
            variant("103", "Unavailable", 99, false),
          ]),
          product("single-pillow", "Single Loft Pillow", [variant("104", "Standard", 69)]),
          product("fallback-pillow", "Pillow with image fallback", [variant("105", "Queen", 59)], "https://invalid.test/missing.png"),
          product("premium-pillow", "Premium Pillow", [variant("106", "Queen", 199)]),
          product("value-pillow", "Affordable Pillow", [variant("107", "Queen", 49)]),
          product("another-pillow", "Balanced Pillow", [variant("108", "Queen", 99)]),
        ],
      },
      {
        id: "sheets_bedding",
        label: "Sheets & Bedding",
        description: "Explore breathable sheet sets for your preferred feel.",
        products: emptyCategory === "sheets_bedding" ? [] : [
          product("showroom-sheets", "Showroom Sheet Set", [variant("201", "Queen", 149), variant("202", "King", 179)]),
          product("cooling-sheets", "Cooling Sheet Set", [variant("203", "Queen", 129)]),
        ],
      },
      {
        id: "protectors",
        label: "Mattress Protectors",
        description: "Protect the sleep surface without losing comfort.",
        products: emptyCategory === "protectors" ? [] : [
          product("showroom-protector", "Showroom Mattress Protector", [variant("301", "Queen", 119), variant("302", "King", 139)]),
          product("smooth-protector", "Smooth Mattress Protector", [variant("303", "Queen", 99)]),
        ],
      },
    ],
  };
}

function cartLine({ id, variantId, title, productTitle, handle, quantity = 1 }) {
  return {
    id,
    quantity,
    merchandise: {
      id: variantId,
      title,
      product: { title: productTitle, handle },
      price: { amount: "89.00", currencyCode: "USD" },
    },
    cost: { totalAmount: { amount: "89.00", currencyCode: "USD" } },
  };
}

async function installMocks(page, {
  catalogDelay = 0,
  catalogFailure = false,
  emptyCategory = "",
  initialReviewed = [],
  initialCartLines = [],
  cartFailure = false,
} = {}) {
  const reviewed = new Set(initialReviewed);
  let cartLines = [...initialCartLines];
  const addRequests = [];
  const completionRequests = [];

  await page.addInitScript(() => {
    sessionStorage.setItem("snooze.shopperId", "pass6-shopper");
    sessionStorage.setItem("snooze.snoozeCode", "2468");
    sessionStorage.setItem("snooze.sessionId", "pass6-session");
    sessionStorage.setItem("snooze.rewardsIdentityLink.v1", "pass6-shopper:pass6-session");
    sessionStorage.setItem("snooze.sessionState.v1", JSON.stringify({
      version: 2,
      shopperId: "pass6-shopper",
      snoozeCode: "2468",
      accessCode: "2468",
      sessionId: "pass6-session",
      threadId: "pass6-thread",
    }));
    sessionStorage.setItem("snooze.assessment", JSON.stringify({
      sleepPosition: "Side",
      sleepTemperature: "Cool",
    }));
  });

  await page.route(`${API_ROOT}/**`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,x-session-id,x-snooze-code",
        },
      });
    }
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/prod/, "");
    const body = (() => {
      try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; }
    })();
    const json = (payload, status = 200) => route.fulfill({
      status,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
      body: JSON.stringify(payload),
    });

    if (path === "/shopify/sleepEssentials/catalog") {
      if (catalogDelay) await new Promise((resolve) => setTimeout(resolve, catalogDelay));
      if (catalogFailure) return json({ message: "Catalog unavailable" }, 503);
      return json({ catalog: createCatalog({ emptyCategory }) });
    }
    if (path === "/rewards/experiences/accessories/status") {
      return json({ progress: { reviewedCategoryIds: [...reviewed], completed: false } });
    }
    if (path === "/rewards/experiences/accessories/progress") {
      if (body.categoryId) reviewed.add(body.categoryId);
      return json({ progress: { reviewedCategoryIds: [...reviewed], completed: false } });
    }
    if (path === "/rewards/experiences/accessories/complete") {
      completionRequests.push(body);
      return json({ result: { completed: true } });
    }
    if (path === "/shopify/cart/owned/resolve") {
      return json({ cart: cartLines.length ? {
        id: "gid://shopify/Cart/pass6",
        checkoutUrl: "https://checkout.example.test/pass6",
        lines: { nodes: cartLines },
      } : null });
    }
    if (path === "/shopify/cart/owned/addLines") {
      addRequests.push(body);
      if (cartFailure) return json({ message: "Cart update unavailable" }, 503);
      const added = body.lines?.[0];
      const addedId = String(added?.merchandiseId || "");
      const addedProduct = addedId.endsWith("/201")
        ? { title: "Showroom Sheet Set", handle: "showroom-sheets" }
        : addedId.endsWith("/301")
          ? { title: "Showroom Mattress Protector", handle: "showroom-protector" }
          : { title: "Showroom Support Pillow", handle: "showroom-pillow" };
      cartLines = [...cartLines, cartLine({
        id: `gid://shopify/CartLine/${cartLines.length + 1}`,
        variantId: added.merchandiseId,
        title: "Queen",
        productTitle: addedProduct.title,
        handle: addedProduct.handle,
      })];
      return json({ cart: {
        id: "gid://shopify/Cart/pass6",
        checkoutUrl: "https://checkout.example.test/pass6",
        lines: { nodes: cartLines },
      } });
    }
    if (path.startsWith("/rewards/")) return json({ summary: { availableSleepPoints: 0 } });
    if (path === "/identity/check-in") return json({ ok: true, snoozeCode: "pass6-shopper", shopperId: "pass6-shopper" });
    if (path.startsWith("/journey/")) return json({ activeJourney: { journeyId: "pass6-journey", revision: 1 } });
    if (path === "/session/start") return json({ session_id: "pass6-session" });
    return json({});
  });

  await page.route("https://invalid.test/**", (route) => route.abort());
  return { addRequests, completionRequests, reviewed, getCartLines: () => cartLines };
}

async function gotoEssentials(page, category = "pillows", returnTo = "/pod/pod-3?stage=build&buildStep=review") {
  const url = `/sleep-essentials?category=${category}&returnTo=${encodeURIComponent(returnTo)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-sleep-essentials-device="storefront"]')).toBeVisible();
}

test("renders the full storefront with real counts, compact concierge, and category navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await installMocks(page);
  await gotoEssentials(page);

  await expect(page.getByRole("heading", { name: "Complete your sleep setup." })).toBeVisible();
  await expect(page.locator('[data-commerce-header="true"] img[alt="MySnoozePod"]')).toHaveAttribute("src", /mysnoozepod-logo-welcome/);
  await expect(page.locator('[data-sleep-essentials-concierge="true"] img')).toBeVisible();
  await expect(page.locator('[data-sleep-essentials-concierge="true"]')).toContainText("Need help choosing?");
  await expect(page.getByRole("tab", { name: /Pillows, 6 products, current/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Sheets & Bedding, 2 products/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Mattress Protectors, 2 products/ })).toBeVisible();
  await expect(page.locator('[data-sleep-essentials-toolbar="true"]')).toContainText("6 products");
  await expect(page.locator('[data-sleep-essentials-product-card]')).toHaveCount(6);
  await expect(page.getByLabel("Showroom Support Pillow Pillow Size")).toBeVisible();
  await expect(page.getByRole("option", { name: "Unavailable" })).toHaveCount(0);
  await expect(page.locator('select[aria-label*="Single Loft Pillow"]')).toHaveCount(0);
  await expect(page.getByText("Image unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/Recommended for You|Tested|Showroom Favorite/i)).toHaveCount(0);
  await expect(page.getByText(/categories explored|Finish Sleep Essentials|What to notice/i)).toHaveCount(0);

  await page.getByRole("tab", { name: /Sheets & Bedding/ }).click();
  await expect(page).toHaveURL(/category=sheets_bedding/);
  await expect(page.locator('[data-category-state="current"]')).toContainText("Sheets & Bedding");
  await expect(page.locator('[data-sleep-essentials-product-card]')).toHaveCount(2);
  await expect(page.getByLabel("Showroom Sheet Set Set Size")).toBeVisible();

  await page.getByRole("tab", { name: /Mattress Protectors/ }).click();
  await expect(page).toHaveURL(/category=protectors/);
  await expect(page.locator('[data-sleep-essentials-product-card]')).toHaveCount(2);
  await expect(page.getByLabel("Showroom Mattress Protector Mattress Size")).toBeVisible();
});

test("sorts the complete category without hiding merchandise", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await installMocks(page);
  await gotoEssentials(page);

  const cards = page.locator('[data-sleep-essentials-product-card]');
  await expect(cards).toHaveCount(6);
  const originalHandles = await cards.evaluateAll((items) => items.map((item) => item.getAttribute("data-sleep-essentials-product-card")));

  await page.getByLabel("Sort products").selectOption("price-low");
  await expect(cards.first()).toHaveAttribute("data-sleep-essentials-product-card", "value-pillow");
  await expect(cards).toHaveCount(6);

  await page.getByLabel("Sort products").selectOption("price-high");
  await expect(cards.first()).toHaveAttribute("data-sleep-essentials-product-card", "premium-pillow");
  await expect(cards).toHaveCount(6);

  await page.getByLabel("Sort products").selectOption("name");
  await expect(cards.first()).toHaveAttribute("data-sleep-essentials-product-card", "value-pillow");
  await page.getByLabel("Sort products").selectOption("featured");
  expect(await cards.evaluateAll((items) => items.map((item) => item.getAttribute("data-sleep-essentials-product-card")))).toEqual(originalHandles);
});

test("adds multiple authoritative accessories across categories and preserves unrelated lines", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const unrelated = cartLine({
    id: "gid://shopify/CartLine/existing",
    variantId: "gid://shopify/ProductVariant/999",
    title: "Standard",
    productTitle: "Existing Sheets",
    handle: "existing-sheets",
  });
  const mocks = await installMocks(page, { initialCartLines: [unrelated] });
  await gotoEssentials(page);

  await page.getByLabel("Showroom Support Pillow Pillow Size").selectOption("gid://shopify/ProductVariant/102");
  await page.locator('[data-sleep-essentials-product-card="showroom-pillow"]').getByRole("button", { name: "Add to Cart" }).click();
  await expect(page.locator('[data-sleep-essentials-product-card="showroom-pillow"]')).toContainText("In Cart");

  await page.getByRole("tab", { name: /Sheets & Bedding/ }).click();
  await page.locator('[data-sleep-essentials-product-card="showroom-sheets"]').getByRole("button", { name: "Add to Cart" }).click();
  await expect(page.locator('[data-sleep-essentials-product-card="showroom-sheets"]')).toContainText("In Cart");

  await page.getByRole("tab", { name: /Mattress Protectors/ }).click();
  await page.locator('[data-sleep-essentials-product-card="showroom-protector"]').getByRole("button", { name: "Add to Cart" }).click();
  await expect(page.locator('[data-sleep-essentials-product-card="showroom-protector"]')).toContainText("In Cart");
  await expect(page.getByRole("button", { name: /Cart 4 items/ })).toBeVisible();

  expect(mocks.addRequests).toHaveLength(3);
  expect(mocks.addRequests.map((request) => request.lines[0].merchandiseId)).toEqual([
    "gid://shopify/ProductVariant/102",
    "gid://shopify/ProductVariant/201",
    "gid://shopify/ProductVariant/301",
  ]);
  for (const request of mocks.addRequests) {
    expect(request.lines).toHaveLength(1);
    expect(request.lines[0].attributes).toEqual(expect.arrayContaining([
      { key: "_Source", value: "Sleep Essentials" },
    ]));
  }
  expect(mocks.getCartLines().some((line) => line.id === unrelated.id)).toBe(true);
  await expect.poll(() => mocks.completionRequests.length).toBe(1);
});

test("keeps the storefront and selections available after a cart failure", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await installMocks(page, { cartFailure: true });
  await gotoEssentials(page);
  const card = page.locator('[data-sleep-essentials-product-card="showroom-pillow"]');
  await card.getByRole("button", { name: "Add to Cart" }).click();
  await expect(page.getByRole("alert")).toContainText("Cart update unavailable");
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Add to Cart" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Cart 0 items/ })).toBeVisible();
});

test("keeps the branded shell during loading, catalog failure, and empty category states", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await installMocks(page, { catalogDelay: 600 });
  await gotoEssentials(page);
  await expect(page.locator('[data-sleep-essentials-loading="true"]')).toBeVisible();
  await expect(page.locator('[data-sleep-essentials-category-rail="true"]')).toBeVisible();
  await expect(page.locator('[data-sleep-essentials-concierge="true"]')).toBeVisible();
  await expect(page.locator('[data-sleep-essentials-product-grid="true"]')).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  await installMocks(page, { catalogFailure: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-sleep-essentials-error="catalog"]')).toBeVisible();
  await expect(page.getByText("Products are temporarily unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  await expect(page.locator('[data-sleep-essentials-category-rail="true"]')).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  await installMocks(page, { emptyCategory: "pillows" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("No approved products are available in this category right now.", { exact: true })).toBeVisible();
});

for (const viewport of [
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
]) {
  test(`scrolls cleanly without horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installMocks(page, { initialReviewed: ["pillows", "sheets_bedding"] });
    await gotoEssentials(page);
    await expect(page.locator('[data-sleep-essentials-product-grid="true"]')).toBeVisible();

    const topMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(topMetrics.scrollWidth).toBe(topMetrics.clientWidth);
    expect(topMetrics.scrollHeight).toBeGreaterThan(topMetrics.clientHeight);

    const cardsWithinBounds = await page.locator('[data-sleep-essentials-product-card]').evaluateAll((cards) => cards.every((card) => {
      const rect = card.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= document.documentElement.clientWidth;
    }));
    expect(cardsWithinBounds).toBe(true);

    const controlSizes = await page.evaluate(() => ({
      selectors: [...document.querySelectorAll('[data-sleep-essentials-product-card] select')].every((control) => control.getBoundingClientRect().height >= 44),
      actions: [...document.querySelectorAll('[data-sleep-essentials-product-card] button')].every((control) => control.getBoundingClientRect().height >= 48),
      firstCardTop: document.querySelector('[data-sleep-essentials-product-card]')?.getBoundingClientRect().top || 0,
    }));
    expect(controlSizes.selectors).toBe(true);
    expect(controlSizes.actions).toBe(true);
    expect(controlSizes.firstCardTop).toBeLessThan(viewport.height);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const clearance = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-sleep-essentials-product-card]')];
      const last = cards.at(-1)?.getBoundingClientRect();
      const footer = document.querySelector('[data-sleep-essentials-footer="true"]')?.getBoundingClientRect();
      return { lastBottom: last?.bottom || 0, footerTop: footer?.top || 0, viewportHeight: innerHeight };
    });
    expect(clearance.lastBottom).toBeLessThanOrEqual(clearance.footerTop);
    expect(clearance.footerTop).toBeLessThanOrEqual(clearance.viewportHeight);
    await expect(page.getByRole("button", { name: "View Cart" })).toBeVisible();
  });
}

test("hydrates a legacy Pod accessory selection without writing new Pod state", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await installMocks(page);
  await page.addInitScript(() => {
    sessionStorage.setItem("snooze.podBuilder.pod-3", JSON.stringify({
      size: "Queen",
      stepKey: "review",
      selectedEssentials: {
        pillows: { handle: "showroom-pillow", variantId: "gid://shopify/ProductVariant/102" },
      },
    }));
  });
  await gotoEssentials(page);
  await expect(page.getByLabel("Showroom Support Pillow Pillow Size")).toHaveValue("gid://shopify/ProductVariant/102");
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("snooze.podBuilder.pod-3")));
  expect(saved.selectedEssentials.pillows.variantId).toBe("gid://shopify/ProductVariant/102");
});

test("records completion in the background and preserves deterministic return navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const mocks = await installMocks(page, { initialReviewed: CATEGORY_IDS });
  await gotoEssentials(page);
  await expect.poll(() => mocks.completionRequests.length).toBe(1);
  await expect(page.getByText(/categories explored|Finish Sleep Essentials/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Return to Pod" }).click();
  await expect(page).toHaveURL(/\/pod\/pod-3\?stage=build&buildStep=review/);

  await page.goto("/sleep-essentials?category=pillows", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/results$/);
});
