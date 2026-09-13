const assert = require("assert");
const {
  ACTIVE_JOURNEY_TTL_MINUTES,
  applyEvent,
  buildAskJourneyPayload,
  createActiveJourneyService,
  deriveActiveJourneyRecordId,
  hydrateAskContextFromActiveJourney,
  makeActiveJourney,
} = require("../services/activeJourney");

const products = new Set(["12-all-foam-mattress", "12-dual-comfort-hybrid", "14-hybrid", "premium-motion-adjustable-base"]);
let nowMs = Date.parse("2026-09-12T16:00:00.000Z");
const clock = () => new Date(nowMs);
const records = new Map();
const storage = {
  async load(id) { return records.get(id) || null; },
  async save({ recordId, journey, expectedStoredRevision }) {
    const current = records.get(recordId)?.activeJourney || null;
    const currentRevision = current ? Number(current.revision || 0) : null;
    if (currentRevision !== expectedStoredRevision) {
      const error = new Error("conditional"); error.name = "ConditionalCheckFailedException"; throw error;
    }
    records.set(recordId, { activeJourney: JSON.parse(JSON.stringify(journey)) });
  },
};
const service = createActiveJourneyService({ ...storage, clock });
const identity = { profileId: "profile-phase3", shopperId: "shopper-phase3" };

(async () => {
  const a = await service.resolve({ identity, surface: "welcome", canonicalRecommendation: { primaryMattressHandle: "12-all-foam-mattress" } });
  assert.equal(a.journey.revision, 0, "1 creates revision zero");
  assert.equal((await service.resolve({ identity, surface: "ask_snoozer" })).journey.journeyId, a.journey.journeyId, "2 same identity resumes journey");
  assert.equal(deriveActiveJourneyRecordId(identity), deriveActiveJourneyRecordId({ profileId: identity.profileId }), "3 profile identity is stable across browsers");

  const surface = await service.transition({ recordId: a.recordId, journey: a.journey, expectedRevision: 0, event: { type: "journey_surface_changed", payload: { surface: "assessment" } }, allowedProductHandles: products });
  assert.equal(surface.journey.currentSurface, "assessment", "4 surface changes through event contract");

  const assessment = await service.transition({ recordId: a.recordId, journey: surface.journey, expectedRevision: 1, trusted: true, event: { type: "assessment_completed", payload: { canonicalRecommendation: { primaryMattressHandle: "12-all-foam-mattress" }, assessmentContext: { size: "Queen" } } }, allowedProductHandles: products });
  assert.equal(assessment.journey.canonicalRecommendation.primaryMattressHandle, "12-all-foam-mattress", "5 canonical is backend trusted");
  assert.throws(() => applyEvent(assessment.journey, { type: "assessment_completed", payload: { canonicalRecommendation: {} } }, { expectedRevision: 2 }), /Unsupported/, "6 clients cannot inject canonical state");
  assert.throws(() => applyEvent(assessment.journey, { type: "configuration_changed", payload: { size: "King", total: 1 } }, { expectedRevision: 2 }), /Protected/, "7 protected commerce injection rejected");

  const config = await service.transition({ recordId: a.recordId, journey: assessment.journey, expectedRevision: 2, event: { type: "configuration_changed", payload: { productHandle: "12-all-foam-mattress", size: "Queen", acceptanceStatus: "accepted" } }, allowedProductHandles: products });
  assert.equal(config.journey.activeConfiguration.size, "Queen", "8 configuration persisted");
  const feedback = await service.transition({ recordId: a.recordId, journey: config.journey, expectedRevision: 3, event: { type: "rest_test_feedback", payload: { productHandle: "12-all-foam-mattress", observations: ["too_firm"], podId: "pod-4" } }, allowedProductHandles: products });
  assert(feedback.journey.rejectedProducts.some((item) => item.handle === "12-all-foam-mattress"), "9 Rest Test rejection promoted");
  assert.notEqual(feedback.journey.sessionRecommendation?.productHandle, "12-all-foam-mattress", "10 adaptive recommendation excludes rejected product");
  assert.equal(feedback.journey.activeConfiguration.productHandle, null, "11 rejected active product invalidated");

  const staleBase = feedback.journey;
  const sizeKing = await service.transition({ recordId: a.recordId, journey: staleBase, expectedRevision: staleBase.revision, event: { type: "configuration_changed", payload: { size: "King" } }, allowedProductHandles: products });
  const mergedPreference = await service.transition({ recordId: a.recordId, journey: staleBase, expectedRevision: staleBase.revision, event: { type: "preference_retained", payload: { key: "motion", value: "liked" } }, allowedProductHandles: products });
  assert.equal(mergedPreference.journey.activeConfiguration.size, "King", "12 stale independent write preserves newer size");
  assert.equal(mergedPreference.journey.retainedPreferences.motion.value, "liked", "13 stale independent preference merges");
  await assert.rejects(() => service.transition({ recordId: a.recordId, journey: staleBase, expectedRevision: staleBase.revision, event: { type: "configuration_changed", payload: { size: "Queen" } }, allowedProductHandles: products }), (error) => error.code === "ACTIVE_JOURNEY_CONFLICT", "14 stale same-field write conflicts");

  const askContext = hydrateAskContextFromActiveJourney({ askSnoozerWorkingMemory: { activeDeal: { pendingCommitment: { type: "compare_products" } } } }, mergedPreference.journey);
  assert.equal(askContext.askSnoozerWorkingMemory.activeDeal.activeSize, "King", "15 Ask hydrates authoritative configuration");
  assert.equal(askContext.askSnoozerWorkingMemory.activeDeal.pendingCommitment.type, "compare_products", "16 Ask-only commitment remains conversation-local");
  assert.equal(buildAskJourneyPayload(askContext).pendingCommitment, undefined, "17 conversation commitment is not promoted globally");
  const mattressOnlyContext = hydrateAskContextFromActiveJourney({}, {
    ...mergedPreference.journey,
    activeConfiguration: {
      productHandle: "12-dual-comfort-hybrid",
      size: "King",
      baseDecision: "keep",
      baseHandle: "premium-motion-adjustable-base",
      motionConfiguration: "standard",
    },
  });
  mattressOnlyContext.askSnoozerWorkingMemory.activeDeal.baseDecision = "skip";
  mattressOnlyContext.askSnoozerWorkingMemory.activeDeal.activeBaseHandle = null;
  mattressOnlyContext.askSnoozerWorkingMemory.activeDeal.activeMotionKey = "none";
  const mattressOnlyPayload = buildAskJourneyPayload(mattressOnlyContext);
  assert.equal(mattressOnlyPayload.activeConfiguration.baseDecision, "skip", "18 Ask bridge promotes mattress-only scope");
  assert.equal(mattressOnlyPayload.activeConfiguration.baseHandle, null, "19 Ask bridge clears the base");
  assert.equal(mattressOnlyPayload.activeConfiguration.motionConfiguration, "none", "20 Ask bridge clears motion");

  const beforeRotation = mergedPreference.journey.journeyId;
  nowMs += (ACTIVE_JOURNEY_TTL_MINUTES + 1) * 60 * 1000;
  const rotated = await service.resolve({ identity, surface: "welcome" });
  assert.notEqual(rotated.journey.journeyId, beforeRotation, "18 expired visit starts a new journey");
  assert.equal(rotated.journey.rejectedProducts.length, 0, "19 visit feedback does not leak into new journey");
  assert.equal(rotated.journey.canonicalRecommendation, null, "20 caller can rehydrate durable canonical separately");

  const cart = applyEvent(makeActiveJourney({ recordId: "cart", identity, now: clock() }), { type: "cart_linked", payload: { cartId: "gid://shopify/Cart/test" } }, { expectedRevision: 0, allowedProductHandles: products }).journey;
  assert.equal(cart.cartReference.cartId, "gid://shopify/Cart/test", "21 journey stores only a cart reference");
  assert.equal(cart.cartReference.lines, undefined, "22 cart lines are not duplicated");
  console.log("Active Journey Phase 3: 22/22 assertions passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
