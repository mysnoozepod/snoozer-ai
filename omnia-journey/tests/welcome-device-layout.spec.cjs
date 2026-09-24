const { test, expect } = require("@playwright/test");

const WELCOME_CODE = "246810";
const WELCOME_VIEWPORTS = [
  { name: "primary-1180x820", width: 1180, height: 820 },
  { name: "compact-1024x768", width: 1024, height: 768 },
  { name: "wide-1366x768", width: 1366, height: 768 },
];

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
    clientWidth: document.scrollingElement.clientWidth,
    scrollWidth: document.scrollingElement.scrollWidth,
    clientHeight: document.scrollingElement.clientHeight,
    scrollHeight: document.scrollingElement.scrollHeight,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
}

async function expectWelcomeAcceptance(page) {
  const result = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect() || null;
    const entry = document.querySelector('[data-welcome-entry="true"]');
    const targets = Array.from(
      document.querySelectorAll('.welcome-code-input, [data-welcome-human-help="true"]')
    ).map((node) => {
      const bounds = node.getBoundingClientRect();
      return {
        label: node.getAttribute("aria-label") || node.textContent.trim(),
        width: bounds.width,
        height: bounds.height,
      };
    });
    const critical = [
      '[data-welcome-code-entry="true"]',
      '[data-welcome-personalization="true"]',
      '[data-welcome-human-help="true"]',
    ].map((selector) => ({ selector, bounds: rect(selector) }));
    const logo = document.querySelector('[data-welcome-logo="true"] img');
    const headlineLead = document.querySelector('[data-welcome-headline-lead="true"]');
    const headlinePhrase = document.querySelector('[data-welcome-headline-phrase="true"]');
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < critical.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < critical.length; rightIndex += 1) {
        const left = critical[leftIndex];
        const right = critical[rightIndex];
        if (
          left.bounds &&
          right.bounds &&
          left.bounds.left < right.bounds.right &&
          left.bounds.right > right.bounds.left &&
          left.bounds.top < right.bounds.bottom &&
          left.bounds.bottom > right.bounds.top
        ) {
          overlaps.push(`${left.selector}:${right.selector}`);
        }
      }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflowX:
        document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
      documentOverflowY:
        document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      frame: rect('[data-welcome-frame="true"]'),
      entryOverflowY: entry ? entry.scrollHeight - entry.clientHeight : null,
      targets,
      critical,
      overlaps,
      visual: {
        logo: logo
          ? {
              bounds: logo.getBoundingClientRect(),
              complete: logo.complete,
              naturalWidth: logo.naturalWidth,
              naturalHeight: logo.naturalHeight,
              source: new URL(logo.currentSrc || logo.src).pathname,
            }
          : null,
        host: rect('[data-welcome-host="true"]'),
        greeting: rect('[data-welcome-greeting="true"]'),
        snoozer: rect('[data-welcome-snoozer="true"]'),
        headlineLead: headlineLead
          ? { bounds: headlineLead.getBoundingClientRect(), lines: headlineLead.getClientRects().length }
          : null,
        headlinePhrase: headlinePhrase
          ? { bounds: headlinePhrase.getBoundingClientRect(), lines: headlinePhrase.getClientRects().length }
          : null,
        feedback: {
          bounds: rect('[data-welcome-code-feedback="true"]'),
          active: Boolean(
            document.querySelector(
              '[data-welcome-code-feedback="true"] [role="status"], [data-welcome-code-feedback="true"] [role="alert"]'
            )
          ),
        },
      },
    };
  });

  expect(result.documentOverflowX, JSON.stringify(result, null, 2)).toBeLessThanOrEqual(1);
  expect(result.documentOverflowY, JSON.stringify(result, null, 2)).toBeLessThanOrEqual(1);
  expect(result.frame, JSON.stringify(result, null, 2)).toBeTruthy();
  expect(result.frame.top).toBeGreaterThanOrEqual(0);
  expect(result.frame.bottom).toBeLessThanOrEqual(result.viewport.height + 1);
  expect(result.entryOverflowY, JSON.stringify(result, null, 2)).toBeLessThanOrEqual(1);
  expect(result.overlaps, JSON.stringify(result, null, 2)).toEqual([]);
  expect(result.targets).toHaveLength(7);
  result.targets.forEach((target) => {
    expect(Math.min(target.width, target.height), target.label).toBeGreaterThanOrEqual(44);
  });
  result.critical.forEach(({ selector, bounds }) => {
    expect(bounds, selector).toBeTruthy();
    expect(bounds.top, selector).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom, selector).toBeLessThanOrEqual(result.viewport.height + 1);
    expect(bounds.left, selector).toBeGreaterThanOrEqual(0);
    expect(bounds.right, selector).toBeLessThanOrEqual(result.viewport.width + 1);
    expect(bounds.top, selector).toBeGreaterThanOrEqual(result.frame.top - 1);
    expect(bounds.bottom, selector).toBeLessThanOrEqual(result.frame.bottom + 1);
  });
  expect(result.visual.logo, JSON.stringify(result, null, 2)).toMatchObject({
    complete: true,
    naturalWidth: 2172,
    naturalHeight: 724,
  });
  expect(result.visual.logo.source).toBe("/assets/mysnoozepod-logo-welcome.png");
  expect(result.visual.headlinePhrase.lines).toBe(1);
  expect(result.visual.feedback.bounds.height).toBeLessThanOrEqual(
    result.visual.feedback.active ? 49 : 33
  );
  for (const key of ["logo", "host", "greeting", "snoozer", "headlineLead", "headlinePhrase"]) {
    expect(result.visual[key], key).toBeTruthy();
  }
  const { host, greeting, snoozer } = result.visual;
  for (const [label, bounds] of [["greeting", greeting], ["snoozer", snoozer]]) {
    expect(bounds.left, label).toBeGreaterThanOrEqual(host.left - 1);
    expect(bounds.right, label).toBeLessThanOrEqual(host.right + 1);
    expect(bounds.top, label).toBeGreaterThanOrEqual(host.top - 1);
    expect(bounds.bottom, label).toBeLessThanOrEqual(host.bottom + 1);
  }
  expect(snoozer.width).toBeGreaterThanOrEqual(260);
  return result;
}

test("Welcome accepts a six-digit kiosk code without duplicate submission", async ({ page }) => {
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
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, snoozeCode: WELCOME_CODE, shopperId: WELCOME_CODE }),
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
  await expect(digits).toHaveCount(6);
  const idlePanelHeight = await page
    .locator('[data-welcome-code-entry="true"]')
    .evaluate((node) => node.getBoundingClientRect().height);

  await digits.nth(0).fill("1");
  await expect(digits.nth(1)).toBeFocused();
  await expect.poll(() => digits.nth(1).evaluate((node) => getComputedStyle(node).borderColor))
    .toBe("rgb(47, 87, 232)");
  expect(await digits.nth(1).evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
  await digits.nth(1).press("Backspace");
  await expect(digits.nth(0)).toBeFocused();

  await digits.nth(0).evaluate((input) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text", "246810");
    input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: clipboard }));
  });

  for (const [index, digit] of [...WELCOME_CODE].entries()) {
    await expect(digits.nth(index)).toHaveValue(digit);
  }
  await expect(digits.nth(5)).toBeFocused();
  await expect(digits.nth(5)).toHaveAttribute("aria-readonly", "true");
  await expect(page.getByRole("status")).toContainText("Loading your Snooze Session");
  const loadingPanelHeight = await page
    .locator('[data-welcome-code-entry="true"]')
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(loadingPanelHeight - idlePanelHeight).toBeLessThanOrEqual(18);
  await expect.poll(() => checkInRequests).toBe(1);
  await page.waitForTimeout(300);
  expect(checkInRequests).toBe(1);
  await expect(page).toHaveURL(/\/what-to-expect$/, { timeout: 10_000 });
});

for (const viewport of WELCOME_VIEWPORTS) {
  test(`Welcome fits ${viewport.name} with all critical controls visible`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await stubBackendFailures(page);
    await page.goto("/welcome", { waitUntil: "domcontentloaded" });
    await page.locator('[data-welcome-entry="true"]').waitFor();
    await expect(page.getByLabel(/^Snooze Code digit/)).toHaveCount(6);
    await expect(page.locator('[data-welcome-personalization="true"]')).toBeVisible();
    await expect(page.locator('[data-welcome-human-help="true"]')).toBeVisible();
    const result = await expectWelcomeAcceptance(page);
    if (viewport.name === "primary-1180x820") {
      expect(result.visual.headlinePhrase.bounds.top - result.visual.headlineLead.bounds.top)
        .toBeGreaterThan(8);
    }
  });
}

test("Welcome keeps invalid-code recovery visible without destabilizing layout", async ({ page }) => {
  let checkInRequests = 0;
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (/\/session\/start$/i.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, sessionId: "welcome-invalid-code-test" }),
      });
      return;
    }
    if (/\/identity\/check-in$/i.test(url)) {
      checkInRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          code: "SNOOZE_CODE_NOT_FOUND",
          message: "Snooze Code not found.",
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

  await page.goto("/welcome", { waitUntil: "domcontentloaded" });
  const digits = page.getByLabel(/^Snooze Code digit/);
  const idlePanelHeight = await page
    .locator('[data-welcome-code-entry="true"]')
    .evaluate((node) => node.getBoundingClientRect().height);
  await digits.nth(0).evaluate((input) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text", "246810");
    input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: clipboard }));
  });
  await expect(page.getByRole("alert")).toContainText("check your code and try again");
  const errorPanelHeight = await page
    .locator('[data-welcome-code-entry="true"]')
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(errorPanelHeight - idlePanelHeight).toBeLessThanOrEqual(18);
  const retryButton = page.getByRole("button", { name: "Try Again" });
  await expect(retryButton).toBeVisible();
  await expect(digits.nth(5)).toBeFocused();
  expect(checkInRequests).toBe(1);
  await retryButton.click();
  await expect.poll(() => checkInRequests).toBe(2);
  await expect(page.getByRole("alert")).toContainText("check your code and try again");
  await expectWelcomeAcceptance(page);
});

test("Welcome Human Help remains actionable and preserves Brandy assistance", async ({ page }) => {
  await stubBackendFailures(page);
  await page.goto("/welcome", { waitUntil: "domcontentloaded" });
  await page.locator('[data-welcome-human-help="true"]').click();
  await expect(page.getByRole("status").filter({ hasText: "Your Snooze Session will stay right here." })).toBeVisible();
});

test("Welcome skips entrance translation when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubBackendFailures(page);
  await page.goto("/welcome", { waitUntil: "domcontentloaded" });
  const entry = page.locator('[data-welcome-entry="true"]');
  await expect(entry).toBeVisible();
  const motion = await entry.evaluate((node) => {
    const style = getComputedStyle(node);
    return { opacity: style.opacity, transform: style.transform };
  });
  expect(motion.opacity).toBe("1");
  expect(motion.transform).toBe("none");
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
  await expect(page.locator("body")).toContainText("Let’s start with your Snooze Assessment.");

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
        const shopperId = existing ? "246810" : "987654";
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
