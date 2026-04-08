// handlers/getAssessmentSnapshot.js
//
// GET /assessment/{shopperId}
// Returns Zoho Snooze Profile snapshot + computed shopperState.
// Assumes Zoho Contact is keyed by Snoozer_Shopper_ID.
//
// shopperState:
// - NEW        => no Zoho contact, no Dynamo assessment
// - ASSESSED   => Dynamo has assessment, Zoho contact missing (rare, but possible)
// - KNOWN      => Zoho contact exists, but profile fields empty
// - PROFILED   => Zoho contact exists and has meaningful profile values

const { findContactByShopperId } = require("../services/zoho");

// Keep the returned profile tight. Only send what the UI needs.
const PROFILE_FIELDS = [
  "Snoozer_Shopper_ID",
  "Size_Preference",
  "Motion_Preference",
  "Sleep_Partner",
  "Sleep_Position",
  "Partner_Sleep_Position",
  "Motion_Sensitivity",
  "Partner_Motion_Sensitivity",
  "Temperature_Sensitivity",
  "Partner_Temperature_Sensitivity",
  "Firmness_Preference",
  "Partner_Firmness_Preference",
  "Budget",
  "Snore",
  "Partner_Snore",
  "Pain_Points",
  "Partner_Pain_Points",
];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

function isNonEmptyValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "boolean") return true; // explicit yes/no is meaningful
  if (typeof v === "number") return true;
  return !!v;
}

function hasAnyProfileData(profile) {
  if (!profile) return false;

  for (const [k, v] of Object.entries(profile)) {
    if (k === "Snoozer_Shopper_ID") continue;
    if (isNonEmptyValue(v)) return true;
  }
  return false;
}

function computeShopperState({ hasZohoContact, hasAssessment, profile }) {
  if (hasZohoContact && hasAnyProfileData(profile)) return "PROFILED";
  if (hasZohoContact) return "KNOWN";
  if (hasAssessment) return "ASSESSED";
  return "NEW";
}

/**
 * getAssessmentSnapshot(shopperId, opts)
 * opts:
 *  - assessment: optional Dynamo result, passed in by index.js if you want
 *  - includeAssessment: boolean
 */
async function getAssessmentSnapshot(shopperId, opts = {}) {
  const id = String(shopperId || "").trim();
  if (!id) {
    return {
      statusCode: 400,
      body: { ok: false, error: "shopperId is required" },
    };
  }

  // Optional Dynamo assessment object (index.js can pass it in)
  const assessment = opts.assessment || null;
  const hasAssessment = !!assessment;

  // Zoho lookup
  let contact = null;
  try {
    contact = await findContactByShopperId(id);
  } catch (e) {
    // Don’t fail the endpoint because Zoho is being Zoho.
    contact = null;
  }

  const hasZohoContact = !!(contact && contact.id);
  const profile = hasZohoContact ? pick(contact, PROFILE_FIELDS) : null;

  const shopperState = computeShopperState({
    hasZohoContact,
    hasAssessment,
    profile,
  });

  const canViewResults = shopperState !== "NEW";

  return {
    statusCode: 200,
    body: {
      ok: true,
      shopperId: id,
      exists: hasZohoContact || hasAssessment,
      shopperState,

      profile: profile || null,

      // Keep assessment minimal if provided
      assessment: assessment
        ? {
            answers: assessment.answers || assessment,
            updatedAt: assessment.updatedAt || null,
          }
        : null,

      meta: {
        zohoContactId: contact?.id || null,
        zohoModifiedTime: contact?.Modified_Time || null,
      },

      actions: {
        canViewResults,
        canRetakeAssessment: true,
        shouldPromptAssessment: shopperState === "NEW",
      },
    },
  };
}

module.exports = { getAssessmentSnapshot };
