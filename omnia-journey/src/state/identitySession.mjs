export const SHOPPER_SCOPED_STORAGE_KEYS = Object.freeze([
  "snooze.snapshot",
  "snooze.shopperState",
  "snooze.assessment",
  "snooze.assessmentSummary",
  "snooze.recommendations",
  "snooze.recommendedProducts",
  "snooze.recommendedProductHandles",
  "snooze.snoozepod",
  "snooze.snoozepod.meta",
  "snooze.progress",
  "snooze.xp",
  "snooze.exploreFilters",
  "snooze.exploreItems",
  "snooze.chatTranscript",
  "snooze.lastContext",
  "snooze.mode",
  "snooze.askSnoozer.conversationId",
  "snooze.rewardsIdentityLink.v1",
  "snooze.cartOriginPodId",
]);

export const SHOPPER_SCOPED_STORAGE_PREFIXES = Object.freeze([
  "snooze.assessment.ui.",
  "snooze.pod.",
  "snooze.podBuilder.",
  "snooze.sleepEssentials.",
  "snooze.askSnoozer.",
]);

export function cleanIdentityValue(value) {
  return String(value == null ? "" : value).trim();
}

export function normalizeSnoozeCode(value) {
  const digits = cleanIdentityValue(value).replace(/\D+/g, "");
  return digits.length === 4 || digits.length === 6 ? digits : "";
}

export function normalizeCanonicalIdentity(input = {}, previous = {}) {
  const snoozeCode = normalizeSnoozeCode(
    input.snoozeCode || input.accessCode || input.shopperId
  );
  const shopperId = snoozeCode || cleanIdentityValue(input.shopperId);

  return {
    snoozeCode: snoozeCode || null,
    accessCode: snoozeCode || null,
    shopperId: shopperId || null,
    profileId: cleanIdentityValue(input.profileId) || null,
    sessionId:
      cleanIdentityValue(input.sessionId) || cleanIdentityValue(previous.sessionId) || null,
    threadId:
      cleanIdentityValue(input.threadId) || cleanIdentityValue(previous.threadId) || null,
  };
}

export function didCanonicalShopperChange(previous = {}, next = {}) {
  const previousShopper = normalizeSnoozeCode(
    previous.snoozeCode || previous.accessCode || previous.shopperId
  );
  const nextShopper = normalizeSnoozeCode(
    next.snoozeCode || next.accessCode || next.shopperId
  );
  return Boolean(previousShopper && nextShopper && previousShopper !== nextShopper);
}

function storageKeys(storage) {
  const keys = [];
  try {
    const length = Number(storage?.length || 0);
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
  } catch {
    // Storage can be unavailable in restricted browser modes.
  }
  return keys;
}

export function clearShopperScopedStorage(storage) {
  const removed = [];
  const keys = new Set(SHOPPER_SCOPED_STORAGE_KEYS);

  for (const key of storageKeys(storage)) {
    if (SHOPPER_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      keys.add(key);
    }
  }

  for (const key of keys) {
    try {
      storage?.removeItem?.(key);
      removed.push(key);
    } catch {
      // Keep the confirmed identity even if a best-effort cache cleanup fails.
    }
  }

  return removed;
}
