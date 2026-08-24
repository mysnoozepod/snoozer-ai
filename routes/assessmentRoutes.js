async function handleAssessmentRoutes({ event, method, routePath, traceId, deps = {} }) {
  const {
    response,
    safeJsonBody,
    baseHeaders,
    buildFallbackHud,
    getHeader,
    headQuestionsObject,
    withTimeout,
    S3_RETRIEVAL_TIMEOUT_MS,
    QUESTIONS_BUCKET,
    QUESTIONS_KEY,
    QUESTIONS_TTL_MS,
    measureStep,
    loadAssessmentQuestions,
    fmtLastModified,
    normalizeEtag,
    log,
    isTimeoutError,
    cleanIdentityValue,
    deriveEffectiveThreadId,
    safeResolveSnoozeIdentity,
    safeIssueSnoozeCode,
    isCanonicalSnoozeIdentity,
    saveAssessmentResult,
    resolveCanonicalRecommendationContext,
    customerProfileService,
    buildIdentityProfilePatch,
    resolveIdentityLeadStage,
    safeUpsertCustomerProfile,
    logIdentityProfileOutcome,
    safeUpsertIdentityAliases,
    safeMarkIdentityMerge,
    maybeSyncIdentityProfileToZoho,
    rewardProgramService,
    getAssessmentSnapshot,
    getAssessmentResult,
  } = deps;

  if (method === "GET" && (routePath === "/content/assessment" || routePath === "/content/assessment/meta")) {
    try {
      const headStep = await measureStep("assessment_head_meta", () =>
        withTimeout(
          headQuestionsObject(),
          S3_RETRIEVAL_TIMEOUT_MS,
          "ASSESSMENT_HEAD_TIMEOUT",
          `Assessment HEAD exceeded ${S3_RETRIEVAL_TIMEOUT_MS}ms`,
          { bucket: QUESTIONS_BUCKET, key: QUESTIONS_KEY }
        )
      );

      if (!headStep.ok) throw headStep.error;

      const head = headStep.value;
      const etag = normalizeEtag(head.etag);
      const lastModified = fmtLastModified(head.lastModified);
      const ifNoneMatch =
        getHeader(event.headers, "if-none-match") || getHeader(event.headers, "If-None-Match");

      if (
        ifNoneMatch &&
        etag &&
        String(ifNoneMatch).trim() === etag &&
        routePath !== "/content/assessment/meta"
      ) {
        return {
          statusCode: 304,
          headers: baseHeaders(event, {
            ETag: etag,
            "Last-Modified": lastModified,
            "Cache-Control": "public, max-age=60",
            "X-Trace-Id": traceId,
          }),
          body: "",
        };
      }

      if (routePath === "/content/assessment/meta") {
        return response(
          event,
          200,
          {
            ok: true,
            bucket: QUESTIONS_BUCKET,
            key: QUESTIONS_KEY,
            etag,
            lastModified,
            cacheTtlMs: QUESTIONS_TTL_MS,
            retrievalTimeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
            retrievalMs: headStep.ms,
          },
          {
            ETag: etag,
            "Last-Modified": lastModified,
            "Cache-Control": "public, max-age=60",
          }
        );
      }

      const loadStep = await measureStep("assessment_load", () => loadAssessmentQuestions());
      if (!loadStep.ok) throw loadStep.error;

      log("content.assessment", "ok", {
        traceId,
        headMs: headStep.ms,
        loadMs: loadStep.ms,
        timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
      });

      return response(
        event,
        200,
        {
          ...loadStep.value.data,
          meta: {
            etag: loadStep.value.meta.etag,
            lastModified: fmtLastModified(loadStep.value.meta.lastModified),
            source: "s3",
            bucket: QUESTIONS_BUCKET,
            key: QUESTIONS_KEY,
            retrievalMs: loadStep.ms,
          },
        },
        {
          ETag: loadStep.value.meta.etag,
          "Last-Modified": fmtLastModified(loadStep.value.meta.lastModified),
          "Cache-Control": "public, max-age=60",
        }
      );
    } catch (e) {
      log("content.assessment.error", e.message, {
        traceId,
        bucket: QUESTIONS_BUCKET,
        key: QUESTIONS_KEY,
        timeoutMs: isTimeoutError(e) ? S3_RETRIEVAL_TIMEOUT_MS : null,
      });
      return response(event, 500, {
        code: isTimeoutError(e) ? "ASSESSMENT_RETRIEVAL_TIMEOUT" : "E_CONTENT_ASSESSMENT",
        message: "Failed to load assessment content",
        details: e.message,
      });
    }
  }

  if (method === "GET" && routePath === "/assessment-questions") {
    const loaded = await loadAssessmentQuestions();
    return response(event, 200, loaded.data, {
      ETag: loaded.meta.etag,
      "Last-Modified": fmtLastModified(loaded.meta.lastModified),
      "Cache-Control": "public, max-age=60",
    });
  }

  if (method === "POST" && routePath === "/assessment") {
    const body = safeJsonBody(event);
    const incomingShopperId = cleanIdentityValue(body?.shopperId);
    const answers = body?.answers || {};
    const origin = body?.origin;
    const identitySessionId = deriveEffectiveThreadId(event, {
      sessionId: body?.sessionId,
      thread_id: body?.threadId,
    });

    if (
      !incomingShopperId &&
      !cleanIdentityValue(body?.snoozeCode) &&
      !cleanIdentityValue(body?.accessCode)
    ) {
      return response(event, 400, { message: "shopperId required" });
    }

    const resolvedAssessmentIdentity = await safeResolveSnoozeIdentity(
      {
        shopperId: incomingShopperId,
        snoozeCode: body?.snoozeCode || body?.code || "",
        accessCode: body?.accessCode || "",
        sourceShopperId: body?.sourceShopperId || incomingShopperId,
        visitorId: body?.visitorId || "",
        sessionId: identitySessionId,
        threadId: identitySessionId,
        sourceSurface: origin || "assessment_api",
        reason: "assessment_completed",
      },
      { traceId, route: "/assessment" }
    );

    const issuedAssessmentIdentity = await safeIssueSnoozeCode(
      {
        shopperId: incomingShopperId,
        snoozeCode: body?.snoozeCode || body?.code || "",
        accessCode: body?.accessCode || "",
        sourceShopperId: body?.sourceShopperId || incomingShopperId,
        visitorId: body?.visitorId || "",
        sessionId: identitySessionId,
        threadId: identitySessionId,
        sourceSurface: origin || "assessment_api",
        reason: "assessment_completed",
        identity: resolvedAssessmentIdentity,
      },
      { traceId, route: "/assessment" }
    );

    const finalAssessmentIdentity =
      issuedAssessmentIdentity && isCanonicalSnoozeIdentity(issuedAssessmentIdentity)
        ? issuedAssessmentIdentity
        : resolvedAssessmentIdentity;
    const shopperId = cleanIdentityValue(finalAssessmentIdentity?.shopperId || incomingShopperId);

    await saveAssessmentResult(shopperId, answers || {});

    let assessmentCanonicalRecommendation = null;
    try {
      assessmentCanonicalRecommendation = await resolveCanonicalRecommendationContext({
        payload: {
          answers: answers || {},
          snoozeCode: finalAssessmentIdentity?.snoozeCode || null,
          accessCode: finalAssessmentIdentity?.accessCode || null,
        },
        storedAssessment: { answers: answers || {} },
        shopperId,
        allowSessionLookup: false,
        source: "assessment_profile",
        traceId,
      });
    } catch (error) {
      log("assessment.profile.canonical.error", error.message, { traceId, shopperId });
    }

    const customerProfilePatch =
      customerProfileService &&
      typeof customerProfileService.buildCustomerProfilePatch === "function"
        ? customerProfileService.buildCustomerProfilePatch({
            ...buildIdentityProfilePatch(finalAssessmentIdentity, {
              sourceShopperId: body?.sourceShopperId || incomingShopperId,
              sessionId: identitySessionId,
              threadId: identitySessionId,
              visitorId: body?.visitorId || "",
            }),
            shopperId,
            origin: origin || "assessment_api",
            sourceSurface: origin || "assessment_api",
            lastIntent: "assessment_submit",
            leadStage: resolveIdentityLeadStage("assessment_completed"),
            assessmentAnswers: answers || {},
            canonicalRecommendation: assessmentCanonicalRecommendation,
          })
        : {
            ...buildIdentityProfilePatch(finalAssessmentIdentity, {
              sourceShopperId: body?.sourceShopperId || incomingShopperId,
              sessionId: identitySessionId,
              threadId: identitySessionId,
              visitorId: body?.visitorId || "",
            }),
            shopperId,
            origin: origin || "assessment_api",
            sourceSurface: origin || "assessment_api",
            lastIntent: "assessment_submit",
            leadStage: resolveIdentityLeadStage("assessment_completed"),
            assessmentAnswers: answers || {},
            canonicalRecommendation: assessmentCanonicalRecommendation,
          };

    const assessmentProfileResult = await safeUpsertCustomerProfile(customerProfilePatch, {
      traceId,
      route: "/assessment",
    });
    logIdentityProfileOutcome(
      "/assessment",
      assessmentProfileResult,
      {
        shopperId,
        snoozeCode: finalAssessmentIdentity?.snoozeCode || null,
        profileId: finalAssessmentIdentity?.profileId || null,
        identityType: finalAssessmentIdentity?.identityType || null,
      },
      { traceId }
    );

    await safeUpsertIdentityAliases(
      finalAssessmentIdentity,
      {
        sourceShopperId: body?.sourceShopperId || incomingShopperId,
        visitorId: body?.visitorId || "",
        sessionId: identitySessionId,
        threadId: identitySessionId,
        sourceSurface: origin || "assessment_api",
        lastIntent: "assessment_submit",
        leadStage: customerProfilePatch?.leadStage || "",
      },
      { traceId, route: "/assessment" }
    );

    if (
      issuedAssessmentIdentity?.isNewCode &&
      cleanIdentityValue(resolvedAssessmentIdentity?.profileId) &&
      resolvedAssessmentIdentity.profileId !== finalAssessmentIdentity?.profileId
    ) {
      await safeMarkIdentityMerge(resolvedAssessmentIdentity.profileId, finalAssessmentIdentity, {
        traceId,
        route: "/assessment",
        reason: "assessment_completed",
        sourceSurface: origin || "assessment_api",
      });
    } else {
      log("snooze.identity.merge.skipped", "alias_only", {
        traceId,
        route: "/assessment",
        profileId: resolvedAssessmentIdentity?.profileId || null,
        canonicalProfileId: finalAssessmentIdentity?.profileId || null,
        reason: "alias_only",
      });
    }

    await maybeSyncIdentityProfileToZoho(customerProfilePatch, {
      traceId,
      route: "/assessment",
    });

    const confirmedRewards = [];
    if (
      rewardProgramService &&
      typeof rewardProgramService.recordRewardMilestone === "function" &&
      finalAssessmentIdentity?.profileId &&
      !assessmentProfileResult?.skipped
    ) {
      const rewardIdentity = {
        profileId: finalAssessmentIdentity.profileId,
        shopperId,
        snoozeCode: finalAssessmentIdentity.snoozeCode || shopperId,
        accessCode: finalAssessmentIdentity.accessCode || shopperId,
        sessionId: identitySessionId,
      };
      const rewardBase = {
        identity: rewardIdentity,
        sessionId: identitySessionId || `assessment:${shopperId}`,
        sourceSurface: "assessment",
      };
      try {
        confirmedRewards.push(
          await rewardProgramService.recordRewardMilestone({
            ...rewardBase,
            eventType: "milestone.profile.established",
            subjectType: "customer_profile",
            subjectId: finalAssessmentIdentity.profileId,
            metadata: { profileEstablished: true },
          })
        );
        confirmedRewards.push(
          await rewardProgramService.recordRewardMilestone({
            ...rewardBase,
            eventType: "milestone.assessment.completed",
            subjectType: "assessment",
            subjectId: `assessment:${shopperId}`,
            metadata: {
              assessmentVersion: body?.assessmentVersion || "assessment.v1",
              assessmentSaved: true,
              recommendationResolved: Boolean(assessmentCanonicalRecommendation),
              recommendationFallbackUsed: !assessmentCanonicalRecommendation,
            },
          })
        );
      } catch (error) {
        log("assessment.rewards.unavailable", error.code || error.message, {
          traceId,
          shopperId,
        });
      }
    }

    return response(event, 200, {
      ok: true,
      shopperId,
      snoozeCode: finalAssessmentIdentity?.snoozeCode || null,
      accessCode: finalAssessmentIdentity?.accessCode || null,
      profileId: finalAssessmentIdentity?.profileId || null,
      identityType: finalAssessmentIdentity?.identityType || null,
      isNewCode: Boolean(issuedAssessmentIdentity?.isNewCode),
      rewards: confirmedRewards.map((result) => ({
        duplicate: Boolean(result.duplicate),
        milestoneId: result.milestoneId,
        pointAward: result.pointAward,
        summary: result.summary,
        unlockedOffers: result.unlockedOffers,
        gift: result.gift,
        hud: result.hud,
      })),
    });
  }

  if (method === "GET" && routePath.startsWith("/assessment/")) {
    const parts = routePath.split("/").filter(Boolean);
    const shopperId = decodeURIComponent(parts[parts.length - 1] || "");
    if (!shopperId) return response(event, 400, { message: "shopperId required" });

    if (typeof getAssessmentSnapshot === "function") {
      try {
        let storedAssessment = null;
        try {
          storedAssessment = await getAssessmentResult(shopperId);
        } catch (error) {
          log("assessment.snapshot.dynamo.error", error.message, { traceId, shopperId });
        }

        const out = await getAssessmentSnapshot(shopperId, {
          assessment: storedAssessment,
          includeAssessment: true,
        });
        return response(event, out.statusCode || 200, out.body || {});
      } catch (e) {
        log("assessment.snapshot.error", e.message, { traceId, shopperId });
      }
    }

    let item = null;
    try {
      item = await getAssessmentResult(shopperId);
    } catch (e) {
      log("assessment.dynamo.error", e.message, { traceId, shopperId });
    }

    return response(event, 200, {
      ok: true,
      shopperId,
      exists: !!item,
      shopperState: item ? "KNOWN" : "NEW",
      assessment: item || null,
      profile: null,
      meta: {
        zohoContactId: null,
        zohoModifiedTime: null,
        dynamoUpdatedAt: item?.updatedAt || null,
      },
      actions: {
        canViewResults: !!item,
        canRetakeAssessment: true,
        shouldPromptAssessment: !item,
      },
      source: "fallback_dynamo_only",
    });
  }

  return null;
}

module.exports = {
  handleAssessmentRoutes,
};
