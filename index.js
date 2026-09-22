// index.js Ã¢â‚¬â€ Omnia / Snoozer Backend Core
// Handler: index.lambdaHandler
//
// Ask Snoozer authority:
// - Session (SCO) is the source of truth for "where the shopper is"
// - Pod mode requires podId + exploreContext (or explore) to anchor product identity
// - Do NOT do pre-search / listProducts / recs lookups inside /ask-snoozer
// - Pricing, cart, and checkout remain deterministic domain operations
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
const activeJourneyRoutes = require("./routes/activeJourneyRoutes");
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

const { handleRewardsRoutes } = require("./routes/rewardsRoutes");

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

let askSnoozerModelCoreSvc = null;
function getAskSnoozerModelCoreSvc() {
  if (askSnoozerModelCoreSvc) return askSnoozerModelCoreSvc;
  try {
    askSnoozerModelCoreSvc = require("./services/askSnoozerModelCore");
  } catch (error) {
    console.log("Ask Snoozer model core not loaded (ok).", error.message);
    askSnoozerModelCoreSvc = null;
  }
  return askSnoozerModelCoreSvc;
}

const {
  cleanShopperText,
  resolveAskSnoozerPolicyAnswer,
} = require("./services/askSnoozerPolicy");
const {
  buildAskSnoozerClarificationReply,
  buildAskSnoozerFallbackReply,
  buildAskSnoozerMissingRecommendationReply,
  resolveAskSnoozerCommerceResponse,
} = require("./services/askSnoozerQualityGate");
const {
  clampAskSnoozerVoiceReply,
} = require("./services/askSnoozerAnswerEngine");
const {
  enqueueAskSnoozerAsyncWrites,
  isAskSnoozerAsyncWriteEvent,
  parseAskSnoozerAsyncWriteRecord,
} = require("./services/askSnoozerAsyncWrites");
const {
  applyAskSnoozerWorkingMemory,
  buildWorkingMemoryLogMetadata,
  completeAskSnoozerAdvisorTurn,
  completeAskSnoozerPriceGoal,
  markAskSnoozerPriceGoalResolving,
  safeResponseFingerprint,
} = require("./services/askSnoozerWorkingMemory");
const {
  planAskSnoozerTurn,
  resolveAskSnoozerAdvisorTurn,
} = require("./services/askSnoozerConversationOrchestrator");
const {
  buildDeterministicAtomicDecision,
  resolveAskSnoozerSemanticAuthority,
  resolvePendingCommitmentProtocol,
  shouldPlanAskSnoozerWithModel,
} = require("./services/askSnoozerModelPlanner");
const {
  resolveAskSnoozerVisitLifecycle,
} = require("./services/askSnoozerVisitLifecycle");
const {
  buildAskJourneyPayload,
  createActiveJourneyService,
  hydrateAskContextFromActiveJourney,
} = require("./services/activeJourney");
const {
  buildAskSnoozerClientTimingEvent,
  emitAskSnoozerQualityTrace,
  getAskSnoozerQualityConfig,
} = require("./services/askSnoozerQualityTrace");
const {
  resolveAskSnoozerPresentationPolicy,
} = require("./services/askSnoozerPresentationPolicy");
const { loadShowroomManifest } = require("./services/showroomManifest");
const {
  resolveAskSnoozerStationResponse,
} = require("./services/askSnoozerStation");
const {
  buildShowroomCommandDecision,
  validateShowroomCommand,
} = require("./services/askSnoozerShowroomCommand");

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
const MODEL_TIMEOUT_MS = Math.max(1000, Number(process.env.MODEL_TIMEOUT_MS || 7000));
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
  const payloadPage =
    typeof payload?.page === "string"
      ? payload.page
      : payload?.page && typeof payload.page === "object"
        ? payload.page.hudPage
        : null;
  const explicitPage =
    normalizeHudPageValue(aiResult?.hud?.page) ||
    normalizeHudPageValue(payloadPage || payload?.hudPage) ||
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
  const voiceSpeech = clampAskSnoozerVoiceReply(
    typeof explicitHud.speech === "string" && explicitHud.speech.trim()
      ? explicitHud.speech
      : scriptPayload?.speech || defaultSpeech || HUD_DEFAULTS.speech
  );

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
    speech: voiceSpeech || null,
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
    speech: voiceSpeech || HUD_DEFAULTS.speech,
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
  "https://staging.d1yszajjlde5t5.amplifyapp.com",
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

  const codeSessionCandidate = String(
    p.snoozeCode || p.accessCode || p.code || p?.context?.snoozeCode || p?.context?.accessCode || ""
  ).replace(/\D+/g, "");
  const codeSessionId =
    p.preferSnoozeCodeSession === true && [4, 6].includes(codeSessionCandidate.length)
      ? `visit_${crypto.createHash("sha256").update(codeSessionCandidate).digest("hex").slice(0, 24)}`
      : null;

  return (
    codeSessionId ||
    p.thread_id ||
    p.sessionId ||
    headerSid ||
    cookieSid ||
    (p.shopperId ? `shopper_${String(p.shopperId).trim()}` : null) ||
    makeSessionId()
  );
}

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

function buildAskSnoozerCanonicalContext(resolved, { source = "recommendation_resolver", assessmentVersion = null } = {}) {
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

  const pods = (Array.isArray(resolved.pods) ? resolved.pods : []).map((pod) => ({
    podId: String(pod?.podId || "").trim() || null,
    name: String(pod?.name || "").trim() || "",
    mattressHandle: String(pod?.mattressHandle || "").trim() || null,
    baseHandle: pod?.baseHandle == null ? null : String(pod.baseHandle || "").trim() || null,
    baseTypeKey: String(pod?.baseTypeKey || "").trim() || "",
    defaultMotionKey: String(pod?.defaultMotionKey || "").trim() || "",
    defaultSize: String(pod?.defaultSize || pod?.displayedIn?.size || "").trim() || null,
    displayedIn: isObject(pod?.displayedIn) ? cloneJsonValue(pod.displayedIn) : {},
    rank: Number.isFinite(Number(pod?.rank)) ? Number(pod.rank) : null,
    score: Number.isFinite(Number(pod?.score)) ? Number(pod.score) : 0,
    reasonKeys: uniqueStrings(Array.isArray(pod?.reasonKeys) ? pod.reasonKeys : []),
  }));
  const snapshotIdentity = JSON.stringify({
    manifestVersion: resolved.manifestVersion || null,
    assessmentVersion: assessmentVersion || null,
    normalizedAssessment,
    topPodIds,
    primaryMattressHandle,
    baseHandle,
  });

  return {
    snapshotVersion: "canonical-recommendation-snapshot-v1",
    snapshotId: `rec_${crypto.createHash("sha256").update(snapshotIdentity).digest("hex").slice(0, 20)}`,
    source: String(source || "recommendation_resolver").trim(),
    assessmentVersion: String(assessmentVersion || "").trim() || null,
    createdAt: new Date().toISOString(),
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
    pods,
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

async function loadActiveJourneyRecord(recordId) {
  const item = await getSessionItem(recordId);
  return item
    ? { ...item, activeJourney: item?.context?.activeJourney || null }
    : null;
}

async function saveActiveJourneyRecord({ recordId, journey, expectedStoredRevision }) {
  const updatedAt = nowIso();
  const ttl = ttlEpochSeconds(30);
  if (expectedStoredRevision === null || expectedStoredRevision === undefined) {
    await ddbDoc.send(new PutCommand({
      TableName: SESSIONS_TABLE,
      Item: {
        sessionId: recordId,
        recordType: "active_journey",
        journeyRevision: Number(journey.revision || 0),
        context: { activeJourney: journey },
        createdAt: updatedAt,
        updatedAt,
        lastActiveAt: updatedAt,
        ttl,
      },
      ConditionExpression: "attribute_not_exists(sessionId)",
    }));
    return;
  }
  await ddbDoc.send(new UpdateCommand({
    TableName: SESSIONS_TABLE,
    Key: { sessionId: recordId },
    UpdateExpression: "SET #context.#activeJourney = :journey, journeyRevision = :nextRevision, updatedAt = :updatedAt, lastActiveAt = :updatedAt, #ttl = :ttl",
    ConditionExpression: "journeyRevision = :expectedRevision",
    ExpressionAttributeNames: { "#context": "context", "#activeJourney": "activeJourney", "#ttl": "ttl" },
    ExpressionAttributeValues: {
      ":journey": journey,
      ":nextRevision": Number(journey.revision || 0),
      ":expectedRevision": Number(expectedStoredRevision || 0),
      ":updatedAt": updatedAt,
      ":ttl": ttl,
    },
  }));
}

const activeJourneyService = createActiveJourneyService({
  load: loadActiveJourneyRecord,
  save: saveActiveJourneyRecord,
});

async function processAskSnoozerAsyncWrites(event = {}) {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  const batchItemFailures = [];

  for (const record of records) {
    const messageId = cleanIdentityValue(record?.messageId) || "unknown";
    const payload = parseAskSnoozerAsyncWriteRecord(record);

    if (!payload) {
      log("ask-snoozer.async-writes.invalid", "discarded", { messageId });
      continue;
    }

    const traceId = cleanIdentityValue(payload?.traceId) || messageId;
    const profilePatch = isObject(payload?.profilePatch) ? payload.profilePatch : {};
    const identity = isObject(payload?.identity) ? payload.identity : {};
    const aliasContext = isObject(payload?.aliasContext) ? payload.aliasContext : {};
    const identityLookup = isObject(payload?.identityLookup) ? payload.identityLookup : {};
    const policyContext = isObject(payload?.policyContext) ? payload.policyContext : {};

    try {
      const previousProfileResult = await safeGetCustomerProfile(identityLookup, {
        traceId,
        route: "/ask-snoozer:async-writes",
      });
      const previousProfile = previousProfileResult?.profile || null;

      const profileResult = await safeUpsertCustomerProfile(profilePatch, {
        traceId,
        route: "/ask-snoozer:async-writes",
      });
      logProfileRouteOutcome("ask_async", profileResult, {
        traceId,
        route: "/ask-snoozer:async-writes",
        shopperId: profilePatch?.shopperId || null,
        sessionId: profilePatch?.sessionId || profilePatch?.threadId || null,
      });
      if (profileResult?.reason === "CUSTOMER_PROFILE_UPSERT_FAILED") {
        throw new Error(profileResult.reason);
      }

      const aliasResult = await safeUpsertIdentityAliases(identity, aliasContext, {
        traceId,
        route: "/ask-snoozer:async-writes",
      });
      const aliasFailures = (Array.isArray(aliasResult) ? aliasResult : []).filter(
        (result) => result?.reason === "CUSTOMER_PROFILE_UPSERT_FAILED"
      );
      if (aliasFailures.length) {
        throw new Error("IDENTITY_ALIAS_UPSERT_FAILED");
      }

      const zohoResult = await maybeSyncProfileToZohoForInteraction({
        channel: "ask_async",
        traceId,
        route: "/ask-snoozer:async-writes",
        previousProfile,
        nextPatch: profilePatch,
        policyContext,
      });
      if (zohoResult?.reason === "ZOHO_SYNC_FAILED") {
        throw new Error(zohoResult.reason);
      }

      log("ask-snoozer.async-writes", "completed", {
        traceId,
        messageId,
        shopperId: profilePatch?.shopperId || null,
        sessionId: profilePatch?.sessionId || profilePatch?.threadId || null,
        profileWritten: Boolean(profileResult?.ok && !profileResult?.skipped),
        aliasesWritten: (Array.isArray(aliasResult) ? aliasResult : []).some(
          (result) => result?.ok && !result?.skipped
        ),
        zohoSynced: Boolean(zohoResult?.ok && !zohoResult?.skipped),
      });
    } catch (error) {
      log("ask-snoozer.async-writes", "failed", {
        traceId,
        messageId,
        reason: error?.message || "ASYNC_WRITE_FAILED",
      });
      batchItemFailures.push({ itemIdentifier: messageId });
    }
  }

  return { batchItemFailures };
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
  const sessionIds = uniqueStrings([
    input?.sessionId,
    identity?.sessionId,
    input?.threadId,
    identity?.threadId,
    ...(Array.isArray(input?.sessionIds) ? input.sessionIds : []),
  ]);

  return {
    profileId: cleanIdentityValue(identity?.profileId) || undefined,
    shopperId: cleanIdentityValue(identity?.shopperId) || undefined,
    snoozeCode: cleanIdentityValue(identity?.snoozeCode) || undefined,
    accessCode: cleanIdentityValue(identity?.accessCode) || undefined,
    sessionId:
      cleanIdentityValue(input?.sessionId || identity?.sessionId) || undefined,
    threadId:
      cleanIdentityValue(input?.threadId || identity?.threadId) || undefined,
    sessionIds: sessionIds.length ? sessionIds : undefined,
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
  return buildAskSnoozerCanonicalContext(resolved, {
    source,
    assessmentVersion: safePayload.assessmentVersion || assessmentSource?.assessmentVersion || assessmentSource?.version || null,
  });
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
    protectedTruthRequired: Boolean(
      safeOverrides.protectedTruthRequired ?? safeDecision.protectedTruthRequired
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

function buildAskSnoozerAtomicCompatibilityAnswer({ reason = "", context = {} } = {}) {
  if (reason === "session_support") {
    return {
      reply: "If you need order or account support, use the store contact path shown on the site so the team can verify the details. If you want product guidance, I can help here or point you to a Snooze Session.",
      answer_grounded: false,
      answer_source_type: "deterministic_support",
      answer_source_key: "contact_support",
      answer_facts_count: 0,
      matched_preview: "",
      extracted_facts: [],
      answer_strategy: "safe_fallback",
      reason: "support_fallback",
      source_of_truth: "deterministic_support",
      answer_type: "support_guidance",
    };
  }

  if (reason !== "session_guidance") return null;
  const sessionPrep = isObject(context?.sessionPrep) ? context.sessionPrep : {};
  const canonical = isObject(context?.canonicalRecommendation) ? context.canonicalRecommendation : {};
  const startingPod = cleanShopperText(sessionPrep.recommendedStartingPod || canonical.topPodId || "");
  const startReply = cleanShopperText(sessionPrep.showroomStartingPoint) ||
    (startingPod ? "Start with SnoozePod " + startingPod + " first." : "");
  if (!startReply) return null;
  const details = [startReply, cleanShopperText(sessionPrep.questionsToAsk?.[0] || sessionPrep.comfortSummary)]
    .filter(Boolean);
  return {
    reply: details.join(" "),
    answer_grounded: true,
    answer_source_type: "session_prep",
    answer_source_key: startingPod || "session_prep",
    answer_facts_count: details.length,
    matched_preview: details.join(" ").slice(0, 160),
    extracted_facts: details,
    answer_strategy: "session_prep",
    reason: "",
    source_of_truth: "session_prep",
    answer_type: "session_guidance",
  };
}

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
function getAskSnoozerRouteDeps() {
  return {
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
    safeGetCustomerProfile,
    attachStoredProfileContext,
    customerProfileService,
    buildIdentityProfilePatch,
    safeUpsertCustomerProfile,
    logProfileRouteOutcome,
    safeUpsertIdentityAliases,
    maybeSyncProfileToZohoForInteraction,
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
    planTrustedAdvisorTurnWithModel: async (args) => {
      const service = getAskSnoozerModelCoreSvc();
      if (!service || typeof service.planTrustedAdvisorTurnWithModel !== "function") {
        const error = new Error("Trusted-advisor planner is unavailable.");
        error.code = "E_ADVISOR_PLANNER_UNAVAILABLE";
        throw error;
      }
      return service.planTrustedAdvisorTurnWithModel(args);
    },
    planAskSnoozerTurn,
    resolveAskSnoozerAdvisorTurn,
    composeTrustedAdvisorResponse: async (args) => {
      const service = getAskSnoozerModelCoreSvc();
      if (!service || typeof service.composeTrustedAdvisorResponse !== "function") {
        const error = new Error("Trusted-advisor composer is unavailable.");
        error.code = "E_ADVISOR_COMPOSER_UNAVAILABLE";
        throw error;
      }
      return service.composeTrustedAdvisorResponse(args);
    },
    loadTrustedAdvisorFactPack: async (args) => {
      const service = getAskSnoozerModelCoreSvc();
      if (!service || typeof service.loadTrustedAdvisorFactPack !== "function") return null;
      return service.loadTrustedAdvisorFactPack(args);
    },
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
  };
}

async function runSharedAskSnoozer({
  event,
  traceId,
  body = {},
  query = "",
  path: pagePath = "/",
  pageType = "unknown",
  surface = "shopify_header",
  sessionId = "",
} = {}) {
  const incomingContext = isObject(body?.context) ? body.context : {};
  const sharedPayload = {
    message: String(query || body?.message || "").trim(),
    source: surface,
    sessionId,
    thread_id: sessionId,
    shopperId: body?.shopperId || body?.shopper_id || incomingContext?.shopperId,
    snoozeCode: body?.snoozeCode || body?.code || incomingContext?.snoozeCode,
    accessCode: body?.accessCode || incomingContext?.accessCode,
    sourceShopperId: body?.sourceShopperId || incomingContext?.sourceShopperId,
    visitorId: body?.visitorId || incomingContext?.visitorId,
    context: {
      ...incomingContext,
      path: pagePath,
      page_type: pageType,
      pageType,
      surface,
      currentProductHandle:
        body?.currentProductHandle || incomingContext?.currentProductHandle || "",
    },
  };
  const headers = { ...(event?.headers || {}) };
  Object.keys(headers).forEach((key) => {
    if (String(key).toLowerCase() === "x-hud") delete headers[key];
  });
  const sharedEvent = {
    ...event,
    httpMethod: "POST",
    headers,
    body: JSON.stringify(sharedPayload),
  };
  const response = await askSnoozerRoutes.handleAskSnoozerRoutes({
    event: sharedEvent,
    method: "POST",
    routePath: "/ask-snoozer",
    traceId,
    deps: getAskSnoozerRouteDeps(),
  });

  if (!response || Number(response.statusCode || 500) >= 500) {
    throw new Error("SHARED_ASK_REQUEST_FAILED");
  }

  try {
    return typeof response.body === "string" ? JSON.parse(response.body) : response.body;
  } catch {
    throw new Error("SHARED_ASK_INVALID_RESPONSE");
  }
}

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
      elapsedMs,
      rawJsonResponse,
      runSharedAskSnoozer,
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

  const activeJourneyRouteResponse = await activeJourneyRoutes.handleActiveJourneyRoutes({
    event,
    method,
    routePath,
    traceId,
    deps: {
      response,
      safeJsonBody,
      cleanIdentityValue,
      deriveEffectiveThreadId,
      safeResolveSnoozeIdentity,
      safeGetCustomerProfile,
      resolveCanonicalRecommendationContext,
      activeJourneyService,
      loadShowroomManifest,
      log,
    },
  });
  if (activeJourneyRouteResponse) return activeJourneyRouteResponse;

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
      activeJourneyService,
      loadShowroomManifest,
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
      activeJourneyService,
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
    routePath.startsWith("/rewards") ||
    routePath === "/webhooks/shopify/rewards"
  ) {
    const rewardsResponse = await handleRewardsRoutes(event, {
      getAssessmentResult,
    });
    if (rewardsResponse) {
      return {
        ...rewardsResponse,
        headers: baseHeaders(event, rewardsResponse.headers || {}),
      };
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Ask Snoozer (SCO-aware + deterministic-first)
  const askSnoozerRouteResponse = await askSnoozerRoutes.handleAskSnoozerRoutes({
    event,
    method,
    routePath,
    traceId,
    deps: getAskSnoozerRouteDeps(),
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
    if (isAskSnoozerAsyncWriteEvent(event)) {
      return await processAskSnoozerAsyncWrites(event);
    }

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
