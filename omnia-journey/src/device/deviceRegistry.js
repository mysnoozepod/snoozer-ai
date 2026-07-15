import {
  CART_AUTHORITY_VALUES,
  CONFIG_SOURCES,
  DEVICE_MODES,
  DEVICE_STATUSES,
  isApprovedDeviceMode,
} from "./deviceModes.js";
import { DEVICE_REGISTRY_MANIFEST } from "./deviceRegistry.manifest.js";
import {
  readCachedDeviceConfig,
  writeDeviceConfigCache,
} from "./deviceConfigCache.js";

const CUSTOMER_MODES_WITHOUT_CHECKOUT = new Set([
  DEVICE_MODES.WELCOME_KIOSK,
  DEVICE_MODES.POD_IPAD,
  DEVICE_MODES.ASK_SNOOZER_KIOSK,
  DEVICE_MODES.SLEEP_ESSENTIALS_KIOSK,
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function cloneConfig(config) {
  if (!config) return null;
  return JSON.parse(JSON.stringify(config));
}

export function normalizeRuntimeEnvironment(value) {
  const env = String(value || "").trim().toLowerCase();
  if (!env) return "production";
  if (env === "dev") return "development";
  if (env === "prod") return "production";
  return env;
}

export function isDevelopmentEnvironment(environment, explicitDevFlag = false) {
  const env = normalizeRuntimeEnvironment(environment);
  return Boolean(explicitDevFlag || env === "development" || env === "test" || env === "local");
}

export function getExpectedPodRoute(podId) {
  return `/pod/${String(podId || "").trim()}`;
}

export function createAdminDevDeviceConfig(options = {}) {
  const environment = normalizeRuntimeEnvironment(options.environment || "development");

  return {
    deviceId: "admin-dev",
    deviceMode: DEVICE_MODES.ADMIN_DEV,
    env: environment,
    storeId: "local-development",
    zoneId: "admin-dev",
    podId: null,
    defaultRoute: "/welcome",
    allowedRoutePatterns: ["/*"],
    blockedRoutePatterns: [],
    enabled: true,
    configVersion: 1,
    checkoutAuthority: false,
    cartAuthority: "full",
    resetPolicy: {
      timeoutMs: null,
      disabled: true,
    },
  };
}

export function validateDeviceConfig(config) {
  const errors = [];

  if (!isPlainObject(config)) {
    return {
      valid: false,
      errors: ["Device config must be an object."],
    };
  }

  if (!isNonEmptyString(config.deviceId)) errors.push("deviceId is required.");
  if (!isNonEmptyString(config.deviceMode)) errors.push("deviceMode is required.");
  if (config.deviceMode && !isApprovedDeviceMode(config.deviceMode)) {
    errors.push(`deviceMode is not approved: ${config.deviceMode}`);
  }
  if (!isNonEmptyString(config.env)) errors.push("env is required.");
  if (!isNonEmptyString(config.storeId)) errors.push("storeId is required.");
  if (!isNonEmptyString(config.defaultRoute)) errors.push("defaultRoute is required.");
  if (!Array.isArray(config.allowedRoutePatterns)) {
    errors.push("allowedRoutePatterns must be an array.");
  }
  if (!Array.isArray(config.blockedRoutePatterns)) {
    errors.push("blockedRoutePatterns must be an array.");
  }
  if (typeof config.enabled !== "boolean") errors.push("enabled must be a boolean.");
  if (!Number.isFinite(Number(config.configVersion))) {
    errors.push("configVersion must be a number.");
  }
  if (typeof config.checkoutAuthority !== "boolean") {
    errors.push("checkoutAuthority must be a boolean.");
  }
  if (!CART_AUTHORITY_VALUES.includes(config.cartAuthority)) {
    errors.push(`cartAuthority must be one of: ${CART_AUTHORITY_VALUES.join(", ")}.`);
  }
  if (!isPlainObject(config.resetPolicy)) errors.push("resetPolicy must be an object.");

  if (config.checkoutAuthority === true && config.deviceId !== "checkout-01") {
    errors.push("Only checkout-01 may have checkoutAuthority=true.");
  }

  if (config.deviceMode === DEVICE_MODES.POD_IPAD) {
    if (!isNonEmptyString(config.podId)) errors.push("pod-ipad requires podId.");
    if (!isNonEmptyString(config.zoneId)) errors.push("pod-ipad requires zoneId.");
    if (config.podId && config.defaultRoute !== getExpectedPodRoute(config.podId)) {
      errors.push("pod-ipad defaultRoute must match its bound pod route.");
    }
  }

  if (config.deviceMode === DEVICE_MODES.SLEEP_ESSENTIALS_KIOSK) {
    if (config.zoneId !== "sleep-essentials-zone") {
      errors.push("sleep-essentials-kiosk requires zoneId=sleep-essentials-zone.");
    }
  }

  if (config.deviceMode === DEVICE_MODES.CHECKOUT_KIOSK && config.checkoutAuthority !== true) {
    errors.push("checkout-kiosk requires checkoutAuthority=true.");
  }

  if (CUSTOMER_MODES_WITHOUT_CHECKOUT.has(config.deviceMode) && config.checkoutAuthority !== false) {
    errors.push(`${config.deviceMode} requires checkoutAuthority=false.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function makeResolution({
  status,
  device,
  configSource,
  validationErrors = [],
  environment,
  isKnownDevice = false,
}) {
  const normalizedDevice = cloneConfig(device);
  const mode = normalizedDevice?.deviceMode || null;

  return {
    status,
    device: normalizedDevice,
    deviceId: normalizedDevice?.deviceId || null,
    deviceMode: mode,
    environment: normalizeRuntimeEnvironment(environment || normalizedDevice?.env),
    storeId: normalizedDevice?.storeId || null,
    zoneId: normalizedDevice?.zoneId || null,
    podId: normalizedDevice?.podId || null,
    defaultRoute: normalizedDevice?.defaultRoute || "/welcome",
    allowedRoutePatterns: Array.isArray(normalizedDevice?.allowedRoutePatterns)
      ? normalizedDevice.allowedRoutePatterns
      : [],
    blockedRoutePatterns: Array.isArray(normalizedDevice?.blockedRoutePatterns)
      ? normalizedDevice.blockedRoutePatterns
      : [],
    checkoutAuthority: Boolean(normalizedDevice?.checkoutAuthority),
    cartAuthority: normalizedDevice?.cartAuthority || "none",
    resetPolicy: normalizedDevice?.resetPolicy || {},
    configVersion: Number(normalizedDevice?.configVersion) || null,
    configSource,
    validationErrors,
    isAdminDev: mode === DEVICE_MODES.ADMIN_DEV,
    isKnownDevice,
  };
}

export function resolveDeviceConfig(options = {}) {
  const manifest = options.manifest || DEVICE_REGISTRY_MANIFEST;
  const environment = normalizeRuntimeEnvironment(options.environment);
  const isDev = isDevelopmentEnvironment(environment, options.isDevelopment);
  const deviceId = String(options.deviceId || "").trim();
  const viteDeviceMode = String(options.viteDeviceMode || "").trim();

  if (!deviceId) {
    if (isDev && (!viteDeviceMode || viteDeviceMode === DEVICE_MODES.ADMIN_DEV)) {
      const adminConfig = createAdminDevDeviceConfig({ environment });
      return makeResolution({
        status: DEVICE_STATUSES.READY,
        device: adminConfig,
        configSource: CONFIG_SOURCES.DEVELOPMENT_FALLBACK,
        environment,
        isKnownDevice: false,
      });
    }

    return makeResolution({
      status: DEVICE_STATUSES.UNKNOWN,
      device: null,
      configSource: CONFIG_SOURCES.FAILED_RESOLUTION,
      validationErrors: ["VITE_DEVICE_ID is required outside local development."],
      environment,
      isKnownDevice: false,
    });
  }

  const record = manifest?.[deviceId] ? cloneConfig(manifest[deviceId]) : null;

  if (!record) {
    const cached = options.allowCacheFallback
      ? readCachedDeviceConfig(deviceId, { storage: options.storage })
      : null;

    if (cached?.ok && cached.configuration) {
      const cachedValidation = validateDeviceConfig(cached.configuration);
      if (cachedValidation.valid) {
        return makeResolution({
          status: cached.configuration.enabled ? DEVICE_STATUSES.READY : DEVICE_STATUSES.DISABLED,
          device: cached.configuration,
          configSource: CONFIG_SOURCES.CACHE,
          validationErrors: [],
          environment,
          isKnownDevice: true,
        });
      }
    }

    return makeResolution({
      status: DEVICE_STATUSES.UNKNOWN,
      device: null,
      configSource: CONFIG_SOURCES.FAILED_RESOLUTION,
      validationErrors: [`Unknown deviceId: ${deviceId}`],
      environment,
      isKnownDevice: false,
    });
  }

  const validation = validateDeviceConfig(record);
  if (!validation.valid) {
    return makeResolution({
      status: DEVICE_STATUSES.INVALID,
      device: record,
      configSource: CONFIG_SOURCES.MANIFEST,
      validationErrors: validation.errors,
      environment,
      isKnownDevice: true,
    });
  }

  if (record.enabled !== true) {
    return makeResolution({
      status: DEVICE_STATUSES.DISABLED,
      device: record,
      configSource: CONFIG_SOURCES.MANIFEST,
      validationErrors: ["Device is disabled."],
      environment,
      isKnownDevice: true,
    });
  }

  writeDeviceConfigCache(record, { storage: options.storage });

  return makeResolution({
    status: DEVICE_STATUSES.READY,
    device: record,
    configSource: CONFIG_SOURCES.MANIFEST,
    validationErrors: [],
    environment,
    isKnownDevice: true,
  });
}

export function getBrowserDeviceBootstrap(importMetaEnv = {}) {
  return {
    deviceId: importMetaEnv.VITE_DEVICE_ID || "",
    viteDeviceMode: importMetaEnv.VITE_DEVICE_MODE || "",
    environment: importMetaEnv.MODE || (importMetaEnv.DEV ? "development" : "production"),
    isDevelopment: Boolean(importMetaEnv.DEV),
  };
}

