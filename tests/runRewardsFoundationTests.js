"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const rewards = require("../services/rewardsDomain");

const rulesPath = path.join(
  __dirname,
  "..",
  "data",
  "rewards-rules.phase1a.example.v1.json"
);
const draftRules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
const productFixtures = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "fixtures",
      "rewardsProductClassifications.v1.json"
    ),
    "utf8"
  )
).fixtures;
let passed = 0;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function test(name, callback) {
  callback();
  passed += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function activeRules() {
  const value = clone(draftRules);
  value.status = "active";
  return value;
}

function assessmentEvent(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: "browser-event-1",
    eventType: "milestone.assessment.completed",
    occurredAt: "2026-07-26T12:00:00.000Z",
    receivedAt: "2026-07-26T12:00:01.000Z",
    shopperId: "589424",
    profileId: "shopper#589424",
    sessionId: "session-1",
    deviceId: null,
    appointmentId: null,
    subjectType: "assessment",
    subjectId: "assessment-1",
    sourceSurface: "assessment",
    sourceSystem: "snoozer-backend",
    rulesVersion: draftRules.rulesVersion,
    metadata: { assessmentVersion: "v1" },
    ...overrides,
  };
}

function restTestEvent(overrides = {}) {
  return assessmentEvent({
    eventId: "rest-event-1",
    eventType: "milestone.rest_test.completed",
    subjectType: "rest_test",
    subjectId: "pod-4:rest-test-1",
    sourceSurface: "pod_rest_test",
    metadata: { podId: "pod-4", durationSeconds: 420 },
    ...overrides,
  });
}

function getMilestone(rulesDocument, id) {
  return rulesDocument.milestones.find((item) => item.id === id);
}

function activeOffer(id) {
  const offer = clone(draftRules.offers.find((item) => item.id === id));
  offer.status = "active";
  return offer;
}

function zohoSummary(overrides = {}) {
  return {
    schemaVersion: 1,
    canonicalProfileId: "shopper#589424",
    snoozeCode: "589424",
    currentShowroomBadge: "Snooze Specialist",
    availableSleepPoints: 600,
    lifetimeSleepPoints: 600,
    showroomCompletionStatus: "complete",
    assessmentCompletionStatus: "complete",
    restTestCompletionStatus: "complete",
    unlockedOfferSummaries: [],
    lastRewardActivityAt: "2026-07-26T12:00:00.000Z",
    lastShowroomVisitAt: "2026-07-26T12:00:00.000Z",
    showroomLocation: "showroom-1",
    rulesVersion: draftRules.rulesVersion,
    synchronizationVersion: 1,
    sourceUpdatedAt: "2026-07-26T12:00:01.000Z",
    ...overrides,
  };
}

test("valid draft rules document", () => {
  assert.equal(rewards.validateRewardsRules(draftRules).ok, true);
  assert.equal(draftRules.status, "draft");
  assert.equal(
    draftRules.milestones.every((item) => item.pointAward === 0),
    true
  );
});

for (const [name, mutate] of [
  ["invalid schema version", (value) => (value.schemaVersion = 99)],
  ["duplicate milestone IDs", (value) => value.milestones.push(clone(value.milestones[0]))],
  ["duplicate badge IDs", (value) => value.badges.push(clone(value.badges[0]))],
  [
    "missing Snooze Specialist ceiling",
    (value) => {
      value.badges = value.badges.filter(
        (badge) => badge.id !== "badge.showroom.snooze_specialist"
      );
    },
  ],
  [
    "badge above Snooze Specialist",
    (value) =>
      value.badges.push({
        id: "badge.showroom.master_of_rest",
        label: "Master of Rest",
        thresholdPoints: 1000,
      }),
  ],
  ["invalid effective date", (value) => (value.effectiveFrom = "invalid")],
  ["invalid offer type", (value) => (value.offers[0].offerType = "mystery")],
  [
    "invalid percentage value",
    (value) => {
      value.offers[0].rewardValue.percentageBasisPoints = 10001;
    },
  ],
  [
    "unknown product category",
    (value) => value.offers[0].qualifyingProductCategories.push("unknown"),
  ],
]) {
  test(`rules reject ${name}`, () => {
    const value = clone(draftRules);
    mutate(value);
    assert.equal(rewards.validateRewardsRules(value).ok, false);
  });
}

test("draft rules never resolve as active", () => {
  const result = rewards.resolveActiveRules(
    draftRules,
    "2026-07-26T12:00:00.000Z"
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REWARD_RULES_NOT_EFFECTIVE");
});

test("active rules resolve within effectivity", () => {
  const result = rewards.resolveActiveRules(
    activeRules(),
    "2026-07-26T12:00:00.000Z"
  );
  assert.equal(result.ok, true);
});

test("mattress discount offer requires an internal cap policy", () => {
  const value = clone(draftRules);
  const offer = value.offers.find(
    (item) => item.id === "offer.mattress.fixed_savings"
  );
  offer.discountCapPolicyId = null;
  assert.equal(rewards.validateRewardsRules(value).ok, false);
});

test("mattress percentage offer cannot exceed configured cap", () => {
  const value = clone(draftRules);
  const offer = value.offers.find(
    (item) => item.id === "offer.mattress.fixed_savings"
  );
  offer.offerType = "percentage_savings";
  offer.rewardValue = { percentageBasisPoints: 1001 };
  assert.equal(rewards.validateRewardsRules(value).ok, false);
});

test("valid assessment event", () => {
  assert.equal(
    rewards.validateRewardEvent(assessmentEvent(), draftRules).ok,
    true
  );
});

test("valid Rest Test event", () => {
  assert.equal(rewards.validateRewardEvent(restTestEvent(), draftRules).ok, true);
});

for (const field of [
  "points",
  "badge",
  "discountDollars",
  "offerEligibility",
]) {
  test(`browser-supplied ${field} is rejected`, () => {
    const result = rewards.validateRewardEvent(
      assessmentEvent({ [field]: "untrusted" }),
      draftRules
    );
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "REWARD_EVENT_INVALID");
  });
}

test("browser-supplied reward metadata is rejected", () => {
  const value = assessmentEvent();
  value.metadata.points = 1000;
  assert.equal(rewards.validateRewardEvent(value, draftRules).ok, false);
});

test("missing shopper identity is rejected", () => {
  const result = rewards.validateRewardEvent(
    assessmentEvent({ shopperId: null, profileId: null }),
    draftRules
  );
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "REWARD_IDENTITY_REQUIRED");
});

test("unsupported event type is rejected", () => {
  const result = rewards.validateRewardEvent(
    assessmentEvent({ eventType: "cart.opened" }),
    draftRules
  );
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((error) => error.code === "REWARD_EVENT_TYPE_UNSUPPORTED"),
    true
  );
});

test("unauthorized source surface is rejected", () => {
  const result = rewards.validateRewardEvent(
    assessmentEvent({ sourceSurface: "results" }),
    draftRules
  );
  assert.equal(
    result.errors.some((error) => error.code === "REWARD_SOURCE_UNAUTHORIZED"),
    true
  );
});

test("missing subject ID is rejected", () => {
  const result = rewards.validateRewardEvent(
    assessmentEvent({ subjectId: "" }),
    draftRules
  );
  assert.equal(
    result.errors.some((error) => error.code === "REWARD_SUBJECT_REQUIRED"),
    true
  );
});

test("malformed timestamps are rejected", () => {
  assert.equal(
    rewards.validateRewardEvent(
      assessmentEvent({ occurredAt: "yesterday" }),
      draftRules
    ).ok,
    false
  );
});

test("evaluator returns rule-derived values and no client values", () => {
  const rulesDocument = activeRules();
  getMilestone(
    rulesDocument,
    "milestone.assessment.completed"
  ).pointAward = 125;
  const result = rewards.evaluateMilestoneEvent({
    event: assessmentEvent(),
    rules: rulesDocument,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.pointAward, 125);
  assert.equal(result.idempotency.claimKey.startsWith("reward-claim#"), true);
});

test("evaluator fails closed for disabled milestones", () => {
  const rulesDocument = activeRules();
  getMilestone(
    rulesDocument,
    "milestone.assessment.completed"
  ).enabled = false;
  const result = rewards.evaluateMilestoneEvent({
    event: assessmentEvent(),
    rules: rulesDocument,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "REWARD_MILESTONE_DISABLED");
});

test("duplicate assessment completion has one lifetime claim identity", () => {
  const milestone = getMilestone(
    draftRules,
    "milestone.assessment.completed"
  );
  const first = rewards.buildRewardIdempotencyKey(
    assessmentEvent(),
    milestone,
    draftRules.rulesVersion
  );
  const second = rewards.buildRewardIdempotencyKey(
    assessmentEvent({
      eventId: "new-browser-id",
      sessionId: "new-session-after-storage-clear",
    }),
    milestone,
    draftRules.rulesVersion
  );
  assert.equal(first.claimKey, second.claimKey);
});

test("duplicate Rest Test has one qualifying-subject claim identity", () => {
  const milestone = getMilestone(
    draftRules,
    "milestone.rest_test.completed"
  );
  const first = rewards.buildRewardIdempotencyKey(
    restTestEvent(),
    milestone,
    draftRules.rulesVersion
  );
  const second = rewards.buildRewardIdempotencyKey(
    restTestEvent({ eventId: "retry-id", sessionId: "another-session" }),
    milestone,
    draftRules.rulesVersion
  );
  assert.equal(first.claimKey, second.claimKey);
});

test("different qualifying subjects have distinct identities", () => {
  const milestone = getMilestone(
    draftRules,
    "milestone.rest_test.completed"
  );
  const first = rewards.buildRewardIdempotencyKey(
    restTestEvent(),
    milestone,
    draftRules.rulesVersion
  );
  const second = rewards.buildRewardIdempotencyKey(
    restTestEvent({
      subjectId: "pod-5:rest-test-1",
      metadata: { podId: "pod-5", durationSeconds: 420 },
    }),
    milestone,
    draftRules.rulesVersion
  );
  assert.notEqual(first.claimKey, second.claimKey);
});

test("different rules versions remain auditable", () => {
  const milestone = getMilestone(
    draftRules,
    "milestone.assessment.completed"
  );
  const first = rewards.buildRewardIdempotencyKey(
    assessmentEvent(),
    milestone,
    "rules-v1"
  );
  const second = rewards.buildRewardIdempotencyKey(
    assessmentEvent(),
    milestone,
    "rules-v2"
  );
  assert.notEqual(first.claimKey, second.claimKey);
});

for (const [policy, field, firstValue, secondValue] of [
  ["once_per_showroom_journey", "journeyId", "journey-1", "journey-2"],
  ["once_per_pod", "podId", "pod-1", "pod-2"],
]) {
  test(`${policy} scopes idempotency correctly`, () => {
    const milestone = {
      id: "milestone.test.completed",
      repeatPolicy: { type: policy },
    };
    const first = rewards.buildRewardIdempotencyKey(
      assessmentEvent({ metadata: { [field]: firstValue } }),
      milestone,
      draftRules.rulesVersion
    );
    const second = rewards.buildRewardIdempotencyKey(
      assessmentEvent({ metadata: { [field]: secondValue } }),
      milestone,
      draftRules.rulesVersion
    );
    assert.notEqual(first.claimKey, second.claimKey);
  });
}

const badgeCases = [
  [0, "badge.showroom.explorer"],
  [99, "badge.showroom.explorer"],
  [100, "badge.showroom.rest_tester"],
  [299, "badge.showroom.rest_tester"],
  [300, "badge.showroom.sleep_scholar"],
  [599, "badge.showroom.sleep_scholar"],
  [600, "badge.showroom.snooze_specialist"],
  [999999, "badge.showroom.snooze_specialist"],
];

for (const [points, badgeId] of badgeCases) {
  test(`badge threshold ${points} derives ${badgeId}`, () => {
    assert.equal(rewards.deriveShowroomBadge(points, draftRules).id, badgeId);
  });
}

test("unclassified products fail closed", () => {
  assert.equal(
    rewards.validateProductClassification(productFixtures.unclassifiedProduct).ok,
    false
  );
});

test("curated product classification is accepted", () => {
  assert.equal(
    rewards.validateProductClassification(productFixtures.eligibleMattress).ok,
    true
  );
});

test("ineligible product category is rejected", () => {
  const result = rewards.qualifiesProductForOffer(
    productFixtures.eligiblePillow,
    activeOffer("offer.mattress.fixed_savings")
  );
  assert.equal(result.eligible, false);
});

test("eligible controlled offer requires its controlled state", () => {
  const offer = activeOffer("offer.sleep_mask.completion_gift");
  const eligible = rewards.evaluateOfferEligibility({
    offer,
    rewardState: {
      completedMilestoneIds: ["milestone.full_showroom.completed"],
    },
  });
  assert.equal(eligible.eligible, true);
  const ineligible = rewards.evaluateOfferEligibility({
    offer,
    rewardState: { completedMilestoneIds: [] },
  });
  assert.equal(ineligible.eligible, false);
});

test("multiple pillow offers conflict", () => {
  const first = activeOffer("offer.pillow.bogo");
  const second = activeOffer("offer.pillow.second_item_percent");
  assert.equal(
    rewards.evaluateOfferCompatibility(first, second).compatible,
    false
  );
});

test("mattress savings and accessory gift are explicitly compatible", () => {
  const first = activeOffer("offer.mattress.fixed_savings");
  const second = activeOffer("offer.accessory.qualifying_gift");
  assert.equal(
    rewards.evaluateOfferCompatibility(first, second).compatible,
    true
  );
});

test("mattress savings reject unrelated Shopify promotion by default", () => {
  const result = rewards.evaluateShopifyPromotionCompatibility(
    activeOffer("offer.mattress.fixed_savings")
  );
  assert.equal(result.compatible, false);
});

test("completion gift explicitly permits Shopify promotion coexistence", () => {
  const result = rewards.evaluateShopifyPromotionCompatibility(
    activeOffer("offer.sleep_mask.completion_gift")
  );
  assert.equal(result.compatible, true);
});

const prices = [
  "999.00",
  "1499.00",
  "1999.00",
  "2499.00",
  "2999.00",
  "3999.00",
  "1299.99",
  "0.00",
];

for (const price of prices) {
  test(`10 percent cap never overruns for $${price}`, () => {
    const parsed = rewards.parseMoneyToMinorUnits(price);
    assert.equal(parsed.ok, true);
    const cap = rewards.calculateDiscountCapMinor(parsed.minorUnits, 1000);
    assert.equal(cap.ok, true);
    assert.equal(
      BigInt(cap.maximumDiscountMinor) * 10000n <=
        BigInt(parsed.minorUnits) * 1000n,
      true
    );
  });
}

for (const value of ["bad", "-1.00", "1.001", null, Number.NaN]) {
  test(`malformed or invalid price ${String(value)} is rejected`, () => {
    assert.equal(rewards.parseMoneyToMinorUnits(value).ok, false);
  });
}

test("exact discount-cap boundary is accepted", () => {
  assert.equal(
    rewards.validateDiscountAgainstCap({
      applicableSellingPriceMinor: 10000,
      proposedDiscountMinor: 1000,
      percentageBasisPoints: 1000,
    }).ok,
    true
  );
});

test("one cent above cap is rejected without public cap disclosure", () => {
  const result = rewards.validateDiscountAgainstCap({
    applicableSellingPriceMinor: 10000,
    proposedDiscountMinor: 1001,
    percentageBasisPoints: 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REWARD_DISCOUNT_CAP_EXCEEDED");
  assert.equal(result.error.publicMessage.includes("10%"), false);
});

test("fractional cents are rejected", () => {
  assert.equal(rewards.parseMoneyToMinorUnits("10.999").ok, false);
});

test("large safe prices use integer arithmetic", () => {
  const parsed = rewards.parseMoneyToMinorUnits("90071992547409.00");
  assert.equal(parsed.ok, true);
  assert.equal(
    rewards.calculateDiscountCapMinor(parsed.minorUnits, 1000).ok,
    true
  );
});

test("valid Zoho reward summary payload", () => {
  assert.equal(rewards.validateZohoRewardsSyncPayload(zohoSummary()).ok, true);
});

test("Zoho payload requires canonical profile identity", () => {
  assert.equal(
    rewards.validateZohoRewardsSyncPayload(
      zohoSummary({ canonicalProfileId: "" })
    ).ok,
    false
  );
});

test("Zoho stale update is rejected", () => {
  const result = rewards.assessZohoSyncFreshness(
    zohoSummary({ synchronizationVersion: 1 }),
    zohoSummary({
      synchronizationVersion: 2,
      sourceUpdatedAt: "2026-07-26T12:00:02.000Z",
    })
  );
  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "REWARD_ZOHO_SYNC_STALE");
});

test("Zoho duplicate sync payload has one deduplication key", () => {
  const payload = zohoSummary();
  assert.equal(
    rewards.buildZohoRewardsDeduplicationKey(payload),
    rewards.buildZohoRewardsDeduplicationKey(clone(payload))
  );
});

test("Zoho unsupported schema version is rejected", () => {
  assert.equal(
    rewards.validateZohoRewardsSyncPayload(
      zohoSummary({ schemaVersion: 2 })
    ).ok,
    false
  );
});

test("Zoho retryable and terminal failures are distinguished", () => {
  assert.equal(rewards.classifyZohoSyncFailure({ status: 500 }).retryable, true);
  assert.equal(
    rewards.classifyZohoSyncFailure({ code: "ECONNRESET" }).retryable,
    true
  );
  assert.equal(rewards.classifyZohoSyncFailure({ status: 400 }).terminal, true);
});

test("Zoho timeline contract validates meaningful reward events", () => {
  const result = rewards.validateZohoTimelineEvent({
    eventType: "points_awarded",
    eventId: "reward-event-1",
    canonicalProfileId: "shopper#589424",
    occurredAt: "2026-07-26T12:00:00.000Z",
    rulesVersion: draftRules.rulesVersion,
    summary: "Assessment completion recorded.",
  });
  assert.equal(result.ok, true);
});

test("Customer Profile reward summary is bounded and validates", () => {
  const result = rewards.validateCustomerProfileRewardSummary({
    schemaVersion: 1,
    activeRulesVersion: draftRules.rulesVersion,
    currentShowroomBadgeId: "badge.showroom.explorer",
    availableSleepPoints: 0,
    lifetimeSleepPoints: 0,
    unlockedOfferCount: 0,
    latestRewardActivityAt: "2026-07-26T12:00:00.000Z",
    syncStatus: "pending",
    summaryVersion: 1,
  });
  assert.equal(result.ok, true);
});

test("public error messages do not disclose internal cap mechanics", () => {
  const error = rewards.createRewardError(
    "REWARD_DISCOUNT_CAP_EXCEEDED",
    "The proposed value exceeded 1000 basis points."
  );
  assert.equal(error.publicMessage.includes("1000"), false);
  assert.equal(error.publicMessage.includes("10%"), false);
});

process.stdout.write(`\nRewards Phase 1A foundation tests passed: ${passed}\n`);
