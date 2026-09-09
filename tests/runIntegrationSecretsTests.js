#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ENV_KEYS = [
  "INTEGRATION_SECRET_TTL_MS",
  "OPENAI_API_KEY",
  "OPENAI_SECRET_ID",
  "SHOPIFY_DOMAIN",
  "SHOPIFY_STOREFRONT_TOKEN",
  "SHOPIFY_ADMIN_TOKEN",
  "SHOPIFY_SECRET_ID",
  "ZCRM_CLIENT_ID",
  "ZCRM_CLIENT_SECRET",
  "ZCRM_REFRESH_TOKEN",
  "ZCRM_OAUTH_DOMAIN",
  "ZCRM_API_DOMAIN",
  "ZOHO_CRM_BASE",
  "ZOHO_SECRET_ID",
];

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalLog = console.log;
const originalError = console.error;

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function generatedCredential(label) {
  return Buffer.from(`integration-test:${label}:${process.pid}`).toString("base64url");
}

function buildBundles() {
  return {
    openai: { OPENAI_API_KEY: generatedCredential("openai") },
    shopify: {
      SHOPIFY_STOREFRONT_TOKEN: generatedCredential("shopify-storefront"),
      SHOPIFY_ADMIN_TOKEN: generatedCredential("shopify-admin"),
    },
    zoho: {
      ZCRM_CLIENT_ID: generatedCredential("zoho-client"),
      ZCRM_CLIENT_SECRET: generatedCredential("zoho-secret"),
      ZCRM_REFRESH_TOKEN: generatedCredential("zoho-refresh"),
    },
  };
}

function configureSecretPointers() {
  process.env.OPENAI_SECRET_ID = "mysnoozepod/prod/snoozer/openai";
  process.env.SHOPIFY_SECRET_ID = "mysnoozepod/prod/snoozer/shopify";
  process.env.ZOHO_SECRET_ID = "mysnoozepod/prod/snoozer/zoho";
  delete process.env.OPENAI_API_KEY;
  delete process.env.SHOPIFY_STOREFRONT_TOKEN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
  delete process.env.ZCRM_CLIENT_ID;
  delete process.env.ZCRM_CLIENT_SECRET;
  delete process.env.ZCRM_REFRESH_TOKEN;
}

function createClient(bundles, { delayMs = 0, fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command.input.SecretId);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (fail) {
        const error = new Error("simulated retrieval failure");
        error.name = "ResourceNotFoundException";
        throw error;
      }
      const integration = command.input.SecretId.split("/").pop();
      return { SecretString: JSON.stringify(bundles[integration]) };
    },
  };
}

async function testBundleResolutionAndWarmCache() {
  configureSecretPointers();
  const bundles = buildBundles();
  const loader = require("../services/integrationSecrets");
  const client = createClient(bundles);
  loader._setSecretsClientForTests(client);

  assert.deepStrictEqual(await loader.getIntegrationCredentials("openai"), bundles.openai);
  assert.deepStrictEqual(await loader.getIntegrationCredentials("shopify"), bundles.shopify);
  assert.deepStrictEqual(await loader.getIntegrationCredentials("zoho"), bundles.zoho);
  await loader.getIntegrationCredentials("openai");
  assert.strictEqual(client.calls.length, 3, "warm cache should avoid a second OpenAI fetch");
}

async function testConcurrentSingleFlight() {
  configureSecretPointers();
  const bundles = buildBundles();
  const loader = require("../services/integrationSecrets");
  const client = createClient(bundles, { delayMs: 15 });
  loader._setSecretsClientForTests(client);

  const [first, second, third] = await Promise.all([
    loader.getIntegrationCredentials("shopify"),
    loader.getIntegrationCredentials("shopify"),
    loader.getIntegrationCredentials("shopify"),
  ]);
  assert.deepStrictEqual(first, bundles.shopify);
  assert.deepStrictEqual(second, bundles.shopify);
  assert.deepStrictEqual(third, bundles.shopify);
  assert.strictEqual(client.calls.length, 1, "concurrent cold fetches must share one request");
}

async function testTtlRefresh() {
  configureSecretPointers();
  process.env.INTEGRATION_SECRET_TTL_MS = "1000";
  const loader = require("../services/integrationSecrets");
  let clock = 10_000;
  let version = 0;
  const client = {
    calls: 0,
    async send() {
      this.calls += 1;
      version += 1;
      return {
        SecretString: JSON.stringify({
          OPENAI_API_KEY: generatedCredential(`openai-v${version}`),
        }),
      };
    },
  };
  loader._setSecretsClientForTests(client);
  loader._setNowForTests(() => clock);

  const first = await loader.getIntegrationCredentials("openai");
  clock += 999;
  const cached = await loader.getIntegrationCredentials("openai");
  assert.deepStrictEqual(cached, first);
  assert.strictEqual(client.calls, 1);
  clock += 2;
  const refreshed = await loader.getIntegrationCredentials("openai");
  assert.notStrictEqual(refreshed.OPENAI_API_KEY, first.OPENAI_API_KEY);
  assert.strictEqual(client.calls, 2);
}

async function testSecretsNeverReachLogsAndLoadingIsLazy() {
  configureSecretPointers();
  const bundles = buildBundles();
  const loader = require("../services/integrationSecrets");
  const client = createClient(bundles);
  loader._setSecretsClientForTests(client);
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => logs.push(args.join(" "));

  const { classifyAskSnoozerIntent } = require("../services/askSnoozerIntents");
  const deterministic = classifyAskSnoozerIntent("Which SnoozePod should I try first?");
  assert.strictEqual(deterministic.intent_group, "recommendation");
  assert.strictEqual(client.calls.length, 0, "deterministic classification must not fetch secrets");

  await loader.getIntegrationCredentials("openai");
  const output = logs.join("\n");
  for (const bundle of Object.values(bundles)) {
    for (const value of Object.values(bundle)) assert(!output.includes(value));
  }
  console.log = originalLog;
  console.error = originalError;
}

async function testMissingShopifySecretFailsClosed() {
  configureSecretPointers();
  process.env.SHOPIFY_DOMAIN = "shop.example.test";
  const loader = require("../services/integrationSecrets");
  loader._setSecretsClientForTests(createClient({}, { fail: true }));
  clearModule("../services/shopify");
  const shopify = require("../services/shopify");
  await assert.rejects(
    () => shopify.fetchProductsByHandles({ handles: ["12-all-foam-mattress"] }),
    (error) => error?.code === "INTEGRATION_SECRET_UNAVAILABLE"
  );
}

async function testMissingZohoSecretIsNonThrowingForProfileSync() {
  configureSecretPointers();
  process.env.ZCRM_OAUTH_DOMAIN = "https://accounts.example.test";
  process.env.ZCRM_API_DOMAIN = "https://api.example.test";
  const loader = require("../services/integrationSecrets");
  loader._setSecretsClientForTests(createClient({}, { fail: true }));
  clearModule("../services/zohoauth");
  clearModule("../services/zoho");
  clearModule("../services/customerProfileZohoSync");
  const sync = require("../services/customerProfileZohoSync");
  const result = await sync.syncCustomerProfileToZoho(
    { shopperId: "secret-test-shopper", email: "shopper@example.test" },
    { force: true }
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.skipped, true);
}

function testNonSecretConfigAndNoCredentialLiterals() {
  configureSecretPointers();
  process.env.ZCRM_OAUTH_DOMAIN = "https://accounts.example.test";
  process.env.ZCRM_API_DOMAIN = "https://api.example.test";
  clearModule("../services/zohoauth");
  const zohoauth = require("../services/zohoauth");
  const status = zohoauth.getZohoConfigStatus();
  assert.strictEqual(status.enabled, true);
  assert.strictEqual(status.credentialSource, "secrets_manager");
  assert.strictEqual(status.config.oauthDomain, process.env.ZCRM_OAUTH_DOMAIN);
  assert.strictEqual(status.config.apiDomain, process.env.ZCRM_API_DOMAIN);

  const files = [
    "services/integrationSecrets.js",
    "services/openai.js",
    "services/shopify.js",
    "services/zohoauth.js",
    "tests/runIntegrationSecretsTests.js",
  ];
  const credentialPattern = /(?:sk-(?:proj-)?|shpat_|1000\.)[A-Za-z0-9_.-]{20,}/;
  for (const file of files) {
    const contents = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert(!credentialPattern.test(contents), `${file} must not contain a credential literal`);
  }
}

const tests = [
  ["secret_bundles_resolve_and_cache", testBundleResolutionAndWarmCache],
  ["concurrent_fetches_are_single_flight", testConcurrentSingleFlight],
  ["ttl_expiry_refreshes_secret", testTtlRefresh],
  ["secret_values_are_not_logged_and_loading_is_lazy", testSecretsNeverReachLogsAndLoadingIsLazy],
  ["missing_shopify_secret_fails_closed", testMissingShopifySecretFailsClosed],
  ["missing_zoho_secret_does_not_throw_from_profile_sync", testMissingZohoSecretIsNonThrowingForProfileSync],
  ["non_secret_config_remains_and_no_credentials_are_committed", testNonSecretConfigAndNoCredentialLiterals],
];

async function main() {
  const failures = [];
  for (const [name, test] of tests) {
    try {
      await test();
      originalLog(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, error });
      originalLog(`FAIL ${name}: ${error.stack || error.message}`);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  }
  restoreEnv();
  if (failures.length) process.exitCode = 1;
  else originalLog(`All ${tests.length} integration secret tests passed.`);
}

main().catch((error) => {
  restoreEnv();
  console.log = originalLog;
  console.error = originalError;
  originalLog(error.stack || error.message);
  process.exitCode = 1;
});
