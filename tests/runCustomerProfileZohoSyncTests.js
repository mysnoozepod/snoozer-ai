#!/usr/bin/env node

const assert = require("assert");

const ENV_KEYS = [
  "ZCRM_CLIENT_ID",
  "ZCRM_CLIENT_SECRET",
  "ZCRM_REFRESH_TOKEN",
  "ZCRM_OAUTH_DOMAIN",
  "ZOHO_CRM_BASE",
  "ZCRM_API_DOMAIN",
  "ZOHO_CONTACT_KEY_FIELD",
  "ZOHO_FIELD_TOP_POD_ID",
  "ZOHO_FIELD_TOP_POD_IDS",
  "ZOHO_FIELD_PRIMARY_MATTRESS_HANDLE",
  "ZOHO_FIELD_BASE_HANDLE",
  "ZOHO_FIELD_MOTION_KEY",
  "ZOHO_FIELD_LEAD_STAGE",
  "ZOHO_FIELD_SOURCE_SURFACE",
  "ZOHO_FIELD_LAST_INTENT",
  "ZOHO_FIELD_LAST_INTERACTION_AT",
  "CUSTOMER_PROFILE_TABLE",
];

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function setZohoConfigEnv() {
  process.env.ZCRM_CLIENT_ID = "test-client-id";
  process.env.ZCRM_CLIENT_SECRET = "test-client-secret";
  process.env.ZCRM_REFRESH_TOKEN = "test-refresh-token";
  process.env.ZCRM_OAUTH_DOMAIN = "https://accounts.zoho.test";
  process.env.ZOHO_CRM_BASE = "https://www.zohoapis.test";
  process.env.ZOHO_CONTACT_KEY_FIELD = "Snoozer_Shopper_ID";
}

function clearOptionalZohoFieldEnv() {
  delete process.env.ZOHO_FIELD_TOP_POD_ID;
  delete process.env.ZOHO_FIELD_TOP_POD_IDS;
  delete process.env.ZOHO_FIELD_PRIMARY_MATTRESS_HANDLE;
  delete process.env.ZOHO_FIELD_BASE_HANDLE;
  delete process.env.ZOHO_FIELD_MOTION_KEY;
  delete process.env.ZOHO_FIELD_LEAD_STAGE;
  delete process.env.ZOHO_FIELD_SOURCE_SURFACE;
  delete process.env.ZOHO_FIELD_LAST_INTENT;
  delete process.env.ZOHO_FIELD_LAST_INTERACTION_AT;
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function loadZohoModules() {
  clearModule("../services/customerProfileZohoSync");
  clearModule("../services/zoho");
  clearModule("../services/zohoauth");
  const zoho = require("../services/zoho");
  const customerProfileZohoSync = require("../services/customerProfileZohoSync");
  return { zoho, customerProfileZohoSync };
}

function buildProfile(overrides = {}) {
  return {
    shopperId: "shopper-zoho-1",
    preferredName: "Jamie",
    email: "jamie@example.com",
    phone: "5551234567",
    assessmentAnswers: {
      size: "Queen",
      motionMode: "No Motion",
      sleepPartner: "No",
      sleepPosition: "Side",
      temperature: "Hot",
      firmness: "Soft",
    },
    topPodId: "4",
    topPodIds: ["4", "2"],
    primaryMattressHandle: "12-all-foam-mattress",
    baseHandle: null,
    motionKey: "no_motion",
    leadStage: "assessment_completed",
    sourceSurface: "assessment_api",
    lastIntent: "assessment_submit",
    lastInteractionAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

function createZohoHarness({ initialContacts = [] } = {}) {
  const contacts = initialContacts.map((contact) => ({ ...contact }));
  let createCount = 0;
  let updateCount = 0;
  let searchCount = 0;

  function getShopperIdFromSearchPath(path) {
    const encodedCriteria = String(path.split("criteria=")[1] || "");
    const criteria = decodeURIComponent(encodedCriteria);
    const match = criteria.match(/equals:([^)]+)/);
    return match ? match[1] : "";
  }

  async function handler(path, method, payload) {
    if (method === "get" && path.startsWith("/Contacts/search?criteria=")) {
      searchCount += 1;
      const shopperId = getShopperIdFromSearchPath(path);
      return {
        data: contacts.filter(
          (contact) => String(contact.Snoozer_Shopper_ID || "") === String(shopperId || "")
        ),
      };
    }

    if (method === "post" && path === "/Contacts") {
      createCount += 1;
      const data = payload?.data?.[0] || {};
      const id = `contact-${contacts.length + 1}`;
      contacts.push({ ...data, id });
      return {
        data: [
          {
            code: "SUCCESS",
            details: { id },
          },
        ],
      };
    }

    if (method === "put" && path.startsWith("/Contacts/")) {
      updateCount += 1;
      const id = String(path.split("/").pop() || "");
      const index = contacts.findIndex((contact) => String(contact.id || "") === id);
      if (index >= 0) {
        contacts[index] = {
          ...contacts[index],
          ...(payload?.data?.[0] || {}),
        };
      }

      return {
        data: [
          {
            code: "SUCCESS",
            details: { id },
          },
        ],
      };
    }

    throw new Error(`Unexpected Zoho request: ${method} ${path}`);
  }

  return {
    contacts,
    handler,
    getStats() {
      return { createCount, updateCount, searchCount };
    },
  };
}

async function testSameShopperIdSyncTwiceUsesCreateThenUpdate() {
  restoreEnv();
  setZohoConfigEnv();
  clearOptionalZohoFieldEnv();

  const { zoho, customerProfileZohoSync } = loadZohoModules();
  const harness = createZohoHarness();
  zoho.__setZohoRequestOverrideForTests(harness.handler);

  try {
    const first = await customerProfileZohoSync.syncCustomerProfileToZoho(buildProfile());
    const second = await customerProfileZohoSync.syncCustomerProfileToZoho(
      buildProfile({ leadStage: "follow_up" })
    );

    const stats = harness.getStats();
    assert.strictEqual(first.ok, true, "first sync should succeed");
    assert.strictEqual(first.operation, "create", "first sync should create");
    assert.strictEqual(second.ok, true, "second sync should succeed");
    assert.strictEqual(second.operation, "update", "second sync should update");
    assert.strictEqual(stats.createCount, 1, "same shopper should only create once");
    assert.strictEqual(stats.updateCount, 1, "second sync should update existing contact");
  } finally {
    zoho.__setZohoRequestOverrideForTests(null);
  }
}

async function testMissingZohoConfigReturnsSkip() {
  restoreEnv();
  clearOptionalZohoFieldEnv();

  const { customerProfileZohoSync } = loadZohoModules();
  const result = await customerProfileZohoSync.syncCustomerProfileToZoho(buildProfile());

  assert.deepStrictEqual(
    {
      ok: result.ok,
      skipped: result.skipped,
      reason: result.reason,
    },
    {
      ok: false,
      skipped: true,
      reason: "ZOHO_NOT_CONFIGURED",
    },
    "missing Zoho config should skip cleanly"
  );
}

async function testMultipleExistingContactsUpdatesFirstAndLogsDuplicate() {
  restoreEnv();
  setZohoConfigEnv();
  clearOptionalZohoFieldEnv();

  const captured = [];
  console.log = function patchedConsoleLog(...args) {
    captured.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    originalConsoleLog(...args);
  };

  const { zoho, customerProfileZohoSync } = loadZohoModules();
  const harness = createZohoHarness({
    initialContacts: [
      { id: "contact-1", Snoozer_Shopper_ID: "shopper-zoho-1", Last_Name: "First" },
      { id: "contact-2", Snoozer_Shopper_ID: "shopper-zoho-1", Last_Name: "Second" },
    ],
  });
  zoho.__setZohoRequestOverrideForTests(harness.handler);

  try {
    const result = await customerProfileZohoSync.syncCustomerProfileToZoho(buildProfile());
    const stats = harness.getStats();

    assert.strictEqual(result.ok, true, "duplicate lookup should still return a safe success");
    assert.strictEqual(result.operation, "update", "duplicate lookup should update first match");
    assert.strictEqual(result.duplicateDetected, true, "duplicate metadata should be exposed");
    assert.strictEqual(stats.createCount, 0, "duplicate lookup must not create another contact");
    assert.strictEqual(stats.updateCount, 1, "duplicate lookup should update one existing contact");
    assert(
      captured.some((line) => line.includes("\"source\":\"zoho.contact.duplicate_detected\"")),
      "duplicate lookup should emit duplicate_detected log"
    );
  } finally {
    zoho.__setZohoRequestOverrideForTests(null);
    console.log = originalConsoleLog;
  }
}

async function testProfileMapperOmitsUnconfiguredOptionalFields() {
  restoreEnv();
  setZohoConfigEnv();
  clearOptionalZohoFieldEnv();

  const { customerProfileZohoSync } = loadZohoModules();
  const fields = customerProfileZohoSync.buildCustomerProfileZohoFields(buildProfile());

  assert.strictEqual(fields.Snoozer_Shopper_ID, "shopper-zoho-1", "canonical shopper key should be present");
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(fields, "Top_Pod_Id__c"),
    false,
    "unconfigured optional recommendation fields should be omitted"
  );
}

async function testProfileMapperIncludesConfiguredOptionalFields() {
  restoreEnv();
  setZohoConfigEnv();
  process.env.ZOHO_FIELD_TOP_POD_ID = "Top_Pod_Id__c";
  process.env.ZOHO_FIELD_TOP_POD_IDS = "Top_Pod_Ids__c";
  process.env.ZOHO_FIELD_PRIMARY_MATTRESS_HANDLE = "Primary_Mattress_Handle__c";
  process.env.ZOHO_FIELD_BASE_HANDLE = "Base_Handle__c";
  process.env.ZOHO_FIELD_MOTION_KEY = "Motion_Key__c";
  process.env.ZOHO_FIELD_LEAD_STAGE = "Lead_Stage__c";
  process.env.ZOHO_FIELD_SOURCE_SURFACE = "Source_Surface__c";
  process.env.ZOHO_FIELD_LAST_INTENT = "Last_Intent__c";
  process.env.ZOHO_FIELD_LAST_INTERACTION_AT = "Last_Interaction_At__c";

  const { customerProfileZohoSync } = loadZohoModules();
  const fields = customerProfileZohoSync.buildCustomerProfileZohoFields(
    buildProfile({ baseHandle: "platform-base" })
  );

  assert.strictEqual(fields.Top_Pod_Id__c, "4", "configured top pod field should be included");
  assert.strictEqual(fields.Top_Pod_Ids__c, "4,2", "configured top pod ids field should be included");
  assert.strictEqual(
    fields.Primary_Mattress_Handle__c,
    "12-all-foam-mattress",
    "configured mattress handle field should be included"
  );
  assert.strictEqual(fields.Base_Handle__c, "platform-base", "configured base field should be included");
  assert.strictEqual(fields.Motion_Key__c, "no_motion", "configured motion key should be included");
  assert.strictEqual(
    fields.Lead_Stage__c,
    "assessment_completed",
    "configured lead stage field should be included"
  );
  assert.strictEqual(fields.Source_Surface__c, "assessment_api", "configured source surface field should be included");
  assert.strictEqual(
    fields.Last_Intent__c,
    "assessment_submit",
    "configured last intent field should be included"
  );
  assert.strictEqual(
    fields.Last_Interaction_At__c,
    "2026-06-10T00:00:00.000Z",
    "configured last interaction field should be included"
  );
}

async function testAssessmentRemainsStableIfZohoSyncFails() {
  restoreEnv();
  setZohoConfigEnv();
  clearOptionalZohoFieldEnv();
  delete process.env.CUSTOMER_PROFILE_TABLE;

  const captured = [];
  console.log = function patchedConsoleLog(...args) {
    captured.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    originalConsoleLog(...args);
  };

  clearModule("../index");
  clearModule("../services/customerProfileZohoSync");
  const zohoSyncSvc = require("../services/customerProfileZohoSync");
  const originalSync = zohoSyncSvc.syncCustomerProfileToZoho;
  zohoSyncSvc.syncCustomerProfileToZoho = async function failingSync() {
    throw new Error("ZOHO_SYNC_TEST_FAILURE");
  };

  try {
    const { lambdaHandler } = require("../index");
    const response = await lambdaHandler({
      version: "2.0",
      routeKey: "POST /assessment",
      rawPath: "/assessment",
      headers: {
        "content-type": "application/json",
        host: "local.assessment.test",
      },
      requestContext: {
        http: { method: "POST", path: "/assessment" },
        requestId: `assessment-${Date.now()}`,
        routeKey: "POST /assessment",
        stage: "local",
        timeEpoch: Date.now(),
      },
      body: JSON.stringify({
        shopperId: "assessment-zoho-failure",
        origin: "assessment_api",
        answers: {
          size: "Queen",
          motionMode: "No Motion",
          firmness: "Soft",
          sleepPosition: "Side",
          sleepPartner: "No",
          baseType: "No Base",
        },
      }),
      isBase64Encoded: false,
    });

    const body = JSON.parse(response.body);
    assert.strictEqual(response.statusCode, 200, "assessment should stay 200 if Zoho sync throws");
    assert.strictEqual(body.ok, true, "assessment body should stay successful");
    assert(
      captured.some((line) => line.includes("\"src\":\"assessment.zoho.error\"")),
      "assessment should log Zoho sync failures"
    );
  } finally {
    zohoSyncSvc.syncCustomerProfileToZoho = originalSync;
    clearModule("../index");
    console.log = originalConsoleLog;
  }
}

async function main() {
  const tests = [
    ["same_shopper_sync_twice_uses_create_then_update", testSameShopperIdSyncTwiceUsesCreateThenUpdate],
    ["missing_zoho_config_returns_skip", testMissingZohoConfigReturnsSkip],
    ["multiple_existing_contacts_updates_first_and_logs_duplicate", testMultipleExistingContactsUpdatesFirstAndLogsDuplicate],
    ["profile_mapper_omits_unconfigured_optional_fields", testProfileMapperOmitsUnconfiguredOptionalFields],
    ["profile_mapper_includes_configured_optional_fields", testProfileMapperIncludesConfiguredOptionalFields],
    ["assessment_remains_stable_if_zoho_sync_fails", testAssessmentRemainsStableIfZohoSyncFails],
  ];

  const failures = [];

  try {
    for (const [name, testFn] of tests) {
      try {
        await testFn();
        console.log(`PASS ${name}`);
      } catch (error) {
        failures.push({ name, message: error.message });
        console.error(`FAIL ${name}: ${error.message}`);
      } finally {
        restoreEnv();
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
      }
    }
  } finally {
    restoreEnv();
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s) detected.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${tests.length} customer profile Zoho sync tests passed.`);
}

main().catch((error) => {
  restoreEnv();
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.error(error);
  process.exit(1);
});
