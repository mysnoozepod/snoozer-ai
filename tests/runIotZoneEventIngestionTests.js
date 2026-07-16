#!/usr/bin/env node

const assert = require("assert");
const { TransactWriteCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { SendMessageCommand } = require("@aws-sdk/client-sqs");

const { loadIotDeviceRegistry } = require("../services/iot/iotRegistry");
const { processZoneEvent } = require("../services/iot/zoneEventIngestion");

const registry = loadIotDeviceRegistry();
const BASE_NOW = new Date("2026-07-16T12:00:10.000Z");
let nextId = 1;

function conditionalError(name = "ConditionalCheckFailedException") {
  const error = new Error("conditional failure");
  error.name = name;
  return error;
}

class MockDdb {
  constructor(options = {}) {
    this.commands = [];
    this.historyItems = [];
    this.idempotencyItems = [];
    this.latestUpdates = [];
    this.eventIds = new Set();
    this.duplicateEventIds = new Set(options.duplicateEventIds || []);
    this.staleLatestEventIds = new Set(options.staleLatestEventIds || []);
  }

  async send(command) {
    this.commands.push(command);

    if (command instanceof TransactWriteCommand) {
      const idempotencyItem = command.input.TransactItems[0].Put.Item;
      const historyItem = command.input.TransactItems[1].Put.Item;

      if (this.duplicateEventIds.has(idempotencyItem.eventId) || this.eventIds.has(idempotencyItem.eventId)) {
        throw conditionalError("TransactionCanceledException");
      }

      this.eventIds.add(idempotencyItem.eventId);
      this.idempotencyItems.push(idempotencyItem);
      this.historyItems.push(historyItem);
      return {};
    }

    if (command instanceof UpdateCommand) {
      const eventId = command.input.ExpressionAttributeValues[":eventId"];
      if (this.staleLatestEventIds.has(eventId)) {
        throw conditionalError();
      }

      this.latestUpdates.push(command.input);
      return {};
    }

    return {};
  }
}

class MockSqs {
  constructor(options = {}) {
    this.messages = [];
    this.fail = options.fail === true;
  }

  async send(command) {
    assert(command instanceof SendMessageCommand, "quarantine must use SendMessageCommand");
    if (this.fail) {
      const error = new Error("sqs unavailable");
      error.name = "ServiceUnavailable";
      throw error;
    }
    this.messages.push(JSON.parse(command.input.MessageBody));
    return { MessageId: `msg-${this.messages.length}` };
  }
}

function topicFor(event, kind = "zone") {
  if (kind === "heartbeat") {
    return `mysnoozepod/${event.env}/stores/${event.storeId}/devices/${event.deviceId}/heartbeat`;
  }
  if (kind === "fault") {
    return `mysnoozepod/${event.env}/stores/${event.storeId}/devices/${event.deviceId}/fault`;
  }
  return `mysnoozepod/${event.env}/stores/${event.storeId}/zones/${event.zoneId}/events`;
}

function validEvent(overrides = {}) {
  const event = {
    schemaVersion: "1.0",
    eventId: `evt-iot-${String(nextId++).padStart(4, "0")}`,
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
    sequence: nextId,
    timestamp: "2026-07-16T12:00:00.000Z",
    source: "edge-controller",
    firmwareVersion: "1.0.0",
    sessionId: null,
    snoozeCode: null,
    metadata: {
      bootId: "boot-1",
    },
    ...overrides,
  };
  return event;
}

async function ingest(event, options = {}) {
  const ddbDoc = options.ddbDoc || new MockDdb();
  const sqsClient = options.sqsClient || new MockSqs();
  const logs = [];
  const metrics = [];
  const result = await processZoneEvent(
    {
      mqttTopic: options.topic || topicFor(event, options.topicKind),
      payload: event,
    },
    {
      env: options.env || "prod",
      storeId: options.storeId || "severn-pilot",
      stateTable: "iot_zone_state_test",
      eventsTable: "iot_zone_events_test",
      quarantineQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/iot-quarantine-test",
      eventTtlDays: 180,
      registry,
      ddbDoc,
      sqsClient,
      now: options.now || BASE_NOW,
      staleWindowMs: options.staleWindowMs,
      logger: (line) => logs.push(JSON.parse(line)),
      metricSink: (line) => metrics.push(JSON.parse(line)),
    }
  );
  return { result, ddbDoc, sqsClient, logs, metrics };
}

async function testValidPresenceEvent() {
  const { result, ddbDoc } = await ingest(validEvent());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(ddbDoc.historyItems.length, 1);
  assert.strictEqual(ddbDoc.latestUpdates.length, 1);
}

async function testValidOccupancyEvent() {
  const event = validEvent({
    sensorId: "pod-3-occupancy-01",
    sensorType: "bed-occupancy",
    eventType: "pod_occupied",
    state: "active",
  });
  const { result } = await ingest(event);
  assert.strictEqual(result.accepted, true);
}

async function testValidHeartbeat() {
  const event = validEvent({
    eventType: "device_heartbeat",
    sensorId: "pod-3-edge-01",
    sensorType: "device-heartbeat",
    value: { uptimeSeconds: 30 },
  });
  const { result } = await ingest(event, { topicKind: "heartbeat" });
  assert.strictEqual(result.accepted, true);
}

async function testValidFault() {
  const event = validEvent({
    eventType: "device_fault",
    state: "error",
    sensorId: "pod-3-edge-01",
    sensorType: "device-fault",
    value: { faultCode: "SENSOR_OFFLINE" },
    metadata: { faultCode: "SENSOR_OFFLINE" },
  });
  const { result } = await ingest(event, { topicKind: "fault" });
  assert.strictEqual(result.accepted, true);
}

async function testMissingRequiredFieldQuarantines() {
  const event = validEvent();
  delete event.eventId;
  const { result, ddbDoc, sqsClient } = await ingest(event);
  assert.strictEqual(result.rejected, true);
  assert(result.reasonCodes.includes("MISSING_EVENTID"));
  assert.strictEqual(ddbDoc.commands.length, 0);
  assert.strictEqual(sqsClient.messages.length, 1);
}

async function testInvalidEnvironmentQuarantines() {
  const event = validEvent({ env: "dev" });
  const { result } = await ingest(event, { topic: topicFor(event) });
  assert.strictEqual(result.rejected, true);
  assert(result.reasonCodes.includes("ENV_CONFIG_MISMATCH"));
}

async function testInvalidStoreQuarantines() {
  const event = validEvent({ storeId: "wrong-store" });
  const { result } = await ingest(event, { topic: topicFor(event), storeId: "severn-pilot" });
  assert.strictEqual(result.rejected, true);
  assert(result.reasonCodes.includes("STORE_CONFIG_MISMATCH"));
}

async function testInvalidZoneQuarantines() {
  const event = validEvent({ zoneId: "garage", zoneType: "kiosk", podId: null });
  const { result } = await ingest(event, { topic: topicFor(event) });
  assert.strictEqual(result.rejected, true);
  assert(result.reasonCodes.includes("UNREGISTERED_ZONE"));
}

async function testUnregisteredDeviceQuarantines() {
  const event = validEvent({ deviceId: "unknown-edge-01" });
  const { result } = await ingest(event);
  assert.strictEqual(result.rejected, true);
  assert(result.reasonCodes.includes("UNREGISTERED_DEVICE"));
}

async function testUnregisteredSensorQuarantines() {
  const event = validEvent({ sensorId: "pod-3-unknown-01" });
  const { result } = await ingest(event);
  assert.strictEqual(result.rejected, true);
  assert(result.reasonCodes.includes("UNREGISTERED_SENSOR"));
}

async function testTopicPayloadMismatchQuarantines() {
  const event = validEvent();
  const { result } = await ingest(event, {
    topic: `mysnoozepod/prod/stores/severn-pilot/zones/pod-4/events`,
  });
  assert.strictEqual(result.rejected, true);
  assert(result.reasonCodes.includes("TOPIC_ZONE_MISMATCH"));
}

async function testDuplicateEventSuppressed() {
  const ddbDoc = new MockDdb();
  const event = validEvent({ eventId: "evt-duplicate-1" });
  const first = await ingest(event, { ddbDoc });
  const duplicate = await ingest(event, { ddbDoc });

  assert.strictEqual(first.result.accepted, true);
  assert.strictEqual(duplicate.result.duplicate, true);
  assert.strictEqual(ddbDoc.historyItems.length, 1);
  assert.strictEqual(ddbDoc.latestUpdates.length, 1);
}

async function testStaleSequenceDoesNotOverwriteLatest() {
  const event = validEvent({ eventId: "evt-stale-sequence-1" });
  const ddbDoc = new MockDdb({ staleLatestEventIds: [event.eventId] });
  const { result } = await ingest(event, { ddbDoc });

  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.stale, true);
  assert.strictEqual(result.latestUpdated, false);
  assert.strictEqual(ddbDoc.historyItems.length, 1);
}

async function testOutOfOrderTimestampWrittenAsStaleHistoryOnly() {
  const event = validEvent({
    timestamp: "2026-07-16T11:00:00.000Z",
  });
  const { result, ddbDoc } = await ingest(event, { staleWindowMs: 1000 });
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.stale, true);
  assert.strictEqual(ddbDoc.historyItems.length, 1);
  assert.strictEqual(ddbDoc.historyItems[0].stale, true);
  assert.strictEqual(ddbDoc.latestUpdates.length, 0);
}

async function testMalformedQuarantineFailureIsReported() {
  const event = validEvent();
  delete event.zoneId;
  const { result, sqsClient } = await ingest(event, { sqsClient: new MockSqs({ fail: true }) });
  assert.strictEqual(result.rejected, true);
  assert.strictEqual(result.quarantine.ok, false);
  assert.strictEqual(result.quarantine.reason, "QUARANTINE_SEND_FAILED");
  assert.strictEqual(sqsClient.messages.length, 0);
}

async function testAppendOnlyHistoryUsesTransactionalPut() {
  const { ddbDoc } = await ingest(validEvent());
  const transact = ddbDoc.commands.find((command) => command instanceof TransactWriteCommand);
  assert(transact, "history/idempotency should use TransactWriteCommand");
  assert.strictEqual(transact.input.TransactItems.length, 2);
  assert.strictEqual(transact.input.TransactItems[1].Put.ConditionExpression, "attribute_not_exists(PK) AND attribute_not_exists(SK)");
}

async function testLatestStateUsesConditionalUpdate() {
  const { ddbDoc } = await ingest(validEvent());
  const update = ddbDoc.commands.find((command) => command instanceof UpdateCommand);
  assert(update, "latest state should use UpdateCommand");
  assert(update.input.ConditionExpression.includes("lastDeviceTimestamp"));
  assert.strictEqual(update.input.TableName, "iot_zone_state_test");
}

async function testShopperIdentityOptional() {
  const event = validEvent({ sessionId: null, snoozeCode: null });
  const { result, ddbDoc } = await ingest(event);
  assert.strictEqual(result.accepted, true);
  assert.strictEqual(ddbDoc.historyItems[0].sessionId, null);
  assert.strictEqual(ddbDoc.historyItems[0].snoozeCode, null);
}

async function main() {
  const tests = [
    ["valid_presence_event", testValidPresenceEvent],
    ["valid_occupancy_event", testValidOccupancyEvent],
    ["valid_heartbeat", testValidHeartbeat],
    ["valid_fault", testValidFault],
    ["missing_required_field_quarantines", testMissingRequiredFieldQuarantines],
    ["invalid_environment_quarantines", testInvalidEnvironmentQuarantines],
    ["invalid_store_quarantines", testInvalidStoreQuarantines],
    ["invalid_zone_quarantines", testInvalidZoneQuarantines],
    ["unregistered_device_quarantines", testUnregisteredDeviceQuarantines],
    ["unregistered_sensor_quarantines", testUnregisteredSensorQuarantines],
    ["topic_payload_mismatch_quarantines", testTopicPayloadMismatchQuarantines],
    ["duplicate_event_suppressed", testDuplicateEventSuppressed],
    ["stale_sequence_does_not_overwrite_latest", testStaleSequenceDoesNotOverwriteLatest],
    ["out_of_order_timestamp_written_as_stale_history_only", testOutOfOrderTimestampWrittenAsStaleHistoryOnly],
    ["malformed_quarantine_failure_is_reported", testMalformedQuarantineFailureIsReported],
    ["append_only_history_uses_transactional_put", testAppendOnlyHistoryUsesTransactionalPut],
    ["latest_state_uses_conditional_update", testLatestStateUsesConditionalUpdate],
    ["shopper_identity_optional", testShopperIdentityOptional],
  ];

  const failures = [];

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, message: error.message });
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} IoT zone ingestion test(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${tests.length} IoT zone ingestion tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
