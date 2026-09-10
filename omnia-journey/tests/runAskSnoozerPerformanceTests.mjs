import assert from "node:assert/strict";
import {
  ASK_SNOOZER_CLIENT_TIMING_VERSION,
  buildAskSnoozerDisplayTiming,
  buildAskSnoozerVoiceTiming,
  createAskSnoozerTurnTiming,
  markAskSnoozerTiming,
} from "../src/lib/snoozer/askSnoozerPerformance.mjs";

const timing = createAskSnoozerTurnTiming("timing-1", 1000);
markAskSnoozerTiming(timing, "firstFeedbackAt", 1012);
markAskSnoozerTiming(timing, "responseReceivedAt", 1450);
markAskSnoozerTiming(timing, "displayAt", 1466);
const display = buildAskSnoozerDisplayTiming(timing, {
  meta: {
    requestId: "request-1",
    backendMetrics: { totalMs: 410 },
    quality: { responsePolicyVersion: "baseline-v1" },
  },
  voice: { speak: true, speech: "A faithful short answer." },
});
assert.equal(display.version, ASK_SNOOZER_CLIENT_TIMING_VERSION);
assert.equal(display.requestToFirstFeedbackMs, 12);
assert.equal(display.backendRoundTripMs, 450);
assert.equal(display.responseToDisplayMs, 16);
assert.equal(display.requestToDisplayMs, 466);
assert.equal(display.backendReportedMs, 410);
assert.equal(display.ttsRequested, true);

const job = {
  createdAt: 1470,
  startedAt: 1600,
  status: "playing",
  metadata: {
    askSnoozerTimingId: "timing-1",
    backendRequestId: "request-1",
    requestStartedAt: 1000,
    responseReceivedAt: 1450,
    responsePolicyVersion: "baseline-v1",
  },
};
const start = buildAskSnoozerVoiceTiming(job, "tts_start", 1600);
assert.equal(start.responseToTtsStartMs, 150);
assert.equal(start.ttsPreparationMs, 130);
assert.equal(start.ttsPlayed, true);
const complete = buildAskSnoozerVoiceTiming(job, "tts_complete", 4600);
assert.equal(complete.speechDurationMs, 3000);
assert.equal(complete.totalPerceivedMs, 3600);

console.log("Ask Snoozer client performance-boundary tests passed.");
