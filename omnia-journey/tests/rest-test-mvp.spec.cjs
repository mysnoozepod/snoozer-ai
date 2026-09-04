const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");

const VIEWPORTS = [
  { name: "1280x585", width: 1280, height: 585 },
  { name: "1280x560", width: 1280, height: 560 },
  { name: "staging-1920x899", width: 1920, height: 899 },
  { name: "staging-compact-1920x860", width: 1920, height: 860 },
];
const STATES = ["entry", "back", "side", "back-recalibration", "zero", "snore", "final", "paused", "completion"];
const OUTPUT_ROOT = path.resolve(__dirname, "..", "..", "_out", "rest-test-mvp");

async function waitForPod(page) {
  await page.waitForSelector('[data-pod-layout-ready="true"]', { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((image) => image.decode?.().catch(() => null)));
  });
  await page.waitForTimeout(250);
}

async function measure(page) {
  return page.evaluate(() => {
    const active = document.querySelector('[data-pod-layout-region="active-content"]');
    const panel = document.querySelector('[data-rest-test-state]');
    const activeRect = active?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const interactive = Array.from(panel?.querySelectorAll('button, input[type="range"]') || []);
    return {
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      documentOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      activeOverflowY: active ? active.scrollHeight - active.clientHeight : 0,
      panelOverflowY: panel ? panel.scrollHeight - panel.clientHeight : 0,
      activeBottom: activeRect?.bottom || 0,
      panelBottom: panelRect?.bottom || 0,
      viewportHeight: window.innerHeight,
      hiddenControls: interactive
        .map((node) => ({ label: node.getAttribute("aria-label") || node.textContent.trim(), rect: node.getBoundingClientRect() }))
        .filter((item) => item.rect.width < 1 || item.rect.height < 1 || item.rect.bottom > window.innerHeight + 1),
      shortTouchTargets: interactive
        .map((node) => ({ label: node.getAttribute("aria-label") || node.textContent.trim(), height: node.getBoundingClientRect().height }))
        .filter((item) => item.height > 0 && item.height < 36),
    };
  });
}

for (const viewport of VIEWPORTS) {
  for (const state of STATES) {
    test(`${viewport.name} ${state} fits the real Pod route`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/pod/pod-4?podLayoutState=rest-selection&restTestState=${state}`);
      await waitForPod(page);
      const expectedState = state === "entry" ? "entry" : state === "completion" ? "completed" : state === "paused" ? "paused" : "active";
      await expect(page.locator(`[data-rest-test-state="${expectedState}"]`)).toBeVisible();
      const result = await measure(page);
      expect(result.documentOverflowX).toBeLessThanOrEqual(1);
      expect(result.documentOverflowY).toBeLessThanOrEqual(1);
      expect(result.activeOverflowY).toBeLessThanOrEqual(1);
      expect(result.panelOverflowY).toBeLessThanOrEqual(1);
      expect(result.panelBottom).toBeLessThanOrEqual(result.viewportHeight + 1);
      expect(result.hiddenControls).toEqual([]);
      expect(result.shortTouchTargets).toEqual([]);

      await expect(page.getByText("Ambient Sound", { exact: true })).toHaveCount(0);
      await expect(page.getByText(/^Next:/)).toHaveCount(0);
      if (!["entry", "paused", "completion"].includes(state)) {
        await expect(page.getByTestId("rest-restart-test")).toHaveCount(0);
      }
      if (state === "paused") {
        await expect(page.getByTestId("rest-restart-test")).toBeVisible();
      }
      if (!["entry", "completion"].includes(state)) {
        const image = page.locator('[data-rest-test-state] img[alt^="Snoozer demonstrating"]');
        await expect(image).toBeVisible();
        expect(await image.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
      }

      const output = path.join(OUTPUT_ROOT, viewport.name);
      await fs.mkdir(output, { recursive: true });
      await page.screenshot({ path: path.join(output, `${state}.png`), fullPage: false });
      await fs.writeFile(path.join(output, `${state}.json`), `${JSON.stringify(result, null, 2)}\n`);
    });
  }
}

test("duration selection starts the automatic Rest Test flow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 585 });
  await page.goto("/pod/pod-4?podLayoutState=rest-selection&restTestState=entry");
  await waitForPod(page);
  await expect(page.getByTestId("rest-begin-test")).toHaveCount(0);
  await expect(page.getByTestId("rest-position-ready")).toHaveCount(0);
  await page.getByTestId("rest-duration-quick").click();
  await expect(page.locator('[data-rest-test-stage="back_flat"]')).toBeVisible();
  await expect(page.locator('[data-rest-test-state="active"]')).toBeVisible({ timeout: 20_000 });
});

test("duration click plays, pauses, resumes, persists, and stops the jazz track", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 585 });
  await page.goto("/pod/pod-4?podLayoutState=rest-selection&restTestState=entry");
  await waitForPod(page);
  await expect(page.locator('[data-pod-rest-status="true"]')).toHaveCount(0);
  await page.getByTestId("rest-duration-quick").click();
  const panel = page.locator('[data-rest-test-state="positioning"], [data-rest-test-state="active"]');
  await expect(panel).toHaveAttribute("data-rest-test-audio-track", "jazz");
  await expect(panel).toHaveAttribute("data-rest-test-audio-status", /starting|playing/);
  expect(Number(await panel.getAttribute("data-rest-test-audio-volume"))).toBeGreaterThan(0);
  const audio = page.locator('audio[data-rest-test-ambient-audio="jazz"]');
  await expect(audio).toHaveCount(1);
  await expect.poll(() => audio.evaluate((node) => node.currentTime)).toBeGreaterThan(0.25);
  await expect(audio).toHaveJSProperty("paused", false);

  const active = page.locator('[data-rest-test-state="active"]');
  await expect(active).toBeVisible({ timeout: 20_000 });
  await expect(active).toHaveAttribute("data-rest-test-audio-track", "jazz");

  await page.getByTestId("rest-pause-test").click();
  await expect(audio).toHaveJSProperty("paused", true);
  const pausedAt = await audio.evaluate((node) => node.currentTime);
  await page.waitForTimeout(350);
  expect(await audio.evaluate((node) => node.currentTime)).toBeCloseTo(pausedAt, 1);

  await page.getByTestId("rest-resume-active").click();
  await expect.poll(() => audio.evaluate((node) => node.paused)).toBe(false);
  const resumedAt = await audio.evaluate((node) => node.currentTime);
  await expect.poll(() => audio.evaluate((node) => node.currentTime)).toBeGreaterThan(resumedAt + 0.2);

  await page.getByRole("button", { name: "Learn", exact: true }).click();
  await expect(audio).toHaveCount(1);
  await expect(audio).toHaveJSProperty("paused", false);
  const learnAt = await audio.evaluate((node) => node.currentTime);
  await expect.poll(() => audio.evaluate((node) => node.currentTime)).toBeGreaterThan(learnAt + 0.2);

  await page.getByRole("button", { name: "Rest Test", exact: true }).click();
  await page.getByTestId("rest-end-test").click();
  await page.getByTestId("rest-confirm-end").click();
  await expect(audio).toHaveCount(0);
});

test("approved Rest Test assets return HTTP 200", async ({ request }) => {
  const paths = [
    "/assets/rest-test-soft-jazz.mp3",
    "/assets/rest-test-back-flat.png",
    "/assets/rest-test-side-flat.png",
    "/assets/rest-test-zero-gravity.png",
    "/assets/rest-test-snore.png",
  ];
  for (const assetPath of paths) {
    const response = await request.get(assetPath);
    expect(response.status(), assetPath).toBe(200);
    expect(response.headers()["content-type"], assetPath).toMatch(
      assetPath.endsWith(".mp3") ? /^audio\// : /^image\//
    );
  }
});

test("the Rest Test pose changes with the current stage", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 585 });
  await page.goto("/pod/pod-4?podLayoutState=rest-selection&restTestState=back");
  await waitForPod(page);
  const pose = page.getByTestId("rest-test-pose");
  await expect(pose).toHaveAttribute("data-rest-test-pose-stage", "back_flat");
  const backSource = await pose.getAttribute("src");

  await page.goto("/pod/pod-4?podLayoutState=rest-selection&restTestState=side");
  await waitForPod(page);
  await expect(pose).toHaveAttribute("data-rest-test-pose-stage", "side_flat");
  const sideSource = await pose.getAttribute("src");
  expect(sideSource).not.toBe(backSource);
  expect(await pose.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
});

for (const podId of ["pod-1", "pod-2", "pod-4"]) {
  test(`${podId} uses the corrected real-route Rest Test`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await page.goto(`/pod/${podId}?podLayoutState=rest-selection&restTestState=entry`);
    await waitForPod(page);
    await page.getByTestId("rest-duration-quick").click();
    const active = page.locator('[data-rest-test-state="active"]');
    await expect(active).toBeVisible({ timeout: 20_000 });
    await expect(active).toHaveAttribute("data-rest-test-audio-track", "jazz");
    await expect(page.locator('img[alt^="Snoozer demonstrating"]')).toBeVisible();
  });
}

test("active Rest Test persists across every Pod experience tab", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 585 });
  await page.goto("/pod/pod-4?podLayoutState=rest-selection&restTestState=entry");
  await waitForPod(page);
  await page.getByTestId("rest-duration-quick").click();
  await expect(page.locator('[data-rest-test-state="active"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Pod Home" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Build", exact: true })).toHaveCount(0);
  const status = page.locator('[data-pod-rest-status="true"]');
  await expect(status).toBeVisible();
  const startingTime = await status.locator(".tabular-nums").textContent();

  const evidenceDir = path.join(OUTPUT_ROOT, "persistence");
  await fs.mkdir(evidenceDir, { recursive: true });
  for (const tab of ["Learn", "Customize", "Ask Snoozer"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(status).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, `${tab.toLowerCase().replaceAll(" ", "-")}.png`),
      fullPage: false,
    });
  }

  await page.getByRole("button", { name: "Human Assistance — Talk to Brandy" }).click();
  await expect(status).toBeVisible();

  await page.waitForTimeout(1_100);
  const continuedTime = await status.locator(".tabular-nums").textContent();
  expect(continuedTime).not.toBe(startingTime);
  await page.getByRole("button", { name: "Pause Rest Test" }).click();
  await expect(page.getByRole("button", { name: "Resume Rest Test" })).toBeVisible();
  const pausedTime = await status.locator(".tabular-nums").textContent();
  await page.waitForTimeout(1_100);
  await expect(status.locator(".tabular-nums")).toHaveText(pausedTime);
  await page.getByRole("button", { name: "Resume Rest Test" }).click();

  await page.getByRole("button", { name: "Rest Test", exact: true }).click();
  await expect(page.locator('[data-rest-test-state="active"]')).toBeVisible();
  await fs.writeFile(
    path.join(evidenceDir, "timer-continuity.json"),
    `${JSON.stringify({ startingTime, continuedTime, pausedTime }, null, 2)}\n`
  );
});
