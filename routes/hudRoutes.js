async function handleHudRoutes({ event, method, routePath, traceId, deps = {} }) {
  const {
    safeJsonBody,
    buildFallbackHud,
    flatResponse,
    getHudScriptPayload,
    isObject,
    measureStep,
    log,
    enforceHudContract,
    normalizeHudStateValue,
    normalizeHudPriorityValue,
    normalizeHudVoiceStyleValue,
    normalizeHudScriptKey,
    normalizeHudPageValue,
    normalizeHudEventValue,
    sanitizeHudAskPath,
    normalizeHudAskPageType,
    deriveEffectiveThreadId,
    safeResolveSnoozeIdentity,
    cleanIdentityValue,
    resolveCanonicalRecommendationContext,
    classifyAskSnoozerIntent,
    safeGetCustomerProfile,
    attachStoredProfileContext,
    resolveHudAskProducts,
    resolveHudAskCanonicalProducts,
    resolveHudAskAnswerStrategy,
    customerProfileService,
    buildIdentityProfilePatch,
    safeUpsertCustomerProfile,
    logProfileRouteOutcome,
    safeUpsertIdentityAliases,
    maybeSyncProfileToZohoForInteraction,
    buildHudAskPayload,
    elapsedMs,
    isCanonicalSnoozeIdentity,
    rawJsonResponse,
  } = deps;

  if (method === "POST" && routePath === "/hud/ask") {
    const startedAt = Date.now();
    const body = safeJsonBody(event);

    try {
      const query = typeof body?.query === "string" ? body.query.trim() : "";
      const pathValue = sanitizeHudAskPath(body?.path || "/");
      const pageType = normalizeHudAskPageType(body?.page_type || "unknown", pathValue);
      const surface =
        String(body?.surface || "shopify_header").trim().toLowerCase() || "shopify_header";
      const currentProductHandle =
        typeof body?.currentProductHandle === "string" ? body.currentProductHandle.trim() : "";
      const requestId = String(event?.requestContext?.requestId || traceId || "").trim() || null;

      console.log("[hud/ask] invoked", {
        path: pathValue,
        method,
        query,
        page_type: pageType,
        surface,
        currentProductHandle: currentProductHandle || null,
        requestId,
      });

      const threadId = deriveEffectiveThreadId(event, {
        thread_id: body?.thread_id,
        sessionId: body?.session_id,
      });
      const hudContext = isObject(body?.context) ? body.context : {};
      const incomingHudShopperId =
        String(body?.shopperId || body?.shopper_id || body?.context?.shopperId || "").trim() ||
        "";

      const hudIdentity = await safeResolveSnoozeIdentity(
        {
          shopperId: incomingHudShopperId,
          snoozeCode: body?.snoozeCode || body?.code || hudContext?.snoozeCode || "",
          accessCode: body?.accessCode || hudContext?.accessCode || "",
          sourceShopperId: body?.sourceShopperId || hudContext?.sourceShopperId || "",
          visitorId: body?.visitorId || hudContext?.visitorId || "",
          sessionId: threadId,
          threadId,
          context: hudContext,
          sourceSurface: surface,
          reason: "hud_ask",
        },
        { traceId, route: "/hud/ask" }
      );

      const shopperId = cleanIdentityValue(hudIdentity?.shopperId) || "";
      let canonicalRecommendation = null;
      try {
        canonicalRecommendation = await resolveCanonicalRecommendationContext({
          payload: body,
          context: hudContext,
          shopperId,
          sessionId: threadId,
          allowSessionLookup: Boolean(body?.thread_id || body?.session_id),
          source: "hud_ask",
          traceId,
        });
      } catch (error) {
        log("hud.ask.canonical.error", error.message, {
          traceId,
          threadId,
          shopperId: shopperId || null,
          code: error?.code || null,
        });
      }

      const classification = classifyAskSnoozerIntent(query, {
        path: pathValue,
        page_type: pageType,
        surface,
      });
      const intent = classification.intent;

      const previousHudProfileResult = await safeGetCustomerProfile(
        {
          profileId: hudIdentity?.profileId || undefined,
          shopperId: shopperId || undefined,
          sessionId: threadId || undefined,
          threadId: threadId || undefined,
        },
        { traceId, route: "/hud/ask" }
      );
      const previousHudProfile = previousHudProfileResult?.profile || null;

      const hudAnswerContext = attachStoredProfileContext(
        {
          ...hudContext,
          path: pathValue,
          page_type: pageType,
          pageType,
          surface,
          bookingStatus: body?.bookingStatus || hudContext?.bookingStatus || "",
        },
        previousHudProfile
      );

      if (!canonicalRecommendation && isObject(hudAnswerContext?.canonicalRecommendation)) {
        canonicalRecommendation = hudAnswerContext.canonicalRecommendation;
      }

      const productResolution = await resolveHudAskProducts({
        classification,
        intent,
        query,
        path: pathValue,
        pageType,
        traceId,
        currentProductHandle,
        canonicalRecommendation,
      });

      let products = Array.isArray(productResolution?.products) ? productResolution.products : [];
      if (!products.length && canonicalRecommendation) {
        const canonicalProducts = await resolveHudAskCanonicalProducts({
          canonicalRecommendation,
          intent,
          currentProductHandle:
            productResolution?.currentProductHandle || currentProductHandle || "",
          traceId,
        });
        if (canonicalProducts.length) {
          products = canonicalProducts;
        }
      }

      const answerStrategy = await resolveHudAskAnswerStrategy({
        classification,
        intent,
        query,
        path: pathValue,
        pageType,
        traceId,
        products,
        productResolution,
        canonicalRecommendation,
        context: hudAnswerContext,
      });

      const hudProfilePatch =
        customerProfileService &&
        typeof customerProfileService.buildHudProfilePatch === "function"
          ? customerProfileService.buildHudProfilePatch({
              previousProfile: previousHudProfile,
              ...buildIdentityProfilePatch(hudIdentity, {
                sourceShopperId:
                  body?.sourceShopperId ||
                  hudContext?.sourceShopperId ||
                  incomingHudShopperId,
                sessionId: threadId,
                threadId,
                visitorId: body?.visitorId || hudContext?.visitorId || "",
              }),
              shopperId,
              sessionId: threadId,
              threadId,
              sourceSurface: surface,
              lastIntent: intent,
              lastIntentGroup: classification.intent_group || "",
              query,
              path: pathValue,
              pageType,
              currentProductHandle:
                productResolution?.currentProductHandle || currentProductHandle || "",
              products,
              canonicalRecommendation,
              assessment: hudContext?.assessment || body?.assessment || body?.answers || null,
              customer: hudContext?.customer || null,
              email: body?.email || hudContext?.email || "",
              phone: body?.phone || hudContext?.phone || "",
              preferredName: body?.preferredName || hudContext?.preferredName || "",
              contactPreference: body?.contactPreference || hudContext?.contactPreference || "",
              consent: hudContext?.consent || null,
              leadStage: body?.leadStage || hudContext?.leadStage || "",
              bookingStatus: body?.bookingStatus || hudContext?.bookingStatus || "",
            })
          : {
              ...buildIdentityProfilePatch(hudIdentity, {
                sourceShopperId:
                  body?.sourceShopperId ||
                  hudContext?.sourceShopperId ||
                  incomingHudShopperId,
                sessionId: threadId,
                threadId,
                visitorId: body?.visitorId || hudContext?.visitorId || "",
              }),
              shopperId,
              sessionId: threadId,
              threadId,
              sourceSurface: surface,
              lastIntent: intent,
              lastIntentGroup: classification.intent_group || "",
              lastQuery: query,
              lastPath: pathValue,
              lastPageType: pageType,
              currentProductHandle:
                productResolution?.currentProductHandle || currentProductHandle || "",
              recommendedProductHandles: Array.isArray(products)
                ? products.map((product) => product?.handle).filter(Boolean)
                : [],
              canonicalRecommendation,
              assessment: hudContext?.assessment || body?.assessment || body?.answers || null,
              customer: hudContext?.customer || null,
              email: body?.email || hudContext?.email || "",
              phone: body?.phone || hudContext?.phone || "",
              preferredName: body?.preferredName || hudContext?.preferredName || "",
              contactPreference: body?.contactPreference || hudContext?.contactPreference || "",
              consent: hudContext?.consent || null,
              leadStage: body?.leadStage || hudContext?.leadStage || "",
              bookingStatus: body?.bookingStatus || hudContext?.bookingStatus || "",
            };

      const hudProfileUpsertResult = await safeUpsertCustomerProfile(hudProfilePatch, {
        traceId,
        route: "/hud/ask",
      });
      logProfileRouteOutcome("hud", hudProfileUpsertResult, {
        traceId,
        route: "/hud/ask",
        shopperId: shopperId || null,
        sessionId: threadId || null,
      });

      await safeUpsertIdentityAliases(
        hudIdentity,
        {
          sourceShopperId:
            body?.sourceShopperId || hudContext?.sourceShopperId || incomingHudShopperId,
          visitorId: body?.visitorId || hudContext?.visitorId || "",
          sessionId: threadId,
          threadId,
          sourceSurface: surface,
          lastIntent: intent,
          leadStage: hudProfilePatch?.leadStage || "",
        },
        { traceId, route: "/hud/ask" }
      );

      await maybeSyncProfileToZohoForInteraction({
        channel: "hud",
        traceId,
        route: "/hud/ask",
        previousProfile: previousHudProfile,
        nextPatch: hudProfilePatch,
        policyContext: {
          route: "/hud/ask",
          lastIntent: intent,
          lastIntentGroup: classification.intent_group || "",
        },
      });

      const payload = buildHudAskPayload({
        classification,
        intent,
        query,
        path: pathValue,
        pageType,
        latencyMs: elapsedMs(startedAt),
        threadId,
        products,
        replyOverride: answerStrategy?.replyOverride || "",
        chipsOverride: answerStrategy?.chipsOverride || null,
        metaExtra: {
          ...(answerStrategy?.metaExtra && typeof answerStrategy.metaExtra === "object"
            ? answerStrategy.metaExtra
            : {}),
          snooze_code_present: isCanonicalSnoozeIdentity(hudIdentity),
          identity_type: hudIdentity?.identityType || null,
          profile_id: hudIdentity?.profileId || null,
        },
        policySubtype: answerStrategy?.policySubtype || classification?.policy_subtype || "",
      });

      log("hud.ask", "ok", {
        traceId,
        threadId,
        shopperId: shopperId || null,
        intent,
        intentGroup: classification.intent_group || null,
        policySubtype: payload.policy_subtype || null,
        policySource: payload.meta?.policy_source || null,
        canonicalTopPodId: payload.meta?.canonical_top_pod_id || null,
        confidence: classification.confidence || null,
        confidenceLabel: classification.confidence_label || null,
        path: pathValue,
        pageType,
        surface,
        productCount: payload.products.length,
        latencyMs: payload.meta.latency_ms,
      });

      return rawJsonResponse(event, 200, payload);
    } catch (e) {
      const fallback = buildHudAskPayload({
        classification: {
          intent: "fallback",
          intent_group: "fallback_unclear",
          confidence: 0.42,
          confidence_label: "low",
        },
        intent: "fallback",
        query: typeof body?.query === "string" ? body.query.trim() : "",
        path: sanitizeHudAskPath(body?.path || "/"),
        pageType: normalizeHudAskPageType(body?.page_type || "unknown", body?.path || "/"),
        latencyMs: elapsedMs(startedAt),
        threadId: deriveEffectiveThreadId(event, {
          thread_id: body?.thread_id,
          sessionId: body?.session_id,
        }),
        error: "HUD_ASK_FALLBACK",
      });

      log("hud.ask.error", e.message, {
        traceId,
        latencyMs: fallback.meta.latency_ms,
      });

      return rawJsonResponse(event, 200, fallback);
    }
  }

  if (method === "POST" && routePath === "/hud/script") {
    const body = safeJsonBody(event);

    try {
      if (typeof getHudScriptPayload !== "function") {
        return flatResponse(
          event,
          200,
          buildFallbackHud({
            speech: "I'm here if you need me.",
            captions: "I'm here if you need me.",
          })
        );
      }

      const shopperId = body?.shopperId ? String(body.shopperId).trim() : "guest";
      const context = isObject(body?.context) ? body.context : {};
      const request = {
        page: body?.page || body?.hudPage,
        event: body?.event || body?.hudEvent,
        scriptKey: body?.scriptKey || body?.hudScriptKey,
      };

      const retrieval = await measureStep("hud_script_resolve", () =>
        getHudScriptPayload(request, {
          traceId,
          shopperId,
          context,
        })
      );

      if (!retrieval.ok) {
        log("hud.script.resolve.error", retrieval.error.message, {
          traceId,
          shopperId,
          request,
          retrievalMs: retrieval.ms,
          totalMs: retrieval.ms,
          timeoutMs: retrieval.error?.timeoutMs || null,
          fallbackUsed: true,
        });

        return flatResponse(
          event,
          200,
          buildFallbackHud({
            speech: "I'm here if you need me.",
            captions: "I'm here if you need me.",
          })
        );
      }

      const resolved = retrieval.value;

      if (!resolved || typeof resolved !== "object") {
        log("hud.script.resolve.miss", "not_found", {
          traceId,
          shopperId,
          request,
          retrievalMs: retrieval.ms,
          totalMs: retrieval.ms,
          fallbackUsed: true,
        });

        return flatResponse(
          event,
          200,
          buildFallbackHud({
            speech: "I'm here if you need me.",
            captions: "I'm here if you need me.",
          })
        );
      }

      const hud = enforceHudContract({
        speech: typeof resolved.speech === "string" ? resolved.speech : "",
        captions:
          typeof resolved.captions === "string"
            ? resolved.captions
            : typeof resolved.speech === "string"
              ? resolved.speech
              : "",
        state: normalizeHudStateValue(resolved.state, "speaking"),
        priority: normalizeHudPriorityValue(resolved.priority, "normal"),
        ttlMs:
          Number.isFinite(Number(resolved.ttlMs)) && Number(resolved.ttlMs) > 0
            ? Number(resolved.ttlMs)
            : 5000,
        actions: Array.isArray(resolved.actions) ? resolved.actions : [],
      });

      log("hud.script.resolve", "ok", {
        traceId,
        shopperId,
        page: resolved?.scriptMeta?.page || null,
        event: resolved?.scriptMeta?.event || null,
        scriptKey: normalizeHudScriptKey(body?.scriptKey || body?.hudScriptKey) || null,
        retrievalMs: resolved?.scriptMeta?.retrievalMs ?? retrieval.ms,
        totalMs: resolved?.scriptMeta?.totalMs ?? retrieval.ms,
        fallbackUsed: Boolean(resolved?.scriptMeta?.fallbackUsed),
        fallbackTier: resolved?.scriptMeta?.fallbackTier || "s3",
        validationPassed: resolved?.scriptMeta?.validationPassed !== false,
        state: hud.state,
      });

      return flatResponse(event, 200, {
        ...hud,
        voiceStyle: normalizeHudVoiceStyleValue(resolved?.voiceStyle, "default"),
      });
    } catch (e) {
      log("hud.script.resolve.error", e.message, {
        traceId,
        request: {
          page: normalizeHudPageValue(body?.page || body?.hudPage),
          event: normalizeHudEventValue(body?.event || body?.hudEvent),
          scriptKey: normalizeHudScriptKey(body?.scriptKey || body?.hudScriptKey),
        },
        totalMs: 0,
        fallbackUsed: true,
      });

      return flatResponse(
        event,
        200,
        buildFallbackHud({
          speech: "I'm here if you need me.",
          captions: "I'm here if you need me.",
        })
      );
    }
  }

  return null;
}

module.exports = {
  handleHudRoutes,
};
