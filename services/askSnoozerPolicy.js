const fs = require("fs");
const path = require("path");

const { loadPromptFromS3 } = require("./promptLoader");
const {
  classifyAskSnoozerPolicySubtype,
  normalizeAskSnoozerText,
} = require("./askSnoozerIntents");

const KNOWLEDGE_BUCKET = process.env.S3_KNOWLEDGE_BUCKET || "snoozer-knowledge-prod";
const KNOWLEDGE_LOCAL_ROOT = path.join(__dirname, "..", "s3 files", "snoozerknowledgeprod");
const PROMPT_LOCAL_ROOT = path.join(__dirname, "..", "s3 files", "snoozerpromptsprod");
const DEFAULT_TIMEOUT_MS = Number(process.env.S3_RETRIEVAL_TIMEOUT_MS || 300);

const localMirrorCache = new Map();

const POLICY_KEY_CANDIDATES = Object.freeze({
  returns: Object.freeze({
    policy: ["policies/returns.md"],
    skill: ["skill/returns.md", "skills/returns.md"],
  }),
  delivery: Object.freeze({
    policy: ["policies/delivery-policy.md", "policies/delivery.md"],
    skill: ["skill/delivery.md", "skills/delivery.md"],
  }),
  warranty: Object.freeze({
    policy: ["policies/warranty.md"],
    skill: ["skill/warranty.md", "skills/warranty.md"],
  }),
  financing: Object.freeze({
    policy: [],
    skill: ["skill/financing.md", "skills/financing.md"],
  }),
  pricing: Object.freeze({
    policy: [],
    skill: ["skill/pricing.md", "skills/pricing.md"],
  }),
  general_policy: Object.freeze({
    policy: ["faq/general.md"],
    skill: [],
  }),
});

function tryRequireOpenAi() {
  try {
    return require("./openai");
  } catch {
    return null;
  }
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMarkdown(raw) {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^\\##/gm, "##")
    .replace(/^\\-/gm, "-")
    .replace(/\\([#*_`[\]()])/g, "$1")
    .replace(/&nbsp;/g, " ");
}

function stripFrontMatter(raw) {
  const text = normalizeMarkdown(raw);
  if (!text.startsWith("---")) return text;
  const closingIndex = text.indexOf("\n---", 3);
  if (closingIndex === -1) return text;
  return text.slice(closingIndex + 4).trim();
}

function cleanShopperText(raw) {
  return String(raw || "")
    .replace(/^\s*[-*]\s*/gm, "")
    .replace(/^\s*\|.*$/gm, "")
    .replace(/[*_`>#]/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function clampReply(text, fallback = "") {
  const cleaned = cleanShopperText(text);
  if (!cleaned) return String(fallback || "").trim();

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const picked = sentences.slice(0, 2).join(" ").trim();
  if (picked && picked.length <= 220) return picked;
  return cleaned.slice(0, 217).trim().replace(/[,:;]$/, "") + "...";
}

function extractSection(raw, headings = []) {
  const body = stripFrontMatter(raw);
  const lines = body.split("\n");
  const normalizedHeadings = headings
    .map((heading) => normalizeAskSnoozerText(heading))
    .filter(Boolean);

  let startIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const normalizedLine = normalizeAskSnoozerText(lines[index].replace(/^#+\s*/, ""));
    if (normalizedHeadings.some((heading) => normalizedLine.includes(heading))) {
      startIndex = index + 1;
      break;
    }
  }

  if (startIndex === -1) return "";

  const out = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*---\s*$/.test(line)) break;
    if (/^\s*##\s+/.test(line)) break;
    out.push(line);
  }

  return out.join("\n").trim();
}

function extractFaqSection(raw, questionTerms = []) {
  const body = stripFrontMatter(raw);
  const lines = body.split("\n");
  const normalizedTerms = questionTerms.map((term) => normalizeAskSnoozerText(term)).filter(Boolean);

  let startIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*##/.test(line)) continue;
    const normalizedLine = normalizeAskSnoozerText(line.replace(/^#+\s*/, ""));
    if (normalizedTerms.some((term) => normalizedLine.includes(term))) {
      startIndex = index + 1;
      break;
    }
  }

  if (startIndex === -1) return "";

  const out = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*---\s*$/.test(line)) break;
    if (/^\s*##\s+/.test(line)) break;
    out.push(line);
  }

  return out.join("\n").trim();
}

function extractFirstBulletsUnderHeading(raw, headings = []) {
  const section = extractSection(raw, headings);
  if (!section) return "";

  const bullets = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 2);

  return bullets.join(" ");
}

function extractBulletItemsUnderHeading(raw, headings = []) {
  const section = extractSection(raw, headings);
  if (!section) return [];

  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => cleanShopperText(line.replace(/^[-*]\s+/, "").trim()))
    .filter(Boolean)
    .slice(0, 3);
}

function extractHints(raw) {
  const text = normalizeMarkdown(raw);
  const match = text.match(/hints:\s*([\s\S]*?)(?:\n---|\n##|\n[A-Za-z0-9_-]+:)/i);
  if (!match) return [];

  return match[1]
    .split("\n")
    .map((line) => cleanShopperText(line.replace(/^[\s-]+/, "").replace(/^["']|["']$/g, "")))
    .filter(Boolean)
    .slice(0, 4)
    .map((value) => ({
      label: value,
      value,
    }));
}

function buildFallbackPolicyReply(policySubtype) {
  switch (String(policySubtype || "").trim()) {
    case "returns":
      return "Return options can vary by item and order details. Check the return terms before you decide so you know exactly what applies.";
    case "delivery":
      return "Delivery details can vary by order, area, and setup needs. Check the current delivery information before you place the order.";
    case "warranty":
      return "Warranty coverage depends on the product and the claim details. Review the current warranty terms so you know exactly what is covered.";
    case "financing":
      return "Financing options may be available, but exact offers and approval terms can change. Check the current financing details before you decide.";
    case "pricing":
      return "Pricing can depend on the product, size, and delivery setup. Check the current details before you make the final call.";
    default:
      return "Policy details can affect timing, fees, or coverage, so check the current terms before you decide.";
  }
}

function buildReturnsReply(raw, query) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  if (normalizedQuery.includes("refund")) {
    const refundSection = extractSection(raw, ["Refund Process"]);
    if (refundSection) {
      return clampReply(
        refundSection,
        "Refund timing can vary by order details, so review the return terms before you decide."
      );
    }
  }

  if (normalizedQuery.includes("dont like") || normalizedQuery.includes("don't like")) {
    const overview = extractSection(raw, ["Overview"]);
    if (overview) return clampReply(overview, buildFallbackPolicyReply("returns"));
  }

  return (
    clampReply(extractSection(raw, ["Overview"])) ||
    clampReply(extractFaqSection(raw, ["what s your return policy", "how long do refunds take"])) ||
    buildFallbackPolicyReply("returns")
  );
}

function buildDeliveryReply(raw, query) {
  const normalizedQuery = normalizeAskSnoozerText(query);

  if (
    normalizedQuery.includes("how much") ||
    normalizedQuery.includes("fee") ||
    normalizedQuery.includes("free")
  ) {
    const fees = extractSection(raw, ["Delivery Fees", "Is delivery free"]);
    if (fees) {
      return "Delivery pricing depends on the order and service area, and basic delivery may be included on qualifying orders. Confirm the exact fee before you place the order.";
    }
  }

  if (
    normalizedQuery.includes("setup") ||
    normalizedQuery.includes("white glove") ||
    normalizedQuery.includes("remove")
  ) {
    const options = extractSection(raw, ["Delivery Options", "Do you offer setup", "Will you remove"]);
    if (options) return clampReply(options, buildFallbackPolicyReply("delivery"));
  }

  if (
    normalizedQuery.includes("track") ||
    normalizedQuery.includes("schedule") ||
    normalizedQuery.includes("how long")
  ) {
    const timing =
      extractFaqSection(raw, ["how long does delivery take", "how do i track"]) ||
      extractSection(raw, ["Scheduling & Tracking", "Overview"]);
    if (timing) return clampReply(timing, buildFallbackPolicyReply("delivery"));
  }

  return (
    clampReply(extractSection(raw, ["Overview"])) ||
    clampReply(extractFaqSection(raw, ["how long does delivery take", "who handles delivery"])) ||
    buildFallbackPolicyReply("delivery")
  );
}

function buildWarrantyReply(raw, query) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const warrantyBullets = extractBulletItemsUnderHeading(raw, ["Mattress Warranty"]);

  if (normalizedQuery.includes("cover")) {
    const coverage =
      extractFaqSection(raw, ["what does the warranty cover"]) ||
      (warrantyBullets[1]
        ? `It covers ${warrantyBullets[1].replace(/^Covers\s+/i, "").replace(/including:\s*$/i, "including qualifying defects.")}`
        : extractFirstBulletsUnderHeading(raw, ["Mattress Warranty"]));
    if (coverage) return clampReply(coverage, buildFallbackPolicyReply("warranty"));
  }

  if (normalizedQuery.includes("claim")) {
    const claims = extractSection(raw, ["How to Claim"]) || extractFaqSection(raw, ["how do i file a warranty claim"]);
    if (claims) return clampReply(claims, buildFallbackPolicyReply("warranty"));
  }

  if (warrantyBullets.length > 0) {
    const lead = warrantyBullets[0].replace(/\s*\.$/, "");
    const followUp = warrantyBullets[1]
      ? warrantyBullets[1]
          .replace(/^Covers\s+/i, "It covers ")
          .replace(/including:\s*$/i, "including qualifying defects.")
      : "It covers qualifying defects in materials or workmanship.";
    return clampReply(`${lead}. ${followUp}`, buildFallbackPolicyReply("warranty"));
  }

  return (
    clampReply(extractFirstBulletsUnderHeading(raw, ["Mattress Warranty"])) ||
    clampReply(extractFaqSection(raw, ["how long is the warranty"])) ||
    clampReply(extractSection(raw, ["Reply"])) ||
    buildFallbackPolicyReply("warranty")
  );
}

function buildFinancingReply(raw, query) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const replySection = extractSection(raw, ["Reply"]) || extractSection(raw, ["Summary"]);
  const baseReply = clampReply(replySection, buildFallbackPolicyReply("financing"));

  if (
    normalizedQuery.includes("no money down") &&
    !/no money down/i.test(baseReply)
  ) {
    const lead = baseReply.split(/(?<=[.!?])\s+/).slice(0, 1).join(" ").trim();
    return clampReply(
      `${lead} Check the exact approval terms and current offer details before you decide.`,
      buildFallbackPolicyReply("financing")
    );
  }

  return baseReply;
}

function buildPricingReply(raw) {
  return (
    clampReply(extractSection(raw, ["Reply"])) ||
    clampReply(extractSection(raw, ["Summary"])) ||
    buildFallbackPolicyReply("pricing")
  );
}

function buildGeneralPolicyReply(raw) {
  return (
    clampReply(extractFaqSection(raw, ["what s the return policy", "how long does delivery take"])) ||
    clampReply(extractSection(raw, ["Overview", "Reply"])) ||
    buildFallbackPolicyReply("general_policy")
  );
}

function readLocalMirror(root, key) {
  const normalizedKey = String(key || "").replace(/^\/+/, "");
  const cacheKey = `${root}:${normalizedKey}`;
  if (localMirrorCache.has(cacheKey)) return localMirrorCache.get(cacheKey);

  const candidates = [normalizedKey];
  if (normalizedKey.startsWith("skill/")) {
    candidates.push(normalizedKey.replace(/^skill\//, "skills/"));
  }
  if (normalizedKey.startsWith("skills/")) {
    candidates.push(normalizedKey.replace(/^skills\//, "skill/"));
  }
  if (normalizedKey === "policies/delivery-policy.md") {
    candidates.push("policies/delivery.md");
  }

  for (const candidate of candidates) {
    const absolute = path.join(root, candidate);
    if (!fs.existsSync(absolute)) continue;
    const raw = fs.readFileSync(absolute, "utf8");
    const normalized = normalizeMarkdown(raw);
    localMirrorCache.set(cacheKey, { value: normalized, key: candidate });
    return { value: normalized, key: candidate };
  }

  localMirrorCache.set(cacheKey, null);
  return null;
}

async function loadKnowledgeCandidates(keys, options = {}) {
  const openaiHelpers = tryRequireOpenAi();
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;

  for (const key of keys) {
    if (openaiHelpers && typeof openaiHelpers.getObjectText === "function") {
      const result = await openaiHelpers.getObjectText(KNOWLEDGE_BUCKET, key, { timeoutMs });
      if (result?.value) {
        return {
          raw: normalizeMarkdown(result.value),
          source: "s3_policy",
          key,
        };
      }
    }

    const local = readLocalMirror(KNOWLEDGE_LOCAL_ROOT, key);
    if (local?.value) {
      return {
        raw: local.value,
        source: "local_policy",
        key: local.key || key,
      };
    }
  }

  return null;
}

async function loadPromptCandidates(keys, options = {}) {
  const reqId = String(options.traceId || "").trim() || undefined;

  for (const key of keys) {
    const loaded = await loadPromptFromS3(key, { reqId });
    if (loaded) {
      return {
        raw: normalizeMarkdown(loaded),
        source: "s3_skill",
        key,
      };
    }

    const local = readLocalMirror(PROMPT_LOCAL_ROOT, key);
    if (local?.value) {
      return {
        raw: local.value,
        source: "local_skill",
        key: local.key || key,
      };
    }
  }

  return null;
}

function buildReplyFromRetrievedContent({ policySubtype, raw, query }) {
  switch (String(policySubtype || "").trim()) {
    case "returns":
      return buildReturnsReply(raw, query);
    case "delivery":
      return buildDeliveryReply(raw, query);
    case "warranty":
      return buildWarrantyReply(raw, query);
    case "financing":
      return buildFinancingReply(raw, query);
    case "pricing":
      return buildPricingReply(raw, query);
    default:
      return buildGeneralPolicyReply(raw, query);
  }
}

async function resolveAskSnoozerPolicyAnswer({ query = "", traceId = "", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const policySubtype = classifyAskSnoozerPolicySubtype(query);
  const keys = POLICY_KEY_CANDIDATES[policySubtype] || POLICY_KEY_CANDIDATES.general_policy;

  const policyMatch = await loadKnowledgeCandidates(keys.policy, { timeoutMs, traceId });
  if (policyMatch?.raw) {
    return {
      policySubtype,
      reply: buildReplyFromRetrievedContent({
        policySubtype,
        raw: policyMatch.raw,
        query,
      }),
      chips: [],
      retrieved: true,
      source: policyMatch.source,
      key: policyMatch.key,
      sourceKind: "policy",
    };
  }

  const skillMatch = await loadPromptCandidates(keys.skill, { timeoutMs, traceId });
  if (skillMatch?.raw) {
    return {
      policySubtype,
      reply: buildReplyFromRetrievedContent({
        policySubtype,
        raw: skillMatch.raw,
        query,
      }),
      chips: extractHints(skillMatch.raw),
      retrieved: true,
      source: skillMatch.source,
      key: skillMatch.key,
      sourceKind: "skill",
    };
  }

  return {
    policySubtype,
    reply: buildFallbackPolicyReply(policySubtype),
    chips: [],
    retrieved: false,
    source: "fallback",
    key: "",
    sourceKind: "fallback",
  };
}

module.exports = {
  classifyAskSnoozerPolicySubtype,
  resolveAskSnoozerPolicyAnswer,
};
