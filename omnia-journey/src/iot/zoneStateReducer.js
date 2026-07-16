export const ZONE_CONNECTION_STATUSES = Object.freeze({
  DISABLED: "disabled",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
  DISCONNECTED: "disconnected",
  ERROR: "error",
});

const MAX_SEEN_EVENT_IDS = 120;

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function parseMessage(raw) {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") return raw;
  return null;
}

function normalizeSequence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const output = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/shopper|snooze|access|cart|checkout|token|secret|certificate|private|session/i.test(key)) {
      continue;
    }
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
      output[key] = value;
    }
  }
  return output;
}

function isActiveState(event) {
  const state = cleanString(event.state).toLowerCase();
  const eventType = cleanString(event.eventType).toLowerCase();
  if (typeof event.value === "boolean") return event.value;
  if (eventType.includes("detected") || eventType.includes("occupied")) return true;
  if (eventType.includes("cleared") || eventType.includes("vacated")) return false;
  if (["active", "present", "occupied", "detected", "true", "on"].includes(state)) return true;
  if (["inactive", "absent", "vacant", "cleared", "false", "off"].includes(state)) return false;
  return null;
}

function applyPresenceOccupancy(existing = {}, event) {
  const eventType = cleanString(event.eventType).toLowerCase();
  const sensorType = cleanString(event.sensorType).toLowerCase();
  const active = isActiveState(event);
  const receivedAt = event.receivedAt || event.timestamp || new Date().toISOString();

  const next = {
    isPresent: existing.isPresent ?? false,
    isOccupied: existing.isOccupied ?? false,
    lastPresenceEventAt: existing.lastPresenceEventAt || null,
    lastOccupancyEventAt: existing.lastOccupancyEventAt || null,
  };

  if (active !== null && (eventType.includes("presence") || sensorType.includes("presence"))) {
    next.isPresent = active;
    next.lastPresenceEventAt = receivedAt;
  }

  if (
    active !== null &&
    (eventType.includes("occup") ||
      eventType.includes("vacant") ||
      eventType.includes("vacat") ||
      sensorType.includes("occup"))
  ) {
    next.isOccupied = active;
    next.lastOccupancyEventAt = receivedAt;
  }

  return next;
}

export function createInitialZoneState(overrides = {}) {
  return {
    connectionStatus: ZONE_CONNECTION_STATUSES.DISABLED,
    subscribedZoneIds: [],
    latestEventByZone: {},
    zoneStateByZone: {},
    lastReceivedAt: null,
    isStale: false,
    reconnectAttempt: 0,
    lastError: null,
    seenEventIds: [],
    ...overrides,
  };
}

export function normalizeZoneEventMessage(raw, authorizedZoneIds = []) {
  const message = parseMessage(raw);
  if (!message) return { ok: false, reason: "MALFORMED_MESSAGE" };
  if (message.type !== "zone_event") return { ok: false, reason: "UNSUPPORTED_MESSAGE_TYPE" };

  const zoneId = cleanString(message.zoneId);
  const eventId = cleanString(message.eventId);
  const authorized = new Set(authorizedZoneIds);

  if (!eventId) return { ok: false, reason: "MISSING_EVENT_ID" };
  if (!zoneId) return { ok: false, reason: "MISSING_ZONE_ID" };
  if (authorized.size && !authorized.has(zoneId)) {
    return { ok: false, reason: "ZONE_NOT_AUTHORIZED", zoneId };
  }

  const timestamp = cleanString(message.timestamp || message.receivedAt || message.broadcastAt);
  const receivedAt = cleanString(message.receivedAt || message.broadcastAt || timestamp || new Date().toISOString());

  return {
    ok: true,
    event: {
      type: "zone_event",
      eventId,
      storeId: cleanString(message.storeId),
      zoneId,
      zoneType: cleanString(message.zoneType),
      podId: cleanString(message.podId),
      deviceId: cleanString(message.deviceId),
      sensorId: cleanString(message.sensorId),
      sensorType: cleanString(message.sensorType),
      eventType: cleanString(message.eventType),
      state: cleanString(message.state),
      value: message.value,
      confidence: Number.isFinite(Number(message.confidence)) ? Number(message.confidence) : null,
      sequence: normalizeSequence(message.sequence),
      timestamp: timestamp || receivedAt,
      receivedAt,
      broadcastAt: cleanString(message.broadcastAt),
      metadata: sanitizeMetadata(message.metadata),
    },
  };
}

export function applyZoneEventToState(currentState, event) {
  const state = currentState || createInitialZoneState();
  if (!event?.eventId || !event?.zoneId) {
    return { accepted: false, reason: "INVALID_EVENT", state };
  }

  if ((state.seenEventIds || []).includes(event.eventId)) {
    return { accepted: false, reason: "DUPLICATE_EVENT", state };
  }

  const existingZoneState = state.zoneStateByZone?.[event.zoneId] || {};
  if (
    event.sequence !== null &&
    existingZoneState.sequence !== null &&
    existingZoneState.sequence !== undefined &&
    event.sequence <= Number(existingZoneState.sequence)
  ) {
    return { accepted: false, reason: "STALE_SEQUENCE", state };
  }

  const receivedAt = event.receivedAt || new Date().toISOString();
  const presenceOccupancy = applyPresenceOccupancy(existingZoneState, event);
  const nextZoneState = {
    ...existingZoneState,
    ...presenceOccupancy,
    zoneId: event.zoneId,
    eventId: event.eventId,
    eventType: event.eventType,
    state: event.state,
    value: event.value,
    sequence: event.sequence,
    timestamp: event.timestamp,
    receivedAt,
    stale: false,
  };

  const seenEventIds = [...(state.seenEventIds || []), event.eventId].slice(-MAX_SEEN_EVENT_IDS);
  const nextState = {
    ...state,
    connectionStatus: state.connectionStatus,
    latestEventByZone: {
      ...(state.latestEventByZone || {}),
      [event.zoneId]: event,
    },
    zoneStateByZone: {
      ...(state.zoneStateByZone || {}),
      [event.zoneId]: nextZoneState,
    },
    lastReceivedAt: receivedAt,
    isStale: false,
    lastError: null,
    seenEventIds,
  };

  return { accepted: true, reason: "ACCEPTED", state: nextState };
}

export function markZoneStateStale(currentState, reason = "STALE") {
  const state = currentState || createInitialZoneState();
  const zoneStateByZone = {};
  for (const [zoneId, zoneState] of Object.entries(state.zoneStateByZone || {})) {
    zoneStateByZone[zoneId] = {
      ...zoneState,
      stale: true,
      staleReason: reason,
    };
  }
  return {
    ...state,
    zoneStateByZone,
    isStale: true,
  };
}

export function shouldMarkZoneStateStale(lastReceivedAt, options = {}) {
  if (!lastReceivedAt) return false;
  const nowMs = Number(options.nowMs || Date.now());
  const staleAfterMs = Number(options.staleAfterMs || 30000);
  const receivedMs = new Date(lastReceivedAt).getTime();
  return Number.isFinite(receivedMs) && nowMs - receivedMs >= staleAfterMs;
}
