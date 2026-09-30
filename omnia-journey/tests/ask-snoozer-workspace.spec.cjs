const { test, expect } = require("@playwright/test");
const path = require("node:path");

const API_ROOT = "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod";
const PRODUCT_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='300'%3E%3Crect width='420' height='300' rx='30' fill='%23eef3ff'/%3E%3Cpath d='M70 190h280v42H70z' fill='%232f57e8'/%3E%3C/svg%3E";

async function capture(page, name) {
  await page.screenshot({ path: path.resolve(__dirname, "../../_out", name), fullPage: false });
}

function recommendation(id, handle, title, price) {
  const merchandiseId = `gid://shopify/ProductVariant/${id}`;
  return {
    id: `gid://shopify/Product/${id}`,
    handle,
    title,
    subtitle: "Live Shopify product details for your showroom comparison.",
    url: `/products/${handle}`,
    imageUrl: PRODUCT_IMAGE,
    price,
    currencyCode: "USD",
    pricingMode: "exact_variant",
    available: true,
    exactVariantResolved: true,
    merchandiseId,
    selectedOptions: [{ name: "Size", value: "Queen" }],
    variants: [{
      id: merchandiseId,
      title: "Queen",
      price: String(price),
      currencyCode: "USD",
      available: true,
      selectedOptions: [{ name: "Size", value: "Queen" }],
    }],
  };
}

async function installMocks(page, {
  connected = false,
  responseDelay = 0,
  failAsk = false,
  cartFailure = false,
} = {}) {
  const askRequests = [];
  const cartRequests = [];
  let cartLines = [];

  await page.addInitScript(({ connected }) => {
    sessionStorage.clear();
    localStorage.clear();
    if (!connected) return;
    sessionStorage.setItem("snooze.shopperId", "pass7-shopper");
    sessionStorage.setItem("snooze.snoozeCode", "2468");
    sessionStorage.setItem("snooze.sessionId", "pass7-session");
    sessionStorage.setItem("snooze.sessionState.v1", JSON.stringify({
      version: 2,
      shopperId: "pass7-shopper",
      snoozeCode: "2468",
      accessCode: "2468",
      sessionId: "pass7-session",
      threadId: "pass7-thread",
    }));
  }, { connected });

  await page.route(`${API_ROOT}/**`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,x-session-id,x-snooze-code,x-request-id",
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
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify(payload),
    });

    if (path === "/ask-snoozer/quality-event") return json({ ok: true });
    if (path === "/ask-snoozer") {
      askRequests.push(body);
      if (responseDelay) await new Promise((resolve) => setTimeout(resolve, responseDelay));
      if (failAsk) return json({ ok: false, status: "fallback", reply: { content: "I had trouble reaching Snoozer for a moment. Try again when you are ready." } }, 503);
      const wantsProducts = /product|pillow|compare/i.test(body.message || "") || ["browse_products", "compare_products"].includes(body.command?.type);
      const turn = askRequests.length;
      return json({
        ok: true,
        status: "answered",
        conversationId: "pass7-conversation",
        reply: { id: `assistant-${turn}`, content: wantsProducts ? "Here are two products worth comparing in the showroom." : `Advisor answer ${turn}: I can help with that.` },
        chips: [{ label: "Tell me more", value: "Tell me more", type: "prompt" }],
        actions: [{ type: "request_human", label: "Ask a sleep specialist" }],
        recommendations: wantsProducts ? [
          recommendation("701", "side-sleeper-pillow", "Side Sleeper Pillow", 129),
          recommendation("702", "cooling-pillow", "Cooling Pillow", 149),
        ] : [],
        activeJourney: { journeyId: "pass7-journey", revision: turn },
        voice: { speak: false, speech: null },
        meta: { requestId: `pass7-request-${turn}`, source: "model_composed" },
      });
    }
    if (path === "/session/start") return json({ session_id: "pass7-session" });
    if (path === "/shopify/cart/owned/resolve") {
      return json({ cart: cartLines.length ? { id: "gid://shopify/Cart/pass7", checkoutUrl: "https://checkout.example.test/pass7", lines: { nodes: cartLines } } : null });
    }
    if (path === "/shopify/cart/owned/addLines") {
      cartRequests.push(body);
      if (cartFailure) return json({ message: "Cart unavailable" }, 503);
      const line = body.lines?.[0] || {};
      cartLines = [{
        id: "gid://shopify/CartLine/pass7",
        quantity: 1,
        merchandise: {
          id: line.merchandiseId,
          title: "Queen",
          product: { title: "Side Sleeper Pillow", handle: "side-sleeper-pillow" },
          price: { amount: "129.00", currencyCode: "USD" },
        },
        cost: { totalAmount: { amount: "129.00", currencyCode: "USD" } },
      }];
      return json({ cart: { id: "gid://shopify/Cart/pass7", checkoutUrl: "https://checkout.example.test/pass7", lines: { nodes: cartLines } } });
    }
    if (path.startsWith("/rewards/")) return json({ summary: { availableSleepPoints: 420 }, availableSleepPoints: 420 });
    if (path.startsWith("/journey/")) return json({ activeJourney: { journeyId: "pass7-journey", revision: 1 } });
    if (path === "/identity/check-in") return json({ ok: true, shopperId: "pass7-shopper", snoozeCode: "2468" });
    return json({});
  });

  return { askRequests, cartRequests, getCartLines: () => cartLines };
}

async function gotoAsk(page) {
  await page.goto("/ask-snoozer", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-ask-snoozer-workspace="true"]')).toBeVisible();
}

async function shellMetrics(page) {
  return page.evaluate(() => {
    const answer = document.querySelector('[data-ask-section="transcript"]');
    return {
      documentVerticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
      documentHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      answerScrolls: answer ? answer.scrollHeight > answer.clientHeight : false,
      composerBottom: document.querySelector('[data-ask-composer="true"]')?.getBoundingClientRect().bottom || 0,
      humanTop: document.querySelector('[data-testid="persistent-human-assistance"]')?.getBoundingClientRect().top || 0,
      avatarHeight: document.querySelector('[data-ask-section="advisor"] img[alt="Snoozer"]')?.getBoundingClientRect().height || 0,
      textareaCount: document.querySelectorAll("textarea").length,
    };
  });
}

for (const viewport of [
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1536, height: 704 },
]) {
  test(`guest empty advisor workspace is contained at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installMocks(page);
    await gotoAsk(page);

    await expect(page.locator('[data-commerce-header="true"] img[alt="MySnoozePod"]')).toHaveAttribute("src", /mysnoozepod-logo-welcome/);
    await expect(page.getByRole("heading", { name: "What can I help you figure out?" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Quick Starters" })).toBeVisible();
    await expect(page.locator('[data-ask-empty-state="true"]')).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Ask Snoozer" })).toBeVisible();
    await expect(page.getByTestId("persistent-human-assistance")).toBeVisible();
    await expect(page.getByText("Chat with Snoozer", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Advisor workspace", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Your latest answer stays in focus.", { exact: true })).toHaveCount(0);

    const metrics = await shellMetrics(page);
    expect(metrics.documentVerticalOverflow).toBe(false);
    expect(metrics.documentHorizontalOverflow).toBe(false);
    expect(metrics.textareaCount).toBe(1);
    expect(metrics.avatarHeight).toBeGreaterThanOrEqual(viewport.height <= 740 ? 108 : 140);
    expect(metrics.composerBottom).toBeLessThanOrEqual(metrics.humanTop);
    const starterBounds = await page.locator('[data-ask-quick-starter="true"]').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()));
    const advisorBottom = await page.locator('[data-ask-section="advisor"]').evaluate((advisor) => advisor.getBoundingClientRect().bottom);
    expect(starterBounds).toHaveLength(5);
    expect(Math.max(...starterBounds.map((bounds) => bounds.bottom))).toBeLessThanOrEqual(advisorBottom);
    await capture(page, `pass7-local-empty-${viewport.width}x${viewport.height}.png`);
  });
}

test("connected shopper preserves rewards and the same contained empty state", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await installMocks(page, { connected: true });
  await gotoAsk(page);
  await expect(page.getByText("Session connected", { exact: true })).toBeVisible();
  await expect(page.getByText("420 pts", { exact: true })).toBeVisible();
  expect((await shellMetrics(page)).documentVerticalOverflow).toBe(false);
});

test("quick starters keep all five typed command contracts", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const state = await installMocks(page, { connected: true });
  await gotoAsk(page);

  const expectations = [
    ["Compare Products", "compare_products"],
    ["What’s in My Cart?", "analyze_cart"],
    ["Find a Product", "browse_products"],
    ["Motion Base Help", "motion_base_features"],
    ["Show My Rewards", "find_rewards"],
  ];
  for (const [label, commandType] of expectations) {
    const priorCount = state.askRequests.length;
    await page.getByRole("button", { name: new RegExp(`^${label.replace(/[?]/g, "\\?")}`) }).click();
    await expect.poll(() => state.askRequests.length).toBe(priorCount + 1);
    expect(state.askRequests.at(-1)?.command?.type).toBe(commandType);
  }
});

test("freeform question presents a quiet question and a primary advisor answer", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await installMocks(page, { connected: true });
  await gotoAsk(page);
  await page.getByRole("textbox", { name: "Ask Snoozer" }).fill("How does the showroom work?");
  await page.getByRole("textbox", { name: "Ask Snoozer" }).press("Enter");
  await expect(page.locator('[data-ask-message="question"]')).toContainText("How does the showroom work?");
  await expect(page.locator('[data-ask-message="latest-answer"]')).toContainText("Advisor answer 1: I can help with that.");
  await capture(page, "pass7-local-simple-answer-1180x820.png");
});

test("freeform and four-turn history keep the latest answer primary and scroll internally", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const state = await installMocks(page, { connected: true });
  await gotoAsk(page);

  for (let turn = 1; turn <= 4; turn += 1) {
    await page.getByRole("textbox", { name: "Ask Snoozer" }).fill(`Question ${turn}: ${"Tell me more about this sleep setup. ".repeat(8)}`);
    await page.getByRole("textbox", { name: "Ask Snoozer" }).press("Enter");
    await expect(page.getByText(`Advisor answer ${turn}: I can help with that.`, { exact: true })).toBeVisible();
  }

  expect(state.askRequests.map((request) => request.history.length)).toEqual([1, 3, 5, 7]);
  await expect(page.locator('[data-ask-message="latest-answer"]')).toHaveCount(1);
  await expect(page.locator('[data-ask-history="earlier"]')).toHaveCount(6);
  await expect(page.getByRole("textbox", { name: "Ask Snoozer" })).toBeVisible();
  const metrics = await shellMetrics(page);
  expect(metrics.documentVerticalOverflow).toBe(false);
  expect(metrics.answerScrolls).toBe(true);
  await capture(page, "pass7-local-multi-turn-1180x820.png");
});

test("thinking, rich product recommendations, chips, actions, and confirmed cart feedback remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const state = await installMocks(page, { connected: true, responseDelay: 450 });
  await gotoAsk(page);

  await page.getByRole("textbox", { name: "Ask Snoozer" }).fill("What pillow should I try?");
  await page.getByRole("textbox", { name: "Ask Snoozer" }).press("Enter");
  await expect(page.locator('[data-ask-thinking="true"]')).toContainText("Snoozer is thinking…");
  await capture(page, "pass7-local-thinking-1180x820.png");
  await expect(page.locator('[data-ask-product-card="true"]')).toHaveCount(2);
  await expect(page.getByText("Side Sleeper Pillow", { exact: true })).toBeVisible();
  await expect(page.getByText("$129.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tell me more" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask a sleep specialist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Details" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Compare" }).first()).toBeVisible();
  await capture(page, "pass7-local-products-1180x820.png");

  await page.getByRole("button", { name: "Add to Cart" }).first().click();
  await expect.poll(() => state.cartRequests.length).toBe(1);
  await expect(page.getByText("Side Sleeper Pillow was added to your cart.", { exact: true })).toBeVisible();
  expect(state.getCartLines()).toHaveLength(1);
  expect((await shellMetrics(page)).documentVerticalOverflow).toBe(false);
  await capture(page, "pass7-local-cart-success-1180x820.png");
});

test("cart failure and Ask fallback never claim success or blank the workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await installMocks(page, { connected: true, cartFailure: true });
  await gotoAsk(page);
  await page.getByRole("textbox", { name: "Ask Snoozer" }).fill("What pillow should I try?");
  await page.getByRole("textbox", { name: "Ask Snoozer" }).press("Enter");
  await expect(page.locator('[data-ask-product-card="true"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Add to Cart" }).first().click();
  await expect(page.getByText("I could not confirm that cart addition. Your cart was not changed; please try again.", { exact: true })).toBeVisible();
  await expect(page.getByText(/was added to your cart\./)).toHaveCount(0);

  const failedPage = await page.context().newPage();
  await failedPage.setViewportSize({ width: 1180, height: 820 });
  await installMocks(failedPage, { connected: true, failAsk: true });
  await gotoAsk(failedPage);
  await failedPage.getByRole("textbox", { name: "Ask Snoozer" }).fill("Help me choose");
  await failedPage.getByRole("textbox", { name: "Ask Snoozer" }).press("Enter");
  await expect(failedPage.getByText(/I had trouble reaching Snoozer for a moment/)).toBeVisible();
  await expect(failedPage.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(failedPage.locator('[data-ask-snoozer-workspace="true"]')).toBeVisible();
  await capture(failedPage, "pass7-local-fallback-1180x820.png");
});

test("route-state prefill and autosend execute exactly once", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const state = await installMocks(page, { connected: true });
  await gotoAsk(page);
  await page.evaluate(() => {
    const nextState = {
      ...(history.state || {}),
      usr: { prefill: "Compare these pillows", autoSend: true, from: "/sleep-essentials" },
      key: "pass7-prefill",
    };
    history.pushState(nextState, "", "/ask-snoozer?entry=sleep-essentials");
    dispatchEvent(new PopStateEvent("popstate", { state: nextState }));
  });
  await expect.poll(() => state.askRequests.length).toBe(1);
  expect(state.askRequests[0].message).toBe("Compare these pillows");
  expect(state.askRequests[0].page.referrerRoute).toBe("/sleep-essentials");
  await page.waitForTimeout(250);
  expect(state.askRequests).toHaveLength(1);
});
