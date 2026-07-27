"use strict";

const crypto = require("crypto");
const shopify = require("../shopify");
const {
  calculateDiscountCapMinor,
  parseMoneyToMinorUnits,
} = require("../rewardsDomain/money");
const { qualifiesProductForOffer } = require("../rewardsDomain/offers");
const classificationLoader = require("./classificationLoader");
const repository = require("./repository");

function rewardError(code, message, statusCode = 400, details) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function isConditionalFailure(error) {
  return (
    error?.name === "ConditionalCheckFailedException" ||
    error?.name === "TransactionCanceledException"
  );
}

function fingerprintCart(cart) {
  const source = classificationLoader
    .flattenCartLines(cart)
    .map((line) => ({
      id: line.id,
      quantity: line.quantity,
      variantId: line.merchandise?.id,
      amount: line.merchandise?.price?.amount,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return crypto.createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

function lineUnitPriceMinor(line) {
  const parsed = parseMoneyToMinorUnits(String(line.price?.amount || ""));
  if (!parsed.ok) throw rewardError("REWARD_PRICE_REQUIRED", "Shopify did not return a usable price.");
  return parsed.minorUnits;
}

function eligibleUnits(lines, offer) {
  const units = [];
  for (const line of lines) {
    if (!line.classification) continue;
    if (!qualifiesProductForOffer(line.classification, offer).eligible) continue;
    const priceMinor = lineUnitPriceMinor(line);
    for (let index = 0; index < line.quantity; index += 1) {
      units.push({ ...line, priceMinor });
    }
  }
  return units;
}

function previewOffer({ offer, cart, classifications }) {
  const lines = classificationLoader.classifyCart(cart, classifications);
  if (lines.some((line) => !line.classification)) {
    throw rewardError(
      "REWARD_PRODUCT_UNCLASSIFIED",
      "One or more cart products are not approved for reward calculation."
    );
  }
  const currencyCode =
    lines.find((line) => line.price?.currencyCode)?.price?.currencyCode || "USD";
  const existingDiscountCodes = (cart.discountCodes || [])
    .filter((discount) => discount?.applicable)
    .map((discount) => String(discount.code || "").trim())
    .filter(Boolean);
  if (
    existingDiscountCodes.length &&
    offer.stackingPolicy?.allowsShopifyPromotions !== true
  ) {
    throw rewardError(
      "REWARD_DISCOUNT_CONFLICT",
      "This reward cannot be combined with the cart's current promotion.",
      409
    );
  }
  const units = eligibleUnits(lines, offer);
  let target;
  let discountMinor;

  if (offer.offerType === "second_item_percentage") {
    if (units.length < 2) {
      throw rewardError("REWARD_OFFER_INELIGIBLE", "Two eligible pillows are required.");
    }
    target = [...units].sort((a, b) => a.priceMinor - b.priceMinor)[0];
    discountMinor = calculateDiscountCapMinor(
      target.priceMinor,
      offer.rewardValue.percentageBasisPoints
    ).maximumDiscountMinor;
  } else if (offer.offerType === "qualifying_purchase_gift") {
    const mattresses = lines.filter(
      (line) => line.classification?.categories?.includes("mattress")
    );
    const pillows = units.filter(
      (line) =>
        line.classification.categories.includes("pillow") &&
        !line.classification.categories.includes("memory_foam_pillow")
    );
    if (!mattresses.length || !pillows.length) {
      throw rewardError(
        "REWARD_OFFER_INELIGIBLE",
        "An eligible mattress and standard pillow are required."
      );
    }
    target = [...pillows].sort((a, b) => a.priceMinor - b.priceMinor)[0];
    const configuredMaximum = Number(offer.rewardValue.maximumValueMinor);
    discountMinor = Number.isInteger(configuredMaximum)
      ? Math.min(target.priceMinor, configuredMaximum)
      : target.priceMinor;
  } else if (offer.offerType === "percentage_savings") {
    if (!units.length) {
      throw rewardError(
        "REWARD_OFFER_INELIGIBLE",
        "A qualifying mattress or adjustable base is required."
      );
    }
    target = [...units].sort((a, b) => b.priceMinor - a.priceMinor)[0];
    discountMinor = calculateDiscountCapMinor(
      target.priceMinor,
      offer.rewardValue.percentageBasisPoints
    ).maximumDiscountMinor;
  } else {
    throw rewardError("REWARD_OFFER_INELIGIBLE", "This offer is not a cart discount.");
  }

  return {
    offerId: offer.id,
    cartId: cart.id,
    cartFingerprint: fingerprintCart(cart),
    existingDiscountCodes,
    currencyCode,
    target: {
      lineId: target.lineId,
      variantId: target.variantId,
      productId: target.productId,
      handle: target.handle,
      sellingPriceMinor: target.priceMinor,
    },
    discountMinor,
    customerMessage: `You've unlocked ${(discountMinor / 100).toLocaleString("en-US", {
      style: "currency",
      currency: currencyCode,
    })} in earned savings.`,
  };
}

async function getUnlockedOffer(identity, offerId, options = {}) {
  const unlock = await (options.repository || repository).getEntity(
    identity.profileId,
    `UNLOCK#${offerId}`,
    options.repositoryOptions || options
  );
  if (!unlock || unlock.status !== "unlocked") {
    throw rewardError("REWARD_OFFER_LOCKED", "This reward offer is not available.", 403);
  }
  if (unlock.expiresAt && Date.parse(unlock.expiresAt) <= Date.now()) {
    throw rewardError("REWARD_OFFER_EXPIRED", "This reward offer has expired.", 409);
  }
  return unlock;
}

async function previewRedemption(input, options = {}) {
  const rules = input.rules;
  const offer = rules.offers.find((item) => item.id === input.offerId);
  if (!offer || offer.status !== "active") {
    throw rewardError("REWARD_OFFER_UNKNOWN", "Reward offer was not found.", 404);
  }
  await getUnlockedOffer(input.identity, offer.id, options);
  const cart = await (options.shopify || shopify).getCart({ cartId: input.cartId });
  const loaded = await classificationLoader.loadProductClassifications(
    options.classificationOptions || options
  );
  return previewOffer({ offer, cart, classifications: loaded.document });
}

function verifiedApplication(offerId, options = {}) {
  const raw =
    options.priceRuleMappings || process.env.REWARDS_SHOPIFY_PRICE_RULE_IDS_JSON || "{}";
  let mappings;
  try {
    mappings = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw rewardError("REWARD_SHOPIFY_MAPPING_INVALID", "Reward application is not configured.", 503);
  }
  const mapping = mappings?.[offerId];
  if (!mapping?.verified || !mapping?.priceRuleId) {
    throw rewardError(
      "REWARD_SHOPIFY_APPLICATION_NOT_VERIFIED",
      "This reward cannot be applied right now. Normal checkout is still available.",
      503
    );
  }
  return mapping;
}

async function createRedemption(input, options = {}) {
  if (String(process.env.REWARDS_REDEMPTION_ENABLED).toLowerCase() !== "true" &&
      options.redemptionEnabled !== true) {
    throw rewardError(
      "REWARD_REDEMPTION_DISABLED",
      "Reward application is not enabled. Normal checkout is still available.",
      503
    );
  }
  if (!input.idempotencyKey) {
    throw rewardError("REWARD_IDEMPOTENCY_REQUIRED", "An idempotency key is required.");
  }
  const existing = await (options.repository || repository).getEntity(
    input.identity.profileId,
    `REDEMPTION#${input.idempotencyKey}`,
    options.repositoryOptions || options
  );
  if (existing) return existing;

  const preview = await previewRedemption(input, options);
  if (input.cartFingerprint && input.cartFingerprint !== preview.cartFingerprint) {
    throw rewardError("REWARD_CART_CHANGED", "The cart changed. Review the reward again.", 409);
  }
  const mapping = verifiedApplication(input.offerId, options);
  if (
    Number.isInteger(mapping.maximumDiscountMinor) &&
    preview.discountMinor > mapping.maximumDiscountMinor
  ) {
    throw rewardError("REWARD_DISCOUNT_CAP_EXCEEDED", "The verified Shopify rule is too small.", 409);
  }

  const now = new Date().toISOString();
  const redemptionId = input.idempotencyKey;
  const pending = {
    PK: repository.profilePk(input.identity.profileId),
    SK: `REDEMPTION#${redemptionId}`,
    entityType: "REDEMPTION",
    redemptionId,
    profileId: input.identity.profileId,
    offerId: input.offerId,
    cartId: preview.cartId,
    cartFingerprint: preview.cartFingerprint,
    discountMinor: preview.discountMinor,
    currencyCode: preview.currencyCode,
    status: "validated",
    createdAt: now,
    updatedAt: now,
  };
  const repo = options.repository || repository;
  const pk = repository.profilePk(input.identity.profileId);
  const reservationEventId = crypto.randomUUID();
  try {
    await repo.transactItems(
      [
        {
          Put: {
            Item: pending,
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Put: {
            Item: {
              PK: pk,
              SK: `LEDGER#${now}#${reservationEventId}`,
              entityType: "LEDGER",
              entryType: "redemption_reserved",
              profileId: input.identity.profileId,
              redemptionId,
              offerId: input.offerId,
              cartId: preview.cartId,
              discountMinor: preview.discountMinor,
              currencyCode: preview.currencyCode,
              occurredAt: now,
              createdAt: now,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
      {
        ...(options.repositoryOptions || options),
        clientRequestToken: crypto
          .createHash("sha256")
          .update(`${redemptionId}|reservation`)
          .digest("hex"),
      }
    );
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
    const concurrent = await repo.getEntity(
      input.identity.profileId,
      pending.SK,
      options.repositoryOptions || options
    );
    if (concurrent) return concurrent;
    throw error;
  }

  try {
    const code = `SNOOZE-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    const issued = await (options.shopify || shopify).createDiscountCode({
      code,
      priceRuleId: mapping.priceRuleId,
    });
    const boundCart = await (options.shopify || shopify).applyDiscountCodes({
      cartId: preview.cartId,
      discountCodes: [...preview.existingDiscountCodes, code],
    });
    const applied = (boundCart?.discountCodes || []).some(
      (discount) => discount?.applicable && discount?.code === code
    );
    if (!applied) {
      throw rewardError(
        "REWARD_SHOPIFY_NOT_APPLIED",
        "Shopify did not confirm the reward on this cart.",
        502
      );
    }

    const completedAt = new Date().toISOString();
    const ledgerId = crypto.randomUUID();
    await repo.transactItems(
      [
        {
          Update: {
            Key: { PK: pk, SK: pending.SK },
            UpdateExpression:
              "SET #status = :status, shopifyDiscountCodeId = :shopifyId, discountCode = :code, completedAt = :now, updatedAt = :now",
            ConditionExpression: "#status = :validated",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":status": "cart_bound",
              ":validated": "validated",
              ":shopifyId": issued?.id || null,
              ":code": code,
              ":now": completedAt,
            },
          },
        },
        {
          Update: {
            Key: { PK: pk, SK: `UNLOCK#${input.offerId}` },
            UpdateExpression:
              "SET #status = :status, redeemedAt = :now, redemptionId = :redemptionId, updatedAt = :now",
            ConditionExpression: "#status = :unlocked",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":status": "redeemed",
              ":unlocked": "unlocked",
              ":now": completedAt,
              ":redemptionId": redemptionId,
            },
          },
        },
        {
          Update: {
            Key: { PK: pk, SK: "SUMMARY" },
            UpdateExpression:
              "SET redeemedOfferIds = list_append(if_not_exists(redeemedOfferIds, :empty), :offer), latestRewardActivityAt = :now, updatedAt = :now ADD summaryVersion :one",
            ExpressionAttributeValues: {
              ":empty": [],
              ":offer": [input.offerId],
              ":now": completedAt,
              ":one": 1,
            },
          },
        },
        {
          Put: {
            Item: {
              PK: pk,
              SK: `LEDGER#${completedAt}#${ledgerId}`,
              entityType: "LEDGER",
              entryType: "redemption_completed",
              profileId: input.identity.profileId,
              redemptionId,
              offerId: input.offerId,
              cartId: preview.cartId,
              discountMinor: preview.discountMinor,
              currencyCode: preview.currencyCode,
              occurredAt: completedAt,
              createdAt: completedAt,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Put: {
            Item: {
              PK: pk,
              SK: `OUTBOX#${completedAt}#${ledgerId}`,
              entityType: "OUTBOX",
              profileId: input.identity.profileId,
              eventType: "rewards.redemption.completed",
              status: "pending",
              payload: {
                profileId: input.identity.profileId,
                redemptionId,
                offerId: input.offerId,
                cartId: preview.cartId,
                discountMinor: preview.discountMinor,
                currencyCode: preview.currencyCode,
                updatedAt: completedAt,
              },
              createdAt: completedAt,
              updatedAt: completedAt,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Put: {
            Item: {
              PK: `SHOPIFY#DISCOUNT#${code}`,
              SK: "REWARD_BINDING",
              entityType: "SHOPIFY_REWARD_BINDING",
              profileId: input.identity.profileId,
              redemptionId,
              offerId: input.offerId,
              cartId: preview.cartId,
              discountCode: code,
              status: "active",
              createdAt: completedAt,
              updatedAt: completedAt,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
      {
        ...(options.repositoryOptions || options),
        clientRequestToken: redemptionId,
      }
    );
    return {
      ...pending,
      status: "cart_bound",
      shopifyDiscountCodeId: issued?.id || null,
      discountCode: code,
      completedAt,
      updatedAt: completedAt,
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const failureEventId = crypto.randomUUID();
    await repo.transactItems(
      [
        {
          Update: {
            Key: { PK: pk, SK: pending.SK },
            UpdateExpression:
              "SET #status = :failed, failureCode = :failureCode, failedAt = :now, updatedAt = :now",
            ConditionExpression: "#status = :validated",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":failed": "failed",
              ":validated": "validated",
              ":failureCode": error.code || "SHOPIFY_REWARD_ISSUANCE_FAILED",
              ":now": failedAt,
            },
          },
        },
        {
          Put: {
            Item: {
              PK: pk,
              SK: `LEDGER#${failedAt}#${failureEventId}`,
              entityType: "LEDGER",
              entryType: "redemption_failed",
              profileId: input.identity.profileId,
              redemptionId,
              offerId: input.offerId,
              cartId: preview.cartId,
              failureCode: error.code || "SHOPIFY_REWARD_ISSUANCE_FAILED",
              occurredAt: failedAt,
              createdAt: failedAt,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Put: {
            Item: {
              PK: pk,
              SK: `OUTBOX#${failedAt}#${failureEventId}`,
              entityType: "OUTBOX",
              profileId: input.identity.profileId,
              eventType: "rewards.redemption.failed",
              status: "pending",
              payload: {
                profileId: input.identity.profileId,
                redemptionId,
                offerId: input.offerId,
                failureCode: error.code || "SHOPIFY_REWARD_ISSUANCE_FAILED",
                updatedAt: failedAt,
              },
              createdAt: failedAt,
              updatedAt: failedAt,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
      {
        ...(options.repositoryOptions || options),
        clientRequestToken: crypto
          .createHash("sha256")
          .update(`${redemptionId}|failed`)
          .digest("hex"),
      }
    ).catch((persistenceError) => {
      console.error(
        JSON.stringify({
          event: "rewards.redemption.failure_persistence_failed",
          redemptionId,
          code:
            persistenceError.code ||
            "REWARD_REDEMPTION_FAILURE_PERSISTENCE_FAILED",
        })
      );
    });
    throw rewardError(
      "REWARD_SHOPIFY_ISSUANCE_FAILED",
      "Your reward could not be applied, but normal checkout is still available.",
      502
    );
  }
}

async function reverseRedemption(input, options = {}) {
  const repo = options.repository || repository;
  const redemption = await repo.getEntity(
    input.identity.profileId,
    `REDEMPTION#${input.redemptionId}`,
    options.repositoryOptions || options
  );
  if (!redemption) {
    throw rewardError("REWARD_REDEMPTION_NOT_FOUND", "Reward redemption was not found.", 404);
  }
  if (redemption.status === "reversed") return redemption;
  if (redemption.status !== "cart_bound") {
    throw rewardError(
      "REWARD_REDEMPTION_NOT_REVERSIBLE",
      "This reward redemption cannot be reversed.",
      409
    );
  }

  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const pk = repository.profilePk(input.identity.profileId);
  const commerceEntryType = ["refund", "return"].includes(input.commerceEventType)
    ? input.commerceEventType
    : null;
  const commerceLedger = commerceEntryType
    ? {
        Put: {
          Item: {
            PK: pk,
            SK: `LEDGER#${now}#${eventId}#${commerceEntryType}`,
            entityType: "LEDGER",
            entryType: commerceEntryType,
            profileId: input.identity.profileId,
            redemptionId: redemption.redemptionId,
            offerId: redemption.offerId,
            shopifyWebhookId: input.shopifyWebhookId || null,
            shopifyOrderId: input.shopifyOrderId || null,
            occurredAt: now,
            createdAt: now,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      }
    : null;
  await repo.transactItems(
    [
      {
        Update: {
          Key: { PK: pk, SK: redemption.SK },
          UpdateExpression:
            "SET #status = :reversed, reversedAt = :now, reversalReason = :reason, updatedAt = :now",
          ConditionExpression: "#status = :cartBound",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":reversed": "reversed",
            ":cartBound": "cart_bound",
            ":now": now,
            ":reason": String(input.reason || "commerce_reversal").slice(0, 160),
          },
        },
      },
      {
        Put: {
          Item: {
            PK: pk,
            SK: `LEDGER#${now}#${eventId}`,
            entityType: "LEDGER",
            entryType: "redemption_reversed",
            profileId: input.identity.profileId,
            redemptionId: redemption.redemptionId,
            offerId: redemption.offerId,
            reason: String(input.reason || "commerce_reversal").slice(0, 160),
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
            profileId: input.identity.profileId,
            eventType: "rewards.redemption.reversed",
            status: "pending",
            payload: {
              profileId: input.identity.profileId,
              redemptionId: redemption.redemptionId,
              offerId: redemption.offerId,
              reason: String(input.reason || "commerce_reversal").slice(0, 160),
              updatedAt: now,
            },
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
      ...(commerceLedger ? [commerceLedger] : []),
    ],
    {
      ...(options.repositoryOptions || options),
      clientRequestToken: crypto
        .createHash("sha256")
        .update(`${redemption.redemptionId}|reverse`)
        .digest("hex"),
    }
  );
  return {
    ...redemption,
    status: "reversed",
    reversedAt: now,
    reversalReason: String(input.reason || "commerce_reversal").slice(0, 160),
    updatedAt: now,
  };
}

module.exports = {
  createRedemption,
  fingerprintCart,
  previewOffer,
  previewRedemption,
  reverseRedemption,
  rewardError,
};
