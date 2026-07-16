const {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} = require("@aws-sdk/client-apigatewaymanagementapi");
const {
  deleteWebSocketConnection,
  listConnectionsForZone,
} = require("./websocketConnections");

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function isGoneConnectionError(error) {
  return (
    error?.name === "GoneException" ||
    error?.$metadata?.httpStatusCode === 410 ||
    /GoneException|status code: 410|410/.test(String(error?.message || ""))
  );
}

function getApiClient(options = {}) {
  if (options.apiClient) return options.apiClient;
  const endpoint = cleanString(options.endpoint || process.env.WEBSOCKET_API_ENDPOINT);
  if (!endpoint) return null;
  return new ApiGatewayManagementApiClient({ endpoint });
}

function buildZoneEventBroadcastPayload(event, options = {}) {
  return {
    type: "zone_event",
    event: "zone_event.accepted",
    schemaVersion: "1.0",
    broadcastAt: options.broadcastAt || new Date().toISOString(),
    eventId: event.eventId,
    env: event.env,
    storeId: event.storeId,
    zoneId: event.zoneId,
    zoneType: event.zoneType,
    podId: event.podId || null,
    deviceId: event.deviceId,
    sensorId: event.sensorId,
    sensorType: event.sensorType,
    eventType: event.eventType,
    state: event.state,
    value: event.value,
    confidence: event.confidence,
    sequence: event.sequence,
    timestamp: event.timestamp,
    sessionId: event.sessionId || null,
    snoozeCode: event.snoozeCode || null,
    metadata: event.metadata || {},
  };
}

function buildPhysicalControlBroadcastPayload(update, options = {}) {
  return {
    type: "physical_control",
    event: "physical_control.updated",
    schemaVersion: "1.0",
    broadcastAt: options.broadcastAt || new Date().toISOString(),
    commandId: update.commandId || null,
    env: update.env,
    storeId: update.storeId,
    zoneId: update.zoneId,
    deviceId: update.deviceId,
    commandType: update.commandType || null,
    status: update.status || null,
    desiredState: update.desiredState || {},
    appliedState: update.appliedState || {},
    reportedState: update.reportedState || {},
    manualOverride: update.manualOverride === true,
    fault: update.fault || null,
    ack: update.ack || null,
    updatedAt: update.updatedAt || update.receivedAt || new Date().toISOString(),
    metadata: update.metadata || {},
  };
}

async function postToConnection(client, connectionId, payload) {
  await client.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload)),
    })
  );
}

async function broadcastZoneEvent(event, options = {}) {
  if (!event?.storeId || !event?.zoneId) {
    return { ok: false, skipped: true, reason: "MISSING_EVENT_ZONE" };
  }

  const tableName = options.tableName || process.env.WEBSOCKET_CONNECTIONS_TABLE;
  const apiClient = getApiClient(options);
  if (!tableName || !apiClient) {
    return {
      ok: false,
      skipped: true,
      reason: !tableName ? "WEBSOCKET_CONNECTIONS_TABLE_NOT_CONFIGURED" : "WEBSOCKET_API_ENDPOINT_NOT_CONFIGURED",
    };
  }

  const subscribers = await listConnectionsForZone(event.storeId, event.zoneId, options);
  const payload = buildZoneEventBroadcastPayload(event, options);
  const result = {
    ok: true,
    zoneId: event.zoneId,
    eventId: event.eventId,
    attempted: subscribers.length,
    delivered: 0,
    goneDeleted: 0,
    failed: 0,
  };

  for (const subscriber of subscribers) {
    try {
      await postToConnection(apiClient, subscriber.connectionId, payload);
      result.delivered += 1;
    } catch (error) {
      if (isGoneConnectionError(error)) {
        await deleteWebSocketConnection(subscriber.connectionId, options);
        result.goneDeleted += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  return result;
}

async function broadcastPhysicalControlUpdate(update, options = {}) {
  if (!update?.storeId || !update?.zoneId) {
    return { ok: false, skipped: true, reason: "MISSING_PHYSICAL_CONTROL_ZONE" };
  }

  const tableName = options.tableName || process.env.WEBSOCKET_CONNECTIONS_TABLE;
  const apiClient = getApiClient(options);
  if (!tableName || !apiClient) {
    return {
      ok: false,
      skipped: true,
      reason: !tableName ? "WEBSOCKET_CONNECTIONS_TABLE_NOT_CONFIGURED" : "WEBSOCKET_API_ENDPOINT_NOT_CONFIGURED",
    };
  }

  const subscribers = await listConnectionsForZone(update.storeId, update.zoneId, options);
  const payload = buildPhysicalControlBroadcastPayload(update, options);
  const result = {
    ok: true,
    zoneId: update.zoneId,
    commandId: update.commandId || null,
    attempted: subscribers.length,
    delivered: 0,
    goneDeleted: 0,
    failed: 0,
  };

  for (const subscriber of subscribers) {
    try {
      await postToConnection(apiClient, subscriber.connectionId, payload);
      result.delivered += 1;
    } catch (error) {
      if (isGoneConnectionError(error)) {
        await deleteWebSocketConnection(subscriber.connectionId, options);
        result.goneDeleted += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  return result;
}

module.exports = {
  broadcastZoneEvent,
  broadcastPhysicalControlUpdate,
  buildPhysicalControlBroadcastPayload,
  buildZoneEventBroadcastPayload,
  getApiClient,
  isGoneConnectionError,
};
