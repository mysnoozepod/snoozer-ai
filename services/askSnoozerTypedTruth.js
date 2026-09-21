function clean(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

const RAW_KNOWLEDGE_PATTERN = /(?:^|\s)(?:title|tags?|related[_ ]?skills?|updated|assistant notes?)\s*:|(?:skills|faq|policies|products)\/[\w./-]+\.md\b|\b[a-z0-9_-]+\.md\b|\bpolicy \(draft\)\b|```|^---$/im;

function containsRawKnowledgeMetadata(value = "") {
  return RAW_KNOWLEDGE_PATTERN.test(String(value || ""));
}

function safeKnowledgeLines(raw = "", { limit = 12, include = [] } = {}) {
  const terms = (Array.isArray(include) ? include : [])
    .map((item) => clean(item).toLowerCase())
    .filter(Boolean);
  let inFrontmatter = false;
  let frontmatterSeen = false;
  let internalNotes = false;
  const output = [];
  for (const sourceLine of String(raw || "").split(/\r?\n/)) {
    const rawLine = String(sourceLine || "").trim();
    if (rawLine === "---") {
      if (!frontmatterSeen) {
        inFrontmatter = true;
        frontmatterSeen = true;
      } else if (inFrontmatter) {
        inFrontmatter = false;
      }
      continue;
    }
    if (inFrontmatter) continue;
    if (/^assistant notes?\s*:/i.test(rawLine)) {
      internalNotes = true;
      continue;
    }
    if (internalNotes) continue;
    if (/^(?:title|tags?|related[_ ]?skills?|updated|version|status|source|developer notes?|retrieval trigger)\s*:/i.test(rawLine)) continue;
    if (/^(?:#{1,6}\s*)?(?:delivery|return|warranty|financing) policy(?:\s*\(draft\))?$/i.test(rawLine)) continue;
    const line = clean(rawLine
      .replace(/^[\s\\#>*-]+/, "")
      .replace(/[*_`]/g, "")
      .replace(/&nbsp;/gi, " "));
    if (!line || line.length < 8 || line.length > 300 || containsRawKnowledgeMetadata(line)) continue;
    if (terms.length && !terms.some((term) => line.toLowerCase().includes(term))) continue;
    if (!output.includes(line)) output.push(line);
    if (output.length >= limit) break;
  }
  return output;
}

function sentenceWithPeriod(value) {
  const text = clean(value).replace(/^[•-]\s*/, "");
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function firstMatch(lines, pattern) {
  return lines.find((line) => pattern.test(line)) || "";
}

function normalizePolicyDocument({
  topic = "",
  raw = "",
  fallback = "",
  status = "verified_fact",
  sourceKind = "unknown",
  sourceKey = "",
  sourcePriority = 4,
  fallbackUsed = false,
} = {}) {
  const normalizedTopic = clean(topic).toLowerCase();
  const lines = safeKnowledgeLines(raw || fallback, { limit: 20 });
  const fact = {
    type: normalizedTopic,
    topic: normalizedTopic,
    status,
    known: lines.length > 0,
    sourceKind: clean(sourceKind) || "unknown",
    sourceKey: clean(sourceKey) || null,
    sourcePriority: Number(sourcePriority) || 4,
    fallbackUsed: Boolean(fallbackUsed),
    conflictDetected: false,
    conflicts: [],
    fieldSources: {},
  };
  if (!lines.length) return fact;

  if (normalizedTopic === "warranty") {
    const termLine = firstMatch(lines, /\b\d+\s*[- ]?year\b.*\bwarrant/i);
    fact.term = clean(termLine.match(/\b\d+\s*[- ]?year(?:\s+limited)?\s+warranty\b/i)?.[0]);
    fact.coverage = lines.filter((line) => /\b(?:cover|defect|workmanship|sagging|uneven wear)\b/i.test(line)).map(sentenceWithPeriod).slice(0, 4);
    fact.exclusions = lines.filter((line) => /\b(?:not covered|exclude|normal softening|stain|misuse|improper support|comfort preference)\b/i.test(line)).map(sentenceWithPeriod).slice(0, 4);
    fact.conditions = lines.filter((line) => /\b(?:proof of purchase|original purchaser|registration)\b/i.test(line)).map(sentenceWithPeriod).slice(0, 3);
  } else if (normalizedTopic === "delivery") {
    const windowLine = firstMatch(lines, /\b\d+\s*[–-]\s*\d+\s+business days?\b/i);
    fact.typicalWindow = clean(windowLine.match(/\b\d+\s*[–-]\s*\d+\s+business days?\b/i)?.[0]);
    fact.conditions = lines.filter((line) => /\b(?:zip|availability|schedule|window|delay|weather|inventory)\b/i.test(line)).map(sentenceWithPeriod).slice(0, 4);
  } else if (normalizedTopic === "returns") {
    const trialLine = firstMatch(lines, /\b\d+\s*[- ]?night\b/i);
    fact.trialWindow = clean(trialLine.match(/\b\d+\s*[- ]?night(?:\s+sleep trial)?\b/i)?.[0]);
    fact.terms = lines.filter((line) => /\b(?:return|exchange|sleep trial|one time|final sale|opened|delivered)\b/i.test(line)).map(sentenceWithPeriod).slice(0, 5);
  } else if (normalizedTopic === "financing") {
    fact.terms = lines.filter((line) => /\b(?:financ|payment|affirm|credit|plan)\b/i.test(line)).map(sentenceWithPeriod).slice(0, 5);
  }

  fact.known = Boolean(
    fact.term || fact.typicalWindow || fact.trialWindow ||
    fact.coverage?.length || fact.exclusions?.length || fact.conditions?.length || fact.terms?.length
  );
  return fact;
}

function normalizeDurabilityFacts({ productFacts = [], sourceKey = "", status = "verified_fact" } = {}) {
  const lines = (Array.isArray(productFacts) ? productFacts : [])
    .map(clean)
    .filter(Boolean)
    .filter((line) => !containsRawKnowledgeMetadata(line));
  const nonWarrantyLines = lines.filter((line) => !/\bwarrant(?:y|ies)\b/i.test(line));
  const exactLine = nonWarrantyLines.find((line) =>
    /\b(?:expected lifespan|designed to last|typically lasts?|expected to last)\b[^.]*\b\d+(?:\s*[–-]\s*\d+)?\s+years?\b/i.test(line)
  );
  const exactMatch = exactLine?.match(/\b(\d+)(?:\s*[–-]\s*(\d+))?\s+years?\b/i) || null;
  const saggingLine = nonWarrantyLines.find((line) =>
    /\b(?:sagging|body impression)\b[^.]*\b(?:after|within|by)\s+\d+(?:\s*[–-]\s*\d+)?\s+years?\b/i.test(line)
  );
  const saggingMatch = saggingLine?.match(/\b(\d+)(?:\s*[–-]\s*(\d+))?\s+years?\b/i) || null;
  const wearGuidance = nonWarrantyLines
    .filter((line) => /\b(?:care|rotate|support|foundation|protect|wear|soften|body impression|foam|coil|construction)\b/i.test(line))
    .map(sentenceWithPeriod)
    .slice(0, 6);
  return {
    type: "durability",
    topic: "durability",
    status,
    known: wearGuidance.length > 0 || Boolean(exactMatch) || Boolean(saggingMatch),
    exactLifespanKnown: Boolean(exactMatch),
    expectedLifespanYears: exactMatch
      ? { min: Number(exactMatch[1]), max: Number(exactMatch[2] || exactMatch[1]) }
      : null,
    exactSaggingTimelineKnown: Boolean(saggingMatch),
    saggingTimelineYears: saggingMatch
      ? { min: Number(saggingMatch[1]), max: Number(saggingMatch[2] || saggingMatch[1]) }
      : null,
    wearGuidance,
    sourceKind: sourceKey ? "approved_product_knowledge" : "unknown",
    sourceKey: clean(sourceKey) || null,
    sourcePriority: sourceKey ? 1 : 4,
    fallbackUsed: false,
  };
}

function durabilityFactSentences(fact = {}, { exactQuestion = false } = {}) {
  const output = [];
  if (exactQuestion && !fact?.exactSaggingTimelineKnown && !fact?.exactLifespanKnown) {
    output.push("I cannot verify an exact number of years before this mattress may start sagging.");
  } else if (!fact?.exactLifespanKnown) {
    output.push("I cannot verify an exact lifespan in years from the approved product facts.");
  }
  if (fact?.exactLifespanKnown && fact.expectedLifespanYears) {
    const { min, max } = fact.expectedLifespanYears;
    output.push(`The approved product facts give an expected lifespan of ${min === max ? min : `${min}-${max}`} years.`);
  }
  if (fact?.exactSaggingTimelineKnown && fact.saggingTimelineYears) {
    const { min, max } = fact.saggingTimelineYears;
    output.push(`The approved product facts give a sagging timeline of ${min === max ? min : `${min}-${max}`} years.`);
  }
  output.push(...(fact?.wearGuidance || []));
  return [...new Set(output.map(sentenceWithPeriod).filter(Boolean))];
}

function rewardFactSentences(fact = {}, query = "") {
  if (!fact?.known) {
    if (fact?.failureReason === "reward_identity_missing") {
      return ["I need a connected Snooze Code profile before I can verify your reward balance or progress."];
    }
    return ["Rewards are temporarily unavailable, so I will not guess your points, offers, or progress."];
  }
  const text = clean(query).toLowerCase();
  const summary = fact.summary || {};
  const rules = fact.rules || {};
  const output = [];
  if (/\b(?:how many points|point balance|reward balance)\b/.test(text)) {
    output.push(`You have ${Number(summary.availableSleepPoints || 0).toLocaleString("en-US")} available Sleep Points.`);
  } else if (/\b(?:earned points for|earn points for|what do i earn)\b/.test(text)) {
    const completedIds = new Set((summary.milestones || []).filter((item) => item?.completed).map((item) => clean(item?.id)));
    const milestones = (rules.milestones?.length ? rules.milestones : summary.milestones || []).slice(0, 6);
    output.push(...milestones.map((item) => `${item.label}: ${Number(item.pointAward || 0).toLocaleString("en-US")} points${item.completed || completedIds.has(clean(item.id)) ? " (completed)" : ""}.`));
  } else if (/\b(?:next badge|working toward|how close)\b/.test(text)) {
    const progress = summary.badgeProgress || {};
    output.push(progress.complete
      ? `You have reached the highest active badge, ${summary.currentBadge?.label || "your current badge"}.`
      : `You are working toward ${progress.nextBadgeLabel} and need ${Number(progress.pointsRemaining || 0).toLocaleString("en-US")} more points.`);
  } else if (/\b(?:what reward|unlocked|use my points|available offer)\b/.test(text)) {
    const unlocked = (fact.offers || []).filter((offer) => offer?.unlocked === true && clean(offer?.status).toLowerCase() === "unlocked");
    output.push(unlocked.length
      ? `Your unlocked rewards are: ${unlocked.map((offer) => clean(offer.label)).filter(Boolean).join(", ")}.`
      : "You do not have an unlocked offer showing right now.");
  } else {
    const milestones = (rules.milestones || summary.milestones || []).slice(0, 5);
    output.push("Sleep Points and badge progress come from completed showroom milestones under the active rewards rules.");
    output.push(...milestones.map((item) => `${item.label}: ${Number(item.pointAward || 0).toLocaleString("en-US")} points.`));
  }
  return [...new Set(output.map(sentenceWithPeriod).filter(Boolean))];
}

function policyFactSentences(fact = {}) {
  if (!fact?.known) return [];
  const output = [];
  if (fact.type === "warranty") {
    if (fact.term) output.push(`The mattress has a ${fact.term}.`);
    output.push(...(fact.coverage || []), ...(fact.exclusions || []), ...(fact.conditions || []));
  } else if (fact.type === "delivery") {
    if (fact.typicalWindow) output.push(`Delivery typically takes ${fact.typicalWindow}.`);
    output.push(...(fact.conditions || []));
  } else if (fact.type === "returns") {
    if (fact.trialWindow) output.push(`Mattresses include a ${fact.trialWindow}.`);
    output.push(...(fact.terms || []));
  } else {
    output.push(...(fact.terms || []));
  }
  return [...new Set(output.map(sentenceWithPeriod).filter((line) => !containsRawKnowledgeMetadata(line)))];
}

function policyFactAnswered(reply = "", fact = {}) {
  const comparable = (value) => clean(value).toLowerCase().replace(/[–—]/g, "-");
  const text = comparable(reply);
  if (!fact?.known) return /\b(?:cannot|could not|unable to)\s+(?:confirm|verify)\b/.test(text);
  if (fact.type === "warranty") return !fact.term || text.includes(comparable(fact.term));
  if (fact.type === "delivery") return !fact.typicalWindow || text.includes(comparable(fact.typicalWindow));
  if (fact.type === "returns") return !fact.trialWindow || text.includes(comparable(fact.trialWindow));
  return policyFactSentences(fact).some((sentence) => text.includes(clean(sentence).toLowerCase().replace(/[.!?]$/, "")));
}

module.exports = {
  containsRawKnowledgeMetadata,
  durabilityFactSentences,
  normalizePolicyDocument,
  normalizeDurabilityFacts,
  policyFactAnswered,
  policyFactSentences,
  rewardFactSentences,
  safeKnowledgeLines,
};
