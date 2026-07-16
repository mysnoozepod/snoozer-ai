const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

const REGION = process.env.AWS_REGION || "us-east-1";
const sqsClient = new SQSClient({ region: REGION });

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { unserializable: true };
  }
}

async function quarantineMalformedZoneEvent(input = {}, options = {}) {
  const queueUrl = options.queueUrl || process.env.IOT_QUARANTINE_QUEUE_URL || "";
  if (!queueUrl) {
    return {
      ok: false,
      skipped: true,
      reason: "IOT_QUARANTINE_QUEUE_URL_NOT_CONFIGURED",
    };
  }

  const client = options.sqsClient || sqsClient;
  const message = {
    schemaVersion: "1.0",
    reasonCodes: input.reasonCodes || [],
    receivedAt: input.receivedAt,
    topic: input.topic || null,
    env: input.env || null,
    storeId: input.storeId || null,
    rawEvent: safeJson(input.rawEvent),
  };

  try {
    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
      })
    );
    return { ok: true, queueUrl };
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "iot.zone_event.quarantine_failed",
        error: error.message,
        reasonCodes: message.reasonCodes,
      })
    );
    return {
      ok: false,
      reason: "QUARANTINE_SEND_FAILED",
      error: error.message,
    };
  }
}

module.exports = {
  quarantineMalformedZoneEvent,
};
