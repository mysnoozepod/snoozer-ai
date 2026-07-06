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
    flatResponse,
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
    safeUpsertCustomerProfile,
    logProfileRouteOutcome,
    safeUpsertIdentityAliases,
    maybeSyncProfileToZohoForInteraction,
    STRICT_POD_ANCHOR,
    routeAskSnoozerQuestion,
    maybeBuildAskSnoozerCanonicalAnswer,
    saveSessionContext,
    buildSuccessResponse,
    maybeBuildAskSnoozerDeterministicGuidanceAnswer,
    maybeBuildAskSnoozerCommerceAnswer,
    queryExplicitlyRequestsAskSnoozerCommerce,
    resolveAskSnoozerCommerceResponse,
    resolveAskSnoozerPolicyAnswer,
    buildAskSnoozerPolicyChips,
    buildAskSnoozerAction,
    buildAskSnoozerMissingAssessmentChips,
    buildAskSnoozerClarificationReply,
    buildAskSnoozerMissingRecommendationReply,
    buildAskSnoozerFallbackReply,
    buildAskSnoozerQualityGateObject,
    maybeBuildAskSnoozerDeterministicFaqAnswer,
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

  if (method === "POST" && (routePath === "/ask-snoozer" || routePath === "/ask")) {
    const startedAt = Date.now();
    const payload = safeJsonBody(event);

    const debug = isDebugRequest(event);

    const msg = payload.message || payload.prompt || payload.text || "";
    const mode = payload.mode || undefined;
    const effectiveSessionId = deriveEffectiveThreadId(event, payload);
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
    context.shopperId = shopperId;
    context.snoozeCode = askIdentity?.snoozeCode || context?.snoozeCode || null;
    context.accessCode = askIdentity?.accessCode || context?.accessCode || null;
    context.profileId = askIdentity?.profileId || context?.profileId || null;
    context.sessionId = effectiveSessionId;

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
    const askSnoozerClassification = buildAskSnoozerClassification(msg, context);
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

    const askProfileUpsertResult = await safeUpsertCustomerProfile(askProfilePatch, {
      traceId,
      route: "/ask-snoozer",
    });
    logProfileRouteOutcome("ask", askProfileUpsertResult, {
      traceId,
      route: "/ask-snoozer",
      shopperId: shopperId || null,
      sessionId: effectiveSessionId || null,
    });
    await safeUpsertIdentityAliases(
      askIdentity,
      {
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
      { traceId, route: "/ask-snoozer" }
    );
    await maybeSyncProfileToZohoForInteraction({
      channel: "ask",
      traceId,
      route: "/ask-snoozer",
      previousProfile: previousAskProfile,
      nextPatch: askProfilePatch,
      policyContext: {
        route: "/ask-snoozer",
        lastIntent: askSnoozerClassification?.intent || "",
        lastIntentGroup: askSnoozerClassification?.intent_group || "",
      },
    });

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
              "Pod mode is missing required context (podId + exploreContext). The UI must send the pod items so Snoozer can be deterministic.",
            error: {
              code: "E_POD_CONTEXT_MISSING",
              message: "Missing podId or exploreContext/explore array.",
              details: { hasPodId, hasExplore },
            },
            meta: {
              path: "deterministic",
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
          path: "deterministic",
        });

        if (wantHud) {
          const hud = await buildHudFromAny(normalized, {
            ok: false,
            mode,
            context,
            payload,
            defaultSpeech:
              "Pod mode is missing required context. The UI must send the pod items so Snoozer can stay deterministic.",
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
      shopperId: shopperId || null,
      sessionId: effectiveSessionId,
      intentGroup: askSnoozerDecision.intentGroup,
      intent: askSnoozerDecision.intent,
      confidence: askSnoozerDecision.confidence,
      sourceOfTruth: askSnoozerDecision.sourceOfTruth,
      shouldUseOpenAI: askSnoozerDecision.shouldUseOpenAI,
      shouldAskClarifyingQuestion: askSnoozerDecision.shouldAskClarifyingQuestion,
      reason: null,
    });
    log("ask-snoozer.slots.extracted", "slots", {
      traceId,
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
    });

    const canonicalAnswer = maybeBuildAskSnoozerCanonicalAnswer(msg, context);
    if (canonicalAnswer) {
      const latencyMs = Date.now() - startedAt;

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
        products: [],
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
        path: "deterministic",
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
          fallbackUsed: !policy?.retrieved,
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
          fallbackUsed: !policy?.retrieved,
          reason:
            policy?.reason ||
            (policy?.retrieved ? "approved_policy_detail_missing" : "policy_source_missing"),
        }),
        metrics: {
          retrievalMs: 0,
          modelMs: 0,
          totalMs: latencyMs,
          fallbackUsed: !policy?.retrieved,
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
        fallbackUsed: !policy?.retrieved,
        reason:
          policy?.reason ||
          (policy?.retrieved ? "approved_policy_detail_missing" : "policy_source_missing"),
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
        fallbackUsed: !policy?.retrieved,
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
      const latencyMs = Date.now() - startedAt;
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      const products = Array.isArray(commerceResolution?.products)
        ? commerceResolution.products.map((entry) => ({
            type: "product",
            label: entry?.title || entry?.handle || "",
            title: entry?.title || entry?.handle || "",
            handle: entry?.handle || "",
            href: entry?.href || "",
            product_id: String(entry?.product?.id || "").trim() || undefined,
            variant_id: entry?.variantId || undefined,
            variant_title: entry?.variantTitle || undefined,
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
        path: "deterministic",
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

    if (!askSnoozerDecision.shouldUseOpenAI) {
      const latencyMs = Date.now() - startedAt;
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
      const reply = buildAskSnoozerFallbackReply();
      const env = buildSuccessResponse({
        requestId: traceId,
        latencyMs,
        model: "deterministic_fallback",
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
        path: "deterministic_fallback",
        answer_strategy: "safe_fallback",
        answer_grounded: false,
        answer_source_type: "fallback",
        answer_source_key: null,
        answer_facts_count: 0,
        matched_preview: "",
        extracted_facts: [],
        reason: "fallback_guard",
        qualityGate: buildAskSnoozerQualityGateObject(askSnoozerDecision, {
          answerType: "fallback",
          sourceOfTruth: "fallback",
          factsResolved: false,
          fallbackUsed: false,
          reason: "fallback_guard",
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
        missingSlots: askSnoozerDecision.missingSlots,
        fallbackUsed: false,
        reason: "fallback_guard",
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
        sessionId: effectiveSessionId,
        mode,
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
        reason: fallbackUsed ? "openai_fallback" : "openai",
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
        sessionId: effectiveSessionId,
        mode,
        retrievalMs: 0,
        modelMs: isTimeout ? MODEL_TIMEOUT_MS : 0,
        totalMs: latencyMs,
        fallbackUsed: true,
        timeoutMs: isTimeout ? MODEL_TIMEOUT_MS : null,
        path: "fallback",
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
