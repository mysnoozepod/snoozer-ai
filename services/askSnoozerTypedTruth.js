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

function normalizePolicyDocument({ topic = "", raw = "", fallback = "", status = "verified_fact" } = {}) {
  const normalizedTopic = clean(topic).toLowerCase();
  const lines = safeKnowledgeLines(raw || fallback, { limit: 20 });
  const fact = { type: normalizedTopic, status, known: lines.length > 0 };
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
  normalizePolicyDocument,
  policyFactAnswered,
  policyFactSentences,
  safeKnowledgeLines,
};
