"use strict";

const crypto = require("crypto");
const rewardsIdentity = require("../services/rewards/identity");
const rewardsRepository = require("../services/rewards/repository");
const rewardsService = require("../services/rewards/service");
const rewardsRedemption = require("../services/rewards/redemption");
const rewardsExperiences = require("../services/rewards/experiences");
const rewardsShopifyWebhook = require("../services/rewards/shopifyWebhook");

function http(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function methodOf(event = {}) {
  return String(
    event.requestContext?.http?.method || event.httpMethod || ""
  ).toUpperCase();
}

function pathOf(event = {}) {
  const rawPath = String(event.rawPath || event.path || "/");
  const stage = String(event.requestContext?.stage || "").trim();
  const normalizedPath = stage
    ? rawPath.replace(new RegExp(`^/${stage}(?=/|$)`, "i"), "") || "/"
    : rawPath;
  return normalizedPath.replace(/\/+$/, "") || "/";
}

function requestIdOf(event = {}) {
  return (
    event.requestContext?.requestId ||
    rewardsIdentity.header(event.headers, "x-request-id") ||
    crypto.randomUUID()
  );
}

function success(requestId, data, statusCode = 200) {
  return http(statusCode, { ok: true, requestId, ...data });
}

function failure(requestId, error) {
  const statusCode = Number(error?.statusCode) || 500;
  const publicMessage =
    statusCode >= 500
      ? "Rewards are temporarily unavailable. Your showroom experience can continue."
      : error?.message || "The reward request could not be completed.";
  console.error(
    JSON.stringify({
      event: "rewards.route.failed",
      requestId,
      code: error?.code || "REWARDS_REQUEST_FAILED",
      statusCode,
    })
  );
  return http(statusCode, {
    ok: false,
    requestId,
    error: {
      code: error?.code || "REWARDS_REQUEST_FAILED",
      message: publicMessage,
    },
    hud: rewardsService.REWARD_FAILURE_HUD,
  });
}

function requireBody(event) {
  const body = rewardsIdentity.parseBody(event);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("A JSON request body is required.");
    error.code = "REWARD_BODY_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return body;
}

async function resolvePublicIdentity(event, options) {
  return rewardsIdentity.resolveRewardsIdentity(event, options);
}

async function resolveInternalIdentity(event, options = {}) {
  rewardsIdentity.requireInternalRewardsAuth(event, options);
  return rewardsIdentity.resolveRewardsIdentity(event, {
    ...options,
    requireSession: false,
  });
}

async function updateGift(identity, nextStatus, options = {}) {
  const repository = options.repository || rewardsRepository;
  const gift = await repository.getEntity(
    identity.profileId,
    "GIFT#sleep_mask",
    options.repositoryOptions || options
  );
  if (!gift) {
    const error = new Error("The sleep-mask gift is not available for this profile.");
    error.code = "REWARD_GIFT_UNAVAILABLE";
    error.statusCode = 409;
    throw error;
  }
  if (gift.status === nextStatus) return gift;
  const allowedTransitions = {
    unlocked: new Set(["claimed", "fulfilled", "unavailable", "reversed"]),
    claimed: new Set(["fulfilled", "unavailable", "reversed"]),
    fulfilled: new Set(["reversed"]),
    unavailable: new Set(["reversed"]),
    reversed: new Set(),
  };
  if (!allowedTransitions[gift.status]?.has(nextStatus)) {
    const error = new Error("The sleep-mask gift cannot move to that status.");
    error.code = "REWARD_GIFT_TRANSITION_INVALID";
    error.statusCode = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const entryType = `gift_${nextStatus}`;
  const eventId = crypto.randomUUID();
  const pk = rewardsRepository.profilePk(identity.profileId);
  const statusField = `${nextStatus}At`;
  const outboxId = `OUTBOX#${now}#${eventId}`;
  await repository.transactItems(
    [
      {
        Update: {
          Key: { PK: pk, SK: "GIFT#sleep_mask" },
          UpdateExpression:
            "SET #status = :status, #statusAt = :now, updatedAt = :now",
          ConditionExpression: "#status = :currentStatus",
          ExpressionAttributeNames: {
            "#status": "status",
            "#statusAt": statusField,
          },
          ExpressionAttributeValues: {
            ":status": nextStatus,
            ":now": now,
            ":currentStatus": gift.status,
          },
        },
      },
      {
        Update: {
          Key: { PK: pk, SK: "SUMMARY" },
          UpdateExpression:
            "SET sleepMaskGiftStatus = :status, latestRewardActivityAt = :now, updatedAt = :now ADD summaryVersion :one",
          ExpressionAttributeValues: {
            ":status": nextStatus,
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
            entryType,
            profileId: identity.profileId,
            giftId: "sleep_mask",
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
            SK: outboxId,
            entityType: "OUTBOX",
            profileId: identity.profileId,
            eventType: `rewards.${entryType}`,
            status: "pending",
            payload: {
              profileId: identity.profileId,
              shopperId: identity.shopperId,
              giftId: "sleep_mask",
              giftStatus: nextStatus,
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
      clientRequestToken: eventId,
    }
  );
  return {
    ...gift,
    status: nextStatus,
    [statusField]: now,
    updatedAt: now,
  };
}

async function handleRewardsRoutes(event = {}, options = {}) {
  const method = methodOf(event);
  const routePath = pathOf(event);
  const isShopifyWebhook = routePath === "/webhooks/shopify/rewards";
  if (!routePath.startsWith("/rewards") && !isShopifyWebhook) return null;
  const requestId = requestIdOf(event);

  try {
    if (method === "POST" && isShopifyWebhook) {
      const result = await rewardsShopifyWebhook.processShopifyRewardsWebhook(
        event,
        options
      );
      return success(requestId, { result });
    }
    if (routePath === "/rewards/earn" || routePath === "/rewards/redeem") {
      return http(410, {
        ok: false,
        requestId,
        error: {
          code: "REWARD_LEGACY_ROUTE_RETIRED",
          message: "This legacy reward operation is no longer available.",
        },
      });
    }

    if (method === "GET" && routePath === "/rewards/summary") {
      const identity = await resolvePublicIdentity(event, options);
      const reconciliation =
        await rewardsService.reconcileExistingCanonicalRewards(identity, options);
      return success(requestId, {
        summary:
          reconciliation.summary ||
          (await rewardsService.getRewardSummary(identity, options)),
      });
    }
    if (method === "GET" && routePath === "/rewards/history") {
      const identity = await resolvePublicIdentity(event, options);
      return success(requestId, {
        history: await rewardsService.getRewardHistory(identity, options),
      });
    }
    if (method === "GET" && routePath === "/rewards/offers") {
      const identity = await resolvePublicIdentity(event, options);
      return success(requestId, {
        offers: await rewardsService.getRewardOffers(identity, options),
      });
    }
    if (method === "GET" && routePath === "/rewards/gift") {
      const identity = await resolvePublicIdentity(event, options);
      return success(requestId, {
        gift: await rewardsService.getRewardGift(identity, options),
      });
    }
    if (method === "POST" && routePath === "/rewards/events") {
      const body = requireBody(event);
      const identity = await resolveInternalIdentity(event, options);
      const result = await rewardsService.recordRewardMilestone(
        {
          identity,
          eventId: body.eventId,
          eventType: body.eventType,
          sessionId: body.sessionId || identity.sessionId || "internal",
          deviceId: body.deviceId || null,
          appointmentId: body.appointmentId || null,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          sourceSurface: body.sourceSurface,
          occurredAt: body.occurredAt,
          metadata: body.metadata || {},
        },
        options
      );
      return success(requestId, { result });
    }
    if (
      method === "POST" &&
      routePath === "/rewards/experiences/rest-test/start"
    ) {
      const body = requireBody(event);
      const identity = await resolvePublicIdentity(event, options);
      const experience = await rewardsExperiences.startRestTest(
        identity,
        body,
        options
      );
      return success(requestId, { experience }, 201);
    }
    if (
      method === "POST" &&
      routePath === "/rewards/experiences/rest-test/stage"
    ) {
      const body = requireBody(event);
      const identity = await resolvePublicIdentity(event, options);
      const stage = await rewardsExperiences.recordRestTestStage(
        identity,
        body,
        options
      );
      return success(requestId, { stage }, 201);
    }
    if (
      method === "POST" &&
      routePath === "/rewards/experiences/rest-test/complete"
    ) {
      const body = requireBody(event);
      const identity = await resolvePublicIdentity(event, options);
      return success(requestId, {
        result: await rewardsExperiences.completeRestTest(
          identity,
          body,
          options
        ),
      });
    }
    if (
      method === "POST" &&
      routePath === "/rewards/experiences/ratings"
    ) {
      const body = requireBody(event);
      const identity = await resolvePublicIdentity(event, options);
      return success(requestId, {
        result: await rewardsExperiences.saveRatingsAndFavorite(
          identity,
          body,
          options
        ),
      });
    }
    if (
      method === "POST" &&
      routePath === "/rewards/experiences/accessories/complete"
    ) {
      const body = requireBody(event);
      const identity = await resolvePublicIdentity(event, options);
      return success(requestId, {
        result: await rewardsExperiences.completeAccessoriesExperience(
          identity,
          body,
          options
        ),
      });
    }
    if (method === "POST" && routePath === "/rewards/redemptions/preview") {
      const body = requireBody(event);
      const identity = await resolvePublicIdentity(event, options);
      const rules = await rewardsService.activeRules(options);
      const preview = await rewardsRedemption.previewRedemption(
        {
          identity,
          rules,
          offerId: body.offerId,
          cartId: body.cartId,
        },
        options
      );
      return success(requestId, { preview });
    }
    if (method === "POST" && routePath === "/rewards/redemptions") {
      const body = requireBody(event);
      const identity = await resolvePublicIdentity(event, options);
      const rules = await rewardsService.activeRules(options);
      const redemption = await rewardsRedemption.createRedemption(
        {
          identity,
          rules,
          offerId: body.offerId,
          cartId: body.cartId,
          cartFingerprint: body.cartFingerprint,
          idempotencyKey:
            rewardsIdentity.header(event.headers, "idempotency-key") ||
            body.idempotencyKey,
        },
        options
      );
      return success(requestId, {
        redemption,
        hud:
          redemption.status === "cart_bound"
            ? rewardsService.REWARD_APPLIED_HUD
            : null,
      });
    }
    if (
      method === "POST" &&
      routePath === "/rewards/internal/redemptions/reverse"
    ) {
      const body = requireBody(event);
      const identity = await resolveInternalIdentity(event, options);
      return success(requestId, {
        redemption: await rewardsRedemption.reverseRedemption(
          {
            identity,
            redemptionId: String(body.redemptionId || "").trim(),
            reason: body.reason,
          },
          options
        ),
      });
    }
    const redemptionMatch = routePath.match(
      /^\/rewards\/redemptions\/([^/]+)$/
    );
    if (method === "GET" && redemptionMatch) {
      const identity = await resolvePublicIdentity(event, options);
      const redemption = await (options.repository || rewardsRepository).getEntity(
        identity.profileId,
        `REDEMPTION#${decodeURIComponent(redemptionMatch[1])}`,
        options.repositoryOptions || options
      );
      if (!redemption) {
        const error = new Error("Reward redemption was not found.");
        error.code = "REWARD_REDEMPTION_NOT_FOUND";
        error.statusCode = 404;
        throw error;
      }
      return success(requestId, { redemption });
    }
    if (method === "POST" && routePath === "/rewards/gift/claim") {
      const identity = await resolvePublicIdentity(event, options);
      return success(requestId, {
        gift: await updateGift(identity, "claimed", options),
      });
    }
    if (
      method === "POST" &&
      routePath === "/rewards/internal/gift/fulfill"
    ) {
      const identity = await resolveInternalIdentity(event, options);
      return success(requestId, {
        gift: await updateGift(identity, "fulfilled", options),
      });
    }
    if (
      method === "POST" &&
      routePath === "/rewards/internal/gift/status"
    ) {
      const body = requireBody(event);
      const nextStatus = String(body.status || "").trim().toLowerCase();
      if (!["fulfilled", "unavailable", "reversed"].includes(nextStatus)) {
        const error = new Error("Gift status must be fulfilled, unavailable, or reversed.");
        error.code = "REWARD_GIFT_STATUS_INVALID";
        error.statusCode = 400;
        throw error;
      }
      const identity = await resolveInternalIdentity(event, options);
      return success(requestId, {
        gift: await updateGift(identity, nextStatus, options),
      });
    }

    return http(404, {
      ok: false,
      requestId,
      error: { code: "REWARD_ROUTE_NOT_FOUND", message: "Reward route not found." },
    });
  } catch (error) {
    return failure(requestId, error);
  }
}

module.exports = {
  handleRewardsRoutes,
  updateGift,
};
