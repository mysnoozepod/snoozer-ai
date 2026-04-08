// services/snoozeProfileMapper.js
//
// Legacy-style helper to build Zoho CRM "Contacts" fields
// for the Snooze Profile section from a Snooze Assessment.
//
// This is now a thin wrapper around the canonical Snooze Profile
// builder + Zoho field mapper in services/snoozeProfile.js so
// there is only ONE source of truth for field names / logic.
//
// Expected assessment structure (Dynamo record or raw answers object):
// {
//   shopperId: "abc123",           // optional here
//   origin: "welcome_zone",        // optional
//   answers: {
//     size: "Queen",
//     motionMode: "Standard Motion (one mattress, moves together)",
//     sleepPartner: "Mostly with a partner",
//     sleepPosition: "Side",
//     partnerSleepPosition: "Back",
//     temperature: "Hot",
//     partnerTemperature: "Neutral",
//     firmness: "Medium",
//     partnerFirmness: "Firm",
//     motionSensitivity: "Very sensitive",
//     partnerMotionSensitivity: "Not very sensitive",
//     painPoints: ["Lower back", "Shoulders"],
//     partnerPainPoints: ["Snoring"],
//     budget: "Under $1,500",
//     snore: "Yes",
//     partnerSnore: "Yes"
//   }
// }

const {
  buildSnoozeProfile,
  mapProfileToZohoFields,
} = require("./snoozeProfile");

function extractAnswers(assessment) {
  if (!assessment || typeof assessment !== "object") return {};
  if (assessment.answers && typeof assessment.answers === "object") {
    return assessment.answers;
  }
  return assessment;
}

/**
 * Build a Zoho CRM Contacts payload fragment for the Snooze Profile
 * using the canonical SnoozeProfile + Zoho mapping.
 *
 * @param {object} assessment - Dynamo assessment item or answers object
 * @returns {object} fields - { Sleep_Position: "...", Firmness_Preference: "...", ... }
 */
function buildSnoozeProfileFields(assessment) {
  if (!assessment || typeof assessment !== "object") return {};

  const answers = extractAnswers(assessment);

  const shopperId =
    assessment.shopperId ||
    assessment.shopper_id ||
    null;

  const origin = assessment.origin || "assessment_mapper";

  // 1) Build the canonical internal SnoozeProfile
  const profile = buildSnoozeProfile({
    shopperId,
    origin,
    answers,
  });

  // 2) Map to Zoho Contact field API names
  return mapProfileToZohoFields(profile) || {};
}

module.exports = {
  buildSnoozeProfileFields,
};

