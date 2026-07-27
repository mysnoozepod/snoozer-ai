"use strict";

const { createRewardError } = require("./errors");

function parseMoneyToMinorUnits(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: createRewardError("REWARD_PRICE_REQUIRED", "Price is invalid.") };
    }
    const scaled = value * 100;
    if (!Number.isInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 1e-8) {
      return {
        ok: false,
        error: createRewardError("REWARD_PRICE_REQUIRED", "Price has unsupported precision."),
      };
    }
    return { ok: true, minorUnits: Math.round(scaled) };
  }
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    return { ok: false, error: createRewardError("REWARD_PRICE_REQUIRED", "Price is malformed.") };
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const minorUnits = Number(BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)));
  if (!Number.isSafeInteger(minorUnits)) {
    return { ok: false, error: createRewardError("REWARD_PRICE_REQUIRED", "Price is too large.") };
  }
  return { ok: true, minorUnits };
}

function validateMinorUnits(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function calculateDiscountCapMinor(sellingPriceMinor, percentageBasisPoints = 1000) {
  if (!validateMinorUnits(sellingPriceMinor)) {
    return {
      ok: false,
      error: createRewardError("REWARD_PRICE_REQUIRED", "Applicable selling price is required."),
    };
  }
  if (
    !Number.isInteger(percentageBasisPoints) ||
    percentageBasisPoints < 0 ||
    percentageBasisPoints > 10000
  ) {
    return {
      ok: false,
      error: createRewardError("REWARD_RULES_INVALID", "Discount percentage is invalid."),
    };
  }
  const cap = Number(
    (BigInt(sellingPriceMinor) * BigInt(percentageBasisPoints)) / 10000n
  );
  return { ok: true, maximumDiscountMinor: cap };
}

function validateDiscountAgainstCap(input = {}) {
  const cap = calculateDiscountCapMinor(
    input.applicableSellingPriceMinor,
    input.percentageBasisPoints
  );
  if (!cap.ok) return cap;
  if (!validateMinorUnits(input.proposedDiscountMinor)) {
    return {
      ok: false,
      error: createRewardError("REWARD_OFFER_INELIGIBLE", "Proposed offer value is invalid."),
    };
  }
  if (input.proposedDiscountMinor > cap.maximumDiscountMinor) {
    return {
      ok: false,
      error: createRewardError(
        "REWARD_DISCOUNT_CAP_EXCEEDED",
        "Proposed discount exceeds the configured internal ceiling.",
        {
          proposedDiscountMinor: input.proposedDiscountMinor,
          maximumDiscountMinor: cap.maximumDiscountMinor,
        }
      ),
    };
  }
  return {
    ok: true,
    approvedDiscountMinor: input.proposedDiscountMinor,
    internal: { maximumDiscountMinor: cap.maximumDiscountMinor },
  };
}

module.exports = {
  calculateDiscountCapMinor,
  parseMoneyToMinorUnits,
  validateDiscountAgainstCap,
  validateMinorUnits,
};
