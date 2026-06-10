const { buildSnoozeProfile, mapProfileToZohoFields } = require("./snoozeProfile");
const zoho = require("./zoho");

const SHOPPER_ID_FIELD = process.env.ZOHO_CONTACT_KEY_FIELD || "Snoozer_Shopper_ID";

const OPTIONAL_PROFILE_FIELD_ENVS = {
  topPodId: "ZOHO_FIELD_TOP_POD_ID",
  topPodIds: "ZOHO_FIELD_TOP_POD_IDS",
  primaryMattressHandle: "ZOHO_FIELD_PRIMARY_MATTRESS_HANDLE",
  baseHandle: "ZOHO_FIELD_BASE_HANDLE",
  motionKey: "ZOHO_FIELD_MOTION_KEY",
  leadStage: "ZOHO_FIELD_LEAD_STAGE",
  sourceSurface: "ZOHO_FIELD_SOURCE_SURFACE",
  lastIntent: "ZOHO_FIELD_LAST_INTENT",
  lastInteractionAt: "ZOHO_FIELD_LAST_INTERACTION_AT",
  bookingStatus: "ZOHO_FIELD_BOOKING_STATUS",
  bookingSource: "ZOHO_FIELD_BOOKING_SOURCE",
  bookingStartTime: "ZOHO_FIELD_BOOKING_START_TIME",
  bookingEndTime: "ZOHO_FIELD_BOOKING_END_TIME",
  bookingTimezone: "ZOHO_FIELD_BOOKING_TIMEZONE",
  bookingLocationType: "ZOHO_FIELD_BOOKING_LOCATION_TYPE",
  bookingLocation: "ZOHO_FIELD_BOOKING_LOCATION",
  sessionPrepStatus: "ZOHO_FIELD_SESSION_PREP_STATUS",
  recommendedStartingPod: "ZOHO_FIELD_RECOMMENDED_STARTING_POD",
};

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))];
}

function extractAssessmentAnswers(profile = {}) {
  if (isObject(profile.assessmentAnswers)) return profile.assessmentAnswers;
  if (isObject(profile.answers)) return profile.answers;
  if (isObject(profile.assessment?.answers)) return profile.assessment.answers;
  if (isObject(profile.assessment)) return profile.assessment;
  return null;
}

function setIfPresent(target, key, value) {
  if (!key) return;

  if (value === true || value === false) {
    target[key] = value;
    return;
  }

  if (Array.isArray(value)) {
    const cleaned = uniqueStrings(value);
    if (cleaned.length) target[key] = cleaned;
    return;
  }

  const cleaned = cleanString(value);
  if (cleaned) target[key] = cleaned;
}

function sanitizeZohoFields(fields = {}) {
  const next = {};

  for (const [key, value] of Object.entries(fields)) {
    if (!key) continue;

    if (value === true || value === false) {
      next[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      const cleaned = uniqueStrings(value);
      if (cleaned.length) next[key] = cleaned;
      continue;
    }

    const cleaned = cleanString(value);
    if (cleaned) next[key] = cleaned;
  }

  return next;
}

function buildCustomerProfileZohoFields(profile = {}) {
  const shopperId = cleanString(profile.shopperId);
  const answers = extractAssessmentAnswers(profile);
  const origin = cleanString(profile.sourceSurface || profile.origin) || "customer_profile_sync";
  const fields = {};

  if (shopperId && answers) {
    const snoozeProfile = buildSnoozeProfile({
      shopperId,
      origin,
      answers,
    });

    Object.assign(fields, mapProfileToZohoFields(snoozeProfile) || {});
  }

  setIfPresent(fields, SHOPPER_ID_FIELD, shopperId);
  setIfPresent(fields, "Email", profile.email);
  setIfPresent(fields, "Phone", profile.phone);
  setIfPresent(fields, "First_Name", profile.preferredName);

  for (const [profileKey, envName] of Object.entries(OPTIONAL_PROFILE_FIELD_ENVS)) {
    const zohoFieldApiName = cleanString(process.env[envName]);
    if (!zohoFieldApiName) continue;

    let value = profile[profileKey];
    if (profileKey === "topPodIds" && Array.isArray(value)) {
      value = uniqueStrings(value).join(",");
    }

    setIfPresent(fields, zohoFieldApiName, value);
  }

  return sanitizeZohoFields(fields);
}

function hasMaterialZohoChange(fields = {}) {
  return Object.keys(fields).some((key) => key !== SHOPPER_ID_FIELD);
}

async function syncCustomerProfileToZoho(profile = {}, options = {}) {
  const shopperId = cleanString(profile.shopperId);
  if (!shopperId) {
    return {
      ok: false,
      skipped: true,
      reason: "SHOPPER_ID_REQUIRED",
      operation: null,
      shopperId: null,
      contactId: null,
      code: null,
    };
  }

  if (typeof zoho.hasZohoConfig === "function" && !zoho.hasZohoConfig()) {
    return {
      ok: false,
      skipped: true,
      reason: "ZOHO_NOT_CONFIGURED",
      operation: null,
      shopperId,
      contactId: null,
      code: null,
    };
  }

  const fields = buildCustomerProfileZohoFields(profile);
  if (!hasMaterialZohoChange(fields) && options.force !== true) {
    return {
      ok: false,
      skipped: true,
      reason: "NO_MATERIAL_ZOHO_CHANGE",
      operation: null,
      shopperId,
      contactId: null,
      code: null,
    };
  }

  const result = await zoho.upsertContactByShopperId(shopperId, fields);
  if (!result || result.ok === false || result.skipped) {
    return {
      ok: false,
      skipped: true,
      reason: result?.reason || "ZOHO_SYNC_SKIPPED",
      operation: result?.operation || null,
      shopperId,
      contactId: result?.contactId || null,
      code: result?.code || null,
    };
  }

  return {
    ok: true,
    skipped: false,
    reason: null,
    operation: result.operation || null,
    shopperId,
    contactId: result.contactId || null,
    code: result.code || null,
    duplicateDetected: Boolean(result.duplicateDetected),
    matchCount: Number(result.matchCount || 0),
  };
}

module.exports = {
  buildCustomerProfileZohoFields,
  syncCustomerProfileToZoho,
};
