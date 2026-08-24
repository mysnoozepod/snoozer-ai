const INCOMPLETE_ASSESSMENT_COPY =
  "Welcome to your Snooze Session. Here’s how your showroom visit works. First, we’ll start with a few questions about how you sleep so I can build your sleep profile. Then I’ll guide you to the SnoozePods I want you to test first. After that, explore Sleep Essentials like pillows, bedding, and protectors. Finally, you’ll build the sleep setup that feels right for you. Let’s start with your Snooze Assessment.";

const COMPLETE_ASSESSMENT_COPY =
  "Welcome to your Snooze Session. You’ve already completed your Snooze Assessment, so your matches are ready. I’ll start you with your best-matched SnoozePod, then give you two more to compare while the feel is fresh. After your pod tests, explore Sleep Essentials like pillows, bedding, and protectors. Finally, you’ll build the sleep setup that feels right for you. Let’s take a look at your recommended pods.";

function buildOrientationFallback(copy) {
  return {
    speech: copy,
    captions: copy,
    state: "speaking",
    priority: "normal",
    ttlMs: 30000,
    voiceStyle: "default",
    actions: [],
  };
}

export function getWhatToExpectFallback(assessmentComplete) {
  return buildOrientationFallback(
    assessmentComplete ? COMPLETE_ASSESSMENT_COPY : INCOMPLETE_ASSESSMENT_COPY
  );
}
