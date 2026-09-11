export const ASK_SNOOZER_VOICE_TIMING_EVENT = "mysnoozepod:ask-snoozer-voice-timing";
export const ASK_SNOOZER_CLIENT_TIMING_VERSION = "ask-snoozer-client-timing-v1";

function nowMs() {
  return Date.now();
}

function safeDuration(end, start) {
  const value = Number(end) - Number(start);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function createAskSnoozerTurnTiming(id, startedAt = nowMs()) {
  return {
    version: ASK_SNOOZER_CLIENT_TIMING_VERSION,
    id: String(id || "").trim(),
    requestStartedAt: Number(startedAt) || nowMs(),
    firstFeedbackAt: null,
    responseReceivedAt: null,
    displayAt: null,
  };
}

export function markAskSnoozerTiming(timing, field, timestamp = nowMs()) {
  if (!timing || typeof timing !== "object") return timing;
  if (!["firstFeedbackAt", "responseReceivedAt", "displayAt"].includes(field)) return timing;
  if (!timing[field]) timing[field] = Number(timestamp) || nowMs();
  return timing;
}

export function buildAskSnoozerDisplayTiming(timing, response = {}) {
  const requestStartedAt = Number(timing?.requestStartedAt || nowMs());
  const firstFeedbackAt = Number(timing?.firstFeedbackAt || requestStartedAt);
  const responseReceivedAt = Number(timing?.responseReceivedAt || nowMs());
  const displayAt = Number(timing?.displayAt || responseReceivedAt);
  return {
    version: ASK_SNOOZER_CLIENT_TIMING_VERSION,
    phase: "display",
    surface: "ask_snoozer",
    timingId: String(timing?.id || "").trim() || null,
    requestId: response?.meta?.requestId || null,
    responsePolicyVersion: response?.meta?.quality?.responsePolicyVersion || "baseline-v1",
    requestToFirstFeedbackMs: safeDuration(firstFeedbackAt, requestStartedAt),
    backendRoundTripMs: safeDuration(responseReceivedAt, requestStartedAt),
    backendReportedMs: Number(response?.meta?.backendMetrics?.totalMs || 0),
    responseToDisplayMs: safeDuration(displayAt, responseReceivedAt),
    requestToDisplayMs: safeDuration(displayAt, requestStartedAt),
    ttsRequested: Boolean(response?.voice?.speak && response?.voice?.speech),
  };
}

export function buildAskSnoozerVoiceTiming(job, phase, timestamp = nowMs(), extra = {}) {
  const metadata = job?.metadata || {};
  const requestStartedAt = Number(metadata.requestStartedAt || 0);
  const responseReceivedAt = Number(metadata.responseReceivedAt || 0);
  const startedAt = Number(job?.startedAt || timestamp);
  const preparationStartedAt = Number(job?.preparingStartedAt || job?.createdAt || timestamp);
  const captionsOnly = phase === "tts_unavailable" || job?.status === "captions-only";
  const terminalState = String(
    extra.speechTerminalState ||
      (phase === "tts_complete"
        ? "completed"
        : phase === "tts_error"
          ? "failed"
          : phase === "tts_superseded"
            ? "superseded"
            : phase === "tts_cancelled"
              ? "cancelled"
              : "")
  ).trim();
  return {
    version: ASK_SNOOZER_CLIENT_TIMING_VERSION,
    phase,
    surface: "ask_snoozer",
    timingId: metadata.askSnoozerTimingId || null,
    requestId: metadata.backendRequestId || null,
    responsePolicyVersion: metadata.responsePolicyVersion || "baseline-v1",
    responseToTtsStartMs: phase === "tts_start" ? safeDuration(timestamp, responseReceivedAt) : 0,
    speechWaitBeforeStartMs: phase === "tts_start" ? safeDuration(timestamp, job?.createdAt) : 0,
    speechQueueWaitMs: phase === "tts_start" ? safeDuration(preparationStartedAt, job?.createdAt) : 0,
    ttsPreparationMs: phase === "tts_start" ? safeDuration(timestamp, preparationStartedAt) : 0,
    speechDurationMs: phase === "tts_complete" ? safeDuration(timestamp, startedAt) : 0,
    totalPerceivedMs: requestStartedAt ? safeDuration(timestamp, requestStartedAt) : 0,
    ttsRequested: true,
    ttsPlayed:
      phase === "tts_start" ||
      (phase === "tts_complete" && !captionsOnly) ||
      Boolean(extra.interrupted),
    captionsOnly,
    interrupted: Boolean(extra.interrupted),
    speechSuperseded: Boolean(extra.speechSuperseded || phase === "tts_superseded"),
    speechSupersededCount: Number(extra.speechSupersededCount ?? metadata.speechSupersededCount ?? 0) || 0,
    speechQueueDepthAtEnqueue: Number(metadata.speechQueueDepthAtEnqueue || 0) || 0,
    speechQueueDepthAfterSupersession:
      Number(extra.speechQueueDepthAfterSupersession ?? metadata.speechQueueDepthAfterSupersession ?? 0) || 0,
    speechTerminalState: terminalState || null,
    staleSpeechPrevented: Boolean(extra.staleSpeechPrevented),
    activeSpeechTurnId: metadata.askSnoozerTimingId || null,
  };
}

export function emitAskSnoozerVoiceTiming(job, phase, extra = {}) {
  if (!job?.metadata?.askSnoozerTimingId || typeof window === "undefined") return null;
  const detail = buildAskSnoozerVoiceTiming(job, phase, nowMs(), extra);
  try {
    window.dispatchEvent(new CustomEvent(ASK_SNOOZER_VOICE_TIMING_EVENT, { detail }));
  } catch {
    return null;
  }
  return detail;
}
