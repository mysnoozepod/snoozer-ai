const fs = require("node:fs");
const path = require("node:path");

function loadPlaywright() {
  const explicit = process.env.PLAYWRIGHT_MODULE_PATH;
  const candidates = [
    explicit,
    "playwright",
    "playwright-core",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try next
    }
  }

  throw new Error(
    "Unable to load Playwright. Set PLAYWRIGHT_MODULE_PATH or install playwright/playwright-core."
  );
}

const { chromium } = loadPlaywright();

const BASE_URL = process.env.SHOWROOM_URL || "http://127.0.0.1:4173";
const SCREENSHOT_PATH =
  process.env.SHOWROOM_SCREENSHOT_PATH ||
  path.resolve("C:/Users/14342/Desktop/snoozer-ai/_out/results-canonical-flow.png");

const FLOW_STEPS = [
  /Queen/i,
  /Adjustable Base/i,
  /Half Split Motion/i,
  /^No/i,
  /Side/i,
  /High/i,
  /Hot/i,
  /Soft/i,
  /^No/i,
  /Skip/i,
];

async function clickButton(page, namePattern, timeout = 15000) {
  const button = page.getByRole("button", { name: namePattern }).first();
  await button.waitFor({ state: "visible", timeout });
  await button.click();
}

async function run() {
  fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });

  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await page.goto(`${BASE_URL}/assessment`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Snooze Assessment/i }).waitFor();

    for (const step of FLOW_STEPS) {
      await clickButton(page, step);
      await page.waitForTimeout(350);
    }

    await page.waitForURL(/\/results(?:$|\?)/, { timeout: 45000 });
    await page.getByText(/Here are your 5 SnoozePods/i).waitFor({ timeout: 20000 });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

    const result = {
      ok: true,
      baseUrl: BASE_URL,
      finalUrl: page.url(),
      screenshotPath: SCREENSHOT_PATH,
      title: await page.title(),
      topHeading:
        (await page.getByText(/Here are your 5 SnoozePods/i).first().textContent()) || "",
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        baseUrl: BASE_URL,
        error: error && error.message ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
