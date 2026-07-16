const fs = require("fs");
const path = require("path");

const DEFAULT_REGISTRY_PATH = path.join(__dirname, "..", "..", "data", "iot-device-registry.v1.json");

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function loadIotDeviceRegistry(options = {}) {
  if (isObject(options.registry)) return buildIotRegistryIndexes(options.registry);

  const registryPath = cleanString(
    options.registryPath || process.env.IOT_DEVICE_REGISTRY_PATH || DEFAULT_REGISTRY_PATH
  );
  const raw = fs.readFileSync(registryPath, "utf8");
  const registry = JSON.parse(raw);
  return buildIotRegistryIndexes(registry);
}

function buildIotRegistryIndexes(registry) {
  const zones = new Map();
  const devices = new Map();
  const sensorsByDevice = new Map();

  for (const zone of registry.zones || []) {
    zones.set(zone.zoneId, zone);
  }

  for (const device of registry.devices || []) {
    devices.set(device.deviceId, device);
    const sensorMap = new Map();
    for (const sensor of device.sensors || []) {
      sensorMap.set(sensor.sensorId, sensor);
    }
    sensorsByDevice.set(device.deviceId, sensorMap);
  }

  return {
    registry,
    registryVersion: registry.registryVersion || "unknown",
    env: registry.env,
    storeId: registry.storeId,
    zones,
    devices,
    sensorsByDevice,
  };
}

function getRegisteredZone(indexes, zoneId) {
  return indexes?.zones?.get(zoneId) || null;
}

function getRegisteredDevice(indexes, deviceId) {
  return indexes?.devices?.get(deviceId) || null;
}

function getRegisteredSensor(indexes, deviceId, sensorId) {
  return indexes?.sensorsByDevice?.get(deviceId)?.get(sensorId) || null;
}

function deviceOwnsZone(device, zoneId) {
  const zoneIds = Array.isArray(device?.zoneIds) ? device.zoneIds : [];
  return device?.zoneId === zoneId || zoneIds.includes(zoneId);
}

function isDeviceLevelEvent(event) {
  return ["device_heartbeat", "device_fault"].includes(event.eventType);
}

function validateRegistryMembership(event, indexes) {
  const errors = [];
  const zone = getRegisteredZone(indexes, event.zoneId);
  const device = getRegisteredDevice(indexes, event.deviceId);

  if (!zone) errors.push("UNREGISTERED_ZONE");
  if (!device) {
    errors.push("UNREGISTERED_DEVICE");
    return { ok: false, errors, zone, device, sensor: null };
  }

  if (device.env !== event.env) errors.push("DEVICE_ENV_MISMATCH");
  if (device.storeId !== event.storeId) errors.push("DEVICE_STORE_MISMATCH");
  if (device.enabled !== true) errors.push("DEVICE_DISABLED");
  if (!deviceOwnsZone(device, event.zoneId)) errors.push("DEVICE_ZONE_NOT_AUTHORIZED");

  if (zone) {
    if (zone.zoneType !== event.zoneType) errors.push("ZONE_TYPE_MISMATCH");
    if (zone.zoneType === "pod" && zone.podId !== event.podId) errors.push("POD_ID_MISMATCH");
    if (zone.zoneType !== "pod" && event.podId !== null) errors.push("POD_ID_NOT_ALLOWED");
  }

  if (isDeviceLevelEvent(event) && event.sensorId === event.deviceId) {
    const expectedSensorType =
      event.eventType === "device_heartbeat" ? "device-heartbeat" : "device-fault";
    if (event.sensorType !== expectedSensorType) errors.push("DEVICE_LEVEL_SENSOR_TYPE_MISMATCH");
    return { ok: errors.length === 0, errors, zone, device, sensor: null };
  }

  const sensor = getRegisteredSensor(indexes, event.deviceId, event.sensorId);
  if (!sensor) {
    errors.push("UNREGISTERED_SENSOR");
  } else {
    if (sensor.enabled !== true) errors.push("SENSOR_DISABLED");
    if (sensor.sensorType !== event.sensorType) errors.push("SENSOR_TYPE_MISMATCH");
    if (sensor.zoneId && sensor.zoneId !== event.zoneId) errors.push("SENSOR_ZONE_MISMATCH");
  }

  return { ok: errors.length === 0, errors, zone, device, sensor };
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  buildIotRegistryIndexes,
  loadIotDeviceRegistry,
  getRegisteredZone,
  getRegisteredDevice,
  getRegisteredSensor,
  validateRegistryMembership,
};
