const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const { parseMqttTopic } = require("./topicContract");
const {
  deviceOwnsZone,
  getRegisteredDevice,
  getRegisteredZone,
  loadIotDeviceRegistry,
} = require("./iotRegistry");
const { broadcastPhysicalControlUpdate } = require("./zoneEventBroadcaster");
const { emitIotMetric } = require("./zoneEventMetrics");

let IoTDataPlaneClient;
let PublishCommand;
try {
  ({ IoTDataPlaneClient, PublishCommand } = require("@aws-sdk/client-iot-data-plane"));
} catch {}

const REGION = process.env.AWS_REGION || "us-east-1";
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const COMMAND_TYPES = Object.freeze([
  "set_lighting_state",
  "set_audio_state",
  "manual_override",
  "restore_default",
]);

const LIGHTING_STATES = Object.freeze(["off", "ready", "active", "rest-test", "complete", "fault"]);
const AUDIO_STATES = Object.freeze(["stopped", "playing", "fading", "fault"]);
const ACK_STATUSES = Object.freeze(["accepted", "applied", "rejected", "expired", "failed"]);
const TERMINAL_STATUSES = new Set(["applied", "rejected", "expired", "failed"]);

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

function addMs(iso, ms) {
  return new Date(new Date(iso).getTime() + Number(ms || 0)).toISOString();
}

function ttlEpochSeconds(days) {
  const safeDays = Math.max(1, Number(days || 30));
  return Math.floor(Date.now() / 1000) + safeDays * 24 * 60 * 60;
}

function safeParseJson(value) {
  if (typeof value !== "string") return { ok: true, value };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function resolveConfig(options = {}) {
  return {
    env: cleanString(options.env || process.env.IOT_ENV || "prod"),
    storeId: cleanString(options.storeId || process.env.IOT_STORE_ID || "severn-pilot"),
    commandTable: cleanString(options.commandTable || process.env.IOT_PHYSICAL_CONTROL_TABLE),
    endpoint: cleanString(options.endpoint || process.env.IOT_DATA_ENDPOINT || process.env.IOT_ENDPOINT),
    commandTtlDays: Number(options.commandTtlDays || process.env.IOT_PHYSICAL_COMMAND_TTL_DAYS || 30),
    commandTimeoutMs: Number(options.commandTimeoutMs || process.env.IOT_PHYSICAL_COMMAND_TIMEOUT_MS || 15000),
    maxAttempts: Number(options.maxAttempts || process.env.IOT_PHYSICAL_COMMAND_MAX_ATTEMPTS || 2),
  };
}

function buildCommandTopic({ env, storeId, deviceId }) {
  return `mysnoozepod/${env}/stores/${storeId}/devices/${deviceId}/commands`;
}

function normalizeDesiredState(commandType, desiredState = {}) {
  const desired = isObject(desiredState) ? { ...desiredState } : {};

  if (commandType === "set_lighting_state") {
    const lightingState = cleanString(desired.lightingState || desired.lighting || desired.state).toLowerCase();
    return lightingState ? { lightingState } : {};
  }

  if (commandType === "set_audio_state") {
    const audioState = cleanString(desired.audioState || desired.audio || desired.state).toLowerCase();
    const track = cleanString(desired.track || desired.trackId);
    return { ...(audioState ? { audioState } : {}), ...(track ? { track } : {}) };
  }

  if (commandType === "manual_override") {
    return {
      manualOverride: desired.manualOverride !== false,
      ...(desired.reason ? { reason: cleanString(desired.reason) } : {}),
    };
  }

  if (commandType === "restore_default") {
    return { restoreDefault: true };
  }

  return desired;
}

function deviceHasOutput(device, outputType) {
  return (device?.outputs || []).some((output) => output?.outputType === outputType && output?.enabled !== false);
}

function inferDeviceForCommand({ commandType, zoneId, indexes }) {
  const devices = Array.from(indexes?.devices?.values?.() || []);
  if (commandType === "set_audio_state") {
    return devices.find((device) => device.enabled === true && deviceHasOutput(device, "ambient-audio")) || null;
  }
  return devices.find((device) => device.enabled === true && deviceOwnsZone(device, zoneId)) || null;
}

function validateDeviceAuthorization({ commandType, zoneId, device, indexes }) {
  const errors = [];
  const zone = getRegisteredZone(indexes, zoneId);
  if (!zone) errors.push("UNREGISTERED_ZONE");
  if (!device) {
    errors.push("UNREGISTERED_DEVICE");
    return errors;
  }

  if (device.enabled !== true) errors.push("DEVICE_DISABLED");
  if (device.env !== indexes.env) errors.push("DEVICE_ENV_MISMATCH");
  if (device.storeId !== indexes.storeId) errors.push("DEVICE_STORE_MISMATCH");

  if (commandType === "set_audio_state") {
    if (!deviceHasOutput(device, "ambient-audio")) errors.push("DEVICE_AUDIO_OUTPUT_NOT_AUTHORIZED");
    return errors;
  }

  if (!deviceOwnsZone(device, zoneId)) errors.push("DEVICE_ZONE_NOT_AUTHORIZED");
  return errors;
}

function validateDesiredState(commandType, desiredState) {
  const errors = [];
  if (commandType === "set_lighting_state" && !LIGHTING_STATES.includes(desiredState.lightingState)) {
    errors.push("INVALID_LIGHTING_STATE");
  }
  if (commandType === "set_audio_state" && !AUDIO_STATES.includes(desiredState.audioState)) {
    errors.push("INVALID_AUDIO_STATE");
  }
  return errors;
}

function normalizePhysicalCommand(input = {}, options = {}) {
  const config = resolveConfig(options);
  const indexes = options.registry || loadIotDeviceRegistry({ ...options, env: config.env });
  const issuedAt = cleanString(input.issuedAt) || nowIso(options);
  const commandType = cleanString(input.commandType || input.type).toLowerCase();
  const requestedZoneId = cleanString(input.zoneId);
  const zoneId =
    commandType === "set_audio_state" && !requestedZoneId
      ? "help"
      : requestedZoneId;
  const requestedDeviceId = cleanString(input.deviceId);
  const inferredDevice = inferDeviceForCommand({ commandType, zoneId, indexes });
  const device = requestedDeviceId ? getRegisteredDevice(indexes, requestedDeviceId) : inferredDevice;
  const desiredState = normalizeDesiredState(commandType, input.desiredState || input.state || {});
  const commandId = cleanString(input.commandId) || crypto.randomUUID();
  const expiresAt = cleanString(input.expiresAt) || addMs(issuedAt, config.commandTimeoutMs);

  return {
    commandId,
    schemaVersion: "1.0",
    env: cleanString(input.env || config.env),
    storeId: cleanString(input.storeId || config.storeId),
    zoneId,
    requestedZoneId: requestedZoneId || zoneId,
    deviceId: device?.deviceId || requestedDeviceId,
    commandType,
    desiredState,
    source: cleanString(input.source || "frontend"),
    sourceSurface: cleanString(input.sourceSurface || input.surface || ""),
    correlationId: cleanString(input.correlationId || ""),
    issuedAt,
    expiresAt,
    attempts: Math.max(1, Number(input.attempts || 1)),
    maxAttempts: Math.max(1, Number(input.maxAttempts || config.maxAttempts)),
    metadata: isObject(input.metadata) ? input.metadata : {},
    topic: device ? buildCommandTopic({ env: config.env, storeId: config.storeId, deviceId: device.deviceId }) : "",
    ttl: ttlEpochSeconds(config.commandTtlDays),
    _device: device,
    _registry: indexes,
  };
}

function validatePhysicalCommand(input = {}, options = {}) {
  const normalized = normalizePhysicalCommand(input, options);
  const errors = [];

  if (!COMMAND_TYPES.includes(normalized.commandType)) errors.push("INVALID_COMMAND_TYPE");
  if (!normalized.zoneId) errors.push("MISSING_ZONE_ID");
  if (!normalized.deviceId) errors.push("MISSING_DEVICE_ID");
  if (normalized.env !== normalized._registry.env) errors.push("COMMAND_ENV_MISMATCH");
  if (normalized.storeId !== normalized._registry.storeId) errors.push("COMMAND_STORE_MISMATCH");
  errors.push(
    ...validateDeviceAuthorization({
      commandType: normalized.commandType,
      zoneId: normalized.zoneId,
      device: normalized._device,
      indexes: normalized._registry,
    })
  );
  errors.push(...validateDesiredState(normalized.commandType, normalized.desiredState));

  const nowMs = new Date(nowIso(options)).getTime();
  const expiresMs = new Date(normalized.expiresAt).getTime();
  if (Number.isFinite(expiresMs) && expiresMs <= nowMs) errors.push("COMMAND_ALREADY_EXPIRED");

  const { _device, _registry, ...command } = normalized;
  return { ok: errors.length === 0, errors, command, device: _device, registry: _registry };
}

function commandStatusItem(command, status = "pending", extra = {}) {
  const updatedAt = extra.updatedAt || nowIso();
  return {
    PK: `COMMAND#${command.commandId}`,
    SK: "STATUS",
    commandId: command.commandId,
    schemaVersion: command.schemaVersion,
    env: command.env,
    storeId: command.storeId,
    zoneId: command.zoneId,
    requestedZoneId: command.requestedZoneId,
    deviceId: command.deviceId,
    commandType: command.commandType,
    desiredState: command.desiredState,
    status,
    source: command.source,
    sourceSurface: command.sourceSurface,
    correlationId: command.correlationId,
    attempts: command.attempts,
    maxAttempts: command.maxAttempts,
    topic: command.topic,
    issuedAt: command.issuedAt,
    expiresAt: command.expiresAt,
    updatedAt,
    metadata: command.metadata,
    ttl: command.ttl,
    GSI1PK: `STORE#${command.storeId}#ZONE#${command.zoneId}`,
    GSI1SK: `COMMAND#${command.issuedAt}#${command.commandId}`,
    GSI2PK: `STATUS#${status}`,
    GSI2SK: `EXPIRES#${command.expiresAt}#${command.commandId}`,
    ...extra,
  };
}

async function putCommandStatus(command, options = {}) {
  const config = resolveConfig(options);
  if (!config.commandTable) throw new Error("IOT_PHYSICAL_CONTROL_TABLE_NOT_CONFIGURED");

  const item = commandStatusItem(command, "pending", { updatedAt: command.issuedAt });
  const client = options.ddbDoc || ddbDoc;

  try {
    await client.send(
      new PutCommand({
        TableName: config.commandTable,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
    return { ok: true, duplicate: false, item };
  } catch (error) {
    if (/ConditionalCheckFailed/i.test(String(error?.name || error?.message || ""))) {
      const existing = await getCommandStatus(command.commandId, options).catch(() => null);
      return { ok: true, duplicate: true, item: existing?.item || null, reason: "DUPLICATE_COMMAND_SUPPRESSED" };
    }
    throw error;
  }
}

async function getCommandStatus(commandId, options = {}) {
  const config = resolveConfig(options);
  if (!config.commandTable) throw new Error("IOT_PHYSICAL_CONTROL_TABLE_NOT_CONFIGURED");
  const client = options.ddbDoc || ddbDoc;
  const result = await client.send(
    new GetCommand({
      TableName: config.commandTable,
      Key: { PK: `COMMAND#${commandId}`, SK: "STATUS" },
    })
  );
  return { ok: Boolean(result.Item), item: result.Item || null };
}

async function updateCommandStatus(commandId, status, updates = {}, options = {}) {
  const config = resolveConfig(options);
  if (!config.commandTable) throw new Error("IOT_PHYSICAL_CONTROL_TABLE_NOT_CONFIGURED");
  const client = options.ddbDoc || ddbDoc;
  const updatedAt = updates.updatedAt || nowIso(options);
  const names = { "#status": "status", "#updatedAt": "updatedAt", "#gsi2pk": "GSI2PK" };
  const values = {
    ":status": status,
    ":updatedAt": updatedAt,
    ":gsi2pk": `STATUS#${status}`,
  };
  const sets = ["#status = :status", "#updatedAt = :updatedAt", "#gsi2pk = :gsi2pk"];

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || key === "updatedAt") continue;
    const name = `#${key}`;
    const val = `:${key}`;
    names[name] = key;
    values[val] = value;
    sets.push(`${name} = ${val}`);
  }

  const result = await client.send(
    new UpdateCommand({
      TableName: config.commandTable,
      Key: { PK: `COMMAND#${commandId}`, SK: "STATUS" },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    })
  );

  return { ok: true, item: result.Attributes || null };
}

async function updateLatestReportedState(update, options = {}) {
  const config = resolveConfig(options);
  if (!config.commandTable) throw new Error("IOT_PHYSICAL_CONTROL_TABLE_NOT_CONFIGURED");
  const client = options.ddbDoc || ddbDoc;
  const receivedAt = update.receivedAt || nowIso(options);
  const result = await client.send(
    new UpdateCommand({
      TableName: config.commandTable,
      Key: {
        PK: `STORE#${update.storeId}`,
        SK: `PHYSICAL#ZONE#${update.zoneId}#DEVICE#${update.deviceId}`,
      },
      UpdateExpression: [
        "SET env = :env",
        "storeId = :storeId",
        "zoneId = :zoneId",
        "deviceId = :deviceId",
        "reportedState = :reportedState",
        "manualOverride = :manualOverride",
        "fault = :fault",
        "lastCommandId = :lastCommandId",
        "lastReportedAt = :receivedAt",
        "updatedAt = :receivedAt",
        "ttl = :ttl",
      ].join(", "),
      ExpressionAttributeValues: {
        ":env": update.env,
        ":storeId": update.storeId,
        ":zoneId": update.zoneId,
        ":deviceId": update.deviceId,
        ":reportedState": update.reportedState || {},
        ":manualOverride": update.manualOverride === true,
        ":fault": update.fault || null,
        ":lastCommandId": update.commandId || null,
        ":receivedAt": receivedAt,
        ":ttl": ttlEpochSeconds(config.commandTtlDays),
      },
      ReturnValues: "ALL_NEW",
    })
  );
  return { ok: true, item: result.Attributes || null };
}

function getIotDataClient(options = {}) {
  if (options.iotClient) return options.iotClient;
  const config = resolveConfig(options);
  if (!config.endpoint || !IoTDataPlaneClient || !PublishCommand) return null;
  return new IoTDataPlaneClient({
    region: options.region || REGION,
    endpoint: config.endpoint.startsWith("https://") ? config.endpoint : `https://${config.endpoint}`,
  });
}

async function publishPhysicalCommand(command, options = {}) {
  const client = getIotDataClient(options);
  if (!client || !PublishCommand) {
    return { ok: false, skipped: true, reason: "IOT_DATA_PLANE_NOT_CONFIGURED" };
  }

  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: command.schemaVersion,
      commandId: command.commandId,
      commandType: command.commandType,
      env: command.env,
      storeId: command.storeId,
      zoneId: command.zoneId,
      requestedZoneId: command.requestedZoneId,
      deviceId: command.deviceId,
      desiredState: command.desiredState,
      issuedAt: command.issuedAt,
      expiresAt: command.expiresAt,
      source: command.source,
      correlationId: command.correlationId || undefined,
      metadata: command.metadata || {},
    })
  );

  await client.send(new PublishCommand({ topic: command.topic, qos: 1, payload }));
  return { ok: true, topic: command.topic };
}

async function issuePhysicalControlCommand(input = {}, options = {}) {
  const config = resolveConfig(options);
  if (!config.commandTable) {
    return {
      ok: false,
      accepted: false,
      skipped: true,
      reason: "IOT_PHYSICAL_CONTROL_TABLE_NOT_CONFIGURED",
    };
  }

  const validation = validatePhysicalCommand(input, options);
  if (!validation.ok) {
    emitIotMetric("PhysicalCommandRejected", { zoneId: input.zoneId || "unknown" }, options);
    return { ok: false, accepted: false, reasonCodes: validation.errors };
  }

  const stored = await putCommandStatus(validation.command, options);
  if (stored.duplicate) {
    return {
      ok: true,
      accepted: false,
      duplicate: true,
      reason: stored.reason,
      command: stored.item,
    };
  }

  const publish = await publishPhysicalCommand(validation.command, options);
  const status = publish.ok ? "sent" : "failed";
  const updated = await updateCommandStatus(validation.command.commandId, status, {
    publish,
    sentAt: publish.ok ? nowIso(options) : null,
    failureReason: publish.ok ? null : publish.reason || "PUBLISH_FAILED",
  }, options);

  await broadcastPhysicalControlUpdate(updated.item || validation.command, options).catch(() => null);
  emitIotMetric(publish.ok ? "PhysicalCommandPublished" : "PhysicalCommandPublishFailed", validation.command, options);

  return {
    ok: publish.ok,
    accepted: publish.ok,
    commandId: validation.command.commandId,
    status,
    command: updated.item,
    publish,
  };
}

function extractIotPayload(event = {}) {
  const parsedBody = safeParseJson(event.body);
  const root = parsedBody.ok && isObject(parsedBody.value) ? parsedBody.value : event;
  const topic = cleanString(root.mqttTopic || root.topic || root.topicName || event.mqttTopic || event.topic);
  const payloadSource = Object.prototype.hasOwnProperty.call(root, "payload")
    ? root.payload
    : root.message || root.event || root;
  const parsedPayload = safeParseJson(payloadSource);
  if (!parsedPayload.ok || !isObject(parsedPayload.value)) {
    return { ok: false, topic, payload: null, errors: ["INVALID_JSON_PAYLOAD"] };
  }
  return { ok: true, topic, payload: parsedPayload.value, errors: [] };
}

function normalizeAck(payload = {}, topicInfo = {}, options = {}) {
  const receivedAt = nowIso(options);
  return {
    commandId: cleanString(payload.commandId),
    env: cleanString(payload.env || topicInfo.env || resolveConfig(options).env),
    storeId: cleanString(payload.storeId || topicInfo.storeId || resolveConfig(options).storeId),
    zoneId: cleanString(payload.zoneId || payload.requestedZoneId || "help"),
    deviceId: cleanString(payload.deviceId || topicInfo.deviceId),
    status: cleanString(payload.status).toLowerCase(),
    appliedState: normalizeReportedStatePayload(payload.appliedState || payload.state || {}),
    reason: cleanString(payload.reason || payload.message),
    receivedAt,
    metadata: isObject(payload.metadata) ? payload.metadata : {},
  };
}

function normalizeReportedStatePayload(input = {}) {
  const state = isObject(input) ? input : {};
  const lightingState = cleanString(state.lightingState || state.lighting || "").toLowerCase();
  const audioState = cleanString(state.audioState || state.audio || "").toLowerCase();
  return {
    ...(LIGHTING_STATES.includes(lightingState) ? { lightingState } : {}),
    ...(AUDIO_STATES.includes(audioState) ? { audioState } : {}),
    ...(state.track ? { track: cleanString(state.track) } : {}),
  };
}

function normalizeReportedState(payload = {}, topicInfo = {}, options = {}) {
  return {
    commandId: cleanString(payload.commandId || payload.lastCommandId),
    env: cleanString(payload.env || topicInfo.env || resolveConfig(options).env),
    storeId: cleanString(payload.storeId || topicInfo.storeId || resolveConfig(options).storeId),
    zoneId: cleanString(payload.zoneId || payload.requestedZoneId || "help"),
    deviceId: cleanString(payload.deviceId || topicInfo.deviceId),
    reportedState: normalizeReportedStatePayload(payload.reportedState || payload.state || payload),
    manualOverride: payload.manualOverride === true,
    fault: payload.fault || null,
    receivedAt: cleanString(payload.reportedAt || payload.timestamp) || nowIso(options),
    metadata: isObject(payload.metadata) ? payload.metadata : {},
  };
}

async function processPhysicalControlAck(event = {}, options = {}) {
  const extraction = extractIotPayload(event);
  if (!extraction.ok) return { ok: false, accepted: false, reasonCodes: extraction.errors };
  const topicInfo = parseMqttTopic(extraction.topic);
  const ack = normalizeAck(extraction.payload, topicInfo, options);
  const errors = [];
  if (!ack.commandId) errors.push("MISSING_COMMAND_ID");
  if (!ACK_STATUSES.includes(ack.status)) errors.push("INVALID_ACK_STATUS");
  if (!ack.deviceId) errors.push("MISSING_DEVICE_ID");
  if (topicInfo.ok && topicInfo.kind !== "device-ack") errors.push("TOPIC_TYPE_MISMATCH");
  if (errors.length) return { ok: false, accepted: false, reasonCodes: errors, ack };

  const existing = await getCommandStatus(ack.commandId, options);
  if (!existing.item) return { ok: false, accepted: false, reasonCodes: ["UNKNOWN_COMMAND"], ack };
  if (existing.item.deviceId !== ack.deviceId) return { ok: false, accepted: false, reasonCodes: ["ACK_DEVICE_MISMATCH"], ack };

  const status = ack.status;
  const updated = await updateCommandStatus(ack.commandId, status, {
    ack,
    appliedState: ack.appliedState,
    failureReason: TERMINAL_STATUSES.has(status) && status !== "applied" ? ack.reason || status : null,
    updatedAt: ack.receivedAt,
  }, options);

  const stateUpdate = await updateLatestReportedState({
    ...ack,
    reportedState: ack.appliedState,
  }, options).catch((error) => ({ ok: false, reason: error.message }));

  await broadcastPhysicalControlUpdate(updated.item || { ...ack, status }, options).catch(() => null);
  emitIotMetric("PhysicalCommandAckReceived", ack, options);

  return { ok: true, accepted: true, commandId: ack.commandId, status, ack, command: updated.item, stateUpdate };
}

async function processPhysicalReportedState(event = {}, options = {}) {
  const extraction = extractIotPayload(event);
  if (!extraction.ok) return { ok: false, accepted: false, reasonCodes: extraction.errors };
  const topicInfo = parseMqttTopic(extraction.topic);
  const reported = normalizeReportedState(extraction.payload, topicInfo, options);
  const errors = [];
  if (!reported.zoneId) errors.push("MISSING_ZONE_ID");
  if (!reported.deviceId) errors.push("MISSING_DEVICE_ID");
  if (topicInfo.ok && topicInfo.kind !== "device-reported-state") errors.push("TOPIC_TYPE_MISMATCH");
  if (errors.length) return { ok: false, accepted: false, reasonCodes: errors, reported };

  const stateUpdate = await updateLatestReportedState(reported, options);
  await broadcastPhysicalControlUpdate({
    ...reported,
    status: reported.fault ? "fault" : "reported",
    updatedAt: reported.receivedAt,
  }, options).catch(() => null);
  emitIotMetric("PhysicalReportedStateReceived", reported, options);

  return { ok: true, accepted: true, reported, stateUpdate };
}

function deriveCommandTimeoutResult(command, options = {}) {
  const nowMs = new Date(options.now || nowIso(options)).getTime();
  const expiresMs = new Date(command?.expiresAt || 0).getTime();
  if (!command || !Number.isFinite(expiresMs) || expiresMs > nowMs) {
    return { action: "wait", status: command?.status || "unknown" };
  }
  if (TERMINAL_STATUSES.has(command.status)) return { action: "none", status: command.status };
  if (Number(command.attempts || 1) < Number(command.maxAttempts || 1)) {
    return { action: "retry", status: "retrying", nextAttempts: Number(command.attempts || 1) + 1 };
  }
  return { action: "fail", status: "failed", reason: "COMMAND_ACK_TIMEOUT" };
}

async function sweepPhysicalControlTimeouts(event = {}, options = {}) {
  const config = resolveConfig(options);
  if (!config.commandTable) return { ok: false, skipped: true, reason: "IOT_PHYSICAL_CONTROL_TABLE_NOT_CONFIGURED" };
  const client = options.ddbDoc || ddbDoc;
  const now = nowIso(options);
  const result = await client.send(
    new ScanCommand({
      TableName: config.commandTable,
      FilterExpression: "begins_with(PK, :command) AND SK = :statusKey AND expiresAt <= :now AND NOT (#status IN (:applied, :rejected, :expired, :failed))",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":command": "COMMAND#",
        ":statusKey": "STATUS",
        ":now": now,
        ":applied": "applied",
        ":rejected": "rejected",
        ":expired": "expired",
        ":failed": "failed",
      },
      Limit: Number(event.limit || options.limit || 25),
    })
  );

  const processed = [];
  for (const item of result.Items || []) {
    const timeout = deriveCommandTimeoutResult(item, { now });
    if (timeout.action === "fail") {
      const updated = await updateCommandStatus(item.commandId, "failed", {
        failureReason: timeout.reason,
        updatedAt: now,
      }, options);
      await broadcastPhysicalControlUpdate(updated.item || item, options).catch(() => null);
      processed.push({ commandId: item.commandId, action: "failed" });
    }
  }
  return { ok: true, scanned: (result.Items || []).length, processed };
}

async function handleIotPhysicalControlAck(event, context) {
  return processPhysicalControlAck(event, { context });
}

async function handleIotPhysicalControlReportedState(event, context) {
  return processPhysicalReportedState(event, { context });
}

async function handleIotPhysicalControlTimeout(event, context) {
  return sweepPhysicalControlTimeouts(event, { context });
}

module.exports = {
  ACK_STATUSES,
  AUDIO_STATES,
  COMMAND_TYPES,
  LIGHTING_STATES,
  buildCommandTopic,
  deriveCommandTimeoutResult,
  handleIotPhysicalControlAck,
  handleIotPhysicalControlReportedState,
  handleIotPhysicalControlTimeout,
  issuePhysicalControlCommand,
  normalizeAck,
  normalizePhysicalCommand,
  normalizeReportedState,
  processPhysicalControlAck,
  processPhysicalReportedState,
  publishPhysicalCommand,
  sweepPhysicalControlTimeouts,
  updateLatestReportedState,
  validatePhysicalCommand,
};
