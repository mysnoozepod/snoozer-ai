const INCOMPLETE_ASSESSMENT_COPY =
  "Here’s how your Snooze Session works. We’ll start with your sleep profile, then I’ll guide you through the rest.";

const COMPLETE_ASSESSMENT_COPY =
  "You already finished your sleep profile, so we’re heading to your recommended pods.";

function buildOrientationFallback(copy) {
  return {
    speech: copy,
    captions: copy,
    state: "speaking",
    priority: "normal",
    ttlMs: 5200,
    voiceStyle: "default",
    actions: [],
  };
}

export function getWhatToExpectFallback(assessmentComplete) {
  return buildOrientationFallback(
    assessmentComplete ? COMPLETE_ASSESSMENT_COPY : INCOMPLETE_ASSESSMENT_COPY
  );
}
