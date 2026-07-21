const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");

const VIEWPORTS = [
  { name: "1280x585", width: 1280, height: 585 },
  { name: "1280x560", width: 1280, height: 560 },
  { name: "1180x820", width: 1180, height: 820 },
];
const STATES = ["entry", "back", "side", "zero", "snore", "paused", "completion"];
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
