const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

function ttlEpochSeconds(days) {
  const safeDays = Math.max(1, Number(days || 180));
  return Math.floor(Date.now() / 1000) + safeDays * 24 * 60 * 60;
}

function isConditionalFailure(error) {
  return (
    error?.name === "ConditionalCheckFailedException" ||
    error?.name === "TransactionCanceledException" ||
    /ConditionalCheckFailed/i.test(String(error?.message || ""))
  );
}

function getTables(options = {}) {
  return {
    stateTable: options.stateTable || process.env.IOT_ZONE_STATE_TABLE || "",
    eventsTable: options.eventsTable || process.env.IOT_ZONE_EVENTS_TABLE || "",
  };
}

function buildHistoryItem(event, options = {}) {
  const receivedAt = options.receivedAt;
  const ttl = options.ttl || ttlEpochSeconds(options.eventTtlDays || process.env.IOT_EVENT_TTL_DAYS || 180);
  const item = {
    PK: `STORE#${event.storeId}#ZONE#${event.zoneId}`,
    SK: `${receivedAt}#${event.eventId}`,
    eventId: event.eventId,
    env: event.env,
    storeId: event.storeId,
    zoneId: event.zoneId,
    zoneType: event.zoneType,
    podId: event.podId,
    deviceId: event.deviceId,
    sensorId: event.sensorId,
    sensorType: event.sensorType,
    eventType: event.eventType,
    state: event.state,
    value: event.value,
    unit: event.unit,
    confidence: event.confidence,
    sequence: event.sequence,
    deviceTimestamp: event.timestamp,
    source: event.source,
    firmwareVersion: event.firmwareVersion,
    receivedAt,
    sessionId: event.sessionId,
    snoozeCode: event.snoozeCode,
    metadata: event.metadata,
    accepted: true,
    stale: options.stale === true,
    ttl,
    GSI1PK: `EVENT#${event.eventId}`,
    GSI1SK: `RECEIVED#${receivedAt}`,
    GSI2PK: `DEVICE#${event.deviceId}`,
    GSI2SK: `RECEIVED#${receivedAt}`,
  };

  if (event.sessionId) {
    item.GSI3PK = `SESSION#${event.sessionId}`;
    item.GSI3SK = `RECEIVED#${receivedAt}`;
  }

  return item;
}

function buildIdempotencyItem(event, options = {}) {
  const receivedAt = options.receivedAt;
  const ttl = ttlEpochSeconds(options.idempotencyTtlDays || 7);
  return {
    PK: `EVENT#${event.eventId}`,
    SK: "IDEMPOTENCY",
    eventId: event.eventId,
    env: event.env,
    storeId: event.storeId,
    zoneId: event.zoneId,
    deviceId: event.deviceId,
    receivedAt,
    ttl,
  };
}

async function appendZoneEventHistoryWithIdempotency(event, options = {}) {
  const { eventsTable } = getTables(options);
  if (!eventsTable) {
    throw new Error("IOT_ZONE_EVENTS_TABLE_NOT_CONFIGURED");
  }

  const client = options.ddbDoc || ddbDoc;
  const receivedAt = options.receivedAt;
  const historyItem = buildHistoryItem(event, options);
  const idempotencyItem = buildIdempotencyItem(event, options);

  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: eventsTable,
              Item: idempotencyItem,
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: eventsTable,
              Item: historyItem,
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
        ],
      })
    );
    return { ok: true, duplicate: false, historyItem, idempotencyItem, receivedAt };
  } catch (error) {
    if (isConditionalFailure(error)) {
      return { ok: true, duplicate: true, reason: "DUPLICATE_EVENT_SUPPRESSED" };
    }
    throw error;
  }
}

async function updateLatestZoneState(event, options = {}) {
  const { stateTable } = getTables(options);
  if (!stateTable) {
    throw new Error("IOT_ZONE_STATE_TABLE_NOT_CONFIGURED");
  }

  const client = options.ddbDoc || ddbDoc;
  const receivedAt = options.receivedAt;

  try {
    await client.send(
      new UpdateCommand({
        TableName: stateTable,
        Key: {
          PK: `STORE#${event.storeId}`,
          SK: `ZONE#${event.zoneId}`,
        },
        UpdateExpression: [
          "SET storeId = :storeId",
          "zoneId = :zoneId",
          "zoneType = :zoneType",
          "podId = :podId",
          "currentState = :currentState",
          "lastEventType = :eventType",
          "lastEventId = :eventId",
          "lastSequence = :sequence",
          "lastDeviceTimestamp = :deviceTimestamp",
          "lastReceivedAt = :receivedAt",
          "deviceId = :deviceId",
          "sensorId = :sensorId",
          "sessionId = :sessionId",
          "snoozeCode = :snoozeCode",
          "updatedAt = :receivedAt",
          "metadata = :metadata",
        ].join(", "),
        ConditionExpression:
          "attribute_not_exists(lastDeviceTimestamp) OR :deviceTimestamp > lastDeviceTimestamp OR (:deviceTimestamp = lastDeviceTimestamp AND (attribute_not_exists(lastSequence) OR :sequence > lastSequence))",
        ExpressionAttributeValues: {
          ":storeId": event.storeId,
          ":zoneId": event.zoneId,
          ":zoneType": event.zoneType,
          ":podId": event.podId,
          ":currentState": event.state,
          ":eventType": event.eventType,
          ":eventId": event.eventId,
          ":sequence": event.sequence,
          ":deviceTimestamp": event.timestamp,
          ":receivedAt": receivedAt,
          ":deviceId": event.deviceId,
          ":sensorId": event.sensorId,
          ":sessionId": event.sessionId,
          ":snoozeCode": event.snoozeCode,
          ":metadata": event.metadata,
        },
      })
    );

    return { ok: true, latestUpdated: true, stale: false };
  } catch (error) {
    if (isConditionalFailure(error)) {
      return {
        ok: true,
        latestUpdated: false,
        stale: true,
        reason: "ZONE_LATEST_STATE_STALE_IGNORED",
      };
    }
    throw error;
  }
}

async function persistZoneEvent(event, options = {}) {
  const history = await appendZoneEventHistoryWithIdempotency(event, {
    ...options,
    stale: options.skipLatest === true,
  });
  if (history.duplicate) return { ...history, latest: null };

  if (options.skipLatest === true) {
    return {
      ...history,
      latest: {
        ok: true,
        latestUpdated: false,
        stale: true,
        reason: "STALE_BY_TIMESTAMP",
      },
    };
  }

  const latest = await updateLatestZoneState(event, options);
  return { ...history, latest };
}

module.exports = {
  buildHistoryItem,
  buildIdempotencyItem,
  appendZoneEventHistoryWithIdempotency,
  updateLatestZoneState,
  persistZoneEvent,
  isConditionalFailure,
};
