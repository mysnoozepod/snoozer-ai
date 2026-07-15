import { DEVICE_MODES, DEVICE_STATUSES } from "./deviceModes.js";
import { makePodRoute } from "./podRouteUtils.js";

export const DEVICE_RESET_STATUSES = Object.freeze({
  ACTIVE: "active",
  WARNING: "warning",
  PENDING: "pending",
  RESETTING: "resetting",
  DISABLED: "disabled",
});

export const CHECKOUT_ABANDONMENT_MESSAGE =
  "Your selections have been saved. Continue whenever you're ready.";

const MINUTE = 60 * 1000;

const TRANSIENT_KEYS = Object.freeze({
  welcome: [
    "snooze.assessment",
    "snooze.assessmentSummary",
    "snooze.recommendations",
    "snooze.recommendedProducts",
    "snooze.recommendedProductHandles",
  ],
  askSnoozer: [
    "snooze.askSnoozer.conversationId",
    "snooze.chatTranscript",
    "snooze.lastContext",
    "snooze.mode",
  ],
  sleepEssentials: ["snooze.sleepEssentials.state"],
});

const TRANSIENT_PREFIXES = Object.freeze({
  pod: ["snooze.pod.", "snooze.podBuilder."],
  welcome: ["snooze.assessment.ui."],
  askSnoozer: ["snooze.askSnoozer."],
  sleepEssentials: ["snooze.sleepEssentials."],
});

export const DEVICE_RESET_POLICIES = Object.freeze({
  [DEVICE_MODES.WELCOME_KIOSK]: Object.freeze({
    policyId: "welcome",
    timeoutMs: 5 * MINUTE,
    warningMs: null,
    abandonmentMs: null,
    defaultRoute: "/welcome",
    resetKeys: TRANSIENT_KEYS.welcome,
    resetPrefixes: TRANSIENT_PREFIXES.welcome,
    blockerReasons: ["assessmentSubmission", "qrFlow"],
    preserve: ["snoozeCode", "analytics"],
  }),
  [DEVICE_MODES.POD_IPAD]: Object.freeze({
    policyId: "pod",
    timeoutMs: 15 * MINUTE,
    warningMs: null,
    abandonmentMs: null,
    defaultRoute: null,
    resetKeys: [],
    resetPrefixes: TRANSIENT_PREFIXES.pod,
    blockerReasons: ["tts", "cartMutation"],
    preserve: ["cart", "cartId", "checkoutUrl", "snoozeCode", "shopperIdentity"],
  }),
  [DEVICE_MODES.ASK_SNOOZER_KIOSK]: Object.freeze({
    policyId: "askSnoozer",
    timeoutMs: 5 * MINUTE,
    warningMs: null,
    abandonmentMs: null,
    defaultRoute: "/ask-snoozer",
    resetKeys: TRANSIENT_KEYS.askSnoozer,
    resetPrefixes: TRANSIENT_PREFIXES.askSnoozer,
    blockerReasons: ["activeResponse", "tts", "humanHelp"],
    preserve: ["analytics"],
  }),
  [DEVICE_MODES.SLEEP_ESSENTIALS_KIOSK]: Object.freeze({
    policyId: "sleepEssentials",
    timeoutMs: 8 * MINUTE,
    warningMs: null,
    abandonmentMs: null,
    defaultRoute: "/sleep-essentials",
    resetKeys: TRANSIENT_KEYS.sleepEssentials,
    resetPrefixes: TRANSIENT_PREFIXES.sleepEssentials,
    blockerReasons: ["cartMutation"],
    preserve: ["cart", "cartId", "checkoutUrl", "snoozeCode", "shopperIdentity"],
  }),
  [DEVICE_MODES.CHECKOUT_KIOSK]: Object.freeze({
    policyId: "checkout",
    timeoutMs: null,
    warningMs: 15 * MINUTE,
    abandonmentMs: 30 * MINUTE,
    defaultRoute: "/cart",
    resetKeys: [],
    resetPrefixes: [],
    blockerReasons: [],
    preserve: ["cart", "cartId", "checkoutUrl", "snoozeCode", "sessionIdentity"],
  }),
  [DEVICE_MODES.ADMIN_DEV]: Object.freeze({
    policyId: "adminDev",
    timeoutMs: null,
    warningMs: null,
    abandonmentMs: null,
    defaultRoute: "/welcome",
    resetKeys: [],
    resetPrefixes: [],
    blockerReasons: [],
    preserve: [],
    disabled: true,
  }),
});

function pathOnly(pathname) {
  return String(pathname || "/").split(/[?#]/)[0] || "/";
}

function canUseResetPolicy(device) {
  return Boolean(
    device &&
      device.status === DEVICE_STATUSES.READY &&
      device.deviceMode &&
      DEVICE_RESET_POLICIES[device.deviceMode]
  );
}

export function getDeviceResetPolicy(device) {
  if (!canUseResetPolicy(device)) return DEVICE_RESET_POLICIES[DEVICE_MODES.ADMIN_DEV];
  return DEVICE_RESET_POLICIES[device.deviceMode] || DEVICE_RESET_POLICIES[DEVICE_MODES.ADMIN_DEV];
}

export function getDeviceResetRoute(device, policy = getDeviceResetPolicy(device)) {
  if (policy?.policyId === "pod") {
    return makePodRoute(device?.podId) || device?.defaultRoute || "/pod/pod-1";
  }

  return policy?.defaultRoute || device?.defaultRoute || "/welcome";
}

export function hasBlockingResetReason(policy, activeReasons = []) {
  const blockers = new Set(policy?.blockerReasons || []);
  return (Array.isArray(activeReasons) ? activeReasons : []).some((reason) =>
    blockers.has(reason)
  );
}

export function getDeviceResetSchedule({
  policy,
  lastActivityAt,
  now = Date.now(),
  activeReasons = [],
} = {}) {
  const parsedLast = Number(lastActivityAt);
  const last = Number.isFinite(parsedLast) ? parsedLast : Number(now);

  if (!policy || policy.disabled) {
    return {
      status: DEVICE_RESET_STATUSES.DISABLED,
      canReset: false,
      warningAt: null,
      resetAt: null,
      remainingMs: null,
      warningRemainingMs: null,
      resetRemainingMs: null,
    };
  }

  const blocked = hasBlockingResetReason(policy, activeReasons);

  if (policy.policyId === "checkout") {
    const warningAt = last + Number(policy.warningMs || 0);
    const resetAt = last + Number(policy.abandonmentMs || 0);
    const resetRemainingMs = Math.max(resetAt - now, 0);
    const warningRemainingMs = Math.max(warningAt - now, 0);

    return {
      status:
        now >= resetAt
          ? DEVICE_RESET_STATUSES.PENDING
          : now >= warningAt
            ? DEVICE_RESET_STATUSES.WARNING
            : DEVICE_RESET_STATUSES.ACTIVE,
      canReset: !blocked,
      warningAt,
      resetAt,
      remainingMs: resetRemainingMs,
      warningRemainingMs,
      resetRemainingMs,
    };
  }

  const resetAt = last + Number(policy.timeoutMs || 0);
  const remainingMs = Math.max(resetAt - now, 0);

  return {
    status: now >= resetAt ? DEVICE_RESET_STATUSES.PENDING : DEVICE_RESET_STATUSES.ACTIVE,
    canReset: !blocked,
    warningAt: null,
    resetAt,
    remainingMs,
    warningRemainingMs: null,
    resetRemainingMs: remainingMs,
  };
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // ignore
  }
}

function listStorageKeys(storage) {
  const keys = [];
  try {
    const length = Number(storage?.length || 0);
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
  } catch {
    // ignore
  }
  return keys;
}

export function resetStorageKeys({ storage, keys = [], prefixes = [] } = {}) {
  const removed = [];
  const uniqueKeys = new Set(Array.isArray(keys) ? keys.filter(Boolean) : []);

  for (const key of uniqueKeys) {
    safeRemove(storage, key);
    removed.push(key);
  }

  const prefixList = Array.isArray(prefixes) ? prefixes.filter(Boolean) : [];
  if (prefixList.length) {
    for (const key of listStorageKeys(storage)) {
      if (prefixList.some((prefix) => key.startsWith(prefix))) {
        safeRemove(storage, key);
        removed.push(key);
      }
    }
  }

  return Array.from(new Set(removed));
}

export function resetWelcome(options = {}) {
  const policy = options.policy || DEVICE_RESET_POLICIES[DEVICE_MODES.WELCOME_KIOSK];
  const removed = resetStorageKeys({
    storage: options.storage,
    keys: policy.resetKeys,
    prefixes: policy.resetPrefixes,
  });

  return {
    ok: true,
    policyId: policy.policyId,
    route: getDeviceResetRoute(options.device, policy),
    removed,
  };
}

export function resetPod(options = {}) {
  const policy = options.policy || DEVICE_RESET_POLICIES[DEVICE_MODES.POD_IPAD];
  const removed = resetStorageKeys({
    storage: options.storage,
    keys: policy.resetKeys,
    prefixes: policy.resetPrefixes,
  });

  return {
    ok: true,
    policyId: policy.policyId,
    route: getDeviceResetRoute(options.device, policy),
    removed,
  };
}

export function resetAskSnoozer(options = {}) {
  const policy = options.policy || DEVICE_RESET_POLICIES[DEVICE_MODES.ASK_SNOOZER_KIOSK];
  const removed = resetStorageKeys({
    storage: options.storage,
    keys: policy.resetKeys,
    prefixes: policy.resetPrefixes,
  });

  return {
    ok: true,
    policyId: policy.policyId,
    route: getDeviceResetRoute(options.device, policy),
    removed,
  };
}

export function resetSleepEssentials(options = {}) {
  const policy = options.policy || DEVICE_RESET_POLICIES[DEVICE_MODES.SLEEP_ESSENTIALS_KIOSK];
  const removed = resetStorageKeys({
    storage: options.storage,
    keys: policy.resetKeys,
    prefixes: policy.resetPrefixes,
  });

  return {
    ok: true,
    policyId: policy.policyId,
    route: getDeviceResetRoute(options.device, policy),
    removed,
  };
}

export function resetCheckout(options = {}) {
  const policy = options.policy || DEVICE_RESET_POLICIES[DEVICE_MODES.CHECKOUT_KIOSK];
  return {
    ok: true,
    policyId: policy.policyId,
    route: getDeviceResetRoute(options.device, policy),
    removed: [],
    message: CHECKOUT_ABANDONMENT_MESSAGE,
  };
}

export function executeDeviceReset(options = {}) {
  const device = options.device || {};
  const policy = options.policy || getDeviceResetPolicy(device);
  const pathname = pathOnly(options.pathname);

  if (!policy || policy.disabled) {
    return {
      ok: false,
      policyId: policy?.policyId || "none",
      route: pathname,
      removed: [],
      reason: "RESET_POLICY_DISABLED",
    };
  }

  if (policy.policyId === "welcome") return resetWelcome({ ...options, policy });
  if (policy.policyId === "pod") return resetPod({ ...options, policy });
  if (policy.policyId === "askSnoozer") return resetAskSnoozer({ ...options, policy });
  if (policy.policyId === "sleepEssentials") {
    return resetSleepEssentials({ ...options, policy });
  }
  if (policy.policyId === "checkout") return resetCheckout({ ...options, policy });

  return {
    ok: false,
    policyId: policy.policyId,
    route: pathname,
    removed: [],
    reason: "RESET_POLICY_UNSUPPORTED",
  };
}
