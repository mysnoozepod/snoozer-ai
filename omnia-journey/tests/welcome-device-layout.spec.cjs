const { test, expect } = require("@playwright/test");

async function stubBackendFailures(page, { hudTtlMs = null } = {}) {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (hudTtlMs && /\/hud\/script$/i.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          speech: "Welcome to your Snooze Session. Test caption completion.",
          captions: "Welcome to your Snooze Session. Test caption completion.",
          state: "speaking",
          priority: "normal",
          ttlMs: hudTtlMs,
          voiceStyle: "default",
          actions: [],
        }),
      });
      return;
    }
    if (/execute-api\.us-east-1\.amazonaws\.com/i.test(url)) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, message: "test fallback" }),
      });
      return;
    }
    await route.continue();
  });
}

async function expectNoDocumentScroll(page) {
  const metrics = await page.evaluate(() => ({
    clientHeight: document.scrollingElement.clientHeight,
    scrollHeight: document.scrollingElement.scrollHeight,
  }));
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
}

test("What To Expect centers all four orientation steps without navigation controls", async ({ page }) => {
  await stubBackendFailures(page);
  await page.goto("/what-to-expect", { waitUntil: "networkidle" });

  for (const title of [
    "Assessment",
    "Test Recommended Pods",
    "Sleep Essentials",
    "Build Your Sleep Setup",
  ]) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }

  await expect(page.getByText("Next Step", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /assessment|recommended pods/i })).toHaveCount(0);
  await expect(page.locator("body")).toContainText("Welcome to your Snooze Session");

  const hudBox = await page.getByTestId("persistent-snoozer-hud").boundingBox();
  expect(hudBox).not.toBeNull();
  for (let step = 1; step <= 4; step += 1) {
    const cardBox = await page.getByTestId(`what-step-${step}`).boundingBox();
    expect(cardBox).not.toBeNull();
    const overlaps =
      hudBox.x < cardBox.x + cardBox.width &&
      hudBox.x + hudBox.width > cardBox.x &&
      hudBox.y < cardBox.y + cardBox.height &&
      hudBox.y + hudBox.height > cardBox.y;
    expect(overlaps).toBe(false);
  }
  await expectNoDocumentScroll(page);
});

test("What To Expect follows HUD caption completion for both profile branches", async ({ browser }) => {
  for (const branch of ["incomplete", "complete"]) {
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    const page = await context.newPage();
    await stubBackendFailures(page, { hudTtlMs: 1_200 });

    if (branch === "complete") {
      await page.addInitScript(() => {
        sessionStorage.setItem(
          "snooze.sessionState.v1",
          JSON.stringify({ version: 1, shopperId: "2468" })
        );
        sessionStorage.setItem(
          "snooze.snapshot",
          JSON.stringify({
            shopperId: "2468",
            exists: true,
            shopperState: "ASSESSED",
            assessment: { answers: { firmness: "Soft" } },
          })
        );
      });
    }

    await page.goto("/what-to-expect", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Your guided showroom path." })).toBeVisible();
    await expect(page.locator("body")).toContainText("Welcome to your Snooze Session");
    await expect(page).toHaveURL(branch === "complete" ? /\/results$/ : /\/assessment$/);
    await context.close();
  }
});

test("Results keeps the ranked top three in the Welcome kiosk viewport", async ({ page }) => {
  await stubBackendFailures(page);
  await page.goto("/welcome");
  await page.evaluate(() => {
    sessionStorage.setItem(
      "snooze.assessment",
      JSON.stringify({
        size: "Queen",
        motionMode: "No Motion",
        firmness: "Soft",
        sleepPosition: "Side",
        sleepPartner: "No",
        baseType: "No Base",
      })
    );
  });

  await page.goto("/results", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Your Recommended Pods" })).toBeVisible();
  await expect(page.getByText("Next To Try", { exact: true })).toBeVisible();
  await expect(page.getByText("Top Recommendation", { exact: true })).toBeVisible();
  await expect(page.getByText("Also available to test", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask Snoozer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Talk to Human" })).toHaveCount(0);

  const rankedPodLabels = page.locator("section").getByText(/^SnoozePod\s*\d+$/);
  expect(await rankedPodLabels.count()).toBeGreaterThanOrEqual(3);
  await expectNoDocumentScroll(page);
});
