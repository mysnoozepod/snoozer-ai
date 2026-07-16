const { parseMqttTopic, validateTopicMatchesEvent } = require("./topicContract");
const { validateRegistryMembership } = require("./iotRegistry");

const REQUIRED_FIELDS = Object.freeze([
  "schemaVersion",
  "eventId",
  "env",
  "storeId",
  "zoneId",
  "zoneType",
  "podId",
  "deviceId",
  "sensorId",
  "sensorType",
  "eventType",
  "state",
  "value",
  "unit",
  "confidence",
  "sequence",
  "timestamp",
  "source",
  "firmwareVersion",
  "sessionId",
  "snoozeCode",
  "metadata",
]);

const VALID_ENVS = Object.freeze(["dev", "prod"]);
const VALID_ZONE_TYPES = Object.freeze(["entry", "kiosk", "pod", "checkout", "help"]);
const VALID_EVENT_TYPES = Object.freeze([
  "presence_detected",
  "presence_cleared",
  "pod_occupied",
  "pod_vacated",
  "rest_test_start_eligible",
  "rest_test_pause_eligible",
  "rest_test_end_eligible",
  "help_requested",
  "lighting_state_changed",
  "manual_override",
  "device_heartbeat",
  "device_fault",
]);
const VALID_STATES = Object.freeze(["active", "inactive", "warning", "error"]);
const VALID_SOURCES = Object.freeze(["edge-controller", "frontend", "staff", "system"]);

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeNullableString(value) {
  if (value === null) return null;
  const next = cleanString(value);
  return next || null;
}

function normalizeZoneEvent(input) {
  const event = cloneJson(isObject(input) ? input : {});
  for (const key of [
    "schemaVersion",
    "eventId",
    "env",
    "storeId",
    "zoneId",
    "zoneType",
    "deviceId",
    "sensorId",
    "sensorType",
    "eventType",
    "state",
    "timestamp",
    "source",
  ]) {
    if (event[key] != null) event[key] = cleanString(event[key]);
  }

  event.podId = normalizeNullableString(event.podId);
  event.unit = normalizeNullableString(event.unit);
  event.firmwareVersion = normalizeNullableString(event.firmwareVersion);
  event.sessionId = normalizeNullableString(event.sessionId);
  event.snoozeCode = normalizeNullableString(event.snoozeCode);

  if (event.metadata == null) event.metadata = {};

  return event;
}

function isValidIsoTimestamp(value) {
  if (!cleanString(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && value.endsWith("Z");
}

function validateValueType(value) {
  if (value === null) return true;
  const type = typeof value;
  return ["number", "string", "boolean"].includes(type) || isObject(value) || Array.isArray(value);
}

function validateEventTypeRules(event) {
  const errors = [];

  if (["pod_occupied", "pod_vacated"].includes(event.eventType) && event.zoneType !== "pod") {
    errors.push("POD_EVENT_REQUIRES_POD_ZONE");
  }

  if (event.eventType === "pod_occupied" && event.state !== "active") {
    errors.push("EVENT_STATE_MISMATCH");
  }

  if (event.eventType === "pod_vacated" && event.state !== "inactive") {
    errors.push("EVENT_STATE_MISMATCH");
  }

  if (event.eventType === "presence_detected" && event.state !== "active") {
    errors.push("EVENT_STATE_MISMATCH");
  }

  if (event.eventType === "presence_cleared" && event.state !== "inactive") {
    errors.push("EVENT_STATE_MISMATCH");
  }

  if (event.eventType === "device_fault" && !["warning", "error"].includes(event.state)) {
    errors.push("EVENT_STATE_MISMATCH");
  }

  if (event.eventType === "manual_override" && !cleanString(event.metadata?.reason)) {
    errors.push("MANUAL_OVERRIDE_REASON_REQUIRED");
  }

  return errors;
}

function validateZoneEvent(input, options = {}) {
  const errors = [];
  const warnings = [];
  const normalized = normalizeZoneEvent(input);
  const now = options.now instanceof Date ? options.now : new Date();
  const env = cleanString(options.env || process.env.IOT_ENV);
  const storeId = cleanString(options.storeId || process.env.IOT_STORE_ID);
  const staleWindowMs = Number(options.staleWindowMs || process.env.IOT_STALE_WINDOW_MS || 5 * 60 * 1000);
  const futureWindowMs = Number(options.futureWindowMs || 5 * 60 * 1000);

  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) {
      errors.push(`MISSING_${field.toUpperCase()}`);
    }
  }

  if (errors.length) return { ok: false, errors, warnings, normalized };

  if (normalized.schemaVersion !== "1.0") errors.push("INVALID_SCHEMA_VERSION");
  if (!VALID_ENVS.includes(normalized.env)) errors.push("INVALID_ENV");
  if (env && normalized.env !== env) errors.push("ENV_CONFIG_MISMATCH");
  if (storeId && normalized.storeId !== storeId) errors.push("STORE_CONFIG_MISMATCH");
  if (!VALID_ZONE_TYPES.includes(normalized.zoneType)) errors.push("INVALID_ZONE_TYPE");
  if (!VALID_EVENT_TYPES.includes(normalized.eventType)) errors.push("INVALID_EVENT_TYPE");
  if (!VALID_STATES.includes(normalized.state)) errors.push("INVALID_STATE");
  if (!VALID_SOURCES.includes(normalized.source)) errors.push("INVALID_SOURCE");
  if (!Number.isInteger(normalized.sequence) || normalized.sequence < 0) errors.push("INVALID_SEQUENCE");
  if (!validateValueType(normalized.value)) errors.push("INVALID_VALUE_TYPE");
  if (normalized.confidence !== null) {
    if (typeof normalized.confidence !== "number" || normalized.confidence < 0 || normalized.confidence > 1) {
      errors.push("INVALID_CONFIDENCE");
    }
  }
  if (!isObject(normalized.metadata)) errors.push("INVALID_METADATA");
  if (!isValidIsoTimestamp(normalized.timestamp)) errors.push("INVALID_TIMESTAMP");

  let eventAgeMs = 0;
  let staleByAge = false;
  if (isValidIsoTimestamp(normalized.timestamp)) {
    const deviceTime = new Date(normalized.timestamp);
    eventAgeMs = now.getTime() - deviceTime.getTime();
    if (deviceTime.getTime() - now.getTime() > futureWindowMs) errors.push("TIMESTAMP_TOO_FAR_IN_FUTURE");
    if (eventAgeMs > staleWindowMs) {
      staleByAge = true;
      warnings.push("STALE_BY_TIMESTAMP");
    }
  }

  errors.push(...validateEventTypeRules(normalized));

  const topicInfo = options.topicInfo || parseMqttTopic(options.topic || "");
  if (options.topic || topicInfo?.topic) {
    errors.push(...validateTopicMatchesEvent(topicInfo, normalized));
  }

  if (options.registry) {
    const registryResult = validateRegistryMembership(normalized, options.registry);
    if (!registryResult.ok) errors.push(...registryResult.errors);
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    normalized,
    topicInfo,
    staleByAge,
    eventAgeMs,
  };
}

module.exports = {
  REQUIRED_FIELDS,
  VALID_ENVS,
  VALID_ZONE_TYPES,
  VALID_EVENT_TYPES,
  VALID_STATES,
  VALID_SOURCES,
  normalizeZoneEvent,
  validateZoneEvent,
};
