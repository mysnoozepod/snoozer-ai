#!/usr/bin/env node

const { aggregateAskSnoozerQualityTraces } = require("../services/askSnoozerQualityTrace");
const { loadCloudWatch } = require("./runAskSnoozerQualityReport");

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function main() {
  const minutes = Number(arg("--minutes", "30"));
  const requiredDisplays = Number(arg("--required-displays", "3"));
  const requiredSpeechStarts = Number(arg("--required-speech-starts", "2"));
  const requirePhysical = process.argv.includes("--require-physical");
  const events = loadCloudWatch({ minutes });
  const summary = aggregateAskSnoozerQualityTraces(events);
  const timing = summary.clientTiming || {};
  const checks = {
    firstVisibleFeedbackMeasured: Number(timing.displayCount || 0) >= requiredDisplays,
    responseToDisplayMeasured: Number(timing.displayCount || 0) >= requiredDisplays,
    ttsStartMeasured: Number(timing.ttsStartCount || 0) >= requiredSpeechStarts,
    speechCompletionMeasured: Number(timing.ttsCompleteCount || 0) >= requiredSpeechStarts,
  };
  const physicalStatus = Object.values(checks).every(Boolean)
    ? "passed_observed_device_session"
    : "pending_external_device_session";
  const report = {
    version: "ask-snoozer-device-tts-acceptance-v1",
    windowMinutes: minutes,
    physicalStatus,
    checks,
    measurements: {
      requestToFirstFeedbackAverageMs: timing.requestToFirstFeedbackAverageMs ?? null,
      responseToDisplayAverageMs: timing.responseToDisplayAverageMs ?? null,
      responseToTtsStartAverageMs: timing.responseToTtsStartAverageMs ?? null,
      speechDurationAverageMs: timing.speechDurationAverageMs ?? null,
    },
    manualProtocol: "validation/ask-snoozer-showroom-test-kit.md",
  };
  console.log(JSON.stringify(report, null, 2));
  if (requirePhysical && physicalStatus !== "passed_observed_device_session") process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}
