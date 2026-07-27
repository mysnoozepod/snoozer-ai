"use strict";

const {
  DISCOUNT_OFFER_TYPES,
  PRODUCT_CATEGORIES,
  PRODUCT_CLASSIFICATION_SOURCES,
} = require("./constants");
const { createRewardError, validationResult } = require("./errors");
const { cleanString, isObject } = require("./rules");

function validateProductClassification(input) {
  const errors = [];
  if (!isObject(input)) {
    return validationResult([
      createRewardError("REWARD_PRODUCT_UNCLASSIFIED", "Product classification is required."),
    ]);
  }
  if (!cleanString(input.canonicalProductId)) {
    errors.push(
      createRewardError("REWARD_PRODUCT_UNCLASSIFIED", "Canonical product ID is required.")
    );
  }
  if (!cleanString(input.classificationVersion)) {
    errors.push(
      createRewardError("REWARD_PRODUCT_UNCLASSIFIED", "Classification version is required.")
    );
  }
  if (!PRODUCT_CLASSIFICATION_SOURCES.includes(input.source)) {
    errors.push(
      createRewardError("REWARD_PRODUCT_UNCLASSIFIED", "Classification source is not curated.")
    );
  }
  if (!Array.isArray(input.categories) || input.categories.length === 0) {
    errors.push(
      createRewardError("REWARD_PRODUCT_UNCLASSIFIED", "At least one curated category is required.")
    );
  } else {
    for (const category of input.categories) {
      if (!PRODUCT_CATEGORIES.includes(category)) {
        errors.push(
          createRewardError("REWARD_PRODUCT_UNCLASSIFIED", `Unknown product category: ${category}`)
        );
      }
    }
  }
  return validationResult(errors, input);
}

function qualifiesProductForOffer(product, offer) {
  const classification = validateProductClassification(product);
  if (!classification.ok) {
    return { eligible: false, error: classification.errors[0], errors: classification.errors };
  }
  if (!isObject(offer) || !Array.isArray(offer.qualifyingProductCategories)) {
    return {
      eligible: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "Offer qualification is invalid."),
    };
  }
  const categories = new Set(product.categories);
  const excluded = (offer.excludedProductCategories || []).find((category) =>
    categories.has(category)
  );
  if (excluded) {
    return {
      eligible: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "Product category is excluded.", {
        category: excluded,
      }),
    };
  }
  const matched = offer.qualifyingProductCategories.filter((category) =>
    categories.has(category)
  );
  if (matched.length === 0) {
    return {
      eligible: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "Product does not qualify."),
    };
  }
  return { eligible: true, matchedCategories: matched };
}

function evaluateOfferEligibility(input = {}) {
  const { offer, product, rewardState = {}, purchase = {} } = input;
  if (!isObject(offer) || offer.status !== "active") {
    return {
      eligible: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "Offer is not active."),
    };
  }

  if ((offer.qualifyingProductCategories || []).length > 0) {
    const productResult = qualifiesProductForOffer(product, offer);
    if (!productResult.eligible) return productResult;
  }

  if (
    offer.requiredBadgeId &&
    !(rewardState.earnedBadgeIds || []).includes(offer.requiredBadgeId)
  ) {
    return {
      eligible: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "Required badge has not been earned."),
    };
  }
  if (
    Number.isInteger(offer.requiredPoints) &&
    Number(rewardState.availableSleepPoints || 0) < offer.requiredPoints
  ) {
    return {
      eligible: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "Required points are not available."),
    };
  }
  const completedMilestones = new Set(rewardState.completedMilestoneIds || []);
  const missingMilestone = (offer.requiredMilestoneIds || []).find(
    (milestoneId) => !completedMilestones.has(milestoneId)
  );
  if (missingMilestone) {
    return {
      eligible: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "Required milestone is incomplete.", {
        milestoneId: missingMilestone,
      }),
    };
  }
  if (
    offer.qualifyingPurchaseRequired &&
    purchase.qualifyingPurchaseConfirmed !== true
  ) {
    return {
      eligible: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "A qualifying purchase is required."),
    };
  }
  if (
    Number(purchase.qualifyingQuantity || 0) <
    Number(offer.minimumQualifyingQuantity || 0)
  ) {
    return {
      eligible: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "Qualifying quantity is insufficient."),
    };
  }
  if (
    Number.isInteger(offer.minimumQualifyingSubtotalMinor) &&
    Number(purchase.qualifyingSubtotalMinor || 0) <
      offer.minimumQualifyingSubtotalMinor
  ) {
    return {
      eligible: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "Qualifying subtotal is insufficient."),
    };
  }

  return {
    eligible: true,
    offerId: offer.id,
    reason: "CONTROLLED_OFFER_REQUIREMENTS_SATISFIED",
  };
}

function isDiscountOffer(offer) {
  return DISCOUNT_OFFER_TYPES.includes(offer?.offerType);
}

function permitsOffer(first, second) {
  const policy = first?.stackingPolicy || { mode: "none" };
  if (policy.mode === "stackable") return true;
  if (policy.mode !== "explicit") return false;
  return (
    (policy.allowedOfferIds || []).includes(second?.id) ||
    (policy.allowedOfferTypes || []).includes(second?.offerType) ||
    (policy.allowedExclusivityGroups || []).includes(second?.exclusivityGroup)
  );
}

function evaluateOfferCompatibility(first, second) {
  if (!isObject(first) || !isObject(second)) {
    return {
      compatible: false,
      error: createRewardError("REWARD_OFFER_CONFLICT", "Two valid offers are required."),
    };
  }
  if (first.id === second.id) {
    return {
      compatible: false,
      error: createRewardError("REWARD_OFFER_CONFLICT", "The same offer cannot be applied twice."),
    };
  }
  if (
    cleanString(first.exclusivityGroup) &&
    first.exclusivityGroup === second.exclusivityGroup
  ) {
    return {
      compatible: false,
      error: createRewardError("REWARD_OFFER_CONFLICT", "Offers share an exclusivity group.", {
        exclusivityGroup: first.exclusivityGroup,
      }),
    };
  }
  const eitherDiscount = isDiscountOffer(first) || isDiscountOffer(second);
  const allowed = permitsOffer(first, second) && permitsOffer(second, first);
  if (eitherDiscount && !allowed) {
    return {
      compatible: false,
      error: createRewardError("REWARD_OFFER_CONFLICT", "Offer stacking is not explicitly allowed."),
    };
  }
  if (!eitherDiscount && (first.stackingPolicy?.mode === "none" || second.stackingPolicy?.mode === "none")) {
    return {
      compatible: false,
      error: createRewardError("REWARD_OFFER_CONFLICT", "Benefit stacking is not allowed."),
    };
  }
  return { compatible: true, reason: "OFFER_STACKING_EXPLICITLY_ALLOWED" };
}

function evaluateShopifyPromotionCompatibility(offer) {
  if (!isObject(offer)) {
    return {
      compatible: false,
      error: createRewardError("REWARD_OFFER_CONFLICT", "Offer is required."),
    };
  }
  if (!offer.stackingPolicy?.allowsShopifyPromotions) {
    return {
      compatible: false,
      error: createRewardError(
        "REWARD_OFFER_CONFLICT",
        "Offer is not approved with unrelated promotions."
      ),
    };
  }
  return { compatible: true, reason: "SHOPIFY_PROMOTION_STACKING_EXPLICITLY_ALLOWED" };
}

module.exports = {
  evaluateOfferEligibility,
  evaluateOfferCompatibility,
  evaluateShopifyPromotionCompatibility,
  isDiscountOffer,
  qualifiesProductForOffer,
  validateProductClassification,
};
