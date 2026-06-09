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
const fs = require("fs");
const path = require("path");
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

let recommendationResolver = null;
try {
  recommendationResolver = require("./services/recommendationResolver");
} catch (error) {
  console.log("âš ï¸ recommendation resolver not loaded (ok).", error.message);
}

let shopifySvc = null;
try {
  shopifySvc = require("./services/shopify");
} catch {
  console.log("Ã¢Å¡Â Ã¯Â¸Â shopify service not loaded (ok).");
}

let openaiSvc = null;
function getOpenAiSvc() {
  if (openaiSvc) return openaiSvc;
  try {
    openaiSvc = require("./services/openai");
  } catch (error) {
    console.log("Ã¢Å¡Â Ã¯Â¸Â openai service helpers not loaded (ok).", error.message);
    openaiSvc = null;
  }
  return openaiSvc;
}

const {
  classifyAskSnoozerIntent,
  hasAskSnoozerBudgetSignal,
  parseAskSnoozerSizeLabel,
} = require("./services/askSnoozerIntents");
const {
  resolveAskSnoozerPolicyAnswer,
  resolveAskSnoozerPolicySources,
  resolveAskSnoozerSupplementalSources,
} = require("./services/askSnoozerPolicy");
const { buildAskSnoozerAnswer } = require("./services/askSnoozerAnswerEngine");
const {
  HUD_SAFE_PAGE_ROUTES,
  HUD_SAFE_COLLECTION_ROUTES,
  HUD_HREF_ALIASES,
  canonicalizeHudHref,
} = require("./services/askSnoozerRoutes");

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
  href: HUD_SAFE_PAGE_ROUTES.assessment,
});

const HUD_ASK_ACTION_BOOKING = Object.freeze({
  label: "Book Your Snooze Session",
  type: "page",
  href: HUD_SAFE_PAGE_ROUTES.booking,
});

const HUD_ASK_PAGE_ASSESSMENT = Object.freeze({
  label: "Take Snooze Assessment",
  href: HUD_SAFE_PAGE_ROUTES.assessment,
});

const HUD_ASK_PAGE_BOOKING = Object.freeze({
  label: "Book Your Snooze Session",
  href: HUD_SAFE_PAGE_ROUTES.booking,
});

const HUD_ASK_COLLECTION_MATTRESSES = Object.freeze({
  label: "Shop Mattresses",
  handle: "mattresses",
  href: HUD_SAFE_COLLECTION_ROUTES.mattresses,
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

const HUD_ASK_BUDGET_CHIPS = Object.freeze([
  { label: "Cheap queen size", value: "cheap queen size" },
  { label: "King size mattress", value: "king size mattress" },
  { label: "I need firm support", value: "I need firm support" },
]);

const HUD_ASK_SIZE_CHIPS = Object.freeze([
  { label: "Queen size mattress", value: "i need a mattress in a queen size" },
  { label: "King size mattress", value: "king size mattress" },
  { label: "I need a split king", value: "i need a split king" },
  { label: "Twin XL", value: "twin xl" },
]);

const HUD_ASK_POLICY_CHIPS = Object.freeze([
  { label: "What is your return policy?", value: "what is your return policy" },
  { label: "How long does delivery take?", value: "how long does delivery take" },
  { label: "Do you offer financing?", value: "do you offer financing" },
]);

const HUD_ASK_INTENT_CONFIG = Object.freeze({
  default: {
    reply: "Start with how you sleep. I can guide the next step from there.",
    chips: HUD_ASK_DEFAULT_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  sleep_hot: {
    reply:
      "If you sleep hot, start with airflow first, then compare how much contouring and support you want.",
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
      "Start with alignment first, then choose how much cushioning you want on top.",
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
      "For back discomfort, compare support and pressure relief together rather than chasing the firmest bed.",
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
      "Elevation may help some sleepers feel more comfortable.",
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
      "Foam usually hugs closer. Hybrid usually adds more lift, airflow, and bounce.",
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
    reply:
      "The Snooze Assessment is the fastest way to narrow this down properly. Use it when comfort, support, or size is unclear.",
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
      "A Snooze Session is the best next step if you want to test the feel before deciding.",
    chips: [
      { label: "Book Your Snooze Session", value: "book snooze session" },
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
      { label: "Help me compare mattresses", value: "compare foam vs hybrid" },
    ],
    actions: [HUD_ASK_ACTION_BOOKING],
    collections: [],
    pages: [HUD_ASK_PAGE_ASSESSMENT],
  },
  assessment_start: {
    reply:
      "Start with one useful sleep question first, then I can narrow the setup from there.",
    chips: HUD_ASK_HOME_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  product_question: {
    reply:
      "Use the current product as the anchor, then compare feel, support, and setup around it.",
    chips: HUD_ASK_PRODUCT_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  couple_conflict: {
    reply:
      "Different comfort needs are where dual-comfort options earn the first look.",
    chips: [
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
      { label: "Book Your Snooze Session", value: "book snooze session" },
      { label: "Compare mattresses", value: "compare foam vs hybrid" },
    ],
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  bundle_price: {
    reply:
      "I can price the mattress and base separately, then give you a safe pre-checkout subtotal when both live prices are available.",
    chips: HUD_ASK_SIZE_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  brand_education: {
    reply:
      "I can explain the setup and the next step without making you guess through the catalog.",
    chips: [
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
      { label: "Book Your Snooze Session", value: "book snooze session" },
      { label: "Compare mattresses", value: "compare foam vs hybrid" },
    ],
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  accessory_help: {
    reply:
      "I can help you finish the setup once the core mattress and base direction is clear.",
    chips: [
      { label: "Do you sell pillows?", value: "do you sell pillows" },
      { label: "What accessories do I need?", value: "what accessories do I need" },
      { label: "Take Snooze Assessment", value: "take snooze assessment" },
    ],
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  budget_value: {
    reply:
      "If value matters most, start with the simpler mattress paths and confirm the right size first.",
    chips: HUD_ASK_BUDGET_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  size_help: {
    reply:
      "Start by narrowing the size you need, then compare feel and support within that size.",
    chips: HUD_ASK_SIZE_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  queen_size: {
    reply: "Start with the Queen options first, then compare feel and support inside that size.",
    chips: HUD_ASK_SIZE_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  king_size: {
    reply: "Start with the King options first, then compare feel and support inside that size.",
    chips: HUD_ASK_SIZE_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  split_king: {
    reply:
      "Split King is usually about matching the mattress and base so each side works the way you want.",
    chips: HUD_ASK_SIZE_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  twin_xl: {
    reply: "Start with the Twin XL options first, then compare feel and support inside that size.",
    chips: HUD_ASK_SIZE_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  full_size: {
    reply: "Start with the Full options first, then compare feel and support inside that size.",
    chips: HUD_ASK_SIZE_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [HUD_ASK_COLLECTION_MATTRESSES],
    pages: [HUD_ASK_PAGE_BOOKING],
  },
  policy_support: {
    reply:
      "Policy details can affect timing, fees, or coverage, so check the exact terms before you decide.",
    chips: HUD_ASK_POLICY_CHIPS,
    actions: [],
    collections: [],
    pages: [],
  },
  cart_confidence: {
    reply:
      "Before you finish, make sure the feel, support, and setup match how you sleep.",
    chips: HUD_ASK_CART_CHIPS,
    actions: [HUD_ASK_ACTION_ASSESSMENT],
    collections: [],
    pages: [HUD_ASK_PAGE_BOOKING],
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
  return hudAskPathStartsWithSegment(path, HUD_SAFE_PAGE_ROUTES.assessment);
}

function isHudAskBookingPath(path) {
  const bookingAliases = [HUD_SAFE_PAGE_ROUTES.booking].concat(
    Object.keys(HUD_HREF_ALIASES).filter((href) => HUD_HREF_ALIASES[href] === HUD_SAFE_PAGE_ROUTES.booking)
  );
  return bookingAliases.some((segment) => hudAskPathStartsWithSegment(path, segment));
}

function includesHudAskKeyword(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function resolveHudAskIntent(query, context = {}) {
  return classifyAskSnoozerIntent(query, context).intent;
}

function isHudAskSizeIntent(intent) {
  return [
    "size_help",
    "queen_size",
    "king_size",
    "split_king",
    "twin_xl",
    "full_size",
  ].includes(String(intent || "").trim());
}

function isHudAskSpecificSizeIntent(intent) {
  return [
    "queen_size",
    "king_size",
    "split_king",
    "twin_xl",
    "full_size",
  ].includes(String(intent || "").trim());
}

function cloneHudAskChip(chip = {}) {
  return {
    label: String(chip.label || "").trim(),
    value: String(chip.value || chip.label || "").trim(),
  };
}

function cloneHudAskAction(action = {}) {
  const type = String(action.type || "page").trim();
  const href = canonicalizeHudHref(action.href, {
    allowProducts: true,
    allowPages: true,
    allowCollections: true,
    allowStaticProducts: true,
  });
  return {
    label: String(action.label || "").trim(),
    type,
    href,
  };
}

function cloneHudAskCollection(collection = {}) {
  const href = canonicalizeHudHref(collection.href, {
    allowProducts: false,
    allowPages: false,
    allowCollections: true,
    allowStaticProducts: false,
  });
  return {
    label: String(collection.label || "").trim(),
    handle: String(collection.handle || "").trim(),
    href,
  };
}

function cloneHudAskPage(page = {}) {
  const href = canonicalizeHudHref(page.href, {
    allowProducts: false,
    allowPages: true,
    allowCollections: false,
    allowStaticProducts: false,
  });
  return {
    label: String(page.label || "").trim(),
    href,
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

function cloneHudAskProduct(product = {}) {
  const fallbackHref = product?.handle ? `/products/${String(product.handle || "").trim()}` : "";
  const href = canonicalizeHudHref(product.href || fallbackHref, {
    allowProducts: true,
    allowPages: false,
    allowCollections: false,
    allowStaticProducts: true,
  });
  return {
    type: "product",
    label: String(product.label || product.title || "").trim(),
    title: String(product.title || product.label || "").trim(),
    handle: String(product.handle || "").trim(),
    href,
    product_id: String(product.product_id || "").trim(),
    variant_id: String(product.variant_id || "").trim(),
    variant_title: String(product.variant_title || "").trim(),
    reason: String(product.reason || "").trim(),
    tags: Array.isArray(product.tags)
      ? product.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 3)
      : [],
  };
}

function cloneHudAskProducts(products = []) {
  const seen = new Set();

  return products
    .map((product) => cloneHudAskProduct(product))
    .filter((product) => {
      if (!product.title || !product.handle || !product.product_id) return false;
      if (!product.href.startsWith("/products/")) return false;
      if (seen.has(product.href)) return false;
      seen.add(product.href);
      return true;
    })
    .slice(0, 3);
}

function buildHudAskReplyForContext({ intent, pageType, path, baseReply }) {
  if (pageType === "collection") {
    if (intent === "budget_value") {
      return "While you browse, start with the simpler mattress paths and confirm the size you need.";
    }

    if (isHudAskSizeIntent(intent)) {
      return "While you browse, stay inside the size you need, then compare feel and support.";
    }

    if (intent === "couple_conflict") {
      return "While you browse, start with the dual-comfort path if two sleepers want different feels.";
    }

    switch (intent) {
      case "sleep_hot":
        return "While you browse, focus on airflow first, then compare how much contouring and support you want.";
      case "firm_support":
        return "As you browse, look for alignment first without making the bed feel rigid.";
      case "back_pain":
        return "As you browse, compare support and pressure relief together so the bed does not feel punishing.";
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
    if (intent === "budget_value") {
      return "Use this page to compare size, support, and overall value before you decide.";
    }

    if (isHudAskSizeIntent(intent)) {
      return "Use this page to confirm the size options first, then compare feel and support.";
    }

    if (intent === "couple_conflict") {
      return "Use this page to compare whether this setup can really handle different comfort preferences side to side.";
    }

    switch (intent) {
      case "sleep_hot":
        return "Use this page to check airflow, feel, and support details. The Snooze Assessment can confirm whether it fits how you sleep.";
      case "firm_support":
        return "Use this page to check support feel, cushioning, and overall fit. The Snooze Assessment can confirm whether it fits how you sleep.";
      case "back_pain":
        return "Use this page to check support and pressure relief together. The Snooze Assessment can confirm whether it fits how you sleep.";
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

  if (intent === "policy_support") {
    return "Policy details can affect timing, fees, or coverage, so check the exact terms before you decide.";
  }

  return baseReply;
}

function shouldHudAskUseIntentCards(intent) {
  return [
    "snoring",
    "assessment_help",
    "booking_help",
    "couple_conflict",
    "policy_support",
    "cart_confidence",
  ].includes(String(intent || "").trim());
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
  const useIntentCards = shouldHudAskUseIntentCards(intent);

  if (normalizedPageType === "home") {
    return {
      reply,
      chips: HUD_ASK_HOME_CHIPS,
      actions: useIntentCards ? baseConfig.actions : [HUD_ASK_ACTION_ASSESSMENT],
      collections: useIntentCards ? baseConfig.collections : [HUD_ASK_COLLECTION_MATTRESSES],
      pages: useIntentCards ? baseConfig.pages : [HUD_ASK_PAGE_BOOKING],
    };
  }

  if (normalizedPageType === "collection") {
    return {
      reply,
      chips: HUD_ASK_COLLECTION_CHIPS,
      actions: useIntentCards ? baseConfig.actions : [HUD_ASK_ACTION_ASSESSMENT],
      collections: useIntentCards ? baseConfig.collections : [HUD_ASK_COLLECTION_MATTRESSES],
      pages: useIntentCards ? baseConfig.pages : [],
    };
  }

  if (normalizedPageType === "product") {
    return {
      reply,
      chips: HUD_ASK_PRODUCT_CHIPS,
      actions: useIntentCards ? baseConfig.actions : [HUD_ASK_ACTION_ASSESSMENT],
      collections: useIntentCards ? baseConfig.collections : [],
      pages: useIntentCards ? baseConfig.pages : [],
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

function resolveHudAskReplyOverride({
  intent,
  query,
  pageType,
  path,
  products = [],
  fallbackReply,
  replyOverride = "",
} = {}) {
  if (String(replyOverride || "").trim()) {
    return String(replyOverride || "").trim();
  }

  const hasProducts = Array.isArray(products) && products.length > 0;
  const normalizedQuery = normalizeHudAskText(query);
  const sizeLabel = resolveHudAskRequestedSizeLabel(intent, query);

  if (intent === "policy_support") {
    if (
      normalizedQuery.includes("return") ||
      normalizedQuery.includes("dont like") ||
      normalizedQuery.includes("don't like")
    ) {
      return "Return options can vary by item and order details. Check the return terms before you decide so you know exactly what applies.";
    }

    if (
      normalizedQuery.includes("deliver") ||
      normalizedQuery.includes("delivery") ||
      normalizedQuery.includes("shipping") ||
      normalizedQuery.includes("setup")
    ) {
      return "Delivery details can vary by order, area, and setup needs. Check the current delivery information before you place the order.";
    }

    if (
      normalizedQuery.includes("finance") ||
      normalizedQuery.includes("financing") ||
      normalizedQuery.includes("payment") ||
      normalizedQuery.includes("pay over time") ||
      normalizedQuery.includes("no money down")
    ) {
      return "Financing options may be available, but exact offers and approval terms can change. Check the current financing details before you decide.";
    }

    return "Policy details can affect timing, fees, or coverage, so check the exact terms before you decide.";
  }

  if (hasProducts) {
    switch (intent) {
      case "sleep_hot":
        return "If you sleep hot, start with the more breathable comparisons first, then decide how much contouring you want.";
      case "firm_support":
        return "Start with alignment first, then decide how much cushioning you want on top.";
      case "back_pain":
        return "For back discomfort, compare support and pressure relief together so the bed does not feel flat or punishing.";
      case "couple_conflict":
        return "Different comfort needs are where the dual-comfort path deserves the first look instead of forcing one feel on both sleepers.";
      case "compare_mattresses":
        return "Foam usually hugs closer. Hybrid usually adds more lift, airflow, and bounce, so compare those feel differences first.";
      case "budget_value":
        return "If value matters most, start with the simpler mattress paths and confirm the right size first.";
      case "size_help":
        return sizeLabel
          ? `Start with the ${sizeLabel} options so you can compare feel and support without guessing on size.`
          : "Start by confirming the size you need, then compare feel and support inside that size.";
      case "queen_size":
      case "king_size":
      case "twin_xl":
      case "full_size":
        return sizeLabel
          ? `Start with the ${sizeLabel} options first, then compare feel and support inside that size.`
          : "Start with the right size first, then compare feel and support inside it.";
      case "split_king":
        return "Split King usually comes down to matching the mattress and base so each side works the way you want.";
      case "snoring":
        return "Elevation may help some sleepers feel more comfortable. Start with the adjustable-base path rather than guessing at a mattress alone.";
      default:
        break;
    }
  }

  if (intent === "assessment_help") {
    return "The Snooze Assessment is the fastest way to narrow this down properly. Use it when comfort, support, or size is unclear.";
  }

  if (intent === "booking_help") {
    return "A Snooze Session is the best next step if you want to test the feel before deciding.";
  }

  if (intent === "fallback") {
    return "I can still guide you. Try one of these starting points.";
  }

  return buildHudAskReplyForContext({
    intent,
    pageType,
    path,
    baseReply: fallbackReply,
  });
}

function buildHudAskPayload({
  classification = null,
  intent = "fallback",
  query = "",
  path = "/",
  pageType = "unknown",
  latencyMs = 0,
  threadId = null,
  error = null,
  source = "live",
  products = [],
  replyOverride = "",
  chipsOverride = null,
  actionsOverride = null,
  collectionsOverride = null,
  pagesOverride = null,
  metaExtra = null,
  policySubtype = "",
} = {}) {
  const normalizedPath = sanitizeHudAskPath(path);
  const normalizedPageType = normalizeHudAskPageType(pageType, normalizedPath);
  const resolvedIntent = String(classification?.intent || intent || "fallback").trim() || "fallback";
  const config = resolveHudAskContextualConfig({
    intent: resolvedIntent,
    pageType: normalizedPageType,
    path: normalizedPath,
  });
  const safeMetaExtra =
    metaExtra && typeof metaExtra === "object" && !Array.isArray(metaExtra) ? metaExtra : {};
  const resolvedPolicySubtype =
    String(policySubtype || classification?.policy_subtype || "").trim() || null;

  return {
    status: "ok",
    reply: resolveHudAskReplyOverride({
      intent: resolvedIntent,
      query,
      pageType: normalizedPageType,
      path: normalizedPath,
      products,
      fallbackReply: config.reply,
      replyOverride,
    }),
    intent: resolvedIntent,
    intent_group: String(classification?.intent_group || "").trim() || null,
    policy_subtype: resolvedPolicySubtype,
    confidence:
      typeof classification?.confidence === "number" && Number.isFinite(classification.confidence)
        ? classification.confidence
        : null,
    confidence_label: String(classification?.confidence_label || "").trim() || null,
    chips: Array.isArray(chipsOverride) ? cloneHudAskChips(chipsOverride) : cloneHudAskChips(config.chips),
    actions: Array.isArray(actionsOverride)
      ? cloneHudAskActions(actionsOverride)
      : cloneHudAskActions(config.actions),
    products: cloneHudAskProducts(products),
    collections: Array.isArray(collectionsOverride)
      ? cloneHudAskCollections(collectionsOverride)
      : cloneHudAskCollections(config.collections),
    pages: Array.isArray(pagesOverride) ? cloneHudAskPages(pagesOverride) : cloneHudAskPages(config.pages),
    meta: {
      path: normalizedPath,
      source,
      latency_ms: Math.max(0, Math.round(Number(latencyMs) || 0)),
      error: error || null,
      ...safeMetaExtra,
    },
    thread_id: threadId || null,
  };
}

async function resolveHudAskAnswerStrategy({
  classification = null,
  intent = "fallback",
  query = "",
  path = "/",
  pageType = "unknown",
  traceId = "",
  products = [],
  productResolution = null,
  canonicalRecommendation = null,
} = {}) {
  const intentGroup = String(classification?.intent_group || "").trim() || "fallback_unclear";
  const config = resolveHudAskContextualConfig({
    intent,
    pageType,
    path,
  });

  const sources = [];
  let chipsOverride = null;
  let policySubtype = String(classification?.policy_subtype || "").trim() || "";
  let policySource = "fallback";
  let policyKey = null;
  let policyRetrieved = false;

  if (intentGroup === "policy_support") {
    const resolved = await resolveAskSnoozerPolicySources({
      query,
      traceId,
      timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
    });

    policySubtype = String(resolved?.policySubtype || policySubtype || "general_policy").trim();
    policySource = resolved?.source || "fallback";
    policyKey = resolved?.key || null;
    policyRetrieved = Boolean(resolved?.retrieved);
    chipsOverride = Array.isArray(resolved?.chips) && resolved.chips.length ? resolved.chips : null;

    if (Array.isArray(resolved?.sources) && resolved.sources.length) {
      sources.push(...resolved.sources);
    }

    log("hud.ask.policy", "resolved", {
      traceId,
      intentGroup,
      policySubtype: policySubtype || "general_policy",
      source: policySource || "fallback",
      key: policyKey || null,
      retrieved: policyRetrieved,
    });
  }

  const supplemental = await resolveAskSnoozerSupplementalSources({
    classification,
    query,
    path,
    products,
    traceId,
    timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
  });

  if (Array.isArray(supplemental?.sources) && supplemental.sources.length) {
    sources.push(...supplemental.sources);
  }

  const productSourceRecord = buildHudAskProductSourceRecord({
    products,
    catalogSource: productResolution?.catalogSource || "",
  });
  if (productSourceRecord) {
    sources.push(productSourceRecord);
  }

  const answer = buildAskSnoozerAnswer({
    query,
    intent,
    intent_group: intentGroup,
    context: {
      path,
      page_type: pageType,
    },
    sources,
    products,
    productContext: productResolution,
    canonicalRecommendation,
    actions: config.actions,
    pages: config.pages,
    collections: config.collections,
    policy_subtype: policySubtype,
  });

  log("hud.ask.answer", "grounded", {
    traceId,
    intent,
    intentGroup,
    policySubtype: policySubtype || null,
    answerStrategy: answer.answer_strategy || "safe_fallback",
    answerGrounded: Boolean(answer.answer_grounded),
    answerSourceType: answer.answer_source_type || "fallback",
    answerSourceKey: answer.answer_source_key || null,
    factsCount: Number(answer.answer_facts_count || 0),
    matchedPreview: String(answer.matched_preview || "").trim() || null,
    reason: answer.answer_grounded ? null : answer.reason || "no_source",
  });

  return {
    replyOverride: answer.reply || "",
    chipsOverride: Array.isArray(answer.chips_override) && answer.chips_override.length
      ? answer.chips_override
      : chipsOverride,
    policySubtype,
    metaExtra: {
      policy_source: policySource || "fallback",
      policy_key: policyKey || null,
      policy_retrieved: policyRetrieved,
      policy_answer_grounded: intentGroup === "policy_support" ? Boolean(answer.answer_grounded) : null,
      canonical_top_pod_id: canonicalRecommendation?.topPodId || null,
      canonical_primary_mattress_handle: canonicalRecommendation?.primaryMattressHandle || null,
      canonical_base_handle:
        Object.prototype.hasOwnProperty.call(canonicalRecommendation || {}, "baseHandle")
          ? canonicalRecommendation.baseHandle
          : null,
      canonical_motion_key: canonicalRecommendation?.motionKey || null,
      answer_grounded: Boolean(answer.answer_grounded),
      answer_source_type: answer.answer_source_type || "fallback",
      answer_source_key: answer.answer_source_key || null,
      answer_strategy: answer.answer_strategy || "safe_fallback",
      answer_facts_count: Number(answer.answer_facts_count || 0),
    },
  };
}

function normalizeHudAskHandleList(handles = []) {
  return Array.from(
    new Set(
      (Array.isArray(handles) ? handles : [])
        .map((handle) => String(handle || "").trim())
        .filter(Boolean)
    )
  );
}

function getHudAskCatalogHandles(catalog, categoryKey) {
  return normalizeHudAskHandleList(catalog?.categories?.[categoryKey] || []);
}

function buildHudAskFallbackCatalog() {
  const localCatalogPath = path.join(__dirname, "s3 files", "snoozerknowledgeprod", "meta", "catalog.json");
  try {
    if (fs.existsSync(localCatalogPath)) {
      const parsed = JSON.parse(fs.readFileSync(localCatalogPath, "utf8"));
      if (parsed?.categories && typeof parsed.categories === "object") {
        return parsed;
      }
    }
  } catch {}

  const mattressHandles = normalizeHudAskHandleList(Object.values(recsService?.HANDLES?.mattresses || {}));
  const adjustableBaseHandles = normalizeHudAskHandleList([recsService?.HANDLES?.bases?.adjustable]);

  if (!mattressHandles.length && !adjustableBaseHandles.length) {
    return null;
  }

  return {
    categories: {
      mattress: mattressHandles,
      "adjustable-base": adjustableBaseHandles,
      pillows: [],
      bedding: [],
    },
  };
}

function fallbackHudAskCatalogHasHandle(catalog, handle) {
  const lower = String(handle || "").trim().toLowerCase();
  const allHandles = normalizeHudAskHandleList(
    Object.values(catalog?.categories || {}).flatMap((items) => (Array.isArray(items) ? items : []))
  );

  return allHandles.some((item) => item.toLowerCase() === lower);
}

function isHudAskMattressCollectionPath(path) {
  return /^\/collections\/mattresses(?:[/?#]|$)/i.test(String(path || "").trim());
}

function extractHudAskProductHandleFromPath(path) {
  const match = String(path || "").trim().match(/^\/products\/([^/?#]+)/i);
  if (!match) return "";

  try {
    return decodeURIComponent(match[1] || "").trim().toLowerCase();
  } catch {
    return String(match[1] || "").trim().toLowerCase();
  }
}

function normalizeHudAskSizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseHudAskSizeLabel(query) {
  return parseAskSnoozerSizeLabel(query);
}

function hudAskQueryWantsBudget(query) {
  return hasAskSnoozerBudgetSignal(query);
}

function extractHudAskBudgetCap(query) {
  const normalizedQuery = normalizeHudAskText(query);
  const match = normalizedQuery.match(/\bunder\s+\$?\s*(\d{3,5})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function hudAskQueryUsesCurrentProductContext(query) {
  const normalizedQuery = normalizeHudAskText(query);
  if (!normalizedQuery) return false;

  if (
    [
      "this mattress",
      "this bed",
      "this one",
      "this product",
      "does this",
      "is this",
      "can this",
      "that mattress",
      "that bed",
      "that one",
      "that product",
      "does that",
      "is that",
      "can that",
      "does it",
      "is it",
      "can it",
      "will it",
      "how much is it",
      "how much is that",
      "what sizes does it come in",
      "what size does it come in",
      "what sizes does that come in",
      "what size does that come in",
      "does it come in",
      "does that come in",
    ].some((term) => normalizedQuery.includes(term))
  ) {
    return true;
  }

  return (
    /\b(?:this|that|it)\b/.test(normalizedQuery) &&
    /\b(?:come in|size|sizes|price|cost|how much|good for|work with|support|cooling|couples|hot sleepers|back support)\b/.test(
      normalizedQuery
    )
  );
}

const HUD_ASK_CLARIFICATION_PRODUCT_TITLES = Object.freeze({
  "10-all-foam-mattress": '10" All Foam',
  "12-all-foam-mattress": '12" All Foam',
  "12-dual-comfort-hybrid": '12" Dual Comfort Hybrid',
  "14-hybrid": '14" Hybrid',
});

function humanizeHudAskHandle(handle = "") {
  return String(handle || "")
    .trim()
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getHudAskClarificationProductTitle(handle = "") {
  const lower = String(handle || "").trim().toLowerCase();
  return HUD_ASK_CLARIFICATION_PRODUCT_TITLES[lower] || humanizeHudAskHandle(handle);
}

function buildHudAskClarificationProducts(mattressHandles = []) {
  const preferredHandles = normalizeHudAskHandleList([
    recsService?.HANDLES?.mattresses?.allFoam10,
    recsService?.HANDLES?.mattresses?.allFoam12,
    recsService?.HANDLES?.mattresses?.dualComfort,
    recsService?.HANDLES?.mattresses?.hybrid14,
  ]);
  const availableHandles = normalizeHudAskHandleList(mattressHandles);
  const ordered = normalizeHudAskHandleList(
    preferredHandles.filter((handle) =>
      availableHandles.some(
        (candidate) =>
          String(candidate || "").trim().toLowerCase() === String(handle || "").trim().toLowerCase()
      )
    ).concat(availableHandles)
  ).slice(0, 4);

  return ordered.map((handle) => ({
    handle,
    title: getHudAskClarificationProductTitle(handle),
  }));
}

function shouldHudAskClarifyAmbiguousProductQuery({
  classification = null,
  query = "",
  hasReliableCurrentProductContext = false,
  namedHandles = [],
} = {}) {
  const intentGroup = String(classification?.intent_group || "").trim();
  const relevantIntentGroup = intentGroup === "size_price" || intentGroup === "product_fit";
  const hasNamedProduct = Array.isArray(namedHandles) && namedHandles.length > 0;

  return (
    relevantIntentGroup &&
    hudAskQueryUsesCurrentProductContext(query) &&
    !hasReliableCurrentProductContext &&
    !hasNamedProduct
  );
}

function resolveHudAskRequestedSizeLabel(intent, query) {
  const parsed = parseHudAskSizeLabel(query);
  if (parsed) return parsed;

  switch (String(intent || "").trim()) {
    case "queen_size":
      return "Queen";
    case "king_size":
      return "King";
    case "split_king":
      return "Split King";
    case "twin_xl":
      return "Twin XL";
    case "full_size":
      return "Full";
    default:
      return "";
  }
}

function classifyHudAskHandle(handle, mattressHandles = [], adjustableBaseHandles = [], pillowHandles = [], beddingHandles = []) {
  const lower = String(handle || "").trim().toLowerCase();
  const mattressSet = new Set(mattressHandles.map((item) => String(item || "").trim().toLowerCase()));
  const adjustableSet = new Set(
    adjustableBaseHandles.map((item) => String(item || "").trim().toLowerCase())
  );
  const pillowSet = new Set(pillowHandles.map((item) => String(item || "").trim().toLowerCase()));
  const beddingSet = new Set(beddingHandles.map((item) => String(item || "").trim().toLowerCase()));

  return {
    isMattress: mattressSet.has(lower) || /mattress|hybrid|foam/.test(lower),
    isAdjustableBase:
      adjustableSet.has(lower) || (lower.includes("adjustable") && lower.includes("base")),
    isPillow: pillowSet.has(lower) || lower.includes("pillow"),
    isProtector: beddingSet.has(lower) && (lower.includes("protector") || lower.includes("encasement")),
    isBedding:
      beddingSet.has(lower) ||
      lower.includes("sheet") ||
      lower.includes("comforter") ||
      lower.includes("protector") ||
      lower.includes("encasement"),
    isHybrid: lower.includes("hybrid"),
    isFoam: lower.includes("foam") && !lower.includes("hybrid"),
    isDualComfort: lower.includes("dual-comfort"),
    isBudgetFoam: lower.startsWith("10-") && lower.includes("foam"),
  };
}

const HUD_ASK_HANDLE_ALIAS_MAP = Object.freeze({
  "14-hybrid": Object.freeze([
    { text: "14 hybrid", score: 12 },
    { text: '14" hybrid', score: 12 },
    { text: "14 inch hybrid", score: 12 },
    { text: "14-inch hybrid", score: 12 },
    { text: "fourteen hybrid", score: 10 },
    { text: "hybrid 14", score: 10 },
    { text: "14 hybrid mattress", score: 12 },
    { text: "hybrid mattress 14", score: 10 },
    { text: "hybrid", score: 3 },
  ]),
  "12-dual-comfort-hybrid": Object.freeze([
    { text: "12 dual comfort hybrid", score: 12 },
    { text: "12 dual comfort", score: 11 },
    { text: '12" dual comfort', score: 11 },
    { text: "12 inch dual comfort", score: 11 },
    { text: "12-inch dual comfort", score: 11 },
    { text: "dual comfort hybrid", score: 10 },
    { text: "12 dual comfort mattress", score: 11 },
    { text: "dual comfort", score: 8 },
    { text: "half split queen", score: 5 },
    { text: "half split king", score: 5 },
    { text: "hybrid", score: 2 },
  ]),
  "12-all-foam-mattress": Object.freeze([
    { text: "12 all foam mattress", score: 12 },
    { text: "12 all foam", score: 11 },
    { text: '12" all foam', score: 11 },
    { text: "12 inch all foam", score: 11 },
    { text: "12-inch all foam", score: 11 },
    { text: "all foam 12", score: 10 },
    { text: "all foam mattress", score: 5 },
    { text: "all foam", score: 3 },
    { text: "foam", score: 2 },
  ]),
  "10-all-foam-mattress": Object.freeze([
    { text: "10 all foam mattress", score: 12 },
    { text: "10 all foam", score: 11 },
    { text: '10" all foam', score: 11 },
    { text: "10 inch all foam", score: 11 },
    { text: "10-inch all foam", score: 11 },
    { text: "all foam 10", score: 10 },
    { text: "all foam mattress", score: 5 },
    { text: "all foam", score: 3 },
    { text: "foam", score: 2 },
  ]),
  "premium-motion-adjustable-base": Object.freeze([
    { text: "premium motion adjustable base", score: 12 },
    { text: "premium motion base", score: 11 },
    { text: "motion adjustable base", score: 10 },
    { text: "queen adjustable base", score: 9 },
    { text: "split king adjustable base", score: 9 },
    { text: "adjustable base", score: 8 },
    { text: "motion base", score: 8 },
    { text: "base", score: 1 },
  ]),
});

function buildHudAskHandleAliases(handle = "") {
  const lower = String(handle || "").trim().toLowerCase();
  const aliases = [];

  if (!lower) return aliases;

  aliases.push({ text: lower.replace(/-/g, " "), score: 4 });

  aliases.push(...(HUD_ASK_HANDLE_ALIAS_MAP[lower] || []));

  return aliases;
}

function scoreHudAskHandleMention(query, handle = "") {
  const normalizedQuery = normalizeHudAskText(query);
  if (!normalizedQuery) return 0;

  let best = 0;
  for (const alias of buildHudAskHandleAliases(handle)) {
    if (normalizedQuery.includes(normalizeHudAskText(alias.text))) {
      best = Math.max(best, Number(alias.score) || 0);
    }
  }
  return best;
}

function resolveHudAskNamedHandles(query, handles = []) {
  const scored = normalizeHudAskHandleList(handles)
    .map((handle) => ({
      handle,
      score: scoreHudAskHandleMention(query, handle),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];

  const threshold = scored.some((item) => item.score >= 6) ? 6 : 1;
  return scored.filter((item) => item.score >= threshold).map((item) => item.handle);
}

function filterHudAskHandlesForQuery(query, handles = [], mattressHandles = [], adjustableBaseHandles = [], pillowHandles = [], beddingHandles = []) {
  const normalizedQuery = normalizeHudAskText(query);
  const normalizedHandles = normalizeHudAskHandleList(handles);

  if (!normalizedHandles.length) return [];

  if (normalizedQuery.includes("adjustable base") || normalizedQuery.includes("motion base")) {
    return normalizedHandles.filter(
      (handle) => classifyHudAskHandle(handle, mattressHandles, adjustableBaseHandles, pillowHandles, beddingHandles).isAdjustableBase
    );
  }

  if (normalizedQuery.includes("dual comfort")) {
    return normalizedHandles.filter(
      (handle) => classifyHudAskHandle(handle, mattressHandles, adjustableBaseHandles, pillowHandles, beddingHandles).isDualComfort
    );
  }

  if (normalizedQuery.includes("all foam") && !normalizedQuery.includes("hybrid")) {
    return normalizedHandles.filter(
      (handle) => classifyHudAskHandle(handle, mattressHandles, adjustableBaseHandles, pillowHandles, beddingHandles).isFoam
    );
  }

  if (normalizedQuery.includes("hybrid")) {
    return normalizedHandles.filter((handle) => {
      const profile = classifyHudAskHandle(handle, mattressHandles, adjustableBaseHandles, pillowHandles, beddingHandles);
      return profile.isHybrid || profile.isDualComfort;
    });
  }

  if (normalizedQuery.includes("pillow")) {
    return normalizedHandles.filter(
      (handle) => classifyHudAskHandle(handle, mattressHandles, adjustableBaseHandles, pillowHandles, beddingHandles).isPillow
    );
  }

  if (
    normalizedQuery.includes("bedding") ||
    normalizedQuery.includes("sheet") ||
    normalizedQuery.includes("protector") ||
    normalizedQuery.includes("comforter") ||
    normalizedQuery.includes("accessories")
  ) {
    return normalizedHandles.filter((handle) => {
      const profile = classifyHudAskHandle(handle, mattressHandles, adjustableBaseHandles, pillowHandles, beddingHandles);
      return profile.isBedding || profile.isProtector || profile.isPillow;
    });
  }

  return normalizedHandles;
}

function moveHudAskHandleToFront(handles = [], targetHandle = "") {
  const target = String(targetHandle || "").trim().toLowerCase();
  const normalized = normalizeHudAskHandleList(handles);
  if (!target || !normalized.some((handle) => handle.toLowerCase() === target)) {
    return normalized;
  }

  const match = normalized.find((handle) => handle.toLowerCase() === target);
  return [match].concat(normalized.filter((handle) => handle.toLowerCase() !== target));
}

function scoreHudAskHandleForIntent(intent, handle, mattressHandles, adjustableBaseHandles) {
  const profile = classifyHudAskHandle(handle, mattressHandles, adjustableBaseHandles);

  if (intent === "snoring") {
    return profile.isAdjustableBase ? 100 : 0;
  }

  if (intent === "sleep_hot") {
    if (profile.isHybrid && !profile.isDualComfort) return 100;
    if (profile.isDualComfort) return 96;
    if (profile.isFoam && !profile.isBudgetFoam) return 82;
    if (profile.isFoam) return 76;
    return 0;
  }

  if (intent === "firm_support" || intent === "back_pain") {
    if (profile.isHybrid && !profile.isDualComfort) return 100;
    if (profile.isBudgetFoam) return 92;
    if (profile.isDualComfort) return 86;
    if (profile.isFoam) return 80;
    return 0;
  }

  return 0;
}

function buildHudAskCompareHandles(mattressHandles = [], currentHandle = "") {
  const normalizedCurrent = String(currentHandle || "").trim().toLowerCase();
  const foamHandles = mattressHandles.filter((handle) =>
    classifyHudAskHandle(handle, mattressHandles, []).isFoam
  );
  const hybridHandles = mattressHandles.filter((handle) => {
    const profile = classifyHudAskHandle(handle, mattressHandles, []);
    return profile.isHybrid && !profile.isDualComfort;
  });
  const balancedHandles = mattressHandles.filter((handle) =>
    classifyHudAskHandle(handle, mattressHandles, []).isDualComfort
  );
  const preferredFoamHandles = normalizeHudAskHandleList([
    recsService?.HANDLES?.mattresses?.allFoam12,
    recsService?.HANDLES?.mattresses?.allFoam10,
  ]).filter((handle) =>
    foamHandles.some(
      (candidate) => String(candidate || "").trim().toLowerCase() === String(handle || "").trim().toLowerCase()
    )
  );
  const preferredHybridHandles = normalizeHudAskHandleList([
    recsService?.HANDLES?.mattresses?.hybrid14,
  ]).filter((handle) =>
    hybridHandles.some(
      (candidate) => String(candidate || "").trim().toLowerCase() === String(handle || "").trim().toLowerCase()
    )
  );
  const preferredBalancedHandles = normalizeHudAskHandleList([
    recsService?.HANDLES?.mattresses?.dualComfort,
  ]).filter((handle) =>
    balancedHandles.some(
      (candidate) => String(candidate || "").trim().toLowerCase() === String(handle || "").trim().toLowerCase()
    )
  );
  const primaryFoamHandle = preferredFoamHandles[0] || foamHandles[0];
  const primaryHybridHandle = preferredHybridHandles[0] || hybridHandles[0];
  const primaryBalancedHandle = preferredBalancedHandles[0] || balancedHandles[0];

  const out = [];
  if (normalizedCurrent) {
    const match = mattressHandles.find((handle) => String(handle || "").trim().toLowerCase() === normalizedCurrent);
    if (match) out.push(match);
  }

  const currentProfile = classifyHudAskHandle(normalizedCurrent, mattressHandles, []);
  if (currentProfile.isFoam) {
    if (primaryHybridHandle) out.push(primaryHybridHandle);
    if (primaryBalancedHandle) out.push(primaryBalancedHandle);
  } else if (currentProfile.isHybrid || currentProfile.isDualComfort) {
    if (primaryFoamHandle) out.push(primaryFoamHandle);
    if (currentProfile.isDualComfort ? primaryHybridHandle : primaryBalancedHandle) {
      out.push(currentProfile.isDualComfort ? primaryHybridHandle : primaryBalancedHandle);
    }
  } else {
    if (primaryFoamHandle) out.push(primaryFoamHandle);
    if (primaryHybridHandle) out.push(primaryHybridHandle);
    if (primaryBalancedHandle) out.push(primaryBalancedHandle);
  }

  return normalizeHudAskHandleList(out).slice(0, 3);
}

function resolveHudAskCandidateHandles({
  classification = null,
  intent,
  query,
  path,
  pageType,
  catalog,
  catalogHasHandle,
  currentProductHandle = "",
}) {
  const normalizedPath = sanitizeHudAskPath(path);
  const normalizedPageType = normalizeHudAskPageType(pageType, normalizedPath);
  const mattressHandles = getHudAskCatalogHandles(catalog, "mattress");
  const adjustableBaseHandles = getHudAskCatalogHandles(catalog, "adjustable-base");
  const pillowHandles = getHudAskCatalogHandles(catalog, "pillows");
  const beddingHandles = getHudAskCatalogHandles(catalog, "bedding");
  const accessoryHandles = normalizeHudAskHandleList(pillowHandles.concat(beddingHandles));
  const productBias = Array.isArray(classification?.product_bias) ? classification.product_bias : [];
  const explicitCurrentProductHandle = String(currentProductHandle || "").trim().toLowerCase();
  const pathCurrentProductHandle = extractHudAskProductHandleFromPath(normalizedPath);
  const explicitCurrentProductIsReliable =
    explicitCurrentProductHandle &&
    typeof catalogHasHandle === "function" &&
    catalogHasHandle(catalog, explicitCurrentProductHandle);
  const pathCurrentProductIsReliable =
    pathCurrentProductHandle &&
    typeof catalogHasHandle === "function" &&
    catalogHasHandle(catalog, pathCurrentProductHandle);
  const safeCurrentHandle = explicitCurrentProductIsReliable
    ? explicitCurrentProductHandle
    : pathCurrentProductIsReliable
      ? pathCurrentProductHandle
      : "";
  const hasReliableCurrentProductContext = Boolean(
    safeCurrentHandle && (explicitCurrentProductIsReliable || normalizedPageType === "product")
  );
  const allCatalogHandles = normalizeHudAskHandleList(
    mattressHandles.concat(adjustableBaseHandles, pillowHandles, beddingHandles)
  );
  const namedHandles = resolveHudAskNamedHandles(query, allCatalogHandles);
  const prefersCurrentProduct = hudAskQueryUsesCurrentProductContext(query);
  const filteredMattressHandles = filterHudAskHandlesForQuery(
    query,
    namedHandles.length ? namedHandles : mattressHandles,
    mattressHandles,
    adjustableBaseHandles,
    pillowHandles,
    beddingHandles
  );
  const directCurrentProductQuestion =
    hasReliableCurrentProductContext &&
    safeCurrentHandle &&
    prefersCurrentProduct &&
    (intent === "budget_value" || intent === "bundle_price" || intent === "size_help" || isHudAskSpecificSizeIntent(intent));

  if (normalizedPageType === "cart") {
    return [];
  }

  if (intent === "size_help") {
    if (directCurrentProductQuestion) {
      return [safeCurrentHandle];
    }
    const sizeHelpHandles = namedHandles.length
      ? namedHandles
      : hasReliableCurrentProductContext && safeCurrentHandle
        ? [safeCurrentHandle]
        : [];
    return normalizeHudAskHandleList(sizeHelpHandles).slice(0, 3);
  }

  if (intent === "accessory_help") {
    const filteredAccessoryHandles = filterHudAskHandlesForQuery(
      query,
      accessoryHandles,
      mattressHandles,
      adjustableBaseHandles,
      pillowHandles,
      beddingHandles
    );
    return normalizeHudAskHandleList(filteredAccessoryHandles.length ? filteredAccessoryHandles : accessoryHandles).slice(0, 3);
  }

  if (intent === "couple_conflict" || productBias.includes("dual_comfort")) {
    const couplePriority = normalizeHudAskHandleList([
      recsService?.HANDLES?.mattresses?.dualComfort,
      recsService?.HANDLES?.mattresses?.hybrid14,
      recsService?.HANDLES?.mattresses?.allFoam12,
      recsService?.HANDLES?.mattresses?.allFoam10,
    ]).filter((handle) =>
      mattressHandles.some(
        (candidate) => String(candidate || "").trim().toLowerCase() === String(handle || "").trim().toLowerCase()
      )
    );

    const merged = normalizeHudAskHandleList(
      namedHandles.concat(
        safeCurrentHandle && normalizedPageType === "product" && prefersCurrentProduct ? [safeCurrentHandle] : [],
        couplePriority,
        mattressHandles
      )
    );
    return merged.slice(0, 3);
  }

  if (intent === "product_question") {
    const wantsAdjustableBase =
      normalizeHudAskText(query).includes("adjustable base") ||
      normalizeHudAskText(query).includes("motion base");
    const productQuestionHandles =
      safeCurrentHandle && prefersCurrentProduct
        ? normalizeHudAskHandleList([safeCurrentHandle].concat(namedHandles))
        : namedHandles.length
          ? namedHandles
          : safeCurrentHandle
            ? [safeCurrentHandle]
            : filteredMattressHandles;
    return normalizeHudAskHandleList(
      wantsAdjustableBase && adjustableBaseHandles[0]
        ? productQuestionHandles.concat(adjustableBaseHandles[0])
        : productQuestionHandles
    ).slice(0, 3);
  }

  if (intent === "bundle_price") {
    const namedMattressHandles = namedHandles.filter(
      (handle) => classifyHudAskHandle(handle, mattressHandles, adjustableBaseHandles, pillowHandles, beddingHandles).isMattress
    );
    const bundleHandles = normalizeHudAskHandleList(
      []
        .concat(
          safeCurrentHandle && normalizedPageType === "product" ? [safeCurrentHandle] : [],
          namedMattressHandles,
          adjustableBaseHandles[0] ? [adjustableBaseHandles[0]] : []
        )
    );

    if (bundleHandles.length) {
      return bundleHandles.slice(0, 3);
    }

    return normalizeHudAskHandleList(adjustableBaseHandles).slice(0, 1);
  }

  if (intent === "budget_value" || isHudAskSpecificSizeIntent(intent)) {
    if (directCurrentProductQuestion) {
      return [safeCurrentHandle];
    }
    let baseHandles = filteredMattressHandles.length
      ? filteredMattressHandles
      : normalizeHudAskHandleList(mattressHandles);
    if (namedHandles.length) {
      baseHandles = normalizeHudAskHandleList(namedHandles.concat(baseHandles));
    }
    if (normalizedPageType === "product" && safeCurrentHandle && prefersCurrentProduct) {
      baseHandles = moveHudAskHandleToFront(baseHandles, safeCurrentHandle);
    }
    return baseHandles.slice(0, 4);
  }

    if (intent === "compare_mattresses") {
      const normalizedCompareQuery = normalizeHudAskText(query);
      const explicitNamedCompare =
        /\b10\b/.test(normalizedCompareQuery) ||
        /\b12\b/.test(normalizedCompareQuery) ||
        /\b14\b/.test(normalizedCompareQuery) ||
        normalizedCompareQuery.includes("dual comfort");
      const genericCategoryCompare =
        !explicitNamedCompare &&
        (
          (normalizedCompareQuery.includes("foam") && normalizedCompareQuery.includes("hybrid")) ||
          normalizedCompareQuery.includes("hybrid vs all foam") ||
          normalizedCompareQuery.includes("all foam vs hybrid")
        );

      if (namedHandles.length >= 2 && !genericCategoryCompare) {
        return normalizeHudAskHandleList(namedHandles).slice(0, 3);
      }

      const compared = buildHudAskCompareHandles(mattressHandles, safeCurrentHandle);
      const merged = genericCategoryCompare
        ? compared
        : normalizeHudAskHandleList(namedHandles.concat(compared));
      return merged.length ? merged.slice(0, 3) : normalizeHudAskHandleList(mattressHandles).slice(0, 3);
    }

  if (intent === "snoring") {
    if (normalizedPageType === "collection" && isHudAskMattressCollectionPath(normalizedPath)) {
      return [];
    }
    return normalizeHudAskHandleList(adjustableBaseHandles).slice(0, 2);
  }

  if (!["sleep_hot", "firm_support", "back_pain"].includes(intent)) {
    return [];
  }

  const scored = normalizeHudAskHandleList(mattressHandles)
    .map((handle) => ({
      handle,
      score: scoreHudAskHandleForIntent(intent, handle, mattressHandles, adjustableBaseHandles),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.handle);
  const mergedScored = normalizeHudAskHandleList(namedHandles.concat(scored, filteredMattressHandles));

  if (normalizedPageType === "collection" && isHudAskMattressCollectionPath(normalizedPath)) {
    return mergedScored.slice(0, 3);
  }

  if (normalizedPageType === "product" && safeCurrentHandle && prefersCurrentProduct) {
    return moveHudAskHandleToFront(mergedScored, safeCurrentHandle).slice(0, 3);
  }

  return mergedScored.slice(0, 3);
}

function shouldHudAskPreferCanonicalProductOrdering(intent = "") {
  return [
    "sleep_hot",
    "firm_support",
    "back_pain",
    "couple_conflict",
    "compare_mattresses",
    "product_question",
    "budget_value",
    "size_help",
    "bundle_price",
    "snoring",
  ].includes(String(intent || "").trim());
}

function resolveHudAskCanonicalPriorityHandles({
  canonicalRecommendation = null,
  intent = "",
} = {}) {
  if (!isObject(canonicalRecommendation) || !shouldHudAskPreferCanonicalProductOrdering(intent)) {
    return [];
  }

  const handles = [canonicalRecommendation.primaryMattressHandle];
  if (intent === "snoring" || intent === "bundle_price" || intent === "product_question") {
    handles.push(canonicalRecommendation.baseHandle);
  }

  return normalizeHudAskHandleList(handles);
}

function findHudAskVariantForSize(product, sizeLabel) {
  const wantedSize = normalizeHudAskSizeKey(sizeLabel);
  if (!wantedSize || !Array.isArray(product?.variants)) return null;

  const acceptableSizes = new Set([wantedSize]);
  if (wantedSize === "queen") acceptableSizes.add("queen2pc");
  if (wantedSize === "king") acceptableSizes.add("king2pc");
  if (wantedSize === "calking") acceptableSizes.add("calking2pc");
  if (wantedSize === "splitking" || wantedSize === "halfsplitking") {
    acceptableSizes.add("king2pc");
    acceptableSizes.add("king");
  }
  if (wantedSize === "halfsplitqueen") {
    acceptableSizes.add("queen2pc");
    acceptableSizes.add("queen");
  }

  return (
    product.variants.find((variant) => {
      const selectedOptions = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
      return selectedOptions.some(
        (option) =>
          String(option?.name || "").toLowerCase() === "size" &&
          (() => {
            const optionKey = normalizeHudAskSizeKey(option?.value || "");
            return Array.from(acceptableSizes).some(
              (accepted) =>
                optionKey === accepted ||
                optionKey.startsWith(accepted) ||
                accepted.startsWith(optionKey)
            );
          })()
      );
    }) || null
  );
}

function findHudAskVariantById(product, variantId) {
  const wanted = String(variantId || "").trim();
  if (!wanted || !Array.isArray(product?.variants)) return null;
  return product.variants.find((variant) => String(variant?.id || "").trim() === wanted) || null;
}

function buildHudAskProductTags({ intent, handle, sizeLabel = "" } = {}) {
  const lower = String(handle || "").trim().toLowerCase();
  const tags = [];

  if (lower.includes("hybrid")) tags.push("Hybrid");
  if (lower.includes("foam") && !lower.includes("hybrid")) tags.push("Foam");
  if (lower.includes("dual-comfort")) tags.push("Dual Comfort");
  if (lower.includes("adjustable") && lower.includes("base")) tags.push("Adjustable Base");
  if (lower.includes("pillow")) tags.push("Pillow");
  if (lower.includes("protector") || lower.includes("encasement")) tags.push("Protector");
  if (lower.includes("sheet") || lower.includes("comforter") || lower.includes("bedding")) tags.push("Bedding");

  if (intent === "sleep_hot") tags.push("Cooling");
  if (intent === "firm_support" || intent === "back_pain") tags.push("Support");
  if (intent === "snoring") tags.push("Elevation");
  if (intent === "budget_value") tags.push("Value");
  if (intent === "bundle_price") tags.push("Bundle");
  if (intent === "couple_conflict") tags.push("Partner Sleep");
  if (sizeLabel) tags.push(sizeLabel);

  return Array.from(new Set(tags)).slice(0, 3);
}

function buildHudAskProductReason({
  intent,
  handle,
  currentProductHandle = "",
  sizeLabel = "",
  budgetQuery = false,
} = {}) {
  const lower = String(handle || "").trim().toLowerCase();
  const isCurrent = lower && lower === String(currentProductHandle || "").trim().toLowerCase();
  const sizePrefix = sizeLabel ? `${sizeLabel} ` : "";

  if (budgetQuery && sizeLabel) {
    return `One of the easier ${sizePrefix.toLowerCase()}starting points if you want to keep the setup simpler.`.replace(
      /\s+/g,
      " "
    );
  }

  if (intent === "budget_value") {
    return sizeLabel
      ? `A simpler ${sizeLabel} path to compare early if value is the priority.`
      : "One of the simpler mattress paths to compare first if value matters most.";
  }

  if (intent === "bundle_price") {
    if (lower.includes("adjustable") && lower.includes("base")) {
      return sizeLabel
        ? `A ${sizeLabel} adjustable-base match so you can total the setup safely.`
        : "An adjustable-base match so you can total the setup safely.";
    }
    return sizeLabel
      ? `A ${sizeLabel} mattress match for bundle pricing and setup comparison.`
      : "A mattress match so you can total the setup with a base.";
  }

  if (intent === "split_king") {
    return "Verified in Split King so you can compare compatibility before you choose a base setup.";
  }

  if (intent === "couple_conflict") {
    if (lower.includes("dual-comfort")) {
      return "The best couple-friendly first look when two sleepers want different comfort on each side.";
    }
    return "A useful contrast if you want to compare a shared-feel option against the dual-comfort path.";
  }

  if (intent === "product_question") {
    if (lower.includes("adjustable") && lower.includes("base")) {
      return "A base match to compare with the current mattress setup.";
    }
    if (lower.includes("dual-comfort")) {
      return "Worth comparing when you want different comfort side to side without splitting the mattress.";
    }
    if (lower.includes("hybrid")) {
      return "Worth comparing if you want more airflow, support, and a lifted feel.";
    }
    if (lower.includes("foam")) {
      return "Worth comparing if you want closer contouring and stronger motion isolation.";
    }
    return "A good product-specific starting point to compare next.";
  }

  if (intent === "accessory_help") {
    if (lower.includes("pillow")) {
      return "A pillow option to compare for cooling, loft, or support feel.";
    }
    if (lower.includes("protector") || lower.includes("encasement")) {
      return "A protector option to compare if you want a cleaner, lower-maintenance setup.";
    }
    if (lower.includes("sheet") || lower.includes("comforter") || lower.includes("bedding")) {
      return "A bedding option to compare if you want to complete the setup around the mattress.";
    }
    return "An accessory option to compare as you build out the setup.";
  }

  if (isHudAskSpecificSizeIntent(intent) && sizeLabel) {
    return `Available in ${sizeLabel} so you can compare feel and support in the size you need.`;
  }

  if (isCurrent) {
    return "This is the product you are viewing now, so it is a good anchor for comparison.";
  }

  switch (intent) {
    case "sleep_hot":
      if (lower.includes("hybrid") && !lower.includes("dual-comfort")) {
        return "A cooling-first hybrid comparison if you want more airflow with steady support.";
      }
      if (lower.includes("dual-comfort")) {
        return "A cooling-friendly comparison when you also want more flexibility side to side.";
      }
      return "A contouring option to compare if you still want to weigh cooling against closer body contact.";
    case "firm_support":
      if (lower.includes("hybrid") && !lower.includes("dual-comfort")) {
        return "A support-forward option to compare if alignment is your priority.";
      }
      if (lower.startsWith("10-")) {
        return "A firmer all-foam option to compare against the hybrid feel.";
      }
      return "A steadier feel to compare while you focus on support.";
    case "back_pain":
      if (lower.includes("hybrid") && !lower.includes("dual-comfort")) {
        return "A support-and-pressure-relief option to compare for neutral alignment.";
      }
      if (lower.includes("dual-comfort")) {
        return "A balanced support-and-pressure-relief option to compare.";
      }
      return "Worth comparing if you want support-and-pressure-relief without losing steady support.";
    case "snoring":
      return "An adjustable base lets you compare elevation with your mattress feel.";
    case "compare_mattresses":
      if (lower.includes("hybrid") && !lower.includes("dual-comfort")) {
        return "Hybrid usually adds more lift, airflow, and bounce.";
      }
      if (lower.includes("dual-comfort")) {
        return "A balanced hybrid comparison if you want a middle ground feel.";
      }
      return "Foam usually feels more contouring with closer body contact.";
    default:
      return "A safe starting point to compare next.";
  }
}

function buildHudAskProductSourceRecord({
  products = [],
  catalogSource = "fallback_catalog",
} = {}) {
  const safeProducts = Array.isArray(products) ? products.filter(Boolean) : [];
  if (!safeProducts.length) return null;

  return {
    source_type:
      catalogSource === "s3_catalog"
        ? "shopify_product+s3_catalog"
        : "shopify_product+fallback_catalog",
    source_key: safeProducts
      .map((product) => String(product?.handle || "").trim())
      .filter(Boolean)
      .join(","),
    title: "Verified products",
    text: safeProducts
      .map((product) => {
        const parts = [
          String(product?.title || product?.label || "").trim(),
          String(product?.reason || "").trim(),
          Array.isArray(product?.tags) && product.tags.length ? `Tags: ${product.tags.join(", ")}` : "",
        ].filter(Boolean);
        return parts.join(". ");
      })
      .filter(Boolean)
      .join("\n"),
    facts: safeProducts
      .map((product) => ({
        text: String(product?.reason || product?.title || product?.label || "").trim(),
        heading: String(product?.title || product?.label || "").trim(),
        kind: "fact",
      }))
      .filter((fact) => fact.text),
  };
}

async function resolveHudAskProducts({
  classification = null,
  intent,
  query,
  path,
  pageType,
  traceId,
  currentProductHandle = "",
  canonicalRecommendation = null,
} = {}) {
  if (!shopifySvc?.fetchProductsByHandles) {
    return {
      products: [],
      catalogSource: "fallback_catalog",
      answerSourceType: "shopify_product+fallback_catalog",
      entries: [],
      currentProductHandle: "",
      sizeLabel: "",
      budgetQuery: false,
      budgetCap: null,
    };
  }

  const openaiHelpers = getOpenAiSvc();
  const fallbackCatalog = buildHudAskFallbackCatalog();

  try {
    const [catalogResult, canonResult] =
      openaiHelpers && typeof openaiHelpers.getCatalogOnce === "function"
        ? await Promise.all([
            withTimeout(
              openaiHelpers.getCatalogOnce(),
              S3_RETRIEVAL_TIMEOUT_MS,
              "HUD_ASK_CATALOG_TIMEOUT",
              "Timed out loading HUD ask catalog"
            ).catch(() => ({ value: null, error: true })),
            typeof openaiHelpers.getCanonOnce === "function"
              ? withTimeout(
                  openaiHelpers.getCanonOnce(),
                  S3_RETRIEVAL_TIMEOUT_MS,
                  "HUD_ASK_CANON_TIMEOUT",
                  "Timed out loading HUD ask canon"
                ).catch(() => ({ value: null, error: true }))
              : Promise.resolve({ value: null, error: null }),
          ])
        : [{ value: null, error: true }, { value: null, error: true }];

    const catalog = catalogResult?.value || fallbackCatalog;
    const canon = canonResult?.value || null;
    const catalogHasHandle =
      openaiHelpers && typeof openaiHelpers.catalogHasHandle === "function"
        ? openaiHelpers.catalogHasHandle
        : fallbackHudAskCatalogHasHandle;
    if (!catalog) {
      return {
        products: [],
        catalogSource: "fallback_catalog",
        answerSourceType: "shopify_product+fallback_catalog",
        entries: [],
        currentProductHandle: "",
        sizeLabel: "",
        budgetQuery: false,
        budgetCap: null,
      };
    }

    const normalizedPath = sanitizeHudAskPath(path);
    const normalizedPageType = normalizeHudAskPageType(pageType, normalizedPath);
    const sizeLabel =
      String(classification?.size_label || "").trim() || resolveHudAskRequestedSizeLabel(intent, query);
    const budgetQuery =
      Boolean(classification?.budget_signal) || hudAskQueryWantsBudget(query);
    const budgetCap = extractHudAskBudgetCap(query);
    const bundleRequested =
      String(intent || "").trim() === "bundle_price" ||
      (normalizeHudAskText(query).includes("adjustable base") &&
        (normalizeHudAskText(query).includes("how much") ||
          normalizeHudAskText(query).includes("price") ||
          normalizeHudAskText(query).includes("cost")));
    const payloadCurrentProductHandle = String(currentProductHandle || "").trim().toLowerCase();
    const pathCurrentProductHandle = extractHudAskProductHandleFromPath(normalizedPath);
    const mattressHandles = getHudAskCatalogHandles(catalog, "mattress");
    const adjustableBaseHandles = getHudAskCatalogHandles(catalog, "adjustable-base");
    const pillowHandles = getHudAskCatalogHandles(catalog, "pillows");
    const beddingHandles = getHudAskCatalogHandles(catalog, "bedding");
    const payloadCurrentProductIsReliable =
      payloadCurrentProductHandle && catalogHasHandle(catalog, payloadCurrentProductHandle);
    const pathCurrentProductIsReliable =
      pathCurrentProductHandle && catalogHasHandle(catalog, pathCurrentProductHandle);
    const safeCurrentHandle = payloadCurrentProductIsReliable
      ? payloadCurrentProductHandle
      : pathCurrentProductIsReliable
        ? pathCurrentProductHandle
        : "";
    const hasReliableCurrentProductContext = Boolean(
      safeCurrentHandle && (payloadCurrentProductIsReliable || normalizedPageType === "product")
    );
    const allCatalogHandles = normalizeHudAskHandleList(
      mattressHandles.concat(adjustableBaseHandles, pillowHandles, beddingHandles)
    );
    const namedHandles = resolveHudAskNamedHandles(query, allCatalogHandles);

    if (
      shouldHudAskClarifyAmbiguousProductQuery({
        classification,
        query,
        hasReliableCurrentProductContext,
        namedHandles,
      })
    ) {
      return {
        products: [],
        catalogSource: catalogResult?.value ? "s3_catalog" : "fallback_catalog",
        answerSourceType: "clarification",
        entries: [],
        currentProductHandle: safeCurrentHandle,
        sizeLabel,
        budgetQuery,
        budgetCap,
        bundleRequested,
        needsProductClarification: true,
        clarificationProducts: buildHudAskClarificationProducts(mattressHandles),
      };
    }

    const candidateHandles = resolveHudAskCandidateHandles({
      classification,
      intent,
      query,
      path: normalizedPath,
      pageType: normalizedPageType,
      catalog,
      catalogHasHandle,
      currentProductHandle: safeCurrentHandle,
    });
    const prioritizedHandles = normalizeHudAskHandleList(
      resolveHudAskCanonicalPriorityHandles({
        canonicalRecommendation,
        intent,
      }).concat(candidateHandles)
    );

    if (!prioritizedHandles.length) {
      return {
        products: [],
        catalogSource: catalogResult?.value ? "s3_catalog" : "fallback_catalog",
        answerSourceType:
          catalogResult?.value ? "shopify_product+s3_catalog" : "shopify_product+fallback_catalog",
        entries: [],
        currentProductHandle: safeCurrentHandle,
        sizeLabel,
        budgetQuery,
        budgetCap,
        bundleRequested,
      };
    }

    const productsResponse = await withTimeout(
      shopifySvc.fetchProductsByHandles({ handles: prioritizedHandles, lite: false }),
      SHOPIFY_TIMEOUT_MS,
      "HUD_ASK_PRODUCT_TIMEOUT",
      "Timed out loading HUD ask products"
    );

    const fetchedItems = Array.isArray(productsResponse?.items) ? productsResponse.items : [];
    const productsByHandle = new Map(
      fetchedItems
        .filter((item) => item?.handle && item?.id)
        .map((item) => [String(item.handle).trim().toLowerCase(), item])
    );

    const enriched = prioritizedHandles
      .map((handle, index) => {
        const product = productsByHandle.get(String(handle || "").trim().toLowerCase());
        if (!product || !product.handle || !product.id) return null;

        let chosenVariant = sizeLabel ? findHudAskVariantForSize(product, sizeLabel) : null;

        if (
          !chosenVariant &&
          sizeLabel &&
          canon &&
          typeof openaiHelpers.resolveVariantFromCanon === "function"
        ) {
          const canonVariantId = openaiHelpers.resolveVariantFromCanon(canon, product.handle, sizeLabel);
          if (canonVariantId) {
            chosenVariant = findHudAskVariantById(product, canonVariantId);
          }
        }

        if (!chosenVariant && sizeLabel) {
          return null;
        }

        if (!chosenVariant) {
          chosenVariant =
            findHudAskVariantById(product, product.firstAvailableVariantId || product.variantId) ||
            (Array.isArray(product.variants)
              ? product.variants.find((variant) => variant?.available) || product.variants[0]
              : null);
        }

        const variantId = String(
          chosenVariant?.id || product.firstAvailableVariantId || product.variantId || ""
        ).trim();
        if (!variantId) return null;

        const variantTitle = String(chosenVariant?.title || "").trim();
        const variantPrice = Number(
          chosenVariant?.price ??
            product?.priceRange?.min ??
            product?.price
        );
        const sizeOptions = Array.isArray(product?.variants)
          ? Array.from(
              new Set(
                product.variants
                  .map((variant) => {
                    const selectedOptions = Array.isArray(variant?.selectedOptions)
                      ? variant.selectedOptions
                      : [];
                    const sizeOption = selectedOptions.find(
                      (option) => String(option?.name || "").trim().toLowerCase() === "size"
                    );
                    return String(sizeOption?.value || "").trim();
                  })
                  .filter(Boolean)
              )
            )
          : [];

        return {
          product,
          handle: String(product.handle || "").trim(),
          title: String(product.title || "").trim(),
          order: index,
          variantId,
          variantTitle: variantTitle === "Default Title" ? "" : variantTitle,
          variantPrice: Number.isFinite(variantPrice) ? variantPrice : Number.MAX_SAFE_INTEGER,
          currencyCode:
            String(
              chosenVariant?.currencyCode ||
                product?.priceRange?.currencyCode ||
                "USD"
            ).trim() || "USD",
          matchedSizeLabel: sizeLabel,
          sizeOptions,
        };
      })
      .filter(Boolean);

    const ordered =
      intent === "bundle_price"
        ? enriched.sort((a, b) => a.order - b.order)
        : budgetQuery || isHudAskSpecificSizeIntent(intent)
        ? enriched.sort((a, b) => {
            if (a.variantPrice !== b.variantPrice) return a.variantPrice - b.variantPrice;
            return a.order - b.order;
          })
        : enriched.sort((a, b) => a.order - b.order);
    const capped =
      Number.isFinite(budgetCap) && budgetCap > 0
        ? ordered.filter((entry) => entry.variantPrice <= budgetCap)
        : ordered;
    const chosenEntries = capped.length ? capped : ordered;

    const products = chosenEntries.slice(0, 3).map((entry) => ({
      type: "product",
      label: String(entry.product.title || "").trim(),
      title: String(entry.product.title || "").trim(),
      handle: entry.handle,
      href: `/products/${entry.handle}`,
      product_id: String(entry.product.id || "").trim(),
      variant_id: entry.variantId,
      variant_title: entry.variantTitle,
      reason: buildHudAskProductReason({
        intent,
        handle: entry.handle,
        currentProductHandle: safeCurrentHandle,
        sizeLabel,
        budgetQuery,
      }),
      tags: buildHudAskProductTags({
        intent,
        handle: entry.handle,
        sizeLabel,
      }),
    }));

      log("hud.ask.products", "resolved", {
      traceId,
      intent,
      intentGroup: classification?.intent_group || null,
      path: normalizedPath,
      pageType: normalizedPageType,
      catalogSource: catalogResult?.value ? "s3" : "fallback",
      productCount: products.length,
      handles: products.map((product) => product.handle),
    });

    return {
      products,
      catalogSource: catalogResult?.value ? "s3_catalog" : "fallback_catalog",
      answerSourceType:
        catalogResult?.value ? "shopify_product+s3_catalog" : "shopify_product+fallback_catalog",
      entries: chosenEntries.map((entry) => ({
        ...entry,
        matchedSizeLabel: sizeLabel,
      })),
      currentProductHandle: safeCurrentHandle,
      sizeLabel,
      budgetQuery,
      budgetCap,
      bundleRequested,
    };
  } catch (error) {
    log("hud.ask.products.error", error.message, {
      traceId,
      intent,
      intentGroup: classification?.intent_group || null,
      path,
      pageType,
    });
    return {
      products: [],
      catalogSource: "fallback_catalog",
      answerSourceType: "shopify_product+fallback_catalog",
      entries: [],
      currentProductHandle:
        String(currentProductHandle || "").trim().toLowerCase() || extractHudAskProductHandleFromPath(path),
      sizeLabel: "",
      budgetQuery: false,
      budgetCap: null,
      bundleRequested: String(intent || "").trim() === "bundle_price",
    };
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Polly helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function resolveHudAskCanonicalProducts({
  canonicalRecommendation = null,
  intent = "",
  currentProductHandle = "",
  traceId = "",
} = {}) {
  if (!isObject(canonicalRecommendation) || !shopifySvc?.fetchProductsByHandles) {
    return [];
  }

  const sizeLabel = String(canonicalRecommendation?.normalizedAssessment?.size || "").trim();
  const handles = uniqueStrings([
    canonicalRecommendation.primaryMattressHandle,
    canonicalRecommendation.baseHandle,
  ]).slice(0, 3);

  if (!handles.length) return [];

  try {
    const productsResponse = await withTimeout(
      shopifySvc.fetchProductsByHandles({ handles, lite: false }),
      SHOPIFY_TIMEOUT_MS,
      "HUD_ASK_PRODUCT_TIMEOUT",
      "Timed out loading HUD ask canonical products"
    );
    const fetchedItems = Array.isArray(productsResponse?.items) ? productsResponse.items : [];
    const productsByHandle = new Map(
      fetchedItems
        .filter((item) => item?.handle && item?.id)
        .map((item) => [String(item.handle).trim().toLowerCase(), item])
    );

    return handles
      .map((handle) => {
        const product = productsByHandle.get(String(handle || "").trim().toLowerCase());
        if (!product) return null;

        let chosenVariant = sizeLabel ? findHudAskVariantForSize(product, sizeLabel) : null;
        if (!chosenVariant) {
          chosenVariant =
            findHudAskVariantById(product, product.firstAvailableVariantId || product.variantId) ||
            (Array.isArray(product.variants)
              ? product.variants.find((variant) => variant?.available) || product.variants[0]
              : null);
        }

        const variantId = String(
          chosenVariant?.id || product.firstAvailableVariantId || product.variantId || ""
        ).trim();
        if (!variantId) return null;

        const productHandle = String(product.handle || "").trim();
        return {
          type: "product",
          label: String(product.title || "").trim(),
          title: String(product.title || "").trim(),
          handle: productHandle,
          href: `/products/${productHandle}`,
          product_id: String(product.id || "").trim(),
          variant_id: variantId,
          variant_title:
            String(chosenVariant?.title || "").trim() === "Default Title"
              ? ""
              : String(chosenVariant?.title || "").trim(),
          reason: buildHudAskProductReason({
            intent,
            handle: productHandle,
            currentProductHandle,
            sizeLabel,
            budgetQuery: false,
          }),
          tags: buildHudAskProductTags({
            intent,
            handle: productHandle,
            sizeLabel,
          }),
        };
      })
      .filter(Boolean)
      .slice(0, 3);
  } catch (error) {
    log("hud.ask.canonical.products.error", error.message, {
      traceId,
      intent,
      handles,
    });
    return [];
  }
}

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

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function sanitizeCanonicalProductSummary(product) {
  if (!isObject(product)) return null;
  const handle = String(product.handle || "").trim();
  if (!handle) return null;
  return {
    handle,
    title: String(product.title || "").trim() || handle,
    catalogType: String(product.catalogType || "").trim() || "",
    family: String(product.family || "").trim() || "",
    shopifyPath: String(product.shopifyPath || "").trim() || "",
  };
}

function buildAskSnoozerCanonicalContext(resolved) {
  if (!isObject(resolved)) return null;

  const recommendation = isObject(resolved.recommendation) ? resolved.recommendation : {};
  const normalizedAssessment = isObject(resolved.normalizedAssessment)
    ? { ...resolved.normalizedAssessment }
    : {};
  const topPodId = String(recommendation.topPodId || "").trim();
  const topPodIds = uniqueStrings(Array.isArray(recommendation.topPodIds) ? recommendation.topPodIds : []);
  const topPod =
    Array.isArray(resolved.pods) && topPodId
      ? resolved.pods.find((pod) => String(pod?.podId || "").trim() === topPodId) || null
      : null;

  const productIndex = {};
  for (const product of Array.isArray(resolved.products) ? resolved.products : []) {
    const sanitized = sanitizeCanonicalProductSummary(product);
    if (sanitized) productIndex[sanitized.handle] = sanitized;
  }

  const primaryMattressHandle = String(recommendation.primaryMattressHandle || "").trim();
  const baseHandleRaw = recommendation.baseHandle;
  const baseHandle = baseHandleRaw == null ? null : String(baseHandleRaw || "").trim() || null;

  return {
    manifestVersion: String(resolved.manifestVersion || "").trim() || null,
    normalizedAssessment,
    topPodId: topPodId || null,
    topPodIds,
    topPodName: String(topPod?.name || "").trim() || topPodId || "",
    primaryMattressHandle: primaryMattressHandle || null,
    primaryMattressTitle: productIndex[primaryMattressHandle]?.title || primaryMattressHandle || "",
    baseHandle,
    baseTitle:
      baseHandle == null ? "Mattress Only" : productIndex[baseHandle]?.title || baseHandle || "",
    motionKey:
      String(normalizedAssessment.motionKey || recommendation.motionKey || "").trim() || null,
    motionLabel:
      String(normalizedAssessment.motionLabel || recommendation.motionLabel || "").trim() || null,
    reasonKeys: uniqueStrings(Array.isArray(recommendation.reasonKeys) ? recommendation.reasonKeys : []),
    warnings: uniqueStrings(
      []
        .concat(Array.isArray(recommendation.warnings) ? recommendation.warnings : [])
        .concat(Array.isArray(normalizedAssessment.warnings) ? normalizedAssessment.warnings : [])
    ),
    topPod: topPod
      ? {
          podId: String(topPod.podId || "").trim() || null,
          name: String(topPod.name || "").trim() || "",
          mattressHandle: String(topPod.mattressHandle || "").trim() || null,
          baseHandle: String(topPod.baseHandle || "").trim() || null,
          baseTypeKey: String(topPod.baseTypeKey || "").trim() || "",
          defaultMotionKey: String(topPod.defaultMotionKey || "").trim() || "",
          tags: Array.isArray(topPod.tags) ? uniqueStrings(topPod.tags) : [],
        }
      : null,
    products: productIndex,
  };
}

function pickAskSnoozerAssessmentInput({ payload, context, storedAssessment } = {}) {
  const candidates = [
    payload?.assessment,
    isObject(payload?.answers) ? { answers: payload.answers } : null,
    context?.assessment,
    isObject(context?.answers) ? { answers: context.answers } : null,
    storedAssessment,
  ];

  for (const candidate of candidates) {
    if (!isObject(candidate)) continue;
    if (isObject(candidate.answers)) return candidate;
    if (Object.keys(candidate).length) return candidate;
  }

  return null;
}

function attachCanonicalRecommendationContext(context = {}, canonicalRecommendation = null) {
  const next = isObject(context) ? { ...context } : {};
  if (!isObject(canonicalRecommendation)) return next;

  next.canonicalRecommendation = canonicalRecommendation;
  next.progress = isObject(next.progress) ? { ...next.progress } : {};
  next.progress.assessmentCompleted = true;

  const handles = uniqueStrings([
    ...(Array.isArray(next.recommendedProductHandles) ? next.recommendedProductHandles : []),
    canonicalRecommendation.primaryMattressHandle,
    canonicalRecommendation.baseHandle,
    canonicalRecommendation.topPod?.mattressHandle,
    canonicalRecommendation.topPod?.baseHandle,
  ]);

  if (handles.length) next.recommendedProductHandles = handles;
  return next;
}

async function resolveCanonicalRecommendationContext({
  payload = null,
  context = null,
  storedAssessment = null,
  shopperId = "",
  sessionId = "",
  allowSessionLookup = false,
  source = "manual",
  traceId = "",
} = {}) {
  const safePayload = isObject(payload) ? payload : {};
  let assessmentSource = storedAssessment && isObject(storedAssessment) ? storedAssessment : null;

  if (!assessmentSource && shopperId) {
    try {
      assessmentSource = await getAssessmentResult(shopperId);
    } catch (error) {
      log("canonical.context.assessment.error", error.message, {
        traceId,
        shopperId,
        sessionId: sessionId || null,
      });
    }
  }

  if (!assessmentSource && allowSessionLookup && sessionId) {
    try {
      const sessionItem = await getSessionItem(sessionId);
      assessmentSource = sessionItem?.context?.assessment || null;
    } catch (error) {
      log("canonical.context.session.error", error.message, {
        traceId,
        shopperId: shopperId || null,
        sessionId,
      });
    }
  }

  const assessmentInput = pickAskSnoozerAssessmentInput({
    payload: safePayload,
    context,
    storedAssessment: assessmentSource,
  });

  if (
    !assessmentInput ||
    !recommendationResolver ||
    typeof recommendationResolver.resolveRecommendation !== "function"
  ) {
    return null;
  }

  const resolved = await recommendationResolver.resolveRecommendation({
    assessment: assessmentInput,
    includeProducts: true,
    includePods: true,
    source,
  });
  return buildAskSnoozerCanonicalContext(resolved);
}

function maybeBuildAskSnoozerCanonicalAnswer(query, context) {
  const canonicalRecommendation = isObject(context?.canonicalRecommendation)
    ? context.canonicalRecommendation
    : null;
  if (!canonicalRecommendation) return null;

  const answer = buildAskSnoozerAnswer({
    query,
    canonicalRecommendation,
  });

  if (!answer?.answer_grounded || answer.answer_strategy !== "canonical_recommendation") {
    return null;
  }

  return answer;
}

function normalizeAskSnoozerContextPath(value = "") {
  return String(value || "").trim() || "/";
}

function buildAskSnoozerClassification(query = "", context = {}) {
  return classifyAskSnoozerIntent(query, {
    path: normalizeAskSnoozerContextPath(context?.path),
    page_type: String(context?.page_type || context?.pageType || "unknown").trim() || "unknown",
    surface: String(context?.surface || "ask_snoozer").trim() || "ask_snoozer",
  });
}

function looksLikeAskSnoozerSupportQuestion(query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return false;

  return [
    "contact support",
    "contact customer support",
    "contact customer service",
    "contact snoozer",
    "support email",
    "support phone",
    "customer service",
    "customer support",
    "email support",
    "phone number",
    "how do i contact",
    "how can i contact",
    "how do i reach",
    "how can i reach",
    "talk to someone",
    "speak to someone",
    "help with my order",
    "need help with my order",
  ].some((term) => normalized.includes(term));
}

function buildAskSnoozerSupportReply(query = "") {
  const normalized = String(query || "").trim().toLowerCase();

  if (
    normalized.includes("email") ||
    normalized.includes("phone") ||
    normalized.includes("contact")
  ) {
    return "For order or account help, use the store contact or support path shown on the site so the team can verify your details. If you want product guidance, I can help here or point you to a Snooze Session.";
  }

  return "If you need order or account support, use the store contact path shown on the site so the team can verify the details. If you want product guidance, I can help here or point you to a Snooze Session.";
}

async function maybeBuildAskSnoozerDeterministicFaqAnswer({
  query = "",
  context = {},
  traceId = "",
} = {}) {
  const classification = buildAskSnoozerClassification(query, context);
  const intent = String(classification?.intent || "").trim();
  const intentGroup = String(classification?.intent_group || "").trim();

  if (intentGroup === "policy_support") {
    const policy = await resolveAskSnoozerPolicyAnswer({
      query,
      traceId,
      timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
    });
    return {
      classification,
      reply: policy.reply || "",
      answer_grounded: Boolean(policy.answerGrounded || policy.retrieved),
      answer_source_type: policy.sourceKind || policy.source || "fallback",
      answer_source_key: policy.key || "",
      answer_facts_count: policy.retrieved ? 1 : 0,
      matched_preview: policy.matchedPreview || "",
      answer_strategy: policy.answerGrounded ? "source_summary" : "safe_fallback",
      extracted_facts: [],
      reason: policy.answerGrounded ? "" : "policy_fallback",
      chips_override: Array.isArray(policy.chips) ? policy.chips : [],
    };
  }

  if (intentGroup === "booking_handoff") {
    return buildAskSnoozerAnswer({
      query,
      intent,
      intent_group: intentGroup,
      actions: [{ label: "Book A Snooze Session", href: HUD_SAFE_PAGE_ROUTES.booking }],
      pages: [{ label: "Book A Snooze Session", href: HUD_SAFE_PAGE_ROUTES.booking }],
    });
  }

  if (looksLikeAskSnoozerSupportQuestion(query)) {
    return {
      classification,
      reply: buildAskSnoozerSupportReply(query),
      answer_grounded: false,
      answer_source_type: "deterministic_support",
      answer_source_key: "contact_support",
      answer_facts_count: 0,
      matched_preview: "",
      answer_strategy: "safe_fallback",
      extracted_facts: [],
      reason: "support_fallback",
      chips_override: [],
    };
  }

  return null;
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
      const shopperId =
        String(body?.shopperId || body?.shopper_id || body?.context?.shopperId || "").trim() || "";
      const hudContext = isObject(body?.context) ? body.context : {};
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
        metaExtra: answerStrategy?.metaExtra || null,
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
        model: "canonical_recommendation",
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
    });
    if (deterministicFaqAnswer) {
      const latencyMs = Date.now() - startedAt;
      const mergedContext =
        sco && typeof sco === "object" ? deepMerge(sco, context) : context;
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
        intent: buildAskSnoozerClassification(msg, context)?.intent || null,
        intentGroup: buildAskSnoozerClassification(msg, context)?.intent_group || null,
        totalMs: latencyMs,
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

  if (method === "POST" && routePath === "/recommendations/resolve") {
    if (!recommendationResolver || typeof recommendationResolver.resolveRecommendation !== "function") {
      return response(event, 500, {
        ok: false,
        code: "E_RECOMMENDATION_RESOLVER_UNAVAILABLE",
        message: "Recommendation resolver unavailable.",
      });
    }

    try {
      const body = safeJsonBody(event);
      const resolved = await recommendationResolver.resolveRecommendation(body || {});
      return response(event, 200, resolved);
    } catch (error) {
      return response(event, Number(error.statusCode || 500), {
        ok: false,
        code: error.code || "E_RECOMMENDATION_RESOLVE",
        message: error.message || "Unable to resolve recommendations.",
      });
    }
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
