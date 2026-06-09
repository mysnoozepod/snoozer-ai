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
  return joinVoiceSentences(
    [
      "Got it - I would not force one mattress feel on two different bodies when you need different feels",
      currentTitle && normalizeVoiceText(currentTitle) !== normalizeVoiceText(primaryTitle)
        ? `This page is ${cleanVoiceText(currentTitle)}, but ${cleanVoiceText(primaryTitle)} is the more couple-friendly route - are you shopping Queen or King`
        : `${cleanVoiceText(primaryTitle)} is the more couple-friendly route - are you shopping Queen or King`,
    ],
    2,
    maxChars
  );
}

function buildBackPainVoice({ primaryTitle = "", maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "Got it - start with support first, then tune comfort",
      primaryTitle
        ? `${primaryTitle} is worth comparing if you want lift with some cushion instead of just chasing the firmest bed`
        : "Look for the setup that keeps you supported without making the bed feel stiff",
    ],
    2,
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
      "Got it - if you sleep hot, start with airflow and avoid the setups that trap more heat around you",
      primaryTitle
        ? `${primaryTitle} is a breathable place to start${askSleepPosition ? " - side, back, or stomach" : ""}`
        : `Hybrid usually feels more breathable, while foam usually feels closer${askSleepPosition ? " - side, back, or stomach" : ""}`,
    ],
    2,
    maxChars
  );
}

function buildSideSleepingVoice({ primaryTitle = "", maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "Got it - side sleepers usually need enough give at the shoulder and hip without losing support",
      primaryTitle
        ? `${primaryTitle} is worth comparing if you want that pressure relief without going mushy`
        : "Start with the setup that gives you contour at the shoulder and hip before you chase a firmer feel",
    ],
    2,
    maxChars
  );
}

function buildFirmSupportVoice({ primaryTitle = "", maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "Got it - start with support first, then tune comfort on top",
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
      "If elevation matters, choose the adjustable base setup on purpose instead of leaving it as an afterthought",
      primaryTitle
        ? `${primaryTitle} is worth checking with the exact base setup and size you want`
        : "The mattress and base need to make sense together, especially once motion gets involved",
      askSize ? "Are you shopping Queen or King" : "",
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
      "Got it - tell me how you sleep, whether you share the bed, and whether you want motion or no base",
      "I can narrow the right direction from there",
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
  const base = cleanVoiceText(baseTitle) || "No Base";
  const motion = cleanVoiceText(motionLabel) || "No Motion";
  const reason = cleanVoiceText(reasonSummary);
  const warning = cleanVoiceText(warningSummary);
  const nextNames = Array.isArray(nextPodNames)
    ? nextPodNames.map(cleanVoiceText).filter(Boolean)
    : [];

  let intro = "";
  let detail = "";

  switch (mode) {
    case "why_pod":
      intro = `Got it - ${topPod} rose to the top because it lines up with ${reason || "your setup"}`;
      detail = `That match is ${mattress} with ${base} and ${motion}`;
      break;
    case "which_mattress":
      intro = `Got it - I would start with ${mattress}`;
      detail = `In your results, that sits inside ${topPod} with ${base} and ${motion}${reason ? ` because it matches ${reason}` : ""}`;
      break;
    case "explain_results":
      intro = nextNames.length
        ? `Got it - your order starts with ${topPod}, then ${nextNames.join(", then ")}`
        : `Got it - your first setup is ${topPod}`;
      detail = `The core match is ${mattress} with ${base} and ${motion}${reason ? ` because it lines up with ${reason}` : ""}`;
      break;
    case "what_try_first":
      intro = `Got it - start with ${topPod}`;
      detail = `That setup is ${mattress} with ${base} and ${motion}${reason ? ` because it lines up with ${reason}` : ""}`;
      break;
    default:
      intro = `Got it - I would start with ${topPod}`;
      detail = `For you, that means ${mattress} with ${base} and ${motion}${reason ? ` because it lines up with ${reason}` : ""}`;
      break;
  }

  return joinVoiceSentences(
    [
      intro,
      detail,
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
