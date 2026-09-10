const crypto = require("crypto");

const VISIT_LIFECYCLE_VERSION = "1.0.0";
const DEFAULT_ACTIVE_VISIT_TTL_MINUTES = 240;
const MIN_ACTIVE_VISIT_TTL_MINUTES = 5;
const MAX_ACTIVE_VISIT_TTL_MINUTES = 1440;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function parseTimestamp(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function getVisitLifecyclePolicy(env = process.env) {
  const configured = Number(env.ASK_SNOOZER_ACTIVE_VISIT_TTL_MINUTES);
  const ttlMinutes = Number.isFinite(configured)
    ? Math.max(MIN_ACTIVE_VISIT_TTL_MINUTES, Math.min(MAX_ACTIVE_VISIT_TTL_MINUTES, Math.round(configured)))
    : DEFAULT_ACTIVE_VISIT_TTL_MINUTES;
  return {
    version: VISIT_LIFECYCLE_VERSION,
    ttlMinutes,
    durableContextKeys: [
      "shopperId",
      "profileId",
      "snoozeCode",
      "accessCode",
      "customer",
      "shopperProfile",
      "assessment",
      "canonicalRecommendation",
      "recommendedProductHandles",
      "recommendationHints",
      "rewards",
    ],
    activeContextKeys: [
      "askSnoozerWorkingMemory",
      "recentConversation",
      "candidates",
      "favorites",
      "decisionStatus",
      "confidenceScore",
      "cartState",
      "checkoutUrl",
      "objections",
    ],
  };
}

function buildVisitId(sessionId, startedAt, rotationIndex) {
  const digest = crypto
    .createHash("sha256")
    .update(`${clean(sessionId)}|${clean(startedAt)}|${Number(rotationIndex || 0)}`)
    .digest("hex")
    .slice(0, 20);
  return `active_${digest}`;
}

function resetActiveVisitState(context = {}) {
  const next = { ...(isObject(context) ? context : {}) };
  delete next.askSnoozerWorkingMemory;
  delete next.recentConversation;
  next.candidates = [];
  next.favorites = [];
  next.decisionStatus = "exploring";
  next.confidenceScore = 0;
  next.cartState = { items: [], lastViewedHandle: "", lastAddedHandle: "" };
  next.checkoutUrl = "";
  next.objections = [];
  if (isObject(next.ids)) {
    next.ids = { ...next.ids, cartId: "", checkoutId: "" };
  }
  return next;
}

function resolveAskSnoozerVisitLifecycle({
  context = {},
  storedContext = null,
  sessionId = "",
  shopperId = "",
  now = new Date(),
  forceNewVisit = false,
  policy = getVisitLifecyclePolicy(),
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("A valid visit-lifecycle timestamp is required.");
  const nowIso = new Date(nowMs).toISOString();
  const ttlMs = policy.ttlMinutes * 60 * 1000;
  const stored = isObject(storedContext) ? storedContext : {};
  const previous = isObject(stored.visitLifecycle)
    ? stored.visitLifecycle
    : isObject(context.visitLifecycle)
      ? context.visitLifecycle
      : null;
  const previousLastActiveMs = parseTimestamp(
    previous?.lastActiveAt || stored?.session?.lastActiveAt || stored?.session?.updatedAt
  );
  const visitAgeMs = previousLastActiveMs == null ? 0 : Math.max(0, nowMs - previousLastActiveMs);
  const expired = Boolean(previous && previousLastActiveMs != null && visitAgeMs >= ttlMs);
  const rotated = Boolean(previous && (forceNewVisit || expired));
  const rotationReason = forceNewVisit
    ? "explicit_new_journey"
    : expired
      ? "active_visit_expired"
      : previous
        ? "active_visit_reused"
        : "active_visit_initialized";
  const rotationIndex = Number(previous?.rotationIndex || 0) + (rotated ? 1 : 0);
  const startedAt = rotated || !previous ? nowIso : clean(previous.startedAt) || nowIso;
  const visitId = rotated || !previous
    ? buildVisitId(sessionId, startedAt, rotationIndex)
    : clean(previous.visitId) || buildVisitId(sessionId, startedAt, rotationIndex);
  let nextContext = rotated ? resetActiveVisitState(context) : { ...(isObject(context) ? context : {}) };
  nextContext.visitLifecycle = {
    version: VISIT_LIFECYCLE_VERSION,
    visitId,
    shopperResolved: Boolean(clean(shopperId) || clean(context?.shopperId)),
    startedAt,
    lastActiveAt: nowIso,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    ttlMinutes: policy.ttlMinutes,
    rotationIndex,
    lastResolution: rotated ? "rotated" : previous ? "reused" : "initialized",
    rotationReason,
    previousVisitId: rotated ? clean(previous?.visitId) || null : null,
  };
  return {
    context: nextContext,
    metadata: {
      version: VISIT_LIFECYCLE_VERSION,
      shopperResolved: nextContext.visitLifecycle.shopperResolved,
      visitId,
      previousVisitId: nextContext.visitLifecycle.previousVisitId,
      reused: Boolean(previous && !rotated),
      rotated,
      visitAgeMs,
      visitAgeMinutes: Math.round((visitAgeMs / 60000) * 10) / 10,
      rotationReason,
      ttlMinutes: policy.ttlMinutes,
    },
  };
}

module.exports = {
  DEFAULT_ACTIVE_VISIT_TTL_MINUTES,
  VISIT_LIFECYCLE_VERSION,
  getVisitLifecyclePolicy,
  resetActiveVisitState,
  resolveAskSnoozerVisitLifecycle,
};
