#!/usr/bin/env node

const assert = require("assert");
const {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");

const { loadIotDeviceRegistry } = require("../services/iot/iotRegistry");
const {
  buildShowroomDeviceRegistryIndexes,
  loadShowroomDeviceRegistry,
} = require("../services/iot/showroomDeviceRegistry");
const { broadcastZoneEvent } = require("../services/iot/zoneEventBroadcaster");
const { handleIotWebSocket } = require("../services/iot/websocketHandler");
const { processZoneEvent } = require("../services/iot/zoneEventIngestion");

const iotRegistry = loadIotDeviceRegistry();
const deviceRegistry = loadShowroomDeviceRegistry();

function parseBody(response) {
  return JSON.parse(response.body || "{}");
}

function wsEvent(routeKey, connectionId, body = {}, query = {}) {
  return {
    requestContext: {
      routeKey,
      connectionId,
      domainName: "abc123.execute-api.us-east-1.amazonaws.com",
      stage: "dev",
      identity: { sourceIp: "127.0.0.1" },
    },
    queryStringParameters: query,
    headers: { "User-Agent": "node-test" },
    body: body ? JSON.stringify(body) : undefined,
  };
}

class MockWsDdb {
  constructor() {
    this.items = new Map();
    this.commands = [];
  }

  async send(command) {
    this.commands.push(command);

    if (command instanceof PutCommand) {
      this.items.set(command.input.Item.PK, { ...command.input.Item });
      return {};
    }

    if (command instanceof GetCommand) {
      return { Item: this.items.get(command.input.Key.PK) || null };
    }

    if (command instanceof BatchWriteCommand) {
      for (const request of command.input.RequestItems.websocket_connections_test || []) {
        if (request.PutRequest) this.items.set(request.PutRequest.Item.PK, { ...request.PutRequest.Item });
        if (request.DeleteRequest) this.items.delete(request.DeleteRequest.Key.PK);
      }
      return {};
    }

    if (command instanceof UpdateCommand) {
      const item = this.items.get(command.input.Key.PK) || { PK: command.input.Key.PK };
      if (command.input.ExpressionAttributeValues[":subscriptions"]) {
        item.subscriptions = command.input.ExpressionAttributeValues[":subscriptions"];
      }
      if (command.input.ExpressionAttributeValues[":updatedAt"]) {
        item.updatedAt = command.input.ExpressionAttributeValues[":updatedAt"];
      }
      this.items.set(item.PK, item);
      return {};
    }

    if (command instanceof QueryCommand) {
      const zoneKey = command.input.ExpressionAttributeValues[":zoneKey"];
      return {
        Items: Array.from(this.items.values()).filter((item) => item.GSI1PK === zoneKey),
      };
    }

    return {};
  }
}

class MockApiClient {
  constructor(options = {}) {
    this.posts = [];
    this.goneConnectionIds = new Set(options.goneConnectionIds || []);
  }

  async send(command) {
    assert(command instanceof PostToConnectionCommand, "broadcast should post to WebSocket connections");
    this.posts.push(command.input);
    if (this.goneConnectionIds.has(command.input.ConnectionId)) {
      const error = new Error("GoneException");
      error.name = "GoneException";
      error.$metadata = { httpStatusCode: 410 };
      throw error;
    }
    return {};
  }
}

class OrderedIngestDdb extends MockWsDdb {
  constructor() {
    super();
    this.order = [];
  }

  async send(command) {
    if (command instanceof TransactWriteCommand) {
      this.order.push("persist-history");
      return {};
    }
    if (command instanceof UpdateCommand) {
      this.order.push("persist-latest");
      return {};
    }
    if (command instanceof QueryCommand) {
      this.order.push("query-subscribers");
      return {
        Items: [
          {
            connectionId: "conn-broadcast",
            storeId: "severn-pilot",
            zoneId: "pod-3",
            endpoint: "https://example/dev",
          },
        ],
      };
    }
    return super.send(command);
  }
}

async function testConnectValidDevice() {
  const ddbDoc = new MockWsDdb();
  const response = await handleIotWebSocket(
    wsEvent("$connect", "conn-1", null, { deviceId: "pod-3-ipad-01" }),
    {},
    { ddbDoc, tableName: "websocket_connections_test", iotRegistry, deviceRegistry }
  );
  const body = parseBody(response);
  assert.equal(response.statusCode, 200);
  assert.equal(body.deviceId, "pod-3-ipad-01");
  assert.equal(ddbDoc.items.get("CONNECTION#conn-1").deviceMode, "pod-ipad");
}

async function testConnectUnknownDeviceRejected() {
  const response = await handleIotWebSocket(
    wsEvent("$connect", "conn-unknown", null, { deviceId: "mystery-device" }),
    {},
    { ddbDoc: new MockWsDdb(), tableName: "websocket_connections_test", iotRegistry, deviceRegistry }
  );
  assert.equal(response.statusCode, 403);
  assert.equal(parseBody(response).reason, "UNKNOWN_DEVICE");
}

async function testPodCanSubscribeOnlyAssignedPod() {
  const ddbDoc = new MockWsDdb();
  await handleIotWebSocket(
    wsEvent("$connect", "conn-pod", null, { deviceId: "pod-3-ipad-01" }),
    {},
    { ddbDoc, tableName: "websocket_connections_test", iotRegistry, deviceRegistry }
  );

  const allowed = await handleIotWebSocket(
    wsEvent("subscribe", "conn-pod", { action: "subscribe", zoneId: "pod-3" }),
    {},
    { ddbDoc, tableName: "websocket_connections_test", iotRegistry, deviceRegistry }
  );
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(parseBody(allowed).zoneIds, ["pod-3"]);

  const rejected = await handleIotWebSocket(
    wsEvent("subscribe", "conn-pod", { action: "subscribe", zoneId: "pod-4" }),
    {},
    { ddbDoc, tableName: "websocket_connections_test", iotRegistry, deviceRegistry }
  );
  assert.equal(rejected.statusCode, 403);
  assert.equal(parseBody(rejected).rejected[0].reason, "ZONE_NOT_AUTHORIZED_FOR_DEVICE");
}

async function testAdminCanSubscribeAllZones() {
  const ddbDoc = new MockWsDdb();
  await handleIotWebSocket(
    wsEvent("$connect", "conn-admin", null, { deviceId: "admin-dev" }),
    {},
    { ddbDoc, tableName: "websocket_connections_test", iotRegistry, deviceRegistry }
  );

  const response = await handleIotWebSocket(
    wsEvent("subscribe", "conn-admin", { action: "subscribe", zoneIds: ["pod-1", "checkout-zone"] }),
    {},
    { ddbDoc, tableName: "websocket_connections_test", iotRegistry, deviceRegistry }
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(parseBody(response).zoneIds, ["pod-1", "checkout-zone"]);
}

async function testWelcomeAndSpecialKioskZones() {
  const ddbDoc = new MockWsDdb();
  const pairs = [
    ["welcome-01", "welcome-kiosk"],
    ["ask-snoozer-01", "ask-snoozer"],
    ["sleep-essentials-01", "sleep-essentials-zone"],
    ["checkout-01", "checkout-zone"],
  ];

  for (const [deviceId, zoneId] of pairs) {
    const connectionId = `conn-${deviceId}`;
    await handleIotWebSocket(
      wsEvent("$connect", connectionId, null, { deviceId }),
      {},
      { ddbDoc, tableName: "websocket_connections_test", iotRegistry, deviceRegistry }
    );
    const response = await handleIotWebSocket(
      wsEvent("subscribe", connectionId, { action: "subscribe", zoneId }),
      {},
      { ddbDoc, tableName: "websocket_connections_test", iotRegistry, deviceRegistry }
    );
    assert.equal(response.statusCode, 200, `${deviceId} should subscribe to ${zoneId}`);
  }
}

async function testBroadcastToZoneAndDeleteGone() {
  const ddbDoc = new MockWsDdb();
  const apiClient = new MockApiClient({ goneConnectionIds: ["conn-gone"] });
  ddbDoc.items.set("SUBSCRIPTION#ZONE#pod-3#CONNECTION#conn-live", {
    PK: "SUBSCRIPTION#ZONE#pod-3#CONNECTION#conn-live",
    itemType: "subscription",
    connectionId: "conn-live",
    storeId: "severn-pilot",
    zoneId: "pod-3",
    GSI1PK: "STORE#severn-pilot#ZONE#pod-3",
    GSI1SK: "CONNECTION#conn-live",
  });
  ddbDoc.items.set("CONNECTION#conn-gone", {
    PK: "CONNECTION#conn-gone",
    connectionId: "conn-gone",
    subscriptions: ["pod-3"],
  });
  ddbDoc.items.set("SUBSCRIPTION#ZONE#pod-3#CONNECTION#conn-gone", {
    PK: "SUBSCRIPTION#ZONE#pod-3#CONNECTION#conn-gone",
    itemType: "subscription",
    connectionId: "conn-gone",
    storeId: "severn-pilot",
    zoneId: "pod-3",
    GSI1PK: "STORE#severn-pilot#ZONE#pod-3",
    GSI1SK: "CONNECTION#conn-gone",
  });

  const result = await broadcastZoneEvent(
    {
      eventId: "evt-broadcast-1",
      env: "prod",
      storeId: "severn-pilot",
      zoneId: "pod-3",
      zoneType: "pod",
      podId: "pod-3",
      deviceId: "pod-3-edge-01",
      sensorId: "pod-3-presence-01",
      sensorType: "mmwave-presence",
      eventType: "presence_detected",
      state: "active",
      value: true,
      confidence: 0.9,
      sequence: 1,
      timestamp: "2026-07-16T12:00:00.000Z",
    },
    { ddbDoc, apiClient, tableName: "websocket_connections_test" }
  );

  assert.equal(result.attempted, 2);
  assert.equal(result.delivered, 1);
  assert.equal(result.goneDeleted, 1);
  assert.equal(apiClient.posts[0].ConnectionId, "conn-live");
  assert.equal(ddbDoc.items.has("CONNECTION#conn-gone"), false);
}

async function testIngestionBroadcastsAfterPersistence() {
  const ddbDoc = new OrderedIngestDdb();
  const apiClient = new MockApiClient();
  const result = await processZoneEvent(
    {
      mqttTopic: "mysnoozepod/prod/stores/severn-pilot/zones/pod-3/events",
      payload: {
        schemaVersion: "1.0",
        eventId: "evt-ingest-broadcast-order",
        env: "prod",
        storeId: "severn-pilot",
        zoneId: "pod-3",
        zoneType: "pod",
        podId: "pod-3",
        deviceId: "pod-3-edge-01",
        sensorId: "pod-3-presence-01",
        sensorType: "mmwave-presence",
        eventType: "presence_detected",
        state: "active",
        value: true,
        unit: null,
        confidence: 0.94,
        sequence: 1,
        timestamp: "2026-07-16T12:00:00.000Z",
        source: "edge-controller",
        firmwareVersion: "1.0.0",
        sessionId: null,
        snoozeCode: null,
        metadata: {},
      },
    },
    {
      env: "prod",
      storeId: "severn-pilot",
      stateTable: "iot_zone_state_test",
      eventsTable: "iot_zone_events_test",
      tableName: "websocket_connections_test",
      apiClient,
      endpoint: "https://example/dev",
      ddbDoc,
      registry: iotRegistry,
      now: new Date("2026-07-16T12:00:10.000Z"),
      logger: () => {},
      metricSink: () => {},
    }
  );

  assert.equal(result.accepted, true);
  assert.deepEqual(ddbDoc.order, ["persist-history", "persist-latest", "query-subscribers"]);
  assert.equal(apiClient.posts.length, 1);
}

async function main() {
  const tests = [
    ["connect_valid_device", testConnectValidDevice],
    ["connect_unknown_device_rejected", testConnectUnknownDeviceRejected],
    ["pod_can_subscribe_only_assigned_pod", testPodCanSubscribeOnlyAssignedPod],
    ["admin_can_subscribe_all_zones", testAdminCanSubscribeAllZones],
    ["welcome_and_special_kiosk_zones", testWelcomeAndSpecialKioskZones],
    ["broadcast_to_zone_and_delete_gone", testBroadcastToZoneAndDeleteGone],
    ["ingestion_broadcasts_after_persistence", testIngestionBroadcastsAfterPersistence],
  ];

  const failures = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL ${name}: ${error.stack || error.message}`);
    }
  }

  if (failures.length) process.exit(1);
  console.log(`\nAll ${tests.length} IoT WebSocket tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
