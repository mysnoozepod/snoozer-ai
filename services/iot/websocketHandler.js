const {
  authorizeZoneSubscriptions,
  getShowroomDevice,
  loadShowroomDeviceRegistry,
} = require("./showroomDeviceRegistry");
const { loadIotDeviceRegistry } = require("./iotRegistry");
const {
  cleanupExpiredWebSocketConnections,
  deleteWebSocketConnection,
  getWebSocketConnection,
  saveWebSocketConnection,
  subscribeConnectionToZones,
  unsubscribeConnectionFromZones,
} = require("./websocketConnections");

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeZoneIds(value) {
  if (Array.isArray(value)) return value.map(cleanString).filter(Boolean);
  const zoneId = cleanString(value);
  return zoneId ? [zoneId] : [];
}

function parseJsonBody(event = {}) {
  if (!event.body) return {};
  if (typeof event.body === "object") return event.body;
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

function jsonResponse(statusCode, body = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function getConnectionId(event = {}) {
  return cleanString(event.requestContext?.connectionId);
}

function getEndpoint(event = {}, options = {}) {
  if (options.endpoint) return options.endpoint;
  if (process.env.WEBSOCKET_API_ENDPOINT) return process.env.WEBSOCKET_API_ENDPOINT;
  const domainName = cleanString(event.requestContext?.domainName);
  const stage = cleanString(event.requestContext?.stage);
  return domainName && stage ? `https://${domainName}/${stage}` : "";
}

function getDeviceIdFromConnect(event = {}) {
  const query = event.queryStringParameters || {};
  const headers = event.headers || {};
  return cleanString(query.deviceId || query.device_id || headers["x-device-id"] || headers["X-Device-Id"]);
}

function loadRegistries(options = {}) {
  const env = cleanString(options.env || process.env.IOT_ENV);
  return {
    iotRegistry: options.iotRegistry || loadIotDeviceRegistry({ ...options, env }),
    deviceRegistry: options.deviceRegistry || loadShowroomDeviceRegistry({ ...options, env }),
  };
}

async function handleConnect(event, options = {}) {
  const connectionId = getConnectionId(event);
  const deviceId = getDeviceIdFromConnect(event);
  const { deviceRegistry } = loadRegistries(options);
  const device = getShowroomDevice(deviceRegistry, deviceId);

  if (!connectionId) {
    return jsonResponse(400, { ok: false, reason: "MISSING_CONNECTION_ID" });
  }

  if (!device || device.enabled !== true) {
    return jsonResponse(403, {
      ok: false,
      reason: device ? "DEVICE_DISABLED" : "UNKNOWN_DEVICE",
    });
  }

  const env = cleanString(options.env || process.env.IOT_ENV || deviceRegistry.env);
  const storeId = cleanString(options.storeId || process.env.IOT_STORE_ID || device.storeId || deviceRegistry.storeId);
  const sourceIp = cleanString(event.requestContext?.identity?.sourceIp);
  const headers = event.headers || {};

  await saveWebSocketConnection(
    {
      connectionId,
      endpoint: getEndpoint(event, options),
      env,
      storeId,
      deviceId: device.deviceId,
      deviceMode: device.deviceMode,
      podId: device.podId || null,
      sourceIp,
      userAgent: cleanString(headers["User-Agent"] || headers["user-agent"]),
      subscriptions: [],
    },
    options
  );

  return jsonResponse(200, {
    ok: true,
    connectionId,
    deviceId: device.deviceId,
    deviceMode: device.deviceMode,
  });
}

async function handleDisconnect(event, options = {}) {
  const connectionId = getConnectionId(event);
  if (connectionId) {
    await deleteWebSocketConnection(connectionId, options);
  }
  return jsonResponse(200, { ok: true, connectionId });
}

async function handleSubscribe(event, options = {}) {
  const connectionId = getConnectionId(event);
  const body = parseJsonBody(event);
  const zoneIds = normalizeZoneIds(body.zoneIds || body.zoneId);
  const connection = await getWebSocketConnection(connectionId, options);
  if (!connection) return jsonResponse(404, { ok: false, reason: "CONNECTION_NOT_FOUND" });

  const { iotRegistry, deviceRegistry } = loadRegistries(options);
  const device = getShowroomDevice(deviceRegistry, connection.deviceId);
  const auth = authorizeZoneSubscriptions(device, zoneIds, iotRegistry);
  if (!auth.ok) {
    return jsonResponse(403, {
      ok: false,
      reason: "SUBSCRIPTION_NOT_AUTHORIZED",
      rejected: auth.rejected,
    });
  }

  const subscription = await subscribeConnectionToZones(connection, auth.accepted, options);
  return jsonResponse(200, {
    ok: true,
    action: "subscribe",
    connectionId,
    zoneIds: subscription.subscribedZoneIds,
    subscriptions: subscription.subscriptions,
  });
}

async function handleUnsubscribe(event, options = {}) {
  const connectionId = getConnectionId(event);
  const body = parseJsonBody(event);
  const zoneIds = normalizeZoneIds(body.zoneIds || body.zoneId);
  const connection = await getWebSocketConnection(connectionId, options);
  if (!connection) return jsonResponse(404, { ok: false, reason: "CONNECTION_NOT_FOUND" });

  const result = await unsubscribeConnectionFromZones(connection, zoneIds, options);
  return jsonResponse(200, {
    ok: result.ok,
    action: "unsubscribe",
    connectionId,
    zoneIds: result.unsubscribedZoneIds || [],
    subscriptions: result.subscriptions || [],
    reason: result.reason || null,
  });
}

async function handleIotWebSocket(event, context, options = {}) {
  const routeKey = cleanString(event?.requestContext?.routeKey || parseJsonBody(event).action);
  if (routeKey === "$connect") return handleConnect(event, { ...options, context });
  if (routeKey === "$disconnect") return handleDisconnect(event, { ...options, context });
  if (routeKey === "subscribe") return handleSubscribe(event, { ...options, context });
  if (routeKey === "unsubscribe") return handleUnsubscribe(event, { ...options, context });
  return jsonResponse(400, { ok: false, reason: "UNSUPPORTED_WEBSOCKET_ROUTE", routeKey });
}

async function handleIotWebSocketCleanup(event, context, options = {}) {
  const cleanup = await cleanupExpiredWebSocketConnections({ ...options, context });
  return jsonResponse(200, cleanup);
}

module.exports = {
  getDeviceIdFromConnect,
  handleConnect,
  handleDisconnect,
  handleIotWebSocket,
  handleIotWebSocketCleanup,
  handleSubscribe,
  handleUnsubscribe,
  jsonResponse,
  parseJsonBody,
};
