import { DEVICE_MODES, DEVICE_STATUSES } from "../device/deviceModes.js";

export const SHOWROOM_ZONE_IDS = Object.freeze([
  "welcome-kiosk",
  "pod-1",
  "pod-2",
  "pod-3",
  "pod-4",
  "pod-5",
  "ask-snoozer",
  "sleep-essentials-zone",
  "checkout-zone",
]);

const DEVICE_ZONE_OVERRIDES = Object.freeze({
  "welcome-01": ["welcome-kiosk"],
  "ask-snoozer-01": ["ask-snoozer"],
  "sleep-essentials-01": ["sleep-essentials-zone"],
  "checkout-01": ["checkout-zone"],
});

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values) {
  return [...new Set(values.map(cleanString).filter(Boolean))];
}

function isReady(device) {
  return device?.status === DEVICE_STATUSES.READY;
}

export function normalizeZoneIds(value) {
  return unique(Array.isArray(value) ? value : [value]);
}

export function resolveAuthorizedZoneIds(device) {
  if (!isReady(device)) return [];

  const deviceId = cleanString(device.deviceId);
  if (device?.isAdminDev || device?.deviceMode === DEVICE_MODES.ADMIN_DEV || deviceId === "admin-dev") {
    return [...SHOWROOM_ZONE_IDS];
  }

  if (DEVICE_ZONE_OVERRIDES[deviceId]) {
    return [...DEVICE_ZONE_OVERRIDES[deviceId]];
  }

  if (device?.deviceMode === DEVICE_MODES.POD_IPAD) {
    return normalizeZoneIds(device.podId || device.zoneId);
  }

  return normalizeZoneIds(device.zoneId);
}

export function canSubscribeToZone(device, zoneId) {
  const requested = cleanString(zoneId);
  if (!requested) return false;
  return resolveAuthorizedZoneIds(device).includes(requested);
}

export function filterAuthorizedZoneIds(device, zoneIds) {
  const authorized = new Set(resolveAuthorizedZoneIds(device));
  return normalizeZoneIds(zoneIds).filter((zoneId) => authorized.has(zoneId));
}

export function shouldEnableZoneSocket({ endpoint, device } = {}) {
  return Boolean(cleanString(endpoint) && isReady(device) && resolveAuthorizedZoneIds(device).length);
}

export function shouldShowIotDiagnostics(device) {
  return Boolean(
    device?.isAdminDev &&
      device?.deviceMode === DEVICE_MODES.ADMIN_DEV &&
      (device?.deploymentRole === "review" ||
        device?.environment === "development" ||
        device?.environment === "test" ||
        device?.environment === "local")
  );
}
