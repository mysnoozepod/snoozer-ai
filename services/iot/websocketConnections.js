const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const ddbDoc = DynamoDBDocumentClientFactory();

function DynamoDBDocumentClientFactory() {
  const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function nowIso(options = {}) {
  const value = typeof options.clock === "function" ? options.clock() : new Date();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function ttlEpochSeconds(seconds) {
  const safeSeconds = Math.max(60, Number(seconds || process.env.WEBSOCKET_CONNECTION_TTL_SECONDS || 86400));
  return Math.floor(Date.now() / 1000) + safeSeconds;
}

function getTableName(options = {}) {
  return cleanString(options.tableName || process.env.WEBSOCKET_CONNECTIONS_TABLE);
}

function getClient(options = {}) {
  return options.ddbDoc || ddbDoc;
}

function connectionPk(connectionId) {
  return `CONNECTION#${cleanString(connectionId)}`;
}

function subscriptionPk(zoneId, connectionId) {
  return `SUBSCRIPTION#ZONE#${cleanString(zoneId)}#CONNECTION#${cleanString(connectionId)}`;
}

function zoneSubscriptionGsiPk(storeId, zoneId) {
  return `STORE#${cleanString(storeId)}#ZONE#${cleanString(zoneId)}`;
}

function normalizeZoneIds(value) {
  if (Array.isArray(value)) return value.map(cleanString).filter(Boolean);
  const zoneId = cleanString(value);
  return zoneId ? [zoneId] : [];
}

function buildConnectionItem(input, options = {}) {
  const connectedAt = input.connectedAt || nowIso(options);
  const expiresAt = input.expiresAt || ttlEpochSeconds(options.ttlSeconds);
  return {
    PK: connectionPk(input.connectionId),
    itemType: "connection",
    connectionId: input.connectionId,
    endpoint: input.endpoint,
    env: input.env,
    storeId: input.storeId,
    deviceId: input.deviceId,
    deviceMode: input.deviceMode,
    podId: input.podId || null,
    sourceIp: input.sourceIp || null,
    userAgent: input.userAgent || null,
    subscriptions: normalizeZoneIds(input.subscriptions),
    connectedAt,
    updatedAt: connectedAt,
    expiresAt,
    GSI1PK: `STORE#${input.storeId}#DEVICE#${input.deviceId}`,
    GSI1SK: `CONNECTION#${input.connectionId}`,
  };
}

function buildSubscriptionItem(connection, zoneId, options = {}) {
  const subscribedAt = options.subscribedAt || nowIso(options);
  return {
    PK: subscriptionPk(zoneId, connection.connectionId),
    itemType: "subscription",
    connectionId: connection.connectionId,
    endpoint: connection.endpoint,
    env: connection.env,
    storeId: connection.storeId,
    deviceId: connection.deviceId,
    deviceMode: connection.deviceMode,
    podId: connection.podId || null,
    zoneId,
    subscribedAt,
    updatedAt: subscribedAt,
    expiresAt: connection.expiresAt || ttlEpochSeconds(options.ttlSeconds),
    GSI1PK: zoneSubscriptionGsiPk(connection.storeId, zoneId),
    GSI1SK: `CONNECTION#${connection.connectionId}`,
  };
}

async function saveWebSocketConnection(input, options = {}) {
  const tableName = getTableName(options);
  if (!tableName) throw new Error("WEBSOCKET_CONNECTIONS_TABLE_NOT_CONFIGURED");
  const item = buildConnectionItem(input, options);
  await getClient(options).send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );
  return { ok: true, item };
}

async function getWebSocketConnection(connectionId, options = {}) {
  const tableName = getTableName(options);
  if (!tableName) throw new Error("WEBSOCKET_CONNECTIONS_TABLE_NOT_CONFIGURED");
  const result = await getClient(options).send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: connectionPk(connectionId) },
    })
  );
  return result.Item || null;
}

async function subscribeConnectionToZones(connection, zoneIds, options = {}) {
  const tableName = getTableName(options);
  if (!tableName) throw new Error("WEBSOCKET_CONNECTIONS_TABLE_NOT_CONFIGURED");
  const requestedZoneIds = [...new Set(normalizeZoneIds(zoneIds))];
  if (!requestedZoneIds.length) return { ok: false, reason: "NO_ZONE_IDS" };

  const existing = new Set(normalizeZoneIds(connection.subscriptions));
  const nextSubscriptions = [...new Set([...existing, ...requestedZoneIds])];
  const now = nowIso(options);

  const client = getClient(options);
  const putRequests = requestedZoneIds.map((zoneId) => ({
    PutRequest: {
      Item: buildSubscriptionItem(connection, zoneId, { ...options, subscribedAt: now }),
    },
  }));

  if (putRequests.length) {
    await client.send(new BatchWriteCommand({ RequestItems: { [tableName]: putRequests } }));
  }

  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: connectionPk(connection.connectionId) },
      UpdateExpression: "SET subscriptions = :subscriptions, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":subscriptions": nextSubscriptions,
        ":updatedAt": now,
      },
    })
  );

  return { ok: true, subscribedZoneIds: requestedZoneIds, subscriptions: nextSubscriptions };
}

async function unsubscribeConnectionFromZones(connection, zoneIds, options = {}) {
  const tableName = getTableName(options);
  if (!tableName) throw new Error("WEBSOCKET_CONNECTIONS_TABLE_NOT_CONFIGURED");
  const requestedZoneIds = [...new Set(normalizeZoneIds(zoneIds))];
  if (!requestedZoneIds.length) return { ok: false, reason: "NO_ZONE_IDS" };

  const removeSet = new Set(requestedZoneIds);
  const nextSubscriptions = normalizeZoneIds(connection.subscriptions).filter((zoneId) => !removeSet.has(zoneId));
  const now = nowIso(options);
  const client = getClient(options);
  const deleteRequests = requestedZoneIds.map((zoneId) => ({
    DeleteRequest: {
      Key: { PK: subscriptionPk(zoneId, connection.connectionId) },
    },
  }));

  if (deleteRequests.length) {
    await client.send(new BatchWriteCommand({ RequestItems: { [tableName]: deleteRequests } }));
  }

  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: connectionPk(connection.connectionId) },
      UpdateExpression: "SET subscriptions = :subscriptions, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":subscriptions": nextSubscriptions,
        ":updatedAt": now,
      },
    })
  );

  return { ok: true, unsubscribedZoneIds: requestedZoneIds, subscriptions: nextSubscriptions };
}

async function deleteWebSocketConnection(connectionId, options = {}) {
  const tableName = getTableName(options);
  if (!tableName) throw new Error("WEBSOCKET_CONNECTIONS_TABLE_NOT_CONFIGURED");
  const client = getClient(options);
  const connection = options.connection || (await getWebSocketConnection(connectionId, options));
  const zoneIds = normalizeZoneIds(connection?.subscriptions);
  const deleteRequests = zoneIds.map((zoneId) => ({
    DeleteRequest: {
      Key: { PK: subscriptionPk(zoneId, connectionId) },
    },
  }));
  deleteRequests.push({ DeleteRequest: { Key: { PK: connectionPk(connectionId) } } });

  for (let i = 0; i < deleteRequests.length; i += 25) {
    await client.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: deleteRequests.slice(i, i + 25),
        },
      })
    );
  }

  return { ok: true, deletedSubscriptions: zoneIds.length };
}

async function listConnectionsForZone(storeId, zoneId, options = {}) {
  const tableName = getTableName(options);
  if (!tableName) throw new Error("WEBSOCKET_CONNECTIONS_TABLE_NOT_CONFIGURED");
  const result = await getClient(options).send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :zoneKey",
      ExpressionAttributeValues: {
        ":zoneKey": zoneSubscriptionGsiPk(storeId, zoneId),
      },
    })
  );
  return result.Items || [];
}

async function cleanupExpiredWebSocketConnections(options = {}) {
  const tableName = getTableName(options);
  if (!tableName) throw new Error("WEBSOCKET_CONNECTIONS_TABLE_NOT_CONFIGURED");
  const now = options.nowEpochSeconds || Math.floor(Date.now() / 1000);
  const client = getClient(options);
  const result = await client.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: "expiresAt <= :now",
      ExpressionAttributeValues: {
        ":now": now,
      },
      Limit: Number(options.limit || 100),
    })
  );

  const items = result.Items || [];
  for (let i = 0; i < items.length; i += 25) {
    await client.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: items.slice(i, i + 25).map((item) => ({
            DeleteRequest: { Key: { PK: item.PK } },
          })),
        },
      })
    );
  }

  return { ok: true, scanned: result.ScannedCount || 0, deleted: items.length };
}

module.exports = {
  buildConnectionItem,
  buildSubscriptionItem,
  cleanupExpiredWebSocketConnections,
  connectionPk,
  deleteWebSocketConnection,
  getWebSocketConnection,
  listConnectionsForZone,
  saveWebSocketConnection,
  subscribeConnectionToZones,
  subscriptionPk,
  unsubscribeConnectionFromZones,
  zoneSubscriptionGsiPk,
};
