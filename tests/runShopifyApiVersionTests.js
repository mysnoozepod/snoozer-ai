#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const configPath = path.resolve(__dirname, "../services/shopifyApiConfig.js");
const environmentNames = [
  "SHOPIFY_API_VERSION",
  "SHOPIFY_STOREFRONT_API_VERSION",
  "SHOPIFY_ADMIN_API_VERSION",
];
const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, process.env[name]])
);

function loadConfig(overrides = {}) {
  environmentNames.forEach((name) => delete process.env[name]);
  Object.entries(overrides).forEach(([name, value]) => {
    process.env[name] = value;
  });
  delete require.cache[require.resolve(configPath)];
  return require(configPath);
}

function restoreEnvironment() {
  environmentNames.forEach((name) => {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
  delete require.cache[require.resolve(configPath)];
}

function main() {
  try {
    const defaults = loadConfig({ SHOPIFY_API_VERSION: "2024-01" });
    assert.strictEqual(defaults.DEFAULT_SHOPIFY_API_VERSION, "2025-10");
    assert.strictEqual(defaults.SHOPIFY_STOREFRONT_API_VERSION, "2025-10");
    assert.strictEqual(defaults.SHOPIFY_ADMIN_API_VERSION, "2025-10");
    assert.strictEqual(
      defaults.buildStorefrontGraphqlEndpoint("mysnoozepodtest.myshopify.com"),
      "https://mysnoozepodtest.myshopify.com/api/2025-10/graphql.json"
    );
    assert.strictEqual(
      defaults.buildAdminApiBaseUrl("https://mysnoozepodtest.myshopify.com/"),
      "https://mysnoozepodtest.myshopify.com/admin/api/2025-10"
    );

    const separated = loadConfig({
      SHOPIFY_STOREFRONT_API_VERSION: "2026-01",
      SHOPIFY_ADMIN_API_VERSION: "2026-04",
    });
    assert.strictEqual(separated.SHOPIFY_STOREFRONT_API_VERSION, "2026-01");
    assert.strictEqual(separated.SHOPIFY_ADMIN_API_VERSION, "2026-04");

    assert.throws(
      () => loadConfig({ SHOPIFY_STOREFRONT_API_VERSION: "latest" }),
      (error) =>
        error?.code === "SHOPIFY_API_VERSION_INVALID" &&
        error?.environmentName === "SHOPIFY_STOREFRONT_API_VERSION"
    );

    const runtimeSource = fs.readFileSync(
      path.resolve(__dirname, "../services/shopify.js"),
      "utf8"
    );
    assert(!/process\.env\.SHOPIFY_API_VERSION\b/.test(runtimeSource));
    assert(!runtimeSource.includes('"2024-01"'));
    assert(runtimeSource.includes("buildStorefrontGraphqlEndpoint(domain)"));
    assert(runtimeSource.includes("buildAdminApiBaseUrl(SHOPIFY_DOMAIN)"));

    console.log("Shopify API version endpoint checks passed.");
  } finally {
    restoreEnvironment();
  }
}

main();
