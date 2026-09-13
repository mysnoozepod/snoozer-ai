function buildBoundedConversationHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-8)
    .map((entry) => ({
      role: String(entry?.role || "").trim() === "assistant" ? "assistant" : "user",
      content: String(entry?.content || "").trim().slice(0, 500),
    }))
    .filter((entry) => entry.content);
}

async function handleAskSnoozerRoutes({ event, method, routePath, traceId, deps = {} }) {
  const {
    safeJsonBody,
    isDebugRequest,
    deriveEffectiveThreadId,
    cleanIdentityValue,
    safeResolveSnoozeIdentity,
    log,
    wantsHudResponse,
    buildErrorResponse,
    normalizeSnoozerResponse,
    logContractResponse,
    buildHudFromAny,
    flatResponse: baseFlatResponse,
    getSessionItem,
    nowIso,
    buildDefaultSCO,
    putSessionItemIfMissing,
    ttlEpochSeconds,
    deepMerge,
    normalizePodAnchors,
    getAssessmentResult,
    recsService,
    getSeedRecommendations,
    resolveCanonicalRecommendationContext,
    attachCanonicalRecommendationContext,
    pickAskSnoozerAssessmentInput,
    buildAskSnoozerClassification,
    safeGetCustomerProfile,
    attachStoredProfileContext,
    customerProfileService,
    buildIdentityProfilePatch,
    enqueueAskSnoozerAsyncWrites,
    applyAskSnoozerWorkingMemory,
    buildWorkingMemoryLogMetadata,
    completeAskSnoozerAdvisorTurn,
    completeAskSnoozerPriceGoal,
    markAskSnoozerPriceGoalResolving,
    planAskSnoozerTurn,
    resolveAskSnoozerAdvisorTurn,
    composeTrustedAdvisorResponse,
    loadTrustedAdvisorFactPack,
    resolveAskSnoozerVisitLifecycle,
    activeJourneyService,
    hydrateAskContextFromActiveJourney,
    buildAskJourneyPayload,
    buildAskSnoozerClientTimingEvent,
    emitAskSnoozerQualityTrace,
    getAskSnoozerQualityConfig,
    resolveAskSnoozerPresentationPolicy,
    safeResponseFingerprint,
    STRICT_POD_ANCHOR,
    routeAskSnoozerQuestion,
    maybeBuildAskSnoozerCanonicalAnswer,
    saveSessionContext,
    buildSuccessResponse,
    maybeBuildAskSnoozerDeterministicGuidanceAnswer,
    maybeBuildAskSnoozerCommerceAnswer,
    queryExplicitlyRequestsAskSnoozerCommerce,
    resolveAskSnoozerCommerceResponse,
    resolveAskSnoozerStationResponse,
    shopifySvc,
    rewardProgramService,
    loadShowroomManifest,
    resolveAskSnoozerPolicyAnswer,
    buildAskSnoozerPolicyChips,
    buildAskSnoozerAction,
    buildAskSnoozerMissingAssessmentChips,
    buildAskSnoozerClarificationReply,
    buildAskSnoozerMissingRecommendationReply,
    buildAskSnoozerFallbackReply,
    buildAskSnoozerQualityGateObject,
    maybeBuildAskSnoozerDeterministicFaqAnswer,
    S3_RETRIEVAL_TIMEOUT_MS,
    MODEL_TIMEOUT_MS,
    measureStep,
    withTimeout,
    isObject,
    safeNumber,
    normalizeContextPatch,
    normalizeHudStateValue,
    normalizeHudPriorityValue,
    normalizeHudVoiceStyleValue,
    isTimeoutError,
  } = deps;

  let emitDeferredQualityTrace = null;
  let responseActiveJourney = null;
  const flatResponse = (...args) => {
    if (typeof emitDeferredQualityTrace === "function") {
      try {
        emitDeferredQualityTrace(args[2]);
      } catch (error) {
        log("ask-snoozer.quality-trace.error", "deferred", {
          traceId,
          error: String(error?.message || error),
        });
      }
    }
    if (
      responseActiveJourney &&
      args[2] &&
      typeof args[2] === "object" &&
      !Array.isArray(args[2])
    ) {
      args[2].activeJourney = responseActiveJourney;
    }
    return baseFlatResponse(...args);
  };

  if (method === "POST" && routePath === "/ask-snoozer/quality-event") {
    const payload = safeJsonBody(event);
    const qualityEvent = typeof buildAskSnoozerClientTimingEvent === "function"
      ? buildAskSnoozerClientTimingEvent(payload)
      : null;
    if (qualityEvent) {
      log("ask-snoozer.client-timing", qualityEvent.phase, qualityEvent);
    }
    return flatResponse(event, 202, {
      ok: true,
      traceId,
      accepted: Boolean(qualityEvent),
    });
  }

  if (method === "POST" && (routePath === "/ask-snoozer" || routePath === "/ask")) {
    const startedAt = Date.now();
    const payload = safeJsonBody(event);
    const testCaseId = String(payload?.testCaseId || payload?.test_case_id || "").trim() || null;

    const debug = isDebugRequest(event);

    const msg = payload.message || payload.prompt || payload.text || "";
    const mode = payload.mode || undefined;
    const effectiveSessionId = deriveEffectiveThreadId(event, {
      ...payload,
      preferSnoozeCodeSession: true,
    });
    const askSourceSurface =
      payload.source ||
      payload?.context?.session?.source ||
      payload?.context?.source ||
      "ask_snoozer";
    const incomingAskShopperId = cleanIdentityValue(payload?.shopperId);
    const askIdentity = await safeResolveSnoozeIdentity(
      {
        shopperId: incomingAskShopperId,
        snoozeCode:
          payload?.snoozeCode ||
          payload?.code ||
          payload?.context?.snoozeCode ||
          "",
        accessCode: payload?.accessCode || payload?.context?.accessCode || "",
        sourceShopperId:
          payload?.sourceShopperId ||
          payload?.context?.sourceShopperId ||
          incomingAskShopperId,
        visitorId: payload?.visitorId || payload?.context?.visitorId || "",
        sessionId: effectiveSessionId,
        threadId: effectiveSessionId,
        context: payload?.context || {},
        sourceSurface: askSourceSurface,
        reason: "ask_snoozer",
      },
      { traceId, route: "/ask-snoozer" }
    );
    const shopperId = askIdentity?.shopperId || null;

    log("ask-snoozer.route", "session", {
      traceId,
      shopperId,
      mode,
      effectiveSessionId,
      surface: askSourceSurface,
      debug,
    });

    const wantHud = wantsHudResponse(event, mode);

    if (!msg) {
      const errorBody = buildErrorResponse({
        requestId: traceId,
        latencyMs: 0,
        context: { shopperId, sessionId: effectiveSessionId },
        code: "E_BAD_REQUEST",
        message: "Missing message",
      });

      const normalized = normalizeSnoozerResponse(
        {
          ...errorBody,
          ok: false,
          status: "error",
          sessionId: effectiveSessionId,
          reply: "Missing message.",
          error: { code: "E_BAD_REQUEST", message: "Missing message" },
        },
        { traceId, sessionId: effectiveSessionId, routePath, startedAtMs: startedAt, debug }
      );

      logContractResponse(normalized);

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: false,
          mode,
          context: { shopperId, sessionId: effectiveSessionId },
          payload,
          defaultSpeech: "Missing message.",
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    // 1) Load SCO (or auto-create)
    let sco = null;
    try {
      const item = await getSessionItem(effectiveSessionId);
      sco = item?.context || null;

      if (!sco) {
        const iso = nowIso();
        const source = payload.source || payload?.context?.session?.source || payload?.context?.source || "kiosk";
        const storeId =
          payload.storeId || payload?.context?.session?.storeId || payload?.context?.storeId || "mysnoozepod-1";

        const ctx = buildDefaultSCO(effectiveSessionId, source, storeId);

        try {
          await putSessionItemIfMissing({
            sessionId: effectiveSessionId,
            context: ctx,
            iso,
            ttl: ttlEpochSeconds(30),
          });
          sco = ctx;
          log("session.autocreate", "created", { traceId, effectiveSessionId });
        } catch {
          const reread = await getSessionItem(effectiveSessionId);
          sco = reread?.context || ctx;
        }
      }
    } catch (e) {
      log("session.load.error", e.message, { traceId, effectiveSessionId });
    }

    // 2) Merge callerContext into SCO and normalize pod anchors
    const callerContext = (payload.context && typeof payload.context === "object" ? payload.context : {}) || {};

    let context =
      sco && typeof sco === "object"
        ? deepMerge(sco, callerContext)
        : deepMerge({ sessionId: effectiveSessionId }, callerContext);

    // Normalize pod anchors
    context = normalizePodAnchors(context, payload);

    // Always stamp these top-level
    const currentPage = isObject(payload?.page) ? payload.page : {};
    const currentMode = String(mode || "").trim().toLowerCase();
    const currentPodId = String(context?.podId || context?.pod_id || "").trim();
    const currentHudPage =
      payload?.hudPage || currentPage?.hudPage || callerContext?.hudPage || null;
    const currentHudEvent =
      payload?.hudEvent || payload?.event || currentPage?.hudEvent || callerContext?.hudEvent || null;
    const currentHudScriptKey =
      payload?.hudScriptKey || payload?.scriptKey || currentPage?.hudScriptKey || callerContext?.hudScriptKey || null;

    context.shopperId = shopperId;
    context.snoozeCode = askIdentity?.snoozeCode || context?.snoozeCode || null;
    context.accessCode = askIdentity?.accessCode || context?.accessCode || null;
    context.profileId = askIdentity?.profileId || context?.profileId || null;
    context.sessionId = effectiveSessionId;
    context.path =
      currentPage?.route ||
      callerContext?.path ||
      callerContext?.route ||
      (currentMode === "pod" && currentPodId ? `/pod/${currentPodId}` : "/ask-snoozer");
    context.pageType =
      currentPage?.pageType ||
      callerContext?.pageType ||
      callerContext?.page_type ||
      (currentMode === "pod" ? "pod" : "ask_snoozer");
    context.hudPage = currentHudPage;
    context.hudEvent = currentHudEvent;
    context.hudScriptKey = currentHudScriptKey;
    context.device =
      payload?.page?.device && typeof payload.page.device === "object"
        ? payload.page.device
      : context?.device || null;

    const visitResolution = typeof resolveAskSnoozerVisitLifecycle === "function"
      ? resolveAskSnoozerVisitLifecycle({
          context,
          storedContext: sco,
          sessionId: effectiveSessionId,
          shopperId,
          forceNewVisit: payload?.startNewVisit === true,
        })
      : { context, metadata: null };
    context = visitResolution.context;
    const visitMetadata = visitResolution.metadata;
    if (visitMetadata) {
      log("ask-snoozer.visit-lifecycle", visitMetadata.rotated ? "rotated" : "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        ...visitMetadata,
      });
    }
    const incomingConversation = buildBoundedConversationHistory(payload?.history);
    context.recentConversation = incomingConversation.length
      ? incomingConversation
      : Array.isArray(context.recentConversation)
        ? context.recentConversation
        : [];
    // From this point forward the lifecycle-resolved context is authoritative.
    // Assign rather than deep-merge so expired active keys stay cleared.
    sco = context;

    // 3) Attach assessment and canonical recommendation context
    let storedAssessment = null;
    try {
      if (shopperId) {
        storedAssessment = await getAssessmentResult(shopperId);
        if (storedAssessment) context.assessment = storedAssessment;

        const m = String(mode || "").toLowerCase();
        const allowRecs = m !== "pod";

        if (allowRecs) {
          let recs;
          if (recsService && typeof recsService.getRecommendations === "function") {
            recs = await recsService.getRecommendations(shopperId, { mode: m });
          } else {
            recs = await getSeedRecommendations(shopperId);
          }

          if (Array.isArray(recs?.products) && recs.products.length) {
            const handles = recs.products.map((p) => p && p.handle).filter(Boolean);
            if (handles.length) context.recommendedProductHandles = handles;
          }

          if (Array.isArray(recs?.hints) && recs.hints.length) {
            context.recommendationHints = recs.hints;

            if (!context.retrievalHints || typeof context.retrievalHints !== "object") {
              context.retrievalHints = {};
            }
            if (!Array.isArray(context.retrievalHints.tags)) {
              context.retrievalHints.tags = [];
            }
            for (const h of recs.hints) {
              if (h && !context.retrievalHints.tags.includes(h)) {
                context.retrievalHints.tags.push(h);
              }
            }
          }
        } else {
          context.recommendationHints = [];
        }
      }

      const canonicalContext = await resolveCanonicalRecommendationContext({
        payload,
        context,
        storedAssessment,
        shopperId,
        sessionId: effectiveSessionId,
        allowSessionLookup: false,
        source: "ask_snoozer",
        traceId,
      });

      if (canonicalContext) {
        try {
          context = attachCanonicalRecommendationContext(context, canonicalContext);
          log("ask-snoozer.canonical", "resolved", {
            traceId,
            sessionId: effectiveSessionId,
            shopperId,
            topPodId: canonicalContext.topPodId || null,
            primaryMattressHandle: canonicalContext.primaryMattressHandle || null,
            baseHandle: canonicalContext.baseHandle || null,
            motionKey: canonicalContext.motionKey || null,
          });
        } catch (canonicalErr) {
          log("ask-snoozer.canonical.error", canonicalErr.message, {
            traceId,
            sessionId: effectiveSessionId,
            shopperId,
            code: canonicalErr?.code || null,
          });
        }
      }
    } catch (ctxErr) {
      log("ask-snoozer.context.error", ctxErr.message, { traceId, shopperId });
    }

    const profileAssessmentInput = pickAskSnoozerAssessmentInput({
      payload,
      context,
      storedAssessment,
    });
    const previousAskProfileResult = await safeGetCustomerProfile(
      {
        profileId: askIdentity?.profileId || undefined,
        shopperId: shopperId || undefined,
        sessionId: effectiveSessionId || undefined,
        threadId: effectiveSessionId || undefined,
      },
      { traceId, route: "/ask-snoozer" }
    );
    const previousAskProfile = previousAskProfileResult?.profile || null;
    context = attachStoredProfileContext(
      {
        ...context,
        bookingStatus: payload?.bookingStatus || context?.bookingStatus || "",
      },
      previousAskProfile
    );

    let activeJourneyResolution = null;
    let lastCommittedAskJourneyPayload = null;
    const commitActiveJourneyFromAskContext = async (phase) => {
      if (
        !activeJourneyResolution ||
        typeof buildAskJourneyPayload !== "function" ||
        typeof activeJourneyService?.transition !== "function"
      ) {
        return;
      }
      const journeyPayload = buildAskJourneyPayload(context);
      const payloadFingerprint = JSON.stringify(journeyPayload);
      if (payloadFingerprint === lastCommittedAskJourneyPayload) return;
      try {
        const manifestHandles = new Set(
          (loadShowroomManifest?.()?.products || [])
            .map((product) => String(product?.handle || "").trim().toLowerCase())
            .filter(Boolean)
        );
        const syncedJourney = await activeJourneyService.transition({
          recordId: activeJourneyResolution.recordId,
          journey: activeJourneyResolution.journey,
          expectedRevision: activeJourneyResolution.journey.revision,
          trusted: true,
          allowedProductHandles: manifestHandles,
          event: { type: "ask_state_committed", payload: journeyPayload },
        });
        activeJourneyResolution = { ...activeJourneyResolution, journey: syncedJourney.journey };
        context.activeJourney = syncedJourney.journey;
        responseActiveJourney = syncedJourney.journey;
        lastCommittedAskJourneyPayload = payloadFingerprint;
        log("active-journey.ask.committed", "ok", {
          traceId,
          phase,
          journeyId: syncedJourney.journey.journeyId,
          revision: syncedJourney.journey.revision,
          stateDelta: syncedJourney.stateDelta,
          writeMs: syncedJourney.writeMs,
        });
      } catch (error) {
        if (error?.currentJourney) {
          activeJourneyResolution = {
            ...activeJourneyResolution,
            journey: error.currentJourney,
          };
          context.activeJourney = error.currentJourney;
          responseActiveJourney = error.currentJourney;
        }
        log("active-journey.ask.error", error.code || error.message, { traceId, phase });
      }
    };
    if (activeJourneyService && typeof activeJourneyService.resolve === "function") {
      try {
        activeJourneyResolution = await activeJourneyService.resolve({
          identity: { ...askIdentity, shopperId, sessionId: effectiveSessionId },
          canonicalRecommendation: context?.canonicalRecommendation || null,
          surface: "ask_snoozer",
        });
        if (typeof hydrateAskContextFromActiveJourney === "function") {
          context = hydrateAskContextFromActiveJourney(context, activeJourneyResolution.journey);
        }
        responseActiveJourney = activeJourneyResolution.journey;
        log("active-journey.ask.hydrated", "ok", {
          traceId,
          journeyId: activeJourneyResolution.journey.journeyId,
          revision: activeJourneyResolution.journey.revision,
          readMs: activeJourneyResolution.readMs,
          recentRawHistoryCount: context.recentConversation?.length || 0,
        });
      } catch (error) {
        log("active-journey.ask.error", error.code || error.message, { traceId, phase: "hydrate" });
      }
    }

    let askSnoozerPlan = null;
    if (typeof applyAskSnoozerWorkingMemory === "function") {
      const preTurnReferenceContext = context;
      context = applyAskSnoozerWorkingMemory({ query: msg, context });
      if (typeof planAskSnoozerTurn === "function") {
        askSnoozerPlan = planAskSnoozerTurn({
          query: msg,
          context,
          referenceContext: preTurnReferenceContext,
        });
        if (
          askSnoozerPlan?.commercialCompletionAttempted &&
          typeof markAskSnoozerPriceGoalResolving === "function"
        ) {
          context = markAskSnoozerPriceGoalResolving(context);
        }
        context.askSnoozerWorkingMemory.lastPlan = askSnoozerPlan;
      }
      const memoryPatch = {
        askSnoozerWorkingMemory: context.askSnoozerWorkingMemory,
      };
      try {
        const merged = sco && typeof sco === "object" ? deepMerge(sco, memoryPatch) : memoryPatch;
        await saveSessionContext(effectiveSessionId, merged);
        sco = merged;
        log("ask-snoozer.working-memory", "persisted", {
          traceId,
          testCaseId,
          sessionId: effectiveSessionId,
          ...(typeof buildWorkingMemoryLogMetadata === "function"
            ? buildWorkingMemoryLogMetadata(context)
            : {}),
        });
      } catch (error) {
        log("ask-snoozer.working-memory.error", error.message, {
          traceId,
          testCaseId,
          sessionId: effectiveSessionId,
        });
      }
    }
    await commitActiveJourneyFromAskContext("pre_response");

    const askSnoozerClassification = buildAskSnoozerClassification(msg, context);
    const presentationPolicy = typeof resolveAskSnoozerPresentationPolicy === "function"
      ? resolveAskSnoozerPresentationPolicy({ correlationId: effectiveSessionId })
      : { version: "baseline-v1", assignment: "control", directives: ["preserve_current_structure"] };
    if (askSnoozerPlan) askSnoozerPlan.presentationPolicy = presentationPolicy;
    let qualityTraceEmitted = false;
    emitDeferredQualityTrace = (responseBody = {}) => {
      if (qualityTraceEmitted || typeof emitAskSnoozerQualityTrace !== "function") return;
      const metadata = responseBody?.metadata || responseBody?.meta || {};
      const qualityGate = metadata?.qualityGate || {};
      const metrics = metadata?.metrics || {};
      const executedModelCall = Boolean(
        Number(metrics?.modelCallCount) > 0 ||
        Number(metrics?.modelMs) > 0
      );
      const effectiveModelCallCount = Number(metrics?.modelCallCount) > 0
        ? Number(metrics.modelCallCount)
        : executedModelCall
          ? 1
          : 0;
      const reply = String(
        responseBody?.reply ||
        responseBody?.message?.text ||
        responseBody?.captions ||
        responseBody?.speech ||
        ""
      ).trim();
      const routeTask = String(
        qualityGate?.intent ||
        askSnoozerClassification?.intent ||
        askSnoozerPlan?.taskType ||
        "station_response"
      ).trim();
      const trace = emitAskSnoozerQualityTrace({
        log,
        config: typeof getAskSnoozerQualityConfig === "function" ? getAskSnoozerQualityConfig() : undefined,
        traceId,
        sessionId: effectiveSessionId,
        surface: askSourceSurface,
        deviceCategory: context?.device?.deviceMode || payload?.page?.device?.deviceMode || null,
        query: msg,
        reply,
        plan: {
          ...(askSnoozerPlan || {}),
          taskType: routeTask,
          answerMode: metadata?.answerStrategy || routeTask,
          stage: context?.askSnoozerWorkingMemory?.activeDeal?.stage || askSnoozerPlan?.stage || "exploring",
          responseDepth: askSnoozerPlan?.responseDepth || "standard",
          presentationPolicy,
        },
        context,
        actions: Array.isArray(responseBody?.actions) ? responseBody.actions : [],
        chips: Array.isArray(responseBody?.chips) ? responseBody.chips : [],
        products: Array.isArray(responseBody?.products)
          ? responseBody.products
          : Array.isArray(responseBody?.recommendations)
            ? responseBody.recommendations
            : [],
        gate: {
          ok: responseBody?.ok !== false && qualityGate?.factsResolved !== false,
          violations: [],
        },
        modelGate: metadata?.composition?.gate || null,
        compositionMode: metadata?.composition?.mode || (executedModelCall ? "model_assisted" : "deterministic"),
        responsePath: metadata?.answerPath || metadata?.path || "legacy_path",
        compositionFallbackUsed: Boolean(metadata?.composition?.fallbackUsed),
        modelCallCount: effectiveModelCallCount,
        totalMs: metrics?.totalMs || metadata?.latencyMs || (Date.now() - startedAt),
        modelMs: metrics?.modelMs || 0,
        factPackComplete: qualityGate?.factsResolved !== false,
        quote: context?.askSnoozerWorkingMemory?.activeDeal?.activeQuote || null,
        fallbackUsed: Boolean(
          metrics?.fallbackUsed ||
          qualityGate?.fallbackUsed ||
          (routeTask === "fallback" && qualityGate?.factsResolved === false)
        ),
        visitMetadata,
        regressionId: testCaseId,
        responsePolicyVersion: presentationPolicy.version,
      });
      qualityTraceEmitted = Boolean(trace);
    };

    const askProfilePatch =
      customerProfileService &&
      typeof customerProfileService.buildAskSnoozerProfilePatch === "function"
        ? customerProfileService.buildAskSnoozerProfilePatch({
            previousProfile: previousAskProfile,
            ...buildIdentityProfilePatch(askIdentity, {
              sourceShopperId:
                payload?.sourceShopperId ||
                payload?.context?.sourceShopperId ||
                incomingAskShopperId,
              sessionId: effectiveSessionId,
              threadId: effectiveSessionId,
              visitorId: payload?.visitorId || payload?.context?.visitorId || "",
            }),
            shopperId,
            sessionId: effectiveSessionId,
            threadId: effectiveSessionId,
            mode: mode || "",
            sourceSurface: askSourceSurface,
            lastIntent: askSnoozerClassification?.intent || "unknown",
            lastIntentGroup: askSnoozerClassification?.intent_group || "",
            message: msg,
            assessment: profileAssessmentInput,
            canonicalRecommendation: context?.canonicalRecommendation || null,
            customer: context?.customer || null,
            email: payload?.email || context?.customer?.email || "",
            phone: payload?.phone || context?.customer?.phone || "",
            preferredName: payload?.preferredName || context?.customer?.preferredName || "",
            contactPreference:
              payload?.contactPreference || context?.customer?.contactPreference || "",
            consent: context?.customer?.consent || null,
            leadStage: payload?.leadStage || context?.leadStage || "",
            bookingStatus: payload?.bookingStatus || context?.bookingStatus || "",
            podId: context?.podId || payload?.podId || "",
            recommendedProductHandles: Array.isArray(context?.recommendedProductHandles)
              ? context.recommendedProductHandles
              : [],
            context,
          })
        : {
            ...buildIdentityProfilePatch(askIdentity, {
              sourceShopperId:
                payload?.sourceShopperId ||
                payload?.context?.sourceShopperId ||
                incomingAskShopperId,
              sessionId: effectiveSessionId,
              threadId: effectiveSessionId,
              visitorId: payload?.visitorId || payload?.context?.visitorId || "",
            }),
            shopperId,
            sessionId: effectiveSessionId,
            threadId: effectiveSessionId,
            mode: mode || "",
            sourceSurface: askSourceSurface,
            lastIntent: askSnoozerClassification?.intent || "unknown",
            lastIntentGroup: askSnoozerClassification?.intent_group || "",
            lastQuery: msg,
            assessment: profileAssessmentInput,
            canonicalRecommendation: context?.canonicalRecommendation || null,
            customer: context?.customer || null,
            email: payload?.email || context?.customer?.email || "",
            phone: payload?.phone || context?.customer?.phone || "",
            preferredName: payload?.preferredName || context?.customer?.preferredName || "",
            contactPreference:
              payload?.contactPreference || context?.customer?.contactPreference || "",
            consent: context?.customer?.consent || null,
            leadStage: payload?.leadStage || context?.leadStage || "",
            bookingStatus: payload?.bookingStatus || context?.bookingStatus || "",
            podId: context?.podId || payload?.podId || "",
            recommendedProductHandles: Array.isArray(context?.recommendedProductHandles)
              ? context.recommendedProductHandles
              : [],
          };

    const asyncWritePayload = {
      traceId,
      identityLookup: {
        profileId: askIdentity?.profileId || undefined,
        shopperId: shopperId || undefined,
        sessionId: effectiveSessionId || undefined,
        threadId: effectiveSessionId || undefined,
      },
      identity: askIdentity,
      aliasContext: {
        sourceShopperId:
          payload?.sourceShopperId ||
          payload?.context?.sourceShopperId ||
          incomingAskShopperId,
        visitorId: payload?.visitorId || payload?.context?.visitorId || "",
        sessionId: effectiveSessionId,
        threadId: effectiveSessionId,
        sourceSurface: askSourceSurface,
        lastIntent: askSnoozerClassification?.intent || "",
        leadStage: askProfilePatch?.leadStage || "",
      },
      profilePatch: askProfilePatch,
      policyContext: {
        route: "/ask-snoozer",
        lastIntent: askSnoozerClassification?.intent || "",
        lastIntentGroup: askSnoozerClassification?.intent_group || "",
      },
    };
    const asyncWriteResult =
      typeof enqueueAskSnoozerAsyncWrites === "function"
        ? await enqueueAskSnoozerAsyncWrites(asyncWritePayload)
        : {
            ok: false,
            skipped: true,
            reason: "ASK_SNOOZER_ASYNC_QUEUE_NOT_CONFIGURED",
          };
    log(
      "ask-snoozer.async-writes.enqueue",
      asyncWriteResult?.ok ? "queued" : "skipped",
      {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId || null,
        messageId: asyncWriteResult?.messageId || null,
        reason: asyncWriteResult?.reason || null,
      }
    );

    // 3.5) STRICT POD ANCHOR: fail fast if pod mode lacks anchors
    if (STRICT_POD_ANCHOR && String(mode || "").toLowerCase() === "pod") {
      const hasPodId = !!String(context?.podId || "").trim();
      const hasExplore = Array.isArray(context?.explore) && context.explore.length > 0;

      if (!hasPodId || !hasExplore) {
        const latencyMs = Date.now() - startedAt;

        const normalized = normalizeSnoozerResponse(
          {
            ok: false,
            status: "error",
            sessionId: effectiveSessionId,
            thread_id: effectiveSessionId,
            reply:
              "I'm missing the products for this setup. Please reopen the Pod and try again.",
            error: {
              code: "E_POD_CONTEXT_MISSING",
              message: "Missing podId or exploreContext/explore array.",
              details: { hasPodId, hasExplore },
            },
            meta: {
              path: "grounded_safe_fallback",
              latency_ms: latencyMs,
              metrics: {
                retrievalMs: 0,
                modelMs: 0,
                totalMs: latencyMs,
                fallbackUsed: true,
              },
            },
            actions: [],
          },
          { traceId, sessionId: effectiveSessionId, routePath, startedAtMs: startedAt, debug }
        );

        logContractResponse(normalized);

        log("ask-snoozer.metrics", "pod_context_missing", {
          traceId,
          sessionId: effectiveSessionId,
          mode,
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: true,
          path: "grounded_safe_fallback",
        });

        if (wantHud) {
          const hud = await buildHudFromAny(normalized, {
            ok: false,
            mode,
            context,
            payload,
            defaultSpeech:
              "I'm missing the products for this setup. Please reopen the Pod and try again.",
            traceId,
          });
          return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
        }

        return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
      }
    }

    // Every turn is planned before routing. Nuanced continued turns use the
    // trusted-advisor composer; only clean station starters fall through.
    const advisorAnswer =
      askSnoozerPlan?.handled &&
      typeof resolveAskSnoozerAdvisorTurn === "function"
        ? await resolveAskSnoozerAdvisorTurn({
            query: msg,
            context,
            plan: askSnoozerPlan,
            fetchProductsByHandles: shopifySvc?.fetchProductsByHandles,
            composeAdvisorResponse: composeTrustedAdvisorResponse,
            loadAdvisorKnowledge: loadTrustedAdvisorFactPack,
            requestId: traceId,
          })
        : null;
    if (advisorAnswer) {
      if (typeof completeAskSnoozerAdvisorTurn === "function") {
        context = completeAskSnoozerAdvisorTurn(context, advisorAnswer);
      }
      await commitActiveJourneyFromAskContext("advisor_completion");
      const latencyMs = Date.now() - startedAt;
      const mergedContext = sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      try {
        await saveSessionContext(effectiveSessionId, mergedContext);
        sco = mergedContext;
      } catch (error) {
        log("ask-snoozer.working-memory.error", error.message, {
          traceId,
          testCaseId,
          sessionId: effectiveSessionId,
          phase: "advisor_completion",
        });
      }
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: `trusted_advisor_${advisorAnswer.plan.taskType}`,
        text: advisorAnswer.reply,
        context: mergedContext,
        products: advisorAnswer.products,
        actions: advisorAnswer.actions,
        metrics: {
          retrievalMs: advisorAnswer.quote ? latencyMs : 0,
          modelMs: advisorAnswer.modelMs || 0,
          totalMs: latencyMs,
          fallbackUsed: Boolean(advisorAnswer.fallbackUsed),
        },
      });
      env.reply = advisorAnswer.reply;
      env.thread_id = effectiveSessionId;
      env.sessionId = effectiveSessionId;
      env.status = advisorAnswer.fallbackUsed ? "completed_with_fallback" : "answered";
      env.activeJourney = activeJourneyResolution?.journey || null;
      env.chips = advisorAnswer.chips;
      const qualityConfig = typeof getAskSnoozerQualityConfig === "function"
        ? getAskSnoozerQualityConfig()
        : null;
      const responseValidationStartedAt = Date.now();
      const qualityTrace = typeof emitAskSnoozerQualityTrace === "function"
        ? emitAskSnoozerQualityTrace({
            log,
            config: qualityConfig || undefined,
            traceId,
            sessionId: effectiveSessionId,
            surface: askSourceSurface,
            deviceCategory: context?.device?.deviceMode || payload?.page?.device?.deviceMode || null,
            query: msg,
            reply: advisorAnswer.reply,
            plan: advisorAnswer.plan,
            context: mergedContext,
            actions: advisorAnswer.actions,
            chips: advisorAnswer.chips,
            products: advisorAnswer.products,
            gate: advisorAnswer.gate,
            modelGate: advisorAnswer.modelGate,
            compositionMode: advisorAnswer.compositionMode,
            responsePath: advisorAnswer.responsePath,
            compositionFallbackUsed: advisorAnswer.compositionFallbackUsed,
            modelCallCount: advisorAnswer.modelCallCount,
            totalMs: latencyMs,
            modelMs: advisorAnswer.modelMs,
            factPackComplete: (advisorAnswer.plan.neededFacts || []).length === 0,
            factPack: advisorAnswer.factPack,
            modelInputChars: advisorAnswer.modelInputChars,
            fallbackKind: advisorAnswer.fallbackKind,
            quote: advisorAnswer.quote,
            fallbackUsed: advisorAnswer.fallbackUsed,
            visitMetadata,
            regressionId: testCaseId,
            responsePolicyVersion: presentationPolicy.version,
          })
        : null;
      const responseValidationMs = Date.now() - responseValidationStartedAt;
      qualityTraceEmitted = Boolean(qualityTrace);
      const advisorFactsResolved = Boolean(
        advisorAnswer.gate?.ok !== false &&
        (advisorAnswer.plan.neededFacts || []).length === 0
      );
      const advisorReason = advisorAnswer.fallbackUsed
        ? `model_fallback_${advisorAnswer.fallbackKind || "composer_error"}`
        : "advisor_turn_resolved";
      env.meta = {
        path: advisorAnswer.responsePath,
        source: advisorAnswer.source,
        answer_strategy: advisorAnswer.plan.taskType,
        answer_grounded: true,
        answer_source_type: advisorAnswer.source,
        answer_source_key: advisorAnswer.plan.references?.requestedProductHandle || null,
        answer_facts_count: advisorAnswer.factPack?.products?.length || 1,
        resolved_requested_product_handle: advisorAnswer.plan.references?.requestedProductHandle || null,
        loaded_product_knowledge_handles: (advisorAnswer.factPack?.productFacts || []).map((item) => item.handle).filter(Boolean),
        reason: advisorReason,
        qualityGate: {
          intent: advisorAnswer.plan.taskType,
          intentGroup: "trusted_advisor",
          sourceOfTruth: advisorAnswer.source,
          answerType: advisorAnswer.quote ? "commerce_answer" : "advisor_answer",
          protectedTruthRequired: advisorAnswer.plan.protectedReferences.length > 0,
          factsResolved: advisorFactsResolved,
          fallbackUsed: Boolean(advisorAnswer.fallbackUsed),
          missingSlots: advisorAnswer.plan.neededFacts,
          reason: advisorReason,
        },
        semantics: {
          questionAnswered: advisorFactsResolved,
          activeGoalAdvanced: advisorFactsResolved,
          activeGoal: context?.askSnoozerWorkingMemory?.activeGoal?.intent || null,
          stage: advisorAnswer.plan.stage,
          plannerTask: advisorAnswer.plan.taskType,
          plannerConfidence: advisorAnswer.plan.confidence,
          continuation: Boolean(advisorAnswer.plan.continuationOf),
          canonicalPreserved: !advisorAnswer.gate.violations.includes("canonical_reference_lost"),
          quoteConsistent: !advisorAnswer.gate.violations.some((item) => item.includes("price_")),
          compatibilityResolved: advisorAnswer.quote?.compatibility?.status || null,
          nextActionPresent: advisorAnswer.actions.length > 0 || advisorAnswer.chips.length > 0,
          probeSelected: advisorAnswer.plan.probe || null,
          responseDepth: advisorAnswer.plan.responseDepth,
          internalLanguageBlocked: !advisorAnswer.gate.violations.some((item) => item.startsWith("internal_language")),
          truncationPrevented: !advisorAnswer.gate.violations.includes("truncated_ending"),
          conversationRegressionId: testCaseId,
        },
        quote: advisorAnswer.quote,
        responseGate: advisorAnswer.gate,
        composition: {
          mode: advisorAnswer.compositionMode,
          modelCallCount: advisorAnswer.modelCallCount,
          model: advisorAnswer.model,
          fallbackUsed: Boolean(advisorAnswer.compositionFallbackUsed),
          fallbackKind: advisorAnswer.fallbackKind || null,
          gate: advisorAnswer.modelGate,
          referenceResolution: advisorAnswer.plan.references?.resolution || null,
          factPackComplete: (advisorAnswer.plan.neededFacts || []).length === 0,
          inputChars: advisorAnswer.modelInputChars || 0,
          systemChars: advisorAnswer.modelSystemChars || 0,
          factPackChars: advisorAnswer.modelFactPackChars || advisorAnswer.factPack?.budget?.totalChars || 0,
          factPackBudget: advisorAnswer.factPack?.budget || null,
        },
        quality: qualityTrace
          ? {
              traceVersion: qualityTrace.version,
              outcomeVersion: qualityTrace.outcome.version,
              recoveryVersion: qualityTrace.outcome.recovery.version,
              responsePolicyVersion: qualityTrace.responsePolicyVersion,
              presentationAssignment: presentationPolicy.assignment,
              outcomeCategory: qualityTrace.outcome.category,
              recoveryStatus: qualityTrace.recoveryStatus,
              latencyBand: qualityTrace.latency.band,
              alertSeverity: qualityTrace.alert.severity,
            }
          : {
              traceVersion: null,
              responsePolicyVersion: presentationPolicy.version,
              presentationAssignment: presentationPolicy.assignment,
            },
        metrics: {
          retrievalMs: advisorAnswer.quote ? latencyMs : 0,
          modelMs: advisorAnswer.modelMs || 0,
          totalMs: latencyMs,
          fallbackUsed: Boolean(advisorAnswer.fallbackUsed),
          modelCallCount: advisorAnswer.modelCallCount || 0,
          modelInputChars: advisorAnswer.modelInputChars || 0,
          factPackChars: advisorAnswer.factPack?.budget?.totalChars || 0,
          fallbackKind: advisorAnswer.fallbackKind || null,
          responseValidationMs,
        },
      };
      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });
      normalized.voice = {
        speak: true,
        speech: advisorAnswer.speech,
        ttsEndpoint: "/hud/tts",
        audioUrl: null,
      };
      logContractResponse(normalized);
      log("ask-snoozer.semantic-outcome", "resolved", {
        traceId,
        testCaseId,
        sessionId: effectiveSessionId,
        shopperId: shopperId || null,
        ...env.meta.semantics,
        totalMs: latencyMs,
        modelMs: advisorAnswer.modelMs || 0,
        modelCallCount: advisorAnswer.modelCallCount || 0,
        compositionMode: advisorAnswer.compositionMode,
        responsePath: advisorAnswer.responsePath,
        compositionFallbackUsed: Boolean(advisorAnswer.compositionFallbackUsed),
        fallbackKind: advisorAnswer.fallbackKind || null,
        modelInputChars: advisorAnswer.modelInputChars || 0,
        factPackBudget: advisorAnswer.factPack?.budget || null,
        modelGateViolations: advisorAnswer.modelGate?.violations || [],
        referenceResolution: advisorAnswer.plan.references?.resolution || null,
        factPackComplete: (advisorAnswer.plan.neededFacts || []).length === 0,
        responseValidationMs,
        fallbackUsed: Boolean(advisorAnswer.fallbackUsed),
        visitReused: Boolean(visitMetadata?.reused),
        visitRotated: Boolean(visitMetadata?.rotated),
        visitAgeMs: visitMetadata?.visitAgeMs ?? null,
        visitRotationReason: visitMetadata?.rotationReason || null,
        activeVisitId: visitMetadata?.visitId || null,
        previousVisitId: visitMetadata?.previousVisitId || null,
      });
      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          payload,
          defaultSpeech: advisorAnswer.speech,
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }
      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    // Dedicated-station starter lanes stay inside the authoritative Ask route.
    // They use verified rewards/Shopify/canon data and return the existing envelope.
    if (
      String(mode || "").toLowerCase() === "ask_snoozer_page" &&
      typeof resolveAskSnoozerStationResponse === "function"
    ) {
      let stationManifest = null;
      try {
        stationManifest = typeof loadShowroomManifest === "function" ? loadShowroomManifest() : null;
      } catch (error) {
        log("ask-snoozer.station.manifest.error", error.message, {
          traceId,
          sessionId: effectiveSessionId,
        });
      }

      const stationAnswer = await resolveAskSnoozerStationResponse({
        query: msg,
        context,
        identity: askIdentity,
        rewardsService: rewardProgramService,
        shopify: shopifySvc,
        manifest: stationManifest,
        fetchProductsByHandles: shopifySvc?.fetchProductsByHandles,
      });

      const atomicStationIntents = new Set(["find_rewards", "analyze_cart", "browse_products"]);
      if (stationAnswer && atomicStationIntents.has(stationAnswer.intent)) {
        const latencyMs = Date.now() - startedAt;
        const contextWithStation = deepMerge(context, stationAnswer.contextPatch || {});
        const mergedContext =
          sco && typeof sco === "object" ? deepMerge(sco, contextWithStation) : contextWithStation;
        const env = buildSuccessResponse({
          requestId: traceId,
          latencyMs,
          model: `atomic_deterministic_${stationAnswer.intent}`,
          text: stationAnswer.reply,
          context: mergedContext,
          products: stationAnswer.products,
          actions: stationAnswer.actions,
          metrics: {
            retrievalMs: latencyMs,
            modelMs: 0,
            totalMs: latencyMs,
            fallbackUsed: stationAnswer.fallbackUsed,
          },
        });
        env.reply = stationAnswer.reply;
        env.thread_id = effectiveSessionId;
        env.sessionId = effectiveSessionId;
        env.status = stationAnswer.fallbackUsed ? "completed_with_fallback" : "answered";
        env.chips = stationAnswer.chips;
        env.meta = {
          path: "atomic_deterministic",
          intent: stationAnswer.intent,
          source: stationAnswer.source,
          answer_strategy: `atomic_deterministic_${stationAnswer.intent}`,
          answer_grounded: Boolean(stationAnswer.grounded),
          answer_source_type: stationAnswer.source,
          answer_source_key: stationAnswer.intent,
          answer_facts_count: stationAnswer.grounded ? 1 : 0,
          reason: stationAnswer.reason,
          qualityGate: {
            intent: stationAnswer.intent,
            intentGroup: "station",
            sourceOfTruth: stationAnswer.source,
            answerType: "station_answer",
            protectedTruthRequired: true,
            factsResolved: Boolean(stationAnswer.grounded),
            fallbackUsed: Boolean(stationAnswer.fallbackUsed),
            missingSlots: [],
            reason: stationAnswer.reason,
          },
          metrics: {
            retrievalMs: latencyMs,
            modelMs: 0,
            totalMs: latencyMs,
            fallbackUsed: Boolean(stationAnswer.fallbackUsed),
          },
        };

        const normalized = normalizeSnoozerResponse(env, {
          traceId,
          sessionId: effectiveSessionId,
          routePath,
          startedAtMs: startedAt,
          debug,
        });
        normalized.voice = {
          speak: true,
          speech: stationAnswer.speech,
          ttsEndpoint: "/hud/tts",
          audioUrl: null,
        };
        logContractResponse(normalized);
        log("ask-snoozer.station", "answered", {
          traceId,
          shopperId: shopperId || null,
          sessionId: effectiveSessionId,
          intent: stationAnswer.intent,
          sourceOfTruth: stationAnswer.source,
          factsResolved: Boolean(stationAnswer.grounded),
          fallbackUsed: Boolean(stationAnswer.fallbackUsed),
          reason: stationAnswer.reason || null,
          productCount: stationAnswer.products.length,
        });

        if (wantHud) {
          const hud = await buildHudFromAny(normalized, {
            ok: normalized.ok,
            mode,
            context: mergedContext,
            payload,
            defaultSpeech: stationAnswer.speech,
            traceId,
          });
          return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
        }

        return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
      }
    }

    const askSnoozerDecision = routeAskSnoozerQuestion({
      query: msg,
      context,
      classification: askSnoozerClassification,
    });
    log("ask-snoozer.router.decision", "routed", {
      traceId,
      testCaseId,
      shopperId: shopperId || null,
      sessionId: effectiveSessionId,
      surface: askSourceSurface,
      intentGroup: askSnoozerDecision.intentGroup,
      intent: askSnoozerDecision.intent,
      confidence: askSnoozerDecision.confidence,
      sourceOfTruth: askSnoozerDecision.sourceOfTruth,
      protectedTruthRequired: askSnoozerDecision.protectedTruthRequired,
      shouldUseOpenAI: askSnoozerDecision.shouldUseOpenAI,
      shouldAskClarifyingQuestion: askSnoozerDecision.shouldAskClarifyingQuestion,
      reason: null,
      ...(typeof buildWorkingMemoryLogMetadata === "function"
        ? buildWorkingMemoryLogMetadata(context)
        : {}),
    });
    log("ask-snoozer.slots.extracted", "slots", {
      traceId,
      testCaseId,
      shopperId: shopperId || null,
      sessionId: effectiveSessionId,
      intentGroup: askSnoozerDecision.intentGroup,
      intent: askSnoozerDecision.intent,
      confidence: askSnoozerDecision.confidence,
      slots: askSnoozerDecision.slots,
      missingSlots: askSnoozerDecision.missingSlots,
      sourceOfTruth: askSnoozerDecision.sourceOfTruth,
      factsResolved: false,
      fallbackUsed: false,
      reason: null,
      resolvedRequestedProductHandle: askSnoozerDecision.slots?.productHandle || null,
      ...(typeof buildWorkingMemoryLogMetadata === "function"
        ? buildWorkingMemoryLogMetadata(context)
        : {}),
    });
    const outcomeLogFields = (envelope = {}, failureReason = "") => {
      const metrics = isObject(envelope?.meta?.metrics)
        ? envelope.meta.metrics
        : {};
      const fallbackUsed = Boolean(
        metrics.fallbackUsed ||
          ["fallback", "error", "completed_with_fallback"].includes(
            String(envelope?.status || "").trim().toLowerCase()
          )
      );
      return {
        testCaseId,
        surface: askSourceSurface,
        answerPath: envelope?.meta?.path || "deterministic",
        retrievalMs: safeNumber(
          metrics.retrievalMs ?? envelope?.meta?.retrievalMs,
          0
        ),
        modelMs: safeNumber(metrics.modelMs ?? envelope?.meta?.modelMs, 0),
        totalMs: safeNumber(
          metrics.totalMs ?? envelope?.meta?.totalMs ?? Date.now() - startedAt,
          Date.now() - startedAt
        ),
        failureReason: fallbackUsed
          ? failureReason || envelope?.meta?.reason || "fallback"
          : null,
        responseFingerprint:
          typeof safeResponseFingerprint === "function"
            ? safeResponseFingerprint(envelope?.reply || envelope?.message?.text || "")
            : null,
        canonicalTopPodId: context?.canonicalRecommendation?.topPodId || null,
        canonicalPrimaryMattressHandle:
          context?.canonicalRecommendation?.primaryMattressHandle || null,
        resolvedRequestedProductHandle:
          envelope?.meta?.resolved_requested_product_handle ||
          askSnoozerDecision?.slots?.productHandle ||
          null,
        loadedProductKnowledgeHandles:
          envelope?.meta?.loaded_product_knowledge_handles || [],
        ...(typeof buildWorkingMemoryLogMetadata === "function"
          ? buildWorkingMemoryLogMetadata(context)
          : {}),
      };
    };

    const canonicalAnswer = maybeBuildAskSnoozerCanonicalAnswer(msg, context);
    if (canonicalAnswer) {
      let latencyMs = Date.now() - startedAt;
      let canonicalProducts = [];

      if (
        canonicalAnswer.answer_strategy === "canonical_recommendation" &&
        typeof shopifySvc?.fetchProductsByHandles === "function"
      ) {
        const canonicalHandles = Array.from(
          new Set(
            [
              context?.canonicalRecommendation?.primaryMattressHandle,
              context?.canonicalRecommendation?.baseHandle,
            ]
              .map((handle) => String(handle || "").trim())
              .filter(Boolean)
          )
        ).slice(0, 3);

        if (canonicalHandles.length) {
          try {
            const result = await shopifySvc.fetchProductsByHandles({
              handles: canonicalHandles,
              lite: false,
            });
            canonicalProducts = Array.isArray(result?.items) ? result.items : [];
          } catch (error) {
            log("ask-snoozer.canonical.products.error", error.message, {
              traceId,
              sessionId: effectiveSessionId,
              handles: canonicalHandles,
              code: error?.code || null,
            });
          }
        }
      }
      latencyMs = Date.now() - startedAt;

      if (sco && typeof sco === "object") {
        try {
          const merged = deepMerge(sco, context);
          await saveSessionContext(effectiveSessionId, merged);
          sco = merged;
          log("session.autosave", "canonical_context", { traceId, effectiveSessionId });
        } catch (e) {
          log("session.autosave.error", e.message, { traceId, effectiveSessionId });
        }
      }

      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;

      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model:
          canonicalAnswer.answer_strategy === "session_prep"
            ? "deterministic_session_guidance"
            : "canonical_recommendation",
        text: canonicalAnswer.reply || "",
        context: mergedContext,
        products: canonicalProducts,
        actions: [],
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      });

      env.reply = canonicalAnswer.reply || env.message?.text || "";
      env.thread_id = effectiveSessionId;
      env.status = "completed";
      env.sessionId = effectiveSessionId;
      env.meta = {
        path: "legacy_path",
        answer_strategy: canonicalAnswer.answer_strategy || "canonical_recommendation",
        answer_grounded: Boolean(canonicalAnswer.answer_grounded),
        answer_source_type: canonicalAnswer.answer_source_type || "canonical_recommendation",
        answer_source_key: canonicalAnswer.answer_source_key || null,
        answer_facts_count: Number(canonicalAnswer.answer_facts_count || 0),
        matched_preview: canonicalAnswer.matched_preview || "",
        extracted_facts: Array.isArray(canonicalAnswer.extracted_facts)
          ? canonicalAnswer.extracted_facts
          : [],
        reason: canonicalAnswer.reason || "",
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType:
            canonicalAnswer.answer_strategy === "session_prep"
              ? "session_guidance"
              : "product_answer",
          sourceOfTruth:
            canonicalAnswer.answer_strategy === "session_prep"
              ? "session_prep"
              : "canonical_profile",
          factsResolved: Boolean(canonicalAnswer.answer_grounded),
          fallbackUsed: false,
          reason: canonicalAnswer.reason || "",
        }),
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      };

      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });

      logContractResponse(normalized);

      log("ask-snoozer.canonical", "answered", {
        traceId,
        sessionId: effectiveSessionId,
        shopperId,
        topPodId: context?.canonicalRecommendation?.topPodId || null,
        primaryMattressHandle: context?.canonicalRecommendation?.primaryMattressHandle || null,
        baseHandle: context?.canonicalRecommendation?.baseHandle || null,
        motionKey: context?.canonicalRecommendation?.motionKey || null,
        totalMs: latencyMs,
      });
      log("ask-snoozer.fulfillment.result", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth:
          canonicalAnswer.answer_strategy === "session_prep"
            ? "session_prep"
            : "canonical_profile",
        factsResolved: Boolean(canonicalAnswer.answer_grounded),
        missingSlots: [],
        fallbackUsed: false,
        reason: canonicalAnswer.reason || "",
        ...outcomeLogFields(env, canonicalAnswer.reason || ""),
      });

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          payload,
          defaultSpeech: env.reply || env.message?.text || "I'm here.",
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    if (
      askSnoozerDecision.intentGroup === "recommendation" &&
      !isObject(context?.canonicalRecommendation)
    ) {
      const latencyMs = Date.now() - startedAt;
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      const reply = buildAskSnoozerMissingRecommendationReply();
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: "deterministic_recommendation_fallback",
        text: reply,
        context: mergedContext,
        products: [],
        actions: [
          buildAskSnoozerAction("start_assessment", "Start assessment", "/assessment"),
        ],
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      });

      env.reply = reply;
      env.chips = buildAskSnoozerMissingAssessmentChips();
      env.thread_id = effectiveSessionId;
      env.status = "completed";
      env.sessionId = effectiveSessionId;
      env.meta = {
        path: "deterministic_recommendation_fallback",
        answer_strategy: "missing_assessment",
        answer_grounded: false,
        answer_source_type: "fallback",
        answer_source_key: null,
        answer_facts_count: 0,
        matched_preview: "",
        extracted_facts: [],
        reason: "missing_assessment",
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType: "fallback",
          sourceOfTruth: "fallback",
          factsResolved: false,
          fallbackUsed: false,
          missingSlots: ["assessment"],
          reason: "missing_assessment",
        }),
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      };

      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });

      logContractResponse(normalized);
      log("ask-snoozer.fulfillment.result", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: "fallback",
        factsResolved: false,
        missingSlots: ["assessment"],
        fallbackUsed: false,
        reason: "missing_assessment",
        ...outcomeLogFields(env, "missing_assessment"),
      });

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          payload,
          defaultSpeech: reply,
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    if (askSnoozerDecision.intentGroup === "policy") {
      const latencyMs = Date.now() - startedAt;
      log("ask-snoozer.fulfillment.start", "policy", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: askSnoozerDecision.sourceOfTruth,
        factsResolved: false,
        missingSlots: askSnoozerDecision.missingSlots,
        fallbackUsed: false,
        reason: null,
      });
      const policy = await resolveAskSnoozerPolicyAnswer({
        query: msg,
        traceId,
        timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
      });
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      const policyFallbackUsed = !policy?.answerGrounded;

      if (!policy?.retrieved) {
        log("ask-snoozer.knowledge.missing", "policy_source_missing", {
          traceId,
          shopperId: shopperId || null,
          sessionId: effectiveSessionId,
          intentGroup: askSnoozerDecision.intentGroup,
          intent: askSnoozerDecision.intent,
          confidence: askSnoozerDecision.confidence,
          slots: askSnoozerDecision.slots,
          sourceOfTruth: "s3_policy",
          factsResolved: false,
          missingSlots: askSnoozerDecision.missingSlots,
          fallbackUsed: true,
          reason: "policy_source_missing",
          knowledgeKeys: askSnoozerDecision.knowledgeKeys,
        });
      }

      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: !policy?.retrieved
          ? "deterministic_policy_gap"
          : policy?.answerGrounded
            ? "policy_source_of_truth"
            : "policy_source_of_truth_with_gap",
        text: policy.reply || "",
        context: mergedContext,
        products: [],
        actions: [],
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: policyFallbackUsed,
        },
      });

      env.reply = policy.reply || env.message?.text || "";
      env.chips =
        Array.isArray(policy?.chips) && policy.chips.length
          ? policy.chips
          : buildAskSnoozerPolicyChips(policy?.policySubtype);
      env.thread_id = effectiveSessionId;
      env.status = policy?.retrieved
        ? (policy?.answerGrounded ? "completed" : "fallback")
        : "fallback";
      env.sessionId = effectiveSessionId;
      env.meta = {
        path: "deterministic_policy",
        answer_strategy: policy?.answerGrounded
          ? "policy_source_summary"
          : !policy?.retrieved
            ? "safe_missing_source"
            : "approved_policy_detail_missing",
        answer_grounded: Boolean(policy?.answerGrounded),
        answer_source_type: policy?.sourceKind || policy?.source || "fallback",
        answer_source_key: policy?.key || null,
        answer_facts_count: policy?.answerGrounded ? 1 : 0,
        matched_preview: policy?.matchedPreview || "",
        extracted_facts: [],
        reason:
          policy?.reason ||
          (policy?.retrieved ? "approved_policy_detail_missing" : "policy_source_missing"),
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType: "policy_answer",
          sourceOfTruth: policy?.retrieved ? "s3_policy" : "fallback",
          factsResolved: Boolean(policy?.answerGrounded),
          fallbackUsed: policyFallbackUsed,
          reason:
            policy?.reason ||
            (policy?.retrieved ? "approved_policy_detail_missing" : "policy_source_missing"),
        }),
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: policyFallbackUsed,
        },
      };

      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });

      logContractResponse(normalized);
      log("ask-snoozer.policy.answer", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: policy?.retrieved ? "s3_policy" : "fallback",
        factsResolved: Boolean(policy?.answerGrounded),
        missingSlots: askSnoozerDecision.missingSlots,
        fallbackUsed: policyFallbackUsed,
        reason:
          policy?.reason ||
          (policy?.retrieved ? "approved_policy_detail_missing" : "policy_source_missing"),
        ...outcomeLogFields(
          env,
          policy?.reason ||
            (policy?.retrieved ? "approved_policy_detail_missing" : "policy_source_missing")
        ),
      });
      log("ask-snoozer.fulfillment.result", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: policy?.retrieved ? "s3_policy" : "fallback",
        factsResolved: Boolean(policy?.answerGrounded),
        missingSlots: askSnoozerDecision.missingSlots,
        fallbackUsed: policyFallbackUsed,
        reason:
          policy?.reason ||
          (policy?.retrieved ? "approved_policy_detail_missing" : "policy_source_missing"),
      });

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          payload,
          defaultSpeech: env.reply || env.message?.text || "I'm here.",
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    if (
      askSnoozerDecision.shouldAskClarifyingQuestion &&
      ["commerce", "policy"].includes(askSnoozerDecision.intentGroup)
    ) {
      const latencyMs = Date.now() - startedAt;
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      const reply = buildAskSnoozerClarificationReply(askSnoozerDecision);
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: "deterministic_clarification",
        text: reply,
        context: mergedContext,
        products: [],
        actions: [],
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      });

      env.reply = reply;
      env.thread_id = effectiveSessionId;
      env.status = "completed";
      env.sessionId = effectiveSessionId;
      env.meta = {
        path: "deterministic_clarification",
        answer_strategy: "needs_clarification",
        answer_grounded: false,
        answer_source_type: "clarification",
        answer_source_key: null,
        answer_facts_count: 0,
        matched_preview: "",
        extracted_facts: [],
        reason: "missing_slots",
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType: "clarification",
          sourceOfTruth: askSnoozerDecision.sourceOfTruth,
          factsResolved: false,
          fallbackUsed: false,
          reason: "missing_slots",
        }),
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      };

      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });

      logContractResponse(normalized);
      log("ask-snoozer.clarification", "missing_slots", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: askSnoozerDecision.sourceOfTruth,
        factsResolved: false,
        missingSlots: askSnoozerDecision.missingSlots,
        fallbackUsed: false,
        reason: "missing_slots",
      });

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          payload,
          defaultSpeech: reply,
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    if (askSnoozerDecision.intentGroup === "commerce") {
      log("ask-snoozer.fulfillment.start", "commerce", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: askSnoozerDecision.sourceOfTruth,
        factsResolved: false,
        missingSlots: askSnoozerDecision.missingSlots,
        fallbackUsed: false,
        reason: null,
      });
      const commerceResolution = await resolveAskSnoozerCommerceResponse({
        query: msg,
        decision: askSnoozerDecision,
        fetchProductsByHandles: shopifySvc?.fetchProductsByHandles,
      });
      if (typeof completeAskSnoozerPriceGoal === "function") {
        context = completeAskSnoozerPriceGoal(context, {
          completed: Boolean(
            commerceResolution?.factsResolved &&
              commerceResolution?.sourceOfTruth === "shopify"
          ),
        });
        try {
          const memoryPatch = {
            askSnoozerWorkingMemory: context.askSnoozerWorkingMemory,
          };
          const merged = sco && typeof sco === "object" ? deepMerge(sco, memoryPatch) : memoryPatch;
          await saveSessionContext(effectiveSessionId, merged);
          sco = merged;
        } catch (error) {
          log("ask-snoozer.working-memory.error", error.message, {
            traceId,
            testCaseId,
            sessionId: effectiveSessionId,
            phase: "commerce_completion",
          });
        }
      }
      const latencyMs = Date.now() - startedAt;
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      const products = Array.isArray(commerceResolution?.products)
        ? commerceResolution.products.map((entry) => ({
            ...(entry?.product && typeof entry.product === "object" ? entry.product : {}),
            type: "product",
            label: entry?.title || entry?.handle || "",
            title: entry?.title || entry?.handle || "",
            handle: entry?.handle || "",
            href: entry?.href || "",
            product_id: String(entry?.product?.id || "").trim() || undefined,
            variant_id: entry?.variantId || undefined,
            variant_title: entry?.variantTitle || undefined,
            variantId: entry?.variantId || undefined,
            merchandiseId: entry?.variantId || undefined,
            selectedOptions: Array.isArray(entry?.selectedOptions) ? entry.selectedOptions : [],
            exactVariantResolved: Boolean(entry?.exactVariantResolved && entry?.variantId),
          }))
        : [];
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model:
          commerceResolution?.answerType === "clarification"
            ? "deterministic_clarification"
            : "deterministic_commerce",
        text: commerceResolution?.reply || "",
        context: mergedContext,
        products,
        actions: [],
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: Boolean(commerceResolution?.fallbackUsed),
        },
      });

      env.reply = commerceResolution?.reply || env.message?.text || "";
      env.thread_id = effectiveSessionId;
      env.status = commerceResolution?.fallbackUsed ? "completed_with_fallback" : "answered";
      env.sessionId = effectiveSessionId;
      env.meta = {
        path:
          commerceResolution?.answerType === "clarification"
            ? "deterministic_clarification"
            : "deterministic_commerce",
        source: {
          kind: "shopify",
          shopifyProducts: products.length,
        },
        source_label: "shopify",
        intent: askSnoozerDecision.intent,
        intent_group: askSnoozerDecision.intentGroup,
        policy_subtype: askSnoozerClassification?.policy_subtype || "",
        scope: askSnoozerDecision.slots?.scope || null,
        requested_size: askSnoozerDecision.slots?.size || null,
        resolved_product_handle: commerceResolution?.resolvedProductHandle || null,
        resolved_base_handle: commerceResolution?.resolvedBaseHandle || null,
        shopify_price_found: Boolean(commerceResolution?.factsResolved),
        answer_strategy:
          commerceResolution?.answerType === "clarification"
            ? "needs_clarification"
            : commerceResolution?.factsResolved
              ? "verified_price"
              : "safe_fallback",
        answer_grounded: Boolean(commerceResolution?.factsResolved),
        answer_source_type: commerceResolution?.sourceOfTruth || "fallback",
        answer_source_key:
          commerceResolution?.resolvedProductHandle ||
          commerceResolution?.resolvedBaseHandle ||
          null,
        answer_facts_count: commerceResolution?.factsResolved ? Math.max(1, products.length) : 0,
        matched_preview: "",
        extracted_facts: [],
        reason: commerceResolution?.reason || "",
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType: commerceResolution?.answerType || "fallback",
          sourceOfTruth: commerceResolution?.sourceOfTruth || "fallback",
          factsResolved: Boolean(commerceResolution?.factsResolved),
          fallbackUsed: Boolean(commerceResolution?.fallbackUsed),
          missingSlots: Array.isArray(commerceResolution?.missingSlots)
            ? commerceResolution.missingSlots
            : askSnoozerDecision.missingSlots,
          reason: commerceResolution?.reason || "",
        }),
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: Boolean(commerceResolution?.fallbackUsed),
        },
      };

      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });

      logContractResponse(normalized);
      log("ask-snoozer.commerce.answer", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: commerceResolution?.sourceOfTruth || "fallback",
        factsResolved: Boolean(commerceResolution?.factsResolved),
        missingSlots: Array.isArray(commerceResolution?.missingSlots)
          ? commerceResolution.missingSlots
          : askSnoozerDecision.missingSlots,
        fallbackUsed: Boolean(commerceResolution?.fallbackUsed),
        reason: commerceResolution?.reason || "",
        ...outcomeLogFields(env, commerceResolution?.reason || ""),
      });
      log("ask-snoozer.fulfillment.result", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: commerceResolution?.sourceOfTruth || "fallback",
        factsResolved: Boolean(commerceResolution?.factsResolved),
        missingSlots: Array.isArray(commerceResolution?.missingSlots)
          ? commerceResolution.missingSlots
          : askSnoozerDecision.missingSlots,
        fallbackUsed: Boolean(commerceResolution?.fallbackUsed),
        reason: commerceResolution?.reason || "",
      });

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          payload,
          defaultSpeech: env.reply || env.message?.text || "I'm here.",
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    const deterministicGuidanceAnswer =
      askSnoozerDecision.intentGroup === "product_education"
        ? await maybeBuildAskSnoozerDeterministicGuidanceAnswer({
            query: msg,
            context,
            traceId,
            decision: askSnoozerDecision,
            classification: askSnoozerDecision.classification || askSnoozerClassification,
          })
        : null;
    if (deterministicGuidanceAnswer) {
      const latencyMs = Date.now() - startedAt;
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      const answerType =
        String(deterministicGuidanceAnswer?.answer_strategy || "").trim() ===
        "needs_product_clarification"
          ? "clarification"
          : "product_answer";
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model:
          answerType === "clarification"
            ? "deterministic_clarification"
            : "deterministic_product_education",
        text: deterministicGuidanceAnswer.reply || "",
        context: mergedContext,
        products: [],
        actions: [],
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      });

      env.reply = deterministicGuidanceAnswer.reply || env.message?.text || "";
      env.thread_id = effectiveSessionId;
      env.status =
        answerType === "clarification"
          ? "completed"
          : deterministicGuidanceAnswer.answer_grounded
            ? "answered"
            : "fallback";
      env.sessionId = effectiveSessionId;
      env.meta = {
        path:
          answerType === "clarification"
            ? "deterministic_clarification"
            : "deterministic_product_education",
        answer_strategy:
          deterministicGuidanceAnswer.answer_strategy || "source_summary",
        answer_grounded: Boolean(deterministicGuidanceAnswer.answer_grounded),
        answer_source_type:
          deterministicGuidanceAnswer.answer_source_type || "s3_product",
        answer_source_key: deterministicGuidanceAnswer.answer_source_key || null,
        resolved_requested_product_handle:
          deterministicGuidanceAnswer.resolved_requested_product_handle ||
          askSnoozerDecision.slots?.productHandle ||
          null,
        loaded_product_knowledge_handles: Array.isArray(
          deterministicGuidanceAnswer.loaded_product_knowledge_handles
        )
          ? deterministicGuidanceAnswer.loaded_product_knowledge_handles
          : [],
        answer_facts_count: Number(deterministicGuidanceAnswer.answer_facts_count || 0),
        matched_preview: deterministicGuidanceAnswer.matched_preview || "",
        extracted_facts: Array.isArray(deterministicGuidanceAnswer.extracted_facts)
          ? deterministicGuidanceAnswer.extracted_facts
          : [],
        reason: deterministicGuidanceAnswer.reason || "",
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType,
          sourceOfTruth:
            deterministicGuidanceAnswer.answer_source_type === "canonical_profile"
              ? "canonical_profile"
              : askSnoozerDecision.sourceOfTruth,
          factsResolved: Boolean(deterministicGuidanceAnswer.answer_grounded),
          fallbackUsed: false,
          reason: deterministicGuidanceAnswer.reason || "",
        }),
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      };

      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });

      logContractResponse(normalized);
      log("ask-snoozer.product-education", "answered", {
        traceId,
        sessionId: effectiveSessionId,
        shopperId,
        intent: deterministicGuidanceAnswer.classification?.intent || null,
        intentGroup: deterministicGuidanceAnswer.classification?.intent_group || null,
        answerStrategy: env.meta?.answer_strategy || null,
        answerSourceType: env.meta?.answer_source_type || null,
        answerSourceKey: env.meta?.answer_source_key || null,
        totalMs: latencyMs,
      });
      log("ask-snoozer.fulfillment.result", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth:
          deterministicGuidanceAnswer.answer_source_type === "canonical_profile"
            ? "canonical_profile"
            : askSnoozerDecision.sourceOfTruth,
        factsResolved: Boolean(deterministicGuidanceAnswer.answer_grounded),
        missingSlots: [],
        fallbackUsed: false,
        reason: deterministicGuidanceAnswer.reason || "",
        ...outcomeLogFields(env, deterministicGuidanceAnswer.reason || ""),
      });

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          payload,
          defaultSpeech: env.reply || env.message?.text || "I'm here.",
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    const deterministicCommerceAnswer =
      askSnoozerDecision.intentGroup === "product_education" &&
      queryExplicitlyRequestsAskSnoozerCommerce(msg)
        ? await maybeBuildAskSnoozerCommerceAnswer({
            query: msg,
            context,
            traceId,
            classification: askSnoozerDecision.classification || askSnoozerClassification,
          })
        : null;
    if (deterministicCommerceAnswer) {
      const latencyMs = Date.now() - startedAt;
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: "deterministic_commerce",
        text: deterministicCommerceAnswer.replyOverride || "",
        context: mergedContext,
        products: Array.isArray(deterministicCommerceAnswer.products)
          ? deterministicCommerceAnswer.products
          : [],
        actions: [],
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      });

      env.reply = deterministicCommerceAnswer.replyOverride || env.message?.text || "";
      env.thread_id = effectiveSessionId;
      env.status = "answered";
      env.sessionId = effectiveSessionId;
      env.meta = {
        path: "deterministic_commerce",
        source: {
          kind: "shopify",
          shopifyProducts: Array.isArray(deterministicCommerceAnswer.products)
            ? deterministicCommerceAnswer.products.length
            : 0,
        },
        source_label: "shopify",
        intent: deterministicCommerceAnswer.metaIntent || deterministicCommerceAnswer.classification?.intent || null,
        intent_group: deterministicCommerceAnswer.classification?.intent_group || null,
        policy_subtype: deterministicCommerceAnswer.classification?.policy_subtype || "",
        scope: deterministicCommerceAnswer.scope || null,
        requested_size: deterministicCommerceAnswer.requestedSize || null,
        resolved_product_handle: deterministicCommerceAnswer.resolvedProductHandle || null,
        resolved_base_handle: deterministicCommerceAnswer.resolvedBaseHandle || null,
        shopify_price_found: Boolean(deterministicCommerceAnswer.shopifyPriceFound),
        retrievalMs: 0,
        modelMs: 0,
        totalMs: latencyMs,
        fallbackUsed: false,
        ...(isObject(deterministicCommerceAnswer.metaExtra)
          ? deterministicCommerceAnswer.metaExtra
          : {}),
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType:
            String(
              deterministicCommerceAnswer?.metaExtra?.answer_strategy ||
                deterministicCommerceAnswer?.answer_strategy ||
                ""
            ).trim() === "needs_product_clarification"
              ? "clarification"
              : "product_answer",
          sourceOfTruth: askSnoozerDecision.sourceOfTruth,
          factsResolved: Boolean(
            deterministicCommerceAnswer?.metaExtra?.answer_grounded
          ),
          fallbackUsed: false,
          reason:
            deterministicCommerceAnswer?.metaExtra?.reason ||
            deterministicCommerceAnswer?.reason ||
            "",
        }),
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      };

      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });

      logContractResponse(normalized);
      log("ask-snoozer.commerce", "answered", {
        traceId,
        sessionId: effectiveSessionId,
        shopperId,
        intent: deterministicCommerceAnswer.metaIntent || deterministicCommerceAnswer.classification?.intent || null,
        intentGroup: deterministicCommerceAnswer.classification?.intent_group || null,
        scope: deterministicCommerceAnswer.scope || null,
        requestedSize: deterministicCommerceAnswer.requestedSize || null,
        answerStrategy: env.meta?.answer_strategy || null,
        answerSourceType: env.meta?.answer_source_type || null,
        answerSourceKey: env.meta?.answer_source_key || null,
        source: "shopify",
        fallbackUsed: false,
        handles: Array.isArray(deterministicCommerceAnswer.products)
          ? deterministicCommerceAnswer.products.map((product) => product.handle).filter(Boolean)
          : [],
        totalMs: latencyMs,
      });
      log("ask-snoozer.fulfillment.result", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: askSnoozerDecision.sourceOfTruth,
        factsResolved: Boolean(
          deterministicCommerceAnswer?.metaExtra?.answer_grounded
        ),
        missingSlots: [],
        fallbackUsed: false,
        reason:
          deterministicCommerceAnswer?.metaExtra?.reason ||
          deterministicCommerceAnswer?.reason ||
          "",
        ...outcomeLogFields(
          env,
          deterministicCommerceAnswer?.metaExtra?.reason ||
            deterministicCommerceAnswer?.reason ||
            ""
        ),
      });

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          payload,
          defaultSpeech: env.reply || env.message?.text || "I'm here.",
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    const deterministicFaqAnswer = await maybeBuildAskSnoozerDeterministicFaqAnswer({
      query: msg,
      context,
      traceId,
      shopperId,
    });
    if (deterministicFaqAnswer) {
      const latencyMs = Date.now() - startedAt;
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      const faqAnswerType =
        String(deterministicFaqAnswer.answer_type || "").trim() ||
        (askSnoozerDecision.intentGroup === "support"
          ? "support_guidance"
          : askSnoozerDecision.intentGroup === "session_guidance"
            ? "session_guidance"
            : "guided_faq");
      const faqSourceOfTruth =
        String(deterministicFaqAnswer.source_of_truth || "").trim() ||
        askSnoozerDecision.sourceOfTruth;
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: "deterministic_faq",
        text: deterministicFaqAnswer.reply || "",
        context: mergedContext,
        products: [],
        actions: [],
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      });

      env.reply = deterministicFaqAnswer.reply || env.message?.text || "";
      env.thread_id = effectiveSessionId;
      env.status = "completed";
      env.sessionId = effectiveSessionId;
      env.meta = {
        path: "atomic_deterministic",
        answer_strategy: deterministicFaqAnswer.answer_strategy || "safe_fallback",
        answer_grounded: Boolean(deterministicFaqAnswer.answer_grounded),
        answer_source_type: deterministicFaqAnswer.answer_source_type || "fallback",
        answer_source_key: deterministicFaqAnswer.answer_source_key || null,
        answer_facts_count: Number(deterministicFaqAnswer.answer_facts_count || 0),
        matched_preview: deterministicFaqAnswer.matched_preview || "",
        extracted_facts: Array.isArray(deterministicFaqAnswer.extracted_facts)
          ? deterministicFaqAnswer.extracted_facts
          : [],
        reason: deterministicFaqAnswer.reason || "",
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType: faqAnswerType,
          sourceOfTruth: faqSourceOfTruth,
          factsResolved: Boolean(deterministicFaqAnswer.answer_grounded),
          fallbackUsed: false,
          reason: deterministicFaqAnswer.reason || "",
        }),
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: false,
        },
      };

      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });

      logContractResponse(normalized);
      log("ask-snoozer.faq", "answered", {
        traceId,
        sessionId: effectiveSessionId,
        shopperId,
        intent: deterministicFaqAnswer.classification?.intent || null,
        intentGroup: deterministicFaqAnswer.classification?.intent_group || null,
        answerStrategy: env.meta?.answer_strategy || null,
        answerSourceType: env.meta?.answer_source_type || null,
        answerSourceKey: env.meta?.answer_source_key || null,
        totalMs: latencyMs,
      });
      log("ask-snoozer.fulfillment.result", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: faqSourceOfTruth,
        factsResolved: Boolean(deterministicFaqAnswer.answer_grounded),
        missingSlots: askSnoozerDecision.missingSlots,
        fallbackUsed: false,
        reason: deterministicFaqAnswer.reason || "",
        ...outcomeLogFields(env, deterministicFaqAnswer.reason || ""),
      });

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          payload,
          defaultSpeech: env.reply || env.message?.text || "I'm here.",
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    if (
      !askSnoozerDecision.shouldUseOpenAI ||
      ["/ask-snoozer", "/ask"].includes(routePath) ||
      String(mode || "").toLowerCase() === "ask_snoozer_page"
    ) {
      const latencyMs = Date.now() - startedAt;
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      const fallbackDeal = context?.askSnoozerWorkingMemory?.activeDeal || {};
      const fallbackHandle = String(
        fallbackDeal?.acceptedRecommendation?.productHandle ||
        fallbackDeal?.sessionRecommendation?.productHandle ||
        fallbackDeal?.activeProductHandle ||
        ""
      ).trim();
      let fallbackTitle = "";
      if (fallbackHandle && typeof loadShowroomManifest === "function") {
        const fallbackProduct = (loadShowroomManifest()?.products || []).find(
          (product) => String(product?.handle || "").trim() === fallbackHandle
        );
        fallbackTitle = String(fallbackProduct?.title || "").trim();
      }
      const fallbackSize = String(fallbackDeal?.activeSize || "").trim();
      const reply = fallbackTitle
        ? `I am still with you on the ${fallbackTitle}${fallbackSize ? ` in ${fallbackSize}` : ""}. I did not understand which part you want to change, so tell me whether you want to compare it, price it, or adjust the setup.`
        : buildAskSnoozerFallbackReply();
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: "grounded_safe_fallback",
        text: reply,
        context: mergedContext,
        products: [],
        actions: [],
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: true,
        },
      });

      env.reply = reply;
      env.thread_id = effectiveSessionId;
      env.status = "completed";
      env.sessionId = effectiveSessionId;
      env.meta = {
        path: "grounded_safe_fallback",
        answer_strategy: "safe_fallback",
        answer_grounded: Boolean(fallbackTitle),
        answer_source_type: "journey_state",
        answer_source_key: null,
        answer_facts_count: 0,
        matched_preview: "",
        extracted_facts: [],
        reason: "structured_pipeline_no_grounded_route",
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType: "fallback",
          sourceOfTruth: "journey_state",
          factsResolved: Boolean(fallbackTitle),
          fallbackUsed: true,
          reason: "structured_pipeline_no_grounded_route",
        }),
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: true,
        },
      };

      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });

      logContractResponse(normalized);
      log("ask-snoozer.fulfillment.result", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: "fallback",
        factsResolved: false,
        missingSlots: askSnoozerDecision.missingSlots,
        fallbackUsed: true,
        reason: "structured_pipeline_no_grounded_route",
        ...outcomeLogFields(env, "structured_pipeline_no_grounded_route"),
      });

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          payload,
          defaultSpeech: reply,
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    // 4) Call Snoozer
    try {
      const { getSnoozerResponse } = require("../services/openai");

      const modelStep = await measureStep("model_call", () =>
        withTimeout(
          getSnoozerResponse(msg, {
            reqId: traceId,
            thread_id: effectiveSessionId,
            mode,
            context,
            allowGeneralConversation:
              askSnoozerDecision.protectedTruthRequired === false,
          }),
          MODEL_TIMEOUT_MS,
          "OPENAI_TIMEOUT",
          `Model exceeded ${MODEL_TIMEOUT_MS}ms`,
          { sessionId: effectiveSessionId, mode }
        )
      );

      const modelMs = modelStep.ms;
      const latencyMs = Date.now() - startedAt;

      if (!modelStep.ok) throw modelStep.error;

      const aiResult = modelStep.value;
      const aiMetrics = isObject(aiResult?.meta?.metrics) ? aiResult.meta.metrics : null;
      const fallbackUsed = Boolean(
        aiMetrics?.fallbackUsed ??
          aiResult?.meta?.fallbackUsed
      );

      // 5) Persist contextPatch into SCO
      const rawPatch =
        aiResult?.contextPatch && typeof aiResult.contextPatch === "object"
          ? aiResult.contextPatch
          : null;

      const patch = rawPatch ? normalizeContextPatch(rawPatch, aiResult) : null;
      if (patch && Object.prototype.hasOwnProperty.call(patch, "askSnoozerWorkingMemory")) {
        delete patch.askSnoozerWorkingMemory;
      }

      if (patch && sco && typeof sco === "object") {
        try {
          const merged = deepMerge(sco, patch);
          await saveSessionContext(effectiveSessionId, merged);
          sco = merged;
          log("session.autosave", "patched", { traceId, effectiveSessionId });
        } catch (e) {
          log("session.autosave.error", e.message, { traceId, effectiveSessionId });
        }
      }

      let mergedContext = context;
      if (sco && typeof sco === "object") {
        mergedContext = deepMerge(sco, context);
      }
      if (aiResult && aiResult.context && typeof aiResult.context === "object") {
        mergedContext = deepMerge(mergedContext, aiResult.context);
      }

      const rawMessage = debug ? (aiResult?.raw || aiResult) : null;

      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: aiResult?.model,
        text: aiResult?.text || aiResult?.reply || "",
        rawMessage,
        tokens: aiResult?.tokens,
        products: aiResult?.products || aiResult?.data?.products || [],
        context: mergedContext,
        actions: aiResult?.actions || aiResult?.suggestedActions || [],
        s3Prompts: debug ? aiResult?.s3Prompts || [] : [],
      });

      env.reply = aiResult?.reply || env.message?.text || "";
      env.thread_id = aiResult?.thread_id || effectiveSessionId;
      env.status = aiResult?.status || "completed";
      env.meta = {
        ...(aiResult?.meta || {}),
        path: "legacy_path",
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType: "fallback",
          sourceOfTruth: "openai",
          factsResolved: false,
          fallbackUsed,
          reason: fallbackUsed ? "openai_fallback" : "openai",
        }),
        retrievalMs: safeNumber(aiMetrics?.retrievalMs ?? aiResult?.meta?.retrievalMs, 0),
        modelMs,
        totalMs: latencyMs,
        fallbackUsed,
        metrics: {
          retrievalMs: safeNumber(aiMetrics?.retrievalMs ?? aiResult?.meta?.retrievalMs, 0),
          modelMs,
          totalMs: latencyMs,
          fallbackUsed,
        },
      };

      if (aiResult?.cartId) env.cartId = aiResult.cartId;
      if (aiResult?.checkoutUrl) env.checkoutUrl = aiResult.checkoutUrl;
      if (patch) env.contextPatch = patch;

      if (aiResult?.hud && typeof aiResult.hud === "object") {
        env.hud = {
          scriptKey:
            typeof aiResult.hud.scriptKey === "string" ? aiResult.hud.scriptKey : undefined,
          speech: typeof aiResult.hud.speech === "string" ? aiResult.hud.speech : undefined,
          captions: typeof aiResult.hud.captions === "string" ? aiResult.hud.captions : undefined,
          state: normalizeHudStateValue(aiResult.hud.state, "speaking"),
          priority: normalizeHudPriorityValue(aiResult.hud.priority, "normal"),
          ttlMs:
            Number.isFinite(Number(aiResult.hud.ttlMs)) && Number(aiResult.hud.ttlMs) > 0
              ? Number(aiResult.hud.ttlMs)
              : undefined,
          voiceStyle: normalizeHudVoiceStyleValue(aiResult.hud.voiceStyle, "default"),
          actions: Array.isArray(aiResult.hud.actions) ? aiResult.hud.actions : undefined,
        };
      }

      env.sessionId = effectiveSessionId;

      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });

      logContractResponse(normalized);

      log("ask-snoozer.metrics", "completed", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        mode,
        intentGroup: askSnoozerDecision.intentGroup,
        answerPath: env.meta?.path || "model",
        sourceOfTruth: "openai",
        retrievalMs: env.meta?.metrics?.retrievalMs || 0,
        modelMs,
        totalMs: latencyMs,
        fallbackUsed,
        timeoutMs: MODEL_TIMEOUT_MS,
        path: env.meta?.path || null,
      });
      log("ask-snoozer.fulfillment.result", "resolved", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        intentGroup: askSnoozerDecision.intentGroup,
        intent: askSnoozerDecision.intent,
        confidence: askSnoozerDecision.confidence,
        slots: askSnoozerDecision.slots,
        sourceOfTruth: "openai",
        factsResolved: false,
        missingSlots: askSnoozerDecision.missingSlots,
        fallbackUsed,
        failureReason: fallbackUsed ? "openai_fallback" : null,
        reason: fallbackUsed ? "openai_fallback" : "openai",
        ...outcomeLogFields(env, fallbackUsed ? "openai_fallback" : ""),
      });

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context: mergedContext,
          aiResult,
          payload,
          defaultSpeech: env.reply || env.message?.text || "I'm here.",
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      log("ask-snoozer.error", err.message, { traceId, stack: err.stack });

      const isTimeout = isTimeoutError(err);

      const errorBody = buildErrorResponse({
        requestId: traceId,
        latencyMs,
        context: { shopperId, sessionId: effectiveSessionId },
        code: isTimeout ? "OPENAI_TIMEOUT" : "ASK_SNOOZER_FAILED",
        message: isTimeout
          ? "Snoozer is thinking too hard right now. Try again."
          : "Snoozer had trouble responding. Please try again.",
        details: process.env.NODE_ENV === "production" ? undefined : err.message,
      });

      const normalized = normalizeSnoozerResponse(
        {
          ...errorBody,
          ok: false,
          status: "error",
          sessionId: effectiveSessionId,
          reply: isTimeout
            ? "Snoozer is thinking too hard right now. Try again."
            : "Snoozer had trouble responding. Please try again.",
          error: {
            code: isTimeout ? "OPENAI_TIMEOUT" : "ASK_SNOOZER_FAILED",
            message: String(err.message || err),
          },
          meta: {
            ...(errorBody.meta || {}),
            path: "grounded_safe_fallback",
            qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
              answerType: "fallback",
              sourceOfTruth: "fallback",
              factsResolved: false,
              fallbackUsed: true,
              reason: isTimeout ? "timeout_fallback" : "ask_snoozer_failed",
            }),
            metrics: {
              retrievalMs: 0,
              modelMs: isTimeout ? MODEL_TIMEOUT_MS : 0,
              totalMs: latencyMs,
              fallbackUsed: true,
            },
          },
        },
        {
          traceId,
          sessionId: effectiveSessionId,
          routePath,
          startedAtMs: startedAt,
          debug: isDebugRequest(event),
        }
      );

      logContractResponse(normalized);

      log("ask-snoozer.metrics", "fallback", {
        traceId,
        shopperId: shopperId || null,
        sessionId: effectiveSessionId,
        mode,
        intentGroup: askSnoozerDecision.intentGroup,
        answerPath: "grounded_safe_fallback",
        sourceOfTruth: "fallback",
        retrievalMs: 0,
        modelMs: isTimeout ? MODEL_TIMEOUT_MS : 0,
        totalMs: latencyMs,
        fallbackUsed: true,
        failureReason: isTimeout ? "timeout_fallback" : "ask_snoozer_failed",
        timeoutMs: isTimeout ? MODEL_TIMEOUT_MS : null,
        path: "grounded_safe_fallback",
      });
      if (isTimeout) {
        log("ask-snoozer.timeout.fallback", "timeout_fallback", {
          traceId,
          shopperId: shopperId || null,
          sessionId: effectiveSessionId,
          intentGroup: askSnoozerDecision.intentGroup,
          intent: askSnoozerDecision.intent,
          confidence: askSnoozerDecision.confidence,
          slots: askSnoozerDecision.slots,
          sourceOfTruth: "fallback",
          factsResolved: false,
          missingSlots: askSnoozerDecision.missingSlots,
          fallbackUsed: true,
          reason: "timeout_fallback",
        });
      }

      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: false,
          mode,
          context: { shopperId, sessionId: effectiveSessionId },
          payload,
          defaultSpeech: isTimeout
            ? "Snoozer is thinking too hard right now. Try again."
            : "Snoozer had trouble responding. Please try again.",
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }

      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ CRM


  return null;
}

module.exports = {
  handleAskSnoozerRoutes,
};
