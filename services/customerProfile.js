const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const LEAD_STAGE_ORDER = Object.freeze([
  "new",
  "browsing",
  "assessment_started",
  "assessment_completed",
  "session_interested",
  "purchase_interested",
  "booked",
  "purchased",
]);

const HIGH_VALUE_INTENTS = Object.freeze([
  "couple_conflict",
  "back_pain",
  "sleep_hot",
  "firm_support",
  "compare_mattresses",
  "booking_help",
  "cart_confidence",
  "bundle_price",
  "size_help",
]);

const LOW_VALUE_INTENT_GROUPS = Object.freeze(["fallback_unclear", "policy_support"]);
const SESSION_INTEREST_INTENTS = Object.freeze(["booking_help"]);
const PURCHASE_INTEREST_INTENTS = Object.freeze(["cart_confidence", "bundle_price"]);
const PROFILE_ARRAY_FIELDS = Object.freeze([
  "topPodIds",
  "reasonKeys",
  "recommendedProductHandles",
  "identityAliases",
  "previousProfileIds",
  "previousShopperIds",
]);

const LEAD_STAGE_RANK = LEAD_STAGE_ORDER.reduce(function reduceRank(acc, stage, index) {
  acc[stage] = index;
  return acc;
}, {});

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  const next = String(value == null ? "" : value).trim();
  return next || "";
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))];
}

function nowIso() {
  return new Date().toISOString();
}

function ttlEpochSeconds(days = 90) {
  const safeDays = Math.max(1, Number(days || 90));
  return Math.floor(Date.now() / 1000) + safeDays * 24 * 60 * 60;
}

function cloneObject(value) {
  return isObject(value) || Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : value;
}

function normalizeAssessmentAnswers(input = {}) {
  const directAnswers = isObject(input.assessmentAnswers)
    ? input.assessmentAnswers
    : isObject(input.answers)
      ? input.answers
      : null;
  if (directAnswers) return cloneObject(directAnswers);

  const assessment = isObject(input.assessment) ? input.assessment : null;
  if (isObject(assessment?.answers)) return cloneObject(assessment.answers);
  if (assessment) return cloneObject(assessment);

  const context = isObject(input.context) ? input.context : null;
  if (isObject(context?.assessment?.answers)) return cloneObject(context.assessment.answers);
  if (isObject(context?.assessment)) return cloneObject(context.assessment);

  return null;
}

function extractContactInfo(input = {}) {
  const customer = isObject(input.customer)
    ? input.customer
    : isObject(input.context?.customer)
      ? input.context.customer
      : null;
  const contact = isObject(input.contactInfo)
    ? input.contactInfo
    : isObject(input.contact)
      ? input.contact
      : null;

  const preferredName = cleanString(
    input.preferredName || contact?.preferredName || customer?.preferredName
  );
  const email = cleanString(input.email || contact?.email || customer?.email);
  const phone = cleanString(input.phone || contact?.phone || customer?.phone);
  const contactPreference = cleanString(
    input.contactPreference || contact?.contactPreference || customer?.contactPreference
  );
  const consent = isObject(input.consent)
    ? cloneObject(input.consent)
    : isObject(contact?.consent)
      ? cloneObject(contact.consent)
      : isObject(customer?.consent)
        ? cloneObject(customer.consent)
        : null;

  return {
    preferredName: preferredName || undefined,
    email: email || undefined,
    phone: phone || undefined,
    contactPreference: contactPreference || undefined,
    consent: consent || undefined,
  };
}

function extractCanonicalProfileFields(canonicalRecommendation) {
  if (!isObject(canonicalRecommendation)) return {};

  const normalizedAssessment = cloneObject(canonicalRecommendation.normalizedAssessment);
  const topPodId = cleanString(canonicalRecommendation.topPodId) || null;
  const topPodName = cleanString(canonicalRecommendation.topPodName) || null;
  const topPodIds = uniqueStrings(
    Array.isArray(canonicalRecommendation.topPodIds) ? canonicalRecommendation.topPodIds : []
  );
  const primaryMattressHandle = cleanString(canonicalRecommendation.primaryMattressHandle) || null;
  const primaryMattressTitle =
    cleanString(canonicalRecommendation.primaryMattressTitle) || null;
  const baseHandle =
    canonicalRecommendation.baseHandle == null
      ? null
      : cleanString(canonicalRecommendation.baseHandle) || null;
  const motionKey =
    cleanString(
      canonicalRecommendation.motionKey ||
        canonicalRecommendation.normalizedAssessment?.motionKey
    ) || null;
  const motionLabel =
    cleanString(
      canonicalRecommendation.motionLabel ||
        canonicalRecommendation.normalizedAssessment?.motionLabel
    ) || null;
  const reasonKeys = uniqueStrings(
    Array.isArray(canonicalRecommendation.reasonKeys) ? canonicalRecommendation.reasonKeys : []
  );
  const warnings = uniqueStrings(
    []
      .concat(Array.isArray(canonicalRecommendation.warnings) ? canonicalRecommendation.warnings : [])
      .concat(
        Array.isArray(canonicalRecommendation.normalizedAssessment?.warnings)
          ? canonicalRecommendation.normalizedAssessment.warnings
          : []
      )
  );

  return {
    normalizedAssessment: normalizedAssessment || undefined,
    canonicalRecommendation: {
      manifestVersion: cleanString(canonicalRecommendation.manifestVersion) || undefined,
      normalizedAssessment: normalizedAssessment || undefined,
      topPodId,
      topPodName,
      topPodIds,
      primaryMattressHandle,
      primaryMattressTitle,
      baseHandle,
      baseTitle: cleanString(canonicalRecommendation.baseTitle) || undefined,
      motionKey,
      motionLabel,
      reasonKeys,
      warnings,
    },
    topPodId,
    topPodIds,
    primaryMattressHandle,
    baseHandle,
    motionKey,
    reasonKeys,
  };
}

function normalizeLeadStage(value) {
  const stage = cleanString(value).toLowerCase();
  return LEAD_STAGE_RANK[stage] >= 0 ? stage : "";
}

function resolveLeadStage(currentStage = "", candidateStage = "") {
  const current = normalizeLeadStage(currentStage);
  const candidate = normalizeLeadStage(candidateStage);

  if (!current && !candidate) return undefined;
  if (!current) return candidate || undefined;
  if (!candidate) return current || undefined;

  return LEAD_STAGE_RANK[candidate] >= LEAD_STAGE_RANK[current] ? candidate : current;
}

function deriveInteractionLeadStage({
  previousProfile = null,
  explicitLeadStage = "",
  lastIntent = "",
  lastIntentGroup = "",
  hasAssessment = false,
  hasCanonical = false,
} = {}) {
  const currentStage = cleanString(previousProfile?.leadStage);
  const explicit = cleanString(explicitLeadStage);
  if (explicit) return resolveLeadStage(currentStage, explicit);

  const intent = cleanString(lastIntent);
  const intentGroup = cleanString(lastIntentGroup);

  if (SESSION_INTEREST_INTENTS.includes(intent) || intentGroup === "booking_handoff") {
    return resolveLeadStage(currentStage, "session_interested");
  }

  if (PURCHASE_INTEREST_INTENTS.includes(intent) || intentGroup === "cart_confidence") {
    return resolveLeadStage(currentStage, "purchase_interested");
  }

  if (hasAssessment || hasCanonical || intent || intentGroup) {
    return resolveLeadStage(currentStage, "browsing");
  }

  return resolveLeadStage(currentStage, "");
}

function mergeCustomerProfile(previousProfile = {}, patch = {}) {
  const previous = isObject(previousProfile) ? previousProfile : {};
  const nextPatch = isObject(patch) ? patch : {};
  const merged = { ...cloneObject(previous) };

  for (const [key, value] of Object.entries(nextPatch)) {
    if (typeof value === "undefined") continue;

    if (PROFILE_ARRAY_FIELDS.includes(key)) {
      merged[key] = uniqueStrings([].concat(previous[key] || []).concat(value || []));
      continue;
    }

    if (key === "canonicalRecommendation") {
      const previousCanonical = isObject(previous.canonicalRecommendation)
        ? previous.canonicalRecommendation
        : {};
      const nextCanonical = isObject(value) ? value : {};
      merged[key] = { ...cloneObject(previousCanonical), ...cloneObject(nextCanonical) };
      continue;
    }

    if (key === "sessionPrep" && isObject(value)) {
      merged[key] = {
        ...(isObject(previous.sessionPrep) ? cloneObject(previous.sessionPrep) : {}),
        ...cloneObject(value),
      };
      continue;
    }

    if (key === "normalizedAssessment" && isObject(value)) {
      merged[key] = {
        ...(isObject(previous.normalizedAssessment)
          ? cloneObject(previous.normalizedAssessment)
          : {}),
        ...cloneObject(value),
      };
      continue;
    }

    merged[key] = cloneObject(value);
  }

  return merged;
}

function getCustomerProfileKey(patch = {}) {
  const explicitProfileId = cleanString(patch.profileId);
  if (explicitProfileId) return { profileId: explicitProfileId };

  const shopperId = cleanString(patch.shopperId);
  if (shopperId) return { profileId: `shopper#${shopperId}` };

  const sessionId = cleanString(patch.sessionId || patch.threadId);
  if (sessionId) return { profileId: `session#${sessionId}` };

  return null;
}

function buildCustomerProfilePatch(input = {}) {
  const interactionAt =
    cleanString(input.lastInteractionAt) || cleanString(input.updatedAt) || nowIso();
  const createdAt = cleanString(input.createdAt) || interactionAt;
  const updatedAt = cleanString(input.updatedAt) || interactionAt;
  const profileTtlDays = Number(process.env.CUSTOMER_PROFILE_TTL_DAYS || 90);
  const assessmentAnswers = normalizeAssessmentAnswers(input);
  const canonicalFields = extractCanonicalProfileFields(input.canonicalRecommendation);
  const contactInfo = extractContactInfo(input);
  const recommendedProductHandles = uniqueStrings(
    Array.isArray(input.recommendedProductHandles) ? input.recommendedProductHandles : []
  );
  const identityAliases = uniqueStrings(
    Array.isArray(input.identityAliases) ? input.identityAliases : []
  );
  const previousProfileIds = uniqueStrings(
    Array.isArray(input.previousProfileIds) ? input.previousProfileIds : []
  );
  const previousShopperIds = uniqueStrings(
    Array.isArray(input.previousShopperIds) ? input.previousShopperIds : []
  );

  return {
    profileId: cleanString(input.profileId) || undefined,
    shopperId: cleanString(input.shopperId) || undefined,
    snoozeCode: cleanString(input.snoozeCode) || undefined,
    accessCode: cleanString(input.accessCode) || undefined,
    sessionId: cleanString(input.sessionId) || undefined,
    threadId: cleanString(input.threadId) || undefined,
    visitorId: cleanString(input.visitorId) || undefined,
    identityType: cleanString(input.identityType) || undefined,
    identitySource: cleanString(input.identitySource) || undefined,
    isTemporary: typeof input.isTemporary === "boolean" ? input.isTemporary : undefined,
    sourceShopperId: cleanString(input.sourceShopperId) || undefined,
    aliasKind: cleanString(input.aliasKind) || undefined,
    aliasValue: cleanString(input.aliasValue) || undefined,
    aliasOfShopperId: cleanString(input.aliasOfShopperId) || undefined,
    aliasOfProfileId: cleanString(input.aliasOfProfileId) || undefined,
    mergedIntoProfileId: cleanString(input.mergedIntoProfileId) || undefined,
    mergedIntoShopperId: cleanString(input.mergedIntoShopperId) || undefined,
    mergedAt: cleanString(input.mergedAt) || undefined,
    identityAliases: identityAliases.length ? identityAliases : undefined,
    previousProfileIds: previousProfileIds.length ? previousProfileIds : undefined,
    previousShopperIds: previousShopperIds.length ? previousShopperIds : undefined,
    preferredName: contactInfo.preferredName,
    email: contactInfo.email,
    phone: contactInfo.phone,
    contactPreference: contactInfo.contactPreference,
    consent: contactInfo.consent,
    assessmentAnswers: assessmentAnswers || undefined,
    normalizedAssessment: canonicalFields.normalizedAssessment,
    canonicalRecommendation: canonicalFields.canonicalRecommendation,
    topPodId: canonicalFields.topPodId,
    topPodIds: canonicalFields.topPodIds,
    primaryMattressHandle: canonicalFields.primaryMattressHandle,
    baseHandle: canonicalFields.baseHandle,
    motionKey: canonicalFields.motionKey,
    reasonKeys: canonicalFields.reasonKeys,
    leadStage: cleanString(input.leadStage) || undefined,
    sourceSurface: cleanString(input.sourceSurface || input.surface || input.origin) || undefined,
    lastIntent: cleanString(input.lastIntent || input.intent) || undefined,
    lastIntentGroup: cleanString(input.lastIntentGroup || input.intentGroup) || undefined,
    lastQuery: cleanString(input.lastQuery || input.query || input.message) || undefined,
    lastPath: cleanString(input.lastPath || input.path) || undefined,
    lastPageType: cleanString(input.lastPageType || input.pageType || input.page_type) || undefined,
    currentProductHandle: cleanString(input.currentProductHandle) || undefined,
    recommendedProductHandles: recommendedProductHandles.length
      ? recommendedProductHandles
      : undefined,
    podId: cleanString(input.podId || input.topPodIdHint) || undefined,
    mode: cleanString(input.mode) || undefined,
    bookingStatus: cleanString(input.bookingStatus) || undefined,
    bookingSource: cleanString(input.bookingSource) || undefined,
    bookingEventUri: cleanString(input.bookingEventUri) || undefined,
    bookingInviteeUri: cleanString(input.bookingInviteeUri) || undefined,
    bookingStartTime: cleanString(input.bookingStartTime) || undefined,
    bookingEndTime: cleanString(input.bookingEndTime) || undefined,
    bookingTimezone: cleanString(input.bookingTimezone) || undefined,
    bookingLocationType: cleanString(input.bookingLocationType) || undefined,
    bookingLocation: cleanString(input.bookingLocation) || undefined,
    bookingCreatedAt: cleanString(input.bookingCreatedAt) || undefined,
    bookingCanceledAt: cleanString(input.bookingCanceledAt) || undefined,
    bookingEventType: cleanString(input.bookingEventType) || undefined,
    bookingEventName: cleanString(input.bookingEventName) || undefined,
    sessionPrep: isObject(input.sessionPrep) ? cloneObject(input.sessionPrep) : undefined,
    sessionPrepStatus: cleanString(input.sessionPrepStatus || input.sessionPrep?.status) || undefined,
    rewardSummary: isObject(input.rewardSummary)
      ? cloneObject(input.rewardSummary)
      : undefined,
    lastInteractionAt: interactionAt,
    createdAt,
    updatedAt,
    ttl:
      Number.isFinite(Number(input.ttl)) && Number(input.ttl) > 0
        ? Number(input.ttl)
        : ttlEpochSeconds(profileTtlDays),
  };
}

function buildHudProfilePatch(input = {}) {
  const previousProfile = isObject(input.previousProfile) ? input.previousProfile : {};
  const productHandles = uniqueStrings(
    []
      .concat(Array.isArray(input.recommendedProductHandles) ? input.recommendedProductHandles : [])
      .concat(
        Array.isArray(input.products)
          ? input.products.map((product) => product && product.handle)
          : []
      )
      .concat(Array.isArray(previousProfile.recommendedProductHandles) ? previousProfile.recommendedProductHandles : [])
  );

  const leadStage = deriveInteractionLeadStage({
    previousProfile,
    explicitLeadStage: input.leadStage,
    lastIntent: input.lastIntent,
    lastIntentGroup: input.lastIntentGroup,
    hasAssessment: Boolean(normalizeAssessmentAnswers(input)),
    hasCanonical: Boolean(input.canonicalRecommendation),
  });

  return buildCustomerProfilePatch({
    ...input,
    leadStage,
    recommendedProductHandles: productHandles,
    currentProductHandle:
      cleanString(input.currentProductHandle) ||
      cleanString(input.productResolution?.currentProductHandle),
  });
}

function buildAskSnoozerProfilePatch(input = {}) {
  const previousProfile = isObject(input.previousProfile) ? input.previousProfile : {};
  const productHandles = uniqueStrings(
    []
      .concat(Array.isArray(input.recommendedProductHandles) ? input.recommendedProductHandles : [])
      .concat(Array.isArray(input.context?.recommendedProductHandles) ? input.context.recommendedProductHandles : [])
      .concat(Array.isArray(previousProfile.recommendedProductHandles) ? previousProfile.recommendedProductHandles : [])
  );

  const leadStage = deriveInteractionLeadStage({
    previousProfile,
    explicitLeadStage: input.leadStage,
    lastIntent: input.lastIntent,
    lastIntentGroup: input.lastIntentGroup,
    hasAssessment: Boolean(normalizeAssessmentAnswers(input)),
    hasCanonical: Boolean(input.canonicalRecommendation),
  });

  return buildCustomerProfilePatch({
    ...input,
    leadStage,
    recommendedProductHandles: productHandles,
    podId: cleanString(input.podId || input.context?.podId || input.context?.selectedPodId) || undefined,
    sourceSurface: cleanString(input.sourceSurface) || "ask_snoozer",
  });
}

function getProfileTableName(options = {}) {
  return cleanString(options.tableName || process.env.CUSTOMER_PROFILE_TABLE);
}

function buildUpdateExpression(patch = {}) {
  const expressionParts = [];
  const ExpressionAttributeNames = {};
  const ExpressionAttributeValues = {};
  let index = 0;

  for (const [attribute, value] of Object.entries(patch)) {
    if (attribute === "profileId" || typeof value === "undefined") continue;

    if (attribute === "createdAt") {
      ExpressionAttributeNames["#createdAt"] = "createdAt";
      ExpressionAttributeValues[":createdAt"] = value;
      expressionParts.push("#createdAt = if_not_exists(#createdAt, :createdAt)");
      continue;
    }

    index += 1;
    const nameKey = `#attr${index}`;
    const valueKey = `:value${index}`;
    ExpressionAttributeNames[nameKey] = attribute;
    ExpressionAttributeValues[valueKey] = value;
    expressionParts.push(`${nameKey} = ${valueKey}`);
  }

  return {
    UpdateExpression: `SET ${expressionParts.join(", ")}`,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
  };
}

async function getCustomerProfile(input = {}, options = {}) {
  const TableName = getProfileTableName(options);
  if (!TableName) {
    return {
      ok: false,
      skipped: true,
      reason: "CUSTOMER_PROFILE_TABLE_NOT_CONFIGURED",
      profile: null,
      profileId: null,
    };
  }

  const Key =
    typeof input === "string"
      ? { profileId: cleanString(input) }
      : cleanString(input?.profileId)
        ? { profileId: cleanString(input.profileId) }
        : getCustomerProfileKey(input);

  if (!cleanString(Key?.profileId)) {
    return {
      ok: false,
      skipped: true,
      reason: "CUSTOMER_PROFILE_KEY_MISSING",
      profile: null,
      profileId: null,
    };
  }

  const client = options.ddbDoc || ddbDoc;
  const out = await client.send(new GetCommand({ TableName, Key }));

  return {
    ok: true,
    skipped: false,
    reason: null,
    profile: out.Item || null,
    profileId: Key.profileId,
  };
}

async function upsertCustomerProfile(patch, options = {}) {
  const TableName = getProfileTableName(options);
  if (!TableName) {
    return {
      ok: false,
      skipped: true,
      reason: "CUSTOMER_PROFILE_TABLE_NOT_CONFIGURED",
    };
  }

  const normalizedPatch = buildCustomerProfilePatch(patch);
  const Key = getCustomerProfileKey(normalizedPatch);
  if (!Key) {
    return {
      ok: false,
      skipped: true,
      reason: "CUSTOMER_PROFILE_KEY_MISSING",
    };
  }

  const client = options.ddbDoc || ddbDoc;
  const updateParts = buildUpdateExpression(normalizedPatch);

  await client.send(
    new UpdateCommand({
      TableName,
      Key,
      ...updateParts,
    })
  );

  return {
    ok: true,
    skipped: false,
    tableName: TableName,
    key: Key,
    profileId: Key.profileId,
  };
}

function extractProfileZohoMaterialFields(profileOrPatch = {}) {
  const profile = isObject(profileOrPatch) ? profileOrPatch : {};
  return {
    shopperId: cleanString(profile.shopperId) || null,
    preferredName: cleanString(profile.preferredName) || null,
    email: cleanString(profile.email) || null,
    phone: cleanString(profile.phone) || null,
    assessmentAnswers: normalizeAssessmentAnswers(profile) || null,
    topPodId: cleanString(profile.topPodId) || null,
    topPodIds: uniqueStrings(Array.isArray(profile.topPodIds) ? profile.topPodIds : []),
    primaryMattressHandle: cleanString(profile.primaryMattressHandle) || null,
    baseHandle:
      profile.baseHandle == null ? null : cleanString(profile.baseHandle) || null,
    motionKey: cleanString(profile.motionKey) || null,
    reasonKeys: uniqueStrings(Array.isArray(profile.reasonKeys) ? profile.reasonKeys : []),
    recommendedProductHandles: uniqueStrings(
      Array.isArray(profile.recommendedProductHandles) ? profile.recommendedProductHandles : []
    ),
    leadStage: normalizeLeadStage(profile.leadStage) || null,
    sourceSurface: cleanString(profile.sourceSurface) || null,
    lastIntent: cleanString(profile.lastIntent) || null,
    lastIntentGroup: cleanString(profile.lastIntentGroup) || null,
    podId: cleanString(profile.podId) || null,
    bookingStatus: cleanString(profile.bookingStatus) || null,
    bookingSource: cleanString(profile.bookingSource) || null,
    bookingStartTime: cleanString(profile.bookingStartTime) || null,
    bookingEndTime: cleanString(profile.bookingEndTime) || null,
    bookingTimezone: cleanString(profile.bookingTimezone) || null,
    bookingLocationType: cleanString(profile.bookingLocationType) || null,
    bookingLocation: cleanString(profile.bookingLocation) || null,
    sessionPrepStatus: cleanString(profile.sessionPrepStatus || profile.sessionPrep?.status) || null,
    recommendedStartingPod:
      cleanString(profile.sessionPrep?.recommendedStartingPod || profile.topPodId) || null,
  };
}

function valuesDiffer(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function shouldSyncProfileToZoho(previousProfile = null, nextPatch = {}, context = {}) {
  if (context?.syncPolicyDisabled) {
    return {
      shouldSync: false,
      skipped: true,
      reason: "SYNC_POLICY_DISABLED",
      nextProfile: mergeCustomerProfile(previousProfile, nextPatch),
      changedFields: [],
    };
  }

  const previous = isObject(previousProfile) ? previousProfile : {};
  const patch = isObject(nextPatch) ? nextPatch : {};
  const nextProfile = mergeCustomerProfile(previous, patch);
  const shopperId = cleanString(nextProfile.shopperId);
  const sessionId = cleanString(nextProfile.sessionId || nextProfile.threadId);

  if (!shopperId) {
    return {
      shouldSync: false,
      skipped: true,
      reason: sessionId ? "SESSION_ONLY_PROFILE" : "NO_SHOPPER_ID",
      nextProfile,
      changedFields: [],
    };
  }

  const previousMaterial = extractProfileZohoMaterialFields(previous);
  const nextMaterial = extractProfileZohoMaterialFields(nextProfile);
  const changedFields = Object.keys(nextMaterial).filter((key) =>
    valuesDiffer(previousMaterial[key], nextMaterial[key])
  );

  const currentStage = normalizeLeadStage(previousMaterial.leadStage);
  const nextStage = normalizeLeadStage(nextMaterial.leadStage);
  const leadStageAdvanced =
    Boolean(nextStage) &&
    nextStage !== currentStage &&
    resolveLeadStage(currentStage, nextStage) === nextStage;

  const contactChanged = ["preferredName", "email", "phone"].some((key) =>
    valuesDiffer(previousMaterial[key], nextMaterial[key])
  );

  const recommendationChanged = [
    "assessmentAnswers",
    "topPodId",
    "topPodIds",
    "primaryMattressHandle",
    "baseHandle",
    "motionKey",
    "reasonKeys",
    "recommendedProductHandles",
    "podId",
  ].some((key) => valuesDiffer(previousMaterial[key], nextMaterial[key]));

  const highValueIntent =
    HIGH_VALUE_INTENTS.includes(nextMaterial.lastIntent || "") ||
    HIGH_VALUE_INTENTS.includes(cleanString(context.lastIntent)) ||
    HIGH_VALUE_INTENTS.includes(cleanString(nextProfile.lastIntent));

  const lowValueIntentGroup = LOW_VALUE_INTENT_GROUPS.includes(nextMaterial.lastIntentGroup || "");
  const intentChanged = valuesDiffer(previousMaterial.lastIntent, nextMaterial.lastIntent);
  const hasAssessmentSignals = Boolean(
    nextMaterial.assessmentAnswers ||
      nextMaterial.topPodId ||
      nextMaterial.primaryMattressHandle ||
      nextMaterial.baseHandle ||
      nextMaterial.motionKey
  );

  if (leadStageAdvanced) {
    return {
      shouldSync: true,
      skipped: false,
      reason: "LEAD_STAGE_ADVANCED",
      nextProfile,
      changedFields,
    };
  }

  if (contactChanged) {
    return {
      shouldSync: true,
      skipped: false,
      reason: "CONTACT_INFO_CHANGED",
      nextProfile,
      changedFields,
    };
  }

  if (recommendationChanged && (highValueIntent || hasAssessmentSignals)) {
    return {
      shouldSync: true,
      skipped: false,
      reason: "PROFILE_SIGNALS_CHANGED",
      nextProfile,
      changedFields,
    };
  }

  if (highValueIntent && intentChanged && (hasAssessmentSignals || nextMaterial.recommendedProductHandles.length)) {
    return {
      shouldSync: true,
      skipped: false,
      reason: "HIGH_VALUE_INTENT_CHANGED",
      nextProfile,
      changedFields,
    };
  }

  if (lowValueIntentGroup) {
    return {
      shouldSync: false,
      skipped: true,
      reason: "LOW_VALUE_INTENT",
      nextProfile,
      changedFields,
    };
  }

  return {
    shouldSync: false,
    skipped: true,
    reason: "NO_MATERIAL_ZOHO_CHANGE",
    nextProfile,
    changedFields,
  };
}

module.exports = {
  buildAskSnoozerProfilePatch,
  buildCustomerProfilePatch,
  buildHudProfilePatch,
  extractCanonicalProfileFields,
  extractProfileZohoMaterialFields,
  getCustomerProfile,
  getCustomerProfileKey,
  mergeCustomerProfile,
  resolveLeadStage,
  shouldSyncProfileToZoho,
  upsertCustomerProfile,
};
