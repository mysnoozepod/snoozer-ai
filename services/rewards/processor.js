"use strict";

const crypto = require("crypto");
const repository = require("./repository");
const { evaluateMilestoneEvent } = require("../rewardsDomain/events");
const { deriveShowroomBadge } = require("../rewardsDomain/rules");

const MAX_LIFETIME_POINTS = 500;

function nowIso(options = {}) {
  return options.now || new Date().toISOString();
}

function defaultSummary(identity, rules, now) {
  const badge = deriveShowroomBadge(0, rules);
  return {
    PK: repository.profilePk(identity.profileId),
    SK: "SUMMARY",
    entityType: "SUMMARY",
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
    activeRulesVersion: rules.rulesVersion,
    summaryVersion: 0,
    latestRewardActivityAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function offerUnlocks(rules, summary, completedMilestoneIds, lifetimePoints, now) {
  const existing = new Set(summary.unlockedOfferIds || []);
  return (rules.offers || [])
    .filter((offer) => offer.status === "active" && !existing.has(offer.id))
    .filter((offer) => !offer.requiredPoints || lifetimePoints >= offer.requiredPoints)
    .filter((offer) => !offer.requiredBadgeId ||
      deriveShowroomBadge(lifetimePoints, rules)?.id === offer.requiredBadgeId ||
      rules.badges.findIndex((item) => item.id === deriveShowroomBadge(lifetimePoints, rules)?.id) >=
        rules.badges.findIndex((item) => item.id === offer.requiredBadgeId))
    .filter((offer) => (offer.requiredMilestoneIds || []).every((id) => completedMilestoneIds.includes(id)))
    .map((offer) => {
      const durationDays = offer.expirationPolicy?.durationDays;
      const expiresAt = Number.isInteger(durationDays)
        ? new Date(Date.parse(now) + durationDays * 86400000).toISOString()
        : null;
      return {
        offer,
        item: {
          PK: summary.PK,
          SK: `UNLOCK#${offer.id}`,
          entityType: "UNLOCK",
          profileId: summary.profileId,
          offerId: offer.id,
          offerVersion: offer.offerVersion,
          status: "unlocked",
          unlockedAt: now,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
      };
    });
}

function buildHud(pointAward, badgeChanged, giftUnlocked) {
  const parts = [];
  if (pointAward > 0) parts.push(`You earned ${pointAward} Sleep Points.`);
  if (badgeChanged) parts.push(`You reached ${badgeChanged}.`);
  if (giftUnlocked) parts.push("Your complimentary sleep mask is ready to claim.");
  const speech = parts.join(" ");
  return {
    speech,
    captions: speech,
    state: giftUnlocked || badgeChanged ? "celebrate" : "speaking",
    priority: giftUnlocked ? "high" : "normal",
    ttlMs: 5000,
    actions: [],
  };
}

function buildTrustedEvent(input, rules, now) {
  return {
    schemaVersion: 1,
    eventId: String(input.eventId || crypto.randomUUID()),
    eventType: input.eventType,
    shopperId: input.identity.shopperId,
    profileId: input.identity.profileId,
    sessionId: input.sessionId,
    deviceId: input.deviceId || null,
    appointmentId: input.appointmentId || null,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    sourceSurface: input.sourceSurface,
    sourceSystem: "snoozer-backend",
    rulesVersion: rules.rulesVersion,
    occurredAt: input.occurredAt || now,
    receivedAt: now,
    metadata: input.metadata || {},
  };
}

function assertAuthoritativeEvidence(event, rules) {
  const metadata = event.metadata || {};
  const fail = (message) => {
    const error = new Error(message);
    error.code = "REWARD_COMPLETION_NOT_CONFIRMED";
    throw error;
  };

  switch (event.eventType) {
    case "milestone.profile.established":
      if (metadata.profileEstablished !== true) {
        fail("Customer Profile OS establishment was not confirmed.");
      }
      break;
    case "milestone.assessment.completed":
      if (
        metadata.assessmentSaved !== true ||
        (metadata.recommendationResolved !== true &&
          metadata.recommendationFallbackUsed !== true)
      ) {
        fail("Assessment persistence and recommendation completion are required.");
      }
      break;
    case "milestone.pod.completed":
      if (metadata.persisted !== true || metadata.experienceCompleted !== true) {
        fail("A persisted Pod completion is required.");
      }
      break;
    case "milestone.accessories.completed":
      if (metadata.persisted !== true || metadata.completed !== true) {
        fail("A persisted Sleep Essentials completion is required.");
      }
      break;
    case "milestone.ratings.completed":
      if (
        metadata.persisted !== true ||
        metadata.completed !== true ||
        Number(metadata.ratingCount || 0) < 1 ||
        Number(metadata.favoriteCount || 0) < 1
      ) {
        fail("At least one persisted rating and favorite are required.");
      }
      break;
    case "milestone.rest_test.completed": {
      const milestone = rules.milestones.find((item) => item.id === event.eventType);
      const minimum = Number(milestone?.metadata?.minimumDurationSeconds || 420);
      if (
        metadata.persisted !== true ||
        metadata.requiredStagesCompleted !== true ||
        Number(metadata.durationSeconds || 0) < minimum
      ) {
        fail(`A persisted Rest Test of at least ${minimum} seconds is required.`);
      }
      break;
    }
    case "milestone.full_showroom.completed":
      if (metadata.completed !== true || metadata.persisted !== true) {
        fail("Persisted showroom completion is required.");
      }
      break;
    default:
      break;
  }
}

function qualifyingPointAward(evaluation, summary, event) {
  if (evaluation.milestoneId !== "milestone.pod.completed") return evaluation.pointAward;
  const pods = new Set(summary.completedPodIds || []);
  if (pods.has(event.metadata.podId)) return 0;
  return pods.size < 3 ? evaluation.pointAward : 0;
}

async function processRewardMilestone(input, options = {}) {
  const repo = options.repository || repository;
  const rules = input.rules;
  const now = nowIso(options);
  const event = buildTrustedEvent(input, rules, now);
  assertAuthoritativeEvidence(event, rules);
  const evaluation = evaluateMilestoneEvent({ event, rules });
  if (!evaluation.accepted) {
    const error = new Error(evaluation.error?.message || "Reward event rejected.");
    error.code = evaluation.error?.code || "REWARD_EVENT_REJECTED";
    error.details = evaluation.errors || [];
    throw error;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = (await repo.getSummary(input.identity.profileId, options)) ||
      defaultSummary(input.identity, rules, now);
    const award = qualifyingPointAward(evaluation, current, event);
    const lifetime = Math.min(
      MAX_LIFETIME_POINTS,
      Number(current.lifetimeSleepPoints || 0) + award
    );
    const completedMilestones = unique([...current.completedMilestoneIds, evaluation.milestoneId]);
    const completedPods = evaluation.milestoneId === "milestone.pod.completed"
      ? unique([...current.completedPodIds, event.metadata.podId])
      : current.completedPodIds || [];
    const badge = deriveShowroomBadge(lifetime, rules);
    const unlocks = offerUnlocks(rules, current, completedMilestones, lifetime, now);
    const unlockedOfferIds = unique([
      ...(current.unlockedOfferIds || []),
      ...unlocks.map(({ offer }) => offer.id),
    ]);
    const next = {
      ...current,
      availableSleepPoints: lifetime,
      lifetimeSleepPoints: lifetime,
      currentShowroomBadgeId: badge.id,
      currentShowroomBadgeLabel: badge.label,
      completedMilestoneIds: completedMilestones,
      completedPodIds: completedPods,
      unlockedOfferIds,
      activeRulesVersion: rules.rulesVersion,
      summaryVersion: Number(current.summaryVersion || 0) + 1,
      latestRewardActivityAt: now,
      latestLedgerEntryId: `LEDGER#${now}#${event.eventId}`,
      availableOfferCount: unlockedOfferIds.length,
      completedPodCount: completedPods.length,
      updatedAt: now,
    };
    const claim = {
      PK: next.PK,
      SK: `CLAIM#${evaluation.idempotency.claimHash}`,
      entityType: "CLAIM",
      claimHash: evaluation.idempotency.claimHash,
      claimKey: evaluation.idempotency.claimKey,
      profileId: next.profileId,
      eventId: event.eventId,
      milestoneId: evaluation.milestoneId,
      pointAward: award,
      rulesVersion: rules.rulesVersion,
      createdAt: now,
    };
    const ledger = {
      PK: next.PK,
      SK: `LEDGER#${now}#${event.eventId}`,
      entityType: "LEDGER",
      entryType: "earn",
      profileId: next.profileId,
      eventId: event.eventId,
      milestoneId: evaluation.milestoneId,
      pointDelta: award,
      lifetimeBalanceAfter: lifetime,
      badgeIdAfter: badge.id,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      sourceSurface: event.sourceSurface,
      rulesVersion: rules.rulesVersion,
      occurredAt: event.occurredAt,
      createdAt: now,
    };
    const badgeChanged =
      current.currentShowroomBadgeId !== badge.id ? badge.label : null;
    const giftUnlocked = unlockedOfferIds.includes("offer.sleep_mask.completion_gift") &&
      !(current.unlockedOfferIds || []).includes("offer.sleep_mask.completion_gift");
    const gift = giftUnlocked
      ? {
          PK: next.PK,
          SK: "GIFT#sleep_mask",
          entityType: "GIFT",
          profileId: next.profileId,
          giftId: "sleep_mask",
          status: "unlocked",
          unlockedAt: now,
          createdAt: now,
          updatedAt: now,
        }
      : null;
    next.sleepMaskGiftStatus = gift
      ? gift.status
      : current.sleepMaskGiftStatus || null;
    const mutationLedgers = [];
    if (badgeChanged) {
      mutationLedgers.push({
        PK: next.PK,
        SK: `LEDGER#${now}#${event.eventId}#badge`,
        entityType: "LEDGER",
        entryType: "badge",
        profileId: next.profileId,
        eventId: event.eventId,
        badgeId: badge.id,
        badgeLabel: badge.label,
        rulesVersion: rules.rulesVersion,
        createdAt: now,
      });
    }
    unlocks.forEach(({ offer }) => {
      mutationLedgers.push({
        PK: next.PK,
        SK: `LEDGER#${now}#${event.eventId}#unlock#${offer.id}`,
        entityType: "LEDGER",
        entryType: "unlock",
        profileId: next.profileId,
        eventId: event.eventId,
        offerId: offer.id,
        offerVersion: offer.offerVersion,
        rulesVersion: rules.rulesVersion,
        createdAt: now,
      });
    });
    if (gift) {
      mutationLedgers.push({
        PK: next.PK,
        SK: `LEDGER#${now}#${event.eventId}#gift`,
        entityType: "LEDGER",
        entryType: "gift_unlocked",
        profileId: next.profileId,
        eventId: event.eventId,
        giftId: gift.giftId,
        rulesVersion: rules.rulesVersion,
        createdAt: now,
      });
    }
    const outbox = {
      PK: next.PK,
      SK: `OUTBOX#${now}#${event.eventId}`,
      entityType: "OUTBOX",
      profileId: next.profileId,
      eventType: "rewards.summary.updated",
      status: "pending",
      payload: {
        profileId: next.profileId,
        snoozeCode: next.snoozeCode,
        currentShowroomBadgeId: next.currentShowroomBadgeId,
        availableSleepPoints: next.availableSleepPoints,
        lifetimeSleepPoints: next.lifetimeSleepPoints,
        activeRulesVersion: next.activeRulesVersion,
        updatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };

    try {
      await repo.commitMilestone(
        [
          next,
          claim,
          ledger,
          ...mutationLedgers,
          ...unlocks.map(({ item }) => item),
          ...(gift ? [gift] : []),
          outbox,
        ],
        Number(current.summaryVersion || 0),
        options
      );
      console.log(JSON.stringify({
        event: "rewards.milestone.awarded",
        profileId: next.profileId,
        milestoneId: evaluation.milestoneId,
        pointAward: award,
        lifetimeSleepPoints: lifetime,
        duplicate: false,
      }));
      return {
        ok: true,
        duplicate: false,
        milestoneId: evaluation.milestoneId,
        pointAward: award,
        summary: next,
        unlockedOffers: unlocks.map(({ offer, item }) => ({
          id: offer.id,
          label: offer.displayLabel,
          expiresAt: item.expiresAt,
        })),
        gift: gift ? { id: gift.giftId, status: gift.status } : null,
        hud: buildHud(award, badgeChanged, giftUnlocked),
      };
    } catch (error) {
      const existing = await repo.getEntity(
        input.identity.profileId,
        `CLAIM#${evaluation.idempotency.claimHash}`,
        options
      ).catch(() => null);
      if (existing) {
        const summary = await repo.getSummary(input.identity.profileId, options);
        return {
          ok: true,
          duplicate: true,
          milestoneId: existing.milestoneId,
          pointAward: existing.pointAward,
          summary,
          unlockedOffers: [],
          gift: null,
          hud: buildHud(0, null, false),
        };
      }
      if (attempt === 2) throw error;
    }
  }
  throw new Error("Reward transaction retry exhausted.");
}

module.exports = {
  MAX_LIFETIME_POINTS,
  assertAuthoritativeEvidence,
  buildTrustedEvent,
  processRewardMilestone,
};
