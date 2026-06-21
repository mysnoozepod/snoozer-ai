const fs = require("fs");
const path = require("path");

const { getLocalMirrorCandidates } = require("./knowledgeKeyAliases");
const { loadPromptFromS3 } = require("./promptLoader");
const {
  buildNoGuessReply,
  buildPolicyLaneLead,
  joinReplyParts,
} = require("./askSnoozerResponsePresenter");
const {
  classifyAskSnoozerPolicySubtype,
  normalizeAskSnoozerText,
} = require("./askSnoozerIntents");

const KNOWLEDGE_BUCKET = process.env.S3_KNOWLEDGE_BUCKET || "snoozer-knowledge-prod";
const KNOWLEDGE_LOCAL_ROOT = path.join(__dirname, "..", "s3 files", "snoozerknowledgeprod");
const PROMPT_LOCAL_ROOT = path.join(__dirname, "..", "s3 files", "snoozerpromptsprod");
const DEFAULT_TIMEOUT_MS = Number(process.env.S3_RETRIEVAL_TIMEOUT_MS || 300);
const PREFER_LOCAL_KNOWLEDGE =
  String(process.env.ASK_SNOOZER_PREFER_LOCAL_KNOWLEDGE || "").trim() === "1";

const localMirrorCache = new Map();
const remoteKnowledgeMissCache = new Set();
const remotePromptMissCache = new Set();

const POLICY_KEY_CANDIDATES = Object.freeze({
  returns: Object.freeze({
    policy: ["policies/returns.md", "faq/returns.md"],
    skill: ["skills/returns.md"],
  }),
  delivery: Object.freeze({
    policy: ["policies/delivery-policy.md", "faq/delivery.md"],
    skill: ["skills/delivery.md"],
  }),
  warranty: Object.freeze({
    policy: ["policies/warranty.md", "faq/warranty.md"],
    skill: ["skills/warranty.md"],
  }),
  financing: Object.freeze({
    policy: [],
    skill: ["skills/financing.md"],
  }),
  pricing: Object.freeze({
    policy: [],
    skill: ["skills/pricing.md"],
  }),
  general_policy: Object.freeze({
    policy: ["faq/general.md"],
    skill: [],
  }),
});

const SUPPLEMENTAL_SOURCE_CANDIDATES = Object.freeze({
  assessment_handoff: Object.freeze({
    knowledge: [],
    skill: [
      "skills/help_me_choose.md",
      "skills/where_to_start.md",
    ],
  }),
  split_education: Object.freeze({
    knowledge: ["products/mattress/12-dual-comfort-hybrid.md"],
    skill: [],
  }),
});

const PRODUCT_DOC_KEYS_BY_HANDLE = Object.freeze({
  "10-all-foam-mattress": Object.freeze(["products/mattress/10-all-foam-mattress.md"]),
  "12-all-foam-mattress": Object.freeze(["products/mattress/12-all-foam-mattress.md"]),
  "12-dual-comfort-hybrid": Object.freeze(["products/mattress/12-dual-comfort-hybrid.md"]),
  "14-hybrid": Object.freeze(["products/mattress/14-hybrid.md"]),
  "premium-motion-adjustable-base": Object.freeze([
    "products/bases/premium-motion-adjustable-base.md",
  ]),
  "platform-base": Object.freeze(["products/bases/platform-base.md"]),
});

const SPLIT_EDUCATION_TERMS = Object.freeze([
  "half split",
  "split mattress",
  "split head mattress",
  "flex head mattress",
  "split comfort",
  "split king",
]);

const ASSESSMENT_SOURCE_TERMS = Object.freeze([
  "help me find",
  "help me choose",
  "help me pick",
  "where should i start",
  "what mattress should i get",
  "recommend a mattress",
  "find me a good bed",
  "i need a good mattress",
]);

const BRAND_SOURCE_FACTS = Object.freeze({
  snoozepod: Object.freeze({
    title: "SnoozePod",
    key: "brand:snoozepod",
    facts: [
      "A SnoozePod is the full sleep setup around your mattress, base, pillows, and accessories.",
      "It is built around how you sleep so the mattress, base, and add-ons work together instead of being chosen separately.",
    ],
  }),
  snoozer: Object.freeze({
    title: "Snoozer",
    key: "brand:snoozer",
    facts: [
      "Snoozer is the MySnoozePod shopping guide inside the HUD.",
      "He helps you compare mattresses, sizing, pricing, policies, and next steps without guessing.",
    ],
  }),
  snooze_session: Object.freeze({
    title: "Snooze Session",
    key: "brand:snooze-session",
    facts: [
      "A Snooze Session is the in-person feel test so you can try beds before deciding.",
      "It is the best next step when you want to compare support, motion, or adjustable-base setup in person.",
    ],
  }),
  snooze_assessment: Object.freeze({
    title: "Snooze Assessment",
    key: "brand:snooze-assessment",
    facts: [
      "The Snooze Assessment is a short guided flow that narrows size, motion, and mattress direction.",
      "It is the fastest way to start when you know you need help but do not want to guess.",
    ],
  }),
  rest_test: Object.freeze({
    title: "Rest Test",
    key: "brand:rest-test",
    facts: [
      "A Rest Test is the guided time-on-bed comparison so you can notice support, pressure relief, and movement before you choose.",
      "It is meant to help you feel the difference instead of trying to decide from specs alone.",
    ],
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

function previewText(text, maxChars = 160) {
  const cleaned = cleanShopperText(text);
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 3).trim()}...`;
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

function buildGroundedResult(reply, matchedPreview, extra = {}) {
  return {
    reply: clampReply(reply, extra.fallback || ""),
    matched: Boolean(String(matchedPreview || "").trim()),
    answerGrounded: Boolean(String(matchedPreview || "").trim()),
    matchedPreview: previewText(matchedPreview),
    ...extra,
  };
}

function buildUngroundedResult(reply, extra = {}) {
  return {
    reply: clampReply(reply, extra.fallback || ""),
    matched: false,
    answerGrounded: false,
    matchedPreview: "",
    ...extra,
  };
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

function hasAnyQueryTerm(query, terms = []) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return terms.some((term) => normalizedQuery.includes(normalizeAskSnoozerText(term)));
}

function hasAnyNormalizedTerm(text, terms = []) {
  return terms.some((term) => text.includes(normalizeAskSnoozerText(term)));
}

function extractProductHandleFromPath(pathValue = "") {
  const match = String(pathValue || "").trim().match(/^\/products\/([^/?#]+)/i);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1] || "").trim().toLowerCase();
  } catch {
    return String(match[1] || "").trim().toLowerCase();
  }
}

function getAskSnoozerProductDocKey(handle = "") {
  const normalized = String(handle || "").trim().toLowerCase();
  const keys = PRODUCT_DOC_KEYS_BY_HANDLE[normalized];
  return Array.isArray(keys) && keys.length ? keys[0] : "";
}

function inferAskSnoozerProductDocCategory(handle = "") {
  const normalized = String(handle || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("pillow")) return "pillows";
  if (
    normalized.includes("sheet") ||
    normalized.includes("protector") ||
    normalized.includes("bedding") ||
    normalized.includes("encasement")
  ) {
    return "bedding";
  }
  if (
    normalized.includes("base") ||
    normalized.includes("motion") ||
    normalized.includes("foundation") ||
    normalized.includes("frame")
  ) {
    return "bases";
  }
  if (
    normalized.includes("mattress") ||
    normalized.includes("hybrid") ||
    normalized.includes("foam") ||
    normalized.includes("dual-comfort")
  ) {
    return "mattress";
  }
  return "";
}

function getAskSnoozerProductDocKeys(handle = "") {
  const normalized = String(handle || "").trim().toLowerCase();
  if (!normalized) return [];

  const directKeys = PRODUCT_DOC_KEYS_BY_HANDLE[normalized];
  if (Array.isArray(directKeys) && directKeys.length) return directKeys.slice();

  const inferredCategory = inferAskSnoozerProductDocCategory(normalized);
  if (!inferredCategory) return [];

  return [`products/${inferredCategory}/${normalized}.md`];
}

async function loadProductKnowledgeSources(handles = [], options = {}) {
  const out = [];
  const seen = new Set();

  for (const handle of Array.isArray(handles) ? handles : []) {
    const keys = getAskSnoozerProductDocKeys(handle);
    if (!keys.length) continue;

    const dedupeKey = keys.join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const loaded = await loadKnowledgeCandidates(keys, options);
    if (!loaded?.raw) continue;

    out.push(
      buildSourceRecord({
        raw: loaded.raw,
        source:
          loaded.source === "s3_policy"
            ? "s3_knowledge"
            : loaded.source === "local_policy"
              ? "local_knowledge"
              : loaded.source,
        key: loaded.key,
        sourceKind: "knowledge",
        policySubtype: "",
      })
    );
  }

  return out;
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

function extractSourceTitle(raw, fallbackKey = "") {
  const text = normalizeMarkdown(raw);
  const frontMatterTitle = text.match(/^\s*title:\s*(.+)$/im);
  if (frontMatterTitle?.[1]) {
    return cleanShopperText(frontMatterTitle[1].replace(/^["']|["']$/g, ""));
  }

  const leadingTitle = text.match(/^\s*Title:\s*(.+)$/im);
  if (leadingTitle?.[1]) {
    return cleanShopperText(leadingTitle[1].replace(/^["']|["']$/g, ""));
  }

  const headingTitle = stripFrontMatter(text).match(/^\s*#+\s+(.+)$/m);
  if (headingTitle?.[1]) {
    return cleanShopperText(headingTitle[1]);
  }

  return cleanShopperText(String(fallbackKey || "").split("/").pop().replace(/\.md$/i, ""));
}

function buildSourceRecord({ raw = "", source = "", key = "", sourceKind = "", policySubtype = "" } = {}) {
  return {
    source_type: String(source || "").trim() || "fallback",
    source_key: String(key || "").trim() || "",
    source_kind: String(sourceKind || "").trim() || "",
    policy_subtype: String(policySubtype || "").trim() || "",
    title: extractSourceTitle(raw, key),
    text: normalizeMarkdown(raw),
    facts: [],
  };
}

function buildFactSourceRecord({
  title = "",
  key = "",
  sourceType = "local_brand",
  sourceKind = "knowledge",
  facts = [],
} = {}) {
  const normalizedFacts = Array.isArray(facts)
    ? facts.map((fact) => cleanShopperText(fact)).filter(Boolean)
    : [];

  return {
    source_type: String(sourceType || "").trim() || "fallback",
    source_key: String(key || "").trim() || "",
    source_kind: String(sourceKind || "").trim() || "",
    policy_subtype: "",
    title: cleanShopperText(title),
    text: normalizedFacts.join("\n"),
    facts: normalizedFacts.map((fact, index) => ({
      text: fact,
      heading: cleanShopperText(title),
      kind: "fact",
      order: index,
    })),
  };
}

function resolveBrandFactRecords(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const out = [];

  if (/(snoozepod|sleep pod)/.test(normalizedQuery)) {
    out.push(buildFactSourceRecord(BRAND_SOURCE_FACTS.snoozepod));
  }

  if (/(ask snoozer|who is snoozer|what is snoozer|\bsnoozer\b)/.test(normalizedQuery)) {
    out.push(buildFactSourceRecord(BRAND_SOURCE_FACTS.snoozer));
  }

  if (/snooze session/.test(normalizedQuery)) {
    out.push(buildFactSourceRecord(BRAND_SOURCE_FACTS.snooze_session));
  }

  if (/snooze assessment/.test(normalizedQuery)) {
    out.push(buildFactSourceRecord(BRAND_SOURCE_FACTS.snooze_assessment));
  }

  if (/rest test/.test(normalizedQuery)) {
    out.push(buildFactSourceRecord(BRAND_SOURCE_FACTS.rest_test));
  }

  return out;
}

function buildFallbackPolicyReply(policySubtype) {
  switch (String(policySubtype || "").trim()) {
    case "returns":
      return buildNoGuessReply("return_policy");
    case "delivery":
      return buildNoGuessReply("delivery");
    case "warranty":
      return buildNoGuessReply("warranty");
    case "financing":
      return buildNoGuessReply("financing");
    case "pricing":
      return buildNoGuessReply("pricing");
    default:
      return buildNoGuessReply("detail");
  }
}

function buildReturnsReply(raw, query) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const overview = extractSection(raw, ["Overview"]);
  const eligibility = extractSection(raw, ["Eligibility"]);
  const nonReturnable = extractSection(raw, ["Non-Returnable Items"]);
  const refundSection = extractSection(raw, ["Refund Process"]);
  const startReturn = extractSection(raw, ["How to Start a Return"]);

  if (
    hasAnyQueryTerm(normalizedQuery, [
      "adjustable base",
      "motion base",
      "base",
      "adjustable frame",
      "frame",
      "pillows",
      "pillow",
      "bedding",
      "accessories",
    ])
  ) {
    const detail = nonReturnable || overview;
    if (detail) {
      return buildGroundedResult(
        "Motion bases, adjustable frames, bedding, pillows, and accessories are final sale once opened or delivered. The 100-night sleep trial applies to mattress purchases only.",
        detail,
        { fallback: buildFallbackPolicyReply("returns") }
      );
    }
  }

  if (normalizedQuery.includes("refund")) {
    if (
      refundSection &&
      (normalizedQuery.includes("how long") || normalizedQuery.includes("when"))
    ) {
      return buildGroundedResult(
        "Refunds are usually processed within 3 to 5 business days after pickup, and the original payment method is used unless something else is arranged.",
        refundSection,
        { fallback: buildFallbackPolicyReply("returns") }
      );
    }

    if (overview || refundSection) {
      return buildGroundedResult(
        joinReplyParts([
          "Our sleep trial is handled through the return policy.",
          "Mattresses come with a 100-night sleep trial and can be returned or exchanged one time within that window.",
          "Refunds are usually processed within 3 to 5 business days after pickup.",
        ]),
        `${overview}\n${refundSection}`.trim(),
        { fallback: buildFallbackPolicyReply("returns") }
      );
    }

    return buildUngroundedResult(
      buildFallbackPolicyReply("returns"),
      { fallback: buildFallbackPolicyReply("returns") }
    );
  }

  if (normalizedQuery.includes("dont like") || normalizedQuery.includes("don't like")) {
    if (overview || eligibility) {
      return buildGroundedResult(
        joinReplyParts([
          "Yes - that falls under the return policy.",
          "Mattresses come with a 100-night sleep trial and can be returned or exchanged one time within that window.",
          "The mattress needs to stay in good condition.",
        ]),
        `${overview}\n${eligibility}`.trim(),
        { fallback: buildFallbackPolicyReply("returns") }
      );
    }
  }

  if (overview || startReturn) {
    return buildGroundedResult(
      joinReplyParts([
        buildPolicyLaneLead({ query, policyTopic: "return_policy" }),
        "Mattresses come with a 100-night sleep trial and can be returned or exchanged one time within that window.",
        "If you need to start a return, Snoozer or the store can help arrange pickup.",
      ]),
      `${overview}\n${startReturn}`.trim(),
      { fallback: buildFallbackPolicyReply("returns") }
    );
  }

  return buildUngroundedResult(
    buildFallbackPolicyReply("returns"),
    { fallback: buildFallbackPolicyReply("returns") }
  );
}

function buildDeliveryReply(raw, query) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const overview = extractSection(raw, ["Overview"]);
  const options = extractSection(raw, ["Delivery Options"]);
  const fees = extractSection(raw, ["Delivery Fees", "Is delivery free"]);
  const scheduling = extractSection(raw, ["Scheduling & Tracking"]);

  if (
    normalizedQuery.includes("how much") ||
    normalizedQuery.includes("fee") ||
    normalizedQuery.includes("free")
  ) {
    if (fees) {
      return buildGroundedResult(
        "Delivery pricing depends on the order and service area, and basic delivery may be included on qualifying orders. Confirm the exact fee before you place the order.",
        fees,
        { fallback: buildFallbackPolicyReply("delivery") }
      );
    }
  }

  if (
    normalizedQuery.includes("setup") ||
    normalizedQuery.includes("white glove") ||
    normalizedQuery.includes("remove")
  ) {
    const setupDetail = options || extractFaqSection(raw, ["do you offer setup", "will you remove my old mattress"]);
    if (setupDetail) {
      return buildGroundedResult(
        "You can add in-room setup, assembly, and packaging removal, and old mattress removal is available on request.",
        setupDetail,
        { fallback: buildFallbackPolicyReply("delivery") }
      );
    }
  }

  if (
    normalizedQuery.includes("track") ||
    normalizedQuery.includes("schedule") ||
    normalizedQuery.includes("how long")
  ) {
    const timing =
      extractFaqSection(raw, ["how long does delivery take", "how do i track"]) ||
      scheduling ||
      overview;
    if (timing) {
      return buildGroundedResult(
        "Most orders arrive in about 3 to 7 business days, and scheduling is handled by text or email once the order is ready.",
        timing,
        { fallback: buildFallbackPolicyReply("delivery") }
      );
    }
  }

  if (overview || options) {
    return buildGroundedResult(
      "Orders are delivered through trusted local carriers, with standard delivery usually running 3 to 7 business days. White-glove setup and old mattress removal can also be added when needed.",
      `${overview}\n${options}`.trim(),
      { fallback: buildFallbackPolicyReply("delivery") }
    );
  }

  return buildUngroundedResult(
    buildFallbackPolicyReply("delivery"),
    { fallback: buildFallbackPolicyReply("delivery") }
  );
}

function buildWarrantyReply(raw, query) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const warrantyBullets = extractBulletItemsUnderHeading(raw, ["Mattress Warranty"]);
  const motionBaseBullets = extractBulletItemsUnderHeading(raw, ["Motion Base Warranty"]);
  const claimSection = extractSection(raw, ["How to Claim"]);
  const exclusions = extractSection(raw, ["Exclusions"]);

  if (hasAnyQueryTerm(normalizedQuery, ["adjustable base", "motion base", "base"])) {
    if (motionBaseBullets.length > 0) {
      return buildGroundedResult(
        "Motion bases carry a 10-year limited warranty. The first year includes full coverage, and later coverage is limited to parts.",
        motionBaseBullets.join(" "),
        { fallback: buildFallbackPolicyReply("warranty") }
      );
    }
  }

  if (normalizedQuery.includes("cover")) {
    const coverage =
      extractFaqSection(raw, ["what does the warranty cover"]) ||
      (warrantyBullets[1]
        ? `It covers ${warrantyBullets[1].replace(/^Covers\s+/i, "").replace(/including:\s*$/i, "including qualifying defects.")}`
        : extractFirstBulletsUnderHeading(raw, ["Mattress Warranty"]));
    if (coverage) {
      return buildGroundedResult(
        clampReply(coverage, buildFallbackPolicyReply("warranty")),
        coverage,
        { fallback: buildFallbackPolicyReply("warranty") }
      );
    }
  }

  if (normalizedQuery.includes("claim")) {
    const claims = claimSection || extractFaqSection(raw, ["how do i file a warranty claim"]);
    if (claims) {
      return buildGroundedResult(
        "The warranty guidance says to contact MySnoozePod Customer Care with proof of purchase and photos of the issue. From there, the claim can lead to repair, replacement, or a comparable substitute.",
        claims,
        { fallback: buildFallbackPolicyReply("warranty") }
      );
    }
  }

  if (normalizedQuery.includes("not covered") || normalizedQuery.includes("excluded")) {
    if (exclusions) {
      return buildGroundedResult(
        "The warranty does not cover normal wear, stains, misuse, or unauthorized modifications. It is meant for defects in materials or workmanship, not comfort preference changes.",
        exclusions,
        { fallback: buildFallbackPolicyReply("warranty") }
      );
    }
  }

  if (warrantyBullets.length > 0) {
    return buildGroundedResult(
      "Yes. Mattresses are covered by a 10-year limited warranty against defects in materials or workmanship. Motion bases have their own 10-year limited coverage, with fuller coverage in the first year.",
      `${warrantyBullets.join(" ")} ${motionBaseBullets.join(" ")}`.trim(),
      { fallback: buildFallbackPolicyReply("warranty") }
    );
  }

  return buildUngroundedResult(
    buildFallbackPolicyReply("warranty"),
    { fallback: buildFallbackPolicyReply("warranty") }
  );
}

function buildFinancingReply(raw, query) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const replySection = extractSection(raw, ["Reply"]) || extractSection(raw, ["Summary"]);
  const keyFacts = extractSection(raw, ["Key Facts"]);
  const groundedBlock = `${replySection}\n${keyFacts}`.trim();

  if (
    normalizedQuery.includes("no money down") &&
    !/no money down/i.test(groundedBlock)
  ) {
    return buildGroundedResult(
      "I do not see an exact no-money-down promise in the approved financing detail. Monthly payment options and 0% APR plans may still be available for qualified customers.",
      groundedBlock,
      { fallback: buildFallbackPolicyReply("financing") }
    );
  }

  if (normalizedQuery.includes("monthly")) {
    return buildGroundedResult(
      "Monthly payment options may be available, and some shoppers may qualify for 0% APR plans. Exact approval terms and minimum purchase requirements come from the financing provider.",
      groundedBlock,
      { fallback: buildFallbackPolicyReply("financing") }
    );
  }

  if (replySection || keyFacts) {
    return buildGroundedResult(
      "Flexible monthly payment options may be available, including 0% APR plans for qualified customers. Exact approval terms come from the financing provider.",
      groundedBlock,
      { fallback: buildFallbackPolicyReply("financing") }
    );
  }

  return buildUngroundedResult(
    buildFallbackPolicyReply("financing"),
    { fallback: buildFallbackPolicyReply("financing") }
  );
}

function buildPricingReply(raw) {
  const replySection = extractSection(raw, ["Reply"]) || extractSection(raw, ["Summary"]);
  if (replySection) {
    return buildGroundedResult(
      clampReply(replySection, buildFallbackPolicyReply("pricing")),
      replySection,
      { fallback: buildFallbackPolicyReply("pricing") }
    );
  }

  return buildUngroundedResult(
    buildFallbackPolicyReply("pricing"),
    { fallback: buildFallbackPolicyReply("pricing") }
  );
}

function buildGeneralPolicyReply(raw) {
  const section =
    extractFaqSection(raw, ["what s the return policy", "how long does delivery take"]) ||
    extractSection(raw, ["Overview", "Reply"]);

  if (section) {
    return buildGroundedResult(
      clampReply(section, buildFallbackPolicyReply("general_policy")),
      section,
      { fallback: buildFallbackPolicyReply("general_policy") }
    );
  }

  return buildUngroundedResult(
    buildFallbackPolicyReply("detail"),
    { fallback: buildFallbackPolicyReply("general_policy") }
  );
}

function readLocalMirror(root, key) {
  const normalizedKey = String(key || "").replace(/^\/+/, "");
  const cacheKey = `${root}:${normalizedKey}`;
  if (localMirrorCache.has(cacheKey)) return localMirrorCache.get(cacheKey);

  const bucketType = root === PROMPT_LOCAL_ROOT ? "prompt" : "knowledge";
  const candidates = getLocalMirrorCandidates(bucketType, normalizedKey);

  for (const candidate of candidates) {
    const absolute = path.join(root, candidate);
    if (!fs.existsSync(absolute)) continue;
    const raw = fs.readFileSync(absolute, "utf8");
    const normalized = normalizeMarkdown(raw);
    const resolved = { value: normalized, key: normalizedKey, resolvedKey: candidate };
    localMirrorCache.set(cacheKey, resolved);
    return resolved;
  }

  localMirrorCache.set(cacheKey, null);
  return null;
}

async function loadKnowledgeCandidates(keys, options = {}) {
  const openaiHelpers = tryRequireOpenAi();
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;

  for (const key of keys) {
    if (PREFER_LOCAL_KNOWLEDGE) {
      const preferredLocal = readLocalMirror(KNOWLEDGE_LOCAL_ROOT, key);
      if (preferredLocal?.value) {
        return {
          raw: preferredLocal.value,
          source: "local_policy",
          key: preferredLocal.key || key,
        };
      }
    }

    if (
      openaiHelpers &&
      typeof openaiHelpers.getObjectText === "function" &&
      !remoteKnowledgeMissCache.has(key)
    ) {
      const result = await openaiHelpers.getObjectText(KNOWLEDGE_BUCKET, key, { timeoutMs });
      if (result?.value) {
        return {
          raw: normalizeMarkdown(result.value),
          source: "s3_policy",
          key,
        };
      }
      remoteKnowledgeMissCache.add(key);
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
    if (PREFER_LOCAL_KNOWLEDGE) {
      const preferredLocal = readLocalMirror(PROMPT_LOCAL_ROOT, key);
      if (preferredLocal?.value) {
        return {
          raw: preferredLocal.value,
          source: "local_skill",
          key: preferredLocal.key || key,
        };
      }
    }

    if (!remotePromptMissCache.has(key)) {
      const loaded = await loadPromptFromS3(key, { reqId });
      if (loaded) {
        return {
          raw: normalizeMarkdown(loaded),
          source: "s3_skill",
          key,
        };
      }
      remotePromptMissCache.add(key);
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

async function loadAllKnowledgeCandidates(keys = [], options = {}) {
  const out = [];
  const seen = new Set();

  for (const key of Array.isArray(keys) ? keys : []) {
    const loaded = await loadKnowledgeCandidates([key], options);
    if (!loaded?.raw) continue;
    const dedupeKey = `${loaded.source}:${loaded.key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(loaded);
  }

  return out;
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

  const policyMatch = (await loadAllKnowledgeCandidates(keys.policy, { timeoutMs, traceId }))[0] || null;
  if (policyMatch?.raw) {
    const grounded = buildReplyFromRetrievedContent({
      policySubtype,
      raw: policyMatch.raw,
      query,
    });
    return {
      policySubtype,
      reply: grounded.reply,
      chips: [],
      retrieved: true,
      source: policyMatch.source,
      key: policyMatch.key,
      sourceKind: "policy",
      matched: Boolean(grounded.matched),
      answerGrounded: Boolean(grounded.answerGrounded),
      matchedPreview: grounded.matchedPreview || "",
    };
  }

  const skillMatch = await loadPromptCandidates(keys.skill, { timeoutMs, traceId });
  if (skillMatch?.raw) {
    const grounded = buildReplyFromRetrievedContent({
      policySubtype,
      raw: skillMatch.raw,
      query,
    });
    return {
      policySubtype,
      reply: grounded.reply,
      chips: extractHints(skillMatch.raw),
      retrieved: true,
      source: skillMatch.source,
      key: skillMatch.key,
      sourceKind: "skill",
      matched: Boolean(grounded.matched),
      answerGrounded: Boolean(grounded.answerGrounded),
      matchedPreview: grounded.matchedPreview || "",
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
    matched: false,
    answerGrounded: false,
    matchedPreview: "",
  };
}

async function resolveAskSnoozerPolicySources({ query = "", traceId = "", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const policySubtype = classifyAskSnoozerPolicySubtype(query);
  const keys = POLICY_KEY_CANDIDATES[policySubtype] || POLICY_KEY_CANDIDATES.general_policy;

  const sources = [];
  const policyMatches = await loadAllKnowledgeCandidates(keys.policy, { timeoutMs, traceId });
  for (const policyMatch of policyMatches) {
    if (!policyMatch?.raw) continue;
    sources.push(
      buildSourceRecord({
        raw: policyMatch.raw,
        source: policyMatch.source,
        key: policyMatch.key,
        sourceKind: "policy",
        policySubtype,
      })
    );
  }

  const skillMatch = await loadPromptCandidates(keys.skill, { timeoutMs, traceId });
  if (skillMatch?.raw) {
    sources.push(
      buildSourceRecord({
        raw: skillMatch.raw,
        source: skillMatch.source,
        key: skillMatch.key,
        sourceKind: "skill",
        policySubtype,
      })
    );
  }

  const primary = sources[0] || null;

  return {
    policySubtype,
    sources,
    chips: skillMatch?.raw ? extractHints(skillMatch.raw) : [],
    retrieved: sources.length > 0,
    source: primary?.source_type || "fallback",
    key: primary?.source_key || "",
    sourceKind: primary?.source_kind || "fallback",
  };
}

async function resolveAskSnoozerSupplementalSources({
  classification = null,
  query = "",
  path = "/",
  products = [],
  traceId = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const intentGroup = String(classification?.intent_group || "").trim();
  const intent = String(classification?.intent || "").trim();
  const sources = [];

  if (
    intentGroup === "assessment_handoff" &&
    (hasAnyNormalizedTerm(normalizedQuery, ASSESSMENT_SOURCE_TERMS) || intent === "assessment_start")
  ) {
    const candidates = SUPPLEMENTAL_SOURCE_CANDIDATES.assessment_handoff;
    const loadedSkills = [];

    for (const key of candidates.skill) {
      const loaded = await loadPromptCandidates([key], { timeoutMs, traceId });
      if (!loaded?.raw) continue;
      loadedSkills.push(loaded);
    }

    for (const loaded of loadedSkills) {
      sources.push(
        buildSourceRecord({
          raw: loaded.raw,
          source: loaded.source,
          key: loaded.key,
          sourceKind: "skill",
          policySubtype: "",
        })
      );
    }
  }

  if (
    intentGroup === "size_price" &&
    hasAnyNormalizedTerm(normalizedQuery, SPLIT_EDUCATION_TERMS)
  ) {
    const candidates = SUPPLEMENTAL_SOURCE_CANDIDATES.split_education;
    const loadedKnowledge = await loadKnowledgeCandidates(candidates.knowledge, {
      timeoutMs,
      traceId,
    });

    if (loadedKnowledge?.raw) {
      sources.push(
        buildSourceRecord({
          raw: loadedKnowledge.raw,
          source:
            loadedKnowledge.source === "s3_policy"
              ? "s3_knowledge"
              : loadedKnowledge.source === "local_policy"
                ? "local_knowledge"
                : loadedKnowledge.source,
          key: loadedKnowledge.key,
          sourceKind: "knowledge",
          policySubtype: "",
        })
      );
    }
  }

  if (intentGroup === "brand_education") {
    sources.push(...resolveBrandFactRecords(query));
  }

  if (
    ["product_fit", "product_compare", "size_price", "base_elevation", "couple_conflict", "accessory_help"].includes(
      intentGroup
    )
  ) {
    const productHandles = Array.from(
      new Set(
        []
          .concat(
            Array.isArray(products)
              ? products.map((product) => String(product?.handle || "").trim().toLowerCase())
              : []
          )
          .concat(extractProductHandleFromPath(path))
          .filter(Boolean)
      )
    ).slice(0, 3);

    if (productHandles.length) {
      const knowledgeSources = await loadProductKnowledgeSources(productHandles, {
        timeoutMs,
        traceId,
      });
      if (knowledgeSources.length) {
        sources.push(...knowledgeSources);
      }
    }
  }

  return {
    sources,
    retrieved: sources.length > 0,
  };
}

module.exports = {
  classifyAskSnoozerPolicySubtype,
  cleanShopperText,
  getAskSnoozerProductDocKey,
  getAskSnoozerProductDocKeys,
  normalizeMarkdown,
  resolveAskSnoozerPolicyAnswer,
  resolveAskSnoozerPolicySources,
  resolveAskSnoozerSupplementalSources,
  stripFrontMatter,
};
