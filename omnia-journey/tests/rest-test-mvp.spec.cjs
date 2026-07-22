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

test("manual Position Ready gates active timing", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 585 });
  await page.goto("/pod/pod-4?podLayoutState=rest-selection&restTestState=entry");
  await waitForPod(page);
  await page.getByTestId("rest-begin-test").click();
  await expect(page.locator('[data-rest-test-state="positioning"]')).toBeVisible();
  const before = await page.locator('[data-rest-test-stage]').getAttribute("data-rest-test-stage");
  await page.waitForTimeout(1150);
  await expect(page.locator('[data-rest-test-state="positioning"]')).toBeVisible();
  await page.getByTestId("rest-position-ready").click();
  await expect(page.locator('[data-rest-test-state="active"]')).toBeVisible();
  expect(before).toBe("back_flat");
});

test("Begin Rest Test unlocks audible waves from the direct click", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 585 });
  await page.goto("/pod/pod-4?podLayoutState=rest-selection&restTestState=entry");
  await waitForPod(page);
  await page.getByTestId("rest-begin-test").click();
  const panel = page.locator('[data-rest-test-state="positioning"]');
  await expect(panel).toHaveAttribute("data-rest-test-audio-track", "waves");
  await expect(panel).toHaveAttribute("data-rest-test-audio-status", "playing");
  expect(Number(await panel.getAttribute("data-rest-test-audio-volume"))).toBeGreaterThan(0);
  await page.getByTestId("rest-position-ready").click();
  await page.waitForTimeout(1300);
  expect(Number(await page.locator('[data-rest-test-state="active"]').getAttribute("data-rest-test-audio-time"))).toBeGreaterThan(0);
});

test("approved Rest Test assets return HTTP 200", async ({ request }) => {
  const paths = [
    "/rest-test/audio/rest-test-crashing-waves.mp3",
    "/rest-test/audio/rest-test-soft-ambient-sleep-tones.mp3",
    "/rest-test/visuals/rest-test-back-flat.png",
    "/rest-test/visuals/rest-test-side-flat.png",
    "/rest-test/visuals/rest-test-zero-gravity.png",
    "/rest-test/visuals/rest-test-snore.png",
  ];
  for (const assetPath of paths) {
    const response = await request.get(assetPath);
    expect(response.status(), assetPath).toBe(200);
  }
});

for (const podId of ["pod-1", "pod-2", "pod-4"]) {
  test(`${podId} uses the corrected real-route Rest Test`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 585 });
    await page.goto(`/pod/${podId}?podLayoutState=rest-selection&restTestState=entry`);
    await waitForPod(page);
    await page.getByTestId("rest-begin-test").click();
    await expect(page.locator('[data-rest-test-state="positioning"]')).toHaveAttribute("data-rest-test-audio-track", "waves");
    await expect(page.locator('img[alt^="Snoozer demonstrating"]')).toBeVisible();
  });
}

test("leaving Rest Test pauses the persisted program", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 585 });
  await page.goto("/pod/pod-4?podLayoutState=rest-selection&restTestState=entry");
  await waitForPod(page);
  await page.getByTestId("rest-begin-test").click();
  await page.getByTestId("rest-position-ready").click();
  await expect(page.locator('[data-rest-test-state="active"]')).toBeVisible();
  await page.getByRole("button", { name: "Learn" }).click();
  await page.getByRole("button", { name: "Rest Test" }).click();
  await expect(page.locator('[data-rest-test-state="paused"]')).toBeVisible();
});
