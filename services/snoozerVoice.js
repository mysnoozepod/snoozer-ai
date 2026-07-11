const BANNED_SNOOZER_PHRASES = Object.freeze([
  "verified option",
  "stronger starting point",
  "pressure relief underneath",
  "support-and-pressure-relief first try",
  "flat hard feel",
  "compare it if you want support",
  "best first look",
]);

function cleanVoiceText(value) {
  return String(value == null ? "" : value)
    .replace(/(\d+)\s*"/g, "$1-inch")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVoiceText(value) {
  return cleanVoiceText(value).toLowerCase();
}

function ensureVoiceSentence(value) {
  const text = cleanVoiceText(value);
  if (!text) return "";
  if (/[.!?]$/.test(text)) return text;
  return `${text}.`;
}

function joinVoiceSentences(parts = [], maxSentences = 3, maxChars = 220) {
  const out = [];
  const seen = new Set();

  for (const part of parts) {
    const sentence = ensureVoiceSentence(part);
    const key = normalizeVoiceText(sentence);
    if (!sentence || seen.has(key)) continue;
    seen.add(key);
    out.push(sentence);
    if (out.length >= maxSentences) break;
  }

  const joined = cleanVoiceText(out.join(" "));
  if (!joined) return "";
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars - 3).trim().replace(/[,:;]$/, "")}...`;
}

function prefersCurrentProductPhrase(currentTitle = "", primaryTitle = "") {
  const current = cleanVoiceText(currentTitle);
  const primary = cleanVoiceText(primaryTitle);
  if (!current || !primary || normalizeVoiceText(current) === normalizeVoiceText(primary)) {
    return "";
  }
  return `This page is worth comparing, but I would put ${primary} ahead of ${current} based on what you said`;
}

function buildCoupleConflictVoice({
  primaryTitle = "",
  currentTitle = "",
  maxChars = 220,
} = {}) {
  const primary = cleanVoiceText(primaryTitle) || "the Dual Comfort option";
  const current = cleanVoiceText(currentTitle);
  return joinVoiceSentences(
    [
      "If your partner moves a lot, motion separation matters first",
      current && normalizeVoiceText(current) !== normalizeVoiceText(primary)
        ? `This page is ${current}; for different firmness, compare ${primary} so each sleeper can choose their own feel`
        : `For different firmness, compare ${primary} so each sleeper can choose their own feel`,
    ],
    3,
    maxChars
  );
}

function buildBackPainVoice({ primaryTitle = "", maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "A firm bed is not always the answer for back pain; support and pressure relief have to work together",
      primaryTitle
        ? `Use your Rest Test on ${primaryTitle} to check whether your lower back and hips feel supported`
        : "Use your Rest Test to check whether your lower back and hips feel supported",
      "I cannot diagnose back pain, but I can help you compare support and comfort.",
    ],
    3,
    maxChars
  );
}

function buildSleepHotVoice({
  primaryTitle = "",
  askSleepPosition = false,
  maxChars = 220,
} = {}) {
  return joinVoiceSentences(
    [
      primaryTitle
        ? `Temperature balance matters, so test whether ${primaryTitle} lets heat build up around you or feels breathable over a few quiet minutes`
        : "Temperature balance matters, so look at the full sleep setup: mattress feel, airflow, bedding, and cooling accessories",
      askSleepPosition ? "Tell me your usual sleep position only if you have not taken the assessment yet." : "Do not expect one mattress to solve every heat issue by itself.",
    ],
    3,
    maxChars
  );
}

function buildSideSleepingVoice({ primaryTitle = "", maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "Side sleepers usually need pressure relief first because shoulders and hips carry the most pressure",
      primaryTitle
        ? `Compare ${primaryTitle} for cushioning in those areas without letting your body sink too far out of alignment`
        : "Compare the option that cushions those areas without letting your body sink too far out of alignment",
    ],
    2,
    maxChars
  );
}

function buildFirmSupportVoice({ primaryTitle = "", maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "Start with support first, then tune comfort on top",
      primaryTitle
        ? `${primaryTitle} is worth comparing if you want a firmer direction without making the bed harsh`
        : "Look for the option that feels lifted and steady before you worry about extra cushioning",
    ],
    2,
    maxChars
  );
}

function buildFoamVsHybridVoice({
  firstTitle = "",
  secondTitle = "",
  maxChars = 220,
} = {}) {
  const first = cleanVoiceText(firstTitle);
  const second = cleanVoiceText(secondTitle);

  return joinVoiceSentences(
    [
      "Foam usually gives you a closer contour with less motion transfer, while hybrid usually feels more lifted, more breathable, and a little bouncier",
      first && second
        ? `${first} covers the foam side of that compare, while ${second} covers the hybrid side`
        : "",
    ],
    2,
    maxChars
  );
}

function buildAdjustableBaseVoice({
  primaryTitle = "",
  askSize = false,
  maxChars = 220,
} = {}) {
  return joinVoiceSentences(
    [
      "For base setup, an adjustable base adds head, leg, and rest-test position control",
      primaryTitle
        ? `${primaryTitle} can still work without one, so think of the base as an experience upgrade, not a requirement`
        : "The mattress should still feel good without one, so use the base to test comfort control rather than unsupported promises",
      askSize ? "Are you shopping Queen or King?" : "Try it during your Snooze Session and compare the flat position too.",
    ],
    3,
    maxChars
  );
}

function buildSplitMotionVoice({ sizeLabel = "", maxChars = 220 } = {}) {
  const normalizedSize = normalizeVoiceText(sizeLabel);
  const sizeSentence =
    normalizedSize === "queen"
      ? "Queen points to Half Split Motion"
      : normalizedSize === "king"
        ? "Full Split stays King-only when each side needs more independent movement"
        : "Queen usually points to Half Split, while Full Split stays King-only";

  return joinVoiceSentences(
    [
      "Split motion is about giving each sleeper more comfort or movement independence on an adjustable base",
      sizeSentence,
    ],
    2,
    maxChars
  );
}

function buildNoBaseVoice({ maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "If you chose mattress only, I would keep the mattress match clean and leave the base out for now",
      "You can always add a base later if elevation becomes important",
    ],
    2,
    maxChars
  );
}

function buildPlatformBaseVoice({ maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "Platform Base keeps the setup simple and off the motion path",
      "That is the cleaner move if you want a steady foundation without adjustable hardware",
    ],
    2,
    maxChars
  );
}

function buildFallbackGuidanceVoice({ maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "I do not want to guess without the right context",
      "Tell me how you sleep, whether you share the bed, and whether you want an adjustable setup, and I will narrow the next step.",
    ],
    2,
    maxChars
  );
}

function buildCanonicalRecommendationVoice({
  mode = "recommend",
  topPodName = "",
  mattressTitle = "",
  baseTitle = "",
  motionLabel = "",
  reasonSummary = "",
  nextPodNames = [],
  warningSummary = "",
  maxChars = 320,
} = {}) {
  const topPod = cleanVoiceText(topPodName) || "your top SnoozePod";
  const mattress = cleanVoiceText(mattressTitle) || "your matched mattress";
  const rawBase = cleanVoiceText(baseTitle);
  const rawMotion = cleanVoiceText(motionLabel);
  const base = /^no base$/i.test(rawBase) ? "" : rawBase;
  const motion = /^no motion$/i.test(rawMotion) || /^none$/i.test(rawMotion) ? "" : rawMotion;
  const safeSetup = [mattress, base, motion].filter(Boolean).join(" with ");
  const reason = cleanVoiceText(reasonSummary);
  const warning = cleanVoiceText(warningSummary);
  const nextNames = Array.isArray(nextPodNames)
    ? nextPodNames.map(cleanVoiceText).filter(Boolean)
    : [];

  let intro = "";
  let detail = "";

  switch (mode) {
    case "why_pod":
      intro = `${topPod}, featuring ${mattress}, matches ${reason || "the support and comfort needs from your assessment"}`;
      detail = `Matched setup: ${safeSetup}. Start there, then compare the next pod`;
      break;
    case "which_mattress":
      intro = `I would start with ${mattress} on ${topPod}`;
      detail = reason
        ? `Test it for ${reason}, then notice whether your body can relax into the mattress without losing support`
        : "Pay attention to whether your body can relax into the mattress without losing support";
      break;
    case "explain_results":
      intro = nextNames.length
        ? `Your test order starts with ${topPod}, then ${nextNames.join(", then ")}`
        : `Your first setup is ${topPod}`;
      detail = `The core match is ${safeSetup}${reason ? ` because it lines up with ${reason}` : ""}`;
      break;
    case "help_decide":
      intro = "No worries - that is what I am here for";
      detail = nextNames.length
        ? `Start with ${topPod}, then compare ${nextNames.join(" and ")} while the feel is still fresh`
        : `Start with ${topPod}, then tell me what feels best or worst`;
      break;
    case "what_try_first":
      intro = `Start with ${topPod}`;
      detail = `That starts with ${safeSetup}${reason ? ` because it lines up with ${reason}` : ""}`;
      break;
    default:
      intro = `I would start with ${topPod}`;
      detail = `For you, that means ${safeSetup}${reason ? ` because it lines up with ${reason}` : ""}`;
      break;
  }

  return joinVoiceSentences(
    [
      intro,
      detail,
      mode === "help_decide" ? "Give me quick feedback after each pod and I will help narrow the tradeoff" : "",
      warning ? `One note: ${warning}` : "",
    ],
    3,
    maxChars
  );
}

function buildSnoozerVoiceReply(scenario, options = {}) {
  switch (String(scenario || "").trim()) {
    case "couple_conflict":
      return buildCoupleConflictVoice(options);
    case "back_pain":
      return buildBackPainVoice(options);
    case "sleep_hot":
      return buildSleepHotVoice(options);
    case "side_sleeping":
      return buildSideSleepingVoice(options);
    case "firm_support":
      return buildFirmSupportVoice(options);
    case "foam_vs_hybrid":
      return buildFoamVsHybridVoice(options);
    case "adjustable_base":
      return buildAdjustableBaseVoice(options);
    case "split_motion":
      return buildSplitMotionVoice(options);
    case "mattress_only":
    case "no_base":
      return buildNoBaseVoice(options);
    case "platform_base":
      return buildPlatformBaseVoice(options);
    case "canonical_recommendation":
      return buildCanonicalRecommendationVoice(options);
    default:
      return buildFallbackGuidanceVoice(options);
  }
}

module.exports = {
  BANNED_SNOOZER_PHRASES,
  buildCanonicalRecommendationVoice,
  buildSnoozerVoiceReply,
  cleanVoiceText,
  joinVoiceSentences,
  normalizeVoiceText,
};
