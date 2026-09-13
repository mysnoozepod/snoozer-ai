#!/usr/bin/env node

const assert = require("node:assert/strict");

function loadPlaywright() {
  for (const candidate of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "playwright-core"].filter(Boolean)) {
    try { return require(candidate); } catch { /* try the next installed runtime */ }
  }
  throw new Error("Set PLAYWRIGHT_MODULE_PATH to an installed Playwright runtime.");
}

const { chromium } = loadPlaywright();
const APP_BASE = String(process.env.SHOWROOM_URL || "https://staging.d1yszajjlde5t5.amplifyapp.com").replace(/\/$/, "");
const API_BASE = String(process.env.ASK_SNOOZER_API_BASE || "https://u6zcsiqgj0.execute-api.us-east-1.amazonaws.com/prod").replace(/\/$/, "");
const SNOOZE_CODE_LENGTH = 6;

function unwrap(value) { return value?.data || value || {}; }
function pause(ms = 900) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function issueTestIdentity() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const response = await fetch(`${API_BASE}/assessment`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      shopperId: `phase3-live-${suffix}`,
      sessionId: `phase3-live-session-${suffix}`,
      answers: {
        size: "Queen",
        baseType: "Adjustable Base",
        motionMode: "Standard Motion",
        sleepPartner: "No",
        sleepPosition: "Side",
        temperature: "Hot",
        firmness: "Soft",
      },
      origin: "journey_phase3_live_acceptance",
    }),
  });
  const body = unwrap(await response.json());
  assert.equal(response.status, 200);
  const resumeCode = String(body.accessCode || body.snoozeCode || "");
  assert.match(resumeCode, new RegExp(`^\\d{${SNOOZE_CODE_LENGTH}}$`));
  assert.ok(body.activeJourney?.journeyId);
  return { ...body, resumeCode };
}

async function checkIn(page, snoozeCode) {
  await page.goto(`${APP_BASE}/welcome`, { waitUntil: "networkidle" });
  const inputs = page.locator('input[aria-label^="Snooze Code digit"]');
  assert.equal(await inputs.count(), SNOOZE_CODE_LENGTH);
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/identity/check-in") && response.request().method() === "POST",
    { timeout: 30000 }
  );
  for (let index = 0; index < SNOOZE_CODE_LENGTH; index += 1) {
    await inputs.nth(index).fill(snoozeCode[index]);
  }
  const response = await responsePromise;
  const body = unwrap(await response.json());
  assert.equal(response.status(), 200);
  assert.ok(body.activeJourney?.journeyId);
  return body;
}

async function resolveJourney(snoozeCode, surface) {
  const response = await fetch(`${API_BASE}/journey/resolve`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ snoozeCode, sourceSurface: surface, surface }),
  });
  const body = unwrap(await response.json());
  assert.equal(response.status, 200, `journey resolve failed on ${surface}`);
  assert.ok(body.activeJourney?.journeyId);
  return body;
}

async function recordRestTestFeedback(snoozeCode) {
  const resolved = await resolveJourney(snoozeCode, "rest_test");
  const response = await fetch(`${API_BASE}/journey/event`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      snoozeCode,
      surface: "rest_test",
      expectedRevision: resolved.activeJourney.revision,
      event: {
        type: "rest_test_feedback",
        payload: {
          productHandle: "12-all-foam-mattress",
          podId: "4",
          status: "completed",
          observations: ["too_firm"],
          motionPreference: "liked",
        },
      },
    }),
  });
  const body = unwrap(await response.json());
  assert.equal(response.status, 200, body?.message || "Rest Test feedback failed");
  assert.ok(
    body.activeJourney?.rejectedProducts?.some(
      (item) => item.handle === "12-all-foam-mattress" && item.status === "rejected"
    )
  );
  assert.equal(body.activeJourney?.retainedPreferences?.motion?.value, "liked");
  return body;
}

async function openAsk(page) {
  await page.goto(`${APP_BASE}/ask-snoozer`, { waitUntil: "networkidle" });
  await page.locator("textarea").first().waitFor({ state: "visible", timeout: 30000 });
}

async function ask(page, message) {
  const input = page.locator("textarea").first();
  await input.fill(message);
  const responsePromise = page.waitForResponse(
    (response) => {
      const pathname = new URL(response.url()).pathname.replace(/\/$/, "");
      return pathname.endsWith("/ask-snoozer") && response.request().method() === "POST";
    },
    { timeout: 45000 }
  );
  await page.getByRole("button", { name: "Send" }).click();
  const response = await responsePromise;
  const body = unwrap(await response.json());
  assert.equal(
    response.status(),
    200,
    `${message}: ${body?.code || body?.error || body?.message || "request failed"}`
  );
  await pause();
  const activeJourney = body.activeJourney || (await storedJourney(page));
  assert.ok(
    activeJourney?.journeyId,
    `${message}: no active journey was returned or persisted; response keys=${Object.keys(body).join(",")}`
  );
  return { ...body, activeJourney };
}

function activeProduct(journey) {
  return journey?.activeConfiguration?.productHandle || journey?.sessionRecommendation?.productHandle || null;
}

async function storedJourney(page) {
  return page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem("snooze.sessionState.v1") || "{}").activeJourney || null; }
    catch { return null; }
  });
}

async function journeyResolutionMs(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/journey/resolve"));
    return entries.length ? Math.round(entries[entries.length - 1].duration * 10) / 10 : null;
  });
}

function responseText(body) {
  return String(
    body?.reply ||
    body?.displayAnswer ||
    (typeof body?.answer === "string" ? body.answer : body?.answer?.text) ||
    body?.message?.text ||
    body?.speech ||
    ""
  ).trim();
}

async function run() {
  const identity = await issueTestIdentity();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    const checkInA = await checkIn(pageA, identity.resumeCode);
    assert.equal(checkInA.activeJourney.journeyId, identity.activeJourney.journeyId);
    const restTest = await recordRestTestFeedback(identity.resumeCode);
    assert.equal(restTest.activeJourney.journeyId, identity.activeJourney.journeyId);
    await openAsk(pageA);
    const feedback = await ask(pageA, "What would you recommend now?");
    assert.ok(
      feedback.activeJourney.rejectedProducts.some(
        (item) => item.handle === "12-all-foam-mattress" && item.status === "rejected"
      ),
      `Rest Test feedback was not preserved in Ask; response keys=${Object.keys(feedback).join(",")}; ` +
        `revision=${feedback.activeJourney.revision}; ` +
        `rejected=${feedback.activeJourney.rejectedProducts.map((item) => item.handle).join(",")}`
    );
    assert.equal(feedback.activeJourney.retainedPreferences?.motion?.value, "liked");
    const recommendation = await ask(pageA, "What would you recommend now?");
    assert.notEqual(activeProduct(recommendation.activeJourney), "12-all-foam-mattress");
    const accepted = await ask(pageA, "I like that one.");
    const selectedProduct = activeProduct(accepted.activeJourney);
    assert.ok(selectedProduct && selectedProduct !== "12-all-foam-mattress");
    const king = await ask(pageA, "I need King.");
    assert.equal(king.activeJourney.activeConfiguration?.size, "King");

    const checkInB = await checkIn(pageB, identity.resumeCode);
    assert.equal(checkInB.activeJourney.journeyId, identity.activeJourney.journeyId);
    await openAsk(pageB);
    const resumed = await ask(pageB, "What am I looking at?");
    assert.equal(resumed.activeJourney.activeConfiguration?.size, "King");
    assert.equal(activeProduct(resumed.activeJourney), selectedProduct);
    const mattressOnly = await ask(pageB, "Actually price it mattress only.");
    assert.match(String(mattressOnly.activeJourney.activeConfiguration?.baseDecision || ""), /mattress|none|skip/i);

    await pageA.reload({ waitUntil: "networkidle" });
    await pageA.locator("textarea").first().waitFor({ state: "visible", timeout: 30000 });
    const refreshed = await storedJourney(pageA);
    assert.equal(refreshed?.journeyId, identity.activeJourney.journeyId);
    assert.equal(refreshed?.activeConfiguration?.size, "King");
    assert.match(String(refreshed?.activeConfiguration?.baseDecision || ""), /mattress|none|skip/i);
    const quote = await ask(pageA, "How much?");
    assert.equal(quote.activeJourney.activeConfiguration?.size, "King");

    await pageB.goto(`${APP_BASE}/cart`, { waitUntil: "networkidle" });
    const emptyCartText = await pageB.locator("body").innerText();
    assert.match(emptyCartText, /empty|no items|start building/i);

    const addButton = pageA.getByRole("button", { name: /Add (?:Mattress|to Cart)/i }).last();
    await addButton.waitFor({ state: "visible", timeout: 30000 });
    await addButton.click();
    await pause(1800);

    await pageA.goto(`${APP_BASE}/cart`, { waitUntil: "networkidle" });
    const populatedCartText = await pageA.locator("body").innerText();
    assert.match(populatedCartText, /Dual Comfort/i);
    assert.match(populatedCartText, /King/i);

    await openAsk(pageA);
    const original = await ask(pageA, "What was my original recommendation?");
    assert.match(responseText(original), /All Foam/i);
    const current = await ask(pageA, "What am I choosing now?");
    assert.match(responseText(current), /Dual Comfort/i);

    console.log(JSON.stringify({
      ok: true,
      journeyId: identity.activeJourney.journeyId,
      sameJourneyAcrossBrowsers: true,
      canonicalRecommendation: current.activeJourney.canonicalRecommendation?.primaryMattressHandle || null,
      sessionRecommendation: current.activeJourney.sessionRecommendation?.productHandle || null,
      rejectedProducts: current.activeJourney.rejectedProducts.map((item) => item.handle),
      retainedMotion: current.activeJourney.retainedPreferences?.motion?.value || null,
      size: current.activeJourney.activeConfiguration?.size || null,
      baseDecision: current.activeJourney.activeConfiguration?.baseDecision || null,
      cartStartedEmpty: true,
      exactSelectedProductReachedCart: true,
      originalAndCurrentRecommendationsDistinguished: true,
      browserAJourneyResolutionMs: await journeyResolutionMs(pageA),
      browserBJourneyResolutionMs: await journeyResolutionMs(pageB),
    }, null, 2));
  } finally {
    await contextA.close().catch(() => {});
    await contextB.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
