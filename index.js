// index.js Ã¢â‚¬â€ Omnia / Snoozer Backend Core
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
const hudRoutes = require("./routes/hudRoutes");
const identityRoutes = require("./routes/identityRoutes");
const assessmentRoutes = require("./routes/assessmentRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const recommendationRoutes = require("./routes/recommendationRoutes");
const askSnoozerRoutes = require("./routes/askSnoozerRoutes");
const shopify = require("./routes/shopifyRoutes");
const { handleIotZoneEvent } = require("./services/iot/zoneEventIngestion");
const {
  handleIotWebSocket,
  handleIotWebSocketCleanup,
} = require("./services/iot/websocketHandler");
const {
  handleIotPhysicalControlAck,
  handleIotPhysicalControlReportedState,
  handleIotPhysicalControlTimeout,
  issuePhysicalControlCommand,
} = require("./services/iot/physicalControl");

let rewardsRoutes;
try {
  rewardsRoutes = require("./routes/rewardsRoutes");
} catch {
  console.log("Ã¢Å¡Â Ã¯Â¸Â rewardsRoutes not found.");
}

let buildIndexes;
try {
  ({ buildIndexes } = require("./services/s3Indexer"));
} catch {
  console.log("Ã¢Å¡Â Ã¯Â¸Â s3Indexer not loaded.");
}

let recsService = null;
try {
  recsService = require("./services/recommendations");
} catch {
  console.log("Ã¢Å¡Â Ã¯Â¸Â recommendations service not loaded (ok).");
}

let recommendationResolver = null;
try {
  recommendationResolver = require("./services/recommendationResolver");
} catch (error) {
  console.log("Ã¢Å¡Â Ã¯Â¸Â recommendation resolver not loaded (ok).", error.message);
}

let customerProfileService = null;
try {
  customerProfileService = require("./services/customerProfile");
} catch (error) {
  console.log("ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â customerProfile service not loaded (ok).", error.message);
}

let bookingSessionService = null;
try {
  bookingSessionService = require("./services/bookingSession");
} catch (error) {
  console.log("Ã¢Å¡Â Ã¯Â¸Â bookingSession service not loaded (ok).", error.message);
}

let shopifySvc = null;
try {
  shopifySvc = require("./services/shopify");
} catch {
  console.log("ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â shopify service not loaded (ok).");
}

let snoozeIdentityService = null;
try {
  snoozeIdentityService = require("./services/snoozeIdentity");
} catch (error) {
  console.log("âš ï¸ snoozeIdentity service not loaded (ok).", error.message);
}

let rewardsService = null;
try {
  rewardsService = require("./services/rewards");
} catch (error) {
  console.log("âš ï¸ rewards service not loaded (ok).", error.message);
}

let rewardProgramService = null;
try {
  rewardProgramService = require("./services/rewards/service");
} catch (error) {
  console.log("Rewards program service not loaded (ok).", error.message);
}

let openaiSvc = null;
function getOpenAiSvc() {
  if (openaiSvc) return openaiSvc;
  try {
    openaiSvc = require("./services/openai");
  } catch (error) {
    console.log("ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â openai service helpers not loaded (ok).", error.message);
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
  cleanShopperText,
  resolveAskSnoozerPolicyAnswer,
  resolveAskSnoozerPolicySources,
  resolveAskSnoozerSupplementalSources,
} = require("./services/askSnoozerPolicy");
const {
  buildAskSnoozerClarificationReply,
  buildAskSnoozerFallbackReply,
  buildAskSnoozerMissingRecommendationReply,
  isBuildGuidanceQuery,
  isRestTestGuidanceQuery,
  isSnoozeCodeQuery,
  isUnknownProductQuery,
  routeAskSnoozerQuestion,
  resolveAskSnoozerCommerceResponse,
} = require("./services/askSnoozerQualityGate");
const { buildAskSnoozerAnswer } = require("./services/askSnoozerAnswerEngine");
const {
  HUD_SAFE_PAGE_ROUTES,
  HUD_SAFE_COLLECTION_ROUTES,
  HUD_HREF_ALIASES,
  canonicalizeHudHref,
} = require("./services/askSnoozerRoutes");
const { loadShowroomManifest } = require("./services/showroomManifest");

let getHudScriptPayload = null;
let hudScriptSafeTimeoutMs = Number(
  process.env.HUD_SCRIPT_SAFE_TIMEOUT_MS || process.env.S3_RETRIEVAL_TIMEOUT_MS || 300
);
try {
  ({ getHudScriptPayload, HUD_SCRIPT_SAFE_TIMEOUT_MS: hudScriptSafeTimeoutMs } = require("./services/hudScripts"));
} catch (e) {
  console.log("Ã¢Å¡Â Ã¯Â¸Â hudScripts service not loaded.", e.message);
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
  console.log("Ã¢Å¡Â Ã¯Â¸Â Polly client not loaded.");
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
  safeNumber,
  enforceHudContract,
} = require("./utils/responseContract");

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Config / Globals
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Timing / timeout helpers
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// HUD mode helpers
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// CORS + HTTP Helpers
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
  "content-type,authorization,x-requested-with,x-request-id,x-api-key,x-session-id,x-snooze-code,x-access-code,idempotency-key,x-debug,x-hud,if-none-match";
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Optional Snooze Profile + Zoho integration
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
let buildSnoozeProfile = null;
let mapProfileToZohoFields = null;
try {
  const sp = require("./services/snoozeProfile");
  buildSnoozeProfile = sp.buildSnoozeProfile;
  mapProfileToZohoFields = sp.mapProfileToZohoFields;
} catch (e) {
  console.log("Ã¢Å¡Â Ã¯Â¸Â snoozeProfile service not loaded.", e.message);
}

let upsertContactByShopperId = null;
try {
  const zohoSvc = require("./services/zoho");
  upsertContactByShopperId = zohoSvc.upsertContactByShopperId;
} catch (e) {
  console.log("Ã¢Å¡Â Ã¯Â¸Â Zoho service not loaded for Snooze Profile.", e.message);
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Optional Assessment Snapshot (Zoho + Dynamo unified view)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
let getAssessmentSnapshot = null;
try {
  ({ getAssessmentSnapshot } = require("./handlers/getAssessmentSnapshot"));
} catch (e) {
  console.log("Ã¢Å¡Â Ã¯Â¸Â getAssessmentSnapshot handler not loaded.", e.message);
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Path + Body helpers
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
let syncCustomerProfileToZoho = null;
try {
  ({ syncCustomerProfileToZoho } = require("./services/customerProfileZohoSync"));
} catch (e) {
  console.log("ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â customerProfileZohoSync service not loaded.", e.message);
}

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
    .replace(/\bhybris\b/g, "hybrid")
    .replace(/\bhyrbid\b/g, "hybrid")
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
  context = null,
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

  if (isSnoozeCodeQuery(query)) {
    const identityAnswer = buildAskSnoozerIdentityGuidanceAnswer({
      query,
      context: isObject(context)
        ? context
        : {
            path,
            page_type: pageType,
          },
    });

    return {
      replyOverride: identityAnswer.reply || "",
      chipsOverride: null,
      policySubtype: "",
      metaExtra: {
        policy_source: "fallback",
        policy_key: null,
        policy_retrieved: false,
        policy_answer_grounded: null,
        canonical_top_pod_id: canonicalRecommendation?.topPodId || null,
        canonical_primary_mattress_handle: canonicalRecommendation?.primaryMattressHandle || null,
        canonical_base_handle:
          Object.prototype.hasOwnProperty.call(canonicalRecommendation || {}, "baseHandle")
            ? canonicalRecommendation.baseHandle
            : null,
        canonical_motion_key: canonicalRecommendation?.motionKey || null,
        answer_grounded: Boolean(identityAnswer.answer_grounded),
        answer_source_type: identityAnswer.answer_source_type || "identity_guidance",
        answer_source_key: identityAnswer.answer_source_key || null,
        answer_strategy: identityAnswer.answer_strategy || "identity_guidance",
        answer_facts_count: Number(identityAnswer.answer_facts_count || 0),
      },
    };
  }

  if (intentGroup === "policy_support" && policySubtype !== "pricing") {
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
    context: isObject(context)
      ? context
      : {
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
    { text: "12 hybrid", score: 10 },
    { text: '12" hybrid', score: 10 },
    { text: "12 inch hybrid", score: 10 },
    { text: "12-inch hybrid", score: 10 },
    { text: "hybrid 12", score: 9 },
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
      return "The cleaner couple path when two sleepers want different comfort on each side.";
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
        return "A breathable comparison if you want more airflow with steady support.";
      }
      if (lower.includes("dual-comfort")) {
        return "A breathable comparison when you also want more flexibility side to side.";
      }
      return "A contouring option to compare if you still want to weigh airflow against a closer foam feel.";
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
        return "A support-first comparison if you want lift with some cushion.";
      }
      if (lower.includes("dual-comfort")) {
        return "A balanced support option to compare when side-to-side comfort matters too.";
      }
      return "Worth comparing if you want support without forcing the bed to feel overly firm.";
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Polly helpers
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Snoozer Context Object (SCO) builders
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Deterministic pod anchoring
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Sessions storage
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Assessment + Content Logic (S3-backed)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

function cloneJsonValue(value) {
  return isObject(value) || Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : value;
}

function buildStoredProfileContext(profile = {}) {
  if (!isObject(profile)) return {};

  const next = {};

  if (isObject(profile.assessmentAnswers)) {
    next.assessment = cloneJsonValue(profile.assessmentAnswers);
  }

  if (isObject(profile.canonicalRecommendation)) {
    next.canonicalRecommendation = cloneJsonValue(profile.canonicalRecommendation);
  }

  if (isObject(profile.sessionPrep)) {
    next.sessionPrep = cloneJsonValue(profile.sessionPrep);
  }

  const simpleFields = {
    bookingStatus: cleanIdentityValue(profile?.bookingStatus),
    bookingSource: cleanIdentityValue(profile?.bookingSource),
    bookingStartTime: cleanIdentityValue(profile?.bookingStartTime),
    bookingEndTime: cleanIdentityValue(profile?.bookingEndTime),
    bookingTimezone: cleanIdentityValue(profile?.bookingTimezone),
    bookingLocationType: cleanIdentityValue(profile?.bookingLocationType),
    bookingLocation: cleanIdentityValue(profile?.bookingLocation),
    bookingEventName: cleanIdentityValue(profile?.bookingEventName),
    bookingEventType: cleanIdentityValue(profile?.bookingEventType),
  };

  for (const [key, value] of Object.entries(simpleFields)) {
    if (value) next[key] = value;
  }

  return next;
}

function attachStoredProfileContext(context = {}, profile = {}) {
  const next = isObject(context) ? { ...context } : {};
  const profileContext = buildStoredProfileContext(profile);

  if (!next.assessment && isObject(profileContext.assessment)) {
    next.assessment = profileContext.assessment;
  }

  if (!next.canonicalRecommendation && isObject(profileContext.canonicalRecommendation)) {
    const enriched = attachCanonicalRecommendationContext(next, profileContext.canonicalRecommendation);
    if (Array.isArray(enriched?.recommendedProductHandles)) {
      next.recommendedProductHandles = enriched.recommendedProductHandles;
    }
    next.canonicalRecommendation = enriched.canonicalRecommendation;
    next.progress = enriched.progress;
  }

  if (!next.sessionPrep && isObject(profileContext.sessionPrep)) {
    next.sessionPrep = profileContext.sessionPrep;
  }

  const simpleFields = [
    "bookingStatus",
    "bookingSource",
    "bookingStartTime",
    "bookingEndTime",
    "bookingTimezone",
    "bookingLocationType",
    "bookingLocation",
    "bookingEventName",
    "bookingEventType",
  ];

  for (const field of simpleFields) {
    if (!next[field] && profileContext[field]) {
      next[field] = profileContext[field];
    }
  }

  return next;
}

async function safeUpsertCustomerProfile(patchInput = {}, meta = {}) {
  if (
    !customerProfileService ||
    typeof customerProfileService.buildCustomerProfilePatch !== "function" ||
    typeof customerProfileService.upsertCustomerProfile !== "function"
  ) {
    return {
      ok: false,
      skipped: true,
      reason: "CUSTOMER_PROFILE_SERVICE_UNAVAILABLE",
    };
  }

  try {
    const patch = customerProfileService.buildCustomerProfilePatch(patchInput);
    const result = await customerProfileService.upsertCustomerProfile(patch);

    if (result?.skipped) {
      log("customer.profile.skip", result.reason || "SKIPPED", {
        traceId: meta.traceId || null,
        route: meta.route || null,
        shopperId: patch.shopperId || null,
        sessionId: patch.sessionId || patch.threadId || null,
      });
      return result;
    }

    log("customer.profile", "upserted", {
      traceId: meta.traceId || null,
      route: meta.route || null,
      profileId: result?.profileId || null,
      shopperId: patch.shopperId || null,
      sessionId: patch.sessionId || patch.threadId || null,
      topPodId: patch.topPodId || null,
      lastIntent: patch.lastIntent || null,
      sourceSurface: patch.sourceSurface || null,
    });

    return result;
  } catch (error) {
    log("customer.profile.error", error.message, {
      traceId: meta.traceId || null,
      route: meta.route || null,
      shopperId: patchInput?.shopperId || null,
      sessionId: patchInput?.sessionId || patchInput?.threadId || null,
      code: error?.code || null,
    });
    return {
      ok: false,
      skipped: true,
      reason: "CUSTOMER_PROFILE_UPSERT_FAILED",
    };
  }
}

async function safeGetCustomerProfile(profileInput = {}, meta = {}) {
  if (
    !customerProfileService ||
    typeof customerProfileService.getCustomerProfile !== "function"
  ) {
    return {
      ok: false,
      skipped: true,
      reason: "CUSTOMER_PROFILE_SERVICE_UNAVAILABLE",
      profile: null,
      profileId: null,
    };
  }

  try {
    return await customerProfileService.getCustomerProfile(profileInput);
  } catch (error) {
    log("customer.profile.read.error", error.message, {
      traceId: meta.traceId || null,
      route: meta.route || null,
      shopperId: profileInput?.shopperId || null,
      sessionId: profileInput?.sessionId || profileInput?.threadId || null,
      code: error?.code || null,
    });
    return {
      ok: false,
      skipped: true,
      reason: "CUSTOMER_PROFILE_READ_FAILED",
      profile: null,
      profileId: null,
    };
  }
}

function logProfileRouteOutcome(channel, result = {}, meta = {}) {
  const eventBase = `customer.profile.${channel}`;
  const payload = {
    traceId: meta.traceId || null,
    route: meta.route || null,
    shopperId: meta.shopperId || null,
    sessionId: meta.sessionId || null,
    profileId: result?.profileId || null,
    reason: result?.reason || null,
  };

  if (result?.ok && !result?.skipped) {
    log(`${eventBase}.upserted`, "ok", payload);
    return;
  }

  if (result?.reason === "CUSTOMER_PROFILE_UPSERT_FAILED") {
    log(`${eventBase}.error`, result.reason, payload);
    return;
  }

  log(`${eventBase}.skipped`, result?.reason || "SKIPPED", payload);
}

function logIdentityProfileOutcome(route, result = {}, identity = {}, meta = {}) {
  const payload = {
    traceId: meta.traceId || null,
    route,
    shopperId: cleanIdentityValue(identity?.shopperId) || null,
    snoozeCode: cleanIdentityValue(identity?.snoozeCode) || null,
    profileId: cleanIdentityValue(identity?.profileId) || null,
    identityType: cleanIdentityValue(identity?.identityType) || null,
  };

  if (result?.ok && !result?.skipped) {
    log("customer.profile.identity.upserted", "ok", payload);
    return;
  }

  if (result?.reason === "CUSTOMER_PROFILE_UPSERT_FAILED") {
    log("customer.profile.identity.error", result.reason, payload);
    return;
  }

  log("customer.profile.identity.skipped", result?.reason || "SKIPPED", payload);
}

async function maybeSyncProfileToZohoForInteraction({
  channel = "ask",
  traceId = "",
  route = "",
  previousProfile = null,
  nextPatch = {},
  policyContext = {},
} = {}) {
  if (
    !customerProfileService ||
    typeof customerProfileService.shouldSyncProfileToZoho !== "function" ||
    typeof customerProfileService.mergeCustomerProfile !== "function"
  ) {
    log(`customer.profile.zoho.${channel}.skipped`, "SYNC_POLICY_DISABLED", {
      traceId,
      route,
      reason: "SYNC_POLICY_DISABLED",
      shopperId: nextPatch?.shopperId || null,
      sessionId: nextPatch?.sessionId || nextPatch?.threadId || null,
    });
    return {
      ok: false,
      skipped: true,
      reason: "SYNC_POLICY_DISABLED",
    };
  }

  const policy = customerProfileService.shouldSyncProfileToZoho(
    previousProfile,
    nextPatch,
    policyContext
  );

  if (!policy?.shouldSync) {
    log(`customer.profile.zoho.${channel}.skipped`, policy?.reason || "NO_MATERIAL_ZOHO_CHANGE", {
      traceId,
      route,
      reason: policy?.reason || "NO_MATERIAL_ZOHO_CHANGE",
      shopperId: nextPatch?.shopperId || null,
      sessionId: nextPatch?.sessionId || nextPatch?.threadId || null,
      changedFields: Array.isArray(policy?.changedFields) ? policy.changedFields : [],
    });
    return {
      ok: false,
      skipped: true,
      reason: policy?.reason || "NO_MATERIAL_ZOHO_CHANGE",
    };
  }

  if (typeof syncCustomerProfileToZoho !== "function") {
    log(`customer.profile.zoho.${channel}.skipped`, "SYNC_POLICY_DISABLED", {
      traceId,
      route,
      reason: "SYNC_POLICY_DISABLED",
      shopperId: nextPatch?.shopperId || null,
      sessionId: nextPatch?.sessionId || nextPatch?.threadId || null,
    });
    return {
      ok: false,
      skipped: true,
      reason: "SYNC_POLICY_DISABLED",
    };
  }

  const profileForSync = policy?.nextProfile
    ? policy.nextProfile
    : customerProfileService.mergeCustomerProfile(previousProfile, nextPatch);

  try {
    const result = await syncCustomerProfileToZoho(profileForSync);
    if (result?.ok) {
      log(`customer.profile.zoho.${channel}.synced`, "ok", {
        traceId,
        route,
        shopperId: result.shopperId || nextPatch?.shopperId || null,
        operation: result.operation || null,
        contactId: result.contactId || null,
        code: result.code || null,
        reason: policy?.reason || null,
        changedFields: Array.isArray(policy?.changedFields) ? policy.changedFields : [],
      });
      return result;
    }

    log(`customer.profile.zoho.${channel}.skipped`, result?.reason || "ZOHO_SYNC_SKIPPED", {
      traceId,
      route,
      shopperId: result?.shopperId || nextPatch?.shopperId || null,
      operation: result?.operation || null,
      contactId: result?.contactId || null,
      code: result?.code || null,
      reason: result?.reason || "ZOHO_SYNC_SKIPPED",
      changedFields: Array.isArray(policy?.changedFields) ? policy.changedFields : [],
    });
    return result;
  } catch (error) {
    log(`customer.profile.zoho.${channel}.error`, error.message, {
      traceId,
      route,
      shopperId: nextPatch?.shopperId || null,
      sessionId: nextPatch?.sessionId || nextPatch?.threadId || null,
      code: error?.code || null,
    });
    return {
      ok: false,
      skipped: true,
      reason: "ZOHO_SYNC_FAILED",
    };
  }
}

const SNOOZE_CODE_LEAD_STAGE_BY_REASON = Object.freeze({
  assessment_completed: "assessment_completed",
  save_results: "assessment_completed",
  rewards_signup: "browsing",
  showroom_walkin: "browsing",
  booking_started: "session_interested",
  manual_create: "new",
});

function cleanIdentityValue(value) {
  return String(value == null ? "" : value).trim();
}

function resolveIdentityLeadStage(reason = "", currentStage = "") {
  const normalizedReason = cleanIdentityValue(reason).toLowerCase();
  const candidateStage = SNOOZE_CODE_LEAD_STAGE_BY_REASON[normalizedReason] || "";

  if (
    customerProfileService &&
    typeof customerProfileService.resolveLeadStage === "function"
  ) {
    return customerProfileService.resolveLeadStage(currentStage, candidateStage);
  }

  return candidateStage || cleanIdentityValue(currentStage) || undefined;
}

function isCanonicalSnoozeIdentity(identity = {}) {
  if (
    !snoozeIdentityService ||
    typeof snoozeIdentityService.isLikelySnoozeCode !== "function"
  ) {
    return /^\d{4}$|^\d{6}$/.test(cleanIdentityValue(identity?.shopperId));
  }

  return Boolean(
    snoozeIdentityService.isLikelySnoozeCode(
      identity?.snoozeCode || identity?.accessCode || identity?.shopperId
    )
  );
}

async function getProfileByIdForIdentity(profileId = "", meta = {}) {
  const result = await safeGetCustomerProfile(
    { profileId: cleanIdentityValue(profileId) },
    meta
  );
  return result?.profile || null;
}

function buildFallbackIdentity(input = {}) {
  const shopperId = cleanIdentityValue(
    input?.snoozeCode ||
      input?.accessCode ||
      input?.shopperId ||
      input?.context?.shopperId
  );
  const sessionId = cleanIdentityValue(input?.sessionId || input?.threadId);
  const canonicalLike = /^\d{4}$|^\d{6}$/.test(shopperId);

  return {
    shopperId: shopperId || null,
    snoozeCode: canonicalLike ? shopperId : null,
    accessCode: canonicalLike ? shopperId : null,
    profileId: shopperId
      ? `shopper#${shopperId}`
      : sessionId
        ? `session#${sessionId}`
        : null,
    identityType: canonicalLike
      ? "snooze_code"
      : shopperId
        ? "temporary_shopper_id"
        : "session",
    identitySource: shopperId ? "shopperId" : "sessionId",
    isTemporary: !canonicalLike,
    sourceShopperId: canonicalLike ? null : shopperId || null,
    aliases: [],
    sessionId: sessionId || null,
    threadId: cleanIdentityValue(input?.threadId || input?.sessionId) || null,
    visitorId: cleanIdentityValue(input?.visitorId) || null,
  };
}

async function safeResolveSnoozeIdentity(input = {}, meta = {}) {
  if (
    !snoozeIdentityService ||
    typeof snoozeIdentityService.resolveCanonicalIdentity !== "function"
  ) {
    return buildFallbackIdentity(input);
  }

  try {
    const identity = await snoozeIdentityService.resolveCanonicalIdentity(input, {
      getProfileById: async (profileId) =>
        await getProfileByIdForIdentity(profileId, meta),
    });

    log("snooze.identity.resolved", "ok", {
      traceId: meta.traceId || null,
      route: meta.route || null,
      sourceSurface: input?.sourceSurface || input?.origin || null,
      incomingShopperId: cleanIdentityValue(input?.shopperId) || null,
      sourceShopperId: identity?.sourceShopperId || null,
      canonicalShopperId: identity?.shopperId || null,
      snoozeCode: identity?.snoozeCode || null,
      profileId: identity?.profileId || null,
      identityType: identity?.identityType || null,
      identitySource: identity?.identitySource || null,
      isTemporary: Boolean(identity?.isTemporary),
      aliasCount: Array.isArray(identity?.aliases) ? identity.aliases.length : 0,
      reason: cleanIdentityValue(input?.reason) || null,
    });

    if (cleanIdentityValue(identity?.identitySource).startsWith("stored_")) {
      log("snooze.identity.alias_detected", "stored_alias", {
        traceId: meta.traceId || null,
        route: meta.route || null,
        incomingShopperId: cleanIdentityValue(input?.shopperId) || null,
        canonicalShopperId: identity?.shopperId || null,
        profileId: identity?.profileId || null,
        aliasCount: Array.isArray(identity?.aliases) ? identity.aliases.length : 0,
      });
    } else if (identity?.isTemporary) {
      log("snooze.identity.temporary", "temporary", {
        traceId: meta.traceId || null,
        route: meta.route || null,
        incomingShopperId: cleanIdentityValue(input?.shopperId) || null,
        sourceShopperId: identity?.sourceShopperId || null,
        profileId: identity?.profileId || null,
        identityType: identity?.identityType || null,
      });
    }

    return identity;
  } catch (error) {
    log("snooze.identity.resolve.error", error.message, {
      traceId: meta.traceId || null,
      route: meta.route || null,
      incomingShopperId: cleanIdentityValue(input?.shopperId) || null,
      code: error?.code || null,
    });
    return buildFallbackIdentity(input);
  }
}

async function safeIssueSnoozeCode(input = {}, meta = {}) {
  if (
    !snoozeIdentityService ||
    typeof snoozeIdentityService.issueSnoozeCode !== "function"
  ) {
    return input?.identity || buildFallbackIdentity(input);
  }

  try {
    const identity = await snoozeIdentityService.issueSnoozeCode(input, {
      getProfileById: async (profileId) =>
        await getProfileByIdForIdentity(profileId, meta),
    });

    if (identity?.isNewCode) {
      log("snooze.identity.issued", "ok", {
        traceId: meta.traceId || null,
        route: meta.route || null,
        sourceSurface: input?.sourceSurface || input?.origin || null,
        incomingShopperId: cleanIdentityValue(input?.shopperId) || null,
        sourceShopperId: identity?.sourceShopperId || null,
        canonicalShopperId: identity?.shopperId || null,
        snoozeCode: identity?.snoozeCode || null,
        profileId: identity?.profileId || null,
        identityType: identity?.identityType || null,
        identitySource: identity?.identitySource || null,
        aliasCount: Array.isArray(identity?.aliases) ? identity.aliases.length : 0,
        reason: cleanIdentityValue(input?.reason) || null,
      });
    }

    return identity;
  } catch (error) {
    log("snooze.identity.issue.error", error.message, {
      traceId: meta.traceId || null,
      route: meta.route || null,
      incomingShopperId: cleanIdentityValue(input?.shopperId) || null,
      reason: cleanIdentityValue(input?.reason) || null,
      code: error?.code || null,
    });
    return input?.identity || buildFallbackIdentity(input);
  }
}

function buildIdentityProfilePatch(identity = {}, input = {}) {
  const aliases = Array.isArray(identity?.aliases) ? identity.aliases : [];
  const sourceShopperId = cleanIdentityValue(
    input?.sourceShopperId || identity?.sourceShopperId
  );

  return {
    profileId: cleanIdentityValue(identity?.profileId) || undefined,
    shopperId: cleanIdentityValue(identity?.shopperId) || undefined,
    snoozeCode: cleanIdentityValue(identity?.snoozeCode) || undefined,
    accessCode: cleanIdentityValue(identity?.accessCode) || undefined,
    sessionId:
      cleanIdentityValue(input?.sessionId || identity?.sessionId) || undefined,
    threadId:
      cleanIdentityValue(input?.threadId || identity?.threadId) || undefined,
    visitorId:
      cleanIdentityValue(input?.visitorId || identity?.visitorId) || undefined,
    identityType: cleanIdentityValue(identity?.identityType) || undefined,
    identitySource: cleanIdentityValue(identity?.identitySource) || undefined,
    isTemporary:
      typeof identity?.isTemporary === "boolean" ? identity.isTemporary : undefined,
    sourceShopperId: sourceShopperId || undefined,
    identityAliases: aliases,
    previousShopperIds: sourceShopperId ? [sourceShopperId] : [],
  };
}

async function safeUpsertIdentityAliases(identity = {}, input = {}, meta = {}) {
  if (
    !snoozeIdentityService ||
    typeof snoozeIdentityService.buildAliasProfilePatches !== "function" ||
    !isCanonicalSnoozeIdentity(identity)
  ) {
    return [];
  }

  const aliasPatches = snoozeIdentityService.buildAliasProfilePatches(identity, input);
  const results = [];

  for (const aliasPatch of aliasPatches) {
    const result = await safeUpsertCustomerProfile(aliasPatch, meta);
    results.push(result);
  }

  return results;
}

async function safeMarkIdentityMerge(sourceProfileId = "", identity = {}, meta = {}) {
  const normalizedSourceProfileId = cleanIdentityValue(sourceProfileId);
  const canonicalProfileId = cleanIdentityValue(identity?.profileId);
  if (!normalizedSourceProfileId || !canonicalProfileId || normalizedSourceProfileId === canonicalProfileId) {
    log("snooze.identity.merge.skipped", "no_source_profile", {
      traceId: meta.traceId || null,
      route: meta.route || null,
      profileId: normalizedSourceProfileId || null,
      canonicalProfileId: canonicalProfileId || null,
    });
    return;
  }

  const result = await safeUpsertCustomerProfile(
    {
      profileId: normalizedSourceProfileId,
      mergedIntoProfileId: canonicalProfileId,
      mergedIntoShopperId: cleanIdentityValue(identity?.shopperId) || undefined,
      mergedAt: new Date().toISOString(),
      sourceSurface: cleanIdentityValue(meta.sourceSurface) || undefined,
      lastIntent: cleanIdentityValue(meta.reason) || "identity_merge",
    },
    meta
  );

  if (result?.ok) {
    log("snooze.identity.merged", "ok", {
      traceId: meta.traceId || null,
      route: meta.route || null,
      profileId: normalizedSourceProfileId,
      canonicalProfileId,
      canonicalShopperId: cleanIdentityValue(identity?.shopperId) || null,
      reason: cleanIdentityValue(meta.reason) || null,
    });
  } else {
    log("snooze.identity.merge.skipped", result?.reason || "merge_skipped", {
      traceId: meta.traceId || null,
      route: meta.route || null,
      profileId: normalizedSourceProfileId,
      canonicalProfileId,
      canonicalShopperId: cleanIdentityValue(identity?.shopperId) || null,
      reason: result?.reason || cleanIdentityValue(meta.reason) || null,
    });
  }
}

async function maybeSyncIdentityProfileToZoho(profile = {}, meta = {}) {
  if (!isCanonicalSnoozeIdentity(profile)) {
    log("customer.profile.zoho.identity.skipped", "NO_CANONICAL_SNOOZE_CODE", {
      traceId: meta.traceId || null,
      route: meta.route || null,
      shopperId: cleanIdentityValue(profile?.shopperId) || null,
      reason: "NO_CANONICAL_SNOOZE_CODE",
    });
    return {
      ok: false,
      skipped: true,
      reason: "NO_CANONICAL_SNOOZE_CODE",
    };
  }

  if (typeof syncCustomerProfileToZoho !== "function") {
    log("customer.profile.zoho.identity.skipped", "ZOHO_NOT_CONFIGURED", {
      traceId: meta.traceId || null,
      route: meta.route || null,
      shopperId: cleanIdentityValue(profile?.shopperId) || null,
      reason: "ZOHO_NOT_CONFIGURED",
    });
    return {
      ok: false,
      skipped: true,
      reason: "ZOHO_NOT_CONFIGURED",
    };
  }

  try {
    const result = await syncCustomerProfileToZoho(profile);
    const eventName = result?.ok
      ? "customer.profile.zoho.identity.synced"
      : "customer.profile.zoho.identity.skipped";
    log(eventName, result?.ok ? "ok" : result?.reason || "ZOHO_SYNC_SKIPPED", {
      traceId: meta.traceId || null,
      route: meta.route || null,
      shopperId: cleanIdentityValue(profile?.shopperId) || null,
      reason: result?.reason || null,
      operation: result?.operation || null,
      code: result?.code || null,
      contactId: result?.contactId || null,
    });
    return result;
  } catch (error) {
    log("customer.profile.zoho.identity.error", error.message, {
      traceId: meta.traceId || null,
      route: meta.route || null,
      shopperId: cleanIdentityValue(profile?.shopperId) || null,
      code: error?.code || null,
    });
    return {
      ok: false,
      skipped: true,
      reason: "ZOHO_SYNC_FAILED",
    };
  }
}

async function buildCheckInSummary(profile = {}, sourceSurface = "") {
  const shopperId = cleanIdentityValue(profile?.shopperId);
  let rewardsSummary = null;

  if (
    shopperId &&
    rewardsService &&
    typeof rewardsService.getBalance === "function"
  ) {
    try {
      const balance = await rewardsService.getBalance(shopperId);
      rewardsSummary = {
        balance: Number(balance?.balance || 0),
        updatedAt: balance?.updatedAt || null,
      };
    } catch {
      rewardsSummary = null;
    }
  }

  return {
    ok: true,
    shopperId: shopperId || null,
    snoozeCode:
      cleanIdentityValue(profile?.snoozeCode || profile?.accessCode || shopperId) || null,
    profileId: cleanIdentityValue(profile?.profileId) || `shopper#${shopperId}`,
    leadStage: cleanIdentityValue(profile?.leadStage) || null,
    rewardsSummary,
    recommendationSummary: profile?.canonicalRecommendation
      ? {
          manifestVersion: profile.canonicalRecommendation.manifestVersion || null,
          topPodId: profile.canonicalRecommendation.topPodId || profile.topPodId || null,
          topPodIds: Array.isArray(profile.canonicalRecommendation.topPodIds)
            ? profile.canonicalRecommendation.topPodIds
            : Array.isArray(profile.topPodIds)
              ? profile.topPodIds
              : [],
          primaryMattressHandle:
            profile.canonicalRecommendation.primaryMattressHandle ||
            profile.primaryMattressHandle ||
            null,
          baseHandle:
            profile.canonicalRecommendation.baseHandle != null
              ? profile.canonicalRecommendation.baseHandle
              : profile.baseHandle != null
                ? profile.baseHandle
                : null,
          motionKey:
            profile.canonicalRecommendation.motionKey || profile.motionKey || null,
          reasonKeys: Array.isArray(profile.canonicalRecommendation.reasonKeys)
            ? profile.canonicalRecommendation.reasonKeys
            : Array.isArray(profile.reasonKeys)
              ? profile.reasonKeys
              : [],
        }
      : null,
    bookingStatus: cleanIdentityValue(profile?.bookingStatus) || null,
    sessionPrepStatus:
      cleanIdentityValue(profile?.sessionPrepStatus || profile?.sessionPrep?.status) || null,
    sessionPrep:
      isObject(profile?.sessionPrep) ? cloneJsonValue(profile.sessionPrep) : null,
    sourceSurface: cleanIdentityValue(sourceSurface || profile?.sourceSurface) || null,
  };
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

function buildAskSnoozerQualityGateObject(decision = null, overrides = {}) {
  const safeDecision = isObject(decision) ? decision : {};
  const safeSlots = isObject(safeDecision.slots) ? safeDecision.slots : {};
  const safeOverrides = isObject(overrides) ? overrides : {};
  const sourceOfTruth =
    String(safeOverrides.sourceOfTruth || safeDecision.sourceOfTruth || "fallback").trim() ||
    "fallback";

  return {
    intentGroup: String(safeDecision.intentGroup || "fallback").trim() || "fallback",
    intent: String(safeDecision.intent || "fallback").trim() || "fallback",
    confidence:
      typeof safeDecision.confidence === "number" && Number.isFinite(safeDecision.confidence)
        ? safeDecision.confidence
        : 0,
    slots: safeSlots,
    missingSlots: Array.isArray(safeOverrides.missingSlots)
      ? safeOverrides.missingSlots
      : Array.isArray(safeDecision.missingSlots)
        ? safeDecision.missingSlots
        : [],
    sourceOfTruth,
    shouldUseOpenAI: Boolean(
      safeOverrides.shouldUseOpenAI ?? safeDecision.shouldUseOpenAI
    ),
    shouldAskClarifyingQuestion: Boolean(
      safeOverrides.shouldAskClarifyingQuestion ?? safeDecision.shouldAskClarifyingQuestion
    ),
    answerType:
      String(safeOverrides.answerType || safeDecision.answerType || "fallback").trim() || "fallback",
    factsResolved: Boolean(safeOverrides.factsResolved),
    fallbackUsed: Boolean(safeOverrides.fallbackUsed),
    reason: String(safeOverrides.reason || "").trim() || "",
    knowledgeKeys: Array.isArray(safeDecision.knowledgeKeys) ? safeDecision.knowledgeKeys : [],
  };
}

function buildAskSnoozerChip(label, value, type = "prompt", target = null) {
  const chip = {
    label: String(label || "").trim(),
    value: String(value || label || "").trim(),
    type: String(type || "prompt").trim() || "prompt",
  };

  if (target) chip.target = String(target).trim();
  return chip;
}

function buildAskSnoozerAction(type, label, target = null) {
  const action = {
    type: String(type || "none").trim() || "none",
    label: String(label || "").trim(),
  };

  if (target) action.target = String(target).trim();
  return action;
}

function buildAskSnoozerMissingAssessmentChips() {
  return [
    buildAskSnoozerChip("Start the assessment", "Help me start the Snooze Assessment", "route", "/assessment"),
    buildAskSnoozerChip("I sleep on my side", "I sleep on my side"),
    buildAskSnoozerChip("I sleep hot", "I sleep hot"),
    buildAskSnoozerChip("Mattress only", "I want a mattress only setup"),
  ];
}

function buildAskSnoozerPolicyChips(policySubtype = "") {
  const normalizedSubtype = String(policySubtype || "").trim().toLowerCase();
  if (normalizedSubtype === "returns") {
    return [
      buildAskSnoozerChip("Delivery timing", "How long does delivery take?"),
      buildAskSnoozerChip("Financing options", "Do you offer financing?"),
      buildAskSnoozerChip("Book a Snooze Session", "How do I book a Snooze Session?"),
    ];
  }

  if (normalizedSubtype === "delivery") {
    return [
      buildAskSnoozerChip("Return policy", "What is your return policy?"),
      buildAskSnoozerChip("Setup help", "Do you offer setup or old mattress removal?"),
      buildAskSnoozerChip("Book a Snooze Session", "How do I book a Snooze Session?"),
    ];
  }

  if (normalizedSubtype === "financing") {
    return [
      buildAskSnoozerChip("Return policy", "What is your return policy?"),
      buildAskSnoozerChip("Delivery timing", "How long does delivery take?"),
      buildAskSnoozerChip("Talk to human", "I need human help", "action"),
    ];
  }

  return [
    buildAskSnoozerChip("Return policy", "What is your return policy?"),
    buildAskSnoozerChip("Delivery timing", "How long does delivery take?"),
    buildAskSnoozerChip("Financing options", "Do you offer financing?"),
  ];
}

function maybeBuildAskSnoozerCanonicalAnswer(query, context) {
  const canonicalRecommendation = isObject(context?.canonicalRecommendation)
    ? context.canonicalRecommendation
    : null;
  if (
    !canonicalRecommendation &&
    !isObject(context?.sessionPrep) &&
    !cleanIdentityValue(context?.bookingStatus)
  ) {
    return null;
  }

  const answer = buildAskSnoozerAnswer({
    query,
    canonicalRecommendation,
    context,
  });

  if (
    !answer?.answer_grounded ||
    !["canonical_recommendation", "session_prep"].includes(
      String(answer.answer_strategy || "").trim()
    )
  ) {
    return null;
  }

  return answer;
}

function normalizeAskSnoozerContextPath(value = "") {
  return String(value || "").trim() || "/";
}

const ASK_SNOOZER_COMMERCE_INTENT_GROUPS = new Set([
  "size_price",
  "product_fit",
  "product_compare",
  "couple_conflict",
  "base_elevation",
  "accessory_help",
]);

function resolveAskSnoozerCommerceScope(query = "") {
  const normalizedQuery = normalizeHudAskText(query);
  const mentionsBase =
    normalizedQuery.includes("adjustable base") ||
    normalizedQuery.includes("motion base") ||
    /\bbase\b/.test(normalizedQuery);
  const mentionsMattress =
    normalizedQuery.includes("mattress") ||
    normalizedQuery.includes("hybrid") ||
    normalizedQuery.includes("foam") ||
    normalizedQuery.includes("dual comfort");
  const mentionsPod =
    normalizedQuery.includes("full pod") ||
    normalizedQuery.includes("snoozepod") ||
    normalizedQuery.includes("pod price") ||
    normalizedQuery.includes("mattress + base") ||
    normalizedQuery.includes("mattress and base") ||
    normalizedQuery.includes("mattress plus base");

  if (mentionsPod || (mentionsBase && mentionsMattress)) return "full_pod";
  if (mentionsBase && !mentionsMattress) return "base_only";
  if (mentionsMattress) return "mattress_only";
  return "unclear";
}

function resolveAskSnoozerCommerceResolverIntent(classification = null, query = "") {
  const intent = String(classification?.intent || "").trim();
  const intentGroup = String(classification?.intent_group || "").trim();
  const policySubtype = String(classification?.policy_subtype || "").trim();
  const scope = resolveAskSnoozerCommerceScope(query);
  const isPricingPolicy = intentGroup === "policy_support" && policySubtype === "pricing";
  const isPriceShapedSizeIntent =
    intentGroup === "size_price" &&
    (normalizeHudAskText(query).includes("price") ||
      normalizeHudAskText(query).includes("cost") ||
      normalizeHudAskText(query).includes("how much"));

  if (!isPricingPolicy && !isPriceShapedSizeIntent) {
    return intent || "fallback";
  }

  if (scope === "full_pod") return "bundle_price";
  if (scope === "base_only") return "snoring";
  return "budget_value";
}

function resolveAskSnoozerCommerceMetaIntent({
  classification = null,
  query = "",
  answerStrategy = null,
} = {}) {
  const normalizedQuery = normalizeHudAskText(query);
  const answerType =
    String(answerStrategy?.metaExtra?.answer_strategy || answerStrategy?.answer_strategy || "").trim() ||
    "";
  if (
    answerType === "verified_size_availability" ||
    normalizedQuery.includes("availability") ||
    normalizedQuery.includes("available") ||
    normalizedQuery.includes("in stock")
  ) {
    return "availability";
  }
  if (
    String(classification?.policy_subtype || "").trim() === "pricing" ||
    answerType === "verified_price" ||
    answerType === "verified_bundle_price"
  ) {
    return "pricing";
  }
  return String(classification?.intent || "").trim() || "commerce";
}

function isAskSnoozerCommerceClassification(classification = null) {
  const intentGroup = String(classification?.intent_group || "").trim();
  const policySubtype = String(classification?.policy_subtype || "").trim();
  return (
    ASK_SNOOZER_COMMERCE_INTENT_GROUPS.has(intentGroup) ||
    (intentGroup === "policy_support" && policySubtype === "pricing")
  );
}

function shouldUseAskSnoozerCommerceAnswer(answerStrategy = null) {
  const strategy =
    String(answerStrategy?.metaExtra?.answer_strategy || answerStrategy?.answer_strategy || "").trim() ||
    "safe_fallback";
  if (strategy === "safe_fallback") return false;
  return Boolean(answerStrategy?.replyOverride) && (
    Boolean(answerStrategy?.metaExtra?.answer_grounded) ||
    strategy === "needs_product_clarification"
  );
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
    "help during my session",
    "need help during my session",
    "help during the session",
    "need help during the session",
    "help at my session",
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

const ASK_SNOOZER_EXPLICIT_COMMERCE_TERMS = Object.freeze([
  "price",
  "cost",
  "how much",
  "buy",
  "purchase",
  "checkout",
  "cart",
  "add to cart",
  "available",
  "availability",
  "in stock",
  "compare price",
  "cheapest",
  "lowest price",
  "payment",
  "finance",
  "financing",
  "build",
]);

const ASK_SNOOZER_BASE_GUIDANCE_TERMS = Object.freeze([
  "what base works with this",
  "what base works with it",
  "which base works with this",
  "which base works with it",
  "what base should i use",
  "which base should i use",
]);

function getAskSnoozerShowroomProductMap() {
  const manifest = loadShowroomManifest();
  const products = Array.isArray(manifest?.products) ? manifest.products : [];
  return new Map(products.map((product) => [String(product?.handle || "").trim(), product]));
}

function getAskSnoozerShowroomProduct(handle = "") {
  return getAskSnoozerShowroomProductMap().get(String(handle || "").trim()) || null;
}

function extractAskSnoozerCurrentProductHandle(context = {}) {
  const explicit = String(context?.currentProductHandle || "").trim();
  if (explicit) return explicit;
  const rawPath = String(context?.path || "").trim();
  const match = rawPath.match(/^\/products\/([^/?#]+)/i);
  return match ? String(match[1] || "").trim() : "";
}

function queryExplicitlyRequestsAskSnoozerCommerce(query = "") {
  const normalized = normalizeHudAskText(query);
  return ASK_SNOOZER_EXPLICIT_COMMERCE_TERMS.some((term) =>
    normalized.includes(normalizeHudAskText(term))
  );
}

function queryLooksLikeAskSnoozerBaseGuidance(query = "") {
  const normalized = normalizeHudAskText(query);
  return ASK_SNOOZER_BASE_GUIDANCE_TERMS.some((term) =>
    normalized.includes(normalizeHudAskText(term))
  );
}

function buildAskSnoozerStubProducts(handles = []) {
  return Array.from(
    new Set(
      (Array.isArray(handles) ? handles : [])
        .map((handle) => String(handle || "").trim())
        .filter(Boolean)
    )
  )
    .map((handle) => {
      const product = getAskSnoozerShowroomProduct(handle);
      if (!product) return null;
      return {
        handle,
        title: String(product.title || handle).trim(),
        label: String(product.title || handle).trim(),
        href: String(product.shopifyPath || `/products/${handle}`).trim(),
      };
    })
    .filter(Boolean);
}

function formatAskSnoozerCustomerTitle(value = "") {
  return String(value || "")
    .replace(/(\d+)\s*"/g, "$1-inch")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAskSnoozerGuidanceHandles({
  classification = null,
  canonicalRecommendation = null,
  currentProductHandle = "",
} = {}) {
  const handles = [];
  const intentGroup = String(classification?.intent_group || "").trim();

  if (currentProductHandle) handles.push(currentProductHandle);
  if (canonicalRecommendation?.primaryMattressHandle) {
    handles.push(canonicalRecommendation.primaryMattressHandle);
  }
  if (canonicalRecommendation?.baseHandle) {
    handles.push(canonicalRecommendation.baseHandle);
  }

  if (intentGroup === "base_elevation") {
    handles.push(canonicalRecommendation?.baseHandle || "premium-motion-adjustable-base");
  } else if (intentGroup === "product_compare") {
    handles.push("12-all-foam-mattress", "14-hybrid");
  } else if (intentGroup === "couple_conflict") {
    handles.push("12-dual-comfort-hybrid", "14-hybrid");
  } else if (intentGroup === "product_fit") {
    handles.push("14-hybrid");
  }

  return Array.from(new Set(handles.map((handle) => String(handle || "").trim()).filter(Boolean)));
}

function buildAskSnoozerBaseGuidanceAnswer({
  query = "",
  context = {},
  canonicalRecommendation = null,
} = {}) {
  if (!queryLooksLikeAskSnoozerBaseGuidance(query)) return null;

  const currentProductHandle = extractAskSnoozerCurrentProductHandle(context);
  const currentProduct = getAskSnoozerShowroomProduct(currentProductHandle);
  const mattressHandle =
    String(
      canonicalRecommendation?.primaryMattressHandle ||
        (currentProduct?.catalogType === "mattress" ? currentProductHandle : "")
    ).trim() || "";
  const mattressTitle = formatAskSnoozerCustomerTitle(
    canonicalRecommendation?.primaryMattressTitle ||
      getAskSnoozerShowroomProduct(mattressHandle)?.title ||
      currentProduct?.title ||
      ""
  );
  const baseHandle =
    Object.prototype.hasOwnProperty.call(canonicalRecommendation || {}, "baseHandle")
      ? canonicalRecommendation.baseHandle
      : null;

  if (!mattressHandle && !mattressTitle) {
    return {
      reply:
        "Which mattress do you mean - the 14-inch Hybrid, 12-inch Dual Comfort Hybrid, or 12-inch All Foam?",
      answer_grounded: false,
      answer_source_type: "clarification",
      answer_source_key: null,
      answer_facts_count: 0,
      matched_preview: "",
      extracted_facts: [],
      answer_strategy: "needs_product_clarification",
      reason: "needs_product_clarification",
      chips_override: null,
      products: [],
    };
  }

  if (baseHandle === "platform-base") {
    return {
      reply: `The Platform Base works as the simple non-motion option with ${mattressTitle || "your recommended mattress"}. If you want head or foot elevation, compare the motion base options during your Snooze Session.`,
      answer_grounded: true,
      answer_source_type: "canonical_profile",
      answer_source_key: "platform-base",
      answer_facts_count: 2,
      matched_preview: `Platform Base ${mattressTitle || "recommended mattress"} non-motion option`,
      extracted_facts: [
        "Platform Base is the simple non-motion option.",
        "Motion bases are the next comparison if elevation matters.",
      ],
      answer_strategy: "base_guidance",
      reason: "base_guidance_resolved",
      chips_override: null,
      products: [],
    };
  }

  if (baseHandle === "premium-motion-adjustable-base") {
    return {
      reply: `The Premium Motion Adjustable Base is the stronger fit with ${mattressTitle || "your recommended mattress"} if you want head or foot elevation. If you want the simpler non-motion route, compare the Platform Base too.`,
      answer_grounded: true,
      answer_source_type: "canonical_profile",
      answer_source_key: "premium-motion-adjustable-base",
      answer_facts_count: 2,
      matched_preview: `Premium Motion Adjustable Base ${mattressTitle || "recommended mattress"} elevation option`,
      extracted_facts: [
        "Premium Motion Adjustable Base adds head and foot elevation.",
        "Platform Base stays the simpler non-motion comparison.",
      ],
      answer_strategy: "base_guidance",
      reason: "base_guidance_resolved",
      chips_override: null,
      products: [],
    };
  }

  if (baseHandle == null) {
    return {
      reply: `If you want to keep ${mattressTitle || "the mattress match"} simple, start mattress-only and leave the base out for now. If elevation matters later, compare the motion base options during your Snooze Session.`,
      answer_grounded: true,
      answer_source_type: "canonical_profile",
      answer_source_key: mattressHandle || null,
      answer_facts_count: 2,
      matched_preview: `${mattressTitle || "mattress match"} no-base guidance`,
      extracted_facts: [
        "Current recommendation keeps the base out.",
        "Motion bases are the next comparison if elevation matters later.",
      ],
      answer_strategy: "base_guidance",
      reason: "base_guidance_resolved",
      chips_override: null,
      products: [],
    };
  }

  return {
    reply: `The Platform Base is the simple non-motion option with ${mattressTitle || "this mattress"}. If you want head or foot elevation, compare the motion base options during your Snooze Session.`,
    answer_grounded: true,
    answer_source_type: mattressHandle ? "s3_product" : "canonical_profile",
    answer_source_key: baseHandle || mattressHandle || null,
    answer_facts_count: 2,
    matched_preview: `${mattressTitle || "mattress"} base guidance`,
    extracted_facts: [
      "Platform Base is the simple non-motion option.",
      "Motion bases are worth comparing if elevation matters.",
    ],
    answer_strategy: "base_guidance",
    reason: "base_guidance_resolved",
    chips_override: null,
    products: [],
  };
}

async function maybeBuildAskSnoozerDeterministicGuidanceAnswer({
  query = "",
  context = {},
  traceId = "",
  decision = null,
  classification = null,
} = {}) {
  const resolvedClassification = classification || buildAskSnoozerClassification(query, context);
  const resolvedDecision = isObject(decision) ? decision : null;
  if (String(resolvedDecision?.intentGroup || "").trim() !== "product_education") {
    return null;
  }
  if (queryExplicitlyRequestsAskSnoozerCommerce(query)) {
    return null;
  }

  const canonicalRecommendation = isObject(context?.canonicalRecommendation)
    ? context.canonicalRecommendation
    : null;

  const baseGuidance = buildAskSnoozerBaseGuidanceAnswer({
    query,
    context,
    canonicalRecommendation,
  });
  if (baseGuidance) {
    return {
      classification: resolvedClassification,
      ...baseGuidance,
    };
  }

  const currentProductHandle = extractAskSnoozerCurrentProductHandle(context);
  const stubProducts = buildAskSnoozerStubProducts(
    buildAskSnoozerGuidanceHandles({
      classification: resolvedClassification,
      canonicalRecommendation,
      currentProductHandle,
    })
  );

  const supplemental = await resolveAskSnoozerSupplementalSources({
    classification: resolvedClassification,
    query,
    path: normalizeAskSnoozerContextPath(context?.path),
    products: stubProducts,
    traceId,
    timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
  });

  const answer = buildAskSnoozerAnswer({
    query,
    intent: String(resolvedClassification?.intent || "").trim(),
    intent_group: String(resolvedClassification?.intent_group || "").trim(),
    context,
    sources: Array.isArray(supplemental?.sources) ? supplemental.sources : [],
    products: stubProducts,
    productContext: {
      entries: stubProducts.map((product) => ({
        handle: product.handle,
        title: product.title,
        label: product.label,
      })),
      currentProductHandle,
      sizeLabel:
        String(
          resolvedClassification?.size_label ||
            parseAskSnoozerSizeLabel(query) ||
            canonicalRecommendation?.normalizedAssessment?.size ||
            ""
        ).trim() || "",
      answerSourceType: currentProductHandle ? "s3_product" : "canonical_profile",
    },
    canonicalRecommendation,
  });

  if (!answer?.reply) return null;

  return {
    classification: resolvedClassification,
    reply: answer.reply,
    answer_grounded: Boolean(answer.answer_grounded),
    answer_source_type: answer.answer_source_type || (currentProductHandle ? "s3_product" : "canonical_profile"),
    answer_source_key: answer.answer_source_key || currentProductHandle || canonicalRecommendation?.primaryMattressHandle || null,
    answer_facts_count: Number(answer.answer_facts_count || 0),
    matched_preview: answer.matched_preview || "",
    extracted_facts: Array.isArray(answer.extracted_facts) ? answer.extracted_facts : [],
    answer_strategy: answer.answer_strategy || "source_summary",
    reason: answer.reason || (answer.answer_grounded ? "product_education_resolved" : "no_source"),
    chips_override: Array.isArray(answer.chips_override) ? answer.chips_override : null,
    products: [],
  };
}

async function maybeBuildAskSnoozerCommerceAnswer({
  query = "",
  context = {},
  traceId = "",
  classification = null,
} = {}) {
  const resolvedClassification = classification || buildAskSnoozerClassification(query, context);
  if (!isAskSnoozerCommerceClassification(resolvedClassification)) {
    return null;
  }

  const intent = resolveAskSnoozerCommerceResolverIntent(resolvedClassification, query);
  const path = normalizeAskSnoozerContextPath(context?.path);
  const pageType =
    String(context?.page_type || context?.pageType || "unknown").trim() || "unknown";
  const canonicalRecommendation = isObject(context?.canonicalRecommendation)
    ? context.canonicalRecommendation
    : null;
  const currentProductHandle = String(context?.currentProductHandle || "").trim();
  const requestedSize =
    String(resolvedClassification?.size_label || "").trim() || resolveHudAskRequestedSizeLabel(intent, query);
  const scope = resolveAskSnoozerCommerceScope(query);
  const metaIntent = resolveAskSnoozerCommerceMetaIntent({
    classification: resolvedClassification,
    query,
  });
  log("ask-snoozer.commerce.intent", "detected", {
    traceId,
    intent: metaIntent,
    rawIntent: resolvedClassification?.intent || null,
    intentGroup: resolvedClassification?.intent_group || null,
    scope,
    requestedSize: requestedSize || null,
    source: "commerce",
  });
  log("ask-snoozer.commerce.shopify.start", "resolve_products", {
    traceId,
    intent: metaIntent,
    resolverIntent: intent,
    scope,
    requestedSize: requestedSize || null,
    currentProductHandle: currentProductHandle || null,
    source: "shopify",
  });
  const productResolution = await resolveHudAskProducts({
    classification: resolvedClassification,
    intent,
    query,
    path,
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

  const entries = Array.isArray(productResolution?.entries) ? productResolution.entries : [];
  const resolvedProductHandle =
    products.find((product) => !String(product?.handle || "").trim().toLowerCase().includes("adjustable-base"))?.handle || null;
  const resolvedBaseHandle =
    products.find((product) => String(product?.handle || "").trim().toLowerCase().includes("adjustable-base"))?.handle || null;
  const variantMatched = entries.some((entry) => String(entry?.variantId || "").trim());
  const shopifyPriceFound = entries.some((entry) => Number.isFinite(Number(entry?.variantPrice)));
  log("ask-snoozer.commerce.resolve", "products_resolved", {
    traceId,
    intent: metaIntent,
    resolverIntent: intent,
    scope,
    requestedSize: requestedSize || null,
    resolvedProductHandle,
    resolvedBaseHandle,
    variantMatched,
    shopifyPriceFound,
    source: "shopify",
  });
  log("ask-snoozer.commerce.shopify.result", "completed", {
    traceId,
    intent: metaIntent,
    resolverIntent: intent,
    scope,
    requestedSize: requestedSize || null,
    resolvedProductHandle,
    resolvedBaseHandle,
    variantMatched,
    shopifyPriceFound,
    source: "shopify",
  });

  const answerStrategy = await resolveHudAskAnswerStrategy({
    classification: resolvedClassification,
    intent,
    query,
    path,
    pageType,
    traceId,
    products,
    productResolution,
    canonicalRecommendation,
    context,
  });

  if (!shouldUseAskSnoozerCommerceAnswer(answerStrategy)) {
    log("ask-snoozer.commerce.fallback", "no_deterministic_answer", {
      traceId,
      intent: metaIntent,
      resolverIntent: intent,
      scope,
      requestedSize: requestedSize || null,
      resolvedProductHandle,
      resolvedBaseHandle,
      variantMatched,
      shopifyPriceFound,
      source: "commerce",
      fallbackUsed: true,
      reason:
        answerStrategy?.metaExtra?.answer_strategy ||
        answerStrategy?.answer_strategy ||
        "no_commerce_answer",
    });
    return null;
  }

  log("ask-snoozer.commerce.answer", "resolved", {
    traceId,
    intent: metaIntent,
    resolverIntent: intent,
    scope,
    requestedSize: requestedSize || null,
    resolvedProductHandle,
    resolvedBaseHandle,
    variantMatched,
    shopifyPriceFound,
    source: "shopify",
    fallbackUsed: false,
    answerStrategy:
      answerStrategy?.metaExtra?.answer_strategy ||
      answerStrategy?.answer_strategy ||
      null,
  });

  return {
    classification: resolvedClassification,
    metaIntent,
    scope,
    requestedSize,
    resolvedProductHandle,
    resolvedBaseHandle,
    variantMatched,
    shopifyPriceFound,
    products,
    productResolution,
    ...answerStrategy,
  };
}

function buildAskSnoozerPreviewText(value = "", maxChars = 160) {
  const cleaned = cleanShopperText(value);
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 3).trim()}...`;
}

function buildAskSnoozerGuidedFaqResult({
  classification = null,
  reply = "",
  answerGrounded = false,
  answerSourceType = "fallback",
  answerSourceKey = "",
  answerStrategy = "safe_fallback",
  extractedFacts = [],
  reason = "",
  sourceOfTruth = "",
  answerType = "fallback",
} = {}) {
  return {
    classification,
    reply,
    answer_grounded: Boolean(answerGrounded),
    answer_source_type: answerSourceType,
    answer_source_key: answerSourceKey,
    answer_facts_count: Array.isArray(extractedFacts) ? extractedFacts.length : 0,
    matched_preview: buildAskSnoozerPreviewText(
      Array.isArray(extractedFacts) && extractedFacts.length ? extractedFacts.join(" ") : reply
    ),
    answer_strategy: answerStrategy,
    extracted_facts: Array.isArray(extractedFacts) ? extractedFacts : [],
    reason,
    chips_override: null,
    source_of_truth: sourceOfTruth || answerSourceType || "fallback",
    answer_type: answerType,
  };
}

function buildAskSnoozerActionGuidanceConfig(intentGroup = "") {
  switch (String(intentGroup || "").trim()) {
    case "assessment_handoff":
      return {
        actions: [HUD_ASK_ACTION_ASSESSMENT],
        pages: [HUD_ASK_PAGE_ASSESSMENT],
      };
    case "booking_handoff":
      return {
        actions: [HUD_ASK_ACTION_BOOKING],
        pages: [HUD_ASK_PAGE_BOOKING],
      };
    case "cart_confidence":
      return {
        actions: [HUD_ASK_ACTION_ASSESSMENT],
        pages: [HUD_ASK_PAGE_BOOKING],
      };
    case "brand_education":
      return {
        actions: [HUD_ASK_ACTION_ASSESSMENT],
        pages: [HUD_ASK_PAGE_BOOKING],
      };
    default:
      return {
        actions: [],
        pages: [],
      };
  }
}

function resolveAskSnoozerRestTestScriptKey(query = "") {
  const normalized = normalizeHudAskText(query);
  if (
    normalized.includes("notice") ||
    normalized.includes("during") ||
    normalized.includes("look for") ||
    normalized.includes("pay attention")
  ) {
    return "pod.rest.quick.reflection";
  }
  if (normalized.includes("after") || normalized.includes("next")) {
    return "pod.rest.quick.actions";
  }
  if (normalized.includes("head up")) return "pod.rest.head_up";
  if (normalized.includes("zero g") || normalized.includes("zero gravity")) return "pod.rest.zero_g";
  if (normalized.includes("return flat") || normalized.includes("go flat")) return "pod.rest.return_flat";
  return "pod.rest.quick.start";
}

async function buildAskSnoozerHudScriptGuidanceAnswer({
  query = "",
  traceId = "",
  classification = null,
  scriptKey = "",
  answerType = "guidance",
} = {}) {
  if (!scriptKey || typeof getHudScriptPayload !== "function") return null;

  const payload = await getHudScriptPayload(
    { scriptKey },
    { traceId, timeoutMs: hudScriptSafeTimeoutMs }
  );
  const reply = cleanShopperText(payload?.captions || payload?.speech || "");
  if (!reply) return null;

  const sourceKey = String(payload?.scriptMeta?.resolvedS3Key || scriptKey).trim() || scriptKey;
  return buildAskSnoozerGuidedFaqResult({
    classification,
    reply,
    answerGrounded: true,
    answerSourceType: "hud_script",
    answerSourceKey: sourceKey,
    answerStrategy: "script_guidance",
    extractedFacts: [reply],
    reason: "script_guidance_resolved",
    sourceOfTruth: "hud_script",
    answerType,
  });
}

function buildAskSnoozerIdentityGuidanceAnswer({ query = "", context = {}, shopperId = "" } = {}) {
  const normalizedShopperId = cleanIdentityValue(
    context?.snoozeCode ||
      context?.accessCode ||
      context?.shopperId ||
      shopperId
  );
  const hasCanonical = isObject(context?.canonicalRecommendation);
  const hasSessionPrep = isObject(context?.sessionPrep);
  const bookingStatus = cleanIdentityValue(context?.bookingStatus);
  const codeLabel = normalizedShopperId ? `Snooze Code ${normalizedShopperId}` : "Your Snooze Code";

  const reply = hasCanonical || hasSessionPrep || bookingStatus
    ? `${codeLabel} is your save-and-return key. Use it to unlock your recommendations, rewards, and Snooze Session prep, then check in so I can pull up your saved profile instead of starting over.`
    : `${codeLabel} is your save-and-return key. Use it to unlock your recommendations, rewards, and Snooze Session prep, then enter it in Snooze Code check-in any time you want me to load your saved profile.`;

  return buildAskSnoozerGuidedFaqResult({
    classification: buildAskSnoozerClassification(query, context),
    reply,
    answerGrounded: Boolean(normalizedShopperId || hasCanonical || hasSessionPrep || bookingStatus),
    answerSourceType:
      normalizedShopperId || hasCanonical || hasSessionPrep || bookingStatus
        ? "identity_profile"
        : "identity_guidance",
    answerSourceKey: normalizedShopperId || "snooze_code_check_in",
    answerStrategy: "identity_guidance",
    extractedFacts: [
      "A Snooze Code unlocks your saved recommendations, rewards, and Snooze Session prep.",
      normalizedShopperId
        ? `The active Snooze Code is ${normalizedShopperId}.`
        : "Check-in loads the saved profile tied to the code.",
    ],
    reason: "identity_guidance_resolved",
    sourceOfTruth:
      normalizedShopperId || hasCanonical || hasSessionPrep || bookingStatus
        ? "identity_profile"
        : "identity_guidance",
    answerType: "identity_guidance",
  });
}

function resolveAskSnoozerCompetitorLabel(query = "") {
  const normalized = normalizeHudAskText(query);
  if (normalized.includes("tempur-pedic") || normalized.includes("tempurpedic")) {
    return "Tempur-Pedic";
  }
  if (normalized.includes("sleep number")) return "Sleep Number";
  if (normalized.includes("casper")) return "Casper";
  if (normalized.includes("nectar")) return "Nectar";
  if (normalized.includes("beautyrest")) return "Beautyrest";
  if (normalized.includes("serta")) return "Serta";
  if (normalized.includes("sealy")) return "Sealy";
  if (normalized.includes("purple")) return "Purple";
  return "that brand";
}

function buildAskSnoozerCatalogBoundaryAnswer({ query = "", context = {} } = {}) {
  const competitorLabel = resolveAskSnoozerCompetitorLabel(query);
  const currentProductHandle = extractAskSnoozerCurrentProductHandle(context);
  const currentProduct = currentProductHandle
    ? getAskSnoozerShowroomProduct(currentProductHandle)
    : null;
  const currentTitle = cleanShopperText(currentProduct?.title || "");

  const reply = currentTitle
    ? `I can compare what you like about ${competitorLabel} against our lineup, but I only ground recommendations to the MySnoozePod catalog here. Since you're looking at ${currentTitle}, tell me whether you want softer pressure relief, firmer support, lower motion transfer, or adjustable-base compatibility and I'll point you to the closest match in our line.`
    : `I can compare what you like about ${competitorLabel} against our lineup, but I only ground recommendations to the MySnoozePod catalog here. Tell me the feel or support you want and I'll map it to the closest match in our line.`;

  return buildAskSnoozerGuidedFaqResult({
    classification: buildAskSnoozerClassification(query, context),
    reply,
    answerGrounded: true,
    answerSourceType: "catalog_boundary",
    answerSourceKey: competitorLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    answerStrategy: "catalog_boundary",
    extractedFacts: [
      "Recommendations are grounded to the MySnoozePod catalog only.",
      currentTitle
        ? `The current MySnoozePod anchor is ${currentTitle}.`
        : "A direct competitor product match is not grounded in this catalog.",
    ],
    reason: "catalog_boundary_resolved",
    sourceOfTruth: "catalog_boundary",
    answerType: "catalog_boundary",
  });
}

async function buildAskSnoozerSourceGuidedFaqAnswer({
  query = "",
  context = {},
  traceId = "",
  classification = null,
} = {}) {
  const intent = String(classification?.intent || "").trim();
  const intentGroup = String(classification?.intent_group || "").trim();
  const actionConfig = buildAskSnoozerActionGuidanceConfig(intentGroup);
  const supplemental = await resolveAskSnoozerSupplementalSources({
    classification,
    query,
    path: normalizeAskSnoozerContextPath(context?.path),
    products: [],
    traceId,
    timeoutMs: S3_RETRIEVAL_TIMEOUT_MS,
  });

  const answer = buildAskSnoozerAnswer({
    query,
    intent,
    intent_group: intentGroup,
    context,
    sources: Array.isArray(supplemental?.sources) ? supplemental.sources : [],
    actions: actionConfig.actions,
    pages: actionConfig.pages,
  });

  if (!answer?.reply) return null;

  return {
    classification,
    ...answer,
    source_of_truth:
      intentGroup === "brand_education"
        ? "local_brand"
        : "action_allowlist",
    answer_type:
      intentGroup === "booking_handoff"
        ? "booking_guidance"
        : intentGroup === "assessment_handoff"
          ? "assessment_guidance"
          : intentGroup === "cart_confidence"
            ? "cart_guidance"
            : "brand_guidance",
  };
}

async function maybeBuildAskSnoozerDeterministicFaqAnswer({
  query = "",
  context = {},
  traceId = "",
  shopperId = "",
} = {}) {
  const classification = buildAskSnoozerClassification(query, context);
  const intentGroup = String(classification?.intent_group || "").trim();

  if (isSnoozeCodeQuery(query)) {
    return buildAskSnoozerIdentityGuidanceAnswer({
      query,
      context,
      shopperId,
    });
  }

  if (isRestTestGuidanceQuery(query)) {
    return buildAskSnoozerHudScriptGuidanceAnswer({
      query,
      traceId,
      classification,
      scriptKey: resolveAskSnoozerRestTestScriptKey(query),
      answerType: "rest_test_guidance",
    });
  }

  if (isBuildGuidanceQuery(query, context)) {
    return buildAskSnoozerHudScriptGuidanceAnswer({
      query,
      traceId,
      classification,
      scriptKey: "pod.build.default",
      answerType: "build_guidance",
    });
  }

  if (isUnknownProductQuery(query)) {
    return buildAskSnoozerCatalogBoundaryAnswer({
      query,
      context,
    });
  }

  if (["brand_education", "assessment_handoff", "booking_handoff"].includes(intentGroup)) {
    return buildAskSnoozerSourceGuidedFaqAnswer({
      query,
      context,
      traceId,
      classification,
    });
  }

  if (looksLikeAskSnoozerSupportQuestion(query)) {
    return buildAskSnoozerGuidedFaqResult({
      classification,
      reply: buildAskSnoozerSupportReply(query),
      answerGrounded: false,
      answerSourceType: "deterministic_support",
      answerSourceKey: "contact_support",
      answerStrategy: "safe_fallback",
      extractedFacts: [],
      reason: "support_fallback",
      sourceOfTruth: "deterministic_support",
      answerType: "support_guidance",
    });
  }

  return null;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// IoT Scene Trigger (publish to IoT Core if configured)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Main
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  const hudRouteResponse = await hudRoutes.handleHudRoutes({
    event,
    method,
    routePath,
    traceId,
    deps: {
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
    },
  });
  if (hudRouteResponse) return hudRouteResponse;

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Voice: Welcome / Polly
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

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ HUD TTS
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

  const assessmentRouteResponse = await assessmentRoutes.handleAssessmentRoutes({
    event,
    method,
    routePath,
    traceId,
    deps: {
      response,
      safeJsonBody,
      baseHeaders,
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
    },
  });
  if (assessmentRouteResponse) return assessmentRouteResponse;

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Sessions: START
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

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Sessions: GET context
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

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Sessions: PATCH context
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

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Admin reindex
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

  const identityRouteResponse = await identityRoutes.handleIdentityRoutes({
    event,
    method,
    routePath,
    traceId,
    deps: {
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
    },
  });
  if (identityRouteResponse) return identityRouteResponse;

  const bookingRouteResponse = await bookingRoutes.handleBookingRoutes({
    event,
    method,
    routePath,
    traceId,
    deps: {
      response,
      bookingSessionService,
      safeJsonBody,
      log,
    },
  });
  if (bookingRouteResponse) return bookingRouteResponse;

  const shopifyRouteResponse = await shopify.handleShopifyRoute({
    event,
    method,
    routePath,
  });
  if (shopifyRouteResponse) return shopifyRouteResponse;

  // ???????????????????????????????????????????????????????????????????????????????????????? Rewards
  if (
    rewardsRoutes &&
    (routePath.startsWith("/rewards") ||
      routePath === "/webhooks/shopify/rewards") &&
    typeof rewardsRoutes.handleRewardsRoutes === "function"
  ) {
    const rewardsResponse = await rewardsRoutes.handleRewardsRoutes(event, {
      getAssessmentResult,
    });
    if (rewardsResponse) return rewardsResponse;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Ask Snoozer (SCO-aware + deterministic-first)
  const askSnoozerRouteResponse = await askSnoozerRoutes.handleAskSnoozerRoutes({
    event,
    method,
    routePath,
    traceId,
    deps: {
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
      shopifySvc,
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
    },
  });
  if (askSnoozerRouteResponse) return askSnoozerRouteResponse;

  if (method === "POST" && routePath === "/crm/track-event") {
    const body = safeJsonBody(event);
    log("crm.event", "track", { ...body, traceId });
    return response(event, 200, { ok: true });
  }

  const recommendationRouteResponse = await recommendationRoutes.handleRecommendationRoutes({
    event,
    method,
    routePath,
    deps: {
      response,
      recsService,
      getSeedRecommendations,
      recommendationResolver,
      safeJsonBody,
    },
  });
  if (recommendationRouteResponse) return recommendationRouteResponse;

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ IoT Scene Trigger
  if (method === "POST" && routePath === "/iot/trigger-scene") {
    const { podId, scene } = safeJsonBody(event);
    try {
      const out = await triggerScene({ podId, scene });
      return response(event, 200, out);
    } catch (e) {
      return response(event, 500, { ok: false, code: "E_IOT", message: e.message });
    }
  }

  if (method === "POST" && routePath === "/iot/physical-control/commands") {
    const body = safeJsonBody(event);
    try {
      const out = await issuePhysicalControlCommand(body);
      return response(event, out.ok || out.duplicate || out.skipped ? 200 : 400, out);
    } catch (e) {
      log("iot.physical_control", "error", {
        traceId,
        err: e.message,
      });
      return response(event, 500, {
        ok: false,
        code: "E_IOT_PHYSICAL_CONTROL",
        message: e.message,
      });
    }
  }

  return response(event, 404, { message: "Not found" });
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Export Lambda
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

exports.iotZoneEventHandler = async (event, context) => {
  return handleIotZoneEvent(event, context);
};

exports.iotWebSocketHandler = async (event, context) => {
  return handleIotWebSocket(event, context);
};

exports.iotWebSocketCleanupHandler = async (event, context) => {
  return handleIotWebSocketCleanup(event, context);
};

exports.iotPhysicalControlCommandHandler = async (event) => {
  return issuePhysicalControlCommand(safeJsonBody(event));
};

exports.iotPhysicalControlAckHandler = async (event, context) => {
  return handleIotPhysicalControlAck(event, context);
};

exports.iotPhysicalControlReportedStateHandler = async (event, context) => {
  return handleIotPhysicalControlReportedState(event, context);
};

exports.iotPhysicalControlTimeoutHandler = async (event, context) => {
  return handleIotPhysicalControlTimeout(event, context);
};
