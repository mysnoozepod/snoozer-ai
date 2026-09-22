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
    resolveAskSnoozerSemanticAuthority,
    buildDeterministicAtomicDecision,
    resolvePendingCommitmentProtocol,
    shouldPlanAskSnoozerWithModel,
    planTrustedAdvisorTurnWithModel,
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
    saveSessionContext,
    buildSuccessResponse,
    resolveAskSnoozerCommerceResponse,
    resolveAskSnoozerStationResponse,
    buildShowroomCommandDecision,
    validateShowroomCommand,
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
    buildAskSnoozerAtomicCompatibilityAnswer,
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

    const commandSupplied = Object.prototype.hasOwnProperty.call(payload || {}, "command");
    let showroomCommandValidation = null;
    let showroomCommand = null;
    let typedCommandEventLogged = false;
    const logTypedCommand = ({ valid = true, validationReason = null, fallbackUsed = false, executionPath = null } = {}) => {
      if (typedCommandEventLogged) return;
      typedCommandEventLogged = true;
      log("ask-snoozer.typed-command", valid ? "executed" : "rejected", {
        traceId,
        testCaseId,
        sessionId: effectiveSessionId,
        commandVersion: showroomCommandValidation?.commandVersion || String(payload?.command?.version || "").trim() || null,
        commandType: showroomCommandValidation?.commandType || String(payload?.command?.type || "").trim() || null,
        valid,
        semanticAuthority: "typed_showroom_action",
        executionPath: executionPath || showroomCommandValidation?.executionPath || "validation",
        plannerBypassed: true,
        fallbackUsed: Boolean(fallbackUsed),
        productHandleCount: Number(showroomCommandValidation?.productHandleCount || 0),
        ...(validationReason ? { validationReason } : {}),
      });
    };
    if (commandSupplied) {
      let commandManifest = null;
      try {
        commandManifest = typeof loadShowroomManifest === "function" ? loadShowroomManifest() : null;
      } catch {
        commandManifest = null;
      }
      showroomCommandValidation = typeof validateShowroomCommand === "function"
        ? validateShowroomCommand(payload.command, { manifest: commandManifest })
        : {
            ok: false,
            code: "E_INVALID_SHOWROOM_COMMAND",
            validationReason: "validator_unavailable",
            commandVersion: String(payload?.command?.version || "").trim() || null,
            commandType: String(payload?.command?.type || "").trim() || null,
            productHandleCount: 0,
          };
      if (!showroomCommandValidation?.ok) {
        logTypedCommand({
          valid: false,
          validationReason: showroomCommandValidation?.validationReason || "invalid_command",
          executionPath: "validation",
        });
        const errorBody = buildErrorResponse({
          requestId: traceId,
          latencyMs: Date.now() - startedAt,
          context: { shopperId, sessionId: effectiveSessionId },
          code: "E_INVALID_SHOWROOM_COMMAND",
          message: "The showroom action could not be validated.",
        });
        const normalized = normalizeSnoozerResponse(
          {
            ...errorBody,
            ok: false,
            status: "error",
            sessionId: effectiveSessionId,
            reply: "I could not validate that showroom action, so I stopped instead of guessing.",
            error: {
              code: "E_INVALID_SHOWROOM_COMMAND",
              message: "The showroom action could not be validated.",
            },
            meta: {
              path: "typed_showroom_action_validation",
              planning: {
                semanticAuthority: "typed_showroom_action",
                modelCallCount: 0,
                plannerModelCallCount: 0,
              },
            },
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
            defaultSpeech: normalized.reply,
            traceId,
          });
          return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
        }
        return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
      }
      showroomCommand = showroomCommandValidation.command;
    }

    if (!msg && !showroomCommand) {
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
          recommendationSnapshotId: context?.canonicalRecommendation?.snapshotId || null,
          recommendationSnapshotVersion: context?.canonicalRecommendation?.snapshotVersion || null,
          recommendationSource: context?.canonicalRecommendation?.source || "legacy_profile",
        });
      } catch (error) {
        log("active-journey.ask.error", error.code || error.message, { traceId, phase: "hydrate" });
      }
    }

    let askSnoozerPlan = null;
    let askSnoozerModelPlanning = {
      used: false,
      fallbackUsed: false,
      modelCallCount: 0,
      modelMs: 0,
      model: null,
      decision: null,
      authority: null,
      errorCode: null,
      semanticBoundary: null,
    };
    const semanticBoundary = showroomCommand
      ? { mode: "typed_showroom_action", reason: "validated_showroom_command" }
      : typeof resolveAskSnoozerSemanticAuthority === "function"
        ? resolveAskSnoozerSemanticAuthority({ query: msg, context })
        : {
            mode: typeof shouldPlanAskSnoozerWithModel === "function" && shouldPlanAskSnoozerWithModel({ query: msg, context })
              ? "model_semantics"
              : "deterministic_atomic",
            reason: "compatibility_boundary",
          };
    askSnoozerModelPlanning.semanticBoundary = semanticBoundary;
    askSnoozerModelPlanning.authority = semanticBoundary.mode;
    const deterministicAtomicDecision = !showroomCommand && semanticBoundary.mode === "deterministic_atomic"
      ? typeof buildDeterministicAtomicDecision === "function"
        ? buildDeterministicAtomicDecision({
            reason: semanticBoundary.reason,
            query: msg,
            context,
          })
        : null
      : null;
    const commitmentDecision = !showroomCommand && typeof resolvePendingCommitmentProtocol === "function"
      ? resolvePendingCommitmentProtocol({ query: msg, context })
      : null;
    if (showroomCommand) {
      const commandDecision = typeof buildShowroomCommandDecision === "function"
        ? buildShowroomCommandDecision(showroomCommand)
        : null;
      askSnoozerModelPlanning.decision = commandDecision;
      askSnoozerModelPlanning.authority = "typed_showroom_action";
      log("ask-snoozer.semantic-plan", "typed_showroom_action", {
        traceId,
        testCaseId,
        commandType: showroomCommand.type,
        primaryTask: commandDecision?.primaryTask || null,
        productHandles: (commandDecision?.productReferences || []).map((reference) => reference.handle),
        requestedFacts: commandDecision?.requestedFacts || [],
      });
    } else if (commitmentDecision) {
      askSnoozerModelPlanning.decision = commitmentDecision;
      askSnoozerModelPlanning.authority = commitmentDecision.authority;
      log("ask-snoozer.semantic-plan", "typed_commitment", {
        traceId,
        testCaseId,
        primaryTask: commitmentDecision.primaryTask,
        interpretedActs: commitmentDecision.acts.map((act) => act.type),
        commitmentType: commitmentDecision.acts[0]?.commitmentType || null,
      });
    } else if (
      semanticBoundary.mode === "model_semantics" &&
      typeof planTrustedAdvisorTurnWithModel === "function"
    ) {
      const plannerStartedAt = Date.now();
      askSnoozerModelPlanning.used = true;
      askSnoozerModelPlanning.modelCallCount = 1;
      try {
        const planned = await planTrustedAdvisorTurnWithModel({
          requestId: `${traceId}_planner`,
          query: msg,
          context,
        });
        if (!planned?.decision?.primaryTask || planned.decision.authority !== "model_semantics") {
          const invalidDecision = new Error("Advisor planner returned no validated semantic task.");
          invalidDecision.code = "E_ADVISOR_PLANNER_DECISION";
          throw invalidDecision;
        }
        askSnoozerModelPlanning = {
          ...askSnoozerModelPlanning,
          modelMs: Number(planned?.modelMs || Date.now() - plannerStartedAt),
          model: planned?.model || null,
          decision: planned?.decision || null,
          authority: planned?.decision?.authority || "model_semantics",
        };
        log("ask-snoozer.model-planner", "resolved", {
          traceId,
          testCaseId,
          model: askSnoozerModelPlanning.model,
          modelMs: askSnoozerModelPlanning.modelMs,
          primaryTask: planned?.decision?.primaryTask || null,
          requestedFacts: planned?.decision?.requestedFacts || [],
          productHandles: (planned?.decision?.productReferences || []).map((reference) => reference.handle),
          interpretedActs: (planned?.decision?.acts || []).map((act) => act.type),
          modality: planned?.decision?.modality || null,
          validation: planned?.decision?.validation || null,
          inputChars: Number(planned?.inputChars || 0),
        });
      } catch (error) {
        askSnoozerModelPlanning.fallbackUsed = true;
        askSnoozerModelPlanning.modelMs = Date.now() - plannerStartedAt;
        askSnoozerModelPlanning.errorCode = error?.code || "E_ADVISOR_PLANNER";
        askSnoozerModelPlanning.authority = "model_failed";
        askSnoozerModelPlanning.decision = {
          authority: "model_failed",
          primaryTask: null,
          shopperGoal: null,
          modality: "asserted",
          acts: [],
          productReferences: [],
          comparisonProductHandles: [],
          requestedFacts: [],
          answerRequirements: [],
          requiresComposition: false,
          confidence: null,
          validation: { source: "model_failed", errorCode: askSnoozerModelPlanning.errorCode },
        };
        log("ask-snoozer.model-planner", "fallback", {
          traceId,
          testCaseId,
          modelMs: askSnoozerModelPlanning.modelMs,
          errorCode: askSnoozerModelPlanning.errorCode,
        });
      }
    } else if (!commitmentDecision) {
      askSnoozerModelPlanning.decision = deterministicAtomicDecision || {
        authority: "deterministic_atomic",
        primaryTask: null,
        shopperGoal: null,
        modality: "asserted",
        acts: [],
        productReferences: [],
        comparisonProductHandles: [],
        requestedFacts: [],
        answerRequirements: [],
        requiresComposition: false,
        confidence: 1,
        validation: { source: "deterministic_atomic", reason: semanticBoundary.reason },
      };
    }
    log("ask-snoozer.semantic-authority", "resolved", {
      traceId,
      testCaseId,
      semanticAuthority: askSnoozerModelPlanning.authority,
      authorityReason: semanticBoundary.reason || null,
      plannerModelCallCount: Number(askSnoozerModelPlanning.modelCallCount || 0),
      typedCommand: Boolean(showroomCommand),
      atomicReason: semanticBoundary.mode === "deterministic_atomic" ? semanticBoundary.reason || null : null,
      fallbackUsed: Boolean(askSnoozerModelPlanning.fallbackUsed),
    });
    if (typeof applyAskSnoozerWorkingMemory === "function") {
      const preTurnReferenceContext = context;
      context = applyAskSnoozerWorkingMemory({
        query: msg,
        context,
        modelDecision: askSnoozerModelPlanning.decision,
      });
      if (typeof planAskSnoozerTurn === "function") {
        askSnoozerPlan = planAskSnoozerTurn({
          query: msg,
          context,
          referenceContext: preTurnReferenceContext,
          modelDecision: askSnoozerModelPlanning.decision,
        });
        askSnoozerPlan.modelPlanning = askSnoozerModelPlanning;
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

    const modelSemanticTurn = ["model_semantics", "model_failed"].includes(askSnoozerModelPlanning.authority);
    const askSnoozerClassification = showroomCommand
      ? {
          intent: showroomCommand.type,
          intent_group: "typed_showroom_action",
          confidence: 1,
          source_of_truth: "typed_showroom_action",
        }
      : modelSemanticTurn
      ? {
          intent: askSnoozerPlan?.taskType || askSnoozerModelPlanning?.decision?.primaryTask || "model_only_unresolved",
          intent_group: "model_led",
          confidence: askSnoozerModelPlanning?.decision?.confidence || null,
          source_of_truth: askSnoozerModelPlanning.authority,
        }
        : deterministicAtomicDecision?.routeDecision?.classification || {
            intent: semanticBoundary.reason || "deterministic_atomic",
            intent_group: "deterministic_atomic",
            confidence: 1,
            source_of_truth: "deterministic_atomic",
          };
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
        responsePath: metadata?.answerPath || metadata?.path || "grounded_safe_fallback",
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

    const typedStationCommand = Boolean(
      showroomCommand &&
      ["find_rewards", "analyze_cart", "browse_products", "compare_products", "motion_base_features"]
        .includes(showroomCommand.type)
    );
    const atomicStationIntent = !showroomCommand && semanticBoundary.reason === "cart_view"
      ? "analyze_cart"
      : !showroomCommand && semanticBoundary.reason === "station_starter"
        ? deterministicAtomicDecision?.knownFacts?.stationIntent || null
        : null;
    const atomicStationCompatibility = !showroomCommand && semanticBoundary.reason === "station_starter";
    const deterministicCompatibilityReason = !showroomCommand && new Set([
      "cart_view",
      "checkout_command",
      "exact_price_lookup",
      "session_guidance",
      "session_support",
      "station_starter",
    ]).has(semanticBoundary.reason);

    // Every turn is planned before routing. Nuanced continued turns use the
    // trusted-advisor composer; only clean station starters fall through.
    const advisorAnswer =
      askSnoozerPlan?.handled &&
      !typedStationCommand &&
      !deterministicCompatibilityReason &&
      typeof resolveAskSnoozerAdvisorTurn === "function"
        ? await resolveAskSnoozerAdvisorTurn({
            query: showroomCommand ? "" : msg,
            context,
            plan: askSnoozerPlan,
            fetchProductsByHandles: shopifySvc?.fetchProductsByHandles,
            composeAdvisorResponse: composeTrustedAdvisorResponse,
            loadAdvisorKnowledge: loadTrustedAdvisorFactPack,
            identity: askIdentity,
            rewardsService: rewardProgramService,
            requestId: traceId,
          })
        : null;
    if (advisorAnswer) {
      for (const fact of advisorAnswer.factPack?.policyFacts || []) {
        log("ask-snoozer.truth-lane", "resolved", {
          traceId,
          testCaseId,
          sessionId: effectiveSessionId,
          truthLane: "policy",
          requestedFact: fact.topic || fact.type || null,
          resolved: Boolean(fact.known),
          sourceKind: fact.sourceKind || "unknown",
          sourceKey: fact.sourceKey || null,
          sourcePriority: fact.sourcePriority ?? 4,
          conflictDetected: Boolean(fact.conflictDetected),
          fallbackUsed: Boolean(fact.fallbackUsed),
        });
      }
      if (advisorAnswer.factPack?.rewardFacts) {
        const fact = advisorAnswer.factPack.rewardFacts;
        log("ask-snoozer.truth-lane", "resolved", {
          traceId,
          testCaseId,
          sessionId: effectiveSessionId,
          truthLane: "rewards",
          requestedFact: "rewards",
          resolved: Boolean(fact.known),
          sourceKind: fact.sourceKind || "rewards_repository_and_active_rules",
          sourceKey: fact.sourceKey || null,
          sourcePriority: fact.sourcePriority ?? 1,
          conflictDetected: false,
          fallbackUsed: Boolean(fact.fallbackUsed),
          activeRulesVersion: fact.activeRulesVersion || null,
          summaryResolved: Boolean(fact.summaryResolved),
          offersResolved: Boolean(fact.offersResolved),
        });
      }
      for (const fact of advisorAnswer.factPack?.durabilityFacts || []) {
        log("ask-snoozer.truth-lane", "resolved", {
          traceId,
          testCaseId,
          sessionId: effectiveSessionId,
          truthLane: "durability",
          requestedFact: "durability",
          resolved: Boolean(fact.known),
          sourceKind: fact.sourceKind || "unknown",
          sourceKey: fact.sourceKey || null,
          sourcePriority: fact.sourcePriority ?? 4,
          conflictDetected: false,
          fallbackUsed: Boolean(fact.fallbackUsed),
          exactLifespanKnown: Boolean(fact.exactLifespanKnown),
          exactSaggingTimelineKnown: Boolean(fact.exactSaggingTimelineKnown),
        });
      }
      for (const product of advisorAnswer.products || []) {
        log("ask-snoozer.truth-lane", "resolved", {
          traceId,
          testCaseId,
          sessionId: effectiveSessionId,
          truthLane: "product_card_pricing",
          requestedFact: "price",
          resolved: product.pricingMode !== "unresolved",
          sourceKind: "shopify_variant",
          sourceKey: product.handle || null,
          sourcePriority: 1,
          conflictDetected: false,
          fallbackUsed: false,
          handle: product.handle || null,
          activeSize: product.activeSize || null,
          pricingMode: product.pricingMode || "unresolved",
          exactVariantResolved: Boolean(product.exactVariantResolved),
          variantIdPresent: Boolean(product.variantId || product.merchandiseId),
          availabilityResolved: Boolean(product.availabilityResolved),
        });
      }
      if (typeof completeAskSnoozerAdvisorTurn === "function") {
        context = completeAskSnoozerAdvisorTurn(context, advisorAnswer);
      }
      await commitActiveJourneyFromAskContext("advisor_completion");
      const latencyMs = Date.now() - startedAt;
      const totalModelCallCount = Number(advisorAnswer.modelCallCount || 0) + Number(askSnoozerModelPlanning.modelCallCount || 0);
      const totalModelMs = Number(advisorAnswer.modelMs || 0) + Number(askSnoozerModelPlanning.modelMs || 0);
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
          modelMs: totalModelMs,
          totalMs: latencyMs,
          fallbackUsed: Boolean(advisorAnswer.fallbackUsed),
          modelCallCount: totalModelCallCount,
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
            modelCallCount: totalModelCallCount,
            totalMs: latencyMs,
            modelMs: totalModelMs,
            factPackComplete: (advisorAnswer.plan.neededFacts || []).length === 0,
            factPack: advisorAnswer.factPack,
            modelInputChars: advisorAnswer.modelInputChars,
            modelInputTokens: advisorAnswer.modelInputTokens,
            modelSystemChars: advisorAnswer.modelSystemChars,
            modelPayloadChars: advisorAnswer.modelPayloadChars,
            modelFactPackChars: advisorAnswer.modelFactPackChars,
            modelTimeoutMs: advisorAnswer.modelTimeoutMs,
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
          inputTokens: advisorAnswer.modelInputTokens || 0,
          systemChars: advisorAnswer.modelSystemChars || 0,
          payloadChars: advisorAnswer.modelPayloadChars || 0,
          factPackChars: advisorAnswer.modelFactPackChars || advisorAnswer.factPack?.budget?.totalChars || 0,
          timeoutMs: advisorAnswer.modelTimeoutMs || 0,
          factPackBudget: advisorAnswer.factPack?.composerBudget || advisorAnswer.factPack?.budget || null,
        },
        planning: {
          mode: askSnoozerModelPlanning.used
            ? askSnoozerModelPlanning.fallbackUsed
              ? "model_fallback"
              : "model_planned"
            : "deterministic",
          modelCallCount: askSnoozerModelPlanning.modelCallCount,
          modelMs: askSnoozerModelPlanning.modelMs,
          model: askSnoozerModelPlanning.model,
          fallbackUsed: askSnoozerModelPlanning.fallbackUsed,
          errorCode: askSnoozerModelPlanning.errorCode,
          semanticAuthority: askSnoozerModelPlanning.authority,
          semanticBoundary: askSnoozerModelPlanning.semanticBoundary,
          requestedFacts: advisorAnswer.plan.requestedFacts || [],
          answerRequirements: advisorAnswer.plan.answerRequirements || [],
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
          modelMs: totalModelMs,
          totalMs: latencyMs,
          fallbackUsed: Boolean(advisorAnswer.fallbackUsed),
          modelCallCount: totalModelCallCount,
          plannerModelCallCount: askSnoozerModelPlanning.modelCallCount || 0,
          plannerModelMs: askSnoozerModelPlanning.modelMs || 0,
          modelInputChars: advisorAnswer.modelInputChars || 0,
          factPackChars: advisorAnswer.modelFactPackChars || advisorAnswer.factPack?.budget?.totalChars || 0,
          fallbackKind: advisorAnswer.fallbackKind || null,
          responseValidationMs,
        },
      };
      if (showroomCommand) {
        logTypedCommand({
          valid: true,
          fallbackUsed: Boolean(advisorAnswer.fallbackUsed),
          executionPath: showroomCommandValidation?.executionPath || "advisor_truth_lane",
        });
      }
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
        modelMs: totalModelMs,
        modelCallCount: totalModelCallCount,
        plannerMode: askSnoozerModelPlanning.used
          ? askSnoozerModelPlanning.fallbackUsed
            ? "model_fallback"
            : "model_planned"
          : "deterministic",
        plannerModelMs: askSnoozerModelPlanning.modelMs || 0,
        plannerModelCallCount: askSnoozerModelPlanning.modelCallCount || 0,
        plannerRequestedFacts: advisorAnswer.plan.requestedFacts || [],
        compositionMode: advisorAnswer.compositionMode,
        responsePath: advisorAnswer.responsePath,
        compositionFallbackUsed: Boolean(advisorAnswer.compositionFallbackUsed),
        fallbackKind: advisorAnswer.fallbackKind || null,
        modelInputChars: advisorAnswer.modelInputChars || 0,
        modelInputTokens: advisorAnswer.modelInputTokens || 0,
        modelSystemChars: advisorAnswer.modelSystemChars || 0,
        modelPayloadChars: advisorAnswer.modelPayloadChars || 0,
        modelFactPackChars: advisorAnswer.modelFactPackChars || 0,
        modelTimeoutMs: advisorAnswer.modelTimeoutMs || 0,
        factPackBudget: advisorAnswer.factPack?.composerBudget || advisorAnswer.factPack?.budget || null,
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
      (
        typedStationCommand ||
        atomicStationIntent ||
        atomicStationCompatibility ||
        String(mode || "").toLowerCase() === "ask_snoozer_page"
      ) &&
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
        explicitIntent: typedStationCommand ? showroomCommand.type : atomicStationIntent,
        commandPayload: typedStationCommand ? showroomCommand.payload : null,
        context,
        identity: askIdentity,
        rewardsService: rewardProgramService,
        shopify: shopifySvc,
        manifest: stationManifest,
        fetchProductsByHandles: shopifySvc?.fetchProductsByHandles,
      });

      const atomicStationIntents = new Set(["find_rewards", "analyze_cart", "browse_products"]);
      if (
        stationAnswer &&
        (
          typedStationCommand ||
          atomicStationIntent ||
          atomicStationCompatibility ||
          atomicStationIntents.has(stationAnswer.intent)
        )
      ) {
        if (stationAnswer.intent === "find_rewards") {
          const summary = stationAnswer.contextPatch?.rewards?.summary || null;
          log("ask-snoozer.truth-lane", "resolved", {
            traceId,
            testCaseId,
            sessionId: effectiveSessionId,
            truthLane: "rewards",
            requestedFact: "rewards",
            resolved: Boolean(summary),
            sourceKind: "rewards_repository_and_active_rules",
            sourceKey: summary?.activeRulesVersion || null,
            sourcePriority: 1,
            conflictDetected: false,
            fallbackUsed: Boolean(stationAnswer.fallbackUsed),
            activeRulesVersion: summary?.activeRulesVersion || null,
            summaryResolved: Boolean(summary),
            offersResolved: Array.isArray(stationAnswer.contextPatch?.rewards?.offers),
          });
        }
        for (const product of stationAnswer.products || []) {
          log("ask-snoozer.truth-lane", "resolved", {
            traceId,
            testCaseId,
            sessionId: effectiveSessionId,
            truthLane: "product_card_pricing",
            requestedFact: "price",
            resolved: product.pricingMode !== "unresolved",
            sourceKind: "shopify_variant",
            sourceKey: product.handle || null,
            sourcePriority: 1,
            conflictDetected: false,
            fallbackUsed: false,
            handle: product.handle || null,
            activeSize: product.activeSize || null,
            pricingMode: product.pricingMode || "unresolved",
            exactVariantResolved: Boolean(product.exactVariantResolved),
            variantIdPresent: Boolean(product.variantId || product.merchandiseId),
            availabilityResolved: Boolean(product.availabilityResolved),
          });
        }
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
          path: typedStationCommand ? "typed_showroom_action" : "atomic_deterministic",
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
          planning: {
            mode: typedStationCommand ? "typed_showroom_action" : "deterministic",
            modelCallCount: 0,
            plannerModelCallCount: 0,
            modelMs: 0,
            fallbackUsed: false,
            semanticAuthority: typedStationCommand ? "typed_showroom_action" : askSnoozerModelPlanning.authority,
            semanticBoundary: askSnoozerModelPlanning.semanticBoundary,
          },
        };

        if (typedStationCommand) {
          logTypedCommand({
            valid: true,
            fallbackUsed: Boolean(stationAnswer.fallbackUsed),
            executionPath: showroomCommandValidation?.executionPath || "station_domain_service",
          });
        }

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

    if (
      askSnoozerModelPlanning.authority === "model_failed" ||
      askSnoozerModelPlanning.authority === "model_semantics"
    ) {
      const fallbackDeal = context?.askSnoozerWorkingMemory?.activeDeal || {};
      const currentHandle = String(
        fallbackDeal?.sessionRecommendation?.productHandle ||
        fallbackDeal?.acceptedRecommendation?.productHandle ||
        fallbackDeal?.activeProductHandle ||
        ""
      ).trim();
      let currentTitle = "";
      if (currentHandle && typeof loadShowroomManifest === "function") {
        currentTitle = String(
          loadShowroomManifest()?.products?.find((product) => String(product?.handle || "").trim() === currentHandle)?.title || ""
        ).trim();
      }
      const reason = askSnoozerModelPlanning.fallbackUsed
        ? "planner_error"
        : askSnoozerModelPlanning.used
          ? "unresolved_model_task"
          : "unhandled_model_only_turn";
      const reply = currentTitle
        ? `I want to make sure I act on the right request for the ${currentTitle}. Please rephrase what you want to compare, price, or change about the setup.`
        : "I want to make sure I act on the right request. Please rephrase what you want to compare, price, or change about the setup.";
      const latencyMs = Date.now() - startedAt;
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: "model_only_recovery",
        text: reply,
        context,
        products: [],
        actions: [],
        metrics: {
          retrievalMs: 0,
          modelMs: Number(askSnoozerModelPlanning.modelMs || 0),
          totalMs: latencyMs,
          fallbackUsed: true,
          modelCallCount: Number(askSnoozerModelPlanning.modelCallCount || 0),
        },
      });
      env.reply = reply;
      env.thread_id = effectiveSessionId;
      env.sessionId = effectiveSessionId;
      env.status = "completed_with_fallback";
      env.chips = [];
      env.meta = {
        path: "model_only_recovery",
        intent: askSnoozerClassification.intent,
        source: askSnoozerModelPlanning.authority,
        reason,
        semanticAuthority: askSnoozerModelPlanning.authority,
        planning: {
          mode: askSnoozerModelPlanning.fallbackUsed ? "model_fallback" : "model_planned",
          modelCallCount: askSnoozerModelPlanning.modelCallCount,
          modelMs: askSnoozerModelPlanning.modelMs,
          model: askSnoozerModelPlanning.model,
          fallbackUsed: askSnoozerModelPlanning.fallbackUsed,
          errorCode: askSnoozerModelPlanning.errorCode,
          semanticAuthority: askSnoozerModelPlanning.authority,
          requestedFacts: askSnoozerPlan?.requestedFacts || [],
          answerRequirements: askSnoozerPlan?.answerRequirements || [],
        },
        qualityGate: {
          intent: askSnoozerClassification.intent,
          intentGroup: "model_led",
          sourceOfTruth: "model_semantics",
          answerType: "model_only_recovery",
          protectedTruthRequired: false,
          factsResolved: false,
          fallbackUsed: true,
          missingSlots: [],
          reason,
        },
        metrics: {
          retrievalMs: 0,
          modelMs: Number(askSnoozerModelPlanning.modelMs || 0),
          totalMs: latencyMs,
          fallbackUsed: true,
          modelCallCount: Number(askSnoozerModelPlanning.modelCallCount || 0),
        },
      };
      const normalized = normalizeSnoozerResponse(env, {
        traceId,
        sessionId: effectiveSessionId,
        routePath,
        startedAtMs: startedAt,
        debug,
      });
      log("ask-snoozer.semantic-cutover", "safe_recovery", {
        traceId,
        testCaseId,
        sessionId: effectiveSessionId,
        reason,
        rawPrimaryTask: askSnoozerModelPlanning?.decision?.validation?.rawPrimaryTask || null,
        acceptedPrimaryTask: askSnoozerModelPlanning?.decision?.primaryTask || null,
      });
      logContractResponse(normalized);
      if (wantHud) {
        const hud = await buildHudFromAny(normalized, {
          ok: normalized.ok,
          mode,
          context,
          payload,
          defaultSpeech: reply,
          traceId,
        });
        return flatResponse(event, 200, hud, { "X-Session-Id": effectiveSessionId });
      }
      return flatResponse(event, 200, normalized, { "X-Session-Id": effectiveSessionId });
    }

    const askSnoozerDecision = deterministicAtomicDecision?.routeDecision || {
      intentGroup: "fallback",
      intent: semanticBoundary.reason || "deterministic_atomic",
      confidence: 1,
      slots: {},
      missingSlots: [],
      sourceOfTruth: "deterministic_atomic",
      protectedTruthRequired: false,
      shouldUseOpenAI: false,
      shouldAskClarifyingQuestion: false,
      knowledgeKeys: [],
      classification: askSnoozerClassification,
      atomicReason: semanticBoundary.reason || "deterministic_atomic",
    };
    log("ask-snoozer.atomic-decision", "routed", {
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
      reason: askSnoozerDecision.atomicReason || semanticBoundary.reason || null,
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

    const isPolicySupportDecision =
      askSnoozerDecision.intentGroup === "policy" ||
      (
        askSnoozerDecision.intentGroup === "policy_support" &&
        clean(askSnoozerDecision.policySubtype || askSnoozerDecision.slots?.policySubtype || askSnoozerDecision.slots?.policy_subtype) !== "pricing"
      );

    if (isPolicySupportDecision) {
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
      log("ask-snoozer.truth-lane", "resolved", {
        traceId,
        testCaseId,
        sessionId: effectiveSessionId,
        truthLane: "policy",
        requestedFact: policy?.policySubtype || null,
        resolved: Boolean(policy?.answerGrounded),
        sourceKind: policy?.sourceKind || "unknown",
        sourceKey: policy?.key || null,
        sourcePriority: policy?.sourcePriority ?? 4,
        conflictDetected: Boolean(policy?.conflictDetected),
        fallbackUsed: Boolean(policy?.fallbackUsed || !policy?.answerGrounded),
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
      ["commerce", "policy", "policy_support"].includes(askSnoozerDecision.intentGroup)
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
            pricingMode:
              entry?.pricingMode ||
              entry?.product?.pricingMode ||
              (entry?.exactVariantResolved && entry?.variantId ? "exact_variant" : "unresolved"),
            priceLabel: entry?.priceLabel || entry?.product?.priceLabel || null,
            activeSize: entry?.activeSize || entry?.product?.activeSize || null,
            availabilityResolved: Boolean(entry?.availabilityResolved || entry?.product?.availabilityResolved),
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
    const deterministicFaqAnswer = await buildAskSnoozerAtomicCompatibilityAnswer({
      reason: askSnoozerDecision.atomicReason,
      context,
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
      const sessionGuidance = askSnoozerDecision.intentGroup === "session_guidance";
      const faqSourceOfTruth =
        sessionGuidance
          ? "session_prep"
          : String(deterministicFaqAnswer.source_of_truth || "").trim() ||
            askSnoozerDecision.sourceOfTruth;
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: sessionGuidance ? "deterministic_session_guidance" : "deterministic_faq",
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

    {
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

  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ CRM


  return null;
}

module.exports = {
  handleAskSnoozerRoutes,
};
