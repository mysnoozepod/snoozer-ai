const assert = require("assert");
const { createActiveJourneyService } = require("../services/activeJourney");

const records = new Map();
const latencies = [];
const service = createActiveJourneyService({
  load: async (id) => records.get(id) || null,
  save: async ({ recordId, journey, expectedStoredRevision }) => {
    const started = performance.now();
    const current = records.get(recordId)?.activeJourney || null;
    if ((current ? current.revision : null) !== expectedStoredRevision) {
      const error = new Error("conditional"); error.name = "ConditionalCheckFailedException"; throw error;
    }
    records.set(recordId, { activeJourney: JSON.parse(JSON.stringify(journey)) });
    latencies.push(performance.now() - started);
  },
  clock: () => new Date(),
});
const products = new Set(["12-all-foam-mattress", "12-dual-comfort-hybrid", "14-hybrid", "premium-motion-adjustable-base"]);
const browserA = { profileId: "phase3-acceptance-profile", shopperId: "phase3-acceptance-shopper", sessionId: "browser-a" };
const browserB = { ...browserA, sessionId: "browser-b" };

async function event(state, type, payload, options = {}) {
  return service.transition({ recordId: state.recordId, journey: state.journey, expectedRevision: options.expectedRevision ?? state.journey.revision, trusted: options.trusted === true, allowedProductHandles: products, event: { type, payload } });
}

(async () => {
  let a = await service.resolve({ identity: browserA, surface: "welcome" });
  const originalJourneyId = a.journey.journeyId;
  a = await event(a, "assessment_completed", { canonicalRecommendation: { primaryMattressHandle: "12-all-foam-mattress", topPodId: "4" }, assessmentContext: { size: "Queen", position: "side" } }, { trusted: true });
  a = await event(a, "journey_surface_changed", { surface: "pod" });
  a = await event(a, "rest_test_feedback", { productHandle: "12-all-foam-mattress", podId: "pod-4", observations: ["too_firm"], motionPreference: "liked", status: "completed" });
  assert(a.journey.rejectedProducts.some((item) => item.handle === "12-all-foam-mattress"));
  assert.equal(a.journey.retainedPreferences.motion.value, "liked");

  a = await event(a, "journey_surface_changed", { surface: "ask_snoozer" });
  a = await event(a, "product_selected", { productHandle: "12-dual-comfort-hybrid", acceptanceStatus: "accepted" });
  a = await event(a, "configuration_changed", { productHandle: "12-dual-comfort-hybrid", size: "Queen", baseDecision: "keep", baseHandle: "premium-motion-adjustable-base", motionConfiguration: "standard", acceptanceStatus: "accepted" });
  a = await event(a, "ask_state_committed", { activeQuote: { status: "ready", cartReady: true, productHandle: "12-dual-comfort-hybrid", items: [{ handle: "12-dual-comfort-hybrid", merchandiseId: "gid://shopify/ProductVariant/mattress" }, { handle: "premium-motion-adjustable-base", merchandiseId: "gid://shopify/ProductVariant/base" }], total: 5698 }, journeyStage: "quote_ready" }, { trusted: true });
  const browserAStaleRevision = a.journey.revision;
  a = await event(a, "cart_linked", { cartId: "gid://shopify/Cart/phase3-acceptance" });

  let b = await service.resolve({ identity: browserB, surface: "welcome" });
  assert.equal(b.journey.journeyId, originalJourneyId, "second browser resumes the same active visit");
  assert.equal(b.journey.activeConfiguration.productHandle, "12-dual-comfort-hybrid");
  assert.equal(b.journey.activeConfiguration.size, "Queen");
  assert.equal(b.journey.activeQuote.status, "ready");
  assert.equal(b.journey.cartReference.cartId, "gid://shopify/Cart/phase3-acceptance");
  assert.equal(b.journey.cartReference.lines, undefined, "Shopify lines are never copied into journey state");

  b = await event(b, "configuration_changed", { size: "King" });
  await assert.rejects(() => service.transition({ recordId: a.recordId, journey: a.journey, expectedRevision: browserAStaleRevision, allowedProductHandles: products, event: { type: "configuration_changed", payload: { size: "Queen" } } }), (error) => error.code === "ACTIVE_JOURNEY_CONFLICT");
  a = await service.resolve({ identity: browserA, surface: "cart" });
  a = await event(a, "journey_surface_changed", { surface: "cart" });
  assert.equal(a.journey.activeConfiguration.size, "King", "browser A re-read preserves browser B size");
  assert.equal(a.journey.retainedPreferences.motion.value, "liked");
  assert(a.journey.rejectedProducts.some((item) => item.handle === "12-all-foam-mattress"));
  assert.equal(a.journey.canonicalRecommendation.primaryMattressHandle, "12-all-foam-mattress", "canonical baseline remains historical truth");
  assert.equal(a.journey.sessionRecommendation.productHandle, "12-dual-comfort-hybrid", "session choice remains independent");
  assert.equal(a.journey.activeQuote.status, "invalidated", "size changes invalidate stale exact quotes");

  const average = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  const ordered = [...latencies].sort((x, y) => x - y);
  const p95 = ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)];
  console.log(JSON.stringify({ status: "passed", academyGroup: "journey-os/cross-surface-continuity", journeyId: originalJourneyId, finalRevision: a.journey.revision, finalSurface: a.journey.currentSurface, canonicalRecommendation: a.journey.canonicalRecommendation.primaryMattressHandle, sessionRecommendation: a.journey.sessionRecommendation.productHandle, rejectedProducts: a.journey.rejectedProducts.map((item) => item.handle), retainedPreferences: a.journey.retainedPreferences, acceptedConfiguration: a.journey.activeConfiguration, quoteStatus: a.journey.activeQuote.status, cartReferenceOnly: !a.journey.cartReference.lines, secondBrowserSize: a.journey.activeConfiguration.size, writeLatencyMs: { average: Number(average.toFixed(3)), p95: Number(p95.toFixed(3)) } }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
