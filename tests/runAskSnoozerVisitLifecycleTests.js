#!/usr/bin/env node

const assert = require("assert");
const {
  getVisitLifecyclePolicy,
  resolveAskSnoozerVisitLifecycle,
} = require("../services/askSnoozerVisitLifecycle");

const policy = getVisitLifecyclePolicy({ ASK_SNOOZER_ACTIVE_VISIT_TTL_MINUTES: "60" });
const start = new Date("2026-09-09T12:00:00.000Z");
const durable = {
  shopperId: "shopper-test",
  profileId: "profile-test",
  customer: { preferredName: "Test Shopper" },
  shopperProfile: { firmnessPref: "soft" },
  assessment: { answers: { sleepPosition: "Side" } },
  canonicalRecommendation: { primaryMattressHandle: "12-all-foam-mattress" },
};

const initialized = resolveAskSnoozerVisitLifecycle({
  context: durable,
  storedContext: null,
  sessionId: "visit_anchor_test",
  shopperId: "shopper-test",
  now: start,
  policy,
});
assert.strictEqual(initialized.metadata.rotationReason, "active_visit_initialized");
assert.strictEqual(initialized.metadata.rotated, false);

const activeContext = {
  ...initialized.context,
  askSnoozerWorkingMemory: { activeDeal: { stage: "configuring", activeQuote: { ok: true } } },
  cartState: { items: [{ handle: "12-all-foam-mattress" }], lastViewedHandle: "14-hybrid" },
};
const reused = resolveAskSnoozerVisitLifecycle({
  context: activeContext,
  storedContext: activeContext,
  sessionId: "visit_anchor_test",
  shopperId: "shopper-test",
  now: new Date("2026-09-09T12:30:00.000Z"),
  policy,
});
assert.strictEqual(reused.metadata.reused, true);
assert.strictEqual(reused.metadata.rotated, false);
assert.strictEqual(reused.context.visitLifecycle.visitId, initialized.context.visitLifecycle.visitId);
assert(reused.context.askSnoozerWorkingMemory?.activeDeal?.activeQuote?.ok, "active visit should keep commercial state");

const expired = resolveAskSnoozerVisitLifecycle({
  context: activeContext,
  storedContext: activeContext,
  sessionId: "visit_anchor_test",
  shopperId: "shopper-test",
  now: new Date("2026-09-09T13:01:00.000Z"),
  policy,
});
assert.strictEqual(expired.metadata.rotated, true);
assert.strictEqual(expired.metadata.rotationReason, "active_visit_expired");
assert.notStrictEqual(expired.context.visitLifecycle.visitId, initialized.context.visitLifecycle.visitId);
assert.strictEqual(expired.context.askSnoozerWorkingMemory, undefined, "expired visit should clear commercial memory");
assert.deepStrictEqual(expired.context.cartState.items, [], "expired visit should clear active cart state");
assert.deepStrictEqual(expired.context.customer, durable.customer, "durable customer context must survive rotation");
assert.deepStrictEqual(expired.context.shopperProfile, durable.shopperProfile, "durable preferences must survive rotation");
assert.deepStrictEqual(expired.context.assessment, durable.assessment, "assessment must survive rotation");
assert.deepStrictEqual(expired.context.canonicalRecommendation, durable.canonicalRecommendation, "recommendation history must survive rotation");

const explicit = resolveAskSnoozerVisitLifecycle({
  context: reused.context,
  storedContext: reused.context,
  sessionId: "visit_anchor_test",
  shopperId: "shopper-test",
  now: new Date("2026-09-09T12:31:00.000Z"),
  forceNewVisit: true,
  policy,
});
assert.strictEqual(explicit.metadata.rotationReason, "explicit_new_journey");
assert.strictEqual(explicit.metadata.rotated, true);

console.log("Ask Snoozer visit-lifecycle tests passed (initialize, reuse, expiry rotation, durable retention, explicit rotation).");
