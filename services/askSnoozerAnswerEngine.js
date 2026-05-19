const { normalizeAskSnoozerText } = require("./askSnoozerIntents");
const {
  cleanShopperText,
  normalizeMarkdown,
  stripFrontMatter,
} = require("./askSnoozerPolicy");

const MAX_REPLY_CHARS = 220;
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

  const joined = sentences.slice(0, 3).join(" ").trim();
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
        reply: "Start with breathable support that will not trap heat. These picks lean toward airflow while still giving you pressure relief.",
        grounded: true,
      };
    case "firm_support":
      return {
        reply: "Start with support first, then decide how soft or firm you want the bed. These options are stronger starting points if you do not want the mattress to feel too soft.",
        grounded: true,
      };
    case "back_pain":
      return {
        reply: "Start with support first and pressure relief second. These options are stronger starting points when you want the bed to hold you up without feeling harsh.",
        grounded: true,
      };
    case "couple_conflict":
      return {
        reply: "If you and your partner like different feels, start with options built to balance both sides. Dual-comfort designs should be prioritized here.",
        grounded: true,
      };
    case "compare_mattresses":
      return {
        reply: "Foam usually gives deeper contouring. Hybrid usually adds more lift, airflow, and bounce, so these are good options to compare.",
        grounded: true,
      };
    case "budget_value":
      return {
        reply: "For value, start with the simplest verified mattress options and confirm the right size before deciding.",
        grounded: true,
      };
    case "queen_size":
    case "king_size":
    case "split_king":
    case "twin_xl":
    case "full_size":
    case "size_help":
      return {
        reply: "Start with verified size matches first, then compare support and how soft or firm you want the bed.",
        grounded: true,
      };
    case "snoring":
      return {
        reply: "Start with the adjustable-base path rather than guessing at a mattress alone. Elevation can change how the whole setup feels.",
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
    if (action?.href === "/pages/snooze-assessment") {
      facts.push("The Snooze Assessment is the fastest way to narrow support, sleeping position, and size before you start guessing.");
    }
    if (action?.href === "/pages/book-your-snooze-session") {
      facts.push("A Snooze Session lets you try the bed in person before you decide.");
    }
  }
  for (const page of pages) {
    if (page?.href === "/pages/snooze-assessment") {
      facts.push("The assessment is a guided next step when comfort, support, or size is still unclear.");
    }
    if (page?.href === "/pages/book-your-snooze-session") {
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
      ? "/pages/book-your-snooze-session"
      : text.includes("Assessment")
        ? "/pages/snooze-assessment"
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

function buildAskSnoozerAnswer({
  query = "",
  intent = "",
  intent_group: intentGroup = "",
  context = null,
  sources = [],
  products = [],
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
    };
  }

  if (
    ["product_fit", "product_compare", "size_price", "couple_conflict", "base_elevation"].includes(intentGroup) &&
    selected.facts.length &&
    (queryLooksLikeSplitEducation(query) || intent === "size_help")
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
      };
    }
  }

  if (
    ["product_fit", "product_compare", "size_price", "couple_conflict", "base_elevation"].includes(intentGroup) &&
    Array.isArray(products) &&
    products.length
  ) {
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
    };
  }

  if (["assessment_handoff", "booking_handoff", "cart_confidence"].includes(intentGroup)) {
    const handoffFacts = dedupeFacts(
      selected.facts.concat(buildHandoffFacts({ actions, pages, collections }))
    );
    const guidedReply =
      intentGroup === "assessment_handoff"
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
  };
}

module.exports = {
  buildAskSnoozerAnswer,
};
