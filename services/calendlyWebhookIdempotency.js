const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const DEFAULT_TABLE_NAME =
  process.env.CALENDLY_IDEMPOTENCY_TABLE || process.env.SESSIONS_TABLE || "snoozer_sessions";
const DEFAULT_TTL_DAYS = Number(process.env.CALENDLY_IDEMPOTENCY_TTL_DAYS || 14);

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeLower(value) {
  return cleanString(value).toLowerCase();
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function ttlEpochSeconds(days = DEFAULT_TTL_DAYS) {
  const safeDays = Math.max(1, Number(days || DEFAULT_TTL_DAYS || 14));
  return Math.floor(Date.now() / 1000) + safeDays * 24 * 60 * 60;
}

function buildLedgerSessionId(keyHash = "") {
  const normalized = cleanString(keyHash);
  return normalized ? `webhook#calendly#${normalized}` : "";
}

function deriveCalendlyIdempotencyKey(input = {}) {
  const eventType = normalizeLower(input.eventType || input.event || input.type);
  const eventUri = cleanString(
    input.eventUri || input.scheduled_event?.uri || input.payload?.scheduled_event?.uri
  );
  const inviteeUri = cleanString(
    input.inviteeUri || input.invitee?.uri || input.payload?.invitee?.uri
  );
  const payloadEventId = cleanString(
    input.payloadEventId || input.eventId || input.payload?.id || input.id
  );
  const email = normalizeLower(
    input.email || input.invitee?.email || input.payload?.invitee?.email
  );
  const startTime = cleanString(
    input.startTime || input.scheduled_event?.start_time || input.payload?.scheduled_event?.start_time
  );

  if (!eventType) {
    return {
      ok: false,
      reason: "MISSING_EVENT_TYPE",
      canClaim: false,
    };
  }

  const candidates = [
    ["event_uri", eventUri],
    ["invitee_uri", inviteeUri],
    ["payload_event_id", payloadEventId],
  ];

  for (const [source, rawValue] of candidates) {
    const normalized = cleanString(rawValue);
    if (!normalized) continue;
    const key = `${eventType}::${source}::${normalized}`;
    return {
      ok: true,
      canClaim: true,
      source,
      rawValue: normalized,
      key,
      keyHash: hashValue(key),
      bookingId: eventUri || inviteeUri || payloadEventId || null,
    };
  }

  if (email && startTime && (eventUri || inviteeUri)) {
    const fallbackSource = `${eventType}|${email}|${startTime}|${eventUri || inviteeUri}`;
    const fallbackHash = hashValue(fallbackSource);
    const key = `${eventType}::fallback_hash::${fallbackHash}`;
    return {
      ok: true,
      canClaim: true,
      source: "fallback_hash",
      rawValue: fallbackHash,
      key,
      keyHash: hashValue(key),
      bookingId: eventUri || inviteeUri || null,
    };
  }

  return {
    ok: false,
    reason: "INSUFFICIENT_IDEMPOTENCY_EVIDENCE",
    canClaim: false,
  };
}

function buildLedgerRecord(input = {}) {
  const idempotencyKey = cleanString(input.idempotencyKey);
  const keyHash = cleanString(input.keyHash || hashValue(idempotencyKey));
  const firstSeenAt = cleanString(input.firstSeenAt) || nowIso();
  const ttl = Number(input.ttl || ttlEpochSeconds(input.ttlDays || DEFAULT_TTL_DAYS));

  return {
    sessionId: buildLedgerSessionId(keyHash),
    recordType: "webhook_idempotency",
    provider: "calendly",
    eventType: cleanString(input.eventType) || null,
    idempotencyKey,
    idempotencyKeyHash: keyHash,
    idempotencySource: cleanString(input.idempotencySource) || null,
    inviteeUri: cleanString(input.inviteeUri) || null,
    eventUri: cleanString(input.eventUri) || null,
    bookingId: cleanString(input.bookingId || input.eventUri || input.inviteeUri) || null,
    status: cleanString(input.status || "processing") || "processing",
    firstSeenAt,
    lastAttemptAt: cleanString(input.lastAttemptAt) || firstSeenAt,
    attemptCount: Math.max(1, Number(input.attemptCount || 1)),
    processedAt: cleanString(input.processedAt) || null,
    failedAt: cleanString(input.failedAt) || null,
    shopperId: cleanString(input.shopperId) || null,
    profileId: cleanString(input.profileId) || null,
    resultSummary: isObject(input.resultSummary) ? input.resultSummary : undefined,
    reason: cleanString(input.reason) || null,
    expiresAt: new Date(ttl * 1000).toISOString(),
    ttl,
  };
}

function getTableName(options = {}) {
  return cleanString(options.tableName || DEFAULT_TABLE_NAME);
}

function isConditionalFailure(error) {
  const name = cleanString(error?.name);
  const code = cleanString(error?.code);
  return (
    name === "ConditionalCheckFailedException" || code === "ConditionalCheckFailedException"
  );
}

async function readRecordBySessionId(sessionId = "", options = {}) {
  const normalized = cleanString(sessionId);
  const tableName = getTableName(options);
  if (!normalized || !tableName) return null;

  const client = options.ddbDoc || ddbDoc;
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { sessionId: normalized },
    })
  );
  return result?.Item || null;
}

async function reclaimFailedRecord(sessionId = "", existing = {}, input = {}, options = {}) {
  const normalized = cleanString(sessionId);
  const tableName = getTableName(options);
  if (!normalized || !tableName) return null;

  const client = options.ddbDoc || ddbDoc;
  const now = nowIso();

  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { sessionId: normalized },
      ConditionExpression: "attribute_exists(sessionId) AND #status = :failed",
      UpdateExpression:
        "SET #status = :processing, lastAttemptAt = :lastAttemptAt, attemptCount = :attemptCount, reason = :reason, failedAt = :failedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":failed": "failed",
        ":processing": "processing",
        ":lastAttemptAt": now,
        ":attemptCount": Math.max(1, Number(existing?.attemptCount || 1)) + 1,
        ":reason": cleanString(input.reason) || "retry_after_failure",
        ":failedAt": null,
      },
    })
  );

  return await readRecordBySessionId(normalized, options);
}

async function claimCalendlyWebhook(input = {}, options = {}) {
  const derived = isObject(input?.derived)
    ? input.derived
    : deriveCalendlyIdempotencyKey(input);
  if (!derived.ok || !derived.canClaim) {
    return {
      ok: false,
      skipped: true,
      reason: derived.reason || "INSUFFICIENT_IDEMPOTENCY_EVIDENCE",
      duplicate: false,
      claimed: false,
      idempotencyStatus: "unclaimed",
      derived,
      record: null,
    };
  }

  const tableName = getTableName(options);
  if (!tableName) {
    return {
      ok: false,
      skipped: true,
      reason: "IDEMPOTENCY_TABLE_NOT_CONFIGURED",
      duplicate: false,
      claimed: false,
      idempotencyStatus: "unavailable",
      derived,
      record: null,
    };
  }

  const client = options.ddbDoc || ddbDoc;
  const firstSeenAt = nowIso();
  const record = buildLedgerRecord({
    eventType: input.eventType,
    idempotencyKey: derived.key,
    keyHash: derived.keyHash,
    idempotencySource: derived.source,
    inviteeUri: input.inviteeUri,
    eventUri: input.eventUri,
    bookingId: derived.bookingId,
    firstSeenAt,
    lastAttemptAt: firstSeenAt,
    status: "processing",
  });

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: record,
        ConditionExpression: "attribute_not_exists(sessionId)",
      })
    );

    return {
      ok: true,
      claimed: true,
      duplicate: false,
      skipped: false,
      idempotencyStatus: "new",
      reason: "WEBHOOK_CLAIMED",
      derived,
      record,
    };
  } catch (error) {
    if (!isConditionalFailure(error)) {
      error.code = error.code || "BOOKING_IDEMPOTENCY_CLAIM_FAILED";
      throw error;
    }

    const existing = await readRecordBySessionId(record.sessionId, options);
    const existingStatus = cleanString(existing?.status).toLowerCase();

    if (existingStatus === "failed") {
      const reclaimed = await reclaimFailedRecord(record.sessionId, existing, input, options);
      return {
        ok: true,
        claimed: true,
        duplicate: false,
        skipped: false,
        idempotencyStatus: "processing",
        reason: "WEBHOOK_RETRY_AFTER_FAILURE",
        derived,
        record: reclaimed || existing,
      };
    }

    return {
      ok: true,
      claimed: false,
      duplicate: true,
      skipped: true,
      idempotencyStatus: existingStatus || "processed",
      reason:
        existingStatus === "processing"
          ? "WEBHOOK_ALREADY_PROCESSING"
          : "WEBHOOK_ALREADY_PROCESSED",
      derived,
      record: existing,
    };
  }
}

async function markCalendlyWebhookProcessed(input = {}, options = {}) {
  const sessionId =
    cleanString(input.sessionId) ||
    buildLedgerSessionId(cleanString(input.keyHash || hashValue(input.idempotencyKey)));
  const tableName = getTableName(options);
  if (!sessionId || !tableName) return null;

  const client = options.ddbDoc || ddbDoc;
  const processedAt = nowIso();
  const resultSummary = isObject(input.resultSummary) ? input.resultSummary : {};

  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { sessionId },
      ConditionExpression: "attribute_exists(sessionId)",
      UpdateExpression:
        "SET #status = :processed, processedAt = :processedAt, failedAt = :failedAt, shopperId = :shopperId, profileId = :profileId, bookingId = :bookingId, resultSummary = :resultSummary, reason = :reason",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":processed": "processed",
        ":processedAt": processedAt,
        ":failedAt": null,
        ":shopperId": cleanString(input.shopperId) || null,
        ":profileId": cleanString(input.profileId) || null,
        ":bookingId": cleanString(input.bookingId) || null,
        ":resultSummary": resultSummary,
        ":reason": cleanString(input.reason) || "processed",
      },
    })
  );

  return await readRecordBySessionId(sessionId, options);
}

async function markCalendlyWebhookFailed(input = {}, options = {}) {
  const sessionId =
    cleanString(input.sessionId) ||
    buildLedgerSessionId(cleanString(input.keyHash || hashValue(input.idempotencyKey)));
  const tableName = getTableName(options);
  if (!sessionId || !tableName) return null;

  const client = options.ddbDoc || ddbDoc;
  const failedAt = nowIso();

  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { sessionId },
      ConditionExpression: "attribute_exists(sessionId)",
      UpdateExpression:
        "SET #status = :failed, failedAt = :failedAt, reason = :reason, resultSummary = :resultSummary",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":failed": "failed",
        ":failedAt": failedAt,
        ":reason": cleanString(input.reason) || "processing_failed",
        ":resultSummary": isObject(input.resultSummary) ? input.resultSummary : {},
      },
    })
  );

  return await readRecordBySessionId(sessionId, options);
}

module.exports = {
  DEFAULT_TABLE_NAME,
  buildLedgerRecord,
  buildLedgerSessionId,
  claimCalendlyWebhook,
  deriveCalendlyIdempotencyKey,
  hashValue,
  markCalendlyWebhookFailed,
  markCalendlyWebhookProcessed,
};
