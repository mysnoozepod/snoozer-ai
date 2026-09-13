const crypto = require("crypto");
const { resolveAdaptiveSessionRecommendation } = require("./askSnoozerWorkingMemory");

const ACTIVE_JOURNEY_VERSION = "1.0.0";
const ACTIVE_JOURNEY_TTL_MINUTES = 240;
const VALID_SURFACES = new Set([
  "welcome", "assessment", "results", "pod", "rest_test", "ask_snoozer",
  "cart", "checkout", "sleep_essentials", "snoozepod", "unknown",
]);
const CLIENT_EVENT_TYPES = new Set([
  "journey_surface_changed", "rest_test_feedback", "product_selected",
  "product_rejected", "configuration_changed", "cart_linked", "checkout_handoff",
  "preference_retained", "desired_direction_changed",
]);
const TRUSTED_EVENT_TYPES = new Set([
  ...CLIENT_EVENT_TYPES, "assessment_completed", "ask_state_committed",
  "journey_completed",
]);
const PROTECTED_INPUT_KEYS = new Set([
  "price", "prices", "total", "subtotal", "amount", "variantId", "variantIds",
  "merchandiseId", "merchandiseIds", "availability", "compatible", "compatibility",
  "canonicalRecommendation", "activeQuote", "quote",
  "checkoutUrl",
]);

function clean(value) { return String(value == null ? "" : value).trim(); }
function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function iso(now = new Date()) { return (now instanceof Date ? now : new Date(now)).toISOString(); }
function normalizeHandle(value) { return clean(value).toLowerCase(); }
function unique(values = []) { return Array.from(new Set(values.map(clean).filter(Boolean))); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function hash(value) { return crypto.createHash("sha256").update(clean(value)).digest("hex"); }

function identitySeed(identity = {}) {
  return clean(identity.profileId || identity.shopperId || identity.snoozeCode || identity.accessCode || identity.sessionId);
}

function deriveActiveJourneyRecordId(identity = {}) {
  const seed = identitySeed(identity);
  if (!seed) {
    const error = new Error("Resolved shopper identity is required for an Active Journey.");
    error.code = "ACTIVE_JOURNEY_IDENTITY_REQUIRED";
    throw error;
  }
  return `active_journey_${hash(seed).slice(0, 24)}`;
}

function buildJourneyId(recordId, startedAt, rotationIndex = 0) {
  return `journey_${hash(`${recordId}|${startedAt}|${rotationIndex}`).slice(0, 20)}`;
}

function normalizeSurface(value) {
  const surface = clean(value).toLowerCase().replace(/[\s-]+/g, "_");
  return VALID_SURFACES.has(surface) ? surface : "unknown";
}

function activeRejectedHandles(journey = {}) {
  return new Set((Array.isArray(journey.rejectedProducts) ? journey.rejectedProducts : [])
    .filter((item) => item?.status !== "reconsidered")
    .map((item) => normalizeHandle(item?.handle))
    .filter(Boolean));
}

function makeActiveJourney({ recordId, identity = {}, canonicalRecommendation = null, surface = "unknown", now = new Date(), rotationIndex = 0 } = {}) {
  const timestamp = iso(now);
  const ttlMs = ACTIVE_JOURNEY_TTL_MINUTES * 60 * 1000;
  const safeSurface = normalizeSurface(surface);
  return {
    version: ACTIVE_JOURNEY_VERSION,
    revision: 0,
    journeyId: buildJourneyId(recordId, timestamp, rotationIndex),
    identityRef: hash(identitySeed(identity)).slice(0, 24),
    visitStatus: "active",
    rotationIndex,
    startedAt: timestamp,
    lastInteractionAt: timestamp,
    expiresAt: new Date(new Date(timestamp).getTime() + ttlMs).toISOString(),
    currentSurface: safeSurface,
    previousSurface: null,
    journeyStage: safeSurface === "welcome" ? "welcome" : "exploring",
    currentGoal: null,
    canonicalRecommendation: clone(canonicalRecommendation),
    sessionRecommendation: null,
    rejectedProducts: [],
    productFeedback: {},
    retainedPreferences: {},
    desiredDirection: {},
    activeConfiguration: {},
    activeQuote: null,
    comparisonSet: [],
    restTestState: {},
    cartReference: {},
    lastTransition: null,
    fieldRevisions: {},
  };
}

function hasExpired(journey, now = new Date()) {
  const expires = Date.parse(clean(journey?.expiresAt));
  return !Number.isFinite(expires) || expires <= new Date(now).getTime() || journey?.visitStatus === "expired";
}

function assertNoProtectedInput(payload = {}, trusted = false) {
  if (trusted) return;
  const stack = [payload];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const value of current) if (isObject(value) || Array.isArray(value)) stack.push(value);
      continue;
    }
    if (!isObject(current)) continue;
    for (const [key, value] of Object.entries(current)) {
      if (PROTECTED_INPUT_KEYS.has(key)) {
        const error = new Error(`Protected journey field is not accepted: ${key}`);
        error.code = "ACTIVE_JOURNEY_PROTECTED_FIELD";
        throw error;
      }
      if (isObject(value) || Array.isArray(value)) stack.push(value);
    }
  }
}

function validateHandle(handle, allowedProductHandles) {
  const normalized = normalizeHandle(handle);
  if (!normalized) return "";
  if (allowedProductHandles?.size && !allowedProductHandles.has(normalized)) {
    const error = new Error("That product is not eligible for this showroom journey.");
    error.code = "ACTIVE_JOURNEY_PRODUCT_INVALID";
    throw error;
  }
  return normalized;
}

function eventTouchedFields(event = {}) {
  const p = isObject(event.payload) ? event.payload : {};
  switch (event.type) {
    case "journey_surface_changed": return ["currentSurface", "journeyStage"];
    case "assessment_completed": return ["canonicalRecommendation", "journeyStage", "assessmentContext"];
    case "rest_test_feedback": return unique([
      `productFeedback.${normalizeHandle(p.productHandle) || "unknown"}`,
      p.motionPreference ? "retainedPreferences.motion" : "",
      "restTestState",
      "sessionRecommendation",
    ]);
    case "product_selected": return ["activeConfiguration.productHandle", "sessionRecommendation", "journeyStage"];
    case "product_rejected": return unique([
      "rejectedProducts", `productFeedback.${normalizeHandle(p.productHandle) || "unknown"}`,
      "activeConfiguration.productHandle", "sessionRecommendation", "activeQuote",
    ]);
    case "configuration_changed": return unique([
      Object.prototype.hasOwnProperty.call(p, "productHandle") ? "activeConfiguration.productHandle" : "",
      Object.prototype.hasOwnProperty.call(p, "size") ? "activeConfiguration.size" : "",
      Object.prototype.hasOwnProperty.call(p, "baseDecision") ? "activeConfiguration.baseDecision" : "",
      Object.prototype.hasOwnProperty.call(p, "baseHandle") ? "activeConfiguration.baseHandle" : "",
      Object.prototype.hasOwnProperty.call(p, "motionConfiguration") ? "activeConfiguration.motionConfiguration" : "",
      Object.prototype.hasOwnProperty.call(p, "acceptanceStatus") ? "activeConfiguration.acceptanceStatus" : "",
      ["productHandle", "size", "baseDecision", "baseHandle", "motionConfiguration"].some((key) => Object.prototype.hasOwnProperty.call(p, key)) ? "activeQuote" : "",
      "journeyStage",
    ]);
    case "preference_retained": return [`retainedPreferences.${clean(p.key) || "unknown"}`];
    case "desired_direction_changed": return [`desiredDirection.${clean(p.key) || "unknown"}`];
    case "cart_linked": return ["cartReference", "journeyStage"];
    case "checkout_handoff": return ["cartReference", "journeyStage"];
    case "ask_state_committed": return [
      "sessionRecommendation", "rejectedProducts", "productFeedback", "retainedPreferences",
      "desiredDirection", "activeConfiguration", "activeQuote", "comparisonSet", "currentGoal", "journeyStage",
    ];
    case "journey_completed": return ["visitStatus", "journeyStage"];
    default: return [];
  }
}

function assertEvent(event = {}, { trusted = false } = {}) {
  const type = clean(event.type);
  const allowed = trusted ? TRUSTED_EVENT_TYPES : CLIENT_EVENT_TYPES;
  if (!allowed.has(type)) {
    const error = new Error("Unsupported Active Journey event.");
    error.code = "ACTIVE_JOURNEY_EVENT_INVALID";
    throw error;
  }
  assertNoProtectedInput(event.payload, trusted);
  return { type, payload: isObject(event.payload) ? event.payload : {}, eventId: clean(event.eventId) || null };
}

function applyEvent(current, rawEvent, { expectedRevision, trusted = false, allowedProductHandles = new Set(), now = new Date() } = {}) {
  const event = assertEvent(rawEvent, { trusted });
  const before = clone(current);
  const revisionBefore = Number(current.revision || 0);
  const expected = Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : revisionBefore;
  const touchedFields = eventTouchedFields(event);
  if (expected > revisionBefore) {
    const error = new Error("Journey revision is ahead of the stored state.");
    error.code = "ACTIVE_JOURNEY_REVISION_INVALID";
    error.currentJourney = clone(current);
    throw error;
  }
  const conflictingFields = expected < revisionBefore
    ? touchedFields.filter((field) => Number(current.fieldRevisions?.[field] || 0) > expected)
    : [];
  if (conflictingFields.length) {
    const error = new Error("The journey changed on another surface. Re-read before changing the same decision.");
    error.code = "ACTIVE_JOURNEY_CONFLICT";
    error.conflictingFields = conflictingFields;
    error.currentJourney = clone(current);
    throw error;
  }

  const next = clone(current);
  const p = event.payload;
  const timestamp = iso(now);
  const handle = validateHandle(p.productHandle, allowedProductHandles);
  if (["rest_test_feedback", "product_selected", "product_rejected"].includes(event.type) && !handle) {
    const error = new Error("A valid product is required for this journey update.");
    error.code = "ACTIVE_JOURNEY_PRODUCT_REQUIRED";
    throw error;
  }

  if (event.type === "journey_surface_changed") {
    const surface = normalizeSurface(p.surface);
    if (surface !== next.currentSurface) next.previousSurface = next.currentSurface;
    next.currentSurface = surface;
    next.journeyStage = clean(p.stage) || surface;
  } else if (event.type === "assessment_completed") {
    next.canonicalRecommendation = clone(p.canonicalRecommendation || next.canonicalRecommendation);
    next.assessmentContext = clone(p.assessmentContext || {});
    next.journeyStage = "results_ready";
  } else if (event.type === "rest_test_feedback") {
    const observations = unique(Array.isArray(p.observations) ? p.observations : [p.observation]);
    const existing = isObject(next.productFeedback[handle]) ? next.productFeedback[handle] : {};
    next.productFeedback[handle] = {
      ...existing,
      observations: unique([...(existing.observations || []), ...observations]),
      updatedAt: timestamp,
      source: "rest_test",
    };
    if (p.motionPreference) next.retainedPreferences.motion = { value: clean(p.motionPreference), updatedAt: timestamp, source: "rest_test" };
    next.restTestState = {
      ...next.restTestState,
      currentPod: clean(p.podId) || next.restTestState.currentPod || null,
      productHandle: handle,
      status: clean(p.status) || "observed",
      observations,
      completedAt: clean(p.completedAt) || next.restTestState.completedAt || null,
    };
    if (observations.some((value) => ["too_firm", "too_soft", "disliked", "uncomfortable"].includes(value))) {
      const reason = observations.find((value) => value.startsWith("too_")) || "did_not_like";
      next.rejectedProducts = (next.rejectedProducts || []).filter((item) => normalizeHandle(item.handle) !== handle).concat({ handle, reason, status: "rejected", rejectedAt: timestamp });
      if (next.activeConfiguration?.productHandle === handle) next.activeConfiguration = { ...next.activeConfiguration, productHandle: null, acceptanceStatus: "invalidated" };
    }
  } else if (event.type === "product_selected") {
    next.activeConfiguration = { ...next.activeConfiguration, productHandle: handle, acceptanceStatus: clean(p.acceptanceStatus) || "considering", updatedAt: timestamp };
    next.sessionRecommendation = { productHandle: handle, source: "shopper_selection", updatedAt: timestamp };
    next.journeyStage = "product_selected";
  } else if (event.type === "product_rejected") {
    next.rejectedProducts = (next.rejectedProducts || []).filter((item) => normalizeHandle(item.handle) !== handle).concat({ handle, reason: clean(p.reason) || "did_not_like", status: "rejected", rejectedAt: timestamp });
    next.productFeedback[handle] = { ...(next.productFeedback[handle] || {}), observations: unique([...(next.productFeedback[handle]?.observations || []), clean(p.reason) || "did_not_like"]), updatedAt: timestamp };
    if (normalizeHandle(next.activeConfiguration?.productHandle) === handle) next.activeConfiguration = { ...next.activeConfiguration, productHandle: null, acceptanceStatus: "invalidated", invalidationReason: "product_rejected" };
    if (normalizeHandle(next.sessionRecommendation?.productHandle) === handle) next.sessionRecommendation = null;
    if (normalizeHandle(next.activeQuote?.productHandle) === handle || (next.activeQuote?.items || []).some((item) => normalizeHandle(item.handle) === handle)) next.activeQuote = { ...next.activeQuote, status: "invalidated", cartReady: false, invalidationReason: "product_rejected", invalidatedAt: timestamp };
  } else if (event.type === "configuration_changed") {
    const config = { ...next.activeConfiguration };
    if (Object.prototype.hasOwnProperty.call(p, "productHandle")) config.productHandle = handle || null;
    for (const key of ["size", "baseDecision", "motionConfiguration", "acceptanceStatus"]) {
      if (Object.prototype.hasOwnProperty.call(p, key)) config[key] = clean(p[key]) || null;
    }
    if (Object.prototype.hasOwnProperty.call(p, "baseHandle")) config.baseHandle = validateHandle(p.baseHandle, allowedProductHandles) || null;
    config.updatedAt = timestamp;
    next.activeConfiguration = config;
    if (
      next.activeQuote &&
      ["productHandle", "size", "baseDecision", "baseHandle", "motionConfiguration"].some((key) => Object.prototype.hasOwnProperty.call(p, key))
    ) {
      next.activeQuote = { ...next.activeQuote, status: "invalidated", cartReady: false, invalidationReason: "configuration_changed", invalidatedAt: timestamp };
    }
    next.journeyStage = config.acceptanceStatus === "accepted" ? "configuration_accepted" : "configuring";
  } else if (event.type === "preference_retained") {
    const key = clean(p.key);
    if (!key) throw Object.assign(new Error("A preference key is required."), { code: "ACTIVE_JOURNEY_PREFERENCE_INVALID" });
    next.retainedPreferences[key] = { value: clean(p.value), updatedAt: timestamp, source: clean(p.source) || next.currentSurface };
  } else if (event.type === "desired_direction_changed") {
    const key = clean(p.key);
    if (!key) throw Object.assign(new Error("A desired direction key is required."), { code: "ACTIVE_JOURNEY_DIRECTION_INVALID" });
    next.desiredDirection[key] = clean(p.value);
  } else if (event.type === "cart_linked" || event.type === "checkout_handoff") {
    const cartId = clean(p.cartId);
    if (cartId && !/^gid:\/\/shopify\/Cart\//.test(cartId)) {
      const error = new Error("A valid cart reference is required.");
      error.code = "ACTIVE_JOURNEY_CART_INVALID";
      throw error;
    }
    next.cartReference = { cartId: cartId || next.cartReference?.cartId || null, checkoutUrl: trusted ? clean(p.checkoutUrl) || next.cartReference?.checkoutUrl || null : next.cartReference?.checkoutUrl || null, linkedAt: timestamp };
    next.journeyStage = event.type === "checkout_handoff" ? "checkout_handoff" : "cart";
  } else if (event.type === "ask_state_committed") {
    for (const key of ["sessionRecommendation", "rejectedProducts", "productFeedback", "retainedPreferences", "desiredDirection", "activeConfiguration", "activeQuote", "comparisonSet", "currentGoal"]) {
      if (Object.prototype.hasOwnProperty.call(p, key)) next[key] = clone(p[key]);
    }
    next.journeyStage = clean(p.journeyStage) || next.journeyStage;
  } else if (event.type === "journey_completed") {
    next.visitStatus = "completed";
    next.journeyStage = "completed";
  }

  if (["rest_test_feedback", "product_rejected"].includes(event.type)) {
    const adaptive = resolveAdaptiveSessionRecommendation({
      canonicalRecommendation: next.canonicalRecommendation,
      rejectedProducts: next.rejectedProducts,
      productFeedback: next.productFeedback,
      retainedPreferences: next.retainedPreferences,
      desiredDirection: next.desiredDirection,
      activeSize: next.activeConfiguration?.size,
      activeMotionKey: next.activeConfiguration?.motionConfiguration,
    });
    next.sessionRecommendation = adaptive.sessionRecommendation;
  }

  const rejected = activeRejectedHandles(next);
  if (rejected.has(normalizeHandle(next.sessionRecommendation?.productHandle))) next.sessionRecommendation = null;
  const revisionAfter = revisionBefore + 1;
  next.revision = revisionAfter;
  next.lastInteractionAt = timestamp;
  next.expiresAt = new Date(new Date(timestamp).getTime() + ACTIVE_JOURNEY_TTL_MINUTES * 60 * 1000).toISOString();
  next.fieldRevisions = { ...(next.fieldRevisions || {}) };
  for (const field of touchedFields) next.fieldRevisions[field] = revisionAfter;
  next.lastTransition = {
    eventType: event.type, eventId: event.eventId, surface: normalizeSurface(p.surface || next.currentSurface),
    touchedFields, revisionBefore, revisionAfter, timestamp,
  };
  return { journey: next, stateBefore: before, stateAfter: clone(next), stateDelta: touchedFields, revisionBefore, revisionAfter, mergedFromStaleRevision: expected < revisionBefore };
}

function hydrateAskContextFromActiveJourney(context = {}, journey = {}) {
  const next = { ...context, activeJourney: clone(journey) };
  const memory = isObject(next.askSnoozerWorkingMemory) ? { ...next.askSnoozerWorkingMemory } : {};
  const previous = isObject(memory.activeDeal) ? memory.activeDeal : {};
  memory.activeDeal = {
    ...previous,
    canonicalRecommendation: clone(journey.canonicalRecommendation) || previous.canonicalRecommendation,
    sessionRecommendation: clone(journey.sessionRecommendation),
    rejectedProducts: clone(journey.rejectedProducts) || [],
    productFeedback: clone(journey.productFeedback) || {},
    retainedPreferences: clone(journey.retainedPreferences) || {},
    desiredDirection: clone(journey.desiredDirection) || {},
    activeConfiguration: clone(journey.activeConfiguration) || {},
    activeQuote: clone(journey.activeQuote),
    comparisonProductHandles: clone(journey.comparisonSet) || [],
    activeProductHandle: journey.activeConfiguration?.productHandle || journey.sessionRecommendation?.productHandle || null,
    activeSize: journey.activeConfiguration?.size || previous.activeSize || null,
    baseDecision: journey.activeConfiguration?.baseDecision || previous.baseDecision || null,
    activeBaseHandle: journey.activeConfiguration?.baseHandle || previous.activeBaseHandle || null,
    activeMotionKey: journey.activeConfiguration?.motionConfiguration || previous.activeMotionKey || null,
  };
  next.askSnoozerWorkingMemory = memory;
  return next;
}

function buildAskJourneyPayload(context = {}) {
  const deal = context?.askSnoozerWorkingMemory?.activeDeal || {};
  const activeConfiguration = {
    ...(isObject(deal.activeConfiguration) ? deal.activeConfiguration : {}),
  };
  if (deal.activeProductHandle) activeConfiguration.productHandle = deal.activeProductHandle;
  if (deal.activeSize) activeConfiguration.size = deal.activeSize;
  if (deal.baseDecision) activeConfiguration.baseDecision = deal.baseDecision;
  if (Object.prototype.hasOwnProperty.call(deal, "activeBaseHandle")) {
    activeConfiguration.baseHandle = deal.activeBaseHandle;
  }
  if (deal.activeMotionKey) activeConfiguration.motionConfiguration = deal.activeMotionKey;
  delete activeConfiguration.motionKey;
  return {
    sessionRecommendation: deal.sessionRecommendation || null,
    rejectedProducts: deal.rejectedProducts || [],
    productFeedback: deal.productFeedback || {},
    retainedPreferences: deal.retainedPreferences || {},
    desiredDirection: deal.desiredDirection || {},
    activeConfiguration,
    activeQuote: deal.activeQuote || null,
    comparisonSet: deal.comparisonProductHandles || [],
    currentGoal: deal.goal || null,
    journeyStage: deal.stage || "exploring",
    surface: "ask_snoozer",
  };
}

function createActiveJourneyService({ load, save, clock = () => new Date() } = {}) {
  if (typeof load !== "function" || typeof save !== "function") {
    throw new Error("Active Journey persistence callbacks are required.");
  }

  async function persist(recordId, journey, expectedStoredRevision) {
    const started = Date.now();
    await save({ recordId, journey, expectedStoredRevision });
    return Date.now() - started;
  }

  async function resolve({ identity, canonicalRecommendation = null, surface = "unknown", forceNew = false } = {}) {
    const recordId = deriveActiveJourneyRecordId(identity);
    const readStarted = Date.now();
    let stored = await load(recordId);
    const readMs = Date.now() - readStarted;
    let journey = stored?.activeJourney || stored?.context?.activeJourney || null;
    const hadJourney = Boolean(journey);
    let writeMs = 0;
    const mustRotate = Boolean(journey && (forceNew || hasExpired(journey, clock()) || journey.visitStatus === "completed"));
    if (!journey || mustRotate) {
      const next = makeActiveJourney({
        recordId, identity, canonicalRecommendation, surface, now: clock(),
        rotationIndex: Number(journey?.rotationIndex || 0) + (mustRotate ? 1 : 0),
      });
      try {
        writeMs = await persist(recordId, next, journey ? Number(journey.revision || 0) : null);
        journey = next;
      } catch (error) {
        if (error?.name !== "ConditionalCheckFailedException" && error?.code !== "ConditionalCheckFailedException") throw error;
        stored = await load(recordId);
        journey = stored?.activeJourney || stored?.context?.activeJourney || null;
        if (!journey) throw error;
      }
    } else if (!journey.canonicalRecommendation && canonicalRecommendation) {
      const result = applyEvent(journey, {
        type: "assessment_completed",
        payload: { canonicalRecommendation, assessmentContext: {}, surface: normalizeSurface(surface) },
      }, { expectedRevision: journey.revision, trusted: true, now: clock() });
      writeMs = await persist(recordId, result.journey, journey.revision);
      journey = result.journey;
    }
    return {
      recordId,
      journey,
      readMs,
      writeMs,
      created: !hadJourney,
      resumed: hadJourney && !mustRotate,
      rotated: mustRotate,
    };
  }

  async function transition({ recordId, journey, event, expectedRevision, trusted = false, allowedProductHandles = new Set() } = {}) {
    let current = journey;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = applyEvent(current, event, { expectedRevision, trusted, allowedProductHandles, now: clock() });
      try {
        const writeMs = await persist(recordId, result.journey, Number(current.revision || 0));
        return { ...result, recordId, writeMs };
      } catch (error) {
        if ((error?.name !== "ConditionalCheckFailedException" && error?.code !== "ConditionalCheckFailedException") || attempt > 0) throw error;
        const reread = await load(recordId);
        current = reread?.activeJourney || reread?.context?.activeJourney || null;
        if (!current) throw error;
      }
    }
    throw new Error("Active Journey transition could not be saved.");
  }

  return { resolve, transition };
}

module.exports = {
  ACTIVE_JOURNEY_TTL_MINUTES,
  ACTIVE_JOURNEY_VERSION,
  CLIENT_EVENT_TYPES,
  applyEvent,
  buildAskJourneyPayload,
  createActiveJourneyService,
  deriveActiveJourneyRecordId,
  hasExpired,
  hydrateAskContextFromActiveJourney,
  makeActiveJourney,
  normalizeSurface,
};
