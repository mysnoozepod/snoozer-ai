const {
  earnPoints,
  getBalance,
  getCatalog,
  redeemReward,
} = require("../services/rewards");
const {
  buildSuccessResponse,
  buildErrorResponse,
} = require("../services/responseBuilder");

let snoozeIdentity = null;
try {
  snoozeIdentity = require("../services/snoozeIdentity");
} catch (e) {
  console.log("⚠️ Snooze identity service not loaded for rewards:", e.message);
}

let customerProfileService = null;
try {
  customerProfileService = require("../services/customerProfile");
} catch (e) {
  console.log("⚠️ customerProfile service not loaded for rewards:", e.message);
}

let syncCustomerProfileToZoho = null;
try {
  ({ syncCustomerProfileToZoho } = require("../services/customerProfileZohoSync"));
} catch (e) {
  console.log("⚠️ customerProfileZohoSync service not loaded for rewards:", e.message);
}

// Optional Shopify price rules
let shopify;
try {
  shopify = require("../services/shopify");
} catch {
  shopify = null;
}

// Optional Zoho CRM integration for rewards → Contacts
let upsertContactByShopperId = null;
try {
  const zohoSvc = require("../services/zoho");
  if (zohoSvc && typeof zohoSvc.upsertContactByShopperId === "function") {
    upsertContactByShopperId = zohoSvc.upsertContactByShopperId;
  } else {
    console.log("⚠️ Zoho upsertContactByShopperId not available in services/zoho");
  }
} catch (e) {
  console.log("⚠️ Zoho service not loaded for rewards CRM sync:", e.message);
}

// Optional Zoho Rewards field API names (Contacts → API names)
const ZOHO_REWARDS_BALANCE_FIELD =
  process.env.ZOHO_REWARDS_BALANCE_FIELD || null;
const ZOHO_REWARDS_TIER_FIELD = process.env.ZOHO_REWARDS_TIER_FIELD || null;
const ZOHO_REWARDS_LAST_REASON_FIELD =
  process.env.ZOHO_REWARDS_LAST_REASON_FIELD || null;

// ─────────────────────────────────────────────
// Levels (mirror frontend)
// ─────────────────────────────────────────────
const LEVELS = [
  { min: 0, title: "Dream Seeker" },
  { min: 200, title: "Snooze Explorer" },
  { min: 500, title: "Sleep Specialist" },
  { min: 1000, title: "Master of Rest" },
];

function getLevel(points = 0) {
  const lvl = [...LEVELS].reverse().find((l) => points >= l.min);
  return lvl ? lvl.title : LEVELS[0].title;
}

// ─────────────────────────────────────────────
// Safe JSON body parser
// ─────────────────────────────────────────────
function parseBody(event) {
  try {
    if (!event.body) return {};
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body;
    return JSON.parse(raw);
  } catch (err) {
    console.error("⚠️ Body parse failed:", err.message);
    return {};
  }
}

// ─────────────────────────────────────────────
// Trace + header helpers
// ─────────────────────────────────────────────
function getHeader(headers = {}, name = "") {
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return undefined;
}

function getTraceId(event = {}) {
  return (
    getHeader(event.headers, "x-trace-id") ||
    `trc_${Math.random().toString(36).slice(2, 10)}`
  );
}

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

async function getProfileById(profileId) {
  if (!customerProfileService || typeof customerProfileService.getCustomerProfile !== "function") {
    return null;
  }

  const result = await customerProfileService.getCustomerProfile({ profileId });
  return result?.profile || null;
}

function buildRewardsIdentityContext(identity = {}) {
  const shopperId = cleanString(identity?.shopperId);
  const snoozeCode = cleanString(identity?.snoozeCode || shopperId);
  return {
    shopperId: shopperId || null,
    snoozeCode: snoozeCode || null,
    accessCode: snoozeCode || null,
    profileId:
      cleanString(identity?.profileId) ||
      (shopperId ? `shopper#${shopperId}` : null),
    identityType: cleanString(identity?.identityType) || null,
    identitySource: cleanString(identity?.identitySource) || null,
    sourceShopperId: cleanString(identity?.sourceShopperId) || null,
    aliases: Array.isArray(identity?.aliases) ? identity.aliases : [],
    isNewCode: Boolean(identity?.isNewCode),
  };
}

async function resolveRewardsIdentity(input = {}, options = {}) {
  const fallbackShopperId = cleanString(
    input?.snoozeCode || input?.accessCode || input?.shopperId || input?.shopper_id
  );

  if (!snoozeIdentity || typeof snoozeIdentity.resolveCanonicalIdentity !== "function") {
    return buildRewardsIdentityContext({
      shopperId: fallbackShopperId || null,
      snoozeCode: fallbackShopperId || null,
      accessCode: fallbackShopperId || null,
      profileId: fallbackShopperId ? `shopper#${fallbackShopperId}` : null,
      identityType: fallbackShopperId ? "snooze_code" : "anonymous",
    });
  }

  const baseIdentity = await snoozeIdentity.resolveCanonicalIdentity(input, {
    getProfileById,
  });

  let finalIdentity = baseIdentity;
  if (
    options.allowIssue === true &&
    typeof snoozeIdentity.issueSnoozeCode === "function" &&
    snoozeIdentity.shouldIssueSnoozeCode({
      ...input,
      reason: options.reason,
      identity: baseIdentity,
    })
  ) {
    finalIdentity = await snoozeIdentity.issueSnoozeCode(
      {
        ...input,
        reason: options.reason,
        identity: baseIdentity,
      },
      { getProfileById }
    );
  }

  return buildRewardsIdentityContext(finalIdentity);
}

async function persistRewardsIdentity(identity = {}, options = {}) {
  const shopperId = cleanString(identity?.shopperId);
  if (!shopperId) return;
  if (!customerProfileService || typeof customerProfileService.upsertCustomerProfile !== "function") return;

  const patchInput = {
    profileId: cleanString(identity?.profileId) || `shopper#${shopperId}`,
    shopperId,
    snoozeCode: cleanString(identity?.snoozeCode) || shopperId,
    accessCode: cleanString(identity?.accessCode) || shopperId,
    identityType: cleanString(identity?.identityType) || "snooze_code",
    identitySource: cleanString(identity?.identitySource) || "rewards",
    sourceSurface: cleanString(options?.sourceSurface) || "rewards",
    lastIntent: cleanString(options?.lastIntent) || "rewards_activity",
    leadStage: cleanString(options?.leadStage) || undefined,
    sourceShopperId: cleanString(identity?.sourceShopperId) || undefined,
    identityAliases: Array.isArray(identity?.aliases) ? identity.aliases : [],
    previousShopperIds: cleanString(identity?.sourceShopperId)
      ? [identity.sourceShopperId]
      : [],
  };

  const patch = customerProfileService.buildCustomerProfilePatch(patchInput);
  await customerProfileService.upsertCustomerProfile(patch);

  if (
    snoozeIdentity &&
    typeof snoozeIdentity.buildAliasProfilePatches === "function"
  ) {
    const aliasPatches = snoozeIdentity.buildAliasProfilePatches(identity, {
      sourceSurface: patch.sourceSurface,
      lastIntent: patch.lastIntent,
      leadStage: patch.leadStage,
      sourceShopperId: patch.sourceShopperId,
    });

    for (const aliasPatch of aliasPatches) {
      await customerProfileService.upsertCustomerProfile(aliasPatch);
    }
  }

  if (typeof syncCustomerProfileToZoho === "function") {
    try {
      await syncCustomerProfileToZoho(patch);
    } catch (error) {
      console.error("⚠️ rewards.identity.zoho.error:", error.message, {
        shopperId,
      });
    }
  }
}

// ─────────────────────────────────────────────
// Consistent HTTP response (CORS will be
// finalized in index.js lambdaHandler)
// ─────────────────────────────────────────────
function http(statusCode, bodyObj = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // index.js will overwrite / augment with final CORS headers
    },
    body: JSON.stringify(bodyObj),
  };
}

// ─────────────────────────────────────────────
// Best-effort: sync rewards → Zoho Contact
// (keyed by Shopper ID)
// ─────────────────────────────────────────────
async function syncRewardsToZoho({
  shopperId,
  balance,
  tier,
  lastReason = null,
}) {
  if (!shopperId) return;
  if (!upsertContactByShopperId) return;

  const fields = {};

  if (
    ZOHO_REWARDS_BALANCE_FIELD &&
    typeof balance === "number" &&
    Number.isFinite(balance)
  ) {
    fields[ZOHO_REWARDS_BALANCE_FIELD] = balance;
  }

  if (ZOHO_REWARDS_TIER_FIELD && tier) {
    fields[ZOHO_REWARDS_TIER_FIELD] = tier;
  }

  if (ZOHO_REWARDS_LAST_REASON_FIELD && lastReason) {
    fields[ZOHO_REWARDS_LAST_REASON_FIELD] = lastReason;
  }

  if (!Object.keys(fields).length) return;

  try {
    const resp = await upsertContactByShopperId(shopperId, fields);
    console.log("✅ rewards.zoho.upsert", {
      shopperId,
      fields,
      code: resp?.code,
      contactId: resp?.details?.id,
    });
  } catch (err) {
    console.error("⚠️ rewards.zoho.error:", err.message, {
      shopperId,
    });
  }
}

// ─────────────────────────────────────────────
// GET /rewards/balance/{shopperId}
// ─────────────────────────────────────────────
async function getRewardsBalance(event = {}) {
  const t0 = Date.now();
  const requestId = getTraceId(event);

  const requestedShopperId =
    event.pathParameters?.shopperId || event.path?.split("/").pop() || null;
  const identity = await resolveRewardsIdentity({ shopperId: requestedShopperId });
  const shopperId = identity?.shopperId || null;

  if (!shopperId) {
    const env = buildErrorResponse({
      requestId,
      latencyMs: Date.now() - t0,
      context: { shopperId: null },
      code: "E_BAD_REQUEST",
      message: "shopperId is required",
    });
    return http(400, env);
  }

  try {
    const bal = await getBalance(shopperId);
    const tier = getLevel(bal.balance);

    const env = buildSuccessResponse({
      requestId,
      latencyMs: Date.now() - t0,
      model: null,
      text: "",
      rawMessage: null,
      tokens: null,
      products: [],
      context: {
        shopperId,
        identity,
        sessionId: null,
        zone: null,
        assessment: null,
        rewards: {
          balance: bal.balance,
          tier,
          updatedAt: bal.updatedAt,
        },
      },
      actions: [],
      s3Prompts: [],
    });

    return http(200, env);
  } catch (err) {
    console.error("❌ getRewardsBalance error:", err.message);
    const env = buildErrorResponse({
      requestId,
      latencyMs: Date.now() - t0,
      context: { shopperId },
      code: "REWARDS_BALANCE_FAILED",
      message: "Failed to fetch balance",
      details: err.message,
    });
    return http(500, env);
  }
}

// ─────────────────────────────────────────────
// POST /rewards/earn
// Body: { shopperId, points, reason }
// ─────────────────────────────────────────────
async function earnRewards(event = {}) {
  const t0 = Date.now();
  const requestId = getTraceId(event);
  const body = parseBody(event);

  const reason = body.reason || "Milestone";
  const identity = await resolveRewardsIdentity(body, {
    allowIssue: cleanString(reason).toLowerCase() === "rewards_signup",
    reason: cleanString(reason).toLowerCase(),
  });
  const shopperId = identity?.shopperId || null;
  const points = Number(body.points);

  if (!shopperId || !Number.isFinite(points)) {
    const env = buildErrorResponse({
      requestId,
      latencyMs: Date.now() - t0,
      context: { shopperId: shopperId || null },
      code: "E_BAD_REQUEST",
      message: "shopperId and numeric points are required",
    });
    return http(400, env);
  }

  console.log("🎯 earnRewards invoked →", JSON.stringify(body));

  try {
    const result = await earnPoints({ shopperId, points, reason });

    const tier = getLevel(result.balance);
    await persistRewardsIdentity(identity, {
      sourceSurface: "rewards",
      lastIntent: cleanString(reason).toLowerCase() === "rewards_signup" ? "rewards_signup" : "rewards_earn",
    });

    // Best-effort CRM sync; do NOT block rewards on Zoho
    await syncRewardsToZoho({
      shopperId,
      balance: result.balance,
      tier,
      lastReason: reason,
    });

    const env = buildSuccessResponse({
      requestId,
      latencyMs: Date.now() - t0,
      model: null,
      text: "",
      rawMessage: null,
      tokens: null,
      products: [],
      context: {
        shopperId,
        identity,
        sessionId: null,
        zone: null,
        assessment: null,
        rewards: {
          balance: result.balance,
          tier,
          delta: result.delta,
          updatedAt: result.updatedAt,
        },
      },
      actions: [],
      s3Prompts: [],
    });

    return http(200, env);
  } catch (err) {
    console.error("❌ earnRewards error:", err.message);

    const code =
      err?.code === "INSUFFICIENT_POINTS"
        ? "INSUFFICIENT_POINTS"
        : "REWARDS_EARN_FAILED";
    const statusCode = err?.code === "INSUFFICIENT_POINTS" ? 200 : 500;

    const env = buildErrorResponse({
      requestId,
      latencyMs: Date.now() - t0,
      context: { shopperId },
      code,
      message:
        err?.code === "INSUFFICIENT_POINTS"
          ? "Insufficient points to debit"
          : "Failed to update reward balance",
      details: err.message,
    });

    return http(statusCode, env);
  }
}

// ─────────────────────────────────────────────
// GET /rewards/catalog
// ─────────────────────────────────────────────
async function getRewardsCatalog(event = {}) {
  const t0 = Date.now();
  const requestId = getTraceId(event);

  try {
    const catalog = await getCatalog();

    const env = buildSuccessResponse({
      requestId,
      latencyMs: Date.now() - t0,
      model: null,
      text: "",
      rawMessage: null,
      tokens: null,
      products: [],
      context: {
        shopperId: null,
        sessionId: null,
        zone: null,
        assessment: null,
        rewards: {
          catalog: catalog.items,
          currency: catalog.currency,
        },
      },
      actions: [],
      s3Prompts: [],
    });

    return http(200, env);
  } catch (err) {
    console.error("❌ getRewardsCatalog error:", err.message);
    const env = buildErrorResponse({
      requestId,
      latencyMs: Date.now() - t0,
      context: {},
      code: "REWARDS_CATALOG_FAILED",
      message: "Failed to fetch catalog",
      details: err.message,
    });
    return http(500, env);
  }
}

// ─────────────────────────────────────────────
// POST /rewards/redeem
// Body: { shopperId, rewardId, idempotencyKey? }
// ─────────────────────────────────────────────
async function redeemRewards(event = {}) {
  const t0 = Date.now();
  const requestId = getTraceId(event);
  const body = parseBody(event);

  const identity = await resolveRewardsIdentity(body);
  const shopperId = identity?.shopperId || null;
  const rewardId = body.rewardId || body.reward_id || null;
  const idempotencyKey = body.idempotencyKey || body.idem || null;

  if (!shopperId || !rewardId) {
    const env = buildErrorResponse({
      requestId,
      latencyMs: Date.now() - t0,
      context: { shopperId: shopperId || null },
      code: "E_BAD_REQUEST",
      message: "shopperId and rewardId required",
    });
    return http(400, env);
  }

  try {
    const res = await redeemReward({ shopperId, rewardId, idempotencyKey });
    const tier = getLevel(res.balance);
    await persistRewardsIdentity(identity, {
      sourceSurface: "rewards",
      lastIntent: "rewards_redeem",
    });

    // Best-effort CRM sync; do NOT block redemption on Zoho
    await syncRewardsToZoho({
      shopperId,
      balance: res.balance,
      tier,
      lastReason: `Redeemed reward ${rewardId}`,
    });

    const env = buildSuccessResponse({
      requestId,
      latencyMs: Date.now() - t0,
      model: null,
      text: "",
      rawMessage: null,
      tokens: null,
      products: [],
      context: {
        shopperId,
        identity,
        sessionId: null,
        zone: null,
        assessment: null,
        rewards: {
          balance: res.balance,
          tier,
          lastRedemption: {
            rewardId: res.rewardId,
            issued: res.issued,
            idem: res.idem || null,
          },
        },
      },
      actions: [],
      s3Prompts: [],
    });

    return http(200, env);
  } catch (err) {
    console.error("❌ redeemRewards error:", err.message);

    const code = err?.code || "REWARDS_REDEEM_FAILED";
    const statusCode =
      code === "INSUFFICIENT_POINTS" || code === "UNKNOWN_REWARD" ? 200 : 500;

    const env = buildErrorResponse({
      requestId,
      latencyMs: Date.now() - t0,
      context: { shopperId },
      code,
      message:
        code === "INSUFFICIENT_POINTS"
          ? "Insufficient points to redeem this reward"
          : err.message || "Failed to redeem reward",
      details: err.message,
    });

    return http(statusCode, env);
  }
}

// ─────────────────────────────────────────────
// DEBUG: GET /rewards/debug/pricerules
// ─────────────────────────────────────────────
async function debugListPriceRules(event = {}) {
  const t0 = Date.now();
  const requestId = getTraceId(event);

  if (!shopify || typeof shopify.listPriceRules !== "function") {
    const env = buildErrorResponse({
      requestId,
      latencyMs: Date.now() - t0,
      context: {},
      code: "NOT_CONFIGURED",
      message: "Price rule listing not configured in this environment",
    });
    return http(501, env);
  }

  try {
    const rules = await shopify.listPriceRules();

    const env = buildSuccessResponse({
      requestId,
      latencyMs: Date.now() - t0,
      model: null,
      text: "Debug price rules listing",
      rawMessage: null,
      tokens: null,
      products: [],
      context: {
        shopperId: null,
        rewards: {
          priceRules: rules,
        },
      },
      actions: [],
      s3Prompts: [],
    });

    return http(200, env);
  } catch (err) {
    console.error("❌ debugListPriceRules error:", err.message);
    const env = buildErrorResponse({
      requestId,
      latencyMs: Date.now() - t0,
      context: {},
      code: "PRICE_RULES_FAILED",
      message: "Failed to fetch price rules",
      details: err.message,
    });
    return http(500, env);
  }
}

module.exports = {
  getRewardsBalance,
  earnRewards,
  getRewardsCatalog,
  redeemRewards,
  debugListPriceRules,
};

