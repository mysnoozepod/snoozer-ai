#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const ENV = process.env.IOT_ENV || "dev";
const STORE_ID = process.env.IOT_STORE_ID || "severn-pilot";
const IOT_ENDPOINT = String(process.env.IOT_DATA_ENDPOINT || "").trim();
const STATE_TABLE = process.env.IOT_ZONE_STATE_TABLE || `msp-${ENV}-zone-state`;
const CREDENTIAL_ROOT = process.env.IOT_DEVICE_CREDENTIAL_ROOT || path.join(
  process.env.USERPROFILE || "",
  ".mysnoozepod",
  "iot",
  ENV,
  STORE_ID
);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mqttString(value) {
  const body = Buffer.from(String(value), "utf8");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length, 0);
  return Buffer.concat([length, body]);
}

function remainingLength(value) {
  const bytes = [];
  let remaining = value;
  do {
    let digit = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) digit |= 0x80;
    bytes.push(digit);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function connectPacket(clientId) {
  const variableHeader = Buffer.concat([
    mqttString("MQTT"),
    Buffer.from([0x04, 0x02, 0x00, 0x3c]),
  ]);
  const payload = mqttString(clientId);
  const body = Buffer.concat([variableHeader, payload]);
  return Buffer.concat([Buffer.from([0x10]), remainingLength(body.length), body]);
}

function publishPacket(topic, payload) {
  const body = Buffer.concat([mqttString(topic), Buffer.from(payload)]);
  return Buffer.concat([Buffer.from([0x30]), remainingLength(body.length), body]);
}

function publishWithCertificate({ podNumber, event }) {
  const podId = `pod-${podNumber}`;
  const deviceId = `${podId}-edge-01`;
  const thingName = `msp-${ENV}-${STORE_ID}-${deviceId}`;
  const credentialDir = path.join(CREDENTIAL_ROOT, deviceId);
  const topic = `mysnoozepod/${ENV}/stores/${STORE_ID}/zones/${podId}/events`;

  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: IOT_ENDPOINT,
      port: 8883,
      servername: IOT_ENDPOINT,
      cert: fs.readFileSync(path.join(credentialDir, "device-certificate.pem.crt")),
      key: fs.readFileSync(path.join(credentialDir, "device-private.pem.key")),
      ca: fs.readFileSync(path.join(CREDENTIAL_ROOT, "AmazonRootCA1.pem")),
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`MQTT_CERTIFICATE_TIMEOUT:${podId}`));
    }, 12000);

    let connected = false;
    socket.once("secureConnect", () => socket.write(connectPacket(thingName)));
    socket.on("data", (chunk) => {
      if (connected || chunk.length < 4 || chunk[0] !== 0x20) return;
      if (chunk[3] !== 0x00) {
        clearTimeout(timeout);
        socket.destroy();
        reject(new Error(`MQTT_CONNACK_REJECTED:${podId}:${chunk[3]}`));
        return;
      }
      connected = true;
      socket.write(publishPacket(topic, JSON.stringify(event)), (error) => {
        if (error) {
          clearTimeout(timeout);
          socket.destroy();
          reject(error);
          return;
        }
        setTimeout(() => {
          clearTimeout(timeout);
          socket.end(Buffer.from([0xe0, 0x00]));
          resolve({ podId, thingName, topic });
        }, 400);
      });
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function createPresenceEvent(podNumber) {
  const podId = `pod-${podNumber}`;
  return {
    schemaVersion: "1.0",
    eventId: `device-cert-${podId}-${crypto.randomUUID()}`,
    env: ENV,
    storeId: STORE_ID,
    zoneId: podId,
    zoneType: "pod",
    podId,
    deviceId: `${podId}-edge-01`,
    sensorId: `${podId}-presence-01`,
    sensorType: "mmwave-presence",
    eventType: "presence_detected",
    state: "active",
    value: true,
    unit: null,
    confidence: 0.99,
    sequence: Date.now() + podNumber,
    timestamp: new Date().toISOString(),
    source: "edge-controller",
    firmwareVersion: "certificate-acceptance-1.0.0",
    sessionId: null,
    snoozeCode: null,
    metadata: { certificateAcceptance: true },
  };
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
    await wait(250);
  }
  throw new Error(`CERTIFICATE_PUBLISH_NOT_PERSISTED:${event.eventId}`);
}

async function main() {
  if (!IOT_ENDPOINT) throw new Error("IOT_DATA_ENDPOINT_REQUIRED");
  if (ENV !== "dev") throw new Error("DEVICE_CERTIFICATE_ACCEPTANCE_IS_DEV_ONLY");
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  const evidence = [];
  try {
    for (const podNumber of [1, 2]) {
      const event = createPresenceEvent(podNumber);
      const published = await publishWithCertificate({ podNumber, event });
      const persisted = await waitForPersistedEvent(ddb, event);
      evidence.push({
        zoneId: event.zoneId,
        thingName: published.thingName,
        eventId: event.eventId,
        persistedAt: persisted.lastReceivedAt,
      });
    }
  } finally {
    ddb.destroy();
  }
  console.log(JSON.stringify({
    ok: true,
    environment: ENV,
    storeId: STORE_ID,
    checks: {
      mutualTlsConnections: 2,
      leastPrivilegePublishes: 2,
      dynamodbLatestStatesVerified: 2,
    },
    evidence,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
