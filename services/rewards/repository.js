"use strict";

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

function tableName(options = {}) {
  return String(options.tableName || process.env.REWARDS_TABLE_NAME || "").trim();
}

function requireTable(options = {}) {
  const name = tableName(options);
  if (!name) {
    const error = new Error("Rewards table is not configured.");
    error.code = "REWARDS_TABLE_NOT_CONFIGURED";
    throw error;
  }
  return name;
}

function client(options = {}) {
  return options.documentClient || DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

function profilePk(profileId) {
  return `PROFILE#${String(profileId || "").trim()}`;
}

function summaryKey(profileId) {
  return { PK: profilePk(profileId), SK: "SUMMARY" };
}

async function getSummary(profileId, options = {}) {
  const result = await client(options).send(new GetCommand({
    TableName: requireTable(options),
    Key: summaryKey(profileId),
    ConsistentRead: true,
  }));
  return result.Item || null;
}

async function getEntity(profileId, sortKey, options = {}) {
  const result = await client(options).send(new GetCommand({
    TableName: requireTable(options),
    Key: { PK: profilePk(profileId), SK: sortKey },
    ConsistentRead: true,
  }));
  return result.Item || null;
}

async function getItem(key, options = {}) {
  const result = await client(options).send(new GetCommand({
    TableName: requireTable(options),
    Key: key,
    ConsistentRead: true,
  }));
  return result.Item || null;
}

async function queryByPrefix(profileId, prefix, options = {}) {
  const result = await client(options).send(new QueryCommand({
    TableName: requireTable(options),
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: { ":pk": profilePk(profileId), ":prefix": prefix },
    ScanIndexForward: false,
    Limit: Number(options.limit) || 100,
  }));
  return result.Items || [];
}

async function commitMilestone(items, expectedVersion, options = {}) {
  const name = requireTable(options);
  const summary = items.find((item) => item.entityType === "SUMMARY");
  const writes = items.map((item) => {
    const put = { TableName: name, Item: item };
    if (item.entityType === "CLAIM") put.ConditionExpression = "attribute_not_exists(PK)";
    if (item.entityType === "SUMMARY") {
      put.ConditionExpression =
        expectedVersion === 0
          ? "attribute_not_exists(PK)"
          : "summaryVersion = :expectedVersion";
      if (expectedVersion !== 0) {
        put.ExpressionAttributeValues = { ":expectedVersion": expectedVersion };
      }
    }
    return { Put: put };
  });
  if (!summary) throw new Error("Reward transaction requires SUMMARY.");
  await client(options).send(new TransactWriteCommand({
    TransactItems: writes,
    ClientRequestToken: items
      .find((item) => item.entityType === "CLAIM")
      ?.claimHash?.slice(0, 36),
  }));
  return summary;
}

async function updateEntity(profileId, sortKey, updates = {}, options = {}) {
  const names = {};
  const values = {};
  const expressions = [];
  let index = 0;
  for (const [key, value] of Object.entries(updates)) {
    index += 1;
    names[`#n${index}`] = key;
    values[`:v${index}`] = value;
    expressions.push(`#n${index} = :v${index}`);
  }
  const result = await client(options).send(new UpdateCommand({
    TableName: requireTable(options),
    Key: { PK: profilePk(profileId), SK: sortKey },
    UpdateExpression: `SET ${expressions.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW",
  }));
  return result.Attributes || null;
}

async function putEntity(item, options = {}) {
  const request = {
    TableName: requireTable(options),
    Item: item,
  };
  if (options.createOnly) {
    request.ConditionExpression = "attribute_not_exists(PK)";
  }
  await client(options).send(new PutCommand(request));
  return item;
}

async function transactItems(transactItems, options = {}) {
  await client(options).send(
    new TransactWriteCommand({
      TransactItems: transactItems.map((entry) => {
        if (entry.Put) {
          return { Put: { TableName: requireTable(options), ...entry.Put } };
        }
        if (entry.Update) {
          return { Update: { TableName: requireTable(options), ...entry.Update } };
        }
        throw new Error("Unsupported rewards transaction item.");
      }),
      ClientRequestToken: options.clientRequestToken
        ? String(options.clientRequestToken).slice(0, 36)
        : undefined,
    })
  );
}

module.exports = {
  commitMilestone,
  getEntity,
  getItem,
  getSummary,
  profilePk,
  putEntity,
  queryByPrefix,
  summaryKey,
  transactItems,
  updateEntity,
};
