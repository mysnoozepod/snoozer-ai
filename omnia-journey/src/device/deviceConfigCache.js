export const DEVICE_CONFIG_CACHE_KEY = "mysnoozepod.deviceConfig.v1";

function getStorage(explicitStorage) {
  if (explicitStorage) return explicitStorage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

function safeParseJson(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeGet(storage, key) {
  try {
    return storage?.getItem?.(key) || "";
  } catch {
    return "";
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
    return true;
  } catch {
    return false;
  }
}

export function readDeviceConfigCache(options = {}) {
  const storage = getStorage(options.storage);
  if (!storage) {
    return {
      ok: false,
      cached: false,
      reason: "DEVICE_CONFIG_CACHE_STORAGE_UNAVAILABLE",
      entry: null,
    };
  }

  const parsed = safeParseJson(safeGet(storage, DEVICE_CONFIG_CACHE_KEY));
  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      cached: false,
      reason: "DEVICE_CONFIG_CACHE_EMPTY",
      entry: null,
    };
  }

  if (!parsed.deviceId || !parsed.configuration || !parsed.configVersion || !parsed.cachedAt) {
    return {
      ok: false,
      cached: false,
      reason: "DEVICE_CONFIG_CACHE_INVALID_SHAPE",
      entry: null,
    };
  }

  return {
    ok: true,
    cached: true,
    reason: null,
    entry: parsed,
  };
}

export function readCachedDeviceConfig(deviceId, options = {}) {
  const normalizedDeviceId = String(deviceId || "").trim();
  const cache = readDeviceConfigCache(options);

  if (!cache.ok) return { ...cache, configuration: null };

  if (normalizedDeviceId && cache.entry.deviceId !== normalizedDeviceId) {
    return {
      ok: false,
      cached: true,
      reason: "DEVICE_CONFIG_CACHE_DEVICE_MISMATCH",
      entry: cache.entry,
      configuration: null,
    };
  }

  return {
    ok: true,
    cached: true,
    reason: null,
    entry: cache.entry,
    configuration: cache.entry.configuration,
  };
}

export function writeDeviceConfigCache(configuration, options = {}) {
  const storage = getStorage(options.storage);
  if (!storage) {
    return {
      ok: false,
      reason: "DEVICE_CONFIG_CACHE_STORAGE_UNAVAILABLE",
    };
  }

  const deviceId = String(configuration?.deviceId || "").trim();
  const configVersion = Number(configuration?.configVersion);

  if (!deviceId || !configuration || !Number.isFinite(configVersion)) {
    return {
      ok: false,
      reason: "DEVICE_CONFIG_CACHE_INVALID_CONFIGURATION",
    };
  }

  const entry = {
    deviceId,
    configuration,
    configVersion,
    cachedAt: new Date().toISOString(),
  };

  const ok = safeSet(storage, DEVICE_CONFIG_CACHE_KEY, JSON.stringify(entry));
  return {
    ok,
    reason: ok ? null : "DEVICE_CONFIG_CACHE_WRITE_FAILED",
    entry: ok ? entry : null,
  };
}

export function clearDeviceConfigCache(options = {}) {
  const storage = getStorage(options.storage);
  if (!storage) return false;
  return safeRemove(storage, DEVICE_CONFIG_CACHE_KEY);
}

