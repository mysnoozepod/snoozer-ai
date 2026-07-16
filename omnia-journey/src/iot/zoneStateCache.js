export const ZONE_STATE_CACHE_KEY_PREFIX = "mysnoozepod.iot.zoneState.v1";

const SENSITIVE_KEY_PATTERN =
  /shopper|snooze|access|cart|checkout|token|secret|certificate|private|session/i;

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function getStorage(storage) {
  if (storage) return storage;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getZoneStateCacheKey(deviceId) {
  const id = cleanString(deviceId) || "unknown-device";
  return `${ZONE_STATE_CACHE_KEY_PREFIX}.${id}`;
}

export function sanitizeForZoneStateCache(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeForZoneStateCache).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const sanitized = sanitizeForZoneStateCache(child);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

export function buildCacheSnapshot(state, options = {}) {
  return sanitizeForZoneStateCache({
    savedAt: options.savedAt || new Date().toISOString(),
    deviceId: options.deviceId || null,
    subscribedZoneIds: state?.subscribedZoneIds || [],
    latestEventByZone: state?.latestEventByZone || {},
    zoneStateByZone: state?.zoneStateByZone || {},
    lastReceivedAt: state?.lastReceivedAt || null,
    isStale: true,
  });
}

export function writeLastKnownZoneState(state, options = {}) {
  const storage = getStorage(options.storage);
  if (!storage) return { ok: false, skipped: true, reason: "STORAGE_NOT_AVAILABLE" };

  try {
    const snapshot = buildCacheSnapshot(state, options);
    storage.setItem(getZoneStateCacheKey(options.deviceId), JSON.stringify(snapshot));
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, reason: "CACHE_WRITE_FAILED", error };
  }
}

export function readLastKnownZoneState(options = {}) {
  const storage = getStorage(options.storage);
  if (!storage) return { ok: false, skipped: true, reason: "STORAGE_NOT_AVAILABLE" };

  try {
    const raw = storage.getItem(getZoneStateCacheKey(options.deviceId));
    if (!raw) return { ok: false, skipped: true, reason: "CACHE_MISS" };
    const snapshot = sanitizeForZoneStateCache(JSON.parse(raw));
    return { ok: true, snapshot: { ...snapshot, isStale: true } };
  } catch (error) {
    return { ok: false, reason: "CACHE_READ_FAILED", error };
  }
}
