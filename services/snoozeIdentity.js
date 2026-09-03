const crypto = require("crypto");

const QUALIFYING_REASONS = Object.freeze([
  "assessment_completed",
  "save_results",
  "rewards_signup",
  "showroom_walkin",
  "booking_started",
  "manual_create",
]);

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeKey(value) {
  return cleanString(value).toLowerCase();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))];
}

function digitsOnly(value) {
  return cleanString(value).replace(/\D+/g, "");
}

function normalizeSnoozeCode(value) {
  const digits = digitsOnly(value);
  if (digits.length === 4 || digits.length === 6) return digits;
  return "";
}

function isLikelySnoozeCode(value) {
  return Boolean(normalizeSnoozeCode(value));
}

function isGeneratedShopifyAssessmentId(value) {
  const normalized = normalizeKey(value);
  return (
    normalized.startsWith("shopify-assessment-template--") ||
    normalized.startsWith("shopify-assessment-")
  );
}

function isStableAccessStyleShopperId(value) {
  return isLikelySnoozeCode(value);
}

function firstCodeCandidate(candidates = []) {
  for (const candidate of candidates) {
    const normalized = normalizeSnoozeCode(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function canonicalShopperIdFromProfile(profile = {}) {
  return firstCodeCandidate([
    profile?.snoozeCode,
    profile?.accessCode,
    profile?.shopperId,
    profile?.mergedIntoShopperId,
    profile?.aliasOfShopperId,
    profile?.sourceShopperId,
  ]);
}

function buildIdentityAliases(input = {}, options = {}) {
  const canonicalShopperId = cleanString(options.canonicalShopperId);
  const aliases = []
    .concat(input?.sourceShopperId)
    .concat(Array.isArray(input?.previousShopperIds) ? input.previousShopperIds : [])
    .concat(
      Array.isArray(input?.aliases)
        ? input.aliases
        : input?.aliases && typeof input.aliases === "object"
          ? Object.values(input.aliases)
          : []
    )
    .concat(input?.shopperId)
    .concat(input?.visitorId)
    .concat(input?.sessionId)
    .concat(input?.threadId);

  return uniqueStrings(aliases).filter((value) => {
    if (value === canonicalShopperId) return false;
    // A different valid Snooze Code is another customer, never an alias.
    if (canonicalShopperId && isStableAccessStyleShopperId(value)) return false;
    return true;
  });
}

function safeSourceShopperId(value, canonicalShopperId) {
  const source = cleanString(value);
  if (!source || source === canonicalShopperId) return "";
  if (isStableAccessStyleShopperId(source)) return "";
  return source;
}

function buildAliasProfilePatches(identity = {}, input = {}) {
  const canonicalShopperId = cleanString(identity?.shopperId);
  if (!canonicalShopperId || !isStableAccessStyleShopperId(canonicalShopperId)) return [];

  const canonicalProfileId = getProfileIdForIdentity(identity);
  const basePatch = {
    shopperId: canonicalShopperId,
    snoozeCode: cleanString(identity?.snoozeCode) || canonicalShopperId,
    accessCode: cleanString(identity?.accessCode) || canonicalShopperId,
    identityType: "identity_alias",
    identitySource: cleanString(identity?.identitySource) || "alias_map",
    isTemporary: false,
    sourceShopperId: cleanString(identity?.sourceShopperId) || undefined,
    aliasOfShopperId: canonicalShopperId,
    aliasOfProfileId: canonicalProfileId,
    sourceSurface: cleanString(input?.sourceSurface || input?.origin) || undefined,
    leadStage: cleanString(input?.leadStage) || undefined,
    lastIntent: cleanString(input?.lastIntent) || undefined,
    lastInteractionAt: cleanString(input?.lastInteractionAt) || undefined,
  };

  const aliasEntries = [];
  const pushAlias = (kind, rawValue) => {
    const value = cleanString(rawValue);
    if (!value || value === canonicalShopperId) return;
    aliasEntries.push({
      profileId: `alias#${kind}:${value}`,
      aliasKind: kind,
      aliasValue: value,
    });
  };

  pushAlias("shopper", input?.sourceShopperId);
  (Array.isArray(input?.previousShopperIds) ? input.previousShopperIds : []).forEach((value) =>
    pushAlias("shopper", value)
  );
  pushAlias("visitor", input?.visitorId);
  pushAlias("session", input?.sessionId);
  pushAlias("thread", input?.threadId);

  return aliasEntries
    .filter((entry, index, collection) => {
      return collection.findIndex((candidate) => candidate.profileId === entry.profileId) === index;
    })
    .map((entry) => ({ ...basePatch, ...entry }));
}

function getProfileIdForIdentity(identity = {}) {
  const explicitProfileId = cleanString(identity?.profileId);
  if (explicitProfileId) return explicitProfileId;

  const shopperId = cleanString(identity?.shopperId);
  if (shopperId) return `shopper#${shopperId}`;

  const sessionId = cleanString(identity?.sessionId || identity?.threadId);
  if (sessionId) return `session#${sessionId}`;

  return "";
}

async function readProfileById(profileId = "", options = {}) {
  const normalizedProfileId = cleanString(profileId);
  if (!normalizedProfileId || typeof options.getProfileById !== "function") return null;
  try {
    return await options.getProfileById(normalizedProfileId);
  } catch {
    return null;
  }
}

function buildResolvedIdentity({
  shopperId = "",
  snoozeCode = "",
  accessCode = "",
  profileId = "",
  identityType = "",
  identitySource = "",
  isTemporary = false,
  sourceShopperId = "",
  aliases = [],
  sessionId = "",
  threadId = "",
  visitorId = "",
} = {}) {
  const normalizedShopperId = cleanString(shopperId);
  const normalizedSnoozeCode = cleanString(snoozeCode);
  const normalizedAccessCode = cleanString(accessCode);
  return {
    shopperId: normalizedShopperId || null,
    snoozeCode: normalizedSnoozeCode || null,
    accessCode: normalizedAccessCode || null,
    profileId: cleanString(profileId || getProfileIdForIdentity({ shopperId: normalizedShopperId, sessionId, threadId })) || null,
    identityType: cleanString(identityType) || (isTemporary ? "temporary" : "snooze_code"),
    identitySource: cleanString(identitySource) || null,
    isTemporary: Boolean(isTemporary),
    sourceShopperId: cleanString(sourceShopperId) || null,
    aliases: buildIdentityAliases(
      {
        sourceShopperId,
        aliases,
        visitorId,
        sessionId,
        threadId,
      },
      { canonicalShopperId: normalizedShopperId }
    ),
    sessionId: cleanString(sessionId) || null,
    threadId: cleanString(threadId) || null,
    visitorId: cleanString(visitorId) || null,
  };
}

async function resolveCanonicalIdentity(input = {}, options = {}) {
  const context = input?.context && typeof input.context === "object" ? input.context : {};
  const sessionId = cleanString(input?.sessionId || input?.threadId || context?.sessionId);
  const threadId = cleanString(input?.threadId || input?.sessionId || context?.threadId || sessionId);
  const visitorId = cleanString(input?.visitorId || context?.visitorId);
  const directShopperId = cleanString(input?.shopperId);
  const contextShopperId = cleanString(context?.shopperId);
  const sourceShopperId = cleanString(input?.sourceShopperId);

  const canonicalCode = firstCodeCandidate([
    input?.snoozeCode,
    input?.accessCode,
    directShopperId,
    context?.snoozeCode,
    context?.accessCode,
    contextShopperId,
  ]);

  if (canonicalCode) {
    const identitySource =
      normalizeSnoozeCode(input?.snoozeCode) === canonicalCode
        ? "snoozeCode"
        : normalizeSnoozeCode(input?.accessCode) === canonicalCode
          ? "accessCode"
          : normalizeSnoozeCode(directShopperId) === canonicalCode
            ? "shopperId"
            : normalizeSnoozeCode(context?.snoozeCode) === canonicalCode
              ? "context.snoozeCode"
              : normalizeSnoozeCode(context?.accessCode) === canonicalCode
                ? "context.accessCode"
                : "context.shopperId";

    return buildResolvedIdentity({
      shopperId: canonicalCode,
      snoozeCode: canonicalCode,
      accessCode: canonicalCode,
      identityType: "snooze_code",
      identitySource,
      isTemporary: false,
      sourceShopperId:
        safeSourceShopperId(sourceShopperId, canonicalCode) ||
        safeSourceShopperId(directShopperId, canonicalCode),
      aliases: buildIdentityAliases(
        {
          sourceShopperId,
          shopperId: directShopperId !== canonicalCode ? directShopperId : "",
          visitorId,
          sessionId,
          threadId,
        },
        { canonicalShopperId: canonicalCode }
      ),
      sessionId,
      threadId,
      visitorId,
    });
  }

  const aliasProfileIds = uniqueStrings([
    sourceShopperId ? `alias#shopper:${sourceShopperId}` : "",
    directShopperId ? `alias#shopper:${directShopperId}` : "",
    visitorId ? `alias#visitor:${visitorId}` : "",
    sessionId ? `alias#session:${sessionId}` : "",
    threadId ? `alias#thread:${threadId}` : "",
    sessionId ? `session#${sessionId}` : "",
    threadId ? `session#${threadId}` : "",
  ]);

  for (const profileId of aliasProfileIds) {
    const profile = await readProfileById(profileId, options);
    const canonicalFromProfile = canonicalShopperIdFromProfile(profile);
    if (!canonicalFromProfile) continue;

    return buildResolvedIdentity({
      shopperId: canonicalFromProfile,
      snoozeCode: canonicalFromProfile,
      accessCode: canonicalFromProfile,
      identityType: "snooze_code",
      identitySource: profileId.startsWith("alias#") ? "stored_alias" : "stored_session",
      isTemporary: false,
      sourceShopperId: cleanString(sourceShopperId || directShopperId),
      aliases: buildIdentityAliases(
        {
          sourceShopperId,
          shopperId: directShopperId,
          visitorId,
          sessionId,
          threadId,
          previousShopperIds: Array.isArray(profile?.previousShopperIds)
            ? profile.previousShopperIds
            : [],
        },
        { canonicalShopperId: canonicalFromProfile }
      ),
      sessionId,
      threadId,
      visitorId,
    });
  }

  if (directShopperId) {
    if (isGeneratedShopifyAssessmentId(directShopperId)) {
      return buildResolvedIdentity({
        shopperId: directShopperId,
        identityType: "temporary_shopify_assessment",
        identitySource: "generated_shopify_assessment_id",
        isTemporary: true,
        sourceShopperId: sourceShopperId || directShopperId,
        aliases: buildIdentityAliases({ sourceShopperId, visitorId, sessionId, threadId }),
        sessionId,
        threadId,
        visitorId,
      });
    }

    return buildResolvedIdentity({
      shopperId: directShopperId,
      identityType: "temporary_shopper_id",
      identitySource: "shopperId",
      isTemporary: true,
      sourceShopperId: sourceShopperId || directShopperId,
      aliases: buildIdentityAliases({ sourceShopperId, visitorId, sessionId, threadId }),
      sessionId,
      threadId,
      visitorId,
    });
  }

  if (sessionId || threadId) {
    return buildResolvedIdentity({
      shopperId: "",
      identityType: "session",
      identitySource: sessionId ? "sessionId" : "threadId",
      isTemporary: true,
      sourceShopperId: sourceShopperId || "",
      aliases: buildIdentityAliases({ sourceShopperId, visitorId, sessionId, threadId }),
      sessionId,
      threadId,
      visitorId,
    });
  }

  return buildResolvedIdentity({
    shopperId: "",
    identityType: "anonymous",
    identitySource: "none",
    isTemporary: true,
    sourceShopperId: sourceShopperId || "",
    aliases: buildIdentityAliases({ sourceShopperId, visitorId }),
    visitorId,
  });
}

function shouldIssueSnoozeCode(input = {}) {
  const reason = normalizeKey(input?.reason);
  if (!QUALIFYING_REASONS.includes(reason)) return false;

  const identity = input?.identity && typeof input.identity === "object" ? input.identity : null;
  const existingCode = firstCodeCandidate([
    identity?.snoozeCode,
    identity?.accessCode,
    identity?.shopperId,
    input?.snoozeCode,
    input?.accessCode,
    input?.shopperId,
  ]);

  return !existingCode;
}

async function generateSnoozeCode(options = {}) {
  const maxAttempts = Math.max(10, Number(options.maxAttempts || 40));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const nextCode = String(crypto.randomInt(0, 1000000)).padStart(6, "0");

    if (typeof options.isCodeAvailable === "function") {
      const available = await options.isCodeAvailable(nextCode);
      if (available) return nextCode;
      continue;
    }

    if (typeof options.getProfileById === "function") {
      const existing = await readProfileById(`shopper#${nextCode}`, options);
      if (!existing) return nextCode;
      continue;
    }

    return nextCode;
  }

  throw new Error("SNOOZE_CODE_GENERATION_FAILED");
}

async function issueSnoozeCode(input = {}, options = {}) {
  const existingIdentity =
    input?.identity && typeof input.identity === "object"
      ? input.identity
      : await resolveCanonicalIdentity(input, options);

  if (
    existingIdentity &&
    !existingIdentity.isTemporary &&
    isStableAccessStyleShopperId(existingIdentity.shopperId)
  ) {
    return {
      ...existingIdentity,
      isNewCode: false,
      message: "Snooze Code ready.",
    };
  }

  if (!shouldIssueSnoozeCode({ ...input, identity: existingIdentity })) {
    return {
      ...existingIdentity,
      isNewCode: false,
      skipped: true,
      reason: "SNOOZE_CODE_NOT_QUALIFIED",
      message: "Snooze Code not issued.",
    };
  }

  const snoozeCode = await generateSnoozeCode(options);
  const sourceShopperId =
    cleanString(input?.sourceShopperId) ||
    cleanString(existingIdentity?.sourceShopperId) ||
    (existingIdentity?.isTemporary ? cleanString(existingIdentity?.shopperId) : "") ||
    cleanString(input?.shopperId);

  return {
    ...buildResolvedIdentity({
      shopperId: snoozeCode,
      snoozeCode,
      accessCode: snoozeCode,
      identityType: "snooze_code",
      identitySource: cleanString(input?.reason) || "issued",
      isTemporary: false,
      sourceShopperId,
      aliases: buildIdentityAliases(
        {
          sourceShopperId,
          previousShopperIds: Array.isArray(input?.previousShopperIds)
            ? input.previousShopperIds
            : [],
          visitorId: input?.visitorId || existingIdentity?.visitorId,
          sessionId: input?.sessionId || existingIdentity?.sessionId,
          threadId: input?.threadId || existingIdentity?.threadId,
        },
        { canonicalShopperId: snoozeCode }
      ),
      sessionId: input?.sessionId || existingIdentity?.sessionId,
      threadId: input?.threadId || existingIdentity?.threadId,
      visitorId: input?.visitorId || existingIdentity?.visitorId,
    }),
    isNewCode: true,
    message: "Snooze Code issued.",
  };
}

module.exports = {
  buildAliasProfilePatches,
  buildIdentityAliases,
  generateSnoozeCode,
  getProfileIdForIdentity,
  isGeneratedShopifyAssessmentId,
  isLikelySnoozeCode,
  issueSnoozeCode,
  normalizeSnoozeCode,
  resolveCanonicalIdentity,
  shouldIssueSnoozeCode,
};
