const { test, expect } = require("@playwright/test");

const WELCOME_CODE = "246810";
const WELCOME_VIEWPORTS = [
  { name: "primary-1180x820", width: 1180, height: 820 },
  { name: "compact-1024x768", width: 1024, height: 768 },
  { name: "wide-1366x768", width: 1366, height: 768 },
];

const ASSESSMENT_QUESTIONS = [
  { id: "size", text: "What size are you shopping for?", options: ["Twin", "Full", "Queen", "King"], required: true },
  { id: "motionMode", text: "Choose your motion style.", options: ["Standard Motion", "Half Split Motion", "Full Split Motion"], required: true },
  { id: "sleepPartner", text: "Do you regularly share the bed with a partner?", options: ["Yes", "No"], required: true },
  { id: "sleepPosition", text: "How do you mostly sleep: on your side, back, stomach, or a mix?", options: ["Side", "Back", "Stomach", "Mix / Combination"], required: true },
  { id: "motionSensitivity", text: "How sensitive are you to movement in the bed?", options: ["Low — movement rarely bothers me", "Medium — I notice it but can deal with it", "High — I wake up easily from movement"] },
  { id: "temperature", text: "Do you usually sleep hot, cold, or pretty neutral at night?", options: ["Hot", "Cold", "Neutral"], required: true },
  { id: "firmness", text: "If you had to choose, do you lean soft, medium, or firm for comfort?", options: ["Soft", "Medium", "Firm"], required: true },
  { id: "snore", text: "Do you personally snore or use a CPAP / sleep apnea device?", options: ["Yes", "No", "Not sure"] },
  { id: "painPoints", text: "Any back pain, pressure points, or other issues you hope the mattress can help with? (Choose all that apply or skip if none.)", options: ["Lower back", "Upper back", "Hips", "Shoulders", "Neck", "Sciatica", "General pressure relief", "Other / not listed"], multi: true, zohoType: "multiselect" },
];

async function stubAssessmentBackend(page, submissionsOrOptions = []) {
  const options = Array.isArray(submissionsOrOptions)
    ? { submissions: submissionsOrOptions }
    : submissionsOrOptions || {};
  const {
    submissions = [],
    questionDelayMs = 0,
    questionStatus = 200,
    questionPayload = { title: "Snooze Assessment", questions: ASSESSMENT_QUESTIONS },
  } = options;

  await page.addInitScript(() => {
    sessionStorage.setItem(
      "snooze.sessionState.v1",
      JSON.stringify({ version: 1, shopperId: "987654" })
    );
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (/\/assessment-questions(?:\?|$)/i.test(url)) {
      if (questionDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, questionDelayMs));
      }
      await route.fulfill({
        status: questionStatus,
        contentType: "application/json",
        body: JSON.stringify(questionPayload),
      });
      return;
    }
    if (request.method() === "POST" && /\/assessment$/i.test(url)) {
      submissions.push(request.postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, shopperId: "987654" }),
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

async function selectAssessmentAnswer(page, label) {
  const choice = page.getByRole("button", { name: label, exact: true });
  await expect(choice).toBeVisible();
  await choice.click({ position: { x: 12, y: 24 } });
}

async function expectAssessmentQuestion(page, index, count, id) {
  await expect(page.locator(`[data-assessment-question-id="${id}"]`)).toBeVisible();
  await expect(page.locator('[data-assessment-question-count="true"]')).toHaveText(
    `Question ${index} of ${count}`
  );
}

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

async function seedWhatToExpectState(page, assessmentComplete) {
  await page.addInitScript((complete) => {
    const shopperId = complete ? "246810" : "987654";
    sessionStorage.setItem(
      "snooze.sessionState.v1",
      JSON.stringify({ version: 1, shopperId })
    );
    sessionStorage.setItem(
      "snooze.snapshot",
      JSON.stringify({
        shopperId,
        exists: complete,
        shopperState: complete ? "ASSESSED" : "NEW",
        assessment: complete ? { answers: { firmness: "Soft" } } : null,
      })
    );
  }, assessmentComplete);
}

async function expectWhatToExpectAcceptance(page, expectedStates) {
  const result = await page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const bounds = node.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const overlaps = (left, right) =>
      Boolean(
        left &&
          right &&
          left.left < right.right &&
          left.right > right.left &&
          left.top < right.bottom &&
          left.bottom > right.top
      );
    const logo = document.querySelector('[data-what-to-expect-shell="true"] img[alt="MySnoozePod"]');
    const guide = rect('[data-what-to-expect-guide="true"]');
    const map = rect('[data-what-to-expect-map="true"]');
    const snoozer = rect('[data-what-to-expect-snoozer="true"]');
    const human = rect('[data-testid="persistent-human-assistance"]');
    const rewards = rect('[data-rewards-placement="floating"]');
    const cards = Array.from(document.querySelectorAll('[data-testid^="what-step-"]')).map(
      (card) => {
        const bounds = card.getBoundingClientRect();
        const icon = card.querySelector('[data-journey-icon="true"] svg')?.getBoundingClientRect();
        return {
          state: card.getAttribute("data-journey-state"),
          tagName: card.tagName,
          bounds: {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
          },
          icon: icon ? { width: icon.width, height: icon.height } : null,
        };
      }
    );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        clientWidth: document.scrollingElement.clientWidth,
        scrollWidth: document.scrollingElement.scrollWidth,
        clientHeight: document.scrollingElement.clientHeight,
        scrollHeight: document.scrollingElement.scrollHeight,
      },
      frame: rect('[data-what-to-expect-frame="true"]'),
      guide,
      map,
      snoozer,
      human,
      rewards,
      cards,
      guidanceLength:
        document.querySelector('[data-what-to-expect-guidance="true"] p')?.textContent.trim().length || 0,
      logo: logo
        ? {
            complete: logo.complete,
            naturalWidth: logo.naturalWidth,
            naturalHeight: logo.naturalHeight,
            source: new URL(logo.currentSrc || logo.src).pathname,
          }
        : null,
      overlap: {
        guideMap: overlaps(guide, map),
        guideHuman: overlaps(guide, human),
        mapHuman: overlaps(map, human),
        mapRewards: overlaps(map, rewards),
      },
    };
  });

  expect(result.document.scrollWidth).toBeLessThanOrEqual(result.document.clientWidth + 1);
  expect(result.document.scrollHeight).toBeLessThanOrEqual(result.document.clientHeight + 1);
  expect(result.cards).toHaveLength(4);
  expect(result.cards.map((card) => card.state)).toEqual(expectedStates);
  expect(result.cards.every((card) => card.tagName === "DIV")).toBe(true);
  result.cards.forEach((card) => {
    expect(card.icon).toBeTruthy();
    expect(Math.min(card.icon.width, card.icon.height)).toBeGreaterThanOrEqual(55.5);
    expect(card.bounds.left).toBeGreaterThanOrEqual(result.frame.left - 1);
    expect(card.bounds.right).toBeLessThanOrEqual(result.frame.right + 1);
    expect(card.bounds.top).toBeGreaterThanOrEqual(result.frame.top - 1);
    expect(card.bounds.bottom).toBeLessThanOrEqual(result.frame.bottom + 1);
  });
  expect(result.snoozer).toBeTruthy();
  expect(result.snoozer.left).toBeGreaterThanOrEqual(result.guide.left - 1);
  expect(result.snoozer.right).toBeLessThanOrEqual(result.guide.right + 1);
  expect(result.snoozer.top).toBeGreaterThanOrEqual(result.guide.top - 1);
  expect(result.snoozer.bottom).toBeLessThanOrEqual(result.guide.bottom + 1);
  expect(result.guidanceLength).toBeGreaterThan(30);
  expect(result.guidanceLength).toBeLessThan(130);
  expect(result.logo).toMatchObject({
    complete: true,
    naturalWidth: 2172,
    naturalHeight: 724,
    source: "/assets/mysnoozepod-logo-welcome.png",
  });
  expect(result.overlap).toEqual({
    guideMap: false,
    guideHuman: false,
    mapHuman: false,
    mapRewards: false,
  });
  return result;
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

for (const viewport of WELCOME_VIEWPORTS) {
  test(`What To Expect fits ${viewport.name} as a Snoozer-guided journey map`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedWhatToExpectState(page, false);
    await stubBackendFailures(page);
    await page.goto("/what-to-expect", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-what-to-expect-entry="true"]')).toBeVisible();

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
    await expect(page.getByTestId("persistent-snoozer-hud")).toHaveCount(0);
    await expect(page.getByTestId("persistent-human-assistance")).toBeVisible();
    await expect(page.locator('[data-what-to-expect-guide="true"]')).toContainText(
      "We’ll start with your sleep profile"
    );
    await expectWhatToExpectAcceptance(page, ["current", "upcoming", "upcoming", "upcoming"]);
  });
}

test("What To Expect presents completed and current states without contradiction", async ({ page }) => {
  await seedWhatToExpectState(page, true);
  await stubBackendFailures(page);
  await page.goto("/what-to-expect", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-what-to-expect-guide="true"]')).toHaveAttribute(
    "data-guidance-branch",
    "complete"
  );
  await expect(page.locator('[data-what-to-expect-guide="true"]')).toContainText(
    "You already finished your sleep profile"
  );
  await expect(page.getByTestId("what-step-1")).toContainText("Completed");
  await expect(page.getByTestId("what-step-2")).toContainText("Next up");
  await expectWhatToExpectAcceptance(page, ["completed", "current", "upcoming", "upcoming"]);
});

test("What To Expect skips entrance translation when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedWhatToExpectState(page, false);
  await stubBackendFailures(page);
  await page.goto("/what-to-expect", { waitUntil: "domcontentloaded" });
  const entry = page.locator('[data-what-to-expect-entry="true"]');
  await expect(entry).toBeVisible();
  const motion = await entry.evaluate((node) => {
    const style = getComputedStyle(node);
    return { opacity: style.opacity, transform: style.transform };
  });
  expect(motion.opacity).toBe("1");
  expect(motion.transform).toBe("none");
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

test("Assessment keeps a complete recovery shell visible while realistic questions initialize", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await stubAssessmentBackend(page, { questionDelayMs: 1_200 });
  await page.goto("/assessment", { waitUntil: "domcontentloaded" });

  const loadingShell = page.locator('[data-assessment-loading="true"]');
  await expect(loadingShell).toBeVisible();
  await expect(loadingShell.locator('[data-assessment-layout="true"]')).toBeVisible();
  await expect(loadingShell.locator('[data-assessment-coach="true"]')).toBeVisible();
  await expect(loadingShell.locator('[data-assessment-snoozer="true"]')).toBeVisible();
  await expect(loadingShell.locator('[data-assessment-question-panel="true"]')).toBeVisible();
  await expect(loadingShell.locator('[data-assessment-question-count="true"]')).toHaveText(
    "Preparing"
  );
  await expect(page.getByRole("progressbar", { name: "Assessment progress" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preparing your first question…" })).toBeVisible();
  await expect(page.getByTestId("persistent-human-assistance")).toBeVisible();
  await expect(page.locator('[data-rewards-placement="floating"]')).toBeVisible();
  await expectNoDocumentScroll(page);

  await expectAssessmentQuestion(page, 1, 9, "size");
  await expect(page.locator('[data-assessment-choice="true"]')).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "What size are you shopping for?" })).toBeVisible();
  await expect(loadingShell).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("Assessment shows an explicit retry state when the questions request fails", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await stubAssessmentBackend(page, {
    questionStatus: 503,
    questionPayload: { message: "Assessment questions are temporarily unavailable." },
  });
  await page.goto("/assessment", { waitUntil: "domcontentloaded" });

  const errorShell = page.locator('[data-assessment-error="true"]');
  await expect(errorShell).toBeVisible();
  await expect(errorShell.locator('[data-assessment-layout="true"]')).toBeVisible();
  await expect(errorShell.locator('[data-assessment-coach="true"]')).toBeVisible();
  await expect(errorShell.locator('[data-assessment-snoozer="true"]')).toBeVisible();
  await expect(errorShell.locator('[data-assessment-question-panel="true"]')).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Assessment questions are temporarily unavailable."
  );
  await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  await expect(page.locator('[data-assessment-question-id]')).toHaveCount(0);
  await expect(page.getByTestId("persistent-human-assistance")).toBeVisible();
  await expect(page.locator('[data-rewards-placement="floating"]')).toBeVisible();
  await expectNoDocumentScroll(page);
  expect(pageErrors).toEqual([]);
});

test("Assessment keeps Question 1 contained at all required showroom viewports", async ({ browser }) => {
  for (const viewport of WELCOME_VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    await stubAssessmentBackend(page);
    await page.goto("/assessment", { waitUntil: "domcontentloaded" });
    await expectAssessmentQuestion(page, 1, 9, "size");
    await expect(page.getByRole("heading", { name: "One question at a time." })).toBeVisible();
    await expect(page.getByText("Answer what feels most like you.", { exact: true })).toBeVisible();
    await expect(page.getByText("Choose", { exact: true })).toHaveCount(0);
    await expect(page.locator('img[alt="MySnoozePod"]')).toHaveAttribute(
      "src",
      /mysnoozepod-logo-welcome\.png$/
    );

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const bounds = node.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        };
      };
      const overlaps = (left, right) =>
        Boolean(
          left &&
            right &&
            left.left < right.right &&
            left.right > right.left &&
            left.top < right.bottom &&
            left.bottom > right.top
        );
      const content = [
        rect('[data-assessment-snoozer="true"]'),
        rect('[data-assessment-question-panel="true"]'),
      ];
      const human = rect('[data-testid="persistent-human-assistance"]');
      const rewards = rect('[data-rewards-placement="floating"]');
      const logo = rect('img[alt="MySnoozePod"]');
      return {
        snoozer: content[0],
        panel: content[1],
        choiceHeights: Array.from(document.querySelectorAll('[data-assessment-choice="true"]')).map(
          (node) => node.getBoundingClientRect().height
        ),
        humanOverlapsContent: content.some((bounds) => overlaps(human, bounds)),
        rewardsOverlapsLogo: overlaps(rewards, logo),
      };
    });

    expect(layout.snoozer.width, viewport.name).toBeGreaterThanOrEqual(190);
    expect(layout.panel.bottom, viewport.name).toBeLessThanOrEqual(viewport.height + 1);
    expect(layout.choiceHeights.length, viewport.name).toBe(4);
    expect(Math.min(...layout.choiceHeights), viewport.name).toBeGreaterThanOrEqual(48);
    expect(layout.humanOverlapsContent, viewport.name).toBeFalsy();
    expect(layout.rewardsOverlapsLogo, viewport.name).toBeFalsy();
    await expectNoDocumentScroll(page);
    await context.close();
  }
});

test("Assessment preserves auto-advance, Back restoration, progress, long answers, and submission", async ({ page }) => {
  const submissions = [];
  await stubAssessmentBackend(page, submissions);
  await page.goto("/assessment", { waitUntil: "domcontentloaded" });
  await expectAssessmentQuestion(page, 1, 9, "size");

  const queen = page.getByRole("button", { name: "Queen", exact: true });
  await queen.focus();
  await expect(queen).toBeFocused();
  await queen.press("Enter");
  await expectAssessmentQuestion(page, 2, 9, "baseType");
  await expect(page.getByRole("progressbar", { name: "Assessment progress" })).toHaveAttribute(
    "aria-valuenow",
    "11"
  );

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectAssessmentQuestion(page, 1, 9, "size");
  await expect(queen).toHaveAttribute("aria-pressed", "true");
  await expect(queen).toHaveCSS("border-color", "rgb(47, 87, 232)");

  await queen.click({ position: { x: 14, y: 24 } });
  await expectAssessmentQuestion(page, 2, 9, "baseType");
  await selectAssessmentAnswer(page, "Mattress Only");
  await expectAssessmentQuestion(page, 3, 9, "sleepPartner");
  await selectAssessmentAnswer(page, "No");
  await expectAssessmentQuestion(page, 4, 9, "sleepPosition");
  await selectAssessmentAnswer(page, "Side");
  await expectAssessmentQuestion(page, 5, 9, "motionSensitivity");
  await selectAssessmentAnswer(page, "Medium — I notice it but can deal with it");
  await expectAssessmentQuestion(page, 6, 9, "temperature");
  await selectAssessmentAnswer(page, "Neutral");

  await expectAssessmentQuestion(page, 7, 9, "firmness");
  await expect(page.getByRole("heading", { name: /lean soft, medium, or firm/i })).toBeVisible();
  await expectNoDocumentScroll(page);
  await selectAssessmentAnswer(page, "Medium");
  await expectAssessmentQuestion(page, 8, 9, "snore");
  await selectAssessmentAnswer(page, "No");

  await expectAssessmentQuestion(page, 9, 9, "painPoints");
  const longQuestionChoices = page.locator('[data-assessment-question-id="painPoints"] [data-assessment-choice="true"]');
  await expect(longQuestionChoices).toHaveCount(8);
  const touchTargets = await longQuestionChoices.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height)
  );
  expect(Math.min(...touchTargets)).toBeGreaterThanOrEqual(48);
  await expectNoDocumentScroll(page);

  await selectAssessmentAnswer(page, "Lower back");
  await expect(page.getByRole("button", { name: "Lower back", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByRole("button", { name: "Finish & View Results" }).click();
  await expect(page).toHaveURL(/\/results$/, { timeout: 8_000 });
  expect(submissions).toHaveLength(1);
  expect(submissions[0].answers || submissions[0].assessment || submissions[0]).toMatchObject({
    size: "Queen",
    baseType: "Mattress Only",
    firmness: "Medium",
    painPoints: ["Lower back"],
  });
});

test("Assessment honors touch input and reduced motion", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await stubAssessmentBackend(page);
  await page.goto("/assessment", { waitUntil: "domcontentloaded" });
  await expectAssessmentQuestion(page, 1, 9, "size");

  const snoozerTransform = await page
    .locator('[data-assessment-snoozer="true"]')
    .evaluate((node) => getComputedStyle(node).transform);
  expect(snoozerTransform).toBe("none");

  const twin = page.getByRole("button", { name: "Twin", exact: true });
  const bounds = await twin.boundingBox();
  expect(bounds).toBeTruthy();
  await page.touchscreen.tap(bounds.x + 12, bounds.y + bounds.height / 2);
  await expectAssessmentQuestion(page, 2, 9, "baseType");
  await expectNoDocumentScroll(page);
  await context.close();
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
