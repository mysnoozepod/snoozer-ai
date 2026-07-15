const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEVICE_SRC_DIR = path.join(REPO_ROOT, "omnia-journey", "src", "device");
const TEST_MODULE_DIR = path.join(REPO_ROOT, "_out", "device-mode-test-modules");

function copyDeviceModulesForEsmImport() {
  fs.rmSync(TEST_MODULE_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_MODULE_DIR, { recursive: true });

  for (const entry of fs.readdirSync(DEVICE_SRC_DIR)) {
    const source = path.join(DEVICE_SRC_DIR, entry);
    const dest = path.join(TEST_MODULE_DIR, entry);
    if (fs.statSync(source).isFile()) fs.copyFileSync(source, dest);
  }

  fs.writeFileSync(
    path.join(TEST_MODULE_DIR, "package.json"),
    JSON.stringify({ type: "module" }, null, 2)
  );
}

async function importDeviceModule(fileName) {
  const url = pathToFileURL(path.join(TEST_MODULE_DIR, fileName)).href;
  return import(`${url}?t=${Date.now()}`);
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

async function run() {
  copyDeviceModulesForEsmImport();

  const modes = await importDeviceModule("deviceModes.js");
  const manifestModule = await importDeviceModule("deviceRegistry.manifest.js");
  const registry = await importDeviceModule("deviceRegistry.js");
  const cache = await importDeviceModule("deviceConfigCache.js");
  const routes = await importDeviceModule("deviceRoutePatterns.js");

  const manifest = manifestModule.DEVICE_REGISTRY_MANIFEST;

  assert.equal(Object.keys(manifest).length, 9, "locked manifest should contain nine devices");
  assert.equal(manifest["checkout-01"].checkoutAuthority, true);
  assert.equal(manifest["pod-3-ipad-01"].defaultRoute, "/pod/pod-3");
  assert.equal(manifest["sleep-essentials-01"].zoneId, "sleep-essentials-zone");

  for (const [deviceId, record] of Object.entries(manifest)) {
    const validation = registry.validateDeviceConfig(record);
    assert.equal(
      validation.valid,
      true,
      `${deviceId} should validate: ${validation.errors.join("; ")}`
    );
  }

  const podResolution = registry.resolveDeviceConfig({
    deviceId: "pod-3-ipad-01",
    environment: "development",
    storage: createMemoryStorage(),
  });
  assert.equal(podResolution.status, modes.DEVICE_STATUSES.READY);
  assert.equal(podResolution.deviceMode, modes.DEVICE_MODES.POD_IPAD);
  assert.equal(podResolution.podId, "pod-3");
  assert.equal(podResolution.configSource, modes.CONFIG_SOURCES.MANIFEST);
  assert.equal(podResolution.checkoutAuthority, false);

  const devFallback = registry.resolveDeviceConfig({
    environment: "development",
    storage: createMemoryStorage(),
  });
  assert.equal(devFallback.status, modes.DEVICE_STATUSES.READY);
  assert.equal(devFallback.deviceMode, modes.DEVICE_MODES.ADMIN_DEV);
  assert.equal(devFallback.configSource, modes.CONFIG_SOURCES.DEVELOPMENT_FALLBACK);

  const productionMissing = registry.resolveDeviceConfig({
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.equal(productionMissing.status, modes.DEVICE_STATUSES.UNKNOWN);
  assert.equal(productionMissing.isAdminDev, false);

  const productionUnknown = registry.resolveDeviceConfig({
    deviceId: "mystery-device",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.equal(productionUnknown.status, modes.DEVICE_STATUSES.UNKNOWN);
  assert.equal(productionUnknown.isKnownDevice, false);

  const badPod = {
    ...manifest["pod-3-ipad-01"],
    defaultRoute: "/pod/pod-4",
  };
  const badPodValidation = registry.validateDeviceConfig(badPod);
  assert.equal(badPodValidation.valid, false);
  assert.match(badPodValidation.errors.join(" "), /defaultRoute/);

  const fakeCheckoutAuthority = {
    ...manifest["pod-3-ipad-01"],
    checkoutAuthority: true,
  };
  const fakeCheckoutValidation = registry.validateDeviceConfig(fakeCheckoutAuthority);
  assert.equal(fakeCheckoutValidation.valid, false);
  assert.match(fakeCheckoutValidation.errors.join(" "), /checkoutAuthority/);

  const checkoutWithoutAuthority = {
    ...manifest["checkout-01"],
    checkoutAuthority: false,
  };
  const checkoutValidation = registry.validateDeviceConfig(checkoutWithoutAuthority);
  assert.equal(checkoutValidation.valid, false);
  assert.match(checkoutValidation.errors.join(" "), /checkout-kiosk/);

  const storage = createMemoryStorage();
  const cachedResolution = registry.resolveDeviceConfig({
    deviceId: "welcome-01",
    environment: "development",
    storage,
  });
  assert.equal(cachedResolution.status, modes.DEVICE_STATUSES.READY);
  const cached = cache.readCachedDeviceConfig("welcome-01", { storage });
  assert.equal(cached.ok, true);
  assert.equal(cached.configuration.deviceId, "welcome-01");
  assert.equal(cached.entry.configVersion, 1);

  const invalidManifest = {
    ...manifest,
    "welcome-01": {
      ...manifest["welcome-01"],
      checkoutAuthority: true,
    },
  };
  const invalidResolution = registry.resolveDeviceConfig({
    deviceId: "welcome-01",
    environment: "development",
    manifest: invalidManifest,
    storage,
  });
  assert.equal(invalidResolution.status, modes.DEVICE_STATUSES.INVALID);
  const stillCached = cache.readCachedDeviceConfig("welcome-01", { storage });
  assert.equal(stillCached.ok, true);
  assert.equal(stillCached.configuration.checkoutAuthority, false);

  assert.equal(routes.matchesRoutePattern("/checkout/guest", "/checkout/*"), true);
  assert.equal(routes.matchesRoutePattern("/checkout/abc", "/checkout/:id"), true);
  assert.equal(routes.matchesRoutePattern("/pod/pod-3", "/pod/pod-3"), true);
  assert.equal(routes.matchesRoutePattern("/pod/pod-4", "/pod/pod-3"), false);
  assert.equal(routes.matchesRoutePattern("/pod/pod-3?from=test", "/pod/:podId"), true);
  assert.equal(routes.matchesAnyRoutePattern("/cart", ["/welcome", "/cart"]), true);

  console.log(
    JSON.stringify(
      {
        ok: true,
        checkedDevices: Object.keys(manifest).length,
        assertions: 34,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

