const INCOMPLETE_ASSESSMENT_COPY =
  "Welcome to your Snooze Session. First, we’ll build your sleep profile. Then I’ll guide you to your recommended SnoozePods in the showroom. After that, explore Sleep Essentials and build the sleep setup that feels right for you. Let’s start with your Snooze Assessment.";

const COMPLETE_ASSESSMENT_COPY =
  "Welcome to your Snooze Session. Your sleep profile is complete, so your matches are ready. I’ll show you which SnoozePod to visit first and two more that are also recommended. After your pod visits, explore Sleep Essentials and build your sleep setup. Let’s take a look at your recommended pods.";

function buildOrientationFallback(copy) {
  return {
    speech: copy,
    captions: copy,
    state: "speaking",
    priority: "normal",
    ttlMs: 6500,
    voiceStyle: "default",
    actions: [],
  };
}

export function getWhatToExpectFallback(assessmentComplete) {
  return buildOrientationFallback(
    assessmentComplete ? COMPLETE_ASSESSMENT_COPY : INCOMPLETE_ASSESSMENT_COPY
  );
}
