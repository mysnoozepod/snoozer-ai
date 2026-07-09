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
      "For Queen or King, different bodies and different feels point to the couple-friendly Dual Comfort path",
      current && normalizeVoiceText(current) !== normalizeVoiceText(primary)
        ? `This page is ${current}, but I would compare ${primary} first because it gives each partner room to solve firmness`
        : `${primary} gives each partner room to solve firmness without forcing one shared feel`,
    ],
    3,
    maxChars
  );
}

function buildBackPainVoice({ primaryTitle = "", maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "For back support, start with support first, then judge comfort",
      primaryTitle
        ? `${primaryTitle} is worth comparing if your hips and lower back feel supported without chasing the hardest bed`
        : "Look for the setup that keeps your hips and lower back supported without making the bed feel stiff",
      "I cannot diagnose pain, but I can help you compare which mattress feels most stable while you test.",
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
        ? `Test airflow and heat buildup on ${primaryTitle} first`
        : "If you sleep hot, test airflow and heat buildup first",
      askSleepPosition ? "Tell me if you sleep side, back, or stomach and I can narrow the next pod." : "",
    ],
    3,
    maxChars
  );
}

function buildSideSleepingVoice({ primaryTitle = "", maxChars = 220 } = {}) {
  return joinVoiceSentences(
    [
      "As a side sleeper, pressure relief at the shoulder and hip is the first thing to notice",
      primaryTitle
        ? `${primaryTitle} is worth comparing if it cushions those pressure points while keeping your spine from dipping`
        : "Start with the setup that gives you contour at the shoulder and hip without letting your spine dip",
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
      "Tell me how you sleep, whether you share the bed, and whether you want motion or no base, and I will narrow the next step.",
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
      intro = `${topPod} rose to the top because it lines up with ${reason || "your sleep setup"}`;
      detail = `Your matched setup is ${mattress} with ${base} and ${motion}`;
      break;
    case "which_mattress":
      intro = `I would start with ${mattress}`;
      detail = `In your results, that sits inside ${topPod} with ${base} and ${motion}${reason ? ` because it matches ${reason}` : ""}`;
      break;
    case "explain_results":
      intro = nextNames.length
        ? `Your test order starts with ${topPod}, then ${nextNames.join(", then ")}`
        : `Your first setup is ${topPod}`;
      detail = `The core match is ${mattress} with ${base} and ${motion}${reason ? ` because it lines up with ${reason}` : ""}`;
      break;
    case "what_try_first":
      intro = `Start with ${topPod}`;
      detail = `That setup is ${mattress} with ${base} and ${motion}${reason ? ` because it lines up with ${reason}` : ""}`;
      break;
    default:
      intro = `I would start with ${topPod}`;
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
