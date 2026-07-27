"use strict";

const crypto = require("crypto");
const repository = require("./repository");
const redemptionService = require("./redemption");

const SUPPORTED_TOPICS = new Set([
  "orders/create",
  "orders/paid",
  "orders/cancelled",
  "refunds/create",
  "returns/close",
]);

function header(headers = {}, name) {
  const wanted = String(name).toLowerCase();
  const entry = Object.entries(headers || {}).find(
    ([key]) => String(key).toLowerCase() === wanted
  );
  return entry ? String(entry[1] || "").trim() : "";
}

function rawBody(event = {}) {
  const value = String(event.body || "");
  return event.isBase64Encoded ? Buffer.from(value, "base64") : Buffer.from(value);
}

function verifyShopifyWebhook(event, options = {}) {
  const secret = String(
    options.webhookSecret || process.env.SHOPIFY_WEBHOOK_SECRET || ""
  ).trim();
  if (!secret) {
    const error = new Error("Shopify webhook verification is not configured.");
    error.code = "SHOPIFY_WEBHOOK_SECRET_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }
  const provided = header(event.headers, "x-shopify-hmac-sha256");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody(event))
    .digest("base64");
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (
    !provided ||
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    const error = new Error("Shopify webhook signature is invalid.");
    error.code = "SHOPIFY_WEBHOOK_SIGNATURE_INVALID";
    error.statusCode = 401;
    throw error;
  }
  return true;
}

function parsePayload(event) {
  try {
    return JSON.parse(rawBody(event).toString("utf8") || "{}");
  } catch {
    const error = new Error("Shopify webhook JSON is invalid.");
    error.code = "SHOPIFY_WEBHOOK_BODY_INVALID";
    error.statusCode = 400;
    throw error;
  }
}

function discountCodes(payload = {}) {
  const sources = [
    payload.discount_codes,
    payload.order?.discount_codes,
    payload.refund?.order?.discount_codes,
    payload.return?.order?.discount_codes,
  ];
  return [
    ...new Set(
      sources
        .flatMap((source) => (Array.isArray(source) ? source : []))
        .map((item) => String(item?.code || item || "").trim())
        .filter(Boolean)
    ),
  ];
}

function commerceEntryType(topic) {
  if (topic === "refunds/create") return "refund";
  if (topic === "orders/cancelled" || topic === "returns/close") return "return";
  return "purchase";
}

function shouldReverse(topic) {
  return (
    topic === "refunds/create" ||
    topic === "orders/cancelled" ||
    topic === "returns/close"
  );
}

function webhookKey(topic, webhookId) {
  return {
    PK: `SHOPIFY#WEBHOOK#${topic}`,
    SK: `EVENT#${webhookId}`,
  };
}

async function claimWebhook(repo, topic, webhookId, now, options = {}) {
  const key = webhookKey(topic, webhookId);
  const existing = await repo.getItem(key, options.repositoryOptions || options);
  if (existing?.status === "processed" || existing?.status === "processing") {
    return { duplicate: true, item: existing };
  }
  const item = {
    ...key,
    entityType: "SHOPIFY_WEBHOOK",
    topic,
    webhookId,
    status: "processing",
    attemptCount: Number(existing?.attemptCount || 0) + 1,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    ttl: Math.floor(Date.parse(now) / 1000) + 90 * 86400,
  };
  const request = existing
    ? {
        Update: {
          Key: key,
          UpdateExpression:
            "SET #status = :processing, attemptCount = :attempt, updatedAt = :now",
          ConditionExpression: "#status = :failed",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":processing": "processing",
            ":failed": "failed",
            ":attempt": item.attemptCount,
            ":now": now,
          },
        },
      }
    : {
        Put: {
          Item: item,
          ConditionExpression: "attribute_not_exists(PK)",
        },
      };
  try {
    await repo.transactItems([request], options.repositoryOptions || options);
    return { duplicate: false, item };
  } catch (error) {
    const concurrent = await repo.getItem(key, options.repositoryOptions || options);
    if (concurrent?.status === "processing" || concurrent?.status === "processed") {
      return { duplicate: true, item: concurrent };
    }
    throw error;
  }
}

async function setWebhookStatus(
  repo,
  topic,
  webhookId,
  status,
  now,
  details,
  options = {}
) {
  const names = { "#status": "status" };
  const values = {
    ":status": status,
    ":processing": "processing",
    ":now": now,
    ":details": details || null,
  };
  await repo.transactItems(
    [
      {
        Update: {
          Key: webhookKey(topic, webhookId),
          UpdateExpression:
            "SET #status = :status, updatedAt = :now, processingDetails = :details",
          ConditionExpression: "#status = :processing",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        },
      },
    ],
    options.repositoryOptions || options
  );
}

async function recordPurchase(binding, context, options = {}) {
  const repo = options.repository || repository;
  const pk = repository.profilePk(binding.profileId);
  const occurredAt = context.occurredAt;
  const suffix = crypto
    .createHash("sha256")
    .update(`${context.webhookId}|${binding.redemptionId}|${context.entryType}`)
    .digest("hex")
    .slice(0, 24);
  await repo.transactItems(
    [
      {
        Put: {
          Item: {
            PK: pk,
            SK: `LEDGER#${occurredAt}#shopify#${suffix}`,
            entityType: "LEDGER",
            entryType: context.entryType,
            profileId: binding.profileId,
            redemptionId: binding.redemptionId,
            offerId: binding.offerId,
            shopifyOrderId: context.orderId,
            shopifyWebhookId: context.webhookId,
            shopifyTopic: context.topic,
            occurredAt,
            createdAt: occurredAt,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
      {
        Put: {
          Item: {
            PK: pk,
            SK: `OUTBOX#${occurredAt}#shopify#${suffix}`,
            entityType: "OUTBOX",
            profileId: binding.profileId,
            eventType: `rewards.commerce.${context.entryType}`,
            status: "pending",
            payload: {
              profileId: binding.profileId,
              redemptionId: binding.redemptionId,
              offerId: binding.offerId,
              shopifyOrderId: context.orderId,
              shopifyTopic: context.topic,
              updatedAt: occurredAt,
            },
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ],
    {
      ...(options.repositoryOptions || options),
      clientRequestToken: suffix,
    }
  );
}

async function processShopifyRewardsWebhook(event, options = {}) {
  verifyShopifyWebhook(event, options);
  const topic = header(event.headers, "x-shopify-topic").toLowerCase();
  if (!SUPPORTED_TOPICS.has(topic)) {
    return { accepted: true, ignored: true, topic };
  }
  const body = rawBody(event);
  const webhookId =
    header(event.headers, "x-shopify-webhook-id") ||
    crypto.createHash("sha256").update(body).digest("hex");
  const payload = parsePayload(event);
  const repo = options.repository || repository;
  const now = new Date().toISOString();
  const claim = await claimWebhook(repo, topic, webhookId, now, options);
  if (claim.duplicate) {
    console.log(
      JSON.stringify({
        event: "rewards.shopify_webhook.duplicate",
        topic,
        webhookId,
      })
    );
    return { accepted: true, duplicate: true, topic, webhookId };
  }

  try {
    const bindings = [];
    for (const code of discountCodes(payload)) {
      const binding = await repo.getItem(
        { PK: `SHOPIFY#DISCOUNT#${code}`, SK: "REWARD_BINDING" },
        options.repositoryOptions || options
      );
      if (binding) bindings.push(binding);
    }
    const entryType = commerceEntryType(topic);
    const context = {
      topic,
      webhookId,
      entryType,
      occurredAt: payload.updated_at || payload.created_at || now,
      orderId: String(payload.order_id || payload.order?.id || payload.id || ""),
    };
    for (const binding of bindings) {
      if (shouldReverse(topic)) {
        await (options.redemptionService || redemptionService).reverseRedemption(
          {
            identity: { profileId: binding.profileId },
            redemptionId: binding.redemptionId,
            reason: `shopify_${topic.replace(/\W+/g, "_")}`,
            commerceEventType: entryType,
            shopifyWebhookId: webhookId,
            shopifyOrderId: context.orderId,
          },
          options
        );
      } else {
        await recordPurchase(binding, context, options);
      }
    }
    await setWebhookStatus(
      repo,
      topic,
      webhookId,
      "processed",
      new Date().toISOString(),
      { bindingCount: bindings.length },
      options
    );
    console.log(
      JSON.stringify({
        event: "rewards.shopify_webhook.processed",
        topic,
        webhookId,
        bindingCount: bindings.length,
      })
    );
    return {
      accepted: true,
      duplicate: false,
      topic,
      webhookId,
      bindingCount: bindings.length,
    };
  } catch (error) {
    await setWebhookStatus(
      repo,
      topic,
      webhookId,
      "failed",
      new Date().toISOString(),
      { code: error.code || "SHOPIFY_REWARD_WEBHOOK_FAILED" },
      options
    ).catch(() => {});
    throw error;
  }
}

module.exports = {
  SUPPORTED_TOPICS,
  discountCodes,
  processShopifyRewardsWebhook,
  rawBody,
  verifyShopifyWebhook,
};
