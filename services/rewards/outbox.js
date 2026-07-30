"use strict";

const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const repository = require("./repository");
const customerProfile = require("../customerProfile");
const zoho = require("../zoho");

function structuredLog(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

function queueUrl(options = {}) {
  return String(
    options.queueUrl || process.env.REWARDS_ZOHO_QUEUE_URL || ""
  ).trim();
}

function parseFieldMappings(options = {}) {
  const raw =
    options.fieldMappings || process.env.REWARDS_ZOHO_FIELD_MAP_JSON || "";
  if (!raw) {
    const error = new Error("Rewards Zoho field mappings are not configured.");
    error.code = "REWARDS_ZOHO_FIELD_MAP_NOT_CONFIGURED";
    error.terminal = true;
    throw error;
  }
  let mappings;
  try {
    mappings = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    const error = new Error("Rewards Zoho field mappings are invalid JSON.");
    error.code = "REWARDS_ZOHO_FIELD_MAP_INVALID";
    error.terminal = true;
    throw error;
  }
  const required = [
    "availableSleepPoints",
    "lifetimeSleepPoints",
    "currentShowroomBadgeId",
    "activeRulesVersion",
    "summaryVersion",
    "lastRewardActivityAt",
  ];
  const missing = required.filter(
    (key) => !String(mappings?.[key] || "").trim()
  );
  if (missing.length) {
    const error = new Error(
      `Rewards Zoho field mappings are missing: ${missing.join(", ")}`
    );
    error.code = "REWARDS_ZOHO_FIELD_MAP_INCOMPLETE";
    error.missingMappings = missing;
    error.terminal = true;
    throw error;
  }
  return mappings;
}

function streamOutboxRecords(event = {}) {
  return (event.Records || [])
    .filter((record) => record.eventName === "INSERT")
    .map((record) => {
      try {
        return record.dynamodb?.NewImage
          ? unmarshall(record.dynamodb.NewImage)
          : null;
      } catch (error) {
        structuredLog("rewards.outbox.stream_decode_failed", {
          eventId: record.eventID || null,
          failureCode: error.code || "REWARDS_OUTBOX_DECODE_FAILED",
        });
        return null;
      }
    })
    .filter(
      (item) => item?.entityType === "OUTBOX" && item.status === "pending"
    );
}

async function publishRewardsOutbox(event = {}, options = {}) {
  const url = queueUrl(options);
  if (!url) {
    const error = new Error("Rewards Zoho queue is not configured.");
    error.code = "REWARDS_ZOHO_QUEUE_NOT_CONFIGURED";
    throw error;
  }
  const sqs = options.sqsClient || new SQSClient({});
  const records = streamOutboxRecords(event);
  let published = 0;
  for (const outbox of records) {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: url,
        MessageBody: JSON.stringify({
          schemaVersion: 1,
          profileId: outbox.profileId,
          outboxKey: outbox.SK,
          eventType: outbox.eventType,
          payload: outbox.payload || {},
          createdAt: outbox.createdAt,
        }),
        MessageGroupId: url.endsWith(".fifo")
          ? String(outbox.profileId).slice(0, 128)
          : undefined,
        MessageDeduplicationId: url.endsWith(".fifo")
          ? String(outbox.SK).slice(0, 128)
          : undefined,
      })
    );
    published += 1;
    structuredLog("rewards.outbox.published", {
      profileId: outbox.profileId,
      outboxId: outbox.SK,
      eventType: outbox.eventType,
    });
  }
  return { ok: true, received: records.length, published };
}

function mapZohoFields(summary, profile, mappings) {
  const semanticValues = {
    availableSleepPoints: Number(summary.availableSleepPoints || 0),
    lifetimeSleepPoints: Number(summary.lifetimeSleepPoints || 0),
    currentShowroomBadgeId: summary.currentShowroomBadgeId || null,
    currentShowroomBadgeLabel: summary.currentShowroomBadgeLabel || null,
    completedMilestoneIds: (summary.completedMilestoneIds || []).join(","),
    completedPodCount: Number(summary.completedPodCount || 0),
    availableOfferCount: Number(summary.availableOfferCount || 0),
    sleepMaskGiftStatus: summary.sleepMaskGiftStatus || null,
    activeRulesVersion: summary.activeRulesVersion || null,
    summaryVersion: Number(summary.summaryVersion || 0),
    lastRewardActivityAt: summary.latestRewardActivityAt || null,
    lastShowroomVisit: profile?.lastInteractionAt || null,
    showroomLocation: profile?.showroomLocation || profile?.origin || null,
    zohoSyncStatus: "delivered",
  };
  return Object.entries(mappings).reduce((fields, [semanticKey, apiName]) => {
    if (
      String(apiName || "").trim() &&
      semanticValues[semanticKey] !== undefined &&
      semanticValues[semanticKey] !== null
    ) {
      fields[String(apiName).trim()] = semanticValues[semanticKey];
    }
    return fields;
  }, {});
}

async function markOutbox(profileId, outboxKey, updates, options = {}) {
  return (options.repository || repository).updateEntity(
    profileId,
    outboxKey,
    updates,
    options.repositoryOptions || options
  );
}

async function syncRewardsOutboxMessage(message, options = {}) {
  const started = Date.now();
  const profileId = String(message?.profileId || "").trim();
  const outboxKey = String(message?.outboxKey || "").trim();
  if (!profileId || !outboxKey.startsWith("OUTBOX#")) {
    const error = new Error("Rewards outbox message is invalid.");
    error.code = "REWARDS_OUTBOX_MESSAGE_INVALID";
    error.terminal = true;
    throw error;
  }

  const repo = options.repository || repository;
  const outbox = await repo.getEntity(
    profileId,
    outboxKey,
    options.repositoryOptions || options
  );
  if (!outbox) {
    structuredLog("rewards.zoho.outbox_missing", { profileId, outboxId: outboxKey });
    return { ok: true, skipped: true, reason: "OUTBOX_NOT_FOUND" };
  }
  if (outbox.status === "delivered") {
    return { ok: true, duplicate: true, reason: "ALREADY_DELIVERED" };
  }

  try {
    const mappings = parseFieldMappings(options);
    const summary = await repo.getSummary(
      profileId,
      options.repositoryOptions || options
    );
    if (!summary) {
      const error = new Error("Reward summary was not found.");
      error.code = "REWARDS_SUMMARY_NOT_FOUND";
      throw error;
    }
    const messageVersion = Number(message?.payload?.summaryVersion || 0);
    if (
      messageVersion > 0 &&
      messageVersion < Number(summary.summaryVersion || 0)
    ) {
      await markOutbox(
        profileId,
        outboxKey,
        {
          status: "stale",
          deliveredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        options
      );
      return { ok: true, stale: true, reason: "NEWER_SUMMARY_EXISTS" };
    }
    const profileResult = await (options.customerProfile || customerProfile).getCustomerProfile(
      { profileId },
      options.customerProfileOptions || {}
    );
    const profile = profileResult?.profile || null;
    const shopperId = String(
      summary.shopperId || outbox.payload?.shopperId || profile?.shopperId || ""
    ).trim();
    if (!shopperId) {
      const error = new Error("Canonical shopper identity is missing.");
      error.code = "REWARDS_ZOHO_SHOPPER_ID_MISSING";
      throw error;
    }
    const fields = mapZohoFields(summary, profile, mappings);
    const result = await (options.zoho || zoho).upsertContactByShopperId(
      shopperId,
      fields
    );
    if (!result?.ok) {
      const error = new Error("Zoho did not confirm the rewards synchronization.");
      error.code = result?.reason || "REWARDS_ZOHO_SYNC_FAILED";
      throw error;
    }
    const now = new Date().toISOString();
    await markOutbox(
      profileId,
      outboxKey,
      {
        status: "delivered",
        zohoContactId: result.contactId || null,
        deliveredAt: now,
        updatedAt: now,
      },
      options
    );
    structuredLog("rewards.zoho.sync_succeeded", {
      profileId,
      outboxId: outboxKey,
      summaryVersion: summary.summaryVersion,
      zohoMs: Date.now() - started,
    });
    return { ok: true, profileId, outboxKey };
  } catch (error) {
    await markOutbox(
      profileId,
      outboxKey,
      {
        status: error.terminal ? "configuration_failed" : "retry_pending",
        failureCode: error.code || "REWARDS_ZOHO_SYNC_FAILED",
        lastAttemptAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      options
    ).catch(() => null);
    structuredLog("rewards.zoho.sync_failed", {
      profileId,
      outboxId: outboxKey,
      failureCode: error.code || "REWARDS_ZOHO_SYNC_FAILED",
      terminal: Boolean(error.terminal),
      zohoMs: Date.now() - started,
    });
    throw error;
  }
}

async function processRewardsZohoQueue(event = {}, options = {}) {
  const failures = [];
  for (const record of event.Records || []) {
    try {
      const message = JSON.parse(record.body || "{}");
      await syncRewardsOutboxMessage(message, options);
    } catch (error) {
      if (!error?.terminal) {
        failures.push({ itemIdentifier: record.messageId });
      }
    }
  }
  return { batchItemFailures: failures };
}

module.exports = {
  mapZohoFields,
  parseFieldMappings,
  processRewardsZohoQueue,
  publishRewardsOutbox,
  streamOutboxRecords,
  syncRewardsOutboxMessage,
};
