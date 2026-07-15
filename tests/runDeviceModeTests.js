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
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
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
  const guards = await importDeviceModule("deviceActionGuards.js");
  const podRoutes = await importDeviceModule("podRouteUtils.js");
  const routeOwnership = await importDeviceModule("deviceRouteOwnership.js");
  const resetPolicies = await importDeviceModule("resetPolicies.js");
  const activityTracker = await importDeviceModule("deviceActivityTracker.js");

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
  assert.equal(guards.canViewCart(podResolution), true);
  assert.equal(guards.canMutateCart(podResolution), true);
  assert.equal(guards.canInitiateCheckout(podResolution), false);
  assert.equal(guards.canOpenCheckoutUrl(podResolution), false);
  assert.equal(guards.canViewFinancing(podResolution), false);
  assert.equal(guards.canViewPodNavigation(podResolution, "/pod/pod-3"), true);
  assert.equal(guards.canViewPodNavigation(podResolution, "/pod/pod-4"), false);
  assert.equal(guards.canUseAskSnoozer(podResolution), true);
  assert.equal(guards.canViewAdminDiagnostics(podResolution), false);
  assert.equal(guards.shouldShowCheckoutLoungeHandoff(podResolution), true);
  assert.deepEqual(
    guards.getCheckoutRouteFallback(podResolution, "/checkout/guest"),
    {
      to: "/cart",
      state: {
        checkoutBlocked: true,
        checkoutHandoff: true,
        attemptedPath: "/checkout/guest",
        deviceId: "pod-3-ipad-01",
        deviceMode: modes.DEVICE_MODES.POD_IPAD,
        message: guards.CHECKOUT_LOUNGE_MESSAGE,
      },
      allow: false,
    }
  );

  const devFallback = registry.resolveDeviceConfig({
    environment: "development",
    storage: createMemoryStorage(),
  });
  assert.equal(devFallback.status, modes.DEVICE_STATUSES.READY);
  assert.equal(devFallback.deviceMode, modes.DEVICE_MODES.ADMIN_DEV);
  assert.equal(devFallback.configSource, modes.CONFIG_SOURCES.DEVELOPMENT_FALLBACK);
  assert.equal(guards.canViewCart(devFallback), true);
  assert.equal(guards.canInitiateCheckout(devFallback), true);
  assert.equal(guards.canOpenCheckoutUrl(devFallback), true);
  assert.equal(guards.canViewFinancing(devFallback), true);
  assert.equal(guards.canViewAdminDiagnostics(devFallback), true);

  const productionMissing = registry.resolveDeviceConfig({
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.equal(productionMissing.status, modes.DEVICE_STATUSES.UNKNOWN);
  assert.equal(productionMissing.isAdminDev, false);
  assert.equal(guards.canViewCart(productionMissing), false);
  assert.equal(guards.canInitiateCheckout(productionMissing), false);

  const productionUnknown = registry.resolveDeviceConfig({
    deviceId: "mystery-device",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.equal(productionUnknown.status, modes.DEVICE_STATUSES.UNKNOWN);
  assert.equal(productionUnknown.isKnownDevice, false);
  assert.equal(guards.canViewCart(productionUnknown), false);
  assert.equal(guards.canInitiateCheckout(productionUnknown), false);

  const checkoutDevice = registry.resolveDeviceConfig({
    deviceId: "checkout-01",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.equal(checkoutDevice.status, modes.DEVICE_STATUSES.READY);
  assert.equal(checkoutDevice.deviceMode, modes.DEVICE_MODES.CHECKOUT_KIOSK);
  assert.equal(guards.canViewCart(checkoutDevice), true);
  assert.equal(guards.canMutateCart(checkoutDevice), true);
  assert.equal(guards.canInitiateCheckout(checkoutDevice), true);
  assert.equal(guards.canOpenCheckoutUrl(checkoutDevice), true);
  assert.equal(guards.canViewFinancing(checkoutDevice), true);
  assert.equal(guards.canViewPodNavigation(checkoutDevice), false);
  assert.equal(guards.canUseAskSnoozer(checkoutDevice), false);
  assert.equal(guards.canViewAdminDiagnostics(checkoutDevice), false);
  assert.equal(guards.getCheckoutRouteFallback(checkoutDevice, "/checkout/guest").allow, true);
  assert.equal(guards.getCheckoutRouteFallback(checkoutDevice, "/checkout/abc").allow, true);

  const sleepDevice = registry.resolveDeviceConfig({
    deviceId: "sleep-essentials-01",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.equal(sleepDevice.status, modes.DEVICE_STATUSES.READY);
  assert.equal(sleepDevice.deviceMode, modes.DEVICE_MODES.SLEEP_ESSENTIALS_KIOSK);
  assert.equal(guards.canViewCart(sleepDevice), true);
  assert.equal(guards.canMutateCart(sleepDevice), true);
  assert.equal(guards.canInitiateCheckout(sleepDevice), false);
  assert.equal(guards.canViewFinancing(sleepDevice), false);
  assert.equal(guards.shouldShowCheckoutLoungeHandoff(sleepDevice), true);
  assert.equal(guards.getCheckoutRouteFallback(sleepDevice, "/checkout/guest").to, "/cart");

  const askDevice = registry.resolveDeviceConfig({
    deviceId: "ask-snoozer-01",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.equal(askDevice.status, modes.DEVICE_STATUSES.READY);
  assert.equal(askDevice.deviceMode, modes.DEVICE_MODES.ASK_SNOOZER_KIOSK);
  assert.equal(guards.canViewCart(askDevice), false);
  assert.equal(guards.canMutateCart(askDevice), false);
  assert.equal(guards.canInitiateCheckout(askDevice), false);
  assert.equal(guards.canViewFinancing(askDevice), false);
  assert.equal(guards.canUseAskSnoozer(askDevice), true);
  assert.equal(guards.getCartRouteFallback(askDevice, "/cart").to, "/ask-snoozer");
  assert.equal(guards.getCheckoutRouteFallback(askDevice, "/checkout/guest").to, "/ask-snoozer");

  const welcomeDevice = registry.resolveDeviceConfig({
    deviceId: "welcome-01",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.equal(welcomeDevice.status, modes.DEVICE_STATUSES.READY);
  assert.equal(welcomeDevice.deviceMode, modes.DEVICE_MODES.WELCOME_KIOSK);
  assert.equal(guards.canViewCart(welcomeDevice), false);
  assert.equal(guards.canMutateCart(welcomeDevice), false);
  assert.equal(guards.canInitiateCheckout(welcomeDevice), false);
  assert.equal(guards.canViewFinancing(welcomeDevice), false);
  assert.equal(guards.canUseAskSnoozer(welcomeDevice), false);
  assert.equal(guards.getCartRouteFallback(welcomeDevice, "/cart").to, "/welcome");
  assert.equal(guards.getCheckoutRouteFallback(welcomeDevice, "/checkout/guest").to, "/welcome");

  const redirectStorage = createMemoryStorage();
  redirectStorage.setItem("snooze.cartId", "cart-123");
  redirectStorage.setItem("snooze.checkoutUrl", "https://checkout.example/test");
  redirectStorage.setItem("snoozer_snooze_code", "589424");
  guards.getCheckoutRouteFallback(podResolution, "/checkout/guest");
  assert.equal(redirectStorage.getItem("snooze.cartId"), "cart-123");
  assert.equal(redirectStorage.getItem("snooze.checkoutUrl"), "https://checkout.example/test");
  assert.equal(redirectStorage.getItem("snoozer_snooze_code"), "589424");

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

  assert.equal(podRoutes.normalizePodId("1"), "pod-1");
  assert.equal(podRoutes.normalizePodId("pod-1"), "pod-1");
  assert.equal(podRoutes.normalizePodId("pod-9"), null);
  assert.equal(podRoutes.makePodRoute("1"), "/pod/pod-1");
  assert.equal(podRoutes.makePodRoute("pod-5"), "/pod/pod-5");
  assert.equal(podRoutes.getRoutePodId("/pod/1?source=test"), "pod-1");
  assert.equal(podRoutes.getRoutePodId("/pod/pod-4"), "pod-4");
  assert.equal(podRoutes.isCanonicalPodRoute("/pod/pod-4"), true);
  assert.equal(podRoutes.isCanonicalPodRoute("/pod/4"), false);
  assert.equal(podRoutes.routeMatchesBoundPod("/pod/pod-3", "3"), true);

  const pod1 = registry.resolveDeviceConfig({
    deviceId: "pod-1-ipad-01",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.equal(routeOwnership.getDeviceRouteDecision(pod1, "/pod/pod-1").allow, true);
  assert.equal(
    routeOwnership.getDeviceRouteDecision(pod1, "/pod/pod-2").redirectTo,
    "/pod/pod-1"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(pod1, "/pod/1").redirectTo,
    "/pod/pod-1"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(pod1, "/pod/not-real").redirectTo,
    "/pod/pod-1"
  );
  assert.equal(routeOwnership.getDeviceRouteDecision(pod1, "/ask-snoozer").allow, true);
  assert.equal(routeOwnership.getDeviceRouteDecision(pod1, "/cart").allow, true);
  assert.equal(
    routeOwnership.getDeviceRouteDecision(pod1, "/checkout/guest").redirectTo,
    "/cart"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(pod1, "/welcome").redirectTo,
    "/pod/pod-1"
  );

  const pod1MissingBinding = {
    ...pod1,
    podId: null,
  };
  assert.equal(
    routeOwnership.getDeviceRouteDecision(pod1MissingBinding, "/pod/pod-1").unavailableKind,
    "missing_pod_binding"
  );

  assert.equal(
    routeOwnership.getDeviceRouteDecision(welcomeDevice, "/pod/pod-1").redirectTo,
    "/welcome"
  );
  assert.equal(routeOwnership.getDeviceRouteDecision(welcomeDevice, "/results").allow, true);
  assert.equal(
    routeOwnership.getDeviceRouteDecision(askDevice, "/pod/pod-1").redirectTo,
    "/ask-snoozer"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(askDevice, "/cart").redirectTo,
    "/ask-snoozer"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(askDevice, "/checkout/guest").redirectTo,
    "/ask-snoozer"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(askDevice, "/financing").redirectTo,
    "/ask-snoozer"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(askDevice, "/results").redirectTo,
    "/ask-snoozer"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(checkoutDevice, "/pod/pod-1").redirectTo,
    "/cart"
  );
  assert.equal(routeOwnership.getDeviceRouteDecision(checkoutDevice, "/cart").allow, true);
  assert.equal(routeOwnership.getDeviceRouteDecision(checkoutDevice, "/checkout/guest").allow, true);
  assert.equal(routeOwnership.getDeviceRouteDecision(checkoutDevice, "/financing").allow, true);
  assert.equal(
    routeOwnership.getDeviceRouteDecision(pod1, "/financing").redirectTo,
    "/pod/pod-1"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(sleepDevice, "/sleep-essentials").unavailableKind,
    "future_route_not_implemented"
  );
  assert.equal(routeOwnership.getDeviceRouteDecision(sleepDevice, "/cart").allow, true);
  assert.equal(
    routeOwnership.getDeviceRouteDecision(productionUnknown, "/welcome").unavailableKind,
    "unknown_device"
  );
  const disabledWelcome = {
    ...welcomeDevice,
    status: modes.DEVICE_STATUSES.DISABLED,
  };
  assert.equal(
    routeOwnership.getDeviceRouteDecision(disabledWelcome, "/welcome").unavailableKind,
    "disabled_device"
  );
  assert.equal(routeOwnership.getDeviceRouteDecision(devFallback, "/products/test").allow, true);
  assert.equal(
    routeOwnership.getDeviceRouteDecision(devFallback, "/pod/1").redirectTo,
    "/pod/pod-1"
  );

  const routeRedirectStorage = createMemoryStorage();
  routeRedirectStorage.setItem("snooze.cartId", "cart-456");
  routeRedirectStorage.setItem("snooze.checkoutUrl", "https://checkout.example/keep");
  routeRedirectStorage.setItem("snoozer_snooze_code", "589424");
  routeOwnership.getDeviceRouteDecision(pod1, "/pod/pod-2");
  assert.equal(routeRedirectStorage.getItem("snooze.cartId"), "cart-456");
  assert.equal(routeRedirectStorage.getItem("snooze.checkoutUrl"), "https://checkout.example/keep");
  assert.equal(routeRedirectStorage.getItem("snoozer_snooze_code"), "589424");

  const pod3 = registry.resolveDeviceConfig({
    deviceId: "pod-3-ipad-01",
    environment: "production",
    storage: createMemoryStorage(),
  });
  assert.equal(
    routeOwnership.getDeviceRouteDecision(pod3, "/explore").redirectTo,
    "/pod/pod-3"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(pod3, "/shop-with-snoozer").redirectTo,
    "/pod/pod-3"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(pod3, "/ask-snoozer/explore").redirectTo,
    "/pod/pod-3"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(welcomeDevice, "/products/14-hybrid").redirectTo,
    "/welcome"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(welcomeDevice, "/faqs").redirectTo,
    "/welcome"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(welcomeDevice, "/financing").redirectTo,
    "/welcome"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(welcomeDevice, "/snoozepod").redirectTo,
    "/welcome"
  );
  assert.equal(
    routeOwnership.getDeviceRouteDecision(welcomeDevice, "/explore-dev").redirectTo,
    "/welcome"
  );

  const mixedActions = [
    { type: "checkout", label: "Checkout" },
    { type: "navigate", target: "/cart", label: "Cart" },
    { type: "navigate", target: "/financing", label: "Financing" },
    { type: "start_assessment", label: "Start assessment" },
    { type: "navigate", target: "/pod/pod-1", label: "SnoozePod 1" },
    { type: "request_human", label: "Talk to Human" },
  ];

  assert.deepEqual(
    guards.filterDeviceActions(welcomeDevice, mixedActions).map((action) => action.label),
    ["Start assessment", "Talk to Human"]
  );
  assert.deepEqual(
    guards.filterDeviceActions(pod1, mixedActions).map((action) => action.label),
    ["Cart", "SnoozePod 1", "Talk to Human"]
  );
  assert.deepEqual(
    guards.filterDeviceActions(askDevice, mixedActions).map((action) => action.label),
    ["Talk to Human"]
  );
  assert.deepEqual(
    guards.filterDeviceActions(checkoutDevice, mixedActions).map((action) => action.label),
    ["Checkout", "Cart", "Financing", "Talk to Human"]
  );

  const welcomePolicy = resetPolicies.getDeviceResetPolicy(welcomeDevice);
  const podPolicy = resetPolicies.getDeviceResetPolicy(pod1);
  const askPolicy = resetPolicies.getDeviceResetPolicy(askDevice);
  const sleepPolicy = resetPolicies.getDeviceResetPolicy(sleepDevice);
  const checkoutPolicy = resetPolicies.getDeviceResetPolicy(checkoutDevice);

  assert.equal(welcomePolicy.timeoutMs, 5 * 60 * 1000);
  assert.equal(podPolicy.timeoutMs, 15 * 60 * 1000);
  assert.equal(askPolicy.timeoutMs, 5 * 60 * 1000);
  assert.equal(sleepPolicy.timeoutMs, 8 * 60 * 1000);
  assert.equal(checkoutPolicy.warningMs, 15 * 60 * 1000);
  assert.equal(checkoutPolicy.abandonmentMs, 30 * 60 * 1000);

  assert.equal(
    resetPolicies.getDeviceResetSchedule({
      policy: welcomePolicy,
      lastActivityAt: 0,
      now: 5 * 60 * 1000,
    }).status,
    resetPolicies.DEVICE_RESET_STATUSES.PENDING
  );
  assert.equal(
    resetPolicies.getDeviceResetSchedule({
      policy: podPolicy,
      lastActivityAt: 0,
      now: 15 * 60 * 1000,
    }).status,
    resetPolicies.DEVICE_RESET_STATUSES.PENDING
  );
  assert.equal(
    resetPolicies.getDeviceResetSchedule({
      policy: askPolicy,
      lastActivityAt: 0,
      now: 5 * 60 * 1000,
    }).status,
    resetPolicies.DEVICE_RESET_STATUSES.PENDING
  );
  assert.equal(
    resetPolicies.getDeviceResetSchedule({
      policy: sleepPolicy,
      lastActivityAt: 0,
      now: 8 * 60 * 1000,
    }).status,
    resetPolicies.DEVICE_RESET_STATUSES.PENDING
  );

  const checkoutWarningSchedule = resetPolicies.getDeviceResetSchedule({
    policy: checkoutPolicy,
    lastActivityAt: 0,
    now: 15 * 60 * 1000,
  });
  assert.equal(checkoutWarningSchedule.status, resetPolicies.DEVICE_RESET_STATUSES.WARNING);
  const checkoutAbandonedSchedule = resetPolicies.getDeviceResetSchedule({
    policy: checkoutPolicy,
    lastActivityAt: 0,
    now: 30 * 60 * 1000,
  });
  assert.equal(checkoutAbandonedSchedule.status, resetPolicies.DEVICE_RESET_STATUSES.PENDING);
  assert.equal(
    resetPolicies.getDeviceResetSchedule({
      policy: podPolicy,
      lastActivityAt: 0,
      now: 15 * 60 * 1000,
      activeReasons: ["tts"],
    }).canReset,
    false
  );
  assert.equal(
    resetPolicies.getDeviceResetSchedule({
      policy: podPolicy,
      lastActivityAt: 0,
      now: 15 * 60 * 1000,
      activeReasons: ["cartMutation"],
    }).canReset,
    false
  );
  assert.equal(
    resetPolicies.getDeviceResetSchedule({
      policy: askPolicy,
      lastActivityAt: 0,
      now: 5 * 60 * 1000,
      activeReasons: ["activeResponse"],
    }).canReset,
    false
  );

  const preservationStorage = createMemoryStorage();
  preservationStorage.setItem("snooze.cartId", "cart-keep");
  preservationStorage.setItem("snooze.checkoutUrl", "https://checkout.example/keep");
  preservationStorage.setItem("snoozer_snooze_code", "589424");
  preservationStorage.setItem("snooze.shopperId", "589424");
  preservationStorage.setItem("snooze.assessment", JSON.stringify({ size: "Queen" }));
  preservationStorage.setItem("snooze.recommendations", JSON.stringify({ topPodId: "pod-4" }));
  preservationStorage.setItem("snooze.pod.pod-4.openStage", "build");
  preservationStorage.setItem("snooze.podBuilder.pod-4", JSON.stringify({ size: "King" }));
  preservationStorage.setItem("snooze.chatTranscript", JSON.stringify([{ role: "user" }]));

  const welcomeReset = resetPolicies.executeDeviceReset({
    device: welcomeDevice,
    policy: welcomePolicy,
    storage: preservationStorage,
    pathname: "/assessment",
  });
  assert.equal(welcomeReset.route, "/welcome");
  assert.equal(preservationStorage.getItem("snooze.assessment"), null);
  assert.equal(preservationStorage.getItem("snooze.cartId"), "cart-keep");
  assert.equal(preservationStorage.getItem("snooze.checkoutUrl"), "https://checkout.example/keep");
  assert.equal(preservationStorage.getItem("snoozer_snooze_code"), "589424");
  assert.equal(preservationStorage.getItem("snooze.shopperId"), "589424");

  const podReset = resetPolicies.executeDeviceReset({
    device: { ...pod1, podId: "pod-4", defaultRoute: "/pod/pod-4" },
    policy: podPolicy,
    storage: preservationStorage,
    pathname: "/pod/pod-4",
  });
  assert.equal(podReset.route, "/pod/pod-4");
  assert.equal(preservationStorage.getItem("snooze.pod.pod-4.openStage"), null);
  assert.equal(preservationStorage.getItem("snooze.podBuilder.pod-4"), null);
  assert.equal(preservationStorage.getItem("snooze.cartId"), "cart-keep");

  const askReset = resetPolicies.executeDeviceReset({
    device: askDevice,
    policy: askPolicy,
    storage: preservationStorage,
    pathname: "/ask-snoozer",
  });
  assert.equal(askReset.route, "/ask-snoozer");
  assert.equal(preservationStorage.getItem("snooze.chatTranscript"), null);

  const sleepReset = resetPolicies.executeDeviceReset({
    device: sleepDevice,
    policy: sleepPolicy,
    storage: preservationStorage,
    pathname: "/sleep-essentials",
  });
  assert.equal(sleepReset.route, "/sleep-essentials");

  const checkoutReset = resetPolicies.executeDeviceReset({
    device: checkoutDevice,
    policy: checkoutPolicy,
    storage: preservationStorage,
    pathname: "/checkout/guest",
  });
  assert.equal(checkoutReset.route, "/cart");
  assert.equal(checkoutReset.message, resetPolicies.CHECKOUT_ABANDONMENT_MESSAGE);
  assert.equal(preservationStorage.getItem("snooze.cartId"), "cart-keep");
  assert.equal(preservationStorage.getItem("snooze.checkoutUrl"), "https://checkout.example/keep");

  let fakeNow = 1000;
  const tracker = activityTracker.createDeviceActivityTracker({
    clock: () => fakeNow,
    target: null,
    eventTarget: null,
  });
  let lastSnapshot = tracker.getSnapshot();
  const unsubscribeTracker = tracker.subscribe((snapshot) => {
    lastSnapshot = snapshot;
  });
  fakeNow = 2500;
  tracker.record("touch");
  assert.equal(lastSnapshot.lastActivityAt, 2500);
  assert.equal(lastSnapshot.activeReason, "touch");
  tracker.setActiveReason("tts", true);
  assert.equal(lastSnapshot.isActive, true);
  assert.deepEqual(lastSnapshot.activeReasons, ["tts"]);
  fakeNow = 3200;
  tracker.setActiveReason("tts", false);
  assert.equal(lastSnapshot.isActive, false);
  assert.equal(lastSnapshot.lastActivityAt, 3200);
  tracker.setActiveReason("cartMutation", true);
  assert.deepEqual(lastSnapshot.activeReasons, ["cartMutation"]);
  tracker.setActiveReason("cartMutation", false);
  unsubscribeTracker();

  console.log(
    JSON.stringify(
      {
        ok: true,
        checkedDevices: Object.keys(manifest).length,
        assertions: "expanded",
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
