const { parseMqttTopic } = require("./topicContract");
const { loadIotDeviceRegistry } = require("./iotRegistry");
const { validateZoneEvent } = require("./zoneEventValidator");
const { persistZoneEvent } = require("./zoneEventStore");
const { quarantineMalformedZoneEvent } = require("./zoneEventQuarantine");
const { emitIotMetric } = require("./zoneEventMetrics");

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nowIso(options = {}) {
  const value = typeof options.clock === "function" ? options.clock() : new Date();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeParseJson(value) {
  if (typeof value !== "string") return { ok: true, value };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function extractIotRuleEvent(event = {}) {
  const parsedBody = safeParseJson(event.body);
  const root = parsedBody.ok && isObject(parsedBody.value) ? parsedBody.value : event;
  const topic = cleanString(
    root.mqttTopic ||
      root.topic ||
      root.topicName ||
      root.topicFullName ||
      root.mqtt?.topic ||
      event.mqttTopic ||
      event.topic
  );

  const payloadSource = Object.prototype.hasOwnProperty.call(root, "payload")
    ? root.payload
    : root.message || root.event || root;
  const parsedPayload = safeParseJson(payloadSource);

  if (!parsedPayload.ok) {
    return {
      ok: false,
      topic,
      payload: null,
      rawEvent: event,
      errors: ["INVALID_JSON"],
    };
  }

  let payload = parsedPayload.value;
  if (isObject(payload) && payload === root) {
    payload = { ...payload };
    delete payload.mqttTopic;
    delete payload.topic;
    delete payload.topicName;
    delete payload.topicFullName;
    delete payload.topicEnv;
    delete payload.topicStoreId;
    delete payload.topicScope;
    delete payload.topicEntityId;
    delete payload.mqtt;
  }

  return {
    ok: isObject(payload),
    topic,
    payload,
    rawEvent: event,
    errors: isObject(payload) ? [] : ["INVALID_JSON_PAYLOAD"],
  };
}

function resolveConfig(options = {}) {
  return {
    env: cleanString(options.env || process.env.IOT_ENV),
    storeId: cleanString(options.storeId || process.env.IOT_STORE_ID || "severn-pilot"),
    stateTable: cleanString(options.stateTable || process.env.IOT_ZONE_STATE_TABLE),
    eventsTable: cleanString(options.eventsTable || process.env.IOT_ZONE_EVENTS_TABLE),
    quarantineQueueUrl: cleanString(options.quarantineQueueUrl || process.env.IOT_QUARANTINE_QUEUE_URL),
    eventTtlDays: Number(options.eventTtlDays || process.env.IOT_EVENT_TTL_DAYS || 180),
    logLevel: cleanString(options.logLevel || process.env.IOT_LOG_LEVEL || "info"),
  };
}

function logIot(event, details = {}, options = {}) {
  const logger = options.logger || console.log;
  logger(
    JSON.stringify({
      event,
      ...details,
    })
  );
}

async function rejectAndQuarantine({ extraction, validation, receivedAt, config, options }) {
  const reasonCodes = [
    ...(extraction?.errors || []),
    ...(validation?.errors || []),
  ];
  const topicInfo = extraction?.topic ? parseMqttTopic(extraction.topic) : null;
  const quarantine = await quarantineMalformedZoneEvent(
    {
      rawEvent: extraction?.rawEvent,
      reasonCodes,
      receivedAt,
      topic: extraction?.topic || null,
      env: validation?.normalized?.env || topicInfo?.env || config.env || null,
      storeId: validation?.normalized?.storeId || topicInfo?.storeId || config.storeId || null,
    },
    {
      queueUrl: config.quarantineQueueUrl,
      sqsClient: options.sqsClient,
    }
  );

  emitIotMetric("ZoneEventMalformed", {
    env: validation?.normalized?.env || topicInfo?.env || config.env || "unknown",
    storeId: validation?.normalized?.storeId || topicInfo?.storeId || config.storeId || "unknown",
    zoneId: validation?.normalized?.zoneId || topicInfo?.zoneId || "unknown",
    deviceId: validation?.normalized?.deviceId || topicInfo?.deviceId || "unknown",
  }, options);

  if (!quarantine.ok) {
    emitIotMetric("ZoneEventQuarantineFailed", {
      env: config.env || "unknown",
      storeId: config.storeId || "unknown",
    }, options);
  }

  logIot("iot.zone_event.rejected", {
    reasonCodes,
    quarantined: quarantine.ok,
    quarantineReason: quarantine.reason || null,
    topic: extraction?.topic || null,
  }, options);

  return {
    ok: false,
    accepted: false,
    rejected: true,
    reasonCodes,
    quarantine,
  };
}

async function processZoneEvent(event, options = {}) {
  const config = resolveConfig(options);
  const receivedAt = options.receivedAt || nowIso(options);
  const extraction = extractIotRuleEvent(event);

  emitIotMetric("ZoneEventReceived", {
    env: config.env || "unknown",
    storeId: config.storeId || "unknown",
  }, options);

  if (!extraction.ok) {
    return rejectAndQuarantine({
      extraction,
      validation: null,
      receivedAt,
      config,
      options,
    });
  }

  const topicInfo = parseMqttTopic(extraction.topic);
  const registry = options.registry || loadIotDeviceRegistry(options);
  const validation = validateZoneEvent(extraction.payload, {
    env: config.env,
    storeId: config.storeId,
    topicInfo,
    topic: extraction.topic,
    registry,
    now: options.now,
    staleWindowMs: options.staleWindowMs,
  });

  if (!validation.ok) {
    return rejectAndQuarantine({
      extraction,
      validation,
      receivedAt,
      config,
      options,
    });
  }

  const normalized = validation.normalized;
  const persistence = await persistZoneEvent(normalized, {
    ddbDoc: options.ddbDoc,
    stateTable: config.stateTable,
    eventsTable: config.eventsTable,
    receivedAt,
    eventTtlDays: config.eventTtlDays,
    skipLatest: validation.staleByAge,
  });

  if (persistence.duplicate) {
    emitIotMetric("ZoneEventDuplicateSuppressed", normalized, options);
    logIot("iot.zone_event.duplicate_suppressed", {
      eventId: normalized.eventId,
      env: normalized.env,
      storeId: normalized.storeId,
      zoneId: normalized.zoneId,
      deviceId: normalized.deviceId,
    }, options);
    return {
      ok: true,
      accepted: false,
      duplicate: true,
      eventId: normalized.eventId,
      reason: persistence.reason,
    };
  }

  if (persistence.latest?.stale) {
    emitIotMetric("ZoneLatestStateStaleIgnored", normalized, options);
  } else {
    emitIotMetric("ZoneEventAccepted", normalized, options);
  }

  logIot("iot.zone_event.accepted", {
    eventId: normalized.eventId,
    env: normalized.env,
    storeId: normalized.storeId,
    zoneId: normalized.zoneId,
    deviceId: normalized.deviceId,
    stale: persistence.latest?.stale === true,
    latestUpdated: persistence.latest?.latestUpdated === true,
  }, options);

  return {
    ok: true,
    accepted: true,
    duplicate: false,
    stale: persistence.latest?.stale === true,
    latestUpdated: persistence.latest?.latestUpdated === true,
    eventId: normalized.eventId,
    env: normalized.env,
    storeId: normalized.storeId,
    zoneId: normalized.zoneId,
    deviceId: normalized.deviceId,
    receivedAt,
  };
}

async function handleIotZoneEvent(event, context) {
  return processZoneEvent(event, { context });
}

module.exports = {
  extractIotRuleEvent,
  processZoneEvent,
  handleIotZoneEvent,
};
