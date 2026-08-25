const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const QUEUE_URL = String(process.env.ASK_SNOOZER_ASYNC_QUEUE_URL || "").trim();
const ENQUEUE_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.ASK_SNOOZER_ASYNC_ENQUEUE_TIMEOUT_MS || 500)
);
const MESSAGE_TYPE = "ask_snoozer_noncritical_writes_v1";

const sqs = new SQSClient({ region: REGION });

function cleanString(value, maxLength = 256) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function buildMessage(input = {}) {
  return {
    type: MESSAGE_TYPE,
    version: 1,
    queuedAt: new Date().toISOString(),
    traceId: cleanString(input.traceId, 128) || null,
    route: "/ask-snoozer",
    identityLookup:
      input.identityLookup && typeof input.identityLookup === "object"
        ? input.identityLookup
        : {},
    identity:
      input.identity && typeof input.identity === "object" ? input.identity : {},
    aliasContext:
      input.aliasContext && typeof input.aliasContext === "object"
        ? input.aliasContext
        : {},
    profilePatch:
      input.profilePatch && typeof input.profilePatch === "object"
        ? input.profilePatch
        : {},
    policyContext:
      input.policyContext && typeof input.policyContext === "object"
        ? input.policyContext
        : {},
  };
}

async function enqueueAskSnoozerAsyncWrites(input = {}) {
  if (!QUEUE_URL) {
    return {
      ok: false,
      skipped: true,
      reason: "ASK_SNOOZER_ASYNC_QUEUE_NOT_CONFIGURED",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENQUEUE_TIMEOUT_MS);

  try {
    const result = await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify(buildMessage(input)),
      }),
      { abortSignal: controller.signal }
    );

    return {
      ok: true,
      skipped: false,
      messageId: result.MessageId || null,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: true,
      reason:
        error?.name === "AbortError"
          ? "ASK_SNOOZER_ASYNC_QUEUE_TIMEOUT"
          : "ASK_SNOOZER_ASYNC_QUEUE_FAILED",
      error: cleanString(error?.message, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

function isAskSnoozerAsyncWriteEvent(event = {}) {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  if (!records.length) return false;
  return records.every(
    (record) =>
      String(record?.eventSource || record?.EventSource || "").toLowerCase() ===
      "aws:sqs"
  );
}

function parseAskSnoozerAsyncWriteRecord(record = {}) {
  let payload = null;
  try {
    payload = JSON.parse(String(record?.body || ""));
  } catch {
    return null;
  }

  if (!payload || payload.type !== MESSAGE_TYPE || payload.version !== 1) {
    return null;
  }

  return payload;
}

module.exports = {
  MESSAGE_TYPE,
  enqueueAskSnoozerAsyncWrites,
  isAskSnoozerAsyncWriteEvent,
  parseAskSnoozerAsyncWriteRecord,
};
