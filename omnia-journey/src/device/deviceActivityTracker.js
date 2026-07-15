export const DEVICE_ACTIVITY_EVENT = "mysnoozepod:device-activity";
export const DEVICE_TTS_EVENT = "mysnoozepod:device-tts";
export const DEVICE_CART_MUTATION_EVENT = "mysnoozepod:device-cart-mutation";
export const DEVICE_ASSESSMENT_SUBMISSION_EVENT =
  "mysnoozepod:device-assessment-submission";
export const DEVICE_QR_FLOW_EVENT = "mysnoozepod:device-qr-flow";
export const DEVICE_HUMAN_HELP_EVENT = "mysnoozepod:device-human-help";
export const DEVICE_ACTIVE_RESPONSE_EVENT = "mysnoozepod:device-active-response";

const BLOCKER_BY_EVENT = Object.freeze({
  [DEVICE_TTS_EVENT]: "tts",
  [DEVICE_CART_MUTATION_EVENT]: "cartMutation",
  [DEVICE_ASSESSMENT_SUBMISSION_EVENT]: "assessmentSubmission",
  [DEVICE_QR_FLOW_EVENT]: "qrFlow",
  [DEVICE_HUMAN_HELP_EVENT]: "humanHelp",
  [DEVICE_ACTIVE_RESPONSE_EVENT]: "activeResponse",
});

const DOM_ACTIVITY_EVENTS = Object.freeze([
  ["touchstart", "touch", { passive: true }],
  ["pointermove", "pointer", { passive: true }],
  ["mousedown", "pointer", { passive: true }],
  ["keydown", "keyboard", false],
]);

function nowMs() {
  return Date.now();
}

function normalizeDetail(detail = {}) {
  return detail && typeof detail === "object" ? detail : {};
}

function makeSnapshot(state) {
  const reasons = Array.from(state.activeReasons);
  return {
    lastActivityAt: state.lastActivityAt,
    isActive: reasons.length > 0,
    activeReason: reasons[0] || state.lastReason || "idle",
    activeReasons: reasons,
    lastReason: state.lastReason,
  };
}
function emitWindowEvent(eventName, detail = {}) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  } catch {
    // ignore
  }
}

export function emitDeviceActivity(reason = "manual", detail = {}) {
  emitWindowEvent(DEVICE_ACTIVITY_EVENT, { reason, ...normalizeDetail(detail) });
}

export function emitDeviceTtsActivity(active, detail = {}) {
  emitWindowEvent(DEVICE_TTS_EVENT, { active: Boolean(active), ...normalizeDetail(detail) });
}

export function emitDeviceCartMutation(active, detail = {}) {
  emitWindowEvent(DEVICE_CART_MUTATION_EVENT, {
    active: Boolean(active),
    ...normalizeDetail(detail),
  });
}

export function emitDeviceAssessmentSubmission(active, detail = {}) {
  emitWindowEvent(DEVICE_ASSESSMENT_SUBMISSION_EVENT, {
    active: Boolean(active),
    ...normalizeDetail(detail),
  });
}

export function emitDeviceQrFlow(active, detail = {}) {
  emitWindowEvent(DEVICE_QR_FLOW_EVENT, { active: Boolean(active), ...normalizeDetail(detail) });
}

export function emitDeviceHumanHelp(active, detail = {}) {
  emitWindowEvent(DEVICE_HUMAN_HELP_EVENT, {
    active: Boolean(active),
    ...normalizeDetail(detail),
  });
}

export function emitDeviceActiveResponse(active, detail = {}) {
  emitWindowEvent(DEVICE_ACTIVE_RESPONSE_EVENT, {
    active: Boolean(active),
    ...normalizeDetail(detail),
  });
}

export function withDeviceCartMutation(operation, detail = {}) {
  emitDeviceCartMutation(true, detail);
  try {
    const result = typeof operation === "function" ? operation() : operation;
    if (result && typeof result.then === "function") {
      return result.finally(() => emitDeviceCartMutation(false, detail));
    }
    emitDeviceCartMutation(false, detail);
    return result;
  } catch (error) {
    emitDeviceCartMutation(false, detail);
    throw error;
  }
}

export function createDeviceActivityTracker(options = {}) {
  const clock = typeof options.clock === "function" ? options.clock : nowMs;
  const minPointerIntervalMs = Number(options.minPointerIntervalMs || 750);
  const target =
    options.target ||
    (typeof document !== "undefined" ? document : null);
  const eventTarget =
    options.eventTarget ||
    (typeof window !== "undefined" ? window : null);

  const state = {
    lastActivityAt: Number(options.initialActivityAt || clock()),
    lastReason: "initial",
    activeReasons: new Set(),
    lastPointerAt: 0,
  };
  const listeners = new Set();
  const cleanups = [];

  function notify() {
    const snapshot = makeSnapshot(state);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore
      }
    }
  }

  function record(reason = "activity", detail = {}) {
    const normalizedReason = String(reason || "activity");
    const timestamp = Number(detail?.timestamp || clock());

    if (normalizedReason === "pointer") {
      if (timestamp - state.lastPointerAt < minPointerIntervalMs) return makeSnapshot(state);
      state.lastPointerAt = timestamp;
    }

    state.lastActivityAt = timestamp;
    state.lastReason = normalizedReason;
    notify();
    return makeSnapshot(state);
  }

  function setActiveReason(reason, active) {
    const normalizedReason = String(reason || "").trim();
    if (!normalizedReason) return makeSnapshot(state);

    if (active) {
      state.activeReasons.add(normalizedReason);
    } else {
      state.activeReasons.delete(normalizedReason);
    }

    state.lastReason = normalizedReason;
    if (!active) state.lastActivityAt = clock();
    notify();
    return makeSnapshot(state);
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(makeSnapshot(state));
    return () => listeners.delete(listener);
  }

  function attachDomEvent(name, reason, listenerOptions) {
    if (!target?.addEventListener) return;
    const handler = () => record(reason);
    target.addEventListener(name, handler, listenerOptions);
    cleanups.push(() => target.removeEventListener(name, handler, listenerOptions));
  }

  function attachWindowEvent(name) {
    if (!eventTarget?.addEventListener) return;
    const blocker = BLOCKER_BY_EVENT[name] || "";
    const handler = (event) => {
      const detail = normalizeDetail(event?.detail);
      if (blocker) {
        setActiveReason(blocker, detail.active !== false);
      }
      record(detail.reason || blocker || "event", detail);
    };
    eventTarget.addEventListener(name, handler);
    cleanups.push(() => eventTarget.removeEventListener(name, handler));
  }

  function attach() {
    for (const [name, reason, listenerOptions] of DOM_ACTIVITY_EVENTS) {
      attachDomEvent(name, reason, listenerOptions);
    }

    attachWindowEvent(DEVICE_ACTIVITY_EVENT);
    attachWindowEvent(DEVICE_TTS_EVENT);
    attachWindowEvent(DEVICE_CART_MUTATION_EVENT);
    attachWindowEvent(DEVICE_ASSESSMENT_SUBMISSION_EVENT);
    attachWindowEvent(DEVICE_QR_FLOW_EVENT);
    attachWindowEvent(DEVICE_HUMAN_HELP_EVENT);
    attachWindowEvent(DEVICE_ACTIVE_RESPONSE_EVENT);

    return detach;
  }

  function detach() {
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      try {
        cleanup();
      } catch {
        // ignore
      }
    }
  }

  return {
    attach,
    detach,
    record,
    subscribe,
    setActiveReason,
    getSnapshot: () => makeSnapshot(state),
  };
}
