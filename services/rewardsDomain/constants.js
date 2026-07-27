"use strict";

const REWARDS_SCHEMA_VERSION = 1;
const REWARD_EVENT_SCHEMA_VERSION = 1;
const ZOHO_SYNC_SCHEMA_VERSION = 1;
const CUSTOMER_PROFILE_REWARD_SUMMARY_SCHEMA_VERSION = 1;

const RULE_STATUSES = Object.freeze(["draft", "active", "retired"]);
const MILESTONE_STATUSES = Object.freeze(["implemented", "disabled", "future"]);
const OFFER_STATUSES = Object.freeze(["draft", "active", "disabled", "retired"]);

const REPEAT_POLICY_TYPES = Object.freeze([
  "once_per_shopper_lifetime",
  "once_per_showroom_journey",
  "once_per_appointment",
  "once_per_session",
  "once_per_pod",
  "once_per_qualifying_subject",
  "repeatable_after_interval",
  "non_repeatable",
]);

const PRODUCT_CATEGORIES = Object.freeze([
  "mattress",
  "dual_comfort_mattress",
  "adjustable_base",
  "pillow",
  "memory_foam_pillow",
  "sheets",
  "mattress_protector",
  "bedding",
  "accessory",
  "bundle",
  "complete_sleep_system",
]);

const PRODUCT_CLASSIFICATION_SOURCES = Object.freeze(["canon", "catalog", "manifest"]);

const OFFER_TYPES = Object.freeze([
  "fixed_dollar_savings",
  "percentage_savings",
  "qualifying_purchase_gift",
  "bogo",
  "second_item_percentage",
  "complimentary_upgrade",
  "bundle_benefit",
  "showroom_completion_gift",
]);

const DISCOUNT_OFFER_TYPES = Object.freeze([
  "fixed_dollar_savings",
  "percentage_savings",
  "bogo",
  "second_item_percentage",
  "complimentary_upgrade",
  "bundle_benefit",
]);

const STACKING_MODES = Object.freeze(["none", "explicit", "stackable"]);

const SHOPIFY_APPLICATION_STRATEGIES = Object.freeze([
  "not_applicable",
  "pending_verification",
  "discount_code",
  "discount_function",
  "automatic_discount",
]);

const COMPLETION_AUTHORITIES = Object.freeze([
  "backend",
  "shopify_webhook",
  "verified_partner_event",
]);

const SHOWROOM_BADGE_IDS = Object.freeze([
  "badge.showroom.explorer",
  "badge.showroom.rest_tester",
  "badge.showroom.sleep_scholar",
  "badge.showroom.snooze_specialist",
]);

const SHOWROOM_BADGE_CEILING_ID = "badge.showroom.snooze_specialist";
const POST_PURCHASE_BADGE_NAMESPACE = "badge.post_purchase.";

const REWARD_EVENT_TYPES = Object.freeze([
  "milestone.profile.established",
  "milestone.assessment.completed",
  "milestone.rest_test.completed",
  "milestone.pod.completed",
  "milestone.learn.completed",
  "milestone.customize.completed",
  "milestone.ratings.completed",
  "milestone.full_showroom.completed",
]);

const CLIENT_CONTROLLED_REWARD_FIELDS = Object.freeze([
  "points",
  "pointAward",
  "sleepPoints",
  "badge",
  "badgeId",
  "badgeName",
  "discount",
  "discountCents",
  "discountMinor",
  "discountDollars",
  "dollarValue",
  "offerEligibility",
  "eligibleOffers",
  "unlockedOffers",
  "rewardValue",
]);

module.exports = {
  CLIENT_CONTROLLED_REWARD_FIELDS,
  COMPLETION_AUTHORITIES,
  CUSTOMER_PROFILE_REWARD_SUMMARY_SCHEMA_VERSION,
  DISCOUNT_OFFER_TYPES,
  MILESTONE_STATUSES,
  OFFER_STATUSES,
  OFFER_TYPES,
  POST_PURCHASE_BADGE_NAMESPACE,
  PRODUCT_CATEGORIES,
  PRODUCT_CLASSIFICATION_SOURCES,
  REPEAT_POLICY_TYPES,
  REWARDS_SCHEMA_VERSION,
  REWARD_EVENT_SCHEMA_VERSION,
  REWARD_EVENT_TYPES,
  RULE_STATUSES,
  SHOPIFY_APPLICATION_STRATEGIES,
  SHOWROOM_BADGE_CEILING_ID,
  SHOWROOM_BADGE_IDS,
  STACKING_MODES,
  ZOHO_SYNC_SCHEMA_VERSION,
};
