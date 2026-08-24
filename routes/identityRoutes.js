function isDevelopmentWelcomeCode(sourceSurface = "", value = "") {
  return (
    String(sourceSurface || "").trim().toLowerCase() === "showroom_welcome" &&
    /^\d{4}$/.test(String(value || "").trim())
  );
}

async function handleIdentityRoutes({ event, method, routePath, traceId, deps = {} }) {
  const {
    safeJsonBody,
    cleanIdentityValue,
    deriveEffectiveThreadId,
    safeResolveSnoozeIdentity,
    safeIssueSnoozeCode,
    isCanonicalSnoozeIdentity,
    response,
    resolveIdentityLeadStage,
    resolveCanonicalRecommendationContext,
    log,
    customerProfileService,
    buildIdentityProfilePatch,
    safeUpsertCustomerProfile,
    logIdentityProfileOutcome,
    safeUpsertIdentityAliases,
    safeMarkIdentityMerge,
    maybeSyncIdentityProfileToZoho,
    safeGetCustomerProfile,
    buildCheckInSummary,
  } = deps;

  if (method === "POST" && routePath === "/identity/snooze-code") {
    const body = safeJsonBody(event);
    const reason = cleanIdentityValue(body?.reason).toLowerCase();
    const sourceSurface = cleanIdentityValue(body?.sourceSurface) || "identity_api";
    const identitySessionId = deriveEffectiveThreadId(event, {
      sessionId: body?.sessionId,
      thread_id: body?.threadId,
    });

    const resolvedIdentity = await safeResolveSnoozeIdentity(
      {
        shopperId: body?.shopperId,
        snoozeCode: body?.snoozeCode || body?.code || "",
        accessCode: body?.accessCode || "",
        sourceShopperId: body?.sourceShopperId || body?.shopperId || "",
        visitorId: body?.visitorId || "",
        sessionId: identitySessionId,
        threadId: identitySessionId,
        sourceSurface,
        reason,
        assessment: body?.assessment || body?.answers || null,
        canonicalRecommendation: body?.canonicalRecommendation || null,
        contact: body?.contact || null,
      },
      { traceId, route: "/identity/snooze-code" }
    );

    const finalIdentity = await safeIssueSnoozeCode(
      {
        shopperId: body?.shopperId,
        snoozeCode: body?.snoozeCode || body?.code || "",
        accessCode: body?.accessCode || "",
        sourceShopperId: body?.sourceShopperId || body?.shopperId || "",
        visitorId: body?.visitorId || "",
        sessionId: identitySessionId,
        threadId: identitySessionId,
        sourceSurface,
        reason,
        identity: resolvedIdentity,
        assessment: body?.assessment || body?.answers || null,
        canonicalRecommendation: body?.canonicalRecommendation || null,
        contact: body?.contact || null,
      },
      { traceId, route: "/identity/snooze-code" }
    );

    if (!isCanonicalSnoozeIdentity(finalIdentity)) {
      return response(event, 200, {
        ok: false,
        code: "SNOOZE_CODE_NOT_QUALIFIED",
        message: "Snooze Code not issued.",
        shopperId: resolvedIdentity?.shopperId || null,
        snoozeCode: null,
        accessCode: null,
        profileId: resolvedIdentity?.profileId || null,
        identityType: resolvedIdentity?.identityType || null,
        isNewCode: false,
        aliases: Array.isArray(resolvedIdentity?.aliases) ? resolvedIdentity.aliases : [],
        leadStage: resolveIdentityLeadStage(reason) || null,
      });
    }

    let identityCanonicalRecommendation = body?.canonicalRecommendation || null;
    if (!identityCanonicalRecommendation && body?.assessment) {
      try {
        identityCanonicalRecommendation = await resolveCanonicalRecommendationContext({
          payload: { answers: body.assessment },
          storedAssessment: { answers: body.assessment },
          shopperId: finalIdentity.shopperId,
          allowSessionLookup: false,
          source: "identity_snooze_code",
          traceId,
        });
      } catch (error) {
        log("snooze.identity.canonical.error", error.message, {
          traceId,
          route: "/identity/snooze-code",
          shopperId: finalIdentity.shopperId || null,
          code: error?.code || null,
        });
      }
    }

    const identityPatch =
      customerProfileService &&
      typeof customerProfileService.buildCustomerProfilePatch === "function"
        ? customerProfileService.buildCustomerProfilePatch({
            ...buildIdentityProfilePatch(finalIdentity, {
              sourceShopperId: body?.sourceShopperId || body?.shopperId || "",
              visitorId: body?.visitorId || "",
              sessionId: identitySessionId,
              threadId: identitySessionId,
            }),
            contact: body?.contact || null,
            assessmentAnswers: body?.assessment || body?.answers || null,
            canonicalRecommendation: identityCanonicalRecommendation,
            sourceSurface,
            lastIntent: "snooze_code_issue",
            leadStage: resolveIdentityLeadStage(reason),
          })
        : {
            ...buildIdentityProfilePatch(finalIdentity, {
              sourceShopperId: body?.sourceShopperId || body?.shopperId || "",
              visitorId: body?.visitorId || "",
              sessionId: identitySessionId,
              threadId: identitySessionId,
            }),
            contact: body?.contact || null,
            assessmentAnswers: body?.assessment || body?.answers || null,
            canonicalRecommendation: identityCanonicalRecommendation,
            sourceSurface,
            lastIntent: "snooze_code_issue",
            leadStage: resolveIdentityLeadStage(reason),
          };

    const identityProfileResult = await safeUpsertCustomerProfile(identityPatch, {
      traceId,
      route: "/identity/snooze-code",
    });

    logIdentityProfileOutcome("/identity/snooze-code", identityProfileResult, finalIdentity, {
      traceId,
    });

    await safeUpsertIdentityAliases(
      finalIdentity,
      {
        sourceShopperId: body?.sourceShopperId || body?.shopperId || "",
        visitorId: body?.visitorId || "",
        sessionId: identitySessionId,
        threadId: identitySessionId,
        sourceSurface,
        lastIntent: "snooze_code_issue",
        leadStage: identityPatch?.leadStage || "",
      },
      { traceId, route: "/identity/snooze-code" }
    );

    if (
      finalIdentity?.isNewCode &&
      cleanIdentityValue(resolvedIdentity?.profileId) &&
      resolvedIdentity.profileId !== finalIdentity.profileId
    ) {
      await safeMarkIdentityMerge(resolvedIdentity.profileId, finalIdentity, {
        traceId,
        route: "/identity/snooze-code",
        reason,
        sourceSurface,
      });
    }

    await maybeSyncIdentityProfileToZoho(identityPatch, {
      traceId,
      route: "/identity/snooze-code",
    });

    return response(event, 200, {
      ok: true,
      shopperId: finalIdentity.shopperId || null,
      snoozeCode: finalIdentity.snoozeCode || null,
      accessCode: finalIdentity.accessCode || null,
      profileId: finalIdentity.profileId || null,
      identityType: finalIdentity.identityType || null,
      identitySource: finalIdentity.identitySource || null,
      isNewCode: Boolean(finalIdentity?.isNewCode),
      aliases: Array.isArray(finalIdentity?.aliases) ? finalIdentity.aliases : [],
      leadStage: identityPatch?.leadStage || null,
      message: finalIdentity?.message || "Snooze Code ready.",
    });
  }

  if (method === "POST" && routePath === "/identity/check-in") {
    const body = safeJsonBody(event);
    const sourceSurface = cleanIdentityValue(body?.sourceSurface) || "identity_checkin";
    const requestedCode = cleanIdentityValue(
      body?.snoozeCode || body?.accessCode || body?.code
    );
    const allowDevelopmentWelcomeProfile = isDevelopmentWelcomeCode(
      sourceSurface,
      requestedCode
    );
    const identitySessionId = deriveEffectiveThreadId(event, {
      sessionId: body?.sessionId,
      thread_id: body?.threadId,
    });
    const resolvedIdentity = await safeResolveSnoozeIdentity(
      {
        shopperId: body?.shopperId,
        snoozeCode: body?.snoozeCode || body?.code || "",
        accessCode: body?.accessCode || "",
        visitorId: body?.visitorId || "",
        sessionId: identitySessionId,
        threadId: identitySessionId,
        sourceSurface,
        reason: "manual_create",
      },
      { traceId, route: "/identity/check-in" }
    );

    if (!isCanonicalSnoozeIdentity(resolvedIdentity)) {
      log("snooze.identity.checkin.not_found", "not_found", {
        traceId,
        route: "/identity/check-in",
        sourceSurface,
        incomingShopperId: cleanIdentityValue(body?.shopperId) || null,
        snoozeCode: cleanIdentityValue(body?.snoozeCode || body?.accessCode || body?.code) || null,
      });
      return response(event, 200, {
        ok: false,
        code: "SNOOZE_CODE_NOT_FOUND",
        message: "Snooze Code not found.",
      });
    }

    const canonicalProfileResult = await safeGetCustomerProfile(
      {
        profileId: resolvedIdentity.profileId,
        shopperId: resolvedIdentity.shopperId,
      },
      { traceId, route: "/identity/check-in" }
    );
    const canonicalProfile = canonicalProfileResult?.profile || null;

    if (!canonicalProfile && !allowDevelopmentWelcomeProfile) {
      log("snooze.identity.checkin.not_found", "not_found", {
        traceId,
        route: "/identity/check-in",
        sourceSurface,
        incomingShopperId: cleanIdentityValue(body?.shopperId) || null,
        snoozeCode: resolvedIdentity.snoozeCode || null,
        profileId: resolvedIdentity.profileId || null,
      });
      return response(event, 200, {
        ok: false,
        code: "SNOOZE_CODE_NOT_FOUND",
        message: "Snooze Code not found.",
      });
    }

    const checkInPatch = {
      ...buildIdentityProfilePatch(resolvedIdentity, {
        sessionId: identitySessionId,
        threadId: identitySessionId,
        visitorId: body?.visitorId || "",
      }),
      sourceSurface,
      lastIntent: "snooze_code_checkin",
      leadStage: resolveIdentityLeadStage("manual_create", canonicalProfile?.leadStage || ""),
      bookingStatus: cleanIdentityValue(canonicalProfile?.bookingStatus) || undefined,
    };

    const checkInProfileResult = await safeUpsertCustomerProfile(checkInPatch, {
      traceId,
      route: "/identity/check-in",
    });

    logIdentityProfileOutcome("/identity/check-in", checkInProfileResult, resolvedIdentity, {
      traceId,
    });

    await safeUpsertIdentityAliases(
      resolvedIdentity,
      {
        visitorId: body?.visitorId || "",
        sessionId: identitySessionId,
        threadId: identitySessionId,
        sourceSurface,
        lastIntent: "snooze_code_checkin",
        leadStage: checkInPatch?.leadStage || "",
      },
      { traceId, route: "/identity/check-in" }
    );

    if (canonicalProfile) {
      log("customer.profile.zoho.identity.skipped", "NO_MATERIAL_ZOHO_CHANGE", {
        traceId,
        route: "/identity/check-in",
        shopperId: resolvedIdentity.shopperId || null,
        reason: "NO_MATERIAL_ZOHO_CHANGE",
      });
    } else {
      await maybeSyncIdentityProfileToZoho(checkInPatch, {
        traceId,
        route: "/identity/check-in",
      });
    }

    const summary = await buildCheckInSummary(
      customerProfileService && typeof customerProfileService.mergeCustomerProfile === "function"
        ? customerProfileService.mergeCustomerProfile(canonicalProfile, checkInPatch)
        : { ...canonicalProfile, ...checkInPatch },
      sourceSurface
    );

    log("snooze.identity.checkin.ok", "ok", {
      traceId,
      route: "/identity/check-in",
      sourceSurface,
      canonicalShopperId: resolvedIdentity.shopperId || null,
      snoozeCode: resolvedIdentity.snoozeCode || null,
      profileId: resolvedIdentity.profileId || null,
      leadStage: summary.leadStage || null,
    });

    return response(event, 200, summary);
  }

  return null;
}

module.exports = {
  handleIdentityRoutes,
  isDevelopmentWelcomeCode,
};
