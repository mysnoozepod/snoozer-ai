// index.js â€” Omnia / Snoozer Backend Core
// Handler: index.lambdaHandler
//
// Deterministic-first Ask Snoozer:
// - Session (SCO) is the source of truth for "where the shopper is"
// - Pod mode requires podId + exploreContext (or explore) to anchor product identity
// - Do NOT do pre-search / listProducts / recs lookups inside /ask-snoozer
// - Pricing + cart are handled deterministically in services/openai.js via tools
//
// Extended:
// - HUD enforcement for showroom modes (pod/explore/showroom)
//   Returns strict HUD contract JSON for those modes.
//   Keeps legacy envelope for non-showroom clients.
// - S3 HUD script pack support via services/hudScripts.js
//
// Thread 8 hardening:
// - Strict HUD contract enforcement at backend boundary
// - Timeout guards for retrieval / model / Polly
// - Per-step timing logs
// - Deterministic fallback logging
// - No loose HUD payloads in showroom mode

require("dotenv").config();

const crypto = require("crypto");
const shopify = require("./routes/shopifyRoutes");

let rewardsRoutes;
try {
  rewardsRoutes = require("./routes/rewardsRoutes");
} catch {
  console.log("âš ï¸ rewardsRoutes not found.");
}

let buildIndexes;
try {
  ({ buildIndexes } = require("./services/s3Indexer"));
} catch {
  console.log("âš ï¸ s3Indexer not loaded.");
}

let recsService = null;
try {
  recsService = require("./services/recommendations");
} catch {
  console.log("âš ï¸ recommendations service not loaded (ok).");
}

let getHudScriptPayload = null;
try {
  ({ getHudScriptPayload } = require("./services/hudScripts"));
} catch (e) {
  console.log("âš ï¸ hudScripts service not loaded.", e.message);
}

const { S3Client, GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

let IoTDataPlaneClient, PublishCommand;
try {
  ({ IoTDataPlaneClient, PublishCommand } = require("@aws-sdk/client-iot-data-plane"));
} catch {}

let PollyClient, SynthesizeSpeechCommand;
try {
  ({ PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly"));
} catch {
  console.log("âš ï¸ Polly client not loaded.");
}

const {
  buildSuccessResponse,
  buildErrorResponse,
  buildHudResponseFromEnvelope,
} = require("./services/responseBuilder");

const {
  isDebugRequest,
  normalizeSnoozerResponse,
  logContractResponse,
} = require("./utils/responseContract");

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Config / Globals
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REGION = process.env.AWS_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const QUESTIONS_BUCKET = process.env.ASSESSMENT_BUCKET || "snoozer-assets-prod";
const QUESTIONS_KEY = process.env.ASSESSMENT_KEY || "sleep_assessment.json";
const RESULTS_TABLE = process.env.ASSESSMENT_TABLE || "";
const QUESTIONS_TTL_MS = Number(process.env.ASSESSMENT_CACHE_TTL_MS || 30_000);

// Sessions table for Snoozer Context Object (SCO)
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || "snoozer_sessions";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

// IoT Core (optional)
const IOT_ENDPOINT = process.env.IOT_ENDPOINT || "";
const IOT_DEFAULT_TOPIC = process.env.IOT_DEFAULT_TOPIC || "mysnoozepod/scene";

const polly = PollyClient ? new PollyClient({ region: REGION }) : null;

let questionsCache = { data: null, etag: null, lastModified: null, ts: 0 };

// Strict mode for pod anchoring (fail fast instead of hallucinating)
const STRICT_POD_ANCHOR = (process.env.STRICT_POD_ANCHOR || "1") === "1";

// Production thresholds
const S3_RETRIEVAL_TIMEOUT_MS = Number(process.env.S3_RETRIEVAL_TIMEOUT_MS || 300);
const SHOPIFY_TIMEOUT_MS = Number(process.env.SHOPIFY_TIMEOUT_MS || 800);
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 2500);
const POLLY_TIMEOUT_MS = Number(process.env.POLLY_TIMEOUT_MS || 2000);

// Strict HUD defaults
const HUD_DEFAULTS = {
  speech: "I'm here.",
  captions: "I'm here.",
  state: "speaking",
  priority: "normal",
  ttlMs: 5000,
  actions: [],
};

let questionsInFlight = null;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Timing / timeout helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function elapsedMs(startedAtMs) {
  return Math.max(0, Date.now() - Number(startedAtMs || Date.now()));
}

function buildTimeoutError(code, message, timeoutMs, extra = {}) {
  const err = new Error(message);
  err.code = code;
  err.timeoutMs = timeoutMs;
  Object.assign(err, extra);
  return err;
}

function withTimeout(promise, timeoutMs, code, message, extra = {}) {
  let timer = null;

  return Promise.race([
    Promise.resolve().then(() => promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(buildTimeoutError(code, message, timeoutMs, extra));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function measureStep(step, fn) {
  const startedAt = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: elapsedMs(startedAt), value };
  } catch (error) {
    return { ok: false, ms: elapsedMs(startedAt), error };
  }
}

function isTimeoutError(err) {
  const code = String(err?.code || "").toUpperCase();
  return code.includes("TIMEOUT") || /timeout/i.test(String(err?.message || ""));
}

function safeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// HUD mode helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isShowroomMode(mode) {
  const m = String(mode || "").toLowerCase().trim();
  return m === "pod" || m === "explore" || m === "showroom";
}

// optional force flag (header)
function wantsHudResponse(event, mode) {
  const hdr =
    getHeader(event.headers, "x-hud") ||
    getHeader(event.headers, "X-Hud") ||
    getHeader(event.headers, "X-HUD") ||
    "";
  const h = String(hdr || "").trim().toLowerCase();
  if (h === "1" || h === "true") return true;
  return isShowroomMode(mode);
}

function normalizeHudStateValue(v, fallback = "speaking") {
  const s = String(v || "").trim().toLowerCase();
  const allowed = ["idle", "listening", "thinking", "speaking", "celebrate", "warning"];
  return allowed.includes(s) ? s : fallback;
}

function normalizeHudPriorityValue(v, fallback = "normal") {
  const s = String(v || "").trim().toLowerCase();
  const allowed = ["low", "normal", "high"];
  return allowed.includes(s) ? s : fallback;
}

function normalizeHudVoiceStyleValue(v, fallback = "default") {
  const s = String(v || "").trim().toLowerCase();
  return s === "calm" ? "calm" : fallback;
}

function normalizeHudScriptKey(v) {
  const s = String(v || "").trim();
  return s || "";
}

function normalizeHudPageValue(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, "_")
    .replace(/[.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "";
}

function normalizeHudEventValue(v) {
  return normalizeHudPageValue(v);
}

function sanitizeHudActions(actions) {
  return Array.isArray(actions) ? actions : [];
}

function enforceHudContract(input = {}, defaults = {}) {
  const merged = {
    ...HUD_DEFAULTS,
    ...defaults,
    ...(input && typeof input === "object" ? input : {}),
  };

  const speech =
    typeof merged.speech === "string" && merged.speech.trim()
      ? merged.speech.trim()
      : typeof defaults.speech === "string" && defaults.speech.trim()
        ? defaults.speech.trim()
        : HUD_DEFAULTS.speech;

  const captions =
    typeof merged.captions === "string" && merged.captions.trim()
      ? merged.captions.trim()
      : speech;

  const ttlMsRaw = Number(merged.ttlMs);
  const ttlMs =
    Number.isFinite(ttlMsRaw) && ttlMsRaw > 0
      ? Math.max(1000, Math.min(15000, Math.round(ttlMsRaw)))
      : safeNumber(defaults.ttlMs, HUD_DEFAULTS.ttlMs);

  return {
    speech,
    captions,
    state: normalizeHudStateValue(merged.state, defaults.state || HUD_DEFAULTS.state),
    priority: normalizeHudPriorityValue(merged.priority, defaults.priority || HUD_DEFAULTS.priority),
    ttlMs,
    actions: sanitizeHudActions(merged.actions),
  };
}

function buildFallbackHud({
  speech,
  captions,
  state = "warning",
  priority = "high",
  ttlMs = 7000,
  actions = [],
} = {}) {
  return enforceHudContract({
    speech: speech || HUD_DEFAULTS.speech,
    captions: captions || speech || HUD_DEFAULTS.captions,
    state,
    priority,
    ttlMs,
    actions,
  });
}

function buildDeterministicHudOverride({ mode, context, aiResult, normalized, ok }) {
  const m = String(mode || "").toLowerCase().trim();
  const text =
    String(
      aiResult?.hud?.captions ||
        aiResult?.hud?.speech ||
        normalized?.reply ||
        normalized?.message?.text ||
        normalized?.error?.message ||
        ""
    ).trim() || "";

  if (!ok) {
    return {
      state: "warning",
      priority: "high",
      ttlMs: 7000,
      voiceStyle: "default",
    };
  }

  if (m === "pod") {
    const stage = String(
      context?.progress?.lastCheckpoint ||
        context?.phase ||
        context?.zoneContext ||
        ""
    )
      .toLowerCase()
      .trim();

    const lowerText = text.toLowerCase();

    if (
      stage.includes("rest") ||
      lowerText.includes("rest test") ||
      lowerText.includes("zero gravity") ||
      lowerText.includes("head up") ||
      lowerText.includes("return flat")
    ) {
      return {
        state: "speaking",
        priority: "normal",
        ttlMs: 6500,
        voiceStyle: "calm",
      };
    }

    if (
      stage.includes("build") ||
      lowerText.includes("build your pod") ||
      lowerText.includes("choose your size") ||
      lowerText.includes("choose your base")
    ) {
      return {
        state: "speaking",
        priority: "normal",
        ttlMs: 5000,
        voiceStyle: "default",
      };
    }

    if (
      lowerText.includes("checkout") ||
      lowerText.includes("cart") ||
      lowerText.includes("added to cart")
    ) {
      return {
        state: "celebrate",
        priority: "normal",
        ttlMs: 5000,
        voiceStyle: "default",
      };
    }

    return {
      state: "speaking",
      priority: "normal",
      ttlMs: 5000,
      voiceStyle: "default",
    };
  }

  if (m === "explore" || m === "showroom") {
    return {
      state: "speaking",
      priority: "normal",
      ttlMs: 5000,
      voiceStyle: "default",
    };
  }

  return {
    state: "speaking",
    priority: "normal",
    ttlMs: 5000,
    voiceStyle: "default",
  };
}

function extractHudActionTypes(...actionLists) {
  const values = [];

  for (const actions of actionLists) {
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (typeof action === "string") {
        values.push(action.trim().toLowerCase());
        continue;
      }
      if (action && typeof action === "object" && typeof action.type === "string") {
        values.push(action.type.trim().toLowerCase());
      }
    }
  }

  return new Set(values.filter(Boolean));
}

function inferHudScriptRequest({ ok, mode, context, payload, aiResult, normalized }) {
  const explicitPage =
    normalizeHudPageValue(aiResult?.hud?.page) ||
    normalizeHudPageValue(payload?.page || payload?.hudPage) ||
    normalizeHudPageValue(context?.hudPage);
  const explicitEvent =
    normalizeHudEventValue(aiResult?.hud?.event) ||
    normalizeHudEventValue(payload?.event || payload?.hudEvent) ||
    normalizeHudEventValue(context?.hudEvent);
  const explicitScriptKey =
    normalizeHudScriptKey(aiResult?.hud?.scriptKey) ||
    normalizeHudScriptKey(payload?.scriptKey || payload?.hudScriptKey) ||
    normalizeHudScriptKey(context?.hudScriptKey);

  if (explicitPage && explicitEvent) {
    return {
      page: explicitPage,
      event: explicitEvent,
      scriptKey: explicitScriptKey || undefined,
      reason: "explicit_page_event",
    };
  }

  if (explicitScriptKey) {
    return {
      scriptKey: explicitScriptKey,
      reason: "explicit_script_key",
    };
  }

  const lowerText = String(
    aiResult?.hud?.captions ||
      aiResult?.hud?.speech ||
      normalized?.reply ||
      normalized?.message?.text ||
      normalized?.error?.message ||
      ""
  )
    .toLowerCase()
    .trim();

  const lowerErrorCode = String(
    normalized?.error?.code ||
      aiResult?.error?.code ||
      aiResult?.meta?.error ||
      ""
  )
    .toLowerCase()
    .trim();

  const stage = String(
    context?.progress?.lastCheckpoint ||
      context?.phase ||
      context?.zoneContext ||
      ""
  )
    .toLowerCase()
    .trim();

  const actionTypes = extractHudActionTypes(
    normalized?.actions,
    aiResult?.actions,
    aiResult?.suggestedActions
  );

  if (!ok) {
    if (
      isTimeoutError(normalized?.error) ||
      isTimeoutError(aiResult?.error) ||
      lowerErrorCode.includes("timeout") ||
      lowerErrorCode.includes("retrieval")
    ) {
      return {
        page: "global",
        event: "offline_mode",
        reason: "error_timeout",
      };
    }

    return {
      page: "global",
      event: "retrieval_warning",
      reason: "error_fallback",
    };
  }

  if (
    aiResult?.checkoutUrl ||
    actionTypes.has("go_to_checkout") ||
    lowerText.includes("checkout")
  ) {
    return {
      page: "checkout",
      event: "handoff",
      reason: "checkout_handoff",
    };
  }

  if (
    actionTypes.has("go_to_cart") ||
    actionTypes.has("cart_view") ||
    actionTypes.has("remove_from_cart") ||
    actionTypes.has("update_cart_qty") ||
    lowerText.includes("your cart")
  ) {
    return {
      page: "cart",
      event: "enter",
      reason: "cart_enter",
    };
  }

  if (
    stage.includes("build") &&
    (lowerText.includes("finish your snoozepod") ||
      lowerText.includes("choose your size") ||
      lowerText.includes("review your setup"))
  ) {
    return {
      page: "build",
      event: "intro",
      reason: "build_intro",
    };
  }

  if (
    stage.includes("rest") &&
    (lowerText.includes("rest test") ||
      lowerText.includes("zero gravity") ||
      lowerText.includes("head up") ||
      lowerText.includes("return flat"))
  ) {
    return {
      page: "rest_test",
      event: "start",
      reason: "rest_test_start",
    };
  }

  const showroomMode = String(mode || "").toLowerCase().trim();
  if (
    (showroomMode === "explore" || showroomMode === "showroom") &&
    (stage.includes("results") || lowerText.includes("recommended pods"))
  ) {
    return {
      page: "results",
      event: "enter",
      reason: "results_enter",
    };
  }

  return null;
}

async function buildHudFromAny(input, { ok, mode, context, aiResult, payload, defaultSpeech, traceId } = {}) {
  const override = buildDeterministicHudOverride({
    mode,
    context,
    aiResult,
    normalized: input,
    ok,
  });

  const inferredRequest = inferHudScriptRequest({
    ok,
    mode,
    context,
    payload,
    aiResult,
    normalized: input,
  });

  let scriptPayload = null;
  let retrievalMs = 0;
  let fallbackUsed = false;
  let fallbackTier = null;

  if (inferredRequest && typeof getHudScriptPayload === "function") {
    const retrieval = await measureStep("hud_script_retrieval", () =>
      getHudScriptPayload(inferredRequest, {
        traceId,
        shopperId: payload?.shopperId || context?.shopperId || null,
        context,
      })
    );

    retrievalMs = retrieval.ms;

    if (retrieval.ok) {
      scriptPayload = retrieval.value;
      fallbackUsed = Boolean(retrieval.value?.scriptMeta?.fallbackUsed);
      fallbackTier = retrieval.value?.scriptMeta?.fallbackTier || "s3";
    } else {
      fallbackUsed = true;
      log("hud.script.resolve.error", retrieval.error.message, {
        traceId,
        request: inferredRequest,
        retrievalMs,
        timeoutMs: retrieval.error?.timeoutMs || null,
      });
    }
  }

  if (scriptPayload && inferredRequest) {
    const strictScriptHud = enforceHudContract(scriptPayload, {
      speech: defaultSpeech || HUD_DEFAULTS.speech,
      captions: defaultSpeech || HUD_DEFAULTS.captions,
      state: override.state,
      priority: override.priority,
      ttlMs: override.ttlMs,
      actions: [],
    });

    log("hud.contract", "resolved", {
      traceId,
      mode: String(mode || "").toLowerCase().trim() || "default",
      page: scriptPayload?.scriptMeta?.page || inferredRequest.page || null,
      event: scriptPayload?.scriptMeta?.event || inferredRequest.event || null,
      scriptKey: inferredRequest.scriptKey || null,
      retrievalMs: scriptPayload?.scriptMeta?.retrievalMs ?? retrievalMs,
      fallbackUsed,
      fallbackTier,
      state: strictScriptHud.state,
      priority: strictScriptHud.priority,
      ttlMs: strictScriptHud.ttlMs,
    });

    return strictScriptHud;
  }

  const explicitHud = aiResult?.hud && typeof aiResult.hud === "object" ? aiResult.hud : {};

  const baseHud = buildHudResponseFromEnvelope(input, {
    state:
      normalizeHudStateValue(explicitHud.state, "") ||
      scriptPayload?.state ||
      override.state,
    priority:
      normalizeHudPriorityValue(explicitHud.priority, "") ||
      scriptPayload?.priority ||
      override.priority,
    ttlMs:
      Number.isFinite(Number(explicitHud.ttlMs)) && Number(explicitHud.ttlMs) > 0
        ? Number(explicitHud.ttlMs)
        : scriptPayload?.ttlMs || override.ttlMs,
    voiceStyle:
      normalizeHudVoiceStyleValue(explicitHud.voiceStyle, "") ||
      scriptPayload?.voiceStyle ||
      override.voiceStyle,
    speech:
      typeof explicitHud.speech === "string" && explicitHud.speech.trim()
        ? explicitHud.speech
        : scriptPayload?.speech || null,
    captions:
      typeof explicitHud.captions === "string" && explicitHud.captions.trim()
        ? explicitHud.captions
        : scriptPayload?.captions || null,
    actions:
      Array.isArray(explicitHud.actions) && explicitHud.actions.length
        ? explicitHud.actions
        : scriptPayload?.actions || null,
    defaultSpeech,
  });

  const strictHud = enforceHudContract(baseHud, {
    speech: defaultSpeech || HUD_DEFAULTS.speech,
    captions: defaultSpeech || HUD_DEFAULTS.captions,
    state: override.state,
    priority: override.priority,
    ttlMs: override.ttlMs,
    actions: [],
  });

  log("hud.contract", "resolved", {
    traceId,
    mode: String(mode || "").toLowerCase().trim() || "default",
    page: null,
    event: null,
    scriptKey: inferredRequest?.scriptKey || null,
    retrievalMs,
    fallbackUsed,
    fallbackTier,
    state: strictHud.state,
    priority: strictHud.priority,
    ttlMs: strictHud.ttlMs,
  });

  return strictHud;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CORS + HTTP Helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function splitCSV(v = "") {
  return String(v || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const DYNAMIC_ALLOWLIST = [
  "http://localhost:5173",
  "https://staging.d1yszajjde5t5.amplifyapp.com",
  "https://mysnoozepod.com",
  "https://www.mysnoozepod.com",
];

const ALLOWLIST = splitCSV(process.env.CORS_ALLOW_ORIGIN || "").concat(DYNAMIC_ALLOWLIST);

const ALLOW_HEADERS =
  "content-type,authorization,x-requested-with,x-request-id,x-api-key,x-session-id,x-debug,x-hud,if-none-match";
const ALLOW_METHODS = "GET,POST,PATCH,OPTIONS";
const EXPOSE_HEADERS = "x-request-id,x-trace-id,x-session-id,etag,last-modified";
const MAX_AGE = "600";

function getHeader(headers = {}, name = "") {
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return undefined;
}

function pickOrigin(event) {
  const reqOrigin = getHeader(event.headers, "origin");
  if (!reqOrigin) return "*";
  if (ALLOWLIST.includes("*")) return "*";
  if (ALLOWLIST.includes(reqOrigin)) return reqOrigin;
  if (reqOrigin.endsWith(".amplifyapp.com")) return reqOrigin;
  return "null";
}

function baseHeaders(event, extra = {}) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": pickOrigin(event),
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Expose-Headers": EXPOSE_HEADERS,
    "Access-Control-Max-Age": MAX_AGE,
    Vary: "Origin",
    ...extra,
  };
}

// stable traceId per request (pinned to event._traceId)
function getTraceId(event = {}) {
  if (event && event._traceId) return event._traceId;

  return (
    getHeader(event.headers, "x-trace-id") ||
    getHeader(event.headers, "X-Trace-Id") ||
    event.requestContext?.requestId ||
    `trc_${Math.random().toString(36).slice(2, 10)}`
  );
}

function response(event, statusCode, body = {}, extraHeaders = {}) {
  const traceId = getTraceId(event);
  const payload = {
    ok: statusCode < 400,
    status: statusCode,
    data: statusCode < 400 ? body : null,
    error: statusCode >= 400 ? body : null,
    traceId,
  };
  return {
    statusCode,
    headers: baseHeaders(event, { "X-Trace-Id": traceId, ...extraHeaders }),
    body: JSON.stringify(payload),
  };
}

function flatResponse(event, statusCode, body = {}, extraHeaders = {}) {
  const traceId = getTraceId(event);
  const payload = { ...body, traceId };
  return {
    statusCode,
    headers: baseHeaders(event, { "X-Trace-Id": traceId, ...extraHeaders }),
    body: JSON.stringify(payload),
  };
}

function rawJsonResponse(event, statusCode, body = {}, extraHeaders = {}) {
  const traceId = getTraceId(event);
  return {
    statusCode,
    headers: baseHeaders(event, { "X-Trace-Id": traceId, ...extraHeaders }),
    body: JSON.stringify(body),
  };
}

function log(src, msg, extra = {}) {
  console.log(JSON.stringify({ src, msg, time: new Date().toISOString(), ...extra }));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Optional Snooze Profile + Zoho integration
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let buildSnoozeProfile = null;
let mapProfileToZohoFields = null;
try {
  const sp = require("./services/snoozeProfile");
  buildSnoozeProfile = sp.buildSnoozeProfile;
  mapProfileToZohoFields = sp.mapProfileToZohoFields;
} catch (e) {
  console.log("âš ï¸ snoozeProfile service not loaded.", e.message);
}

let upsertContactByShopperId = null;
try {
  const zohoSvc = require("./services/zoho");
  upsertContactByShopperId = zohoSvc.upsertContactByShopperId;
} catch (e) {
  console.log("âš ï¸ Zoho service not loaded for Snooze Profile.", e.message);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Optional Assessment Snapshot (Zoho + Dynamo unified view)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let getAssessmentSnapshot = null;
try {
  ({ getAssessmentSnapshot } = require("./handlers/getAssessmentSnapshot"));
} catch (e) {
  console.log("âš ï¸ getAssessmentSnapshot handler not loaded.", e.message);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Path + Body helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function normalizePath(event) {
  const raw = event.rawPath || event.path || "/";
  const stage = event.requestContext?.stage;
  if (!stage) return raw;
  return raw.replace(new RegExp(`^/${stage}(?=/|$)`, "i"), "") || "/";
}

function safeJsonBody(event) {
  try {
    let raw = event.body;

    if (event.isBase64Encoded && typeof raw === "string") {
      raw = Buffer.from(raw, "base64").toString("utf-8");
    }

    if (typeof raw === "string") return JSON.parse(raw || "{}");
    if (typeof raw === "object" && raw !== null) return raw;
  } catch (e) {
    log("body.parse.error", e.message, {
      snippet: String(event.body || "").slice(0, 80),
    });
  }
  return {};
}

function parseCookies(event) {
  const cookieHeader =
    getHeader(event.headers, "cookie") ||
    getHeader(event.headers, "Cookie") ||
    "";
  const out = {};
  cookieHeader.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

function makeSessionId() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function deriveEffectiveThreadId(event, payload) {
  const p = payload || {};
  const headerSid =
    getHeader(event.headers, "x-session-id") ||
    getHeader(event.headers, "X-Session-Id") ||
    null;

  const cookies = parseCookies(event);
  const cookieSid = cookies.sessionId || cookies.sid || cookies.thread_id || null;

  return (
    p.thread_id ||
    p.sessionId ||
    headerSid ||
    cookieSid ||
    (p.shopperId ? `shopper_${String(p.shopperId).trim()}` : null) ||
    makeSessionId()
  );
}

const HUD_ASK_ACTION_ASSESSMENT = Object.freeze({
  label: "Take Snooze Assessment",
  type: "page",
  href: "/pages/snooze-assessment",
});

const HUD_ASK_ACTION_BOOKING = Object.freeze({
  label: "Book Your Snooze Session",
  type: "page",
  href: "/pages/book-your-snooze-session",
});

const HUD_ASK_PAGE_ASSESSMENT = Object.freeze({
  label: "Take Snooze Assessment",
  href: "/pages/snooze-assessment",
});

const HUD_ASK_PAGE_BOOKING = Object.freeze({
  label: "Book Your Snooze Session",
  href: "/pages/book-your-snooze-session",
});

const HUD_ASK_COLLECTION_MATTRESSES = Object.freeze({
  label: "Shop Mattresses",
  handle: "mattresses",
  href: "/collections/mattresses",
});

const HUD_ASK_DEFAULT_CHIPS = Object.freeze([
  { label: "I sleep hot", value: "I sleep hot" },
  { label: "I need firm support", value: "I need firm support" },
  { label: "I snore", value: "I snore" },
  { label: "Help me compare mattresses", value: "compare foam vs hybrid" },
]);

const HUD_ASK_FALLBACK_CHIPS = Object.freeze([
  { label: "I sleep hot", value: "I sleep hot" },
  { label: "I need firm support", value: "I need firm support" },
  { label: "Help me compare mattresses", value: "compare foam vs hybrid" },
  { label: "Take Snooze Assessment", value: "take snooze assessment" },
]);

const HUD_ASK_HOME_CHIPS = Object.freeze([
  { label: "I sleep hot", value: "I sleep hot" },
  { label: "I need firm support", value: "I need firm support" },
  { label: "Compare mattresses", value: "compare foam vs hybrid" },
  { label: "Take Snooze Assessment", value: "take snooze assessment" },
]);

const HUD_ASK_COLLECTION_CHIPS = Object.freeze([
  { label: "Compare foam vs hybrid", value: "compare foam vs hybrid" },
  { label: "I need firm support", value: "I need firm support" },
  { label: "I sleep hot", value: "I sleep hot" },
]);

const HUD_ASK_PRODUCT_CHIPS = Object.freeze([
  { label: "Is this good for back pain?", value: "my back hurts" },
  { label: "Compare this type", value: "compare foam vs hybrid" },
  { label: "Take Snooze Assessment", value: "take snooze assessment" },
]);

const HUD_ASK_PAGE_ASSESSMENT_CHIPS = Object.freeze([
  { label: "Take Snooze Assessment", value: "take snooze assessment" },
  { label: "Help me compare mattresses", value: "compare foam vs hybrid" },
  { label: "Book a Snooze Session", value: "book a snooze session" },
]);

const HUD_ASK_PAGE_BOOKING_CHIPS = Object.freeze([
  { label: "Book a Snooze Session", value: "book a snooze session" },
  { label: "Take Snooze Assessment", value: "take snooze assessment" },
  { label: "Help me compare mattresses", value: "compare foam vs hybrid" },
]);

const HUD_ASK_CART_CHIPS = Object.freeze([
  { label: "Am I choosing right?", value: "am I choosing right" },
  { label: "Take Snooze Assessment", value: "take snooze assessment" },
  { label: "Book a Snooze Session", value: "book a snooze session" },
]);

const HUD_ASK_SEARCH_CHIPS = Object.freeze([
  { label: "I sleep hot", value: "I sleep hot" },
  { label: "I need firm support", value: "I need firm support" },
  { label: "Compare foam vs hybrid", value: "compare foam vs hybrid" },
  { label: "Take Snooze Assessment", value: "take snooze assessment" },
]);

const HUD_ASK_INTENT_CONFIG = Object.freeze({
  default: {
    reply: "Start with how you sleep. I'll guide you from there.",
    chips: HUD_ASK_DEFAULT_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  sleep_hot: {
    reply:
      "Cooling comfort usually starts with breathable materials and the right support feel.",
    chips: [
      { label: "Compare foam vs hybrid", value: "compare foam vs hybrid" },
      { label: "I need firm support", value: "I need firm support" },
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
    ],
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  firm_support: {
    reply:
      "Firm support can help keep your body aligned without making the bed feel rigid.",
    chips: [
      { label: "I have back pain", value: "I have back pain" },
      { label: "Compare mattresses", value: "compare foam vs hybrid" },
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
    ],
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  back_pain: {
    reply:
      "For back discomfort, focus on support, pressure relief, and keeping your spine neutral.",
    chips: [
      { label: "I need firm support", value: "I need firm support" },
      { label: "I sleep hot", value: "I sleep hot" },
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
    ],
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  snoring: {
    reply:
      "Elevation may help some sleepers breathe easier, especially when paired with the right base.",
    chips: [
      { label: "Book Your Snooze Session", value: "book snooze session" },
      { label: "Compare mattresses", value: "compare foam vs hybrid" },
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
    ],
    actions: [HUD_ASK_ACTION_BOOKING],
    collections: [],
    pages: [HUD_ASK_PAGE_ASSESSMENT],
  },
  compare_mattresses: {
    reply:
      "Foam usually feels more contouring. Hybrid usually adds more lift, airflow, and bounce.",
    chips: [
      { label: "I sleep hot", value: "I sleep hot" },
      { label: "I need firm support", value: "I need firm support" },
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
    ],
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  assessment_help: {
    reply: "The Snooze Assessment is the fastest way to narrow the right direction.",
    chips: [
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
      { label: "Help me compare mattresses", value: "compare foam vs hybrid" },
      { label: "Book Your Snooze Session", value: "book snooze session" },
    ],
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  booking_help: {
    reply:
      "A Snooze Session lets you test the experience in person without a traditional sales floor.",
    chips: [
      { label: "Book Your Snooze Session", value: "book snooze session" },
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
      { label: "Help me compare mattresses", value: "compare foam vs hybrid" },
    ],
    actions: [HUD_ASK_ACTION_BOOKING],
    collections: [],
    pages: [HUD_ASK_PAGE_ASSESSMENT],
  },
  fallback: {
    reply: "I can still guide you. Try one of these starting points.",
    chips: HUD_ASK_FALLBACK_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
});

function normalizeHudAskText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sanitizeHudAskPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function hudAskPathStartsWithSegment(path, segment) {
  const normalizedPath = sanitizeHudAskPath(path).toLowerCase();
  const normalizedSegment = sanitizeHudAskPath(segment).toLowerCase();
  return normalizedPath === normalizedSegment || normalizedPath.startsWith(`${normalizedSegment}/`);
}

function normalizeHudAskPageType(value, path = "/") {
  const normalized = normalizeHudAskText(value);
  if (normalized === "index") return "home";

  if (
    normalized === "home" ||
    normalized === "collection" ||
    normalized === "product" ||
    normalized === "page" ||
    normalized === "cart" ||
    normalized === "search" ||
    normalized === "unknown"
  ) {
    return normalized;
  }

  const normalizedPath = sanitizeHudAskPath(path).toLowerCase();
  if (normalizedPath === "/") return "home";
  if (hudAskPathStartsWithSegment(normalizedPath, "/collections")) return "collection";
  if (hudAskPathStartsWithSegment(normalizedPath, "/products")) return "product";
  if (hudAskPathStartsWithSegment(normalizedPath, "/pages")) return "page";
  if (hudAskPathStartsWithSegment(normalizedPath, "/cart")) return "cart";
  if (hudAskPathStartsWithSegment(normalizedPath, "/search")) return "search";
  return "unknown";
}

function isHudAskAssessmentPath(path) {
  return hudAskPathStartsWithSegment(path, "/pages/snooze-assessment");
}

function isHudAskBookingPath(path) {
  return hudAskPathStartsWithSegment(path, "/pages/book-your-snooze-session");
}

function includesHudAskKeyword(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function resolveHudAskIntent(query) {
  const normalized = normalizeHudAskText(query);
  if (!normalized) return "default";

  if (
    includesHudAskKeyword(normalized, [
      "assessment",
      "quiz",
      "help me choose",
      "not sure",
    ])
  ) {
    return "assessment_help";
  }

  if (
    includesHudAskKeyword(normalized, [
      "book",
      "appointment",
      "snooze session",
      "showroom",
      "visit",
    ])
  ) {
    return "booking_help";
  }

  if (
    includesHudAskKeyword(normalized, [
      "snore",
      "snoring",
      "elevation",
      "raise head",
      "adjustable base",
    ])
  ) {
    return "snoring";
  }

  if (
    includesHudAskKeyword(normalized, [
      "compare",
      "foam vs hybrid",
      "hybrid",
      "foam",
      "difference",
    ])
  ) {
    return "compare_mattresses";
  }

  if (
    includesHudAskKeyword(normalized, [
      "back pain",
      "back hurts",
      "lower back",
      "pressure",
      "alignment",
    ])
  ) {
    return "back_pain";
  }

  if (includesHudAskKeyword(normalized, ["firm", "support", "too soft"])) {
    return "firm_support";
  }

  if (includesHudAskKeyword(normalized, ["sleep hot", "hot", "cooling", "sweat", "warm"])) {
    return "sleep_hot";
  }

  return "fallback";
}

function cloneHudAskChip(chip = {}) {
  return {
    label: String(chip.label || "").trim(),
    value: String(chip.value || chip.label || "").trim(),
  };
}

function cloneHudAskAction(action = {}) {
  return {
    label: String(action.label || "").trim(),
    type: String(action.type || "page").trim(),
    href: String(action.href || "").trim(),
  };
}

function cloneHudAskCollection(collection = {}) {
  return {
    label: String(collection.label || "").trim(),
    handle: String(collection.handle || "").trim(),
    href: String(collection.href || "").trim(),
  };
}

function cloneHudAskPage(page = {}) {
  return {
    label: String(page.label || "").trim(),
    href: String(page.href || "").trim(),
  };
}

function cloneHudAskChips(chips = []) {
  return chips.map((chip) => cloneHudAskChip(chip)).filter((chip) => chip.label && chip.value);
}

function cloneHudAskActions(actions = []) {
  return actions
    .map((action) => cloneHudAskAction(action))
    .filter((action) => action.label && action.type && action.href);
}

function cloneHudAskCollections(collections = []) {
  return collections
    .map((collection) => cloneHudAskCollection(collection))
    .filter((collection) => collection.label && collection.handle && collection.href);
}

function cloneHudAskPages(pages = []) {
  return pages.map((page) => cloneHudAskPage(page)).filter((page) => page.label && page.href);
}

function buildHudAskReplyForContext({ intent, pageType, path, baseReply }) {
  if (pageType === "collection") {
    switch (intent) {
      case "sleep_hot":
        return "While you browse, focus on breathable materials and the support feel that stays comfortable through the night.";
      case "firm_support":
        return "As you browse, look for support and alignment without making the bed feel rigid.";
      case "back_pain":
        return "As you browse, focus on support, pressure relief, and keeping your spine neutral.";
      case "snoring":
        return "If elevation matters, compare the mattress feel first, then pair it with the right base.";
      case "compare_mattresses":
        return "While you browse, compare feel, airflow, support, and bounce rather than guessing from names alone.";
      case "assessment_help":
        return "The Snooze Assessment can narrow the right direction before you keep browsing.";
      case "booking_help":
        return "You can keep browsing here, or book a Snooze Session to test the feel in person.";
      default:
        return "Browse by feel, support, and cooling, then use the Snooze Assessment if you want a clearer direction.";
    }
  }

  if (pageType === "product") {
    switch (intent) {
      case "sleep_hot":
        return "Use this page to check comfort materials, airflow, and support details. The Snooze Assessment can help confirm fit.";
      case "firm_support":
        return "Use this page to check support feel, comfort details, and overall fit. The Snooze Assessment can help confirm fit.";
      case "back_pain":
        return "Use this page to check support, pressure relief, and comfort details. The Snooze Assessment can help confirm fit.";
      case "snoring":
        return "Use this page to check comfort details first. If elevation matters, pair that with the right base.";
      case "compare_mattresses":
        return "Use this page to check feel, support, and comfort details, then compare that against the next type.";
      case "booking_help":
        return "If you want to test the feel in person, a Snooze Session can help confirm fit.";
      default:
        return "Use this page to check feel, support, and comfort details. The Snooze Assessment can help confirm fit.";
    }
  }

  if (pageType === "page") {
    if (isHudAskAssessmentPath(path)) {
      if (intent === "booking_help") {
        return "You can book a Snooze Session later. The Snooze Assessment is the fastest way to narrow the right direction first.";
      }
      return "The Snooze Assessment is the fastest way to narrow the right direction.";
    }

    if (isHudAskBookingPath(path)) {
      if (intent === "assessment_help") {
        return "The Snooze Assessment can narrow the right direction before your Snooze Session.";
      }
      return "A Snooze Session lets you test the experience in person without a traditional sales floor.";
    }
  }

  if (pageType === "cart") {
    return "Before you finish, make sure the feel, support, and setup match how you sleep.";
  }

  if (pageType === "search") {
    return "Use a few key sleep needs to narrow the right direction.";
  }

  return baseReply;
}

function resolveHudAskContextualConfig({ intent, pageType, path }) {
  const baseConfig = HUD_ASK_INTENT_CONFIG[intent] || HUD_ASK_INTENT_CONFIG.fallback;
  const normalizedPageType = normalizeHudAskPageType(pageType, path);
  const reply = buildHudAskReplyForContext({
    intent,
    pageType: normalizedPageType,
    path,
    baseReply: baseConfig.reply,
  });

  if (normalizedPageType === "home") {
    return {
      reply,
      chips: HUD_ASK_HOME_CHIPS,
      actions: [HUD_ASK_ACTION_ASSESSMENT],
      collections: [HUD_ASK_COLLECTION_MATTRESSES],
      pages: [HUD_ASK_PAGE_BOOKING],
    };
  }

  if (normalizedPageType === "collection") {
    return {
      reply,
      chips: HUD_ASK_COLLECTION_CHIPS,
      actions: [HUD_ASK_ACTION_ASSESSMENT],
      collections: [HUD_ASK_COLLECTION_MATTRESSES],
      pages: [],
    };
  }

  if (normalizedPageType === "product") {
    return {
      reply,
      chips: HUD_ASK_PRODUCT_CHIPS,
      actions: [HUD_ASK_ACTION_ASSESSMENT],
      collections: [],
      pages: [],
    };
  }

  if (normalizedPageType === "page" && isHudAskAssessmentPath(path)) {
    return {
      reply,
      chips: HUD_ASK_PAGE_ASSESSMENT_CHIPS,
      actions: [HUD_ASK_ACTION_ASSESSMENT],
      collections: [],
      pages: [HUD_ASK_PAGE_BOOKING],
    };
  }

  if (normalizedPageType === "page" && isHudAskBookingPath(path)) {
    return {
      reply,
      chips: HUD_ASK_PAGE_BOOKING_CHIPS,
      actions: [HUD_ASK_ACTION_BOOKING],
      collections: [],
      pages: [HUD_ASK_PAGE_ASSESSMENT],
    };
  }

  if (normalizedPageType === "cart") {
    return {
      reply,
      chips: HUD_ASK_CART_CHIPS,
      actions: [HUD_ASK_ACTION_ASSESSMENT],
      collections: [],
      pages: [HUD_ASK_PAGE_BOOKING],
    };
  }

  if (normalizedPageType === "search") {
    return {
      reply,
      chips: HUD_ASK_SEARCH_CHIPS,
      actions: [HUD_ASK_ACTION_ASSESSMENT],
      collections: [HUD_ASK_COLLECTION_MATTRESSES],
      pages: [],
    };
  }

  return {
    reply,
    chips: baseConfig.chips,
    actions: baseConfig.actions,
    collections: baseConfig.collections,
    pages: baseConfig.pages,
  };
}

function buildHudAskPayload({
  intent = "fallback",
  path = "/",
  pageType = "unknown",
  latencyMs = 0,
  threadId = null,
  error = null,
  source = "live",
} = {}) {
  const normalizedPath = sanitizeHudAskPath(path);
  const normalizedPageType = normalizeHudAskPageType(pageType, normalizedPath);
  const config = resolveHudAskContextualConfig({
    intent,
    pageType: normalizedPageType,
    path: normalizedPath,
  });

  return {
    status: "ok",
    reply: config.reply,
    intent,
    chips: cloneHudAskChips(config.chips),
    actions: cloneHudAskActions(config.actions),
    products: [],
    collections: cloneHudAskCollections(config.collections),
    pages: cloneHudAskPages(config.pages),
    meta: {
      path: normalizedPath,
      source,
      latency_ms: Math.max(0, Math.round(Number(latencyMs) || 0)),
      error: error || null,
    },
    thread_id: threadId || null,
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Polly helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function normalizePollyEngine(engine) {
  const e = String(engine || "").toLowerCase().trim();
  if (e === "generative") return "generative";
  if (e === "long-form" || e === "long_form" || e === "longform") return "long-form";
  if (e === "standard") return "standard";
  return "neural";
}

function normalizePollyFormat(format) {
  const f = String(format || "").toLowerCase().trim();
  if (f === "ogg_vorbis" || f === "ogg-vorbis") return "ogg_vorbis";
  if (f === "pcm") return "pcm";
  return "mp3";
}

function guessTextType({ ssml, text }) {
  if (typeof ssml === "string" && ssml.trim()) return "ssml";
  if (typeof text === "string" && text.trim().startsWith("<speak>")) return "ssml";
  return "text";
}

async function streamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);

  if (Buffer.isBuffer(stream)) return stream;
  if (stream instanceof Uint8Array) return Buffer.from(stream);

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function synthesizePollyAudio({
  text,
  ssml,
  voiceId = "Ruth",
  engine = "generative",
  format = "mp3",
}) {
  if (!polly || !SynthesizeSpeechCommand) {
    throw new Error("Polly client is not available in this runtime.");
  }

  const textType = guessTextType({ ssml, text });
  const inputText =
    textType === "ssml"
      ? String(ssml || text || "").trim()
      : String(text || "").trim();

  if (!inputText) {
    throw new Error("Voice synthesis requires text or ssml.");
  }

  const normalizedEngine = normalizePollyEngine(engine);
  const normalizedFormat = normalizePollyFormat(format);

  const cmd = new SynthesizeSpeechCommand({
    Engine: normalizedEngine,
    OutputFormat: normalizedFormat,
    Text: inputText,
    TextType: textType,
    VoiceId: String(voiceId || "Ruth"),
  });

  const out = await polly.send(cmd);
  const audioBuffer = await streamToBuffer(out?.AudioStream);

  if (!audioBuffer || !audioBuffer.length) {
    throw new Error("Polly returned an empty audio stream.");
  }

  return {
    audioBuffer,
    contentType: out?.ContentType || (normalizedFormat === "mp3" ? "audio/mpeg" : "audio/ogg"),
    requestCharacters: out?.RequestCharacters || inputText.length,
    voiceId: String(voiceId || "Ruth"),
    engine: normalizedEngine,
    format: normalizedFormat,
    textType,
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Snoozer Context Object (SCO) builders
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function nowIso() {
  return new Date().toISOString();
}

function ttlEpochSeconds(days = 30) {
  const seconds = Math.floor(Date.now() / 1000);
  return seconds + days * 24 * 60 * 60;
}

function buildDefaultSCO(sessionId, source = "kiosk", storeId = "mysnoozepod-1") {
  const iso = nowIso();

  return {
    sessionId,
    phase: "welcome",
    zoneContext: "welcomeZone",

    session: {
      createdAt: iso,
      updatedAt: iso,
      lastActiveAt: iso,
      source,
      storeId,
      isReturning: false,
    },

    customer: {
      preferredName: "",
      email: "",
      phone: "",
      contactPreference: "none",
      consent: { smsOptIn: false, emailOptIn: false, timestamp: "" },
    },

    shoppingFor: "self",
    timeline: "browsing",

    shopperProfile: {
      sleepPosition: "unsure",
      painPoints: ["unsure"],
      sleepsHot: "unsure",
      firmnessPref: "unsure",
    },

    budgetRange: { min: 0, max: 0 },
    priorityRank: ["price"],

    mattress: { sizeTarget: "unsure" },
    bedFrameType: "unsure",
    adjustableBaseInterest: "maybe",
    deliveryPreference: "undecided",

    candidates: [],
    favorites: [],
    decisionStatus: "exploring",
    confidenceScore: 0,

    cartState: {
      items: [],
      lastViewedHandle: "",
      lastAddedHandle: "",
    },

    ids: {
      cartId: "",
      checkoutId: "",
      zohoLeadId: "",
      shopifyCustomerId: "",
    },
    checkoutUrl: "",

    retrievalHints: {
      tags: [],
      constraints: [],
      preferredCollections: [],
      mustHave: [],
      avoid: [],
    },

    iotSignals: {
      recentEvents: [],
      currentPod: null,
      dwellSecondsByZone: {},
    },

    progress: {
      assessmentCompleted: false,
      podsTried: [],
      lastCheckpoint: "welcome",
    },

    notes: { freeform: "" },
    objections: [],
  };
}

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function deepMerge(target, patch) {
  if (!isObject(target)) return isObject(patch) ? { ...patch } : patch;
  if (!isObject(patch)) return target;

  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

// Normalize legacy patch shapes into SCO schema
function normalizeContextPatch(patch, aiResult = null) {
  const p = isObject(patch) ? { ...patch } : {};

  if (!p.checkoutUrl && typeof p.lastCheckoutUrl === "string") {
    p.checkoutUrl = p.lastCheckoutUrl;
  }

  const rootCartId = typeof p.cartId === "string" ? p.cartId : null;
  if (rootCartId) {
    p.ids = isObject(p.ids) ? { ...p.ids, cartId: rootCartId } : { cartId: rootCartId };
    delete p.cartId;
  }

  if (aiResult && typeof aiResult === "object") {
    if (typeof aiResult.checkoutUrl === "string" && aiResult.checkoutUrl) {
      p.checkoutUrl = p.checkoutUrl || aiResult.checkoutUrl;
    }
    if (typeof aiResult.cartId === "string" && aiResult.cartId) {
      p.ids = isObject(p.ids)
        ? { ...p.ids, cartId: p.ids.cartId || aiResult.cartId }
        : { cartId: aiResult.cartId };
    }
  }

  return p;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Deterministic pod anchoring
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function normalizePodAnchors(payloadContext = {}, payload = {}) {
  const ctx = isObject(payloadContext) ? { ...payloadContext } : {};

  // Accept pod identity from multiple places
  const podId =
    payload?.podId ||
    payload?.pod_id ||
    payload?.zone ||
    ctx?.podId ||
    ctx?.pod_id ||
    ctx?.zone?.podId ||
    ctx?.zone?.id ||
    null;

  if (podId != null) {
    const s = String(podId).trim();
    if (s) ctx.podId = s;
  }

  // UI may send exploreContext (Pod.jsx does)
  const explore =
    (Array.isArray(ctx.explore) && ctx.explore) ||
    (Array.isArray(ctx.exploreContext) && ctx.exploreContext) ||
    (Array.isArray(payload?.exploreContext) && payload.exploreContext) ||
    [];

  if (!Array.isArray(ctx.explore) || ctx.explore.length === 0) {
    if (explore.length) ctx.explore = explore;
  }

  // Keep lastViewedHandle anchored to first explore item (usually mattress)
  if (Array.isArray(ctx.explore) && ctx.explore.length) {
    const firstHandle = ctx.explore[0]?.handle ? String(ctx.explore[0].handle).trim() : "";
    if (firstHandle) {
      ctx.cartState = isObject(ctx.cartState) ? { ...ctx.cartState } : {};
      if (!ctx.cartState.lastViewedHandle) ctx.cartState.lastViewedHandle = firstHandle;
    }
  }

  return ctx;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sessions storage
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getSessionItem(sessionId) {
  const out = await ddbDoc.send(new GetCommand({ TableName: SESSIONS_TABLE, Key: { sessionId } }));
  return out.Item || null;
}

async function putSessionItemIfMissing({ sessionId, context, iso, ttl }) {
  await ddbDoc.send(
    new PutCommand({
      TableName: SESSIONS_TABLE,
      Item: { sessionId, context, createdAt: iso, updatedAt: iso, lastActiveAt: iso, ttl },
      ConditionExpression: "attribute_not_exists(sessionId)",
    })
  );
}

async function saveSessionContext(sessionId, context) {
  const iso = nowIso();
  const ttl = ttlEpochSeconds(30);

  await ddbDoc.send(
    new UpdateCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId },
      UpdateExpression: "SET #context = :c, updatedAt = :u, lastActiveAt = :u, #ttl = :t",
      ExpressionAttributeNames: { "#context": "context", "#ttl": "ttl" },
      ExpressionAttributeValues: { ":c": context, ":u": iso, ":t": ttl },
      ReturnValues: "NONE",
    })
  );

  return { iso, ttl };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Assessment + Content Logic (S3-backed)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchQuestionsObject() {
  const res = await s3.send(new GetObjectCommand({ Bucket: QUESTIONS_BUCKET, Key: QUESTIONS_KEY }));
  const chunks = [];
  for await (const c of res.Body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function headQuestionsObject() {
  const head = await s3.send(new HeadObjectCommand({ Bucket: QUESTIONS_BUCKET, Key: QUESTIONS_KEY }));
  return { etag: head.ETag, lastModified: head.LastModified };
}

async function loadAssessmentQuestions() {
  const now = Date.now();

  if (questionsCache.data && now - questionsCache.ts < QUESTIONS_TTL_MS) {
    return {
      data: questionsCache.data,
      meta: { etag: questionsCache.etag, lastModified: questionsCache.lastModified },
    };
  }

  if (questionsInFlight) {
    return await questionsInFlight;
  }

  questionsInFlight = (async () => {
    const headStep = await measureStep("assessment_head", () =>
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

    if (
      questionsCache.data &&
      head.etag === questionsCache.etag &&
      now - questionsCache.ts < QUESTIONS_TTL_MS
    ) {
      return {
        data: questionsCache.data,
        meta: { etag: questionsCache.etag, lastModified: questionsCache.lastModified },
      };
    }

    const bodyStep = await measureStep("assessment_get", () =>
      withTimeout(
        fetchQuestionsObject(),
        S3_RETRIEVAL_TIMEOUT_MS,
        "ASSESSMENT_GET_TIMEOUT",
        `Assessment GET exceeded ${S3_RETRIEVAL_TIMEOUT_MS}ms`,
        { bucket: QUESTIONS_BUCKET, key: QUESTIONS_KEY }
      )
    );

    if (!bodyStep.ok) throw bodyStep.error;

    const data = bodyStep.value;
    questionsCache = { data, etag: head.etag, lastModified: head.lastModified, ts: Date.now() };

    return { data, meta: { etag: head.etag, lastModified: head.lastModified } };
  })();

  try {
    return await questionsInFlight;
  } finally {
    questionsInFlight = null;
  }
}

function fmtLastModified(d) {
  try {
    return d instanceof Date ? d.toUTCString() : new Date(d).toUTCString();
  } catch {
    return undefined;
  }
}

function normalizeEtag(etag) {
  if (!etag) return "";
  return String(etag).trim();
}

async function saveAssessmentResult(shopperId, answers) {
  if (!RESULTS_TABLE) return;
  const Item = {
    shopperId,
    answers,
    updatedAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + 2_592_000,
  };
  await ddbDoc.send(new PutCommand({ TableName: RESULTS_TABLE, Item }));
}

async function getAssessmentResult(shopperId) {
  if (!RESULTS_TABLE) return null;
  const out = await ddbDoc.send(new GetCommand({ TableName: RESULTS_TABLE, Key: { shopperId } }));
  return out.Item || null;
}

// optional seed recs for non-pod routes only
async function getSeedRecommendations(shopperId) {
  const assess = await getAssessmentResult(shopperId);
  const answers = assess?.answers || {};
  const tags = [];

  const pos = (answers.sleepPosition || answers.position || "").toString().toLowerCase();
  const hot = !!answers.temperatureSensitive || /hot|warm/.test(String(answers.temperature || ""));
  const pain = (answers.painPoints || []).map(String).join(",").toLowerCase();

  if (pos.includes("side")) tags.push("firmness:medium-soft");
  if (pos.includes("back")) tags.push("support:lumbar");
  if (hot) tags.push("cooling:gels");
  if (pain.includes("lower") || pain.includes("back")) tags.push("support:lumbar");

  return { products: [], hints: tags.slice(0, 4), source: "assessment" };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// IoT Scene Trigger (publish to IoT Core if configured)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function triggerScene({ podId, scene }) {
  if (!IOT_ENDPOINT || !IoTDataPlaneClient || !PublishCommand) {
    return { ok: false, reason: "iot_disabled" };
  }

  const client = new IoTDataPlaneClient({
    region: REGION,
    endpoint: `https://${IOT_ENDPOINT}`,
  });

  const topic = `${IOT_DEFAULT_TOPIC}/${podId || "Z1"}`;
  const payload = Buffer.from(
    JSON.stringify({
      ts: Date.now(),
      scene: scene || "default",
      podId: podId || "Z1",
    })
  );

  await client.send(new PublishCommand({ topic, qos: 0, payload }));
  return { ok: true, topic };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Main
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handle(event = {}) {
  const method = (event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();

  const path = normalizePath(event);
  const routePath = path.startsWith("/api/") ? path.slice(4) : path;

  const traceId = getTraceId(event);
  event._traceId = traceId;

  log("req", "incoming", { method, path, routePath, traceId });

  if (method === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders(event), body: "" };
  }

  if (method === "GET" && (routePath === "/" || routePath === "/health")) {
    return response(event, 200, {
      ok: true,
      service: "omnia-api",
      ts: new Date().toISOString(),
    });
  }

  if (method === "POST" && routePath === "/hud/ask") {
    const startedAt = Date.now();
    const body = safeJsonBody(event);

    try {
      const query = typeof body?.query === "string" ? body.query.trim() : "";
      const pathValue = sanitizeHudAskPath(body?.path || "/");
      const pageType = normalizeHudAskPageType(body?.page_type || "unknown", pathValue);
      const surface = String(body?.surface || "shopify_header").trim().toLowerCase() || "shopify_header";
      const requestId = String(event?.requestContext?.requestId || traceId || "").trim() || null;
      console.log("[hud/ask] invoked", {
        path: pathValue,
        method,
        query,
        page_type: pageType,
        surface,
        requestId,
      });
      const threadId = deriveEffectiveThreadId(event, {
        thread_id: body?.thread_id,
        sessionId: body?.session_id,
      });
      const intent = resolveHudAskIntent(query);
      const payload = buildHudAskPayload({
        intent,
        path: pathValue,
        pageType,
        latencyMs: elapsedMs(startedAt),
        threadId,
      });

      log("hud.ask", "ok", {
        traceId,
        threadId,
        intent,
        path: pathValue,
        pageType,
        surface,
        latencyMs: payload.meta.latency_ms,
      });

      return rawJsonResponse(event, 200, payload);
    } catch (e) {
      const fallback = buildHudAskPayload({
        intent: "fallback",
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Voice: Welcome / Polly
  if (method === "POST" && routePath === "/voice/welcome") {
    const body = safeJsonBody(event);

    try {
      const shopperId = body?.shopperId ? String(body.shopperId).trim() : "";
      const text = typeof body?.text === "string" ? body.text : "";
      const ssml = typeof body?.ssml === "string" ? body.ssml : "";
      const voiceId = body?.voiceId || "Ruth";
      const engine = body?.engine || "generative";
      const format = body?.format || "mp3";

      if (!text && !ssml) {
        return response(event, 400, {
          code: "E_VOICE_TEXT_REQUIRED",
          message: "text or ssml is required",
        });
      }

      const voiceStep = await measureStep("polly_synthesize", () =>
        withTimeout(
          synthesizePollyAudio({
            text,
            ssml,
            voiceId,
            engine,
            format,
          }),
          POLLY_TIMEOUT_MS,
          "POLLY_TIMEOUT",
          `Polly synthesis exceeded ${POLLY_TIMEOUT_MS}ms`,
          { shopperId, voiceId, engine, format }
        )
      );

      if (!voiceStep.ok) throw voiceStep.error;

      const out = voiceStep.value;

      log("voice.welcome", "ok", {
        traceId,
        shopperId,
        voiceId: out.voiceId,
        engine: out.engine,
        format: out.format,
        textType: out.textType,
        requestCharacters: out.requestCharacters,
        pollyMs: voiceStep.ms,
        timeoutMs: POLLY_TIMEOUT_MS,
      });

      return response(event, 200, {
        ok: true,
        shopperId: shopperId || null,
        audioBase64: out.audioBuffer.toString("base64"),
        contentType: out.contentType,
        voiceId: out.voiceId,
        engine: out.engine,
        format: out.format,
        textType: out.textType,
        requestCharacters: out.requestCharacters,
      });
    } catch (e) {
      log("voice.welcome.error", e.message, {
        traceId,
        timeoutMs: isTimeoutError(e) ? POLLY_TIMEOUT_MS : null,
      });

      return response(event, 500, {
        code: isTimeoutError(e) ? "POLLY_TIMEOUT" : "E_VOICE_WELCOME",
        message: "Failed to synthesize welcome voice",
        details: e.message,
      });
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ HUD TTS
  if (method === "POST" && routePath === "/hud/tts") {
    const body = safeJsonBody(event);

    try {
      const text = typeof body?.text === "string" ? body.text : "";
      const ssml = typeof body?.ssml === "string" ? body.ssml : "";
      const voiceId = body?.voiceId || "Ruth";
      const engine = body?.engine || "generative";
      const format = body?.format || "mp3";

      if (!text && !ssml) {
        return response(event, 400, {
          code: "E_TTS_TEXT_REQUIRED",
          message: "text or ssml is required",
        });
      }

      const voiceStep = await measureStep("hud_tts", () =>
        withTimeout(
          synthesizePollyAudio({
            text,
            ssml,
            voiceId,
            engine,
            format,
          }),
          POLLY_TIMEOUT_MS,
          "POLLY_TIMEOUT",
          `HUD TTS exceeded ${POLLY_TIMEOUT_MS}ms`
        )
      );

      if (!voiceStep.ok) throw voiceStep.error;

      const out = voiceStep.value;

      log("hud.tts", "ok", {
        traceId,
        voiceId: out.voiceId,
        engine: out.engine,
        format: out.format,
        requestCharacters: out.requestCharacters,
        pollyMs: voiceStep.ms,
        totalMs: voiceStep.ms,
      });

      return response(event, 200, {
        ok: true,
        audioBase64: out.audioBuffer.toString("base64"),
        contentType: out.contentType,
        voiceId: out.voiceId,
        engine: out.engine,
        format: out.format,
      });
    } catch (e) {
      log("hud.tts.error", e.message, {
        traceId,
        timeoutMs: isTimeoutError(e) ? POLLY_TIMEOUT_MS : null,
        totalMs: 0,
      });

      return response(event, 500, {
        code: isTimeoutError(e) ? "POLLY_TIMEOUT" : "E_HUD_TTS",
        message: "Failed to synthesize HUD voice",
        details: e.message,
      });
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ HUD Script Resolver
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Content: Assessment JSON (S3)
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

      const ifNoneMatch = getHeader(event.headers, "if-none-match") || getHeader(event.headers, "If-None-Match");

      if (ifNoneMatch && etag && String(ifNoneMatch).trim() === etag && routePath !== "/content/assessment/meta") {
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Sessions: START
  if (method === "POST" && routePath === "/session/start") {
    const body = safeJsonBody(event);

    const source = body.source || "kiosk";
    const storeId = body.storeId || "mysnoozepod-1";

    const sessionId = (crypto.randomUUID && crypto.randomUUID()) || makeSessionId();
    const iso = nowIso();

    const context = buildDefaultSCO(sessionId, source, storeId);

    const Item = {
      sessionId,
      context,
      createdAt: iso,
      updatedAt: iso,
      lastActiveAt: iso,
      ttl: ttlEpochSeconds(30),
    };

    try {
      await ddbDoc.send(
        new PutCommand({
          TableName: SESSIONS_TABLE,
          Item,
          ConditionExpression: "attribute_not_exists(sessionId)",
        })
      );

      log("session.start", "created", { traceId, sessionId, source, storeId });

      return response(event, 200, { sessionId, context }, { "X-Session-Id": sessionId });
    } catch (e) {
      log("session.start.error", e.message, { traceId, sessionId });
      return response(event, 500, {
        code: "E_SESSION_START",
        message: "Failed to start session",
        details: e.message,
      });
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Sessions: GET context
  if (method === "GET" && routePath.startsWith("/session/context/")) {
    const sessionId = decodeURIComponent(routePath.split("/").pop() || "");
    if (!sessionId) return response(event, 400, { message: "sessionId required" });

    try {
      const item = await getSessionItem(sessionId);
      if (!item) {
        return response(event, 404, {
          code: "E_SESSION_NOT_FOUND",
          message: "Session not found",
          sessionId,
        });
      }
      return response(event, 200, { sessionId, context: item.context || null });
    } catch (e) {
      log("session.get.error", e.message, { traceId, sessionId });
      return response(event, 500, {
        code: "E_SESSION_GET",
        message: "Failed to load session context",
        details: e.message,
      });
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Sessions: PATCH context
  if (method === "PATCH" && routePath.startsWith("/session/context/")) {
    const sessionId = decodeURIComponent(routePath.split("/").pop() || "");
    if (!sessionId) return response(event, 400, { message: "sessionId required" });

    const body = safeJsonBody(event);
    const patch =
      body.contextPatch && typeof body.contextPatch === "object"
        ? body.contextPatch
        : typeof body === "object"
          ? body
          : {};

    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return response(event, 400, { message: "contextPatch object required" });
    }

    try {
      const item = await getSessionItem(sessionId);
      if (!item || !item.context) {
        return response(event, 404, {
          code: "E_SESSION_NOT_FOUND",
          message: "Session not found",
          sessionId,
        });
      }

      const merged = deepMerge(item.context, patch);
      await saveSessionContext(sessionId, merged);

      log("session.patch", "ok", { traceId, sessionId });

      return response(event, 200, { sessionId, context: merged });
    } catch (e) {
      log("session.patch.error", e.message, { traceId, sessionId });
      return response(event, 500, {
        code: "E_SESSION_PATCH",
        message: "Failed to patch session context",
        details: e.message,
      });
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Admin reindex
  if (method === "POST" && routePath === "/admin/reindex") {
    const key = getHeader(event.headers, "x-api-key") || "";
    if (ADMIN_API_KEY && key !== ADMIN_API_KEY) {
      return response(event, 401, { code: "E_UNAUTHORIZED", message: "Invalid API key" });
    }
    if (!buildIndexes) {
      return response(event, 501, { code: "E_NOT_AVAILABLE", message: "Indexer not loaded" });
    }
    const out = await buildIndexes();
    return response(event, 200, { ok: true, ...out });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Assessment (legacy endpoints)
  if (method === "GET" && routePath === "/assessment-questions") {
    const loaded = await loadAssessmentQuestions();
    return response(event, 200, loaded.data, {
      ETag: loaded.meta.etag,
      "Last-Modified": fmtLastModified(loaded.meta.lastModified),
      "Cache-Control": "public, max-age=60",
    });
  }

  if (method === "POST" && routePath === "/assessment") {
    const { shopperId, answers, origin } = safeJsonBody(event);
    if (!shopperId) {
      return response(event, 400, { message: "shopperId required" });
    }

    await saveAssessmentResult(shopperId, answers || {});

    if (
      typeof buildSnoozeProfile === "function" &&
      typeof mapProfileToZohoFields === "function" &&
      typeof upsertContactByShopperId === "function"
    ) {
      try {
        const profile = buildSnoozeProfile({
          shopperId,
          origin: origin || "assessment_api",
          answers: answers || {},
        });

        const zohoFields = mapProfileToZohoFields(profile) || {};
        if (Object.keys(zohoFields).length) {
          const zohoResp = await upsertContactByShopperId(shopperId, zohoFields);
          log("assessment.zoho.upsert", "ok", {
            traceId,
            shopperId,
            code: zohoResp?.code,
            contactId: zohoResp?.details?.id,
          });
        } else {
          log("assessment.zoho.upsert", "skip_empty_profile", { traceId, shopperId });
        }
      } catch (e) {
        log("assessment.zoho.error", e.message, { traceId, shopperId });
      }
    } else {
      log("assessment.zoho.disabled", "missing_services", { traceId, shopperId });
    }

    return response(event, 200, { ok: true });
  }

  if (method === "GET" && routePath.startsWith("/assessment/")) {
    const parts = routePath.split("/").filter(Boolean);
    const shopperId = decodeURIComponent(parts[parts.length - 1] || "");
    if (!shopperId) return response(event, 400, { message: "shopperId required" });

    if (typeof getAssessmentSnapshot === "function") {
      try {
        const out = await getAssessmentSnapshot(shopperId);
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Shopify RPC passthroughs
  if (method === "POST" && routePath === "/shopify/listProducts") {
    return await withTimeout(
      shopify.listProducts(event),
      SHOPIFY_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify listProducts exceeded ${SHOPIFY_TIMEOUT_MS}ms`
    );
  }
  if (method === "POST" && routePath === "/shopify/getProduct") {
    return await withTimeout(
      shopify.getProduct(event),
      SHOPIFY_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify getProduct exceeded ${SHOPIFY_TIMEOUT_MS}ms`
    );
  }
  if (method === "POST" && (routePath === "/shopify/createCart" || routePath === "/shopify/cart")) {
    return await withTimeout(
      shopify.createCart(event),
      SHOPIFY_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify createCart exceeded ${SHOPIFY_TIMEOUT_MS}ms`
    );
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Shopify persistent cart ops
  if (method === "POST" && routePath === "/shopify/cart/get") {
    return await withTimeout(
      shopify.getCart(event),
      SHOPIFY_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify getCart exceeded ${SHOPIFY_TIMEOUT_MS}ms`
    );
  }
  if (method === "POST" && routePath === "/shopify/cart/addLines") {
    return await withTimeout(
      shopify.addCartLines(event),
      SHOPIFY_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify addCartLines exceeded ${SHOPIFY_TIMEOUT_MS}ms`
    );
  }
  if (method === "POST" && routePath === "/shopify/cart/updateLines") {
    return await withTimeout(
      shopify.updateCartLines(event),
      SHOPIFY_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify updateCartLines exceeded ${SHOPIFY_TIMEOUT_MS}ms`
    );
  }
  if (method === "POST" && routePath === "/shopify/cart/removeLines") {
    return await withTimeout(
      shopify.removeCartLines(event),
      SHOPIFY_TIMEOUT_MS,
      "SHOPIFY_TIMEOUT",
      `Shopify removeCartLines exceeded ${SHOPIFY_TIMEOUT_MS}ms`
    );
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Rewards
  if (rewardsRoutes) {
    if (method === "GET" && /^\/rewards\/balance\/[^/]+$/.test(routePath)) {
      return await rewardsRoutes.getRewardsBalance(event);
    }
    if (method === "POST" && routePath === "/rewards/earn") {
      return await rewardsRoutes.earnRewards(event);
    }
    if (method === "GET" && routePath === "/rewards/catalog") {
      return await rewardsRoutes.getRewardsCatalog(event);
    }
    if (method === "POST" && routePath === "/rewards/redeem") {
      return await rewardsRoutes.redeemRewards(event);
    }
    if (method === "GET" && routePath === "/rewards/debug/pricerules") {
      return await rewardsRoutes.debugListPriceRules(event);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Ask Snoozer (SCO-aware + deterministic-first)
  if (method === "POST" && (routePath === "/ask-snoozer" || routePath === "/ask")) {
    const startedAt = Date.now();
    const payload = safeJsonBody(event);

    const debug = isDebugRequest(event);

    const msg = payload.message || payload.prompt || payload.text || "";
    const mode = payload.mode || undefined;
    const shopperId = payload.shopperId || null;

    const effectiveSessionId = deriveEffectiveThreadId(event, payload);

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
    context.sessionId = effectiveSessionId;

    // 3) Attach assessment only (NO recs in pod mode)
    try {
      if (shopperId) {
        const assess = await getAssessmentResult(shopperId);
        if (assess) context.assessment = assess;

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
    } catch (ctxErr) {
      log("ask-snoozer.context.error", ctxErr.message, { traceId, shopperId });
    }

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

    // 4) Call Snoozer
    try {
      const { getSnoozerResponse } = require("./services/openai");

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

      const mergedContext =
        sco && typeof sco === "object"
          ? sco
          : aiResult && aiResult.context && typeof aiResult.context === "object"
            ? aiResult.context
            : context;

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
        metrics: {
          retrievalMs: safeNumber(aiResult?.meta?.retrievalMs, 0),
          modelMs,
          totalMs: latencyMs,
          fallbackUsed: false,
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
        fallbackUsed: false,
        timeoutMs: MODEL_TIMEOUT_MS,
        path: env.meta?.path || null,
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ CRM
  if (method === "POST" && routePath === "/crm/track-event") {
    const body = safeJsonBody(event);
    log("crm.event", "track", { ...body, traceId });
    return response(event, 200, { ok: true });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Recommendations
  if (method === "GET" && routePath.startsWith("/recommendations/")) {
    const shopperId = decodeURIComponent(routePath.split("/").pop() || "guest");

    let recs;
    if (recsService && typeof recsService.getRecommendations === "function") {
      recs = await recsService.getRecommendations(shopperId, { mode: "explore" });
    } else {
      recs = await getSeedRecommendations(shopperId);
    }

    return response(event, 200, recs);
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ IoT Scene Trigger
  if (method === "POST" && routePath === "/iot/trigger-scene") {
    const { podId, scene } = safeJsonBody(event);
    try {
      const out = await triggerScene({ podId, scene });
      return response(event, 200, out);
    } catch (e) {
      return response(event, 500, { ok: false, code: "E_IOT", message: e.message });
    }
  }

  return response(event, 404, { message: "Not found" });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Export Lambda
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.lambdaHandler = async (event) => {
  try {
    const out = await handle(event);

    return {
      ...out,
      headers: {
        ...baseHeaders(event),
        ...(out.headers || {}),
      },
    };
  } catch (err) {
    const timeoutCode = isTimeoutError(err) ? String(err.code || "TIMEOUT") : null;

    log("lambda", "error", {
      err: err.message,
      code: timeoutCode,
      timeoutMs: err?.timeoutMs || null,
    });

    return {
      statusCode: 500,
      headers: baseHeaders(event),
      body: JSON.stringify({
        message: "Internal Server Error",
        error: err.message,
        code: timeoutCode || undefined,
      }),
    };
  }
};
