const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  const next = String(value || "").trim();
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
  return isObject(value) ? JSON.parse(JSON.stringify(value)) : null;
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
  const topPodIds = uniqueStrings(
    Array.isArray(canonicalRecommendation.topPodIds) ? canonicalRecommendation.topPodIds : []
  );
  const primaryMattressHandle = cleanString(canonicalRecommendation.primaryMattressHandle) || null;
  const baseHandle =
    canonicalRecommendation.baseHandle == null
      ? null
      : cleanString(canonicalRecommendation.baseHandle) || null;
  const motionKey =
    cleanString(canonicalRecommendation.motionKey || canonicalRecommendation.normalizedAssessment?.motionKey) ||
    null;
  const motionLabel =
    cleanString(
      canonicalRecommendation.motionLabel || canonicalRecommendation.normalizedAssessment?.motionLabel
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
      topPodIds,
      primaryMattressHandle,
      baseHandle,
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

function getCustomerProfileKey(patch = {}) {
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

  return {
    shopperId: cleanString(input.shopperId) || undefined,
    sessionId: cleanString(input.sessionId) || undefined,
    threadId: cleanString(input.threadId) || undefined,
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
    lastInteractionAt: interactionAt,
    bookingStatus: cleanString(input.bookingStatus) || undefined,
    createdAt,
    updatedAt,
    ttl: Number.isFinite(Number(input.ttl)) && Number(input.ttl) > 0
      ? Number(input.ttl)
      : ttlEpochSeconds(profileTtlDays),
  };
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

module.exports = {
  buildCustomerProfilePatch,
  extractCanonicalProfileFields,
  upsertCustomerProfile,
  getCustomerProfileKey,
};
