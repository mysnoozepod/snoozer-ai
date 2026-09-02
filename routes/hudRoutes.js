const {
  buildLegacyHudAskPayload,
  buildLegacyHudAskFallback,
} = require("../services/snoozerSurfaceAdapter");

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
    elapsedMs,
    rawJsonResponse,
    runSharedAskSnoozer,
  } = deps;

  if (method === "POST" && routePath === "/hud/ask") {
    const startedAt = Date.now();
    const body = safeJsonBody(event);
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const pathValue = sanitizeHudAskPath(body?.path || "/");
    const pageType = normalizeHudAskPageType(body?.page_type || "unknown", pathValue);
    const surface =
      String(body?.surface || "shopify_header").trim().toLowerCase() || "shopify_header";
    const sessionId = deriveEffectiveThreadId(event, {
      thread_id: body?.thread_id,
      sessionId: body?.session_id,
    });
    const requestContext = { path: pathValue, pageType, surface, sessionId };

    try {
      if (typeof runSharedAskSnoozer !== "function") {
        throw new Error("SHARED_ASK_HANDLER_UNAVAILABLE");
      }

      const canonical = await runSharedAskSnoozer({
        event,
        traceId,
        body,
        query,
        path: pathValue,
        pageType,
        surface,
        sessionId,
      });
      const payload = buildLegacyHudAskPayload(
        canonical,
        requestContext,
        elapsedMs(startedAt)
      );

      log("hud.ask", "ok", {
        traceId,
        sessionId,
        intent: payload.intent,
        intentGroup: payload.intent_group || null,
        answerSourceType: payload.meta.answer_source_type || null,
        answerSourceKey: payload.meta.answer_source_key || null,
        sourceOfTruth: payload.meta.source_of_truth || null,
        protectedTruthRequired: payload.meta.protected_truth_required,
        modelUsed: payload.meta.model_used,
        fallbackUsed: payload.meta.fallback_used,
        failureReason: payload.meta.failure_reason || null,
        path: pathValue,
        pageType,
        surface,
        productCount: payload.products.length,
        latencyMs: payload.meta.latency_ms,
      });

      return rawJsonResponse(event, 200, payload);
    } catch (e) {
      const fallback = buildLegacyHudAskFallback(requestContext, elapsedMs(startedAt));

      log("hud.ask.error", e.message, {
        traceId,
        sessionId,
        surface,
        sharedBrainRoute: "/ask-snoozer",
        fallbackUsed: true,
        failureReason: e?.code || e?.message || "SHARED_ASK_UNAVAILABLE",
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
