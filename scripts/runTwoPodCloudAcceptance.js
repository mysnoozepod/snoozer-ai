#!/usr/bin/env node

const crypto = require("node:crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { IoTDataPlaneClient, PublishCommand } = require("@aws-sdk/client-iot-data-plane");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const ENV = process.env.IOT_ENV || "dev";
const STORE_ID = process.env.IOT_STORE_ID || "severn-pilot";
const WEBSOCKET_URL = String(process.env.IOT_WEBSOCKET_URL || "").trim();
const IOT_ENDPOINT = String(process.env.IOT_DATA_ENDPOINT || "").trim();
const STATE_TABLE = process.env.IOT_ZONE_STATE_TABLE || `msp-${ENV}-zone-state`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createEvent(podNumber, eventType, value) {
  const podId = `pod-${podNumber}`;
  const occupied = eventType === "pod_occupied" || eventType === "pod_vacated";
  return {
    schemaVersion: "1.0",
    eventId: `pilot-${podId}-${crypto.randomUUID()}`,
    env: ENV,
    storeId: STORE_ID,
    zoneId: podId,
    zoneType: "pod",
    podId,
    deviceId: `${podId}-edge-01`,
    sensorId: `${podId}-${occupied ? "occupancy" : "presence"}-01`,
    sensorType: occupied ? "bed-occupancy" : "mmwave-presence",
    eventType,
    state: value ? "active" : "inactive",
    value,
    unit: null,
    confidence: 0.99,
    sequence: Date.now() + podNumber,
    timestamp: new Date().toISOString(),
    source: "edge-controller",
    firmwareVersion: "acceptance-1.0.0",
    sessionId: null,
    snoozeCode: null,
    metadata: { acceptanceRun: true },
  };
}

function createZoneSocket(deviceId, zoneId) {
  const url = new URL(WEBSOCKET_URL);
  url.searchParams.set("deviceId", deviceId);
  const messages = [];
  const socket = new WebSocket(url);

  const opened = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`WEBSOCKET_OPEN_TIMEOUT:${deviceId}`)), 10000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      socket.send(JSON.stringify({ action: "subscribe", zoneIds: [zoneId] }));
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`WEBSOCKET_OPEN_FAILED:${deviceId}`));
    }, { once: true });
  });

  socket.addEventListener("message", (message) => {
    try {
      messages.push(JSON.parse(String(message.data || "{}")));
    } catch {
      messages.push({ invalidJson: true });
    }
  });

  return { socket, messages, opened };
}

async function publishEvent(client, event) {
  const topic = `mysnoozepod/${ENV}/stores/${STORE_ID}/zones/${event.zoneId}/events`;
  await client.send(new PublishCommand({
    topic,
    qos: 1,
    payload: Buffer.from(JSON.stringify(event)),
  }));
}

async function waitForMessage(messages, eventId, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = messages.find((message) => message?.type === "zone_event" && message?.eventId === eventId);
    if (found) return found;
    await wait(100);
  }
  throw new Error(`WEBSOCKET_EVENT_TIMEOUT:${eventId}`);
}

async function waitForPersistedEvent(ddb, event, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await ddb.send(new GetCommand({
      TableName: STATE_TABLE,
      Key: { PK: `STORE#${STORE_ID}`, SK: `ZONE#${event.zoneId}` },
      ConsistentRead: true,
    }));
    if (result.Item?.lastEventId === event.eventId) return result.Item;
    await wait(200);
  }
  throw new Error(`DYNAMODB_EVENT_TIMEOUT:${event.eventId}`);
}

async function main() {
  if (!WEBSOCKET_URL) throw new Error("IOT_WEBSOCKET_URL_REQUIRED");
  if (!IOT_ENDPOINT) throw new Error("IOT_DATA_ENDPOINT_REQUIRED");
  if (ENV === "prod" && process.env.ALLOW_PROD_ACCEPTANCE !== "true") {
    throw new Error("PROD_ACCEPTANCE_REQUIRES_ALLOW_PROD_ACCEPTANCE_TRUE");
  }

  const iot = new IoTDataPlaneClient({ region: REGION, endpoint: `https://${IOT_ENDPOINT}` });
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  const pod1 = createZoneSocket("pod-1-ipad-01", "pod-1");
  const pod2 = createZoneSocket("pod-2-ipad-01", "pod-2");
  let pod1Reconnect = null;
  const startedAt = new Date().toISOString();

  try {
    await Promise.all([pod1.opened, pod2.opened]);
    await wait(750);

    const pod1Event = createEvent(1, "presence_detected", true);
    await publishEvent(iot, pod1Event);
    const pod1Broadcast = await waitForMessage(pod1.messages, pod1Event.eventId);
    const pod1State = await waitForPersistedEvent(ddb, pod1Event);
    await wait(500);
    if (pod2.messages.some((message) => message?.eventId === pod1Event.eventId)) {
      throw new Error("CROSS_POD_LEAK:POD1_EVENT_REACHED_POD2");
    }

    const pod2Event = createEvent(2, "pod_occupied", true);
    await publishEvent(iot, pod2Event);
    const pod2Broadcast = await waitForMessage(pod2.messages, pod2Event.eventId);
    const pod2State = await waitForPersistedEvent(ddb, pod2Event);
    await wait(500);
    if (pod1.messages.some((message) => message?.eventId === pod2Event.eventId)) {
      throw new Error("CROSS_POD_LEAK:POD2_EVENT_REACHED_POD1");
    }

    pod1.socket.close();
    await wait(500);
    pod1Reconnect = createZoneSocket("pod-1-ipad-01", "pod-1");
    await pod1Reconnect.opened;
    await wait(750);
    const reconnectEvent = createEvent(1, "presence_cleared", false);
    reconnectEvent.sequence = pod1Event.sequence + 1000;
    await publishEvent(iot, reconnectEvent);
    const reconnectBroadcast = await waitForMessage(pod1Reconnect.messages, reconnectEvent.eventId);
    const reconnectState = await waitForPersistedEvent(ddb, reconnectEvent);
    await wait(500);
    if (pod2.messages.some((message) => message?.eventId === reconnectEvent.eventId)) {
      throw new Error("CROSS_POD_LEAK:RECONNECTED_POD1_EVENT_REACHED_POD2");
    }

    console.log(JSON.stringify({
      ok: true,
      environment: ENV,
      storeId: STORE_ID,
      startedAt,
      completedAt: new Date().toISOString(),
      checks: {
        websocketConnections: 2,
        zoneSubscriptionsIsolated: true,
        reconnectResubscribed: true,
        mqttPublishesAccepted: 3,
        websocketBroadcastsReceived: 3,
        dynamodbLatestStatesVerified: 3,
      },
      evidence: [
        { zoneId: "pod-1", eventId: pod1Event.eventId, broadcastAt: pod1Broadcast.broadcastAt, persistedAt: pod1State.lastReceivedAt },
        { zoneId: "pod-2", eventId: pod2Event.eventId, broadcastAt: pod2Broadcast.broadcastAt, persistedAt: pod2State.lastReceivedAt },
        { zoneId: "pod-1", eventId: reconnectEvent.eventId, broadcastAt: reconnectBroadcast.broadcastAt, persistedAt: reconnectState.lastReceivedAt, reconnect: true },
      ],
    }, null, 2));
  } finally {
    pod1.socket.close();
    pod2.socket.close();
    pod1Reconnect?.socket?.close();
    iot.destroy();
    ddb.destroy();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
