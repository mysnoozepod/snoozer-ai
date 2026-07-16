export const LIGHTING_STATES = Object.freeze({
  OFF: "off",
  READY: "ready",
  ACTIVE: "active",
  REST_TEST: "rest-test",
  COMPLETE: "complete",
  FAULT: "fault",
});

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function lower(value) {
  return cleanString(value).toLowerCase();
}

function getEventType(zoneState = {}) {
  return lower(zoneState.eventType || zoneState.type);
}

function isFreshZoneState(zoneState = {}, context = {}) {
  return Boolean(zoneState?.zoneId && !zoneState.stale && !context?.isStale);
}

function hasSignalAt(value) {
  return Boolean(cleanString(value));
}

export function getZoneState(context = {}, zoneId = "") {
  const key = cleanString(zoneId);
  if (!key) return null;
  return context.zoneStateByZone?.[key] || null;
}

export function hasPresenceSignal(zoneState = {}) {
  return hasSignalAt(zoneState.lastPresenceEventAt);
}

export function hasOccupancySignal(zoneState = {}) {
  return hasSignalAt(zoneState.lastOccupancyEventAt);
}

export function deriveLightingState({
  isPresent = false,
  restTestActive = false,
  restTestComplete = false,
  hasFault = false,
  isStale = false,
} = {}) {
  if (hasFault) return LIGHTING_STATES.FAULT;
  if (restTestActive) return LIGHTING_STATES.REST_TEST;
  if (restTestComplete) return LIGHTING_STATES.COMPLETE;
  if (isStale) return LIGHTING_STATES.READY;
  if (isPresent) return LIGHTING_STATES.ACTIVE;
  return LIGHTING_STATES.READY;
}

export function deriveZoneExperienceSnapshot(context = {}, zoneId = "", options = {}) {
  const zoneState = getZoneState(context, zoneId);
  const fresh = isFreshZoneState(zoneState, context);
  const eventType = getEventType(zoneState || {});
  const hasFault = fresh && eventType.includes("fault");
  const hasFreshPresenceSignal = fresh && hasPresenceSignal(zoneState);
  const hasFreshOccupancySignal = fresh && hasOccupancySignal(zoneState);
  const isPresent = Boolean(hasFreshPresenceSignal && zoneState?.isPresent);
  const isOccupied = Boolean(hasFreshOccupancySignal && zoneState?.isOccupied);
  const lightingState = deriveLightingState({
    isPresent,
    restTestActive: Boolean(options.restTestActive),
    restTestComplete: Boolean(options.restTestComplete),
    hasFault,
    isStale: Boolean(zoneState?.stale || context?.isStale),
  });

  return {
    zoneId: cleanString(zoneId),
    zoneState,
    eventType,
    isStale: Boolean(zoneState?.stale || context?.isStale),
    hasFault,
    hasFreshPresenceSignal,
    hasFreshOccupancySignal,
    isPresent,
    isOccupied,
    restTestEligible: isOccupied,
    lightingState,
    proximityContext: {
      zoneId: cleanString(zoneId),
      isPresent,
      isOccupied,
      isStale: Boolean(zoneState?.stale || context?.isStale),
      lastPresenceEventAt: zoneState?.lastPresenceEventAt || null,
      lastOccupancyEventAt: zoneState?.lastOccupancyEventAt || null,
      lightingState,
    },
  };
}

export function shouldCompleteRestTestForVacancy({
  restTestActive = false,
  isOccupied = false,
  hasFreshOccupancySignal = false,
  isStale = false,
  vacatedAt = 0,
  nowMs = Date.now(),
  graceMs = 30000,
} = {}) {
  if (!restTestActive) return false;
  if (isStale) return false;
  if (!hasFreshOccupancySignal) return false;
  if (isOccupied) return false;

  const vacated = Number(vacatedAt);
  const now = Number(nowMs);
  const grace = Math.max(0, Number(graceMs) || 0);
  if (!Number.isFinite(vacated) || !Number.isFinite(now)) return false;
  return now - vacated >= grace;
}
