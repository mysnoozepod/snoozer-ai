const { normalizeAskSnoozerText } = require("./askSnoozerIntents");
const {
  cleanShopperText,
  normalizeMarkdown,
  stripFrontMatter,
} = require("./askSnoozerPolicy");
const { HUD_SAFE_PAGE_ROUTES } = require("./askSnoozerRoutes");

const MAX_REPLY_CHARS = 205;
const MAX_FACTS = 3;

const STOP_WORDS = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "are",
  "at",
  "before",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "get",
  "have",
  "help",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "like",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "should",
  "show",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "want",
  "what",
  "whats",
  "when",
  "where",
  "which",
  "with",
  "your",
]);

const SKIP_HEADINGS = Object.freeze([
  "developer notes",
  "source",
  "related topics",
  "recommended actions",
  "quick help",
]);

const GROUP_TERMS = Object.freeze({
  policy_support: [
    "policy",
    "return",
    "refund",
    "delivery",
    "shipping",
    "warranty",
    "financing",
    "pricing",
  ],
  product_fit: ["support", "pressure relief", "alignment", "cooling", "airflow", "firm", "soft"],
  product_compare: ["compare", "foam", "hybrid", "airflow", "bounce", "contouring"],
  size_price: ["size", "queen", "king", "split king", "twin xl", "full", "value", "price"],
  base_elevation: ["base", "elevation", "adjustable", "head up", "zero gravity"],
  assessment_handoff: ["assessment", "quiz", "choose", "match"],
  booking_handoff: ["book", "showroom", "session", "try in person", "test"],
  cart_confidence: ["checkout", "cart", "choosing right", "ready to order"],
});

const POLICY_TERMS = Object.freeze({
  returns: ["return", "returns", "refund", "refunds", "trial", "exchange", "final sale"],
  delivery: ["delivery", "shipping", "carrier", "setup", "white glove", "removal", "schedule"],
  warranty: ["warranty", "warranties", "coverage", "claim", "defect", "sagging"],
  financing: ["financing", "monthly payment", "0% apr", "qualified", "minimum purchase"],
  pricing: ["pricing", "price", "cost", "discount", "rewards", "before tax", "delivery"],
});

function cleanAnswerText(raw) {
  return cleanShopperText(
    String(raw || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/\\([#*_`[\]()&])/g, "$1")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/(\d)\s*[–—-]\s*(\d)/g, "$1 to $2")
      .replace(/\s+/g, " ")
  );
}

function previewText(text, maxChars = 160) {
  const cleaned = cleanAnswerText(text);
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 3).trim()}...`;
}

function clampReply(text, fallback = "") {
  const cleaned = cleanAnswerText(text || fallback);
  if (!cleaned) return "";

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const joined = sentences.slice(0, 2).join(" ").trim();
  if (joined && joined.length <= MAX_REPLY_CHARS) return joined;
  return `${cleaned.slice(0, MAX_REPLY_CHARS - 3).trim().replace(/[,:;]$/, "")}...`;
}

function ensureSentence(text) {
  const cleaned = cleanAnswerText(text);
  if (!cleaned) return "";
  if (/[.!?]$/.test(cleaned)) return cleaned;
  return `${cleaned}.`;
}

function tokenize(text) {
  return Array.from(
    new Set(
      normalizeAskSnoozerText(text)
        .replace(/[^a-z0-9%/ ]+/g, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term && term.length > 1 && !STOP_WORDS.has(term))
    )
  );
}

function includesTerm(text, term) {
  return normalizeAskSnoozerText(text).includes(normalizeAskSnoozerText(term));
}

function scoreTermMatches(text, terms = [], weight = 1, cap = 10) {
  if (!Array.isArray(terms) || !terms.length) return 0;
  let score = 0;
  for (const term of terms) {
    if (includesTerm(text, term)) score += weight;
    if (score >= cap) return cap;
  }
  return Math.min(score, cap);
}

function isSkippableHeading(heading) {
  const normalized = normalizeAskSnoozerText(heading);
  return SKIP_HEADINGS.some((term) => normalized.includes(term));
}

function extractMarkdownFacts(source = {}) {
  const body = stripFrontMatter(normalizeMarkdown(source.text || ""));
  const lines = body.split("\n");
  const facts = [];
  let currentHeading = cleanAnswerText(source.title || "");
  let paragraph = [];
  let order = 0;

  function flushParagraph() {
    if (!paragraph.length) return;
    const text = cleanAnswerText(paragraph.join(" "));
    paragraph = [];
    if (!text || text.length < 12) return;
    if (currentHeading && isSkippableHeading(currentHeading)) return;
    facts.push({
      text,
      kind: "paragraph",
      heading: currentHeading,
      source_type: source.source_type,
      source_key: source.source_key,
      order: order++,
    });
  }

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line || /^---+$/.test(line)) {
      flushParagraph();
      continue;
    }

    if (/^(title|category|version|updated|tags|related_skills|ui_actions|hints)\s*:/i.test(line)) {
      flushParagraph();
      continue;
    }

    if (/^\|/.test(line)) {
      flushParagraph();
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      flushParagraph();
      currentHeading = cleanAnswerText(line.replace(/^#{1,6}\s+/, ""));
      continue;
    }

    if (/^[A-Za-z][A-Za-z0-9 &/()'’-]+:\s*$/.test(line) && line.length < 80) {
      flushParagraph();
      currentHeading = cleanAnswerText(line.replace(/:\s*$/, ""));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph();
      const text = cleanAnswerText(line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""));
      if (!text || text.length < 8) continue;
      if (currentHeading && isSkippableHeading(currentHeading)) continue;
      facts.push({
        text,
        kind: "bullet",
        heading: currentHeading,
        source_type: source.source_type,
        source_key: source.source_key,
        order: order++,
      });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return facts;
}

function toFactCandidates(source = {}, options = {}) {
  const directFacts = Array.isArray(source.facts)
    ? source.facts
        .map((fact, index) => {
          if (!fact) return null;
          if (typeof fact === "string") {
            return {
              text: cleanAnswerText(fact),
              kind: "fact",
              heading: cleanAnswerText(source.title || ""),
              source_type: source.source_type,
              source_key: source.source_key,
              order: index,
            };
          }

          return {
            text: cleanAnswerText(fact.text || fact.label || ""),
            kind: fact.kind || "fact",
            heading: cleanAnswerText(fact.heading || source.title || ""),
            source_type: source.source_type,
            source_key: source.source_key,
            order: index,
          };
        })
        .filter((fact) => fact?.text)
    : [];

  const markdownFacts = directFacts.length ? [] : extractMarkdownFacts(source);
  const candidates = directFacts.length ? directFacts : markdownFacts;
  const queryTerms = tokenize(options.query);
  const groupTerms = GROUP_TERMS[options.intentGroup] || [];
  const subtypeTerms = POLICY_TERMS[options.policySubtype] || [];
  const intentTerms = options.intent ? [String(options.intent).replace(/_/g, " ")] : [];

  return candidates
    .map((candidate, index) => {
      const haystack = `${candidate.heading || ""} ${candidate.text || ""}`.trim();
      const score =
        (candidate.kind === "bullet" ? 7 : candidate.kind === "fact" ? 6 : 5) +
        scoreTermMatches(haystack, subtypeTerms, 5, 20) +
        scoreTermMatches(haystack, groupTerms, 3, 12) +
        scoreTermMatches(haystack, intentTerms, 2, 4) +
        scoreTermMatches(haystack, queryTerms, 2, 12) +
        (candidate.heading ? scoreTermMatches(candidate.heading, subtypeTerms.concat(queryTerms), 2, 8) : 0) +
        Math.max(0, 3 - Math.min(index, 3));

      return { ...candidate, score };
    })
    .sort((a, b) => (b.score - a.score) || (a.order - b.order));
}

function dedupeFacts(facts = []) {
  const seen = new Set();
  const out = [];
  for (const fact of facts) {
    const key = normalizeAskSnoozerText(fact?.text || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}

function selectFactsFromSources(sources = [], options = {}) {
  const candidates = dedupeFacts(
    sources.flatMap((source) => toFactCandidates(source, options))
  );

  const maxFacts =
    Number.isFinite(Number(options.maxFacts)) && Number(options.maxFacts) > 0
      ? Number(options.maxFacts)
      : MAX_FACTS;
  const selected = candidates.slice(0, maxFacts);
  const primary = selected[0] || null;
  const preview = previewText(selected.map((fact) => fact.text).join(" "));

  return {
    facts: selected,
    primarySourceType: primary?.source_type || "",
    primarySourceKey: primary?.source_key || "",
    matchedPreview: preview,
  };
}

function findFact(facts = [], terms = []) {
  const normalizedTerms = terms.map((term) => normalizeAskSnoozerText(term)).filter(Boolean);
  return (
    facts.find((fact) => {
      const text = normalizeAskSnoozerText(fact?.text || "");
      return normalizedTerms.some((term) => text.includes(term));
    }) || null
  );
}

function joinUniqueSentences(parts = [], maxSentences = 2) {
  const out = [];
  const seen = new Set();

  for (const part of parts) {
    const sentence = ensureSentence(part);
    const key = normalizeAskSnoozerText(sentence);
    if (!sentence || seen.has(key)) continue;
    seen.add(key);
    out.push(sentence);
    if (out.length >= maxSentences) break;
  }

  return clampReply(out.join(" "));
}

function queryLooksLikeTrialQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "trial") ||
    includesTerm(normalizedQuery, "100 night") ||
    includesTerm(normalizedQuery, "100-night") ||
    includesTerm(normalizedQuery, "sleep trial") ||
    includesTerm(normalizedQuery, "how long can i try it") ||
    includesTerm(normalizedQuery, "how long do i have to return it")
  );
}

function queryLooksLikeWarrantyRegistration(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return includesTerm(normalizedQuery, "register") || includesTerm(normalizedQuery, "registration");
}

function queryLooksLikeWarrantyClaim(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return includesTerm(normalizedQuery, "claim") || includesTerm(normalizedQuery, "contact");
}

function queryLooksLikeSplitEducation(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return [
    "half split",
    "split mattress",
    "split head mattress",
    "flex head mattress",
    "why would i need a split mattress",
    "do couples need split mattress",
  ].some((term) => includesTerm(normalizedQuery, term));
}

function queryLooksLikeAssessmentQuestionFlow(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "can you ask me questions") ||
    includesTerm(normalizedQuery, "ask me questions") ||
    includesTerm(normalizedQuery, "start assessment") ||
    includesTerm(normalizedQuery, "give me the quiz")
  );
}

function queryLooksLikePriceQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "how much") ||
    includesTerm(normalizedQuery, "price") ||
    includesTerm(normalizedQuery, "cost") ||
    includesTerm(normalizedQuery, "cheapest") ||
    includesTerm(normalizedQuery, "affordable") ||
    includesTerm(normalizedQuery, "under $") ||
    includesTerm(normalizedQuery, "under ")
  );
}

function queryLooksLikeCheapestQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "cheapest") ||
    includesTerm(normalizedQuery, "most affordable") ||
    includesTerm(normalizedQuery, "lowest price") ||
    includesTerm(normalizedQuery, "budget")
  );
}

function queryLooksLikeSpecificSizeAvailability(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return includesTerm(normalizedQuery, "come in") || includesTerm(normalizedQuery, "available");
}

function queryLooksLikeSizeListQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return includesTerm(normalizedQuery, "what sizes") || includesTerm(normalizedQuery, "what size");
}

function queryLooksLikeAdjustableBaseQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "adjustable base") ||
    includesTerm(normalizedQuery, "adjustable bed") ||
    includesTerm(normalizedQuery, "work with an adjustable base")
  );
}

function buildProductClarificationReply({ query = "", productContext = null } = {}) {
  const clarificationProducts = Array.isArray(productContext?.clarificationProducts)
    ? productContext.clarificationProducts.filter(Boolean)
    : [];
  const titles = clarificationProducts
    .map((product) => cleanAnswerText(product?.title || product?.label || product?.handle || ""))
    .filter(Boolean);
  const sizeLabel = cleanAnswerText(productContext?.sizeLabel || "");

  let checkLabel = "fit, size, or pricing";
  if (queryLooksLikePriceQuestion(query)) {
    checkLabel = sizeLabel ? `${sizeLabel} pricing` : "pricing";
  } else if (queryLooksLikeSpecificSizeAvailability(query) && sizeLabel) {
    checkLabel = `${sizeLabel} availability`;
  } else if (queryLooksLikeSizeListQuestion(query) || queryLooksLikeSpecificSizeAvailability(query)) {
    checkLabel = "size availability";
  }

  return {
    reply: titles.length
      ? `Which mattress are you asking about? I can check ${checkLabel} for ${formatSizeList(titles)}.`
      : `Which mattress are you asking about? I can check ${checkLabel} once I know the model.`,
    grounded: false,
    sourceType: "clarification",
    sourceKey: clarificationProducts
      .map((product) => cleanAnswerText(product?.handle || ""))
      .filter(Boolean)
      .join(","),
    facts: [],
    strategy: "needs_product_clarification",
  };
}

function queryLooksLikeCouplesQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "couples") ||
    includesTerm(normalizedQuery, "partner moves") ||
    includesTerm(normalizedQuery, "moves too much") ||
    includesTerm(normalizedQuery, "share the bed")
  );
}

function queryLooksLikeHotSleeperQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return includesTerm(normalizedQuery, "hot sleeper") || includesTerm(normalizedQuery, "sleep hot");
}

function queryLooksLikeBackSupportQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "back support") ||
    includesTerm(normalizedQuery, "back pain") ||
    includesTerm(normalizedQuery, "pressure relief")
  );
}

function queryLooksLikeFirmnessQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return includesTerm(normalizedQuery, "firm") || includesTerm(normalizedQuery, "soft");
}

function queryLooksLikeSideSleeperQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return includesTerm(normalizedQuery, "side sleeper") || includesTerm(normalizedQuery, "side sleepers");
}

function queryLooksLikeDifferenceQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return includesTerm(normalizedQuery, "what makes") || includesTerm(normalizedQuery, "different");
}

function queryLooksLikeBundlePriceQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    queryLooksLikePriceQuestion(normalizedQuery) &&
    (
      includesTerm(normalizedQuery, "adjustable base") ||
      includesTerm(normalizedQuery, "motion base") ||
      includesTerm(normalizedQuery, "mattress and base") ||
      includesTerm(normalizedQuery, "with a base") ||
      includesTerm(normalizedQuery, "add a base") ||
      includesTerm(normalizedQuery, "add a queen adjustable base")
    )
  );
}

function queryLooksLikeFinancingAprQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "0% apr") ||
    includesTerm(normalizedQuery, "apr") ||
    includesTerm(normalizedQuery, "interest")
  );
}

function queryLooksLikeFinancingProviderQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "synchrony") ||
    includesTerm(normalizedQuery, "shop pay") ||
    includesTerm(normalizedQuery, "affirm")
  );
}

function queryLooksLikeFinancingPaymentQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "monthly payment") ||
    includesTerm(normalizedQuery, "monthly payments") ||
    includesTerm(normalizedQuery, "payment plan") ||
    includesTerm(normalizedQuery, "payment plans") ||
    includesTerm(normalizedQuery, "what would payments be") ||
    includesTerm(normalizedQuery, "pay over time") ||
    includesTerm(normalizedQuery, "buy now and pay later")
  );
}

function queryLooksLikeFinancingCreditQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return includesTerm(normalizedQuery, "credit") || includesTerm(normalizedQuery, "prequalify");
}

function formatCurrencyValue(amount, currencyCode = "USD") {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "USD",
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `$${Math.round(numeric)}`;
  }
}

function inferProductProfile(handle = "") {
  const normalized = String(handle || "").trim().toLowerCase();
  return {
    isDualComfort: normalized.includes("dual-comfort"),
    isHybrid: normalized.includes("hybrid") && !normalized.includes("dual-comfort"),
    isFoam: normalized.includes("foam") && !normalized.includes("hybrid"),
    isBudgetFoam: normalized.startsWith("10-") && normalized.includes("foam"),
    isAdjustableBase: normalized.includes("adjustable") && normalized.includes("base"),
    isPillow: normalized.includes("pillow"),
    isProtector: normalized.includes("protector") || normalized.includes("encasement"),
    isBedding:
      normalized.includes("sheet") ||
      normalized.includes("bedding") ||
      normalized.includes("comforter") ||
      normalized.includes("topper") ||
      normalized.includes("pad"),
    isAccessory:
      normalized.includes("pillow") ||
      normalized.includes("protector") ||
      normalized.includes("encasement") ||
      normalized.includes("sheet") ||
      normalized.includes("bedding") ||
      normalized.includes("comforter") ||
      normalized.includes("topper") ||
      normalized.includes("pad"),
  };
}

function extractAvailableSizes(entry = null) {
  if (!entry?.product || !Array.isArray(entry.product.variants)) return [];
  const seen = new Set();
  const sizes = [];

  for (const variant of entry.product.variants) {
    const selectedOptions = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
    const sizeOption = selectedOptions.find(
      (option) => String(option?.name || "").trim().toLowerCase() === "size"
    );
    const label = cleanAnswerText(sizeOption?.value || "");
    const key = normalizeAskSnoozerText(label);
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    sizes.push(label);
  }

  return sizes;
}

function formatSizeList(labels = []) {
  const safe = labels.filter(Boolean);
  if (!safe.length) return "";
  if (safe.length === 1) return safe[0];
  if (safe.length === 2) return `${safe[0]} and ${safe[1]}`;
  return `${safe.slice(0, -1).join(", ")}, and ${safe[safe.length - 1]}`;
}

function buildAssessmentStartChips() {
  return [
    { label: "Side sleeper", value: "Side sleeper" },
    { label: "Back sleeper", value: "Back sleeper" },
    { label: "Stomach sleeper", value: "Stomach sleeper" },
    { label: "Combination sleeper", value: "Combination sleeper" },
    { label: "I sleep hot", value: "I sleep hot" },
    { label: "Need firm support", value: "I need firm support" },
    { label: "Partner moves", value: "Partner moves" },
  ];
}

function buildAssessmentStartReply() {
  return {
    reply: "Yes. Start with one: how do you usually sleep - side, back, stomach, or combination?",
    grounded: true,
    chips: buildAssessmentStartChips(),
  };
}

function buildBrandEducationReply({ query = "", facts = [] } = {}) {
  const normalizedQuery = normalizeAskSnoozerText(query);

  if (includesTerm(normalizedQuery, "snoozepod") || includesTerm(normalizedQuery, "sleep pod")) {
    return {
      reply:
        "A SnoozePod is the full sleep setup around your mattress: the mattress, base, pillows, and accessories chosen around how you sleep.",
      grounded: true,
    };
  }

  if (includesTerm(normalizedQuery, "snooze session")) {
    return {
      reply:
        "A Snooze Session is the in-person feel test so you can try beds before deciding. It is the best next step when you want to compare support, motion, or setup in person.",
      grounded: true,
    };
  }

  if (includesTerm(normalizedQuery, "snooze assessment")) {
    return {
      reply:
        "The Snooze Assessment is the short guided flow that narrows size, motion, and mattress direction. It is the fastest way to start when you do not want to guess.",
      grounded: true,
    };
  }

  if (includesTerm(normalizedQuery, "rest test")) {
    return {
      reply:
        "A Rest Test is the guided time-on-bed comparison so you can notice support, pressure relief, and movement before you choose.",
      grounded: true,
    };
  }

  if (includesTerm(normalizedQuery, "snoozer")) {
    return {
      reply:
        "Snoozer is the shopping guide inside the HUD. He helps you compare mattresses, pricing, policies, and next steps without guessing.",
      grounded: true,
    };
  }

  return {
    reply: joinUniqueSentences(facts.map((fact) => fact.text)),
    grounded: Boolean(facts.length),
  };
}

function buildBundlePricingReply({ query = "", productContext = null } = {}) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const entries = Array.isArray(productContext?.entries) ? productContext.entries.filter(Boolean) : [];
  if (!entries.length || !(productContext?.bundleRequested || queryLooksLikeBundlePriceQuestion(normalizedQuery))) {
    return { reply: "", grounded: false, reason: "no_bundle_context" };
  }

  const sizeLabel = cleanAnswerText(productContext?.sizeLabel || "");
  const mattressEntry =
    entries.find((entry) => !inferProductProfile(entry?.handle).isAdjustableBase) || null;
  const baseEntry =
    entries.find((entry) => inferProductProfile(entry?.handle).isAdjustableBase) || null;
  const mattressPrice = formatCurrencyValue(mattressEntry?.variantPrice, mattressEntry?.currencyCode || "USD");
  const basePrice = formatCurrencyValue(baseEntry?.variantPrice, baseEntry?.currencyCode || "USD");
  const sourceType = productContext?.answerSourceType || "shopify_product";
  const sourceKey = entries.map((entry) => String(entry?.handle || "").trim()).filter(Boolean).join(",");

  if (!sizeLabel) {
    return {
      reply: "I can price the mattress and adjustable base separately, but I still need the size to give you the right subtotal.",
      grounded: true,
      sourceType,
      sourceKey,
      facts: entries
        .map((entry) => `${entry.title} is part of the current bundle comparison.`)
        .slice(0, 2),
      strategy: "verified_bundle_price",
    };
  }

  if (mattressPrice && basePrice) {
    const subtotal = formatCurrencyValue(
      Number(mattressEntry.variantPrice) + Number(baseEntry.variantPrice),
      mattressEntry?.currencyCode || baseEntry?.currencyCode || "USD"
    );
    const sizePrefix = sizeLabel ? `${sizeLabel} ` : "";

    return {
      reply: `${mattressEntry.title} and ${baseEntry.title} total ${subtotal} for a verified ${sizePrefix}pre-checkout subtotal before taxes, delivery, or financing.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: [
        `${mattressEntry.title} ${sizeLabel || mattressEntry?.variantTitle || ""} current verified price: ${mattressPrice}`.trim(),
        `${baseEntry.title} ${sizeLabel || baseEntry?.variantTitle || ""} current verified price: ${basePrice}`.trim(),
        `Estimated pre-checkout subtotal: ${subtotal}`.trim(),
      ],
      strategy: "verified_bundle_price",
    };
  }

  if (basePrice && !mattressEntry) {
    return {
      reply: `${baseEntry.title} is ${basePrice} in the current verified ${sizeLabel || "matching"} size data. I still need the mattress model to give you a combined subtotal.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: [`${baseEntry.title} ${sizeLabel || baseEntry?.variantTitle || ""} current verified price: ${basePrice}`.trim()],
      strategy: "verified_bundle_price",
    };
  }

  if (basePrice && mattressEntry && !mattressPrice) {
    return {
      reply: `${baseEntry.title} is ${basePrice} in the current verified ${sizeLabel || "matching"} size data. I still need a verified mattress price before I can total the bundle.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: [`${baseEntry.title} ${sizeLabel || baseEntry?.variantTitle || ""} current verified price: ${basePrice}`.trim()],
      strategy: "verified_bundle_price",
    };
  }

  if (mattressPrice && baseEntry && !basePrice) {
    return {
      reply: `${mattressEntry.title} is ${mattressPrice} in the current verified ${sizeLabel || "matching"} size data. I do not have a verified live base price for the same setup yet.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: [`${mattressEntry.title} ${sizeLabel || mattressEntry?.variantTitle || ""} current verified price: ${mattressPrice}`.trim()],
      strategy: "verified_bundle_price",
    };
  }

  return {
    reply: "I found the matching setup path, but I do not have verified live prices for every part of that bundle in this response yet.",
    grounded: false,
    sourceType,
    sourceKey,
    facts: [],
    strategy: "safe_fallback",
    reason: "missing_bundle_prices",
  };
}

function buildAccessoryReply({ query = "", products = [] } = {}) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  if (!Array.isArray(products) || !products.length) {
    const isPillowQuestion = includesTerm(normalizedQuery, "pillow");
    return {
      reply: isPillowQuestion
        ? "I do not see verified pillow options in the current product set yet. Start with the mattress and base first, then add pillows once they are listed."
        : "I do not see verified accessory options in the current product set yet. Start with the mattress and base first, then add the extras once they are listed.",
      grounded: false,
      reason: "no_verified_accessories",
    };
  }

  const handles = products.map((product) => String(product?.handle || "").trim().toLowerCase());
  const hasPillows = handles.some((handle) => inferProductProfile(handle).isPillow);
  const hasBedding = handles.some((handle) => inferProductProfile(handle).isBedding || inferProductProfile(handle).isProtector);

  if (includesTerm(normalizedQuery, "pillow") || hasPillows) {
    return {
      reply: "I found verified pillow options in the current product set. Start with these and compare cooling, loft, and support feel.",
      grounded: true,
      strategy: "verified_products",
    };
  }

  if (
    includesTerm(normalizedQuery, "protector") ||
    includesTerm(normalizedQuery, "bedding") ||
    includesTerm(normalizedQuery, "sheet") ||
    hasBedding
  ) {
    return {
      reply: "I found verified bedding and protector options in the current product set. Start with these and match them to how cool, soft, or low-maintenance you want the setup to feel.",
      grounded: true,
      strategy: "verified_products",
    };
  }

  return {
    reply: "If you are building out the full setup, start with the mattress and base first, then add the accessories that match how you sleep.",
    grounded: true,
    strategy: "verified_products",
  };
}

function buildProductSpecificReply({
  query = "",
  intent = "",
  intentGroup = "",
  facts = [],
  productContext = null,
} = {}) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const entries = Array.isArray(productContext?.entries) ? productContext.entries.filter(Boolean) : [];
  const sizeLabel = cleanAnswerText(productContext?.sizeLabel || "");
  const currentHandle = String(productContext?.currentProductHandle || "").trim().toLowerCase();
  const primary =
    entries.find((entry) => String(entry?.handle || "").trim().toLowerCase() === currentHandle) ||
    entries[0] ||
    null;

  if (!primary) {
    return { reply: "", grounded: false, reason: "no_product_context" };
  }

  const primaryTitle = cleanAnswerText(primary.title || primary.label || "");
  const primaryProfile = inferProductProfile(primary.handle);
  const primarySizes = extractAvailableSizes(primary);
  const sourceType = productContext?.answerSourceType || "shopify_product";
  const sourceKey =
    primary.handle ||
    entries
      .map((entry) => cleanAnswerText(entry?.handle || ""))
      .filter(Boolean)
      .join(",");

  const factTexts = dedupeFacts(
    facts.map((fact, index) => ({
      text: cleanAnswerText(fact?.text || ""),
      source_type: fact?.source_type || sourceType,
      source_key: fact?.source_key || sourceKey,
      order: index,
    }))
  ).map((fact) => fact.text);

  const bundleReply = buildBundlePricingReply({
    query,
    productContext,
  });

  if (bundleReply.grounded) {
    return bundleReply;
  }

  if (queryLooksLikeSpecificSizeAvailability(normalizedQuery) && sizeLabel) {
    const matchedSize = primarySizes.find(
      (label) => normalizeAskSnoozerText(label) === normalizeAskSnoozerText(sizeLabel)
    );
    return {
      reply: matchedSize
        ? `Yes - ${primaryTitle} has a ${matchedSize} option in the current Shopify variant data.`
        : `I do not see a verified ${sizeLabel} variant for ${primaryTitle} right now.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: [
        matchedSize
          ? `${primaryTitle} includes a ${matchedSize} size in the verified variant data.`
          : `${primaryTitle} does not show a verified ${sizeLabel} size in the current variant data.`,
      ],
      strategy: "verified_size_availability",
    };
  }

  if (queryLooksLikeSizeListQuestion(normalizedQuery) && primarySizes.length) {
    return {
      reply: `${primaryTitle} currently comes in ${formatSizeList(primarySizes)}.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: [`${primaryTitle} sizes: ${primarySizes.join(", ")}`],
      strategy: "verified_size_list",
    };
  }

  if (queryLooksLikePriceQuestion(normalizedQuery)) {
    const pricedEntries = entries.filter((entry) => Number.isFinite(Number(entry?.variantPrice)));
    const bestPriceEntry = pricedEntries[0] || primary;
    const price = formatCurrencyValue(bestPriceEntry?.variantPrice, bestPriceEntry?.currencyCode || "USD");
    const title = cleanAnswerText(bestPriceEntry?.title || "");
    const variantTitle = cleanAnswerText(bestPriceEntry?.matchedSizeLabel || sizeLabel || bestPriceEntry?.variantTitle || "");
    const multipleMatches = pricedEntries.length > 1 && !currentHandle;
    const explicitSize = Boolean(sizeLabel);

    if (price) {
      if (queryLooksLikeCheapestQuestion(normalizedQuery)) {
        return {
          reply: explicitSize
            ? `${title} is the lowest verified ${variantTitle ? `${variantTitle} ` : ""}match I found at ${price}. Compare it first if price is your main filter.`
            : `${title} is the most affordable verified match I found, starting at ${price}. Compare it first if price is your main filter.`,
          grounded: true,
          sourceType,
          sourceKey: bestPriceEntry.handle || sourceKey,
          facts: [`${title} ${variantTitle || bestPriceEntry?.variantTitle || ""} current verified price: ${price}`.trim()],
          strategy: "verified_price",
        };
      }

      if (multipleMatches) {
        return {
          reply: explicitSize
            ? `The lowest verified ${variantTitle ? `${variantTitle} ` : ""}match I found is ${title} at ${price}. I am also showing the other close matches so you can compare.`
            : `The lowest verified starting price I found is ${title} at ${price}. I am also showing the other close matches so you can compare.`,
          grounded: true,
          sourceType,
          sourceKey: bestPriceEntry.handle || sourceKey,
          facts: [`${title} ${variantTitle || bestPriceEntry?.variantTitle || ""} current verified price: ${price}`.trim()],
          strategy: "verified_price",
        };
      }

      return {
        reply: `The current ${variantTitle ? `${variantTitle} ` : ""}price I found for ${title} is ${price}.`,
        grounded: true,
        sourceType,
        sourceKey: bestPriceEntry.handle || sourceKey,
        facts: [`${title} ${variantTitle || bestPriceEntry?.variantTitle || ""} current verified price: ${price}`.trim()],
        strategy: "verified_price",
      };
    }

    return {
      reply:
        "I found matching products, but I do not have a verified live price for that exact size in this response.",
      grounded: true,
      sourceType,
      sourceKey,
      facts: factTexts.length ? factTexts : [`Matching products found for ${cleanAnswerText(query)}.`],
      strategy: "verified_price",
    };
  }

  if (intentGroup === "product_compare" && entries.length >= 2) {
    const [first, second] = entries;
    const firstProfile = inferProductProfile(first.handle);
    const secondProfile = inferProductProfile(second.handle);
    let comparisonReply = `${cleanAnswerText(first.title || "")} and ${cleanAnswerText(second.title || "")} are good products to compare.`;

    if (firstProfile.isFoam && secondProfile.isHybrid) {
      comparisonReply = `${cleanAnswerText(first.title || "")} gives you a closer contouring foam feel. ${cleanAnswerText(second.title || "")} adds more lift, airflow, and bounce.`;
    } else if (firstProfile.isHybrid && secondProfile.isFoam) {
      comparisonReply = `${cleanAnswerText(first.title || "")} adds more lift, airflow, and bounce. ${cleanAnswerText(second.title || "")} gives you a closer contouring foam feel.`;
    } else if (firstProfile.isDualComfort && secondProfile.isHybrid) {
      comparisonReply = `${cleanAnswerText(first.title || "")} is the better side-to-side comparison when two sleepers want different feels. ${cleanAnswerText(second.title || "")} is the cleaner shared-feel hybrid comparison if you want airflow and lift.`;
    } else if (firstProfile.isHybrid && secondProfile.isDualComfort) {
      comparisonReply = `${cleanAnswerText(first.title || "")} is the cleaner shared-feel hybrid comparison if you want airflow and lift. ${cleanAnswerText(second.title || "")} is better when two sleepers want more flexibility side to side.`;
    }

    return {
      reply: comparisonReply,
      grounded: true,
      sourceType,
      sourceKey: entries.map((entry) => entry.handle).filter(Boolean).join(","),
      facts: factTexts.length ? factTexts.slice(0, 3) : entries.map((entry) => cleanAnswerText(entry.reason || entry.title || "")).filter(Boolean).slice(0, 3),
      strategy: "verified_products",
    };
  }

  if (queryLooksLikeAdjustableBaseQuestion(normalizedQuery)) {
    const adjustableFact = findFact(facts, ["pairs well with an adjustable base", "adjustable base", "adjustable bases"]);
    const splitFact = findFact(facts, ["two twin xl bases", "split king", "independent control"]);
    return {
      reply: joinUniqueSentences([
        adjustableFact?.text
          ? `Yes - ${primaryTitle} is described as pairing well with an adjustable base. Check the size and base setup together before you decide.`
          : `${primaryTitle} can be a reasonable adjustable-base starting point, but compare the size and base setup before you decide.`,
        splitFact?.text
          ? "If you want split movement, make sure the mattress size and base setup match."
          : "",
      ]),
      grounded: true,
      sourceType: adjustableFact?.source_type || sourceType,
      sourceKey: adjustableFact?.source_key || sourceKey,
      facts: [
        adjustableFact?.text || `${primaryTitle} has adjustable-base pairing guidance.`,
        splitFact?.text || "",
      ].filter(Boolean),
      strategy: "source_summary",
    };
  }

  if (queryLooksLikeCouplesQuestion(normalizedQuery)) {
    return {
      reply: primaryProfile.isDualComfort
        ? `${primaryTitle} is the best first look when two sleepers want different feels on each side. It is the more couple-friendly path without turning the bed into two separate mattresses.`
        : `${primaryTitle} is worth comparing for shared comfort, but I would still put a more couple-friendly dual-comfort option beside it if you and your partner want different feels.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: factTexts.length ? factTexts.slice(0, 2) : [`${primaryTitle} is positioned for couples or motion isolation.`],
      strategy: "source_summary",
    };
  }

  if (queryLooksLikeHotSleeperQuestion(normalizedQuery) || intent === "sleep_hot") {
    return {
      reply: primaryProfile.isHybrid || primaryProfile.isDualComfort
        ? `${primaryTitle} is a good cooling-first comparison if you want more airflow without giving up support.`
        : `${primaryTitle} can still work, but I would compare it against the more breathable options first if cooling is your top priority.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: factTexts.length ? factTexts.slice(0, 2) : [`${primaryTitle} includes airflow or cooling guidance.`],
      strategy: "source_summary",
    };
  }

  if (queryLooksLikeSideSleeperQuestion(normalizedQuery)) {
    return {
      reply:
        primaryProfile.isHybrid || primaryProfile.isDualComfort
          ? `${primaryTitle} is a good first try if you want shoulder and hip relief without losing support underneath you.`
          : `${primaryTitle} can work well if you want a closer contouring feel around the shoulders and hips.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: factTexts.length ? factTexts.slice(0, 2) : [`${primaryTitle} includes pressure-relief guidance for side sleepers.`],
      strategy: "source_summary",
    };
  }

  if (queryLooksLikeBackSupportQuestion(normalizedQuery) || intent === "back_pain" || intent === "firm_support") {
    return {
      reply: primaryProfile.isHybrid
        ? `${primaryTitle} is a solid support-and-pressure-relief first try if you want lift without a flat hard feel.`
        : `${primaryTitle} is worth comparing if you want a steadier support-and-pressure-relief feel without making the bed harsh.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: factTexts.length ? factTexts.slice(0, 2) : [`${primaryTitle} includes support and pressure-relief guidance.`],
      strategy: "source_summary",
    };
  }

  if (queryLooksLikeDifferenceQuestion(normalizedQuery)) {
    let differenceReply = `${primaryTitle} is worth comparing if you want a clearer feel and feature difference before you decide.`;
    if (primaryProfile.isDualComfort) {
      differenceReply = `${primaryTitle} stands out because it lets you choose different comfort levels on each side while keeping one mattress. It is a better couple-friendly option when flexibility matters.`;
    } else if (primaryProfile.isHybrid) {
      differenceReply = `${primaryTitle} stands out because it adds more lift, airflow, and support than a simpler all-foam setup.`;
    } else if (primaryProfile.isFoam) {
      differenceReply = `${primaryTitle} stands out if you want a simpler contouring all-foam feel with stronger motion isolation.`;
    }

    return {
      reply: differenceReply,
      grounded: true,
      sourceType,
      sourceKey,
      facts: factTexts.length ? factTexts.slice(0, 2) : [`${primaryTitle} has distinct feel and feature guidance in the current product facts.`],
      strategy: "source_summary",
    };
  }

  if (queryLooksLikeFirmnessQuestion(normalizedQuery)) {
    let firmnessReply = `${primaryTitle} is worth comparing if firmness is your main filter.`;
    if (primaryProfile.isDualComfort) {
      firmnessReply = `${primaryTitle} gives you multiple comfort options, so you can compare Soft, Medium Soft, Medium Firm, and Firm without leaving the product line.`;
    } else if (primaryProfile.isHybrid) {
      firmnessReply = `${primaryTitle} leans softer than a firm support-first mattress, so compare it if you want cushioning with structure underneath.`;
    } else if (primaryProfile.isBudgetFoam) {
      firmnessReply = `${primaryTitle} is the firmer all-foam starting point in this lineup if you want a steadier feel.`;
    } else if (primaryProfile.isFoam) {
      firmnessReply = `${primaryTitle} leans more cushioned than firm, so compare it if you want extra pressure relief and a softer feel.`;
    }

    return {
      reply: firmnessReply,
      grounded: true,
      sourceType,
      sourceKey,
      facts: factTexts.length ? factTexts.slice(0, 2) : [`${primaryTitle} includes firmness guidance.`],
      strategy: "source_summary",
    };
  }

  if (intent === "product_question" || currentHandle) {
    return {
      reply: `${primaryTitle} is a good product to compare from the current page context. Use the size and feature details here to confirm fit before you decide.`,
      grounded: true,
      sourceType,
      sourceKey,
      facts: factTexts.length ? factTexts.slice(0, 2) : [`${primaryTitle} is the active product context for this answer.`],
      strategy: "source_summary",
    };
  }

  return { reply: "", grounded: false, reason: "no_product_specific_reply" };
}

function buildPolicyReply({ query = "", policySubtype = "", facts = [] } = {}) {
  const normalizedQuery = normalizeAskSnoozerText(query);
  const topFact = facts[0]?.text || "";

  if (!facts.length) {
    return {
      reply: policySubtype === "financing"
        ? "I do not see the financing details I would need to answer that clearly right now."
        : "I do not see that exact detail in the current policy text.",
      grounded: false,
      reason: "no_relevant_facts",
    };
  }

  if (policySubtype === "returns") {
    const trialFact = findFact(facts, ["100-night", "return or exchange", "sleep trial"]);
    const refundFact = findFact(facts, ["refund", "3 to 5 business days", "pickup fee"]);
    const finalSaleFact = findFact(facts, ["final sale", "motion bases", "adjustable frames"]);
    const mattressOnlyFact = findFact(facts, ["mattress purchases only", "good condition", "stains"]);
    const trialStartFact = findFact(facts, ["begins the day your mattress is delivered", "from delivery"]);

    if (queryLooksLikeTrialQuestion(normalizedQuery)) {
      return {
        reply: joinUniqueSentences([
          trialFact?.text
            ? "Mattresses can be returned or exchanged once during the 100-night trial."
            : topFact,
          finalSaleFact?.text
            ? "Adjustable bases and motion bases are final sale once opened or delivered."
            : trialStartFact?.text || "",
        ]),
        grounded: true,
      };
    }

    if (includesTerm(normalizedQuery, "adjustable base") || includesTerm(normalizedQuery, "motion base")) {
      if (finalSaleFact) {
        return {
          reply: joinUniqueSentences([
            "Based on the current return information, adjustable bases and motion bases are final sale once opened or delivered.",
            "The 100-night return window applies to mattress purchases only.",
          ]),
          grounded: true,
        };
      }

      return {
        reply: joinUniqueSentences([
          trialFact?.text
            ? "Based on the current return information, mattresses can be returned or exchanged once during the 100-night trial."
            : topFact,
          "I do not see adjustable-base return coverage spelled out in the current return text, so confirm that specific item before deciding.",
        ]),
        grounded: true,
      };
    }

    if (includesTerm(normalizedQuery, "refund")) {
      return {
        reply: joinUniqueSentences([
          trialFact?.text
            ? "The return information says mattresses can be returned or exchanged once during the 100-night trial."
            : topFact,
          refundFact?.text
            ? "Refunds are usually issued within 3 to 5 business days after pickup."
            : mattressOnlyFact?.text || "",
        ]),
        grounded: true,
      };
    }

    return {
      reply: joinUniqueSentences([
        trialFact?.text
          ? "The return information says mattresses can be returned or exchanged once during the 100-night trial."
          : topFact,
        mattressOnlyFact?.text
          ? "The mattress needs to stay in good condition, and refunds usually process 3 to 5 business days after pickup."
          : refundFact?.text || "",
      ]),
      grounded: true,
    };
  }

  if (policySubtype === "delivery") {
    const timingFact = findFact(facts, ["3 to 7 business days", "delivery times", "standard delivery"]);
    const setupFact = findFact(facts, ["white-glove", "setup", "old mattress removal", "assembly"]);
    const schedulingFact = findFact(facts, ["text or email", "track", "reschedule", "scheduling"]);
    const feeFact = findFact(facts, ["free for orders", "delivery fee", "qualifying orders", "service area"]);

    if (includesTerm(normalizedQuery, "how much") || includesTerm(normalizedQuery, "cost") || includesTerm(normalizedQuery, "fee")) {
      return {
        reply: joinUniqueSentences([
          feeFact?.text
            ? "The delivery guidance says qualifying orders in the local service area can get standard delivery at no charge, while smaller or out-of-area orders may have a fee."
            : topFact,
          timingFact?.text
            ? "Standard delivery usually runs 3 to 7 business days from purchase, depending on location and availability."
            : schedulingFact?.text || "",
        ]),
        grounded: true,
      };
    }

    if (includesTerm(normalizedQuery, "how long") || includesTerm(normalizedQuery, "when")) {
      return {
        reply: joinUniqueSentences([
          timingFact?.text
            ? "The delivery guidance says standard delivery usually runs 3 to 7 business days from purchase, depending on location and availability."
            : topFact,
          schedulingFact?.text
            ? "You should also get a text or email to schedule, track, or reschedule the delivery."
            : setupFact?.text || "",
        ]),
        grounded: true,
      };
    }

    return {
      reply: joinUniqueSentences([
        "Delivery usually runs 3 to 7 business days through trusted local carriers.",
        setupFact?.text
          ? "White-glove setup and old mattress removal are also available when needed."
          : schedulingFact?.text || "",
      ]),
      grounded: true,
    };
  }

  if (policySubtype === "warranty") {
    const mattressFact = findFact(facts, ["10-year limited warranty", "mattresses are covered"]);
    const coverageFact = findFact(facts, ["materials", "workmanship", "sagging", "defects"]);
    const baseFact = findFact(facts, ["motion bases", "first year", "parts only"]);
    const exclusionsFact = findFact(facts, ["not covered", "excludes", "stains", "misuse"]);
    const registrationFact = findFact(facts, [
      "no registration is needed",
      "no registration needed",
      "proof of purchase automatically activates",
      "proof of purchase activates",
    ]);
    const claimFact = findFact(facts, [
      "claims can be filed",
      "contact us through snoozer",
      "by email",
      "in-store",
      "proof of purchase is required",
    ]);

    if (queryLooksLikeWarrantyRegistration(normalizedQuery)) {
      return {
        reply: joinUniqueSentences([
          registrationFact?.text
            ? "I do not see a separate registration requirement in the current warranty guidance."
            : topFact,
          registrationFact?.text
            ? "Your proof of purchase activates the coverage."
            : claimFact?.text || "",
        ]),
        grounded: true,
      };
    }

    if (queryLooksLikeWarrantyClaim(normalizedQuery)) {
      return {
        reply: joinUniqueSentences([
          claimFact?.text
            ? "The warranty guidance says claims can be started through Snoozer, by email, or in-store."
            : topFact,
          "Keep your order details or proof of purchase handy when you file the claim.",
        ]),
        grounded: true,
      };
    }

    if (includesTerm(normalizedQuery, "base")) {
      return {
        reply: joinUniqueSentences([
          baseFact?.text
            ? "The warranty information says motion bases have 10-year limited coverage, with full coverage in year one and parts-only coverage after that."
            : mattressFact?.text || topFact,
          exclusionsFact?.text
            ? "Coverage does not include misuse, modifications, or other excluded damage."
            : coverageFact?.text || "",
        ]),
        grounded: true,
      };
    }

    if (includesTerm(normalizedQuery, "how long")) {
      return {
        reply: joinUniqueSentences([
          mattressFact?.text
            ? "The warranty information says mattresses are covered by a 10-year limited warranty."
            : topFact,
          coverageFact?.text
            ? "That coverage is for defects in materials or workmanship, not normal wear, stains, or misuse."
            : baseFact?.text || "",
        ]),
        grounded: true,
      };
    }

    return {
      reply: joinUniqueSentences([
        mattressFact?.text
          ? "The warranty information says mattresses are covered by a 10-year limited warranty."
          : topFact,
        coverageFact?.text
          ? "It covers defects in materials or workmanship, while normal wear, stains, and misuse are excluded."
          : exclusionsFact?.text || "",
      ]),
      grounded: true,
    };
  }

  if (policySubtype === "financing") {
    const monthlyFact = findFact(facts, ["monthly payment", "monthly payments", "spread out your purchase"]);
    const aprFact = findFact(facts, ["0% apr", "qualified customers", "qualified"]);
    const minimumFact = findFact(facts, ["minimum purchase", "$499", "no penalties"]);
    const providerFact = findFact(facts, ["synchrony", "shop pay", "affirm"]);
    const earlyPayFact = findFact(facts, ["pay off early", "no penalties"]);

    if (includesTerm(normalizedQuery, "no money down")) {
      return {
        reply: joinUniqueSentences([
          monthlyFact?.text
            ? "The current financing guidance says monthly payment options are available, including 0% APR plans for qualified customers."
            : aprFact?.text || topFact,
          aprFact?.text && !/no money down/i.test(aprFact.text)
            ? "I do not see an exact no-money-down promise in the current financing guidance."
            : minimumFact?.text || "",
        ]),
        grounded: true,
      };
    }

    if (queryLooksLikeFinancingAprQuestion(normalizedQuery)) {
      return {
        reply: joinUniqueSentences([
          aprFact?.text
            ? "0% APR means qualified customers may be able to pay over time without interest during the promotional period."
            : topFact,
          providerFact?.text
            ? "The current financing guidance points to providers like Synchrony and Shop Pay for those plans."
            : minimumFact?.text || earlyPayFact?.text || "",
        ]),
        grounded: true,
      };
    }

    if (queryLooksLikeFinancingProviderQuestion(normalizedQuery)) {
      return {
        reply: joinUniqueSentences([
          providerFact?.text
            ? "The current financing guidance points to providers like Synchrony, Shop Pay, and Affirm where available."
            : topFact,
          aprFact?.text
            ? "It also says some shoppers may qualify for 0% APR plans."
            : minimumFact?.text || "",
        ]),
        grounded: true,
      };
    }

    if (queryLooksLikeFinancingPaymentQuestion(normalizedQuery)) {
      return {
        reply: joinUniqueSentences([
          monthlyFact?.text
            ? "Pay over time and monthly payment options may be available for qualified customers through the financing provider."
            : topFact,
          "I do not have a verified payment calculator in this response, so I will not guess your exact payment.",
        ]),
        grounded: true,
      };
    }

    if (queryLooksLikeFinancingCreditQuestion(normalizedQuery)) {
      return {
        reply: joinUniqueSentences([
          monthlyFact?.text
            ? "The financing guidance says pay-over-time options are handled by the financing provider."
            : topFact,
          "Approval, qualification, and any credit review are handled by that provider, so I will not guess the outcome here.",
        ]),
        grounded: true,
      };
    }

    return {
      reply: joinUniqueSentences([
        monthlyFact?.text
          ? "The current financing guidance says monthly payment options are available for qualifying purchases."
          : topFact,
        aprFact?.text
          ? "It also mentions 0% APR plans for qualified customers."
          : minimumFact?.text || "",
      ]),
      grounded: true,
    };
  }

  if (policySubtype === "pricing") {
    const priceFact = findFact(facts, ["best available price", "before tax", "delivery", "transparent"]);
    const rewardsFact = findFact(facts, ["rewards", "discounts", "limited-time", "bonus"]);

    return {
      reply: joinUniqueSentences([priceFact?.text || topFact, rewardsFact?.text]),
      grounded: true,
    };
  }

  return {
    reply: joinUniqueSentences(facts.map((fact) => fact.text)),
    grounded: true,
  };
}

function buildSourceGuidedReply({ query = "", intent = "", intentGroup = "", facts = [] } = {}) {
  if (!facts.length) {
    return { reply: "", grounded: false, reason: "no_relevant_facts" };
  }

  if (intentGroup === "assessment_handoff") {
    return {
      reply: joinUniqueSentences([
        "Start with how you sleep, what feels uncomfortable now, and whether you sleep hot.",
        "The Snooze Assessment is the fastest way to narrow the right mattress without guessing.",
      ]),
      grounded: true,
    };
  }

  if (intentGroup === "size_price" && (intent === "size_help" || intent === "split_king" || queryLooksLikeSplitEducation(query))) {
    const splitFact = findFact(facts, [
      "different feel per side",
      "split comfort",
      "one mattress",
      "half split queen",
      "half split king",
      "split king",
    ]);
    const adjustableFact = findFact(facts, [
      "not the same as a split mattress for adjustable bases",
      "move independently on an adjustable base",
      "adjustable base setup",
      "split king mattress",
    ]);

    return {
      reply: joinUniqueSentences([
        splitFact?.text
          ? "A split or half-split setup can let each side feel different without turning the mattress into two separate pieces."
          : "A split or half-split setup is usually about giving each side more independence.",
        adjustableFact?.text
          ? "If you also want different comfort or movement on each side, check adjustable-base compatibility too."
          : "Couples usually look at it when they want different comfort or movement on each side.",
      ]),
      grounded: true,
    };
  }

  return { reply: "", grounded: false, reason: "no_source_reply" };
}

function buildProductReply({ intent = "", products = [] } = {}) {
  if (!Array.isArray(products) || !products.length) {
    return { reply: "", grounded: false, reason: "no_products" };
  }

  switch (String(intent || "").trim()) {
    case "sleep_hot":
      return {
        reply: "If you sleep hot, start with the beds that keep more airflow around you, then decide how much contouring you want.",
        grounded: true,
      };
    case "firm_support":
      return {
        reply: "Start with alignment first, then choose how much cushioning you want on top.",
        grounded: true,
      };
    case "back_pain":
      return {
        reply: "Start with a support-and-pressure-relief balance so the bed holds you up without feeling punishing.",
        grounded: true,
      };
    case "product_question":
      return {
        reply: "Start with the details on this mattress, then compare size, support, and base setup before you decide.",
        grounded: true,
      };
    case "couple_conflict":
      return {
        reply: "If you and your partner want different feels, start with the dual-comfort path first because it is usually the more couple-friendly answer.",
        grounded: true,
      };
    case "compare_mattresses":
      return {
        reply: "Foam usually gives deeper contouring. Hybrid usually adds more lift, airflow, and bounce, so these are good options to compare.",
        grounded: true,
      };
    case "budget_value":
      return {
        reply: "If value matters most, start with the simpler mattress paths and confirm the right size first.",
        grounded: true,
      };
    case "queen_size":
    case "king_size":
    case "split_king":
    case "twin_xl":
    case "full_size":
    case "size_help":
    case "bundle_price":
      return {
        reply: "Start with the size that actually fits your room and sleep setup, then compare feel and support inside that size.",
        grounded: true,
      };
    case "snoring":
      return {
        reply: "Start with the adjustable-base path rather than guessing at a mattress alone. Elevation can change how the whole setup feels.",
        grounded: true,
      };
    case "accessory_help":
      return {
        reply: "Start with the accessories that solve a real need, then leave the extras out until the mattress and base feel right.",
        grounded: true,
      };
    default:
      return {
        reply: "These are solid next options to compare based on what you asked.",
        grounded: true,
      };
  }
}

function buildHandoffFacts({ actions = [], pages = [], collections = [] } = {}) {
  const facts = [];
  for (const action of actions) {
    if (action?.href === HUD_SAFE_PAGE_ROUTES.assessment) {
      facts.push("The Snooze Assessment is the fastest way to narrow support, sleeping position, and size before you start guessing.");
    }
    if (action?.href === HUD_SAFE_PAGE_ROUTES.booking) {
      facts.push("A Snooze Session lets you try the bed in person before you decide.");
    }
  }
  for (const page of pages) {
    if (page?.href === HUD_SAFE_PAGE_ROUTES.assessment) {
      facts.push("The assessment is a guided next step when comfort, support, or size is still unclear.");
    }
    if (page?.href === HUD_SAFE_PAGE_ROUTES.booking) {
      facts.push("Booking a Snooze Session helps when you want to test the feel instead of guessing from the screen.");
    }
  }
  for (const collection of collections) {
    if (collection?.href === "/collections/mattresses") {
      facts.push("Shopping mattresses is the simplest way to compare the current lineup side by side.");
    }
  }
  return dedupeFacts(facts.map((text, index) => ({
    text,
    kind: "fact",
    heading: "Allowlisted next step",
    source_type: "action_allowlist",
    source_key: text.includes("Snooze Session")
      ? HUD_SAFE_PAGE_ROUTES.booking
      : text.includes("Assessment")
        ? HUD_SAFE_PAGE_ROUTES.assessment
        : "/collections/mattresses",
    order: index,
  })));
}

function buildHandoffReply({ intentGroup = "", facts = [] } = {}) {
  const first = facts[0]?.text || "";
  const second = facts[1]?.text || "";

  switch (String(intentGroup || "").trim()) {
    case "assessment_handoff":
      return {
        reply: joinUniqueSentences([
          first || "The Snooze Assessment is the fastest way to narrow this down properly.",
          second || "Use it when support, sleeping position, or size is still unclear.",
        ]),
        grounded: Boolean(first || second),
      };
    case "booking_handoff":
      return {
        reply: joinUniqueSentences([
          first || "If you want to try the bed in person before deciding, book a Snooze Session next.",
          second || "That gives you a cleaner feel test than guessing from the screen alone.",
        ]),
        grounded: Boolean(first || second),
      };
    case "cart_confidence":
      return {
        reply: joinUniqueSentences([
          "Before you finish, make sure the bed matches how you sleep and the setup you want.",
          second || first || "If you still feel unsure, the assessment or a Snooze Session is the safer next step.",
        ]),
        grounded: Boolean(first || second),
      };
    default:
      return { reply: "", grounded: false, reason: "no_handoff_reply" };
  }
}

function buildFallbackReply() {
  return {
    reply: "I can still guide you. Try one of these starting points.",
    grounded: false,
    reason: "ambiguous_query",
  };
}

const CANONICAL_REASON_LABELS = Object.freeze({
  split_requires_dual: "split-motion support",
  firmness_prefers_hybrid: "hybrid support preference",
  back_or_stomach_support: "back or stomach sleeper support",
  side_pressure_relief: "side pressure relief",
  default_support: "balanced support",
  motion_requires_adjustable: "motion setup compatibility",
  requested_adjustable_base: "your adjustable-base choice",
  requested_storage_base: "your storage-base choice",
  requested_platform_base: "your platform-base choice",
  requested_no_base: "your no-base choice",
  primary_mattress_exact: "exact mattress match",
  primary_mattress_family: "same mattress family match",
  requested_full_split: "your full-split motion choice",
  requested_half_split: "your half-split motion choice",
  requested_standard_motion: "your standard motion choice",
  partner_friendly: "partner-friendly setup",
  side_sleeper_pressure_relief: "side-sleeper pressure relief",
  firmness_firm_match: "firm comfort match",
  firmness_soft_match: "soft comfort match",
  fixture_size_match: "size match",
  simple_non_motion_option: "simple no-motion setup",
});

function queryLooksLikeRecommendationQuestion(query = "") {
  const normalizedQuery = normalizeAskSnoozerText(query);
  return (
    includesTerm(normalizedQuery, "what do you recommend") ||
    includesTerm(normalizedQuery, "recommend for me") ||
    includesTerm(normalizedQuery, "what should i try first") ||
    includesTerm(normalizedQuery, "what should i try") ||
    includesTerm(normalizedQuery, "explain my results") ||
    includesTerm(normalizedQuery, "explain the results") ||
    includesTerm(normalizedQuery, "why this pod") ||
    includesTerm(normalizedQuery, "why this snoozepod") ||
    includesTerm(normalizedQuery, "which mattress fits me") ||
    includesTerm(normalizedQuery, "which mattress is right for me") ||
    includesTerm(normalizedQuery, "which mattress fits us") ||
    includesTerm(normalizedQuery, "what mattress fits me") ||
    includesTerm(normalizedQuery, "what mattress should i try") ||
    includesTerm(normalizedQuery, "what pod should i try") ||
    includesTerm(normalizedQuery, "what should i try first")
  );
}

function formatCanonicalReasonLabels(reasonKeys = []) {
  const labels = Array.from(
    new Set(
      (Array.isArray(reasonKeys) ? reasonKeys : [])
        .map((reasonKey) => CANONICAL_REASON_LABELS[String(reasonKey || "").trim()] || "")
        .filter(Boolean)
    )
  );

  if (!labels.length) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, 2).join(", ")}, and ${labels[2]}`;
}

function buildCanonicalRecommendationReply({ query = "", canonicalRecommendation = null } = {}) {
  const canonical =
    canonicalRecommendation && typeof canonicalRecommendation === "object"
      ? canonicalRecommendation
      : null;

  if (!canonical?.topPodId || !canonical?.primaryMattressHandle) {
    return { reply: "", grounded: false, reason: "missing_canonical_recommendation" };
  }

  if (!queryLooksLikeRecommendationQuestion(query)) {
    return { reply: "", grounded: false, reason: "query_not_recommendation_specific" };
  }

  const normalizedQuery = normalizeAskSnoozerText(query);
  const topPodId = String(canonical.topPodId || "").trim();
  const topPodName =
    cleanAnswerText(canonical.topPodName || "") || (topPodId ? `SnoozePod ${topPodId}` : "your top SnoozePod");
  const nextPodNames = Array.isArray(canonical.topPodIds)
    ? canonical.topPodIds
        .slice(1, 3)
        .map((podId) => `SnoozePod ${String(podId || "").trim()}`)
        .filter(Boolean)
    : [];
  const mattressTitle =
    cleanAnswerText(canonical.primaryMattressTitle || "") ||
    cleanAnswerText(canonical.primaryMattressHandle || "") ||
    "your matched mattress";
  const baseTitle =
    canonical.baseHandle == null
      ? "No Base"
      : cleanAnswerText(canonical.baseTitle || "") ||
        cleanAnswerText(canonical.baseHandle || "") ||
        "your matched base";
  const motionLabel =
    cleanAnswerText(canonical.motionLabel || "") ||
    cleanAnswerText(canonical.normalizedAssessment?.motionLabel || "") ||
    cleanAnswerText(canonical.motionKey || "") ||
    "No Motion";
  const reasonSummary = formatCanonicalReasonLabels(canonical.reasonKeys);
  const warningSummary = Array.isArray(canonical.warnings) ? canonical.warnings.filter(Boolean)[0] || "" : "";

  let reply = "";

  if (
    includesTerm(normalizedQuery, "why this pod") ||
    includesTerm(normalizedQuery, "why this snoozepod")
  ) {
    reply = reasonSummary
      ? `${topPodName} is first because it matches ${reasonSummary}. It uses ${mattressTitle} with ${baseTitle} and ${motionLabel}.`
      : `${topPodName} is first in your canonical results. It uses ${mattressTitle} with ${baseTitle} and ${motionLabel}.`;
  } else if (
    includesTerm(normalizedQuery, "which mattress fits me") ||
    includesTerm(normalizedQuery, "which mattress is right for me") ||
    includesTerm(normalizedQuery, "which mattress fits us") ||
    includesTerm(normalizedQuery, "what mattress fits me") ||
    includesTerm(normalizedQuery, "what mattress should i try")
  ) {
    reply = reasonSummary
      ? `Your matched mattress is ${mattressTitle}. It pairs with ${baseTitle} and ${motionLabel}, and ${topPodName} is the first setup to try because of ${reasonSummary}.`
      : `Your matched mattress is ${mattressTitle}. It pairs with ${baseTitle} and ${motionLabel}, and ${topPodName} is the first setup to try.`;
  } else if (
    includesTerm(normalizedQuery, "explain my results") ||
    includesTerm(normalizedQuery, "explain the results")
  ) {
    const rankCopy = nextPodNames.length
      ? `Your current order starts with ${topPodName}, then ${nextPodNames.join(", then ")}.`
      : `${topPodName} is your first setup to try.`;
    reply = reasonSummary
      ? `${rankCopy} The core match is ${mattressTitle} with ${baseTitle} and ${motionLabel} because of ${reasonSummary}.`
      : `${rankCopy} The core match is ${mattressTitle} with ${baseTitle} and ${motionLabel}.`;
  } else if (
    includesTerm(normalizedQuery, "what should i try first") ||
    includesTerm(normalizedQuery, "what should i try") ||
    includesTerm(normalizedQuery, "what pod should i try")
  ) {
    reply = reasonSummary
      ? `Start with ${topPodName} first. It uses ${mattressTitle} with ${baseTitle} and ${motionLabel}, and it ranked first because of ${reasonSummary}.`
      : `Start with ${topPodName} first. It uses ${mattressTitle} with ${baseTitle} and ${motionLabel}.`;
  } else {
    reply = reasonSummary
      ? `I recommend ${topPodName} first. The match is ${mattressTitle} with ${baseTitle} and ${motionLabel} because of ${reasonSummary}.`
      : `I recommend ${topPodName} first. The match is ${mattressTitle} with ${baseTitle} and ${motionLabel}.`;
  }

  if (warningSummary) {
    reply = `${reply} Note: ${cleanAnswerText(warningSummary)}`;
  }

  return {
    reply,
    grounded: true,
    sourceType: "canonical_recommendation",
    sourceKey: topPodId,
    strategy: "canonical_recommendation",
    facts: [
      topPodName,
      mattressTitle,
      baseTitle,
      motionLabel,
      reasonSummary,
      warningSummary,
    ].filter(Boolean),
  };
}

function buildAskSnoozerAnswer({
  query = "",
  intent = "",
  intent_group: intentGroup = "",
  context = null,
  sources = [],
  products = [],
  productContext = null,
  canonicalRecommendation = null,
  actions = [],
  pages = [],
  collections = [],
  policy_subtype: policySubtype = "",
} = {}) {
  const safeSources = Array.isArray(sources) ? sources.filter(Boolean) : [];
  const selected = selectFactsFromSources(safeSources, {
    query,
    intentGroup,
    intent,
    policySubtype,
    maxFacts:
      intentGroup === "policy_support"
        ? 30
        : queryLooksLikeSplitEducation(query)
          ? 8
          : intentGroup === "assessment_handoff"
            ? 6
            : MAX_FACTS,
  });

  if (productContext?.needsProductClarification) {
    const clarificationReply = buildProductClarificationReply({
      query,
      productContext,
    });

    return {
      reply: clampReply(clarificationReply.reply),
      answer_grounded: false,
      answer_source_type: clarificationReply.sourceType || "clarification",
      answer_source_key: clarificationReply.sourceKey || "",
      answer_facts_count: 0,
      matched_preview: "",
      answer_strategy: clarificationReply.strategy || "needs_product_clarification",
      extracted_facts: [],
      needs_handoff: false,
      reason: "needs_product_clarification",
      chips_override: null,
    };
  }

  const canonicalReply = buildCanonicalRecommendationReply({
    query,
    canonicalRecommendation,
  });

  if (canonicalReply.grounded) {
    return {
      reply: clampReply(canonicalReply.reply),
      answer_grounded: true,
      answer_source_type: canonicalReply.sourceType || "canonical_recommendation",
      answer_source_key: canonicalReply.sourceKey || "",
      answer_facts_count: Array.isArray(canonicalReply.facts) ? canonicalReply.facts.length : 0,
      matched_preview: previewText(
        Array.isArray(canonicalReply.facts) ? canonicalReply.facts.join(" ") : canonicalReply.reply
      ),
      answer_strategy: canonicalReply.strategy || "canonical_recommendation",
      extracted_facts: Array.isArray(canonicalReply.facts) ? canonicalReply.facts : [],
      needs_handoff: false,
      reason: "",
      chips_override: null,
    };
  }

  if (intentGroup === "policy_support") {
    const policyReply = buildPolicyReply({
      query,
      policySubtype,
      facts: selected.facts,
    });

    return {
      reply: clampReply(policyReply.reply),
      answer_grounded: Boolean(policyReply.grounded && selected.facts.length),
      answer_source_type: selected.primarySourceType || "fallback",
      answer_source_key: selected.primarySourceKey || "",
      answer_facts_count: selected.facts.length,
      matched_preview: selected.matchedPreview || "",
      answer_strategy: policyReply.grounded ? "source_summary" : "safe_fallback",
      extracted_facts: selected.facts.map((fact) => fact.text),
      needs_handoff: !policyReply.grounded,
      reason: policyReply.reason || "",
      chips_override: null,
    };
  }

  if (intentGroup === "brand_education") {
    const brandReply = buildBrandEducationReply({
      query,
      facts: selected.facts,
    });

    return {
      reply: clampReply(brandReply.reply),
      answer_grounded: Boolean(brandReply.grounded && selected.facts.length),
      answer_source_type: selected.primarySourceType || "fallback",
      answer_source_key: selected.primarySourceKey || "",
      answer_facts_count: selected.facts.length,
      matched_preview: selected.matchedPreview || "",
      answer_strategy: brandReply.grounded ? "source_summary" : "safe_fallback",
      extracted_facts: selected.facts.map((fact) => fact.text),
      needs_handoff: false,
      reason: brandReply.grounded ? "" : "no_relevant_facts",
      chips_override: null,
    };
  }

  if (
    ["product_fit", "product_compare", "size_price", "couple_conflict", "base_elevation", "accessory_help"].includes(intentGroup) &&
    selected.facts.length &&
    queryLooksLikeSplitEducation(query) &&
    !queryLooksLikePriceQuestion(query) &&
    !queryLooksLikeSpecificSizeAvailability(query)
  ) {
    const guidedReply = buildSourceGuidedReply({
      query,
      intent,
      intentGroup,
      facts: selected.facts,
    });

    if (guidedReply.grounded) {
      return {
        reply: clampReply(guidedReply.reply),
        answer_grounded: true,
        answer_source_type: selected.primarySourceType || "fallback",
        answer_source_key: selected.primarySourceKey || "",
        answer_facts_count: selected.facts.length,
        matched_preview: selected.matchedPreview || "",
        answer_strategy: "source_summary",
        extracted_facts: selected.facts.map((fact) => fact.text),
        needs_handoff: false,
        reason: "",
        chips_override: null,
      };
    }
  }

  if (
    ["product_fit", "product_compare", "size_price", "couple_conflict", "base_elevation", "accessory_help"].includes(intentGroup) &&
    Array.isArray(products) &&
    products.length
  ) {
    if (intentGroup === "accessory_help") {
      const accessoryReply = buildAccessoryReply({
        query,
        products,
      });

      return {
        reply: clampReply(accessoryReply.reply),
        answer_grounded: Boolean(accessoryReply.grounded),
        answer_source_type: selected.primarySourceType || "shopify_product",
        answer_source_key:
          selected.primarySourceKey ||
          products.map((product) => String(product.handle || "").trim()).filter(Boolean).join(","),
        answer_facts_count: selected.facts.length,
        matched_preview: previewText(selected.facts.map((fact) => fact.text).join(" ")),
        answer_strategy: accessoryReply.strategy || "verified_products",
        extracted_facts: selected.facts.map((fact) => fact.text),
        needs_handoff: false,
        reason: accessoryReply.reason || "",
        chips_override: null,
      };
    }

    const productSpecificReply = buildProductSpecificReply({
      query,
      intent,
      intentGroup,
      facts: selected.facts,
      productContext,
    });

    if (productSpecificReply.grounded) {
      return {
        reply: clampReply(productSpecificReply.reply),
        answer_grounded: true,
        answer_source_type: productSpecificReply.sourceType || selected.primarySourceType || "shopify_product",
        answer_source_key: productSpecificReply.sourceKey || selected.primarySourceKey || "",
        answer_facts_count: Array.isArray(productSpecificReply.facts) ? productSpecificReply.facts.length : selected.facts.length,
        matched_preview: previewText(
          Array.isArray(productSpecificReply.facts) && productSpecificReply.facts.length
            ? productSpecificReply.facts.join(" ")
            : selected.matchedPreview || ""
        ),
        answer_strategy: productSpecificReply.strategy || "verified_products",
        extracted_facts:
          Array.isArray(productSpecificReply.facts) && productSpecificReply.facts.length
            ? productSpecificReply.facts
            : selected.facts.map((fact) => fact.text),
        needs_handoff: false,
        reason: "",
        chips_override: null,
      };
    }

    const productReply = buildProductReply({ intent, products });
    const productFacts = selected.facts.length
      ? selected.facts
      : products
          .map((product, index) => ({
            text: cleanAnswerText(product.reason || product.title || ""),
            source_type: selected.primarySourceType || "shopify_product",
            source_key: product.handle || "",
            order: index,
          }))
          .filter((fact) => fact.text)
          .slice(0, MAX_FACTS);

    return {
      reply: clampReply(productReply.reply),
      answer_grounded: Boolean(productReply.grounded),
      answer_source_type: selected.primarySourceType || "shopify_product",
      answer_source_key:
        selected.primarySourceKey ||
        products.map((product) => String(product.handle || "").trim()).filter(Boolean).join(","),
      answer_facts_count: productFacts.length,
      matched_preview: previewText(productFacts.map((fact) => fact.text).join(" ")),
      answer_strategy: "verified_products",
      extracted_facts: productFacts.map((fact) => fact.text),
      needs_handoff: false,
      reason: "",
      chips_override: null,
    };
  }

  if (intentGroup === "accessory_help") {
    const accessoryReply = buildAccessoryReply({
      query,
      products,
    });

    return {
      reply: clampReply(accessoryReply.reply),
      answer_grounded: Boolean(accessoryReply.grounded),
      answer_source_type: selected.primarySourceType || "fallback",
      answer_source_key: selected.primarySourceKey || "",
      answer_facts_count: selected.facts.length,
      matched_preview: selected.matchedPreview || "",
      answer_strategy: accessoryReply.grounded ? accessoryReply.strategy || "source_summary" : "safe_fallback",
      extracted_facts: selected.facts.map((fact) => fact.text),
      needs_handoff: false,
      reason: accessoryReply.reason || "",
      chips_override: null,
    };
  }

  if (["assessment_handoff", "booking_handoff", "cart_confidence"].includes(intentGroup)) {
    const handoffFacts = dedupeFacts(
      selected.facts.concat(buildHandoffFacts({ actions, pages, collections }))
    );
    const assessmentStartReply = intent === "assessment_start" ? buildAssessmentStartReply() : null;
    const guidedReply =
      assessmentStartReply?.grounded
        ? assessmentStartReply
        : intentGroup === "assessment_handoff"
        ? buildSourceGuidedReply({
            query,
            intent,
            intentGroup,
            facts: handoffFacts,
          })
        : { reply: "", grounded: false };
    const handoffReply = buildHandoffReply({ intentGroup, facts: handoffFacts });
    const resolvedReply = guidedReply.grounded ? guidedReply : handoffReply;
    const primaryFact = handoffFacts[0] || null;

    return {
      reply: clampReply(resolvedReply.reply),
      answer_grounded: Boolean(resolvedReply.grounded && handoffFacts.length),
      answer_source_type: primaryFact?.source_type || "fallback",
      answer_source_key: primaryFact?.source_key || "",
      answer_facts_count: handoffFacts.length,
      matched_preview: previewText(handoffFacts.map((fact) => fact.text).join(" ")),
      answer_strategy: resolvedReply.grounded
        ? intentGroup === "assessment_handoff" && selected.facts.length
          ? "source_summary"
          : "guided_handoff"
        : "safe_fallback",
      extracted_facts: handoffFacts.map((fact) => fact.text),
      needs_handoff: true,
      reason: resolvedReply.reason || "",
      chips_override: Array.isArray(resolvedReply.chips) ? resolvedReply.chips : null,
    };
  }

  const fallback = buildFallbackReply();
  return {
    reply: clampReply(fallback.reply),
    answer_grounded: false,
    answer_source_type: "fallback",
    answer_source_key: "",
    answer_facts_count: 0,
    matched_preview: "",
    answer_strategy: "safe_fallback",
    extracted_facts: [],
    needs_handoff: false,
    reason: fallback.reason || "no_source",
    chips_override: null,
  };
}

module.exports = {
  buildAskSnoozerAnswer,
};
