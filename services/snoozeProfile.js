// services/snoozeProfile.js
//
// Canonical Snooze Profile builder + Zoho field mapper.
// PRIMARY GOAL: never send Zoho invalid types/values.
//
// Aligned to your assessment JSON.
// Assumes BOTH Pain_Points and Partner_Pain_Points are Zoho Multi-Select fields
// (jsonarray / multiselectpicklist), so we send arrays of strings.

function normString(v) {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function isNotSure(v) {
  const s = normString(v).toLowerCase();
  return (
    s === "not sure" ||
    s === "not sure yet" ||
    s === "unsure" ||
    s === "unknown" ||
    s === "n/a"
  );
}

function toZohoBoolean(v) {
  if (v == null) return null;
  if (v === true || v === false) return v;

  const s = normString(v).toLowerCase();
  if (!s || isNotSure(s)) return null;

  if (["yes", "true", "y", "1"].includes(s)) return true;
  if (["no", "false", "n", "0"].includes(s)) return false;

  return null;
}

function normalizePicklist(value, allowed = [], aliases = {}) {
  const raw = normString(value);
  if (!raw || isNotSure(raw)) return null;

  const mapped = aliases[raw] || aliases[raw.toLowerCase()] || raw;

  if (!allowed || allowed.length === 0) return mapped;

  if (allowed.includes(mapped)) return mapped;

  const hit = allowed.find((a) => a.toLowerCase() === String(mapped).toLowerCase());
  return hit || null;
}

function normalizeMultiSelect(value, allowed = [], aliases = {}) {
  const arr = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",").map((s) => s.trim()).filter(Boolean)
      : value == null
        ? []
        : [String(value)].map((s) => s.trim()).filter(Boolean);

  const cleaned = [];
  const seen = new Set();

  for (const item of arr) {
    if (!item) continue;
    if (isNotSure(item)) continue;

    const mapped = aliases[item] || aliases[item.toLowerCase()] || item;

    let finalItem = mapped;

    if (allowed && allowed.length > 0) {
      if (allowed.includes(mapped)) {
        finalItem = mapped;
      } else {
        const hit = allowed.find((a) => a.toLowerCase() === String(mapped).toLowerCase());
        finalItem = hit || null;
      }
    }

    if (!finalItem) continue;

    const key = String(finalItem).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(finalItem);
    }
  }

  return cleaned.length ? cleaned : null;
}

// ─────────────────────────────────────────────
// Zoho field API names
// ─────────────────────────────────────────────

// IMPORTANT:
// zoho.js uses ZOHO_CONTACT_KEY_FIELD to decide which field is the "Shopper ID" key.
// If that env var changes, we must match it here too, otherwise Zoho can reject
// the payload with INVALID_DATA.
const SHOPPER_ID_FIELD_API =
  process.env.ZOHO_CONTACT_KEY_FIELD || "Snoozer_Shopper_ID";

const ZOHO_FIELDS = {
  Snoozer_Shopper_ID: SHOPPER_ID_FIELD_API,

  Size_Preference: "Size_Preference",
  Motion_Preference: "Motion_Preference",
  Sleep_Partner: "Sleep_Partner",

  Sleep_Position: "Sleep_Position",
  Partner_Sleep_Position: "Partner_Sleep_Position",

  Motion_Sensitivity: "Motion_Sensitivity",
  Partner_Motion_Sensitivity: "Partner_Motion_Sensitivity",

  Temperature_Sensitivity: "Temperature_Sensitivity",
  Partner_Temperature_Sensitivity: "Partner_Temperature_Sensitivity",

  Firmness_Preference: "Firmness_Preference",
  Partner_Firmness_Preference: "Partner_Firmness_Preference",

  Snore: "Snore",
  Partner_Snore: "Partner_Snore",

  Pain_Points: "Pain_Points",
  Partner_Pain_Points: "Partner_Pain_Points",

  Budget: "Budget",
};

// ─────────────────────────────────────────────
// Allowed values (aligned to your assessment JSON)
// ─────────────────────────────────────────────

const ZOHO_ALLOWED = {
  Size_Preference: ["Twin", "Full", "Queen", "King"],

  Motion_Preference: [
    "Standard Motion",
    "Half Split Motion",
    "Full Split Motion",
    "No Motion",
  ],

  Sleep_Partner: ["Yes", "No"],

  Sleep_Position: ["Side", "Back", "Stomach", "Mix / Combination"],
  Partner_Sleep_Position: ["Side", "Back", "Stomach", "Mix / Combination"],

  Motion_Sensitivity: [
    "Low — movement rarely bothers me",
    "Medium — I notice it but can deal with it",
    "High — I wake up easily from movement",
  ],
  Partner_Motion_Sensitivity: [
    "Low — movement rarely bothers them",
    "Medium — they notice it but can deal with it",
    "High — they wake up easily from movement",
  ],

  Temperature_Sensitivity: ["Hot", "Cold", "Neutral"],
  Partner_Temperature_Sensitivity: ["Hot", "Cold", "Neutral"],

  Firmness_Preference: ["Soft", "Medium", "Firm"],
  Partner_Firmness_Preference: ["Soft", "Medium", "Firm"],

  Budget: ["Under $1,500", "$1,500–$2,500", "$2,500–$3,500", "Over $3,500"],

  Pain_Points: [
    "Lower back",
    "Upper back",
    "Hips",
    "Shoulders",
    "Neck",
    "Sciatica",
    "General pressure relief",
    "Other / not listed",
  ],
  Partner_Pain_Points: [
    "Lower back",
    "Upper back",
    "Hips",
    "Shoulders",
    "Neck",
    "Sciatica",
    "General pressure relief",
    "Other / not listed",
  ],
};

const ALIASES = {
  Motion_Preference: {
    "Standard Motion (one mattress, moves together)": "Standard Motion",
    "Standard Motion (one mattress and base that move together)": "Standard Motion",
    "Half Split Motion (head can move separately while feet stay in sync)":
      "Half Split Motion",
    "Full Split Motion (head and feet move separately on each side, available in King setups)":
      "Full Split Motion",
    "No Motion (standard platform or mattress only)": "No Motion",
    "Split Motion": "Full Split Motion",
  },
  Sleep_Partner: {
    "Mostly with a partner": "Yes",
    "Sometimes with a partner": "Yes",
    "Always with a partner": "Yes",
    "Solo": "No",
    "Mostly solo": "No",
  },
};

function extractAnswers(answers = {}) {
  return {
    size: answers.size,
    motionMode: answers.motionMode,

    sleepPartner: answers.sleepPartner ?? answers.partner,

    sleepPosition: answers.sleepPosition,
    partnerSleepPosition: answers.partnerSleepPosition,

    motionSensitivity: answers.motionSensitivity,
    partnerMotionSensitivity: answers.partnerMotionSensitivity,

    temperature: answers.temperature,
    partnerTemperature: answers.partnerTemperature,

    firmness: answers.firmness,
    partnerFirmness: answers.partnerFirmness,

    snore: answers.snore,
    partnerSnore: answers.partnerSnore,

    painPoints: answers.painPoints,
    partnerPainPoints: answers.partnerPainPoints,

    budget: answers.budget,
  };
}

function buildSnoozeProfile({ shopperId, origin = "unknown", answers = {} }) {
  const a = extractAnswers(answers || {});
  const now = new Date().toISOString();

  const sizePreference = normalizePicklist(a.size, ZOHO_ALLOWED.Size_Preference);

  const motionPreference = normalizePicklist(
    a.motionMode,
    ZOHO_ALLOWED.Motion_Preference,
    ALIASES.Motion_Preference
  );

  const sleepPartner = normalizePicklist(
    ALIASES.Sleep_Partner[normString(a.sleepPartner)] ?? a.sleepPartner,
    ZOHO_ALLOWED.Sleep_Partner,
    ALIASES.Sleep_Partner
  );

  const sleepPosition = normalizePicklist(a.sleepPosition, ZOHO_ALLOWED.Sleep_Position);

  const partnerSleepPosition = normalizePicklist(
    a.partnerSleepPosition,
    ZOHO_ALLOWED.Partner_Sleep_Position
  );

  const motionSensitivity = normalizePicklist(
    a.motionSensitivity,
    ZOHO_ALLOWED.Motion_Sensitivity
  );

  const partnerMotionSensitivity = normalizePicklist(
    a.partnerMotionSensitivity,
    ZOHO_ALLOWED.Partner_Motion_Sensitivity
  );

  const temperatureSensitivity = normalizePicklist(
    a.temperature,
    ZOHO_ALLOWED.Temperature_Sensitivity
  );

  const partnerTemperatureSensitivity = normalizePicklist(
    a.partnerTemperature,
    ZOHO_ALLOWED.Partner_Temperature_Sensitivity
  );

  const firmnessPreference = normalizePicklist(a.firmness, ZOHO_ALLOWED.Firmness_Preference);

  const partnerFirmnessPreference = normalizePicklist(
    a.partnerFirmness,
    ZOHO_ALLOWED.Partner_Firmness_Preference
  );

  const snore = toZohoBoolean(a.snore);
  const partnerSnore = toZohoBoolean(a.partnerSnore);

  const painPoints = normalizeMultiSelect(a.painPoints, ZOHO_ALLOWED.Pain_Points);

  const partnerPainPoints = normalizeMultiSelect(
    a.partnerPainPoints,
    ZOHO_ALLOWED.Partner_Pain_Points
  );

  const budgetRange = isNotSure(a.budget)
    ? null
    : normalizePicklist(a.budget, ZOHO_ALLOWED.Budget);

  return {
    shopperId: shopperId || null,
    origin,

    sizePreference,
    motionPreference,
    sleepPartner,

    sleepPosition,
    partnerSleepPosition,

    motionSensitivity,
    partnerMotionSensitivity,

    temperatureSensitivity,
    partnerTemperatureSensitivity,

    firmnessPreference,
    partnerFirmnessPreference,

    snore,
    partnerSnore,

    painPoints,
    partnerPainPoints,

    budgetRange,

    meta: { createdAt: now, updatedAt: now },
  };
}

function mapProfileToZohoFields(profile) {
  if (!profile) return {};

  const out = {};

  const setIf = (apiName, value) => {
    if (!apiName) return;

    if (value === true || value === false) {
      out[apiName] = value;
      return;
    }

    if (Array.isArray(value)) {
      if (value.length) out[apiName] = value;
      return;
    }

    const s = normString(value);
    if (s) out[apiName] = s;
  };

  // IMPORTANT: keep this aligned to env override for Zoho key field
  setIf(ZOHO_FIELDS.Snoozer_Shopper_ID, profile.shopperId);

  setIf(ZOHO_FIELDS.Size_Preference, profile.sizePreference);
  setIf(ZOHO_FIELDS.Motion_Preference, profile.motionPreference);
  setIf(ZOHO_FIELDS.Sleep_Partner, profile.sleepPartner);

  setIf(ZOHO_FIELDS.Sleep_Position, profile.sleepPosition);
  setIf(ZOHO_FIELDS.Partner_Sleep_Position, profile.partnerSleepPosition);

  setIf(ZOHO_FIELDS.Motion_Sensitivity, profile.motionSensitivity);
  setIf(ZOHO_FIELDS.Partner_Motion_Sensitivity, profile.partnerMotionSensitivity);

  setIf(ZOHO_FIELDS.Temperature_Sensitivity, profile.temperatureSensitivity);
  setIf(ZOHO_FIELDS.Partner_Temperature_Sensitivity, profile.partnerTemperatureSensitivity);

  setIf(ZOHO_FIELDS.Firmness_Preference, profile.firmnessPreference);
  setIf(ZOHO_FIELDS.Partner_Firmness_Preference, profile.partnerFirmnessPreference);

  setIf(ZOHO_FIELDS.Budget, profile.budgetRange);

  setIf(ZOHO_FIELDS.Snore, profile.snore);
  setIf(ZOHO_FIELDS.Partner_Snore, profile.partnerSnore);

  setIf(ZOHO_FIELDS.Pain_Points, profile.painPoints);
  setIf(ZOHO_FIELDS.Partner_Pain_Points, profile.partnerPainPoints);

  return out;
}

module.exports = {
  buildSnoozeProfile,
  mapProfileToZohoFields,
};

