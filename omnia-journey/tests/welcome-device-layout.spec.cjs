const { test, expect } = require("@playwright/test");

async function stubBackendFailures(page, { hudTtlMs = null, requests = [] } = {}) {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (/\/hud\/tts$/i.test(url)) requests.push("hud-tts");
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

test("Welcome accepts a four-digit kiosk code without duplicate submission", async ({ page }) => {
  let checkInRequests = 0;

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (/\/session\/start$/i.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, sessionId: "welcome-code-test" }),
      });
      return;
    }
    if (/\/identity\/check-in$/i.test(url)) {
      checkInRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, snoozeCode: "2468", shopperId: "2468" }),
      });
      return;
    }
    if (/\/assessment\?/i.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, exists: false, shopperState: "NEW" }),
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

  await page.goto("/welcome", { waitUntil: "domcontentloaded" });
  const digits = page.getByLabel(/^Snooze Code digit/);
  await expect(digits).toHaveCount(4);

  await digits.nth(0).fill("1");
  await expect(digits.nth(1)).toBeFocused();
  await digits.nth(1).press("Backspace");
  await expect(digits.nth(0)).toBeFocused();

  await digits.nth(0).evaluate((input) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text", "2468");
    input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: clipboard }));
  });

  await expect(digits.nth(0)).toHaveValue("2");
  await expect(digits.nth(1)).toHaveValue("4");
  await expect(digits.nth(2)).toHaveValue("6");
  await expect(digits.nth(3)).toHaveValue("8");
  await expect.poll(() => checkInRequests).toBe(1);
});

test("What To Expect centers all four orientation steps without navigation controls", async ({ page }) => {
  await stubBackendFailures(page);
  await page.goto("/what-to-expect", { waitUntil: "networkidle" });

  for (const title of [
    "Build Your Sleep Profile",
    "Visit Your Recommended Pods",
    "Explore Sleep Essentials",
    "Build Your Sleep Setup",
  ]) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }

  await expect(page.getByText("Next Step", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /assessment|recommended pods/i })).toHaveCount(0);
  await expect(page.locator("body")).toContainText("Welcome to your Snooze Session");

  await expect(page.getByTestId("persistent-snoozer-hud")).toHaveCount(0);
  await expect(page.getByTestId("persistent-human-assistance")).toBeVisible();
  await expect(page.locator("[data-testid^='what-step-']")).toHaveCount(4);
  await expectNoDocumentScroll(page);
});

test("What To Expect triggers HUD/TTS and follows completion for new and existing codes", async ({ browser }) => {
  for (const branch of ["new", "existing"]) {
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    const page = await context.newPage();
    const requests = [];
    await stubBackendFailures(page, { hudTtlMs: 1_200, requests });

    await page.addInitScript((profileBranch) => {
        const existing = profileBranch === "existing";
        const shopperId = existing ? "2468" : "9876";
        sessionStorage.setItem(
          "snooze.sessionState.v1",
          JSON.stringify({ version: 1, shopperId })
        );
        sessionStorage.setItem(
          "snooze.snapshot",
          JSON.stringify({
            shopperId,
            exists: existing,
            shopperState: existing ? "ASSESSED" : "NEW",
            assessment: existing ? { answers: { firmness: "Soft" } } : null,
          })
        );
      }, branch);

    await page.goto("/what-to-expect", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Your guided showroom path." })).toBeVisible();
    await expect.poll(() => requests.filter((request) => request === "hud-tts").length).toBeGreaterThan(0);
    await expect(page).toHaveURL(branch === "existing" ? /\/results$/ : /\/assessment$/);
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
  await expect(page.getByText("Your First Stop", { exact: true })).toBeVisible();
  await expect(page.getByText("Also Recommended", { exact: true })).toBeVisible();
  await expect(page.getByText("Your strongest match based on your sleep profile.", { exact: true })).toBeVisible();
  await expect(page.getByText("Next To Try", { exact: true })).toHaveCount(0);
  await expect(page.getByText("View pod", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Also available to test", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask Snoozer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Talk to Human" })).toHaveCount(0);

  const rankedPodLabels = page.locator("section").getByText(/^SnoozePod\s*\d+$/);
  expect(await rankedPodLabels.count()).toBeGreaterThanOrEqual(3);
  await expectNoDocumentScroll(page);
});
