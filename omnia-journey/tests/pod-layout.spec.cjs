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
  { id: "pod-4-build-review", route: "/pod/pod-4", state: "build-review" },
  { id: "pod-4-build-success", route: "/pod/pod-4", state: "build-success" },
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
];

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

  await fs.writeFile(REPORT_PATH, `${lines.join("\n")}\n`);
}

test.describe.configure({ mode: "serial" });

for (const viewport of VIEWPORTS) {
  for (const testCase of CASES) {
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
        expect(measurement.failures, readFailureText(measurement)).toEqual([]);
      }
    });
  }
}
