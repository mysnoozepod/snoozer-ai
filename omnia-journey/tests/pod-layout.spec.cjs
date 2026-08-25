const { test, expect } = require("@playwright/test");
const { execSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const CASES = [
  { id: "pod-4-home", route: "/pod/pod-4", state: "pod-home" },
  { id: "pod-4-rest-selection", route: "/pod/pod-4", state: "rest-selection" },
  { id: "pod-4-rest-active", route: "/pod/pod-4", state: "rest-active" },
  { id: "pod-4-learn", route: "/pod/pod-4", state: "learn" },
  { id: "pod-4-build-size", route: "/pod/pod-4", state: "build-size" },
  { id: "pod-4-build-base", route: "/pod/pod-4", state: "build-base" },
  { id: "pod-4-build-motion", route: "/pod/pod-4", state: "build-motion" },
  { id: "pod-4-build-essentials", route: "/pod/pod-4", state: "build-essentials" },
  { id: "pod-4-build-review", route: "/pod/pod-4", state: "build-review" },
  { id: "pod-4-build-success", route: "/pod/pod-4", state: "build-success" },
  { id: "pod-5-build-review", route: "/pod/pod-5", state: "build-review" },
  { id: "pod-5-build-success", route: "/pod/pod-5", state: "build-success" },
  { id: "pod-1-learn", route: "/pod/pod-1", state: "learn" },
  { id: "pod-1-home", route: "/pod/pod-1", state: "pod-home" },
  { id: "pod-2-home", route: "/pod/pod-2", state: "pod-home" },
  { id: "pod-2-learn", route: "/pod/pod-2", state: "learn" },
  { id: "pod-1-build-size", route: "/pod/pod-1", state: "build-size" },
  { id: "pod-1-build-base", route: "/pod/pod-1", state: "build-base" },
  { id: "pod-1-build-motion", route: "/pod/pod-1", state: "build-motion" },
  { id: "pod-1-build-comfort", route: "/pod/pod-1", state: "build-comfort" },
  { id: "pod-1-build-review", route: "/pod/pod-1", state: "build-review" },
  { id: "pod-1-build-success", route: "/pod/pod-1", state: "build-success" },
];

const VIEWPORTS = [
  { name: "1180x820", width: 1180, height: 820 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "staging-review-1600x900", width: 1600, height: 900 },
  { name: "staging-observed-1920x899", width: 1920, height: 899 },
  { name: "staging-compact-1920x860", width: 1920, height: 860 },
  { name: "staging-actual-1280x585", width: 1280, height: 585, textRoutesOnly: true },
  { name: "staging-short-1280x560", width: 1280, height: 560, textRoutesOnly: true },
];

const TEXT_ROUTE_STATES = new Set(["pod-home", "learn", "build-essentials", "build-review", "build-success"]);

function shouldRunCase(viewport, testCase) {
  return !viewport.textRoutesOnly || TEXT_ROUTE_STATES.has(testCase.state);
}

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_ROOT = path.join(REPO_ROOT, "_out", "pod-layout");
const REPORT_PATH = path.join(REPO_ROOT, "POD_LAYOUT_MEASUREMENT_REPORT.md");
const EXPECTED_BUILD_COMMIT =
  process.env.VITE_BUILD_COMMIT ||
  execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();

async function ensureRendered(page) {
  await page.waitForSelector('[data-pod-layout-ready="true"]', { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
              window.setTimeout(resolve, 2500);
            })
        )
    );
  });
  await page.waitForTimeout(300);
}

async function writeMeasurementArtifacts(page, viewport, testCase, measurement) {
  const dir = path.join(OUTPUT_ROOT, viewport.name);
  await fs.mkdir(dir, { recursive: true });

  const jsonPath = path.join(dir, `${testCase.id}.json`);
  const fullScreenshotPath = path.join(dir, `${testCase.id}.png`);
  const viewportScreenshotPath = path.join(dir, `${testCase.id}-viewport.png`);
  const headerScreenshotPath = path.join(dir, `${testCase.id}-header.png`);
  const navScreenshotPath = path.join(dir, `${testCase.id}-navigation.png`);
  const heroScreenshotPath = path.join(dir, `${testCase.id}-hero.png`);
  const contentScreenshotPath = path.join(dir, `${testCase.id}-content.png`);

  await fs.writeFile(jsonPath, `${JSON.stringify(measurement, null, 2)}\n`);
  await page.screenshot({ path: fullScreenshotPath, fullPage: true });
  await page.screenshot({ path: viewportScreenshotPath, fullPage: false });

  const headerRegion = page.locator('[data-pod-layout-region="top-header"]');
  if (await headerRegion.count()) {
    await headerRegion.first().screenshot({ path: headerScreenshotPath });
  }

  const navRegion = page.locator('[data-pod-layout-region="pod-nav"]');
  if (await navRegion.count()) {
    await navRegion.first().screenshot({ path: navScreenshotPath });
  }

  const heroRegion = page.locator('[data-pod-layout-region="product-hero"]');
  if (await heroRegion.count()) {
    await heroRegion.first().screenshot({ path: heroScreenshotPath });
  }

  const contentRegion = page.locator('[data-pod-layout-region="active-content"]');
  if (await contentRegion.count()) {
    await contentRegion.first().screenshot({ path: contentScreenshotPath });
  }
}

function readFailureText(measurement) {
  const failures = measurement?.failures || [];
  if (!failures.length) return "";

  const details = [];
  if (measurement?.overlaps?.length) {
    details.push(`overlaps=${measurement.overlaps.map((item) => item.name).join(", ")}`);
  }
  if (measurement?.touchTargets?.belowMinimum?.length) {
    details.push(`touch-targets=${measurement.touchTargets.belowMinimum.length}`);
  }
  if (measurement?.textContainment?.failures?.length) {
    details.push(`text-containment=${JSON.stringify(measurement.textContainment.failures.slice(0, 3))}`);
  }
  return [failures.join(", "), ...details].filter(Boolean).join("; ");
}

function readWarningText(measurement) {
  const warnings = measurement?.warnings || [];
  return warnings.length ? warnings.join(", ") : "";
}

async function generateSummaryReport() {
  const rows = [];

  for (const viewport of VIEWPORTS) {
    for (const testCase of CASES) {
      if (!shouldRunCase(viewport, testCase)) continue;
      const jsonPath = path.join(OUTPUT_ROOT, viewport.name, `${testCase.id}.json`);
      try {
        const measurement = JSON.parse(await fs.readFile(jsonPath, "utf8"));
        rows.push({ viewport: viewport.name, testCase, measurement });
      } catch {
        rows.push({ viewport: viewport.name, testCase, measurement: null });
      }
    }
  }

  const lines = [
    "# Pod Layout Measurement Report",
    "",
    "Generated by `npm run pod:measure` from the real `/pod/pod-4` and `/pod/pod-1` routes.",
    "",
    "Build states cover the simple `/pod/pod-4` path plus the adjustable/Dual Comfort `/pod/pod-1` path.",
    "",
    "## Before Baseline",
    "",
    "- Header actual height: `88px` against `72px` target.",
    "- Fixed bottom navigation actual height: `76px` against `56px` target.",
    "- Product hero actual height: `190.59px` at 1180x820 and `182px` at 768px-tall viewports.",
    "- Page-level vertical overflow existed in every measured state.",
    "- Rest Test controls overlapped the fixed bottom navigation at 1024x768.",
    "- Multiple interactive controls were below the 44px minimum touch target.",
    "",
    "## Current Results",
    "",
    "| Viewport | State | Page Scroll | Active Top | Active Visible | Hero Children | Shell Scroll/Clip | Overlap | Primary Action Visible | Warnings | Result |",
    "|----------|-------|-------------|------------|----------------|---------------|-------------------|---------|------------------------|----------|--------|",
  ];

  rows.forEach(({ viewport, testCase, measurement }) => {
    if (!measurement) {
      lines.push(`| ${viewport} | ${testCase.id} | missing | missing | missing | missing | missing | missing | missing | missing |`);
      return;
    }

    const pageScroll = measurement.page.verticalOverflow
      ? `${measurement.page.scrollHeight}/${measurement.page.clientHeight}`
      : "no";
    const activeTop = measurement.regions.activeContent.rect
      ? String(measurement.regions.activeContent.rect.top)
      : "missing";
    const activeVisible = measurement.regions.activeContent.visibleHeight
      ? String(measurement.regions.activeContent.visibleHeight)
      : "0";
    const heroContainment = measurement.productHeroContainment || {
      failures: [],
      checked: 0,
    };
    const shellScrollContainers = measurement.shellScrollContainers || [];
    const clippedShellContainers = measurement.clippedShellContainers || [];
    const heroChildren = heroContainment.failures.length
      ? `${heroContainment.failures.length} outside`
      : `${heroContainment.checked} ok`;
    const shellScrollClip = shellScrollContainers.length || clippedShellContainers.length
      ? `${shellScrollContainers.length}/${clippedShellContainers.length}`
      : "no";
    const overlap = measurement.overlaps.length ? String(measurement.overlaps.length) : "no";
    const primary =
      measurement.primaryActionVisible === null
        ? "n/a"
        : `${measurement.primaryActionVisible ? "yes" : "no"} (${measurement.primaryActionVisiblePercent}%)`;
    const result =
      measurement.result === "pass" ? "pass" : `fail: ${readFailureText(measurement)}`;
    const warnings = readWarningText(measurement) || "none";

    lines.push(
      `| ${viewport} | ${testCase.id} | ${pageScroll} | ${activeTop} | ${activeVisible} | ${heroChildren} | ${shellScrollClip} | ${overlap} | ${primary} | ${warnings} | ${result} |`
    );
  });

  lines.push(
    "",
    "## Region Measurements",
    "",
    "| Viewport | State | Header actual/diff | Hero actual/diff | Content actual/diff | Nav actual/diff |",
    "|----------|-------|--------------------|------------------|---------------------|-----------------|"
  );

  rows.forEach(({ viewport, testCase, measurement }) => {
    if (!measurement) return;
    const header = measurement.regions.header;
    const hero = measurement.regions.productHero;
    const content = measurement.regions.activeContent;
    const nav = measurement.regions.navigation;
    lines.push(
      `| ${viewport} | ${testCase.id} | ${header.actual}/${header.diff} | ${hero.actual}/${hero.diff} | ${content.actual}/${content.diff} | ${nav.actual}/${nav.diff} |`
    );
  });

  lines.push(
    "",
    "## Artifact Locations",
    "",
    "- Full screenshots: `_out/pod-layout/<viewport>/<case>.png`",
    "- Viewport screenshots: `_out/pod-layout/<viewport>/<case>-viewport.png`",
    "- Header screenshots: `_out/pod-layout/<viewport>/<case>-header.png`",
    "- Navigation screenshots: `_out/pod-layout/<viewport>/<case>-navigation.png`",
    "- Hero screenshots: `_out/pod-layout/<viewport>/<case>-hero.png`",
    "- Content screenshots: `_out/pod-layout/<viewport>/<case>-content.png`",
    "- JSON reports: `_out/pod-layout/<viewport>/<case>.json`",
    ""
  );

  const report = `${lines.join("\n")}\n`;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await fs.writeFile(REPORT_PATH, report);
      break;
    } catch (error) {
      if (attempt === 5 || !["UNKNOWN", "EBUSY", "EPERM"].includes(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
}

test.describe.configure({ mode: "serial" });

for (const viewport of VIEWPORTS) {
  for (const testCase of CASES) {
    if (!shouldRunCase(viewport, testCase)) continue;
    test(`${viewport.name} ${testCase.id}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${testCase.route}?podLayoutState=${testCase.state}`, { waitUntil: "domcontentloaded" });
      await ensureRendered(page);

      const measurement = await page.evaluate(() => window.__getPodLayoutMeasurement?.());
      expect(measurement, "Pod layout measurement should be available").toBeTruthy();
      const buildInfo = await page.evaluate(() => window.__SNOOZE_BUILD_INFO || null);
      expect(buildInfo?.commit, "Built frontend commit should match the expected repo commit").toBe(
        EXPECTED_BUILD_COMMIT
      );

      await writeMeasurementArtifacts(page, viewport, testCase, measurement);
      await generateSummaryReport();

      if (testInfo.project.name === "strict") {
        expect(
          measurement.textContainment?.failures || [],
          JSON.stringify(measurement.textContainment?.failures || [], null, 2)
        ).toEqual([]);
        expect(measurement.failures, readFailureText(measurement)).toEqual([]);
        await expect(page.locator('[data-pod-route-header="true"] img')).toHaveCount(0);

        if (testCase.state === "learn") {
          await expect(page.getByText("How This Mattress Supports Your Sleep")).toBeVisible();
          await expect(page.getByText("Choose Size")).toBeVisible();
          await expect(page.getByText("Snoozer Recommendation")).toBeVisible();
          await expect(page.getByText("Sleep Nutrition")).toHaveCount(0);
          await expect(page.locator('[data-pod-route-header] [data-pod-badge="true"]')).toHaveCount(0);
          await expect(page.getByText(/^Specs$/)).toHaveCount(0);
          await expect(page.getByText("Prices may vary by retailer.")).toHaveCount(0);
          await expect(page.locator("[data-pod-support-row]").first()).toBeVisible();
          await expect(page.locator('[data-pod-recommendation-summary="true"]')).toHaveCount(1);
          await expect(page.locator("[data-pod-nutrition-row]")).toHaveCount(0);
        }

        if (testCase.state.startsWith("build")) {
          await expect(page.locator("[data-pod-build-progress='true']")).toHaveCount(0);
          await expect(page.getByText(/^Step \d$/i)).toHaveCount(0);
        }

        if (testCase.state === "build-review") {
          await expect(page.getByRole("heading", { name: "Review Your SnoozePod" })).toBeVisible();
          await expect(page.locator('[data-pod-builder-summary-row="mattress"]')).toHaveCount(1);
          await expect(page.locator('[data-pod-builder-summary-row="base-motion"]')).toHaveCount(1);
          await expect(page.locator('[data-pod-builder-commerce-summary="true"]')).toBeVisible();
          const totalLabel = page.getByText("Est. Total");
          const commerceUnavailable = page
            .locator('[data-pod-builder-commerce-summary="true"]')
            .getByText(/not ready to add yet|unavailable/i);
          if (await totalLabel.count()) {
            await expect(page.getByText("Est. Monthly")).toBeVisible();
            await expect(totalLabel).toBeVisible();
          } else {
            await expect(commerceUnavailable).toBeVisible();
          }
          await expect(page.locator('[data-pod-layout-primary-action="build-add"]')).toBeVisible();
          await expect(page.getByText("Review & add.")).toHaveCount(0);

          const reviewContainment = await page.evaluate(() => {
            const summary = document.querySelector('[data-pod-builder-review-summary="true"]');
            const action = document.querySelector('[data-pod-builder-commerce-summary="true"]');
            if (!summary || !action) return { ok: false, reason: "missing review summary or commerce action" };
            const coreGroup = document.querySelector('[data-pod-builder-summary-group="core"]');
            const essentialsGroup = document.querySelector('[data-pod-builder-summary-group="essentials"]');
            const summaryRows = Array.from(document.querySelectorAll("[data-pod-builder-summary-row]"));
            const summaryRect = summary.getBoundingClientRect();
            const actionRect = action.getBoundingClientRect();
            const coreRect = coreGroup?.getBoundingClientRect();
            const essentialsRect = essentialsGroup?.getBoundingClientRect();
            const actionStyle = getComputedStyle(action);
            const state = action.closest('[data-pod-builder-state="review"]');
            const stateRect = state.getBoundingClientRect();
            const actionButtons = Array.from(action.querySelectorAll("button"));
            const rowFailures = summaryRows
              .map((row) => {
                const rect = row.getBoundingClientRect();
                const parentRect = row.parentElement.getBoundingClientRect();
                return {
                  text: row.textContent.trim().replace(/\s+/g, " "),
                  rect: rect.toJSON(),
                  parentRect: parentRect.toJSON(),
                  scrollHeight: row.scrollHeight,
                  clientHeight: row.clientHeight,
                  overflow: getComputedStyle(row).overflow,
                  failed:
                    rect.bottom > parentRect.bottom + 0.5 ||
                    rect.bottom > window.innerHeight + 0.5 ||
                    row.scrollHeight > row.clientHeight,
                };
              })
              .filter((row) => row.failed);
            return {
              ok:
                coreRect &&
                (!essentialsRect || coreRect.bottom <= essentialsRect.top + 0.5) &&
                summaryRect.bottom <= stateRect.bottom + 0.5 &&
                actionRect.bottom <= window.innerHeight + 0.5 &&
                actionRect.bottom <= stateRect.bottom + 0.5 &&
                state.scrollHeight <= state.clientHeight &&
                !["absolute", "fixed", "sticky"].includes(actionStyle.position) &&
                actionButtons.every((button) => {
                  const rect = button.getBoundingClientRect();
                  return rect.top >= actionRect.top - 0.5 && rect.bottom <= actionRect.bottom + 0.5;
                }) &&
                rowFailures.length === 0,
              summaryRect: summaryRect.toJSON(),
              actionRect: actionRect.toJSON(),
              coreRect: coreRect?.toJSON(),
              essentialsRect: essentialsRect?.toJSON(),
              rowFailures,
              viewport: { width: window.innerWidth, height: window.innerHeight },
              stateScrollHeight: state.scrollHeight,
              stateClientHeight: state.clientHeight,
              actionPosition: actionStyle.position,
              actionOverflow: actionStyle.overflow,
            };
          });
          expect(reviewContainment.ok, JSON.stringify(reviewContainment, null, 2)).toBeTruthy();
        }

        if (testCase.state === "build-essentials") {
          await expect(page.locator('[data-sleep-essentials-card-row="three"]')).toBeVisible();
          await expect(page.locator('[data-sleep-essentials-card]')).toHaveCount(3);
          await expect(page.getByRole("button", { name: "Continue to Review", exact: true })).toBeVisible();

          const essentialsContainment = await page.evaluate(() => {
            const row = document.querySelector('[data-sleep-essentials-card-row="three"]');
            const action = document.querySelector('[data-pod-builder-state="essentials"] [data-pod-builder-action-row="true"]');
            const cards = Array.from(document.querySelectorAll('[data-sleep-essentials-card]'));
            if (!row || !action || cards.length !== 3) return { ok: false, reason: "missing essentials cards or action row" };
            const rowRect = row.getBoundingClientRect();
            const actionRect = action.getBoundingClientRect();
            const cardResults = cards.map((card) => {
              const rect = card.getBoundingClientRect();
              const cardAction = card.querySelector('[data-sleep-essentials-card-action="true"]');
              const actionRectInside = cardAction?.getBoundingClientRect();
              return {
                rect: rect.toJSON(),
                scrollHeight: card.scrollHeight,
                clientHeight: card.clientHeight,
                actionRect: actionRectInside?.toJSON(),
                ok:
                  rect.top >= rowRect.top - 0.5 &&
                  rect.bottom <= rowRect.bottom + 0.5 &&
                  rect.bottom <= actionRect.top + 0.5 &&
                  card.scrollHeight <= card.clientHeight &&
                  (!actionRectInside || actionRectInside.bottom <= rect.bottom + 0.5),
              };
            });
            return {
              ok: actionRect.bottom <= window.innerHeight + 0.5 && cardResults.every((item) => item.ok),
              rowRect: rowRect.toJSON(),
              actionRect: actionRect.toJSON(),
              cards: cardResults,
              viewport: { width: innerWidth, height: innerHeight },
            };
          });
          expect(essentialsContainment.ok, JSON.stringify(essentialsContainment, null, 2)).toBeTruthy();
        }

        if (testCase.state === "build-success") {
          await expect(page.locator('[data-pod-builder-success-layout="compact"]')).toBeVisible();
          await expect(page.locator('[data-pod-builder-success-banner="true"]')).toBeVisible();
          await expect(page.getByText("Your setup is in the cart.", { exact: true })).toHaveCount(1);
          await expect(page.getByRole("button", { name: "Open Cart" })).toBeVisible();
          await expect(page.getByRole("button", { name: "Build Another" })).toBeVisible();
          await expect(page.getByText("Added to cart.", { exact: true })).toHaveCount(0);
          await expect(page.getByText("This setup is saved in the showroom cart.", { exact: false })).toHaveCount(0);

          const successContainment = await page.evaluate(() => {
            const layout = document.querySelector('[data-pod-builder-success-layout="compact"]');
            const actions = document.querySelector('[data-pod-builder-success-actions="true"]');
            if (!layout || !actions) return { ok: false, reason: "missing compact success layout" };
            const layoutRect = layout.getBoundingClientRect();
            const actionRect = actions.getBoundingClientRect();
            const layoutStyle = getComputedStyle(layout);
            const actionStyle = getComputedStyle(actions);
            return {
              ok:
                layoutRect.bottom <= window.innerHeight + 0.5 &&
                actionRect.bottom <= layoutRect.bottom + 0.5 &&
                layout.scrollHeight <= layout.clientHeight &&
                !["absolute", "fixed", "sticky"].includes(actionStyle.position) &&
                layoutStyle.overflow !== "hidden",
              layoutRect: layoutRect.toJSON(),
              actionRect: actionRect.toJSON(),
              viewport: { width: window.innerWidth, height: window.innerHeight },
              layoutScrollHeight: layout.scrollHeight,
              layoutClientHeight: layout.clientHeight,
              layoutOverflow: layoutStyle.overflow,
              actionPosition: actionStyle.position,
            };
          });
          expect(successContainment.ok, JSON.stringify(successContainment, null, 2)).toBeTruthy();
        }

        if (testCase.state === "build-size") {
          await expect(page.locator("[data-pod-build-summary]")).toHaveCount(0);
          const queenChoice = page.locator('[data-pod-build-choice="Queen"]').first();
          await expect(queenChoice).toHaveAttribute("data-pod-build-choice-badge", "Most Popular");
          await expect(queenChoice).toHaveAttribute("data-pod-build-choice-active", "false");
          await queenChoice.click();
          await expect(page.locator('[data-pod-builder-state="base"]')).toBeVisible();
        }
      }
    });
  }
}

test("pod-4 queen adjustable standard setup is gated by resolved commerce lines", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/pod/pod-4?podLayoutState=build-size", { waitUntil: "domcontentloaded" });
  await ensureRendered(page);

  await page.locator('[data-pod-build-choice="Queen"]').first().click();
  await expect(page.locator('[data-pod-builder-state="base"]')).toBeVisible();

  await page.locator('[data-pod-build-choice="Adjustable Base"]').first().click();
  await expect(page.locator('[data-pod-builder-state="motion"]')).toBeVisible();

  await page.locator('[data-pod-build-choice="Standard Motion"]').first().click();
  await expect(page.locator('[data-pod-builder-state="essentials"]')).toBeVisible();
  await page.getByRole("button", { name: "Continue to Review", exact: true }).click();
  await expect(page.locator('[data-pod-builder-state="review"]')).toBeVisible();

  const addButton = page.locator('[data-pod-layout-primary-action="build-add"]').first();
  await expect(addButton).toBeVisible();
  const addDisabled = await addButton.isDisabled();
  const availabilityMessageCount = await page.getByText(/unavailable|not ready to add/i).count();

  expect(
    addDisabled || availabilityMessageCount > 0,
    "Pod 4 cannot present Queen + Adjustable Base + Standard Motion as addable without resolved variants"
  ).toBeTruthy();
});

for (const viewport of [
  { name: "staging-observed", width: 1920, height: 899 },
  { name: "staging-zoomed", width: 1280, height: 585 },
]) {
  test(`${viewport.name} cart-banner essentials remain actionable through review`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() => {
      sessionStorage.setItem("snooze.cart", JSON.stringify([{
        id: "gid://shopify/ProductVariant/9001",
        merchandiseId: "gid://shopify/ProductVariant/9001",
        handle: "12-all-foam-mattress",
        title: '12" All Foam Mattress',
        quantity: 1,
        unitPrice: 1599,
      }]));
    });
    await page.route("**/sleepEssentials/catalog", async (route) => {
      const makeProduct = (handle, title, variantId, variantTitle, amount) => ({
        handle,
        title,
        available: true,
        imageUrl: "/no-image.svg",
        variants: [{
          id: `gid://shopify/ProductVariant/${variantId}`,
          title: variantTitle,
          availableForSale: true,
          price: { amount: String(amount), currencyCode: "USD" },
        }],
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          catalog: {
            categories: [
              { id: "pillows", products: [makeProduct("layout-pillow", "CarbonCool Omniphase Pillow", 9101, "Queen", 169)] },
              { id: "sheets_bedding", products: [makeProduct("layout-sheets", "Hyper-Cotton Sheet Set", 9102, "Queen / Bright White", 180)] },
              { id: "protectors", products: [makeProduct("layout-protector", "Ver-Tex Mattress Protector", 9103, "Queen", 230)] },
            ],
          },
        }),
      });
    });

    await page.goto("/pod/pod-4?podLayoutState=build-essentials&cartBanner=1", { waitUntil: "domcontentloaded" });
    await ensureRendered(page);
    await expect(page.locator('[data-mattress-cart-continuity="true"]')).toBeVisible();
    const cards = page.locator('[data-sleep-essentials-card]');
    await expect(cards).toHaveCount(3);

    for (let index = 0; index < 3; index += 1) {
      const card = cards.nth(index);
      await expect(card.locator('[data-sleep-essentials-card-action="true"]')).toBeVisible();
      await card.click();
      await expect(card).toContainText("Added");
    }

    const essentialsFit = await page.evaluate(() => {
      const state = document.querySelector('[data-pod-builder-state="essentials"]');
      const row = document.querySelector('[data-sleep-essentials-card-row="three"]');
      const action = state?.querySelector('[data-pod-builder-action-row="true"]');
      const cardActions = Array.from(document.querySelectorAll('[data-sleep-essentials-card-action="true"]'));
      if (!state || !row || !action || cardActions.length !== 3) return { ok: false };
      const rowRect = row.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();
      return {
        ok:
          state.scrollHeight <= state.clientHeight &&
          rowRect.bottom <= actionRect.top + 0.5 &&
          actionRect.bottom <= innerHeight + 0.5 &&
          cardActions.every((item) => {
            const rect = item.getBoundingClientRect();
            const cardRect = item.closest('[data-sleep-essentials-card]').getBoundingClientRect();
            return rect.bottom <= cardRect.bottom + 0.5;
          }),
        state: { scrollHeight: state.scrollHeight, clientHeight: state.clientHeight },
        rowRect: rowRect.toJSON(),
        actionRect: actionRect.toJSON(),
      };
    });
    expect(essentialsFit.ok, JSON.stringify(essentialsFit, null, 2)).toBeTruthy();

    await page.getByRole("button", { name: "Continue to Review", exact: true }).click();
    await expect(page.locator('[data-pod-builder-state="review"]')).toBeVisible();
    await expect(page.locator('[data-pod-builder-summary-row="essential"]')).toHaveCount(3);
    await expect(page.locator('[data-pod-layout-primary-action="build-add"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to essentials", exact: true })).toBeVisible();

    const reviewFit = await page.evaluate(() => {
      const state = document.querySelector('[data-pod-builder-state="review"]');
      const layout = document.querySelector('[data-pod-builder-review-layout="decision"]');
      const children = Array.from(layout?.children || []);
      if (!state || !layout || children.length !== 2) return { ok: false };
      const stateRect = state.getBoundingClientRect();
      return {
        ok:
          state.scrollHeight <= state.clientHeight &&
          children.every((item) => {
            const rect = item.getBoundingClientRect();
            return rect.top >= stateRect.top - 0.5 && rect.bottom <= stateRect.bottom + 0.5;
          }) &&
          Array.from(layout.querySelectorAll("button")).every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.bottom <= stateRect.bottom + 0.5 && rect.height >= 44;
          }),
        state: { scrollHeight: state.scrollHeight, clientHeight: state.clientHeight, rect: stateRect.toJSON() },
        children: children.map((item) => item.getBoundingClientRect().toJSON()),
      };
    });
    expect(reviewFit.ok, JSON.stringify(reviewFit, null, 2)).toBeTruthy();
  });
}
