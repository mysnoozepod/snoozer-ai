"use strict";

const customerProfileService = require("../customerProfile");
const snoozeIdentity = require("../snoozeIdentity");

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function header(headers = {}, name) {
  const match = Object.entries(headers || {}).find(
    ([key]) => key.toLowerCase() === String(name).toLowerCase()
  );
  return match ? clean(match[1]) : "";
}

function parseBody(event = {}) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

function readIdentityInput(event = {}) {
  const body = parseBody(event);
  const query = event.queryStringParameters || {};
  const snoozeCode =
    header(event.headers, "x-snooze-code") ||
    header(event.headers, "x-access-code") ||
    clean(body.snoozeCode || body.accessCode || query.snoozeCode || query.accessCode);
  const sessionId =
    header(event.headers, "x-session-id") ||
    clean(body.sessionId || body.threadId || query.sessionId || query.threadId);
  return {
    snoozeCode,
    accessCode: snoozeCode,
    shopperId: snoozeCode,
    sessionId,
    threadId: sessionId,
  };
}

function identityError(code, message, statusCode = 401) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function getProfileById(profileId, options = {}) {
  const service = options.customerProfileService || customerProfileService;
  const result = await service.getCustomerProfile(
    { profileId },
    options.customerProfileOptions || {}
  );
  return result?.profile || null;
}

async function ownsSessionViaAlias(input = {}, identity = {}, profile = {}, options = {}) {
  const sessionId = clean(input.sessionId);
  if (!sessionId) return false;

  const canonicalProfileId =
    clean(identity.profileId) || clean(profile.profileId) || `shopper#${clean(identity.shopperId)}`;
  const canonicalShopperId =
    clean(identity.shopperId) ||
    clean(profile.shopperId) ||
    clean(profile.snoozeCode) ||
    clean(profile.accessCode);
  const aliasProfileIds = [`alias#session:${sessionId}`, `alias#thread:${sessionId}`];

  for (const aliasProfileId of aliasProfileIds) {
    const aliasProfile = await getProfileById(aliasProfileId, options);
    if (!aliasProfile) continue;

    const aliasProfileOwnerId = clean(aliasProfile.aliasOfProfileId || aliasProfile.mergedIntoProfileId);
    const aliasShopperOwnerId = clean(
      aliasProfile.aliasOfShopperId ||
        aliasProfile.mergedIntoShopperId ||
        aliasProfile.shopperId ||
        aliasProfile.snoozeCode ||
        aliasProfile.accessCode
    );

    if (
      (aliasProfileOwnerId && aliasProfileOwnerId === canonicalProfileId) ||
      (canonicalShopperId && aliasShopperOwnerId === canonicalShopperId)
    ) {
      return true;
    }
  }

  return false;
}

async function resolveRewardsIdentity(event, options = {}) {
  const input = readIdentityInput(event);
  if (!snoozeIdentity.normalizeSnoozeCode(input.snoozeCode)) {
    throw identityError(
      "REWARD_IDENTITY_REQUIRED",
      "A valid Snooze Code is required."
    );
  }
  if (options.requireSession !== false && !input.sessionId) {
    throw identityError(
      "REWARD_SESSION_REQUIRED",
      "An active showroom session is required."
    );
  }

  const identityService = options.snoozeIdentity || snoozeIdentity;
  const identity = await identityService.resolveCanonicalIdentity(input, {
    getProfileById: (profileId) => getProfileById(profileId, options),
  });
  if (
    !identity?.shopperId ||
    identity.isTemporary ||
    !snoozeIdentity.normalizeSnoozeCode(identity.shopperId)
  ) {
    throw identityError(
      "REWARD_CANONICAL_IDENTITY_REQUIRED",
      "A canonical Snooze Profile is required."
    );
  }

  const profileId = clean(identity.profileId) || `shopper#${identity.shopperId}`;
  const profile = await getProfileById(profileId, options);
  if (!profile) {
    throw identityError(
      "REWARD_PROFILE_NOT_FOUND",
      "The Snooze Profile could not be verified.",
      404
    );
  }

  const profileSessionIds = new Set(
    [
      profile.sessionId,
      profile.threadId,
      ...(Array.isArray(profile.sessionIds) ? profile.sessionIds : []),
    ]
      .map(clean)
      .filter(Boolean)
  );
  if (
    options.requireSession !== false &&
    profileSessionIds.size > 0 &&
    !profileSessionIds.has(input.sessionId)
  ) {
    const aliasOwned = await ownsSessionViaAlias(input, identity, profile, options);
    if (!aliasOwned) {
      throw identityError(
        "REWARD_SESSION_MISMATCH",
        "This session does not own the requested reward profile.",
        403
      );
    }
  }

  return {
    shopperId: clean(identity.shopperId),
    snoozeCode: clean(identity.snoozeCode || identity.shopperId),
    accessCode: clean(identity.accessCode || identity.shopperId),
    profileId,
    sessionId: input.sessionId || clean(identity.sessionId),
    identityType: clean(identity.identityType) || "snooze_code",
    profile,
  };
}

function requireInternalRewardsAuth(event = {}, options = {}) {
  const expected = clean(options.internalKey || process.env.REWARDS_INTERNAL_API_KEY);
  const supplied = header(event.headers, "x-rewards-internal-key");
  if (!expected || !supplied || supplied !== expected) {
    throw identityError(
      "REWARD_INTERNAL_AUTH_REQUIRED",
      "Internal reward authentication failed.",
      403
    );
  }
  return true;
}

module.exports = {
  header,
  identityError,
  parseBody,
  readIdentityInput,
  requireInternalRewardsAuth,
  resolveRewardsIdentity,
};
