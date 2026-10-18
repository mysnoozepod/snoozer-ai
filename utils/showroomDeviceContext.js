const LIGHTING_STATES = new Set([
  "off",
  "ready",
  "active",
  "rest-test",
  "complete",
  "fault",
]);

function clean(value, maxLength = 120) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function isoTimestamp(value) {
  const text = clean(value, 40);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeShowroomProximityContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const zoneId = clean(value.zoneId, 80);
  if (!zoneId) return null;
  const lightingState = clean(value.lightingState, 40).toLowerCase();
  return {
    zoneId,
    isPresent: value.isPresent === true,
    isOccupied: value.isOccupied === true,
    isStale: value.isStale !== false,
    lastPresenceEventAt: isoTimestamp(value.lastPresenceEventAt),
    lastOccupancyEventAt: isoTimestamp(value.lastOccupancyEventAt),
    lightingState: LIGHTING_STATES.has(lightingState) ? lightingState : null,
  };
}

function normalizeShowroomDeviceContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const deviceId = clean(value.deviceId, 120) || null;
  const deviceMode = clean(value.deviceMode, 80) || null;
  const podId = clean(value.podId, 80) || null;
  const zoneId = clean(value.zoneId, 80) || null;
  const proximity = normalizeShowroomProximityContext(value.proximity);
  if (!deviceId && !deviceMode && !podId && !zoneId && !proximity) return null;
  return { deviceId, deviceMode, podId, zoneId, proximity };
}

function buildModelShowroomContext(context = {}) {
  const device = normalizeShowroomDeviceContext(context?.device);
  if (!device) return null;
  return {
    deviceMode: device.deviceMode,
    podId: device.podId,
    zoneId: device.proximity?.zoneId || device.zoneId,
    presence: device.proximity
      ? {
          present: device.proximity.isPresent,
          occupied: device.proximity.isOccupied,
          stale: device.proximity.isStale,
          lightingState: device.proximity.lightingState,
          lastPresenceEventAt: device.proximity.lastPresenceEventAt,
          lastOccupancyEventAt: device.proximity.lastOccupancyEventAt,
        }
      : null,
  };
}

module.exports = {
  normalizeShowroomProximityContext,
  normalizeShowroomDeviceContext,
  buildModelShowroomContext,
};
