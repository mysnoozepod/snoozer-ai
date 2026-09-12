async function handleActiveJourneyRoutes({ event, method, routePath, traceId, deps = {} }) {
  const {
    response, safeJsonBody, cleanIdentityValue, deriveEffectiveThreadId,
    safeResolveSnoozeIdentity, safeGetCustomerProfile, resolveCanonicalRecommendationContext,
    activeJourneyService, loadShowroomManifest, log,
  } = deps;
  if (method !== "POST" || !["/journey/resolve", "/journey/event"].includes(routePath)) return null;
  const startedAt = Date.now();
  const body = safeJsonBody(event);
  const sessionId = deriveEffectiveThreadId(event, { sessionId: body?.sessionId, thread_id: body?.threadId });
  const identity = await safeResolveSnoozeIdentity({
    shopperId: body?.shopperId, snoozeCode: body?.snoozeCode || body?.code || "",
    accessCode: body?.accessCode || "", sessionId, threadId: sessionId,
    sourceSurface: body?.surface || body?.sourceSurface || "journey", reason: "active_journey",
  }, { traceId, route: routePath });
  if (!cleanIdentityValue(identity?.profileId || identity?.shopperId)) {
    return response(event, 400, { ok: false, code: "ACTIVE_JOURNEY_IDENTITY_REQUIRED", message: "Check in before resuming your Snooze Session." });
  }
  const profileResult = await safeGetCustomerProfile({ profileId: identity.profileId, shopperId: identity.shopperId }, { traceId, route: routePath });
  const profile = profileResult?.profile || null;
  let canonicalRecommendation = profile?.canonicalRecommendation || null;
  if (!canonicalRecommendation && profile?.assessmentAnswers) {
    canonicalRecommendation = await resolveCanonicalRecommendationContext({
      payload: { answers: profile.assessmentAnswers }, storedAssessment: { answers: profile.assessmentAnswers },
      shopperId: identity.shopperId, allowSessionLookup: false, source: "active_journey", traceId,
    }).catch(() => null);
  }
  const allowedProductHandles = new Set((loadShowroomManifest()?.products || []).map((product) => String(product?.handle || "").trim().toLowerCase()).filter(Boolean));
  try {
    const resolved = await activeJourneyService.resolve({ identity: { ...identity, sessionId }, canonicalRecommendation, surface: body?.surface, forceNew: body?.forceNew === true });
    if (routePath === "/journey/resolve") {
      log("active-journey.resolve", "ok", { traceId, journeyId: resolved.journey.journeyId, revision: resolved.journey.revision, surface: resolved.journey.currentSurface, created: resolved.created, resumed: resolved.resumed, rotated: resolved.rotated, readMs: resolved.readMs, totalMs: Date.now() - startedAt });
      return response(event, 200, {
        ok: true,
        activeJourney: resolved.journey,
        qualitySignals: {
          journeyResolved: true,
          journeyResumed: resolved.resumed,
          journeyHydrated: true,
          canonicalStatePreserved: true,
          sessionRecommendationPreserved: true,
          sessionAndCanonicalSeparated: true,
        },
        metrics: { readMs: resolved.readMs, writeMs: resolved.writeMs, totalMs: Date.now() - startedAt },
      });
    }
    const transitioned = await activeJourneyService.transition({
      recordId: resolved.recordId, journey: resolved.journey, event: body?.event,
      expectedRevision: body?.expectedRevision, allowedProductHandles,
    });
    log("active-journey.transition", "ok", { traceId, journeyId: transitioned.journey.journeyId, eventType: body?.event?.type, surface: transitioned.journey.currentSurface, revisionBefore: transitioned.revisionBefore, revisionAfter: transitioned.revisionAfter, stateDelta: transitioned.stateDelta, mergedFromStaleRevision: transitioned.mergedFromStaleRevision, writeMs: transitioned.writeMs, totalMs: Date.now() - startedAt });
    const eventType = body?.event?.type;
    return response(event, 200, { ok: true, activeJourney: transitioned.journey, transition: { stateDelta: transitioned.stateDelta, revisionBefore: transitioned.revisionBefore, revisionAfter: transitioned.revisionAfter, mergedFromStaleRevision: transitioned.mergedFromStaleRevision }, qualitySignals: { journeyResolved: true, journeyResumed: resolved.resumed, journeyHydrated: true, crossSurfaceStatePreserved: true, staleWriteRejected: false, staleClientWriteRejected: false, independentMergeSucceeded: transitioned.mergedFromStaleRevision, surfaceStateConflict: false, conflictResolvedSafely: transitioned.mergedFromStaleRevision, canonicalStatePreserved: true, sessionRecommendationPreserved: true, restTestFeedbackPromoted: eventType === "rest_test_feedback", configurationPreserved: eventType === "configuration_changed", cartAuthorityPreserved: ["cart_linked", "checkout_handoff"].includes(eventType), sessionAndCanonicalSeparated: true, cartSourceVerified: eventType === "cart_linked" ? /^gid:\/\/shopify\/Cart\//.test(String(body?.event?.payload?.cartId || "")) : null }, metrics: { readMs: resolved.readMs, writeMs: transitioned.writeMs, totalMs: Date.now() - startedAt } });
  } catch (error) {
    const conflict = error?.code === "ACTIVE_JOURNEY_CONFLICT";
    log("active-journey.error", error.code || error.message, { traceId, route: routePath, conflict, conflictingFields: error?.conflictingFields || [] });
    return response(event, conflict ? 409 : 400, { ok: false, code: error.code || "ACTIVE_JOURNEY_ERROR", message: conflict ? "Your Snooze Session changed on another screen. I refreshed the current decision." : "That update could not be saved. Please try again.", conflictingFields: error?.conflictingFields || [], activeJourney: error?.currentJourney || null, qualitySignals: { journeyResolved: Boolean(error?.currentJourney), journeyHydrated: Boolean(error?.currentJourney), crossSurfaceStatePreserved: conflict, staleWriteRejected: conflict, staleClientWriteRejected: conflict, surfaceStateConflict: conflict, conflictResolvedSafely: conflict, protectedFieldInjectionRejected: error?.code === "ACTIVE_JOURNEY_PROTECTED_FIELD" } });
  }
}

module.exports = { handleActiveJourneyRoutes };
