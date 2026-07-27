"use strict";

const crypto = require("crypto");
const customerProfileService = require("../customerProfile");
const { deriveShowroomBadge } = require("../rewardsDomain/rules");
const processor = require("./processor");
const repository = require("./repository");
const { loadRewardsRules } = require("./rulesLoader");

const REWARD_FAILURE_HUD = Object.freeze({
  speech:
    "Your showroom experience is still saved. I couldn't update your rewards just yet.",
  captions: "Your experience is saved. Rewards could not be updated yet.",
  state: "warning",
  priority: "normal",
  ttlMs: 5000,
  actions: [],
});

const REWARD_APPLICATION_FAILURE_HUD = Object.freeze({
  speech: "Your reward could not be applied, but you can still continue to checkout.",
  captions: "Reward unavailable. Normal checkout is still available.",
  state: "warning",
  priority: "high",
  ttlMs: 5000,
  actions: [],
});

const REWARD_APPLIED_HUD = Object.freeze({
  speech: "Your earned savings have been applied.",
  captions: "Your earned savings have been applied.",
  state: "celebrate",
  priority: "normal",
  ttlMs: 5000,
  actions: [],
});

function enabled(options = {}) {
  if (typeof options.enabled === "boolean") return options.enabled;
  return String(process.env.REWARDS_FEATURE_ENABLED || "").toLowerCase() === "true";
}

function featureError() {
  const error = new Error("Rewards are not enabled in this environment.");
  error.code = "REWARDS_FEATURE_DISABLED";
  error.statusCode = 503;
  return error;
}

async function activeRules(options = {}) {
  if (options.rules) return options.rules;
  return (await loadRewardsRules(options.rulesOptions || options)).rules;
}

function zeroSummary(identity, rules) {
  const badge = deriveShowroomBadge(0, rules);
  return {
    profileId: identity.profileId,
    shopperId: identity.shopperId,
    snoozeCode: identity.snoozeCode,
    availableSleepPoints: 0,
    lifetimeSleepPoints: 0,
    currentShowroomBadgeId: badge?.id || "badge.showroom.explorer",
    currentShowroomBadgeLabel: badge?.label || "Explorer",
    completedMilestoneIds: [],
    completedPodIds: [],
    unlockedOfferIds: [],
    redeemedOfferIds: [],
    expiredOfferIds: [],
    sleepMaskGiftStatus: null,
    activeRulesVersion: rules.rulesVersion,
    summaryVersion: 0,
    latestRewardActivityAt: null,
  };
}

function nextBadgeProgress(summary, rules) {
  const badges = [...rules.badges].sort((left, right) => left.thresholdPoints - right.thresholdPoints);
  const next = badges.find((badge) => badge.thresholdPoints > summary.lifetimeSleepPoints);
  if (!next) {
    return {
      complete: true,
      nextBadgeId: null,
      nextBadgeLabel: null,
      pointsRemaining: 0,
      targetPoints: summary.lifetimeSleepPoints,
    };
  }
  return {
    complete: false,
    nextBadgeId: next.id,
    nextBadgeLabel: next.label,
    pointsRemaining: Math.max(0, next.thresholdPoints - summary.lifetimeSleepPoints),
    targetPoints: next.thresholdPoints,
  };
}

function publicSummary(summary, rules) {
  const completed = new Set(summary.completedMilestoneIds || []);
  return {
    shopperId: summary.shopperId,
    snoozeCode: summary.snoozeCode,
    availableSleepPoints: Number(summary.availableSleepPoints || 0),
    lifetimeSleepPoints: Number(summary.lifetimeSleepPoints || 0),
    currentBadge: {
      id: summary.currentShowroomBadgeId,
      label: summary.currentShowroomBadgeLabel,
    },
    badgeProgress: nextBadgeProgress(summary, rules),
    milestones: rules.milestones
      .filter((milestone) => milestone.id !== "milestone.full_showroom.completed")
      .map((milestone) => ({
        id: milestone.id,
        label: milestone.displayName,
        description: milestone.description,
        pointAward: milestone.pointAward,
        completed: completed.has(milestone.id),
      })),
    completedPodIds: summary.completedPodIds || [],
    completedPodCount: Number(
      summary.completedPodCount || (summary.completedPodIds || []).length
    ),
    availableOfferIds: summary.unlockedOfferIds || [],
    redeemedOfferIds: summary.redeemedOfferIds || [],
    expiredOfferIds: summary.expiredOfferIds || [],
    sleepMaskGiftStatus: summary.sleepMaskGiftStatus || null,
    activeRulesVersion: summary.activeRulesVersion || rules.rulesVersion,
    summaryVersion: Number(summary.summaryVersion || 0),
    latestRewardActivityAt: summary.latestRewardActivityAt || null,
  };
}

async function getRewardSummary(identity, options = {}) {
  if (!enabled(options)) throw featureError();
  const rules = await activeRules(options);
  const stored = await (options.repository || repository).getSummary(
    identity.profileId,
    options.repositoryOptions || options
  );
  return publicSummary(stored || zeroSummary(identity, rules), rules);
}

async function getRewardHistory(identity, options = {}) {
  if (!enabled(options)) throw featureError();
  const items = await (options.repository || repository).queryByPrefix(
    identity.profileId,
    "LEDGER#",
    { ...(options.repositoryOptions || options), limit: options.limit || 50 }
  );
  return items.map((item) => ({
    id: item.SK,
    entryType: item.entryType,
    milestoneId: item.milestoneId || null,
    pointDelta: Number(item.pointDelta || 0),
    offerId: item.offerId || null,
    giftId: item.giftId || null,
    badgeId: item.badgeId || null,
    occurredAt: item.occurredAt || item.createdAt,
  }));
}

async function transitionExpiredOffer(identity, unlock, options = {}) {
  if (!unlock || unlock.status !== "unlocked") return unlock;
  const expiresAtMs = Date.parse(unlock.expiresAt || "");
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs > nowMs) return unlock;

  const repo = options.repository || repository;
  const now = new Date(nowMs).toISOString();
  const eventId = crypto.randomUUID();
  const pk = repository.profilePk(identity.profileId);
  try {
    await repo.transactItems(
      [
        {
          Update: {
            Key: { PK: pk, SK: unlock.SK },
            UpdateExpression:
              "SET #status = :expired, expiredAt = :now, updatedAt = :now",
            ConditionExpression: "#status = :unlocked",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":expired": "expired",
              ":unlocked": "unlocked",
              ":now": now,
            },
          },
        },
        {
          Update: {
            Key: { PK: pk, SK: "SUMMARY" },
            UpdateExpression:
              "SET expiredOfferIds = list_append(if_not_exists(expiredOfferIds, :empty), :offer), latestRewardActivityAt = :now, updatedAt = :now ADD summaryVersion :one",
            ExpressionAttributeValues: {
              ":empty": [],
              ":offer": [unlock.offerId],
              ":now": now,
              ":one": 1,
            },
          },
        },
        {
          Put: {
            Item: {
              PK: pk,
              SK: `LEDGER#${now}#${eventId}`,
              entityType: "LEDGER",
              entryType: "offer_expired",
              profileId: identity.profileId,
              offerId: unlock.offerId,
              occurredAt: now,
              createdAt: now,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Put: {
            Item: {
              PK: pk,
              SK: `OUTBOX#${now}#${eventId}`,
              entityType: "OUTBOX",
              profileId: identity.profileId,
              eventType: "rewards.offer.expired",
              status: "pending",
              payload: {
                profileId: identity.profileId,
                offerId: unlock.offerId,
                updatedAt: now,
              },
              createdAt: now,
              updatedAt: now,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
      {
        ...(options.repositoryOptions || options),
        clientRequestToken: crypto
          .createHash("sha256")
          .update(`${identity.profileId}|${unlock.offerId}|expired`)
          .digest("hex"),
      }
    );
    return { ...unlock, status: "expired", expiredAt: now, updatedAt: now };
  } catch (error) {
    if (
      error?.name !== "ConditionalCheckFailedException" &&
      error?.name !== "TransactionCanceledException"
    ) {
      console.error(
        JSON.stringify({
          event: "rewards.offer.expiration_failed",
          profileId: identity.profileId,
          offerId: unlock.offerId,
          code: error?.code || "REWARD_OFFER_EXPIRATION_FAILED",
        })
      );
    }
    return (
      (await repo.getEntity(
        identity.profileId,
        unlock.SK,
        options.repositoryOptions || options
      ).catch(() => null)) || unlock
    );
  }
}

async function getRewardOffers(identity, options = {}) {
  if (!enabled(options)) throw featureError();
  const rules = await activeRules(options);
  const summary = await (options.repository || repository).getSummary(
    identity.profileId,
    options.repositoryOptions || options
  );
  const unlockItems = await (options.repository || repository).queryByPrefix(
    identity.profileId,
    "UNLOCK#",
    options.repositoryOptions || options
  );
  const transitionedUnlocks = await Promise.all(
    unlockItems.map((item) => transitionExpiredOffer(identity, item, options))
  );
  const unlockById = new Map(
    transitionedUnlocks.map((item) => [item.offerId, item])
  );
  const now = options.now ? Date.parse(options.now) : Date.now();
  return rules.offers.map((offer) => {
    const unlock = unlockById.get(offer.id);
    const expired = Boolean(unlock?.expiresAt && Date.parse(unlock.expiresAt) <= now);
    return {
      id: offer.id,
      label: offer.displayLabel,
      description: offer.customerDescription,
      offerType: offer.offerType,
      unlocked: Boolean(unlock) && !expired && unlock.status === "unlocked",
      status: expired ? "expired" : unlock?.status || "locked",
      expiresAt: unlock?.expiresAt || null,
      requiredPoints: offer.requiredPoints,
      eligibility: unlock
        ? expired
          ? "expired"
          : "cart_verification_required"
        : `Unlocks at ${offer.requiredPoints || 0} Sleep Points`,
      currentPoints: Number(summary?.lifetimeSleepPoints || 0),
    };
  });
}

async function getRewardGift(identity, options = {}) {
  if (!enabled(options)) throw featureError();
  const gift = await (options.repository || repository).getEntity(
    identity.profileId,
    "GIFT#sleep_mask",
    options.repositoryOptions || options
  );
  if (!gift) return { id: "sleep_mask", status: "locked" };
  return {
    id: gift.giftId,
    status: gift.status,
    unlockedAt: gift.unlockedAt || null,
    claimedAt: gift.claimedAt || null,
    fulfilledAt: gift.fulfilledAt || null,
  };
}

async function mirrorRewardSummary(identity, summary, options = {}) {
  try {
    const patch = customerProfileService.buildCustomerProfilePatch({
      profileId: identity.profileId,
      shopperId: identity.shopperId,
      snoozeCode: identity.snoozeCode,
      accessCode: identity.accessCode || identity.snoozeCode,
      sessionId: identity.sessionId,
      sourceSurface: "rewards",
      lastIntent: "reward_summary_updated",
      rewardSummary: {
        availableSleepPoints: summary.availableSleepPoints,
        lifetimeSleepPoints: summary.lifetimeSleepPoints,
        currentShowroomBadgeId: summary.currentShowroomBadgeId,
        currentShowroomBadgeLabel: summary.currentShowroomBadgeLabel,
        completedMilestoneIds: summary.completedMilestoneIds,
        completedPodCount: summary.completedPodCount,
        availableOfferCount: summary.availableOfferCount,
        sleepMaskGiftStatus: summary.sleepMaskGiftStatus,
        activeRulesVersion: summary.activeRulesVersion,
        summaryVersion: summary.summaryVersion,
        latestRewardActivityAt: summary.latestRewardActivityAt,
        zohoSyncStatus: "pending",
      },
    });
    await customerProfileService.upsertCustomerProfile(
      patch,
      options.customerProfileOptions || {}
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "rewards.profile_mirror.failed",
        code: error.code || "REWARD_PROFILE_MIRROR_FAILED",
        profileId: identity.profileId,
      })
    );
  }
}

async function recordRewardMilestone(input, options = {}) {
  if (!enabled(options)) throw featureError();
  const rules = await activeRules(options);
  const result = await processor.processRewardMilestone(
    { ...input, rules },
    {
      ...options,
      repository: options.repository || repository,
      ...(options.repositoryOptions || {}),
    }
  );
  if (!result.duplicate) {
    await mirrorRewardSummary(input.identity, result.summary, options);
  }
  return {
    ...result,
    summary: publicSummary(result.summary, rules),
  };
}

module.exports = {
  REWARD_APPLIED_HUD,
  REWARD_APPLICATION_FAILURE_HUD,
  REWARD_FAILURE_HUD,
  activeRules,
  enabled,
  getRewardGift,
  getRewardHistory,
  getRewardOffers,
  getRewardSummary,
  mirrorRewardSummary,
  publicSummary,
  recordRewardMilestone,
  transitionExpiredOffer,
};
