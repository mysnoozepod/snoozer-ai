// backend/utils/responseContract.js
// Contract enforcement + debug gating + compact response logging (CommonJS)
// Extended:
// - Adds strict HUD contract normalization/enforcement for showroom mode
// - Keeps legacy Snoozer response normalization for backwards compatibility
// - Thread 8 hardening:
//   - Prevents raw strings / loose blobs from leaking past normalization
//   - Carries timing/fallback metrics through the canonical response
//   - Enforces strict HUD shape for showroom-safe delivery

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function ensureArray(x) {
  return Array.isArray(x) ? x : [];
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function safeString(x) {
  if (x === undefined || x === null) return "";
  return String(x);
}

function safeText(x, max = 1200) {
  const s = safeString(x).trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function safeNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function normalizeActions(actions, { max = 25 } = {}) {
  const a = ensureArray(actions);
  return a
    .map((v) => {
      if (typeof v === "string") return v;
      if (isObj(v)) return v;
      return null;
    })
    .filter(Boolean)
    .slice(0, max);
}

function normalizeChips(chips, { max = 12 } = {}) {
  return ensureArray(chips)
    .map((value) => {
      if (typeof value === "string") return value;
      if (isObj(value)) return value;
      return null;
    })
    .filter(Boolean)
    .slice(0, max);
}

function normalizeProducts(products, { max = 12 } = {}) {
  return ensureArray(products)
    .map((p) => (isObj(p) ? p : null))
    .filter(Boolean)
    .slice(0, max);
}

function normalizeMetrics(rawMeta = {}, startedAtMs) {
  const latencyCandidate = pickFirst(
    rawMeta?.latencyMs,
    rawMeta?.latency_ms,
    rawMeta?.totalMs,
    rawMeta?.total_ms
  );

  const totalMs =
    typeof latencyCandidate === "number"
      ? Math.max(0, latencyCandidate)
      : typeof startedAtMs === "number"
      ? Math.max(0, Date.now() - startedAtMs)
      : 0;

  const retrievalMs = clampInt(
    pickFirst(rawMeta?.retrievalMs, rawMeta?.retrieval_ms),
    0,
    60_000,
    0
  );

  const modelMs = clampInt(
    pickFirst(rawMeta?.modelMs, rawMeta?.model_ms),
    0,
    60_000,
    0
  );

  const fallbackUsed = Boolean(
    pickFirst(rawMeta?.fallbackUsed, rawMeta?.fallback_used, false)
  );

  return {
    retrievalMs,
    modelMs,
    totalMs,
    fallbackUsed,
  };
}

/**
 * Debug flag:
 *  - query ?debug=true
 *  - header x-debug: 1
 */
function isDebugRequest(event) {
  const qs = (event && event.queryStringParameters) || {};
  const headers = (event && event.headers) || {};

  const q = safeString(qs.debug).toLowerCase();
  if (q === "true" || q === "1") return true;

  const hdr =
    headers["x-debug"] ||
    headers["X-Debug"] ||
    headers["xDebug"] ||
    headers["XDEBUG"];

  const h = safeString(hdr).toLowerCase();
  return h === "1" || h === "true";
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Legacy Snoozer contract (existing)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

/**
 * Normalize the response into the canonical legacy contract:
 * ok, traceId, sessionId, status, reply, actions[], products[], context, error, metadata
 *
 * Keeps message{} for backwards compatibility, but frontend should rely on reply.
 */
function normalizeSnoozerResponse(raw, opts = {}) {
  const safe =
    typeof raw === "string"
      ? { reply: raw }
      : isObj(raw)
      ? raw
      : {};

  const {
    traceId: traceIdFromCaller,
    sessionId: sessionIdFromCaller,
    routePath = "",
    startedAtMs,
    debug = false,
    defaultReply = "Tell me what you're shopping for and I'll pull the best options.",
  } = opts;

  const traceId =
    pickFirst(
      safe.traceId,
      safe?.metadata?.requestId,
      safe?.meta?.requestId,
      traceIdFromCaller
    ) || "missing-trace";

  const sessionId =
    pickFirst(
      safe.sessionId,
      safe.thread_id,
      safe.threadId,
      safe?.context?.sessionId,
      safe?.context?.ids?.sessionId,
      sessionIdFromCaller
    ) || "";

  const replyRaw = pickFirst(
    safe.reply,
    safe?.message?.text,
    safe.text,
    safe?.speech,
    safe?.captions,
    safe?.error?.message,
    ""
  );

  const reply = safeString(replyRaw).trim() ? safeString(replyRaw).trim() : defaultReply;

  const status = (() => {
    const s = safeString(
      pickFirst(safe.status, safe?.meta?.status, safe?.metadata?.status)
    )
      .toLowerCase()
      .trim();

    if (s === "error" || s === "failed" || s === "fail") return "error";
    if (s === "answered") return "answered";
    if (s === "fallback" || s === "completed_with_fallback") return "fallback";
    if (s === "blocked") return "blocked";
    if (s === "needs_human") return "needs_human";
    if (safe.ok === false) return "error";
    if (safe.error) return "error";
    return "completed";
  })();

  const ok = Boolean(safe.ok !== undefined ? safe.ok : status !== "error");

  const actions = normalizeActions(safe.actions);
  const chips = normalizeChips(
    pickFirst(safe.chips, safe.suggestedPrompts, safe.chips_override, [])
  );
  const products = normalizeProducts(safe.products);

  let error = safe.error ?? null;
  if (status === "error" && !error) {
    error = { code: "UNKNOWN_ERROR", message: "Unknown error" };
  }

  const metrics = normalizeMetrics(safe?.meta || safe?.metadata || {}, startedAtMs);

  const model = pickFirst(
    safe?.metadata?.model,
    safe?.model,
    safe?.message?.raw?.model,
    safe?.raw?.model,
    null
  );
  const qualityGate =
    isObj(safe?.meta?.qualityGate)
      ? safe.meta.qualityGate
      : isObj(safe?.metadata?.qualityGate)
      ? safe.metadata.qualityGate
      : null;

  const source = (() => {
    const src = isObj(safe?.metadata?.source)
      ? safe.metadata.source
      : isObj(safe?.meta?.source)
      ? safe.meta.source
      : {};

    return {
      s3Prompts: debug
        ? ensureArray(
            pickFirst(
              src.s3Prompts,
              src.s3_prompts,
              safe?.s3Prompts,
              safe?.meta?.s3Prompts
            )
          )
        : [],
      shopifyProducts: Number(src.shopifyProducts ?? products.length ?? 0) || 0,
    };
  })();

  const message = {
    text: reply,
    raw: debug ? safe?.message?.raw ?? safe?.raw ?? null : null,
    tokens: safe?.message?.tokens ?? safe.tokens ?? null,
  };

  const context = isObj(safe.context) ? safe.context : {};

  return {
    ok: ok && status !== "error",
    traceId,
    sessionId,
    status,
    reply,

    message,

    actions,
    chips,
    products,
    context,
    error,

    metadata: {
      requestId: traceId,
      routePath,
      latencyMs: metrics.totalMs,
      model,
      source,
      metrics,
      ...(qualityGate ? { qualityGate } : {}),
    },
  };
}

/**
 * Compact CloudWatch log so you can correlate success/failure by traceId without logging huge payloads.
 */
function logContractResponse(normalized) {
  const n = isObj(normalized) ? normalized : {};
  const meta = isObj(n.metadata) ? n.metadata : {};
  const metrics = isObj(meta.metrics) ? meta.metrics : {};

  console.log(
    JSON.stringify({
      src: "res",
      traceId: n.traceId || meta.requestId || "missing-trace",
      routePath: meta.routePath || "",
      ok: Boolean(n.ok),
      status: n.status || "",
      latencyMs: meta.latencyMs || 0,
      retrievalMs: metrics.retrievalMs || 0,
      modelMs: metrics.modelMs || 0,
      fallbackUsed: Boolean(metrics.fallbackUsed),
      actions: Array.isArray(n.actions) ? n.actions.length : 0,
      products: Array.isArray(n.products) ? n.products.length : 0,
      hasError: Boolean(n.error),
      model: meta.model || null,
    })
  );
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// HUD contract (strict)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const HUD_STATES = ["idle", "listening", "thinking", "speaking", "celebrate", "warning"];
const HUD_PRIORITIES = ["low", "normal", "high"];

function normalizeHudEnum(x) {
  return safeString(x).trim().toLowerCase();
}

function isHudState(x) {
  const s = normalizeHudEnum(x);
  return HUD_STATES.includes(s);
}

function isHudPriority(x) {
  const p = normalizeHudEnum(x);
  return HUD_PRIORITIES.includes(p);
}

function clampTtlMs(v, def = 5000) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.max(1000, Math.min(n, 30000));
}

function validateHudContract(raw) {
  const safe = isObj(raw) ? raw : null;
  const errors = [];

  if (!safe) {
    return {
      valid: false,
      errors: ["HUD payload must be an object."],
      value: null,
    };
  }

  if (typeof safe.speech !== "string" || !safe.speech.trim()) {
    errors.push("speech must be a non-empty string.");
  }

  if (typeof safe.captions !== "string" || !safe.captions.trim()) {
    errors.push("captions must be a non-empty string.");
  }

  if (!isHudState(safe.state)) {
    errors.push(`state must be one of: ${HUD_STATES.join(", ")}.`);
  }

  if (!isHudPriority(safe.priority)) {
    errors.push(`priority must be one of: ${HUD_PRIORITIES.join(", ")}.`);
  }

  const ttlMs = Number(safe.ttlMs);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    errors.push("ttlMs must be a finite positive number.");
  }

  if (!Array.isArray(safe.actions)) {
    errors.push("actions must be an array.");
  }

  if (errors.length) {
    return {
      valid: false,
      errors,
      value: null,
    };
  }

  return {
    valid: true,
    errors: [],
    value: {
      speech: safeText(safe.speech, 1200),
      captions: safeText(safe.captions, 1800),
      state: normalizeHudEnum(safe.state),
      priority: normalizeHudEnum(safe.priority),
      ttlMs: clampTtlMs(safe.ttlMs, 5000),
      actions: normalizeActions(safe.actions, { max: 25 }),
    },
  };
}

function hasNormalizedErrorish(normalized) {
  const n = isObj(normalized) ? normalized : {};
  const status = safeString(n.status).toLowerCase().trim();
  return Boolean(n.error) || status === "error" || n.ok === false;
}

function getDefaultHudStateFromNormalized(normalized) {
  return hasNormalizedErrorish(normalized) ? "warning" : "speaking";
}

function getDefaultHudPriorityFromNormalized(normalized) {
  return hasNormalizedErrorish(normalized) ? "high" : "normal";
}

function getDefaultHudTtlFromNormalized(normalized) {
  return hasNormalizedErrorish(normalized) ? 7000 : 5000;
}

/**
 * Normalize ANY response into the strict HUD contract:
 * {
 *   speech: string,
 *   captions: string,
 *   state: "idle|listening|thinking|speaking|celebrate|warning",
 *   priority: "low|normal|high",
 *   ttlMs: number,
 *   actions: []
 * }
 *
 * Inputs accepted:
 * - A normalized Snoozer response (from normalizeSnoozerResponse)
 * - A raw Snoozer response (reply/actions/meta/etc)
 * - A raw HUD response (speech/captions/state/etc)
 */
function normalizeHudResponse(rawOrNormalized, opts = {}) {
  const safe =
    typeof rawOrNormalized === "string"
      ? { speech: rawOrNormalized, captions: rawOrNormalized }
      : isObj(rawOrNormalized)
      ? rawOrNormalized
      : {};

  const {
    state: stateOverride,
    priority: priorityOverride,
    ttlMs: ttlOverride,
    defaultSpeech = "I'm here. Tell me what you want to do next.",
    speechMaxChars = 1200,
    captionsMaxChars = 1800,
  } = opts;

  const hudLikeSpeech = pickFirst(safe.speech, safe.captions, null);
  const fromLegacyReply = pickFirst(safe.reply, safe?.message?.text, safe.text, null);
  const fromErrorMessage = pickFirst(
    safe?.error?.message,
    safe?.error?.details?.message,
    null
  );

  const baseText =
    safeText(
      pickFirst(hudLikeSpeech, fromLegacyReply, fromErrorMessage, defaultSpeech),
      Math.max(200, captionsMaxChars)
    ) || defaultSpeech;

  const actions = normalizeActions(safe.actions);

  const state =
    (isHudState(stateOverride) && normalizeHudEnum(stateOverride)) ||
    (isHudState(safe.state) && normalizeHudEnum(safe.state)) ||
    getDefaultHudStateFromNormalized(safe);

  const priority =
    (isHudPriority(priorityOverride) && normalizeHudEnum(priorityOverride)) ||
    (isHudPriority(safe.priority) && normalizeHudEnum(safe.priority)) ||
    getDefaultHudPriorityFromNormalized(safe);

  const ttlMs = clampTtlMs(
    pickFirst(ttlOverride, safe.ttlMs, safe?.metadata?.ttlMs, safe?.meta?.ttlMs),
    getDefaultHudTtlFromNormalized(safe)
  );

  const captions =
    safeText(pickFirst(safe.captions, safe.speech, baseText), captionsMaxChars) || baseText;

  const speech = safeText(pickFirst(safe.speech, baseText), speechMaxChars) || baseText;

  return {
    speech,
    captions,
    state,
    priority,
    ttlMs,
    actions,
  };
}

/**
 * Hard enforcement layer for showroom delivery.
 * Ensures exact required keys exist and nothing upstream can omit captions/actions.
 */
function enforceHudContract(rawOrNormalized, opts = {}) {
  const hud = normalizeHudResponse(rawOrNormalized, opts);
  const validated = validateHudContract(hud);

  if (validated.valid && validated.value) {
    return validated.value;
  }

  return {
    speech: safeText(hud.speech, opts.speechMaxChars || 1200) || "I'm here.",
    captions:
      safeText(hud.captions, opts.captionsMaxChars || 1800) ||
      safeText(hud.speech, opts.captionsMaxChars || 1800) ||
      "I'm here.",
    state: isHudState(hud.state) ? hud.state : "warning",
    priority: isHudPriority(hud.priority) ? hud.priority : "normal",
    ttlMs: clampTtlMs(hud.ttlMs, 5000),
    actions: normalizeActions(hud.actions, { max: 25 }),
  };
}

module.exports = {
  // legacy
  isDebugRequest,
  normalizeSnoozerResponse,
  logContractResponse,
  safeNumber,

  // HUD
  normalizeHudResponse,
  validateHudContract,
  enforceHudContract,
  HUD_STATES,
  HUD_PRIORITIES,
};


