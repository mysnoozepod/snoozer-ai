#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadShopifyAssessmentModule } = require("./loadShopifyAssessmentModule");

const HEADER_TEMPLATE_PATH = path.join(__dirname, "..", "sections", "header.liquid");
const ASSESSMENT_TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "sections",
  "snoozer-landing-assessment.liquid"
);

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : "";
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    dump() {
      return Object.fromEntries(values.entries());
    },
  };
}

function createAssessmentModule() {
  const sessionStorage = createStorage();
  const localStorage = createStorage();
  const moduleUnderTest = loadShopifyAssessmentModule({
    window: {
      sessionStorage,
      localStorage,
      MySnoozePod: {},
      navigator: {},
      setTimeout,
      clearTimeout,
    },
    document: {
      body: {
        appendChild() {},
        removeChild() {},
      },
      createElement() {
        return {
          value: "",
          style: {},
          setAttribute() {},
          focus() {},
          select() {},
        };
      },
      execCommand() {
        return true;
      },
      documentElement: {
        getAttribute() {
          return "";
        },
      },
      addEventListener() {},
      querySelectorAll() {
        return [];
      },
    },
  });

  return {
    sessionStorage,
    localStorage,
    moduleUnderTest,
  };
}

function testAssessmentIdentityPersistsStableKeys() {
  const { sessionStorage, localStorage, moduleUnderTest } = createAssessmentModule();
  const nextIdentity = moduleUnderTest.applyAssessmentSaveIdentity(
    {
      shopperId: "shopify-assessment-template--temp-1",
      sessionId: "assessment_session_1",
    },
    {
      shopperId: "589424",
      snoozeCode: "589424",
      accessCode: "589424",
      profileId: "shopper#589424",
      identityType: "snooze_code",
      isNewCode: true,
    }
  );

  moduleUnderTest.persistAssessmentIdentity(nextIdentity);

  const sessionData = sessionStorage.dump();
  const localData = localStorage.dump();

  assert.strictEqual(nextIdentity.snoozeCode, "589424", "save response should resolve the issued Snooze Code");
  assert.strictEqual(sessionData.snoozeCode, "589424", "session storage should keep snoozeCode");
  assert.strictEqual(sessionData.snoozer_snooze_code, "589424", "session storage should keep snoozer_snooze_code");
  assert.strictEqual(sessionData.snoozer_access_code, "589424", "session storage should keep snoozer_access_code");
  assert.strictEqual(sessionData.snoozer_shopper_id, "589424", "session storage should keep snoozer_shopper_id");
  assert.strictEqual(localData.snoozeCode, "589424", "local storage should keep snoozeCode");
  assert.strictEqual(localData.snoozer_snooze_code, "589424", "local storage should keep snoozer_snooze_code");
  assert.strictEqual(localData.snoozer_access_code, "589424", "local storage should keep snoozer_access_code");
  assert.strictEqual(localData.snoozer_shopper_id, "589424", "local storage should keep snoozer_shopper_id");
}

function testSnoozeCodeCardDataBuildsWhenCodeExists() {
  const { moduleUnderTest } = createAssessmentModule();
  const cardData = moduleUnderTest.buildSnoozeCodeCardData({
    shopperId: "589424",
    snoozeCode: "589424",
    accessCode: "589424",
  });

  assert(cardData, "card data should exist when a Snooze Code exists");
  assert.strictEqual(cardData.title, "Your Snooze Code");
  assert.strictEqual(cardData.code, "589424");
  assert(
    String(cardData.helperText || "").includes("unlock your recommendations, rewards, and Snooze Session prep"),
    "helper text should explain the continuity value"
  );
}

function testSnoozeCodeCardDataSkipsEmptyCodes() {
  const { moduleUnderTest } = createAssessmentModule();
  const cardData = moduleUnderTest.buildSnoozeCodeCardData({
    shopperId: "shopify-assessment-template--temp-1",
  });

  assert.strictEqual(cardData, null, "temporary shopper ids should not render an empty Snooze Code card");
}

function testThemeTemplatesContainSnoozeCodeHooks() {
  const headerTemplate = fs.readFileSync(HEADER_TEMPLATE_PATH, "utf8");
  const assessmentTemplate = fs.readFileSync(ASSESSMENT_TEMPLATE_PATH, "utf8");

  assert(
    headerTemplate.includes("data-snooze-checkin-form"),
    "header should expose a Snooze Code check-in form hook"
  );
  assert(
    headerTemplate.includes("/identity/check-in"),
    "header check-in form should call the identity check-in endpoint"
  );
  assert(
    headerTemplate.includes("Snooze Profile unlocked"),
    "header should show a success state after a valid check-in"
  );
  assert(
    headerTemplate.includes("Code not found"),
    "header should show a safe failure state for unknown codes"
  );
  assert(
    headerTemplate.includes("snoozer_snooze_code") &&
      headerTemplate.includes("snoozer_access_code") &&
      headerTemplate.includes("snoozer_shopper_id"),
    "header should persist the canonical Snooze Code identity keys"
  );
  assert(
    assessmentTemplate.includes("data-assessment-snooze-card"),
    "assessment results should include a Snooze Code card slot"
  );
}

function main() {
  testAssessmentIdentityPersistsStableKeys();
  testSnoozeCodeCardDataBuildsWhenCodeExists();
  testSnoozeCodeCardDataSkipsEmptyCodes();
  testThemeTemplatesContainSnoozeCodeHooks();
  console.log("All Snooze Code theme UI tests passed.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
