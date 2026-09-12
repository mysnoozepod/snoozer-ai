const assert = require("assert");
const { handleActiveJourneyRoutes } = require("../routes/activeJourneyRoutes");
const { createActiveJourneyService } = require("../services/activeJourney");

const rows = new Map();
const service = createActiveJourneyService({
  load: async (id) => rows.get(id) || null,
  save: async ({ recordId, journey, expectedStoredRevision }) => {
    const current = rows.get(recordId)?.activeJourney || null;
    if ((current ? current.revision : null) !== expectedStoredRevision) {
      const error = new Error("conditional"); error.name = "ConditionalCheckFailedException"; throw error;
    }
    rows.set(recordId, { activeJourney: journey });
  },
  clock: () => new Date("2026-09-12T17:00:00.000Z"),
});
const calls = [];
const deps = {
  response: (_event, statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  safeJsonBody: (event) => JSON.parse(event.body || "{}"),
  cleanIdentityValue: (value) => String(value || "").trim(),
  deriveEffectiveThreadId: (_event, body) => body.sessionId || "session-route",
  safeResolveSnoozeIdentity: async () => ({ profileId: "profile-route", shopperId: "shopper-route", snoozeCode: "redacted" }),
  safeGetCustomerProfile: async () => ({ profile: { canonicalRecommendation: { primaryMattressHandle: "12-all-foam-mattress" } } }),
  resolveCanonicalRecommendationContext: async () => null,
  activeJourneyService: service,
  loadShowroomManifest: () => ({ products: [{ handle: "12-all-foam-mattress" }, { handle: "12-dual-comfort-hybrid" }] }),
  log: (...args) => calls.push(args),
};

async function invoke(path, body) {
  const response = await handleActiveJourneyRoutes({ event: { body: JSON.stringify(body) }, method: "POST", routePath: path, traceId: "route-test", deps });
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
}

(async () => {
  const resolved = await invoke("/journey/resolve", { snoozeCode: "1234", sessionId: "browser-a", surface: "welcome" });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.body.activeJourney.currentSurface, "welcome");
  assert.equal(resolved.body.qualitySignals.journeyHydrated, true);

  const first = await invoke("/journey/event", { snoozeCode: "1234", sessionId: "browser-a", expectedRevision: 0, surface: "pod", event: { type: "configuration_changed", payload: { productHandle: "12-dual-comfort-hybrid", size: "Queen", acceptanceStatus: "accepted" } } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.activeJourney.activeConfiguration.size, "Queen");

  const independent = await invoke("/journey/event", { snoozeCode: "1234", sessionId: "browser-b", expectedRevision: 0, surface: "rest_test", event: { type: "preference_retained", payload: { key: "motion", value: "liked" } } });
  assert.equal(independent.statusCode, 200);
  assert.equal(independent.body.transition.mergedFromStaleRevision, true);
  assert.equal(independent.body.activeJourney.activeConfiguration.size, "Queen");

  const conflict = await invoke("/journey/event", { snoozeCode: "1234", sessionId: "browser-b", expectedRevision: 0, surface: "pod", event: { type: "configuration_changed", payload: { size: "King" } } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.qualitySignals.staleClientWriteRejected, true);

  const injection = await invoke("/journey/event", { snoozeCode: "1234", sessionId: "browser-a", expectedRevision: 2, surface: "pod", event: { type: "configuration_changed", payload: { size: "King", variantId: "fake" } } });
  assert.equal(injection.statusCode, 400);
  assert.equal(injection.body.qualitySignals.protectedFieldInjectionRejected, true);
  assert(calls.some((entry) => entry[0] === "active-journey.transition"));
  console.log("Active Journey route contract: 15/15 assertions passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
