const fs = require("fs");
const path = require("path");

const DEFAULT_SHOWROOM_DEVICE_REGISTRY_PATH = path.join(
  __dirname,
  "..",
  "..",
  "data",
  "showroom-device-registry.v1.json"
);

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyRegistryEnvironment(registry, env) {
  if (!env || registry?.env === env) return registry;
  const next = clone(registry);
  next.env = env;
  for (const device of next.devices || []) {
    device.env = env;
  }
  return next;
}

function buildShowroomDeviceRegistryIndexes(registry) {
  const devices = new Map();
  for (const device of registry.devices || []) {
    devices.set(device.deviceId, device);
  }
  return {
    registry,
    registryVersion: registry.registryVersion || "unknown",
    env: registry.env,
    storeId: registry.storeId,
    devices,
  };
}

function loadShowroomDeviceRegistry(options = {}) {
  const effectiveEnv = cleanString(options.env || process.env.IOT_ENV);
  if (isObject(options.registry)) {
    return buildShowroomDeviceRegistryIndexes(applyRegistryEnvironment(options.registry, effectiveEnv));
  }

  const registryPath = cleanString(
    options.registryPath ||
      process.env.SHOWROOM_DEVICE_REGISTRY_PATH ||
      DEFAULT_SHOWROOM_DEVICE_REGISTRY_PATH
  );
  const registry = applyRegistryEnvironment(JSON.parse(fs.readFileSync(registryPath, "utf8")), effectiveEnv);
  return buildShowroomDeviceRegistryIndexes(registry);
}

function getShowroomDevice(indexes, deviceId) {
  return indexes?.devices?.get(cleanString(deviceId)) || null;
}

function normalizeZoneIds(value) {
  if (Array.isArray(value)) return value.map(cleanString).filter(Boolean);
  const zoneId = cleanString(value);
  return zoneId ? [zoneId] : [];
}

function isAdminDevice(device) {
  return device?.deviceMode === "admin-dev" || device?.deviceId === "admin-dev";
}

function deviceCanSubscribeToZone(device, zoneId) {
  const normalizedZoneId = cleanString(zoneId);
  if (!device || device.enabled !== true || !normalizedZoneId) return false;
  if (isAdminDevice(device)) return true;
  const allowedZoneIds = normalizeZoneIds(device.allowedZoneIds || device.zoneIds || device.zoneId);
  return allowedZoneIds.includes(normalizedZoneId);
}

function authorizeZoneSubscriptions(device, zoneIds, iotRegistry) {
  const requestedZoneIds = [...new Set(normalizeZoneIds(zoneIds))];
  const accepted = [];
  const rejected = [];

  for (const zoneId of requestedZoneIds) {
    const zoneExists = Boolean(iotRegistry?.zones?.has(zoneId));
    const authorized = zoneExists && deviceCanSubscribeToZone(device, zoneId);
    if (authorized) {
      accepted.push(zoneId);
    } else {
      rejected.push({
        zoneId,
        reason: zoneExists ? "ZONE_NOT_AUTHORIZED_FOR_DEVICE" : "UNKNOWN_ZONE",
      });
    }
  }

  return {
    ok: requestedZoneIds.length > 0 && rejected.length === 0,
    accepted,
    rejected,
  };
}

module.exports = {
  DEFAULT_SHOWROOM_DEVICE_REGISTRY_PATH,
  authorizeZoneSubscriptions,
  buildShowroomDeviceRegistryIndexes,
  deviceCanSubscribeToZone,
  getShowroomDevice,
  isAdminDevice,
  loadShowroomDeviceRegistry,
};
